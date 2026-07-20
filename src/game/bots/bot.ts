/**
 * Entidad bot: junta movimiento (movement/step.ts, EL MISMO stepPlayer que
 * usa el jugador), combate (combat/combat.ts, el mismo stepCombat), y el
 * cerebro de la sección 8 del spec (percepción, apuntado, FSM, navegación)
 * en un solo estado por bot.
 *
 * Dos funciones de entrada, a propósito separadas en frecuencia distinta
 * (spec: "IA de bots a 15Hz escalonada... Movimiento y colisión siguen
 * corriendo cada tick de simulación"):
 *
 * - `stepBotThink`: percepción + FSM + objetivo de apuntado + objetivo de
 *   navegación. Corre sólo cuando el acumulador de IA de ESE bot cruza el
 *   intervalo de 15Hz (stepAllBotsThink hace el escalonado entre bots).
 * - `stepBotMotor`: apuntado (converge hacia el objetivo que dejó el último
 *   think), dirección hacia el próximo waypoint del camino, stepPlayer(),
 *   stepCombat(). Corre todos los ticks de simulación, como el jugador.
 */

import type { Box, Convex } from '@/game/map/types'
import { vec3, type Vec3 } from '@/game/math/vec3'
import { NO_CONVEXES, createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput, PlayerState } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'
import type { Hitbox } from '@/game/combat/hitboxes'
import { createCombatState, resetCombatState, stepCombat, type CombatInput, type CombatState } from '@/game/combat/combat'
import { createShotResult, type ShotResult } from '@/game/combat/shot'
import { radToDeg, type WeaponArchetype } from '@/game/weapons/archetypes'
import { BOTS } from '@/game/bots/tuning'
import {
  cellCenterX,
  cellCenterZ,
  cellCol,
  cellRow,
  buildMainComponentMask,
  nearestWalkableCellIndex,
  type NavGrid,
} from '@/game/bots/navgrid'
import {
  createPathCache,
  createPathfindingContext,
  findPathCached,
  type PathCache,
  type PathfindingContext,
} from '@/game/bots/pathfinding'
import { canHear, canSee, type RaycastMapFn } from '@/game/bots/perception'
import { buildPatrolGraph, nearestPatrolNode, pickPatrolNode, type PatrolGraph } from '@/game/bots/patrol'
import { nearestCoverDistanceXZ } from '@/game/bots/cover'
import {
  createAimBrainState,
  createAimMotorState,
  currentErrorConeRadius,
  lookAt,
  sampleErrorOffset,
  stepAimTowards,
  type AimBrainState,
  type AimMotorState,
  type YawPitch,
} from '@/game/bots/aim'
import { createFsmState, stepFsm, type BotStateName, type FsmState, type FsmTuning } from '@/game/bots/fsm'
import {
  applyDamageToBot,
  createBotHealthState,
  healthFraction,
  stepBotRespawn,
  type BotHealthState,
} from '@/game/bots/health'
import { interpolateDifficulty, type BotDifficulty } from '@/game/bots/difficulty'

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

const FSM_TUNING: FsmTuning = {
  targetMemoryS: BOTS.targetMemoryS,
  suspicionMemoryS: BOTS.suspicionMemoryS,
  retreatEnterHealthFraction: BOTS.retreatEnterHealthFraction,
  retreatExitHealthFraction: BOTS.retreatExitHealthFraction,
}

/** Último disparo conocido por el mundo (sección 8: "un radio de audición
 *  que se dispara con los disparos"). Un solo registro mutable, no una cola:
 *  a los bots sólo les importa "¿hubo un disparo nuevo desde la última vez
 *  que miré, y estaba cerca?" -- ver stepBotThink. `time` en -Infinity
 *  hasta el primer disparo real, para que ningún bot lo procese antes de
 *  que exista. */
export interface GunshotRegistry {
  position: Vec3
  time: number
}

export function createGunshotRegistry(): GunshotRegistry {
  return { position: vec3(), time: -Infinity }
}

/** game.ts llama esto una vez por disparo real (jugador o, a futuro, otro
 *  bot) para que la percepción auditiva tenga algo que escuchar. */
export function registerGunshot(registry: GunshotRegistry, position: Vec3, time: number): void {
  registry.position.x = position.x
  registry.position.y = position.y
  registry.position.z = position.z
  registry.time = time
}

/** Todo lo que un bot necesita del resto del juego para pensar y moverse,
 *  sin acoplarse a game.ts: el propio game.ts arma esto una vez y lo pasa
 *  por referencia cada tick (mutando sus campos, nunca reasignando el
 *  objeto -- cero asignaciones por frame en el llamador). */
export interface BotWorld {
  boxes: Box[]
  /** Brushes convexos del mapa (map/types.ts). Los bots corren el MISMO
   *  stepPlayer que el jugador: sin esto, en un mapa importado de Source
   *  atravesarían todas las paredes mientras el jugador choca contra
   *  ellas. */
  convexes: Convex[]
  raycastMap: RaycastMapFn
  grid: NavGrid
  pathCtx: PathfindingContext
  pathCache: PathCache
  /** Red de patrulla horneada del navgrid (bots/patrol.ts): los destinos
   *  que elige un bot en Idle para cruzar el mapa. Horneada una vez por
   *  mapa, junto con el navgrid -- nunca en el camino de frame. */
  patrol: PatrolGraph
  /**
   * Máscara del componente conexo alcanzable del navgrid
   * (bots/navgrid.ts buildMainComponentMask). Toda ELECCIÓN DE DESTINO la
   * consulta, porque "caminable" y "alcanzable" no son lo mismo: el bake
   * marca caminable el techo de cualquier muro o cobertura alta (superficie
   * plana con espacio libre encima), y nadie puede subir ahí. Sin la
   * máscara, nearestWalkableCellIndex devuelve alegremente esos techos como
   * destino, A* no encuentra camino y el bot se queda plantado hasta el
   * próximo cambio de estado. Medido jugando: 37% de las muestras de bot
   * vivo en la arena y 52% en el búnker, casi todas en Retirarse sin camino.
   * Horneada una vez por mapa, igual que el navgrid y la red de patrulla.
   */
  reachable: Uint8Array
  /** Posición de los ojos del objetivo (jugador), mundo. */
  targetEye: Vec3
  /** Reloj acumulado de simulación, segundos -- crece monótono, nunca se
   *  reinicia (a diferencia de dt): lo usan el escaneo de Idle y el registro
   *  de disparos para saber "cuánto hace". */
  simTimeS: number
  shots: GunshotRegistry
}

export function createBotWorld(
  boxes: Box[],
  raycastMap: RaycastMapFn,
  grid: NavGrid,
  convexes: Convex[] = NO_CONVEXES,
): BotWorld {
  return {
    boxes,
    convexes,
    raycastMap,
    grid,
    pathCtx: createPathfindingContext(grid),
    pathCache: createPathCache(),
    patrol: buildPatrolGraph(grid),
    reachable: buildMainComponentMask(grid),
    targetEye: vec3(),
    simTimeS: 0,
    shots: createGunshotRegistry(),
  }
}

export interface BotState {
  readonly id: number
  player: PlayerState
  input: PlayerInput

  health: BotHealthState
  /** [torso, cabeza, piernas]. `center` de cada uno es un Vec3 propio
   *  desplazado en Y (BOTS.torsoOffsetY/headOffsetY/legsOffsetY) desde
   *  bot.player.position (que es la BASE de la cápsula, no su centro --
   *  physics/capsule.ts) -- mismo patrón que targets/targets.ts. Ninguno
   *  aliasea directamente player.position: torsoCenter/headCenter/legsCenter
   *  (más abajo) son los Vec3 que syncBotHitboxes() resincroniza cada tick.
   *
   *  El orden importa y es parte del contrato con game.ts, que asigna
   *  `owner` por índice. */
  hitboxes: [Hitbox, Hitbox, Hitbox]
  torsoCenter: Vec3
  headCenter: Vec3
  legsCenter: Vec3

  archetype: WeaponArchetype
  combat: CombatState
  combatInput: CombatInput
  shotResult: ShotResult
  /** Segundos restantes de la recarga en curso -- ver stepBotCombat. Los
   *  bots no tienen viewmodel que anime una recarga (a diferencia del
   *  jugador, cuya recarga la maneja weapons/viewmodel/rig.ts), así que
   *  este temporizador simple hace ese trabajo: sin él, un bot que vacía el
   *  cargador queda desarmado para el resto de la partida (combatInput.reloading
   *  nunca vuelve a false, stepFireControl nunca vuelve a disparar). 0
   *  cuando no está recargando. */
  reloadTimerS: number

  fsm: FsmState
  difficultyRank: number
  difficulty: BotDifficulty

  aimMotor: AimMotorState
  aimBrain: AimBrainState
  aimTargetYaw: number
  aimTargetPitch: number

  wasVisible: boolean
  targetAwareTimeS: number
  timeSinceSeenS: number
  timeSinceHeardS: number
  lastProcessedShotTime: number
  lastKnownTargetPos: Vec3
  lastHeardPos: Vec3

  /** Celdas del camino actual (referencia a una entrada de PathCache,
   *  compartida entre bots que piden el mismo par origen/destino -- nunca
   *  se muta acá). */
  path: readonly number[]
  pathIndex: number
  /** Índice de celda de destino del camino actual, -1 si no hay ninguno
   *  pedido. Evita re-pedir el mismo camino en cada think si el objetivo no
   *  cambió de celda. */
  pathGoalCellIndex: number

  idleBaseYaw: number
  idlePhase: number

  /** Semilla del desempate de patrulla (bots/patrol.ts). Es el `seed` con el
   *  que se creó el bot, NO su `id`: el id sale de un contador global de
   *  módulo, así que dos bots "equivalentes" creados en momentos distintos
   *  del proceso patrullarían distinto. Con la semilla explícita, el
   *  escuadrón número N de una partida se comporta igual que el número 1. */
  patrolSeed: number
  /** Nodo de patrulla (índice dentro de BotWorld.patrol) al que se dirige
   *  este bot, -1 si todavía no eligió ninguno. Ver stepBotThink caso
   *  'idle': queda excluido de la próxima elección para que la patrulla
   *  avance en vez de rebotar entre dos puntos. */
  patrolNode: number
  /** true si el bot ya fue a mirar la última actividad conocida (enemigo
   *  visto u oído) desde que entró en Idle. Sin esta marca volvería a pedir
   *  el mismo destino cada think mientras la memoria siga fresca, y nunca
   *  pasaría a patrullar de verdad. */
  investigatedLastActivity: boolean

  /** Sentido del strafe de Enfrentar: -1 izquierda, +1 derecha, 0 quieto
   *  (sin terreno lateral válido). Ver stepBotThink caso 'engage'. */
  strafeDir: number
  /** Segundos sosteniendo el sentido actual de strafe. */
  strafeHoldS: number
  /** Punto donde el bot entró en Enfrentar: el strafe no se aleja más de
   *  BOTS.engageStrafeRadiusM de acá. */
  strafeAnchor: Vec3

  /** Segundos moviéndose por debajo de BOTS.stuckSpeedThreshold pese a tener
   *  intención de avanzar. Dispara el salto de emergencia -- ver stepBotMotor. */
  stuckTimeS: number

  /** Acumulador del tick de IA (15Hz), en segundos -- ver stepAllBotsThink. */
  aiAccumulator: number

  spawn: Vec3
}

let nextBotId = 0

// Scratch a nivel de módulo: cero asignaciones por bot por tick (mismo
// patrón que combat/combat.ts scratchSpreadSample).
const scratchLook: YawPitch = { yaw: 0, pitch: 0 }
const scratchOffset: YawPitch = { yaw: 0, pitch: 0 }

export function createBotState(
  spawn: Vec3,
  difficultyRank: number,
  archetype: WeaponArchetype,
  seed: number,
): BotState {
  const player = createPlayerState(spawn)
  const torso = vec3(spawn.x, spawn.y + BOTS.torsoOffsetY, spawn.z)
  const head = vec3(spawn.x, spawn.y + BOTS.headOffsetY, spawn.z)
  const legs = vec3(spawn.x, spawn.y + BOTS.legsOffsetY, spawn.z)

  const combat = createCombatState(archetype)
  const aimBrain = createAimBrainState(seed)
  // Fase de escaneo de Idle: se muestrea acá (una vez, al crear el bot) para
  // que varios bots no escaneen todos en fase -- mismo espíritu que el
  // desfase de dianas móviles en targets/targets.ts (TargetDef.phase).
  const idlePhaseSample: YawPitch = { yaw: 0, pitch: 0 }
  sampleErrorOffset(aimBrain, Math.PI, idlePhaseSample)

  return {
    id: nextBotId++,
    player,
    input: { forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false },

    health: createBotHealthState(BOTS.maxHealth),
    hitboxes: [
      { center: torso, radius: BOTS.torsoRadius, part: 'torso', owner: -1 },
      { center: head, radius: BOTS.headRadius, part: 'head', owner: -1 },
      { center: legs, radius: BOTS.legsRadius, part: 'limb', owner: -1 },
    ],
    torsoCenter: torso,
    headCenter: head,
    legsCenter: legs,

    archetype,
    combat,
    combatInput: { triggerHeld: false, reloading: false, origin: vec3(), pitch: 0, yaw: 0 },
    reloadTimerS: 0,
    shotResult: createShotResult(),

    fsm: createFsmState('idle'),
    difficultyRank,
    difficulty: interpolateDifficulty(difficultyRank),

    aimMotor: createAimMotorState(0, 0),
    aimBrain,
    aimTargetYaw: 0,
    aimTargetPitch: 0,

    wasVisible: false,
    targetAwareTimeS: 0,
    timeSinceSeenS: Infinity,
    timeSinceHeardS: Infinity,
    lastProcessedShotTime: -Infinity,
    lastKnownTargetPos: vec3(spawn.x, spawn.y, spawn.z),
    lastHeardPos: vec3(spawn.x, spawn.y, spawn.z),

    path: [],
    pathIndex: 0,
    pathGoalCellIndex: -1,

    idleBaseYaw: 0,
    idlePhase: idlePhaseSample.yaw,

    patrolSeed: seed,
    patrolNode: -1,
    investigatedLastActivity: false,

    strafeDir: 0,
    strafeHoldS: 0,
    strafeAnchor: vec3(spawn.x, spawn.y, spawn.z),

    stuckTimeS: 0,
    // Escalonado inicial: se completa cuando se llama createBotSquad (más
    // abajo), que conoce el total de bots. Un bot creado suelto (tests)
    // arranca en 0 -- piensa en su primer tick, sin escalonar contra nadie.
    aiAccumulator: 0,

    spawn: vec3(spawn.x, spawn.y, spawn.z),
  }
}

/** Crea `count` bots con dificultad `difficultyRank` (0..1, igual para
 *  todos -- section 8: el rango del jugador decide un único número que
 *  interpola los tres, no hay mezcla de dificultades dentro de una
 *  partida), repartidos por los spawns del mapa y escalonados en fase de IA
 *  para que no piensen todos en el mismo frame. */
export function createBotSquad(
  spawns: Vec3[],
  count: number,
  difficultyRank: number,
  archetype: WeaponArchetype,
): BotState[] {
  const bots: BotState[] = []
  for (let i = 0; i < count; i++) {
    const spawn = spawns[i % spawns.length]
    const bot = createBotState(spawn, difficultyRank, archetype, 0x1000 + i * 7919)
    bot.aiAccumulator = (i / count) * (1 / BOTS.aiTickHz)
    bots.push(bot)
  }
  return bots
}

function botEyeX(bot: BotState): number {
  return bot.player.position.x
}
function botEyeY(bot: BotState): number {
  return bot.player.position.y + bot.player.eyeHeight
}
function botEyeZ(bot: BotState): number {
  return bot.player.position.z
}

// ---------------------------------------------------------------------------
// Navegación: elegir y seguir un camino.
// ---------------------------------------------------------------------------

/** Pide (o reusa de caché) el camino de la celda actual del bot a
 *  `goalCellIndex`. No hace nada si ya está siguiendo un camino hacia esa
 *  misma celda -- evita repetir la búsqueda cada think mientras el objetivo
 *  no cambió de celda. */
function requestPathTo(bot: BotState, world: BotWorld, goalCellIndex: number): void {
  if (goalCellIndex < 0) return
  if (bot.pathGoalCellIndex === goalCellIndex && bot.pathIndex < bot.path.length) return

  const startIndex = nearestWalkableCellIndex(world.grid, bot.player.position.x, bot.player.position.z)
  if (startIndex < 0) return

  const entry = findPathCached(world.pathCtx, world.pathCache, startIndex, goalCellIndex)
  bot.pathGoalCellIndex = goalCellIndex
  bot.pathIndex = 0
  bot.path = entry.found ? entry.path : []
}

function clearPath(bot: BotState): void {
  bot.path = []
  bot.pathIndex = 0
  bot.pathGoalCellIndex = -1
}

function hasArrivedAtGoal(bot: BotState): boolean {
  return bot.pathGoalCellIndex < 0 || bot.pathIndex >= bot.path.length
}

/**
 * Genera BOTS.repositionCandidateCount puntos alrededor del bot (ángulos
 * parejos, desfasados por bot vía idlePhase para que no todos evalúen
 * exactamente los mismos puntos) y elige uno según `scoreFn` y
 * `difficulty.repositionQuality`: calidad 1 elige siempre el de mejor
 * puntaje, calidad 0 elige siempre el de peor puntaje (sección 8: "calidad
 * de reposicionamiento" es el único número que controla esta elección, nada
 * más). Devuelve el índice de celda elegido, o -1 si ningún candidato cayó
 * en una celda caminable.
 */
function pickCandidateCell(
  bot: BotState,
  world: BotWorld,
  scoreFn: (x: number, y: number, z: number) => number,
): number {
  const { grid } = world
  const count = BOTS.repositionCandidateCount
  const scored: Array<{ cell: number; score: number }> = []

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + bot.idlePhase
    const x = bot.player.position.x + Math.cos(angle) * BOTS.repositionSearchRadiusM
    const z = bot.player.position.z + Math.sin(angle) * BOTS.repositionSearchRadiusM
    const cell = nearestWalkableCellIndex(grid, x, z, 4, world.reachable)
    if (cell < 0) continue
    const cx = cellCenterX(grid, cellCol(grid, cell))
    const cz = cellCenterZ(grid, cellRow(grid, cell))
    // Altura de ojos aproximada PARADO sobre la superficie de esa celda
    // (grid.heights + la misma altura de ojos que usa el jugador/bot al
    // caminar) -- más preciso que reusar la altura de ojos ACTUAL del bot,
    // que puede estar parado en una elevación distinta a la del candidato.
    const cy = grid.heights[cell] + MOVEMENT.eyeHeight
    scored.push({ cell, score: scoreFn(cx, cy, cz) })
  }

  if (scored.length === 0) return -1

  // Orden descendente por puntaje: índice 0 = mejor candidato, último =
  // peor. `repositionQuality` (bots/difficulty.ts) elige DÓNDE en esa lista
  // cae la elección -- calidad 1 siempre el mejor, calidad 0 siempre el
  // peor, y los tiers intermedios en el medio. Es el único lugar del código
  // donde ese número tiene efecto (sección 8 del spec: "nada más varía").
  scored.sort((a, b) => b.score - a.score)
  const quality = Math.min(1, Math.max(0, bot.difficulty.repositionQuality))
  const rankIndex = Math.round((1 - quality) * (scored.length - 1))
  return scored[rankIndex].cell
}

function distanceXZ(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz)
}

/**
 * Elige a dónde va un bot que está en Idle y ya llegó (o nunca tuvo) su
 * destino anterior. Este es el arreglo central de esta tarea: antes, Idle no
 * pedía ningún camino y el bot se quedaba clavado donde perdió el contacto,
 * girando la mira en el lugar hasta que alguien se le cruzara. Medido
 * jugando: una partida TDM de 6 minutos con 7 de 8 bots congelados en Idle
 * en simultáneo y un solo kill en toda la partida.
 *
 * Dos escalones, en este orden:
 *
 * 1. **Ir a mirar la última actividad conocida** (una vez por entrada a
 *    Idle): el último lugar donde vio un enemigo o donde oyó un disparo, si
 *    la memoria es más fresca que BOTS.huntMemoryS. Es exactamente lo que
 *    hace un jugador que perdió a alguien de vista -- y usa sólo lo que el
 *    bot ya sabía: NO se consulta ninguna posición viva de enemigos acá
 *    (eso sería hacer trampa; ver bots/perception.ts para lo que un bot
 *    tiene derecho a saber).
 * 2. **Patrullar** (bots/patrol.ts): un nodo lejano y sesgado al centro del
 *    mapa. El "por qué esta heurística y no un rumbo al azar" está
 *    documentado en ese archivo.
 *
 * Si A* no encuentra camino al nodo elegido, el nodo queda igual como
 * `patrolNode` y por lo tanto excluido del próximo intento: el bot elige
 * otro en el think siguiente en vez de atascarse pidiendo lo imposible.
 */
function pickIdleDestination(bot: BotState, world: BotWorld): void {
  if (!bot.investigatedLastActivity) {
    bot.investigatedLastActivity = true
    const heardFresh = bot.timeSinceHeardS <= BOTS.huntMemoryS
    const seenFresh = bot.timeSinceSeenS <= BOTS.huntMemoryS
    if (heardFresh || seenFresh) {
      const useHeard = heardFresh && bot.timeSinceHeardS <= bot.timeSinceSeenS
      const src = useHeard ? bot.lastHeardPos : bot.lastKnownTargetPos
      const goal = nearestWalkableCellIndex(world.grid, src.x, src.z, 4, world.reachable)
      if (goal >= 0) {
        requestPathTo(bot, world, goal)
        if (bot.path.length > 0) return
      }
    }
  }

  const node = pickPatrolNode(
    world.patrol,
    bot.player.position.x,
    bot.player.position.z,
    bot.patrolNode,
    bot.patrolSeed,
  )
  if (node < 0) return
  bot.patrolNode = node
  requestPathTo(bot, world, world.patrol.cell[node])
}

/**
 * ¿Puede el bot dar un paso lateral de BOTS.engageStrafeProbeM hacia `dir`
 * (-1 izquierda, +1 derecha, en ejes locales de su apuntado)? Tres
 * condiciones, todas sobre información de mapa:
 *
 * - No alejarse más de BOTS.engageStrafeRadiusM del punto donde entró en
 *   Enfrentar: buscar ángulo es bailar alrededor de una posición, no
 *   emigrar.
 * - La celda de destino tiene que ser caminable de verdad (radio 0 en
 *   nearestWalkableCellIndex: sin el rescate en espiral, que acá mentiría) y
 *   estar a un desnivel que stepPlayer pueda subir solo.
 * - No quedar más lejos de la cobertura que ahora (bots/cover.ts, con
 *   BOTS.engageStrafeCoverSlackM de holgura). Sin esta condición, "moverse
 *   para buscar ángulo" degenera en salir a campo abierto y morir de pie,
 *   que se lee peor que el bot plantado que esta tarea viene a arreglar.
 */
/**
 * Desnivel máximo que admite un paso de strafe, metros. NO es
 * MOVEMENT.mantleMaxHeight, aunque eso era lo que decía antes: el mantle
 * (movement/mantle.ts) sólo procede EN EL AIRE, chocando una pared yendo
 * hacia ella. Un bot en Enfrentar no tiene camino (Enfrentar lo limpia a
 * propósito) y por lo tanto tampoco tiene el salto que steerAlongPath pide
 * al subir de celda: caminando contra una caja de 1m se queda moliendo
 * contra ella. Medido en el mapa "torre": 5.3s clavado contra una cobertura
 * baja de 1m, en Enfrentar, empujando a 5 m/s sin avanzar. Un strafe es un
 * paso lateral para buscar ángulo, no una escalada: se limita a lo que se
 * sube caminando.
 */
const STRAFE_MAX_STEP = 0.35

function canStrafeTowards(bot: BotState, world: BotWorld, dir: number): boolean {
  const s = Math.sin(bot.aimMotor.yaw)
  const c = Math.cos(bot.aimMotor.yaw)
  // Dirección de mundo del eje "derecha" local -- inversa de
  // worldToLocalAxes (que es su propia inversa, ver su comentario).
  const px = bot.player.position.x + c * dir * BOTS.engageStrafeProbeM
  const pz = bot.player.position.z - s * dir * BOTS.engageStrafeProbeM

  if (distanceXZ(px, pz, bot.strafeAnchor.x, bot.strafeAnchor.z) > BOTS.engageStrafeRadiusM) return false

  const cell = nearestWalkableCellIndex(world.grid, px, pz, 0)
  if (cell < 0) return false
  if (!world.reachable[cell]) return false
  const here = nearestWalkableCellIndex(world.grid, bot.player.position.x, bot.player.position.z, 0)
  if (here >= 0 && Math.abs(world.grid.heights[cell] - world.grid.heights[here]) > STRAFE_MAX_STEP) {
    return false
  }

  const coverHere = nearestCoverDistanceXZ(
    world.boxes,
    bot.player.position.x,
    bot.player.position.z,
    BOTS.coverMinHeightM,
  )
  const coverThere = nearestCoverDistanceXZ(world.boxes, px, pz, BOTS.coverMinHeightM)
  return coverThere <= coverHere + BOTS.engageStrafeCoverSlackM
}

/**
 * Mantiene el sentido del strafe de Enfrentar. Reportado por dos revisiones
 * distintas como lo más robótico del juego: en un duelo sostenido el bot se
 * planta y dispara, cosa que ningún jugador hace. Acá se decide el sentido
 * (el movimiento en sí lo aplica stepBotMotor, por el MISMO stepPlayer que
 * usa el jugador -- un bot no puede strafear más rápido que un humano).
 *
 * Invierte el sentido cuando el actual deja de ser válido (pared, desnivel,
 * o saldría de la cobertura) o cuando ya lo sostuvo BOTS.engageStrafeHoldS.
 * El sostén mínimo importa: sin él, un bot pegado a una esquina invierte
 * cada tick de IA y vibra, que se lee peor que quedarse quieto. Si ningún
 * lado sirve, el sentido queda en 0 y el bot dispara plantado -- estar
 * arrinconado contra cobertura es una razón legítima para no moverse.
 */
function updateEngageStrafe(bot: BotState, world: BotWorld, dt: number): void {
  bot.strafeHoldS += dt

  if (bot.strafeDir !== 0 && canStrafeTowards(bot, world, bot.strafeDir)) {
    if (bot.strafeHoldS < BOTS.engageStrafeHoldS) return
    bot.strafeHoldS = 0
    if (canStrafeTowards(bot, world, -bot.strafeDir)) bot.strafeDir = -bot.strafeDir
    return
  }

  bot.strafeHoldS = 0
  // Arranque y rebote: se prueba primero el sentido contrario al actual (o
  // el que dicta la fase del bot si venía en 0, para que dos bots que
  // entran en Enfrentar juntos no bailen espejados).
  const first = bot.strafeDir !== 0 ? -bot.strafeDir : bot.idlePhase >= 0 ? 1 : -1
  if (canStrafeTowards(bot, world, first)) {
    bot.strafeDir = first
    return
  }
  bot.strafeDir = canStrafeTowards(bot, world, -first) ? -first : 0
}

// ---------------------------------------------------------------------------
// Think: percepción + FSM + objetivos de apuntado/navegación. 15Hz por bot.
// ---------------------------------------------------------------------------

export function stepBotThink(bot: BotState, world: BotWorld, dt: number): void {
  if (!bot.health.alive) return

  const eyeX = botEyeX(bot)
  const eyeY = botEyeY(bot)
  const eyeZ = botEyeZ(bot)
  const eye: Vec3 = { x: eyeX, y: eyeY, z: eyeZ }

  const visible = canSee(
    world.raycastMap,
    eye,
    bot.aimMotor.yaw,
    world.targetEye,
    BOTS.visionRangeM,
    degToRad(BOTS.visionHalfAngleDeg),
  )

  if (visible) {
    if (!bot.wasVisible) bot.targetAwareTimeS = 0
    else bot.targetAwareTimeS += dt
    bot.timeSinceSeenS = 0
    bot.lastKnownTargetPos.x = world.targetEye.x
    bot.lastKnownTargetPos.y = world.targetEye.y
    bot.lastKnownTargetPos.z = world.targetEye.z
  } else {
    bot.timeSinceSeenS += dt
  }
  bot.wasVisible = visible

  let heardShotNow = false
  if (world.shots.time > bot.lastProcessedShotTime) {
    heardShotNow = canHear(eye, world.shots.position, BOTS.hearingRadiusM)
    bot.lastProcessedShotTime = world.shots.time
    if (heardShotNow) {
      bot.timeSinceHeardS = 0
      bot.lastHeardPos.x = world.shots.position.x
      bot.lastHeardPos.y = world.shots.position.y
      bot.lastHeardPos.z = world.shots.position.z
    }
  }
  if (!heardShotNow) bot.timeSinceHeardS += dt

  const prevState = bot.fsm.current
  const state = stepFsm(
    bot.fsm,
    {
      canSeeTarget: visible,
      timeSinceSeenS: bot.timeSinceSeenS,
      heardShot: heardShotNow,
      timeSinceHeardS: bot.timeSinceHeardS,
      healthFraction: healthFraction(bot.health),
    },
    FSM_TUNING,
    dt,
  )
  const justEntered = state !== prevState

  // Disciplina de ráfaga (BOTS.recoilDisciplineDeg, ver su comentario en
  // bots/tuning.ts): suelta el gatillo si el retroceso vertical YA
  // acumulado pasó el umbral, en vez de sostenerlo hasta vaciar el
  // cargador. `pitchOffset` es el mismo offset que combat/recoil.ts ya
  // aplica a la cámara -- 0 al empezar una ráfaga, crece con cada disparo,
  // y sólo se recupera (stepRecoilRecovery) mientras el gatillo está
  // suelto, así que este chequeo por sí solo ya produce ráfagas cortas con
  // pausas, sin ningún temporizador nuevo.
  const recoilTooHigh = radToDeg(bot.combat.recoil.pitchOffset) >= BOTS.recoilDisciplineDeg

  // Acorralado: en Retirarse, pero con el enemigo tan encima que huir es
  // peor que pelear (BOTS.retreatFightBackM). Retirarse nunca disparaba ni
  // apuntaba al objetivo -- el apuntado lo resolvía stepBotMotor mirando
  // hacia el camino de huida -- así que un bot herido con un enemigo a dos
  // metros se daba vuelta y moría de espaldas sin tirar un tiro. Es la otra
  // mitad de "no resuelven el cuerpo a cuerpo" de la captura.
  const acorralado =
    state === 'retreat' &&
    visible &&
    distanceXZ(bot.player.position.x, bot.player.position.z, world.targetEye.x, world.targetEye.z) <=
      BOTS.retreatFightBackM

  bot.combatInput.triggerHeld = (state === 'engage' || acorralado) && visible && !recoilTooHigh

  const errorRadius = currentErrorConeRadius(
    bot.difficulty.errorConeRad,
    bot.difficulty.reactionTimeS,
    bot.targetAwareTimeS,
  )

  if (
    state === 'engage' ||
    acorralado ||
    (state === 'reposition' && bot.timeSinceSeenS < BOTS.targetMemoryS)
  ) {
    lookAt(eyeX, eyeY, eyeZ, bot.lastKnownTargetPos.x, bot.lastKnownTargetPos.y, bot.lastKnownTargetPos.z, scratchLook)
    sampleErrorOffset(bot.aimBrain, errorRadius, scratchOffset)
    bot.aimTargetYaw = scratchLook.yaw + scratchOffset.yaw
    bot.aimTargetPitch = scratchLook.pitch + scratchOffset.pitch
  } else if (state === 'rotate') {
    lookAt(eyeX, eyeY, eyeZ, bot.lastHeardPos.x, bot.lastHeardPos.y, bot.lastHeardPos.z, scratchLook)
    bot.aimTargetYaw = scratchLook.yaw
    bot.aimTargetPitch = 0
  }
  // Idle/Retirarse: el objetivo de apuntado se resuelve en stepBotMotor
  // (escaneo lento en Idle, mirar hacia el camino en Retirarse) -- no
  // depende de percepción fresca, así que no hace falta recalcularlo acá.

  // Navegación: cada estado decide su propio objetivo de celda.
  switch (state) {
    case 'idle': {
      if (justEntered) {
        clearPath(bot)
        bot.idleBaseYaw = bot.aimMotor.yaw
        bot.investigatedLastActivity = false
        // El nodo bajo los pies cuenta como recién visitado: el primer
        // destino de patrulla nunca es el pedazo de suelo que ya pisa.
        bot.patrolNode = nearestPatrolNode(world.patrol, bot.player.position.x, bot.player.position.z)
      }
      if (hasArrivedAtGoal(bot)) pickIdleDestination(bot, world)
      break
    }
    case 'rotate': {
      const goalCell = nearestWalkableCellIndex(world.grid, bot.lastHeardPos.x, bot.lastHeardPos.z, 4, world.reachable)
      requestPathTo(bot, world, goalCell)
      break
    }
    case 'engage': {
      clearPath(bot)
      if (justEntered) {
        bot.strafeAnchor.x = bot.player.position.x
        bot.strafeAnchor.y = bot.player.position.y
        bot.strafeAnchor.z = bot.player.position.z
        bot.strafeHoldS = BOTS.engageStrafeHoldS
        bot.strafeDir = 0
      }
      updateEngageStrafe(bot, world, dt)
      break
    }
    case 'reposition': {
      if (justEntered || hasArrivedAtGoal(bot)) {
        const targetX = bot.lastKnownTargetPos.x
        const targetZ = bot.lastKnownTargetPos.z
        const targetY = bot.lastKnownTargetPos.y
        const goalCell = pickCandidateCell(bot, world, (x, y, z) => {
          const breaksLos = !hasLineOfSightBetween(world.raycastMap, x, y, z, targetX, targetY, targetZ)
          return (breaksLos ? 1000 : 0) - distanceXZ(x, z, bot.player.position.x, bot.player.position.z)
        })
        requestPathTo(bot, world, goalCell)
      }
      break
    }
    case 'retreat': {
      if (justEntered || hasArrivedAtGoal(bot)) {
        const targetX = bot.lastKnownTargetPos.x
        const targetZ = bot.lastKnownTargetPos.z
        const goalCell = pickCandidateCell(
          bot,
          world,
          (x, _y, z) =>
            distanceXZ(x, z, targetX, targetZ) -
            distanceXZ(x, z, bot.player.position.x, bot.player.position.z) * 0.1,
        )
        requestPathTo(bot, world, goalCell)
      }
      break
    }
  }
}

/** Línea de vista directa entre dos puntos del mundo, ignorando cono --
 *  usada por reposition para puntuar candidatos (¿este punto rompe la línea
 *  de vista hacia el objetivo?), no por la percepción del bot en sí. */
function hasLineOfSightBetween(
  raycastMap: RaycastMapFn,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const origin: Vec3 = { x: ax, y: ay, z: az }
  const target: Vec3 = { x: bx, y: by, z: bz }
  return canSee(raycastMap, origin, 0, target, Infinity, Math.PI)
}

/** Escalona el tick de IA entre bots: cada uno acumula su propio dt y sólo
 *  "piensa" cuando cruza el intervalo de BOTS.aiTickHz -- nunca los 15Hz de
 *  todos caen en el mismo frame de render. */
export function stepAllBotsThink(bots: BotState[], world: BotWorld, dt: number): void {
  const interval = 1 / BOTS.aiTickHz
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i]
    bot.aiAccumulator += dt
    while (bot.aiAccumulator >= interval) {
      bot.aiAccumulator -= interval
      stepBotThink(bot, world, interval)
    }
  }
}

// ---------------------------------------------------------------------------
// Motor: apuntado + steering + física + combate. Cada tick de simulación.
// ---------------------------------------------------------------------------

/** Radio de llegada a un waypoint, metros -- un poco más que medio ancho de
 *  celda (BOTS.navCellSize=1.0), así el bot no "orbita" el centro exacto de
 *  la celda por error de redondeo del steering. */
const ARRIVE_RADIUS = 0.75

interface SteerResult {
  /** true si hay un waypoint hacia el que avanzar este tick. Si es false,
   *  worldX/worldZ/desiredYaw/wantsJump no tienen sentido y el llamador no
   *  debe leerlos. */
  moving: boolean
  /** Dirección deseada en mundo, unitaria (XZ). */
  worldX: number
  worldZ: number
  /** Rumbo en mundo (radianes, misma convención que aim.ts lookAt) hacia el
   *  waypoint. Lo usa Retirarse para mirar hacia donde corre en vez de hacia
   *  el objetivo -- ver stepBotMotor. */
  desiredYaw: number
  wantsJump: boolean
}

const STEER_STOPPED: SteerResult = { moving: false, worldX: 0, worldZ: 0, desiredYaw: 0, wantsJump: false }

/**
 * Decide hacia dónde quiere avanzar el bot este tick, en espacio de MUNDO
 * (no todavía en forward/right locales: eso depende del yaw final del
 * apuntado de este tick, que stepBotMotor recién resuelve después de llamar
 * a esta función -- ver su comentario de cabecera).
 */
function steerAlongPath(bot: BotState, world: BotWorld): SteerResult {
  if (bot.pathIndex >= bot.path.length) return STEER_STOPPED

  const { grid } = world
  let cellIdx = bot.path[bot.pathIndex]
  let wx = cellCenterX(grid, cellCol(grid, cellIdx))
  let wz = cellCenterZ(grid, cellRow(grid, cellIdx))
  let dist = distanceXZ(bot.player.position.x, bot.player.position.z, wx, wz)

  while (dist < ARRIVE_RADIUS && bot.pathIndex < bot.path.length - 1) {
    bot.pathIndex++
    cellIdx = bot.path[bot.pathIndex]
    wx = cellCenterX(grid, cellCol(grid, cellIdx))
    wz = cellCenterZ(grid, cellRow(grid, cellIdx))
    dist = distanceXZ(bot.player.position.x, bot.player.position.z, wx, wz)
  }

  if (dist < ARRIVE_RADIUS) {
    bot.pathIndex = bot.path.length
    return STEER_STOPPED
  }

  const worldX = (wx - bot.player.position.x) / dist
  const worldZ = (wz - bot.player.position.z) / dist
  // Rumbo en mundo hacia el waypoint, misma fórmula que aim.ts lookAt (yaw
  // 0 mira hacia -Z).
  const desiredYaw = Math.atan2(-worldX, -worldZ)

  const currentHeight = grid.heights[cellIdx]
  const startCol = Math.floor((bot.player.position.x - grid.minX) / grid.cellSize)
  const startRow = Math.floor((bot.player.position.z - grid.minZ) / grid.cellSize)
  const startIdx = startRow >= 0 && startRow < grid.rows && startCol >= 0 && startCol < grid.cols
    ? startRow * grid.cols + startCol
    : -1
  const startHeight = startIdx >= 0 ? grid.heights[startIdx] : currentHeight
  const wantsJump = currentHeight - startHeight > 0.15

  return { moving: true, worldX, worldZ, desiredYaw, wantsJump }
}

/** Rota una dirección deseada en mundo (worldX,worldZ, unitaria) a ejes
 *  forward/right LOCALES del yaw de "cámara" dado -- inversa exacta de
 *  computeWishDir (movement/step.ts). Se aplica con el yaw ya actualizado
 *  de este tick (después de stepAimTowards en stepBotMotor), para que
 *  forward/right e input.yaw describan la misma dirección de mundo: si se
 *  usara el yaw viejo, un giro rápido del apuntado (Retirarse, que gira
 *  hacia el rumbo de huida) dejaría un tick con forward/right apuntando a
 *  un mundo distinto del que describe input.yaw. */
function worldToLocalAxes(worldX: number, worldZ: number, yaw: number): { forward: number; right: number } {
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  return {
    right: c * worldX - s * worldZ,
    forward: -s * worldX - c * worldZ,
  }
}

/**
 * Sincroniza las hitboxes del bot con su posición y estado de vida actuales.
 * Torso y cabeza son Vec3 propios (bot.torsoCenter/headCenter), desplazados
 * en Y desde bot.player.position (la BASE de la cápsula, no su centro --
 * physics/capsule.ts), que hay que resincronizar a mano cada tick -- mismo
 * patrón que targets/targets.ts stepTargets(). Radio 0 en vez de sacar la
 * hitbox del array cuando está muerto (mismo motivo que las dianas: el
 * array de hitboxes combinado que arma game.ts tiene longitud fija).
 */
function syncBotHitboxes(bot: BotState): void {
  const [torso, head, legs] = bot.hitboxes
  bot.torsoCenter.x = bot.player.position.x
  bot.torsoCenter.y = bot.player.position.y + BOTS.torsoOffsetY
  bot.torsoCenter.z = bot.player.position.z
  bot.headCenter.x = bot.player.position.x
  bot.headCenter.y = bot.player.position.y + BOTS.headOffsetY
  bot.headCenter.z = bot.player.position.z
  bot.legsCenter.x = bot.player.position.x
  bot.legsCenter.y = bot.player.position.y + BOTS.legsOffsetY
  bot.legsCenter.z = bot.player.position.z

  torso.radius = bot.health.alive ? BOTS.torsoRadius : 0
  head.radius = bot.health.alive ? BOTS.headRadius : 0
  legs.radius = bot.health.alive ? BOTS.legsRadius : 0
}

export function stepBotMotor(bot: BotState, world: BotWorld, dt: number): void {
  if (!bot.health.alive) {
    const revived = stepBotRespawn(bot.health, dt)
    if (revived) {
      bot.player.position.x = bot.spawn.x
      bot.player.position.y = bot.spawn.y
      bot.player.position.z = bot.spawn.z
      bot.player.prevPosition.x = bot.spawn.x
      bot.player.prevPosition.y = bot.spawn.y
      bot.player.prevPosition.z = bot.spawn.z
      bot.player.velocity.x = 0
      bot.player.velocity.y = 0
      bot.player.velocity.z = 0
      bot.fsm.current = 'idle'
      bot.fsm.timeInState = 0
      clearPath(bot)
      bot.wasVisible = false
      bot.timeSinceSeenS = Infinity
      bot.timeSinceHeardS = Infinity
      // Reaparece en el spawn: la patrulla vieja (elegida desde donde murió)
      // ya no tiene sentido, y no hay actividad conocida que investigar
      // todavía -- las dos memorias acaban de quedar en Infinity.
      bot.patrolNode = -1
      bot.investigatedLastActivity = false
      bot.strafeDir = 0
      bot.strafeHoldS = 0
    }
    bot.input.forward = 0
    bot.input.right = 0
    bot.input.jump = false
    bot.input.sprint = false
    bot.combatInput.triggerHeld = false
    // Si murió a mitad de una recarga, no debe reaparecer todavía
    // "recargando" -- resetCombatState (damageBot, más abajo) ya rellenó el
    // cargador al morir, así que el temporizador quedaría sin sentido.
    bot.combatInput.reloading = false
    bot.reloadTimerS = 0
    syncBotHitboxes(bot)
    return
  }

  // steerAlongPath() se calcula ANTES de mover el apuntado: Retirarse mira
  // hacia donde corre (huir mirando para atrás sería absurdo), y el
  // objetivo de apuntado de Retirarse no lo fija stepBotThink (ver el
  // comentario ahí) -- se resuelve acá, con el rumbo real del steering de
  // este mismo tick, no el del tick anterior.
  const steer = steerAlongPath(bot, world)
  if (bot.fsm.current === 'retreat' && steer.moving) {
    bot.aimTargetYaw = steer.desiredYaw
    bot.aimTargetPitch = 0
  }

  // Idle: barrido lento AL REDEDOR DEL RUMBO DE PATRULLA cuando se está
  // moviendo (mirar hacia donde uno camina, barriendo a los costados en
  // busca de contacto), o alrededor del último rumbo cuando no hay camino.
  // El barrido sigue existiendo -- lo que cambió es que ya no es lo ÚNICO
  // que hace Idle. Un bot que patrulla mirando fijo al frente tiene un cono
  // de 110° y se pierde todo lo que pasa a los lados del pasillo.
  if (bot.fsm.current === 'idle') {
    if (steer.moving) bot.idleBaseYaw = steer.desiredYaw
    bot.aimTargetYaw = bot.idleBaseYaw + Math.sin(world.simTimeS * 0.5 + bot.idlePhase) * degToRad(40)
    bot.aimTargetPitch = 0
  }

  stepAimTowards(
    bot.aimMotor,
    bot.aimTargetYaw,
    bot.aimTargetPitch,
    degToRad(BOTS.aimMaxAngularSpeedDegPerSec),
    dt,
  )

  // Recién ACÁ, con el yaw ya actualizado de este tick, se rota la dirección
  // deseada de mundo a ejes locales -- ver el comentario de cabecera de
  // worldToLocalAxes sobre por qué el orden importa.
  const axes = steer.moving
    ? worldToLocalAxes(steer.worldX, steer.worldZ, bot.aimMotor.yaw)
    : { forward: 0, right: 0 }

  const strafing = bot.fsm.current === 'engage' && bot.strafeDir !== 0
  // Enfrentar no sigue ningún camino (clearPath en stepBotThink): su
  // movimiento es puro lateral en ejes LOCALES, o sea exactamente las teclas
  // A/D del jugador con la mira puesta en el objetivo. Mismo stepPlayer,
  // misma velocidad de caminata, sin sprint -- un bot no se desliza más
  // rápido que un humano.
  bot.input.forward = strafing ? 0 : axes.forward
  bot.input.right = strafing ? bot.strafeDir : axes.right
  bot.input.yaw = bot.aimMotor.yaw
  bot.input.sprint = steer.moving && !strafing
  bot.input.crouch = false

  const horizontalSpeed = Math.hypot(bot.player.velocity.x, bot.player.velocity.z)
  if (steer.moving && horizontalSpeed < BOTS.stuckSpeedThreshold) {
    bot.stuckTimeS += dt
  } else {
    bot.stuckTimeS = 0
  }

  bot.input.jump = (steer.moving && steer.wantsJump) || bot.stuckTimeS > BOTS.stuckTimeS

  stepPlayer(bot.player, bot.input, world.boxes, dt, world.convexes)

  bot.combatInput.origin.x = bot.player.position.x
  bot.combatInput.origin.y = bot.player.position.y + bot.player.eyeHeight
  bot.combatInput.origin.z = bot.player.position.z
  bot.combatInput.pitch = bot.aimMotor.pitch
  bot.combatInput.yaw = bot.aimMotor.yaw

  syncBotHitboxes(bot)
}

/**
 * Corre el paso de combate del bot (cadencia + retroceso + dispersión +
 * hitscan, el mismo stepCombat que el jugador) contra `targetHitboxes`
 * (típicamente las hitboxes del jugador). Separado de stepBotMotor porque
 * necesita el array de hitboxes del objetivo, que vive en game.ts, no en
 * BotWorld (BotWorld es sobre el MUNDO -- mapa, navgrid --, no sobre a quién
 * le puede pegar un disparo).
 *
 * Recarga automática: el jugador dispara la suya apretando R, ligada a la
 * animación del viewmodel (weapons/viewmodel/rig.ts); un bot no tiene
 * viewmodel ni tecla, así que dispara la suya sola apenas se queda sin
 * munición, con un temporizador simple (`reloadTimerS`, archetype.reload.empty
 * segundos) en vez de una animación. Bug real encontrado jugando una
 * partida de 6 minutos completa (tarea de partida): sin esto, cualquier bot
 * que vacía su cargador en un tiroteo sostenido queda desarmado el resto de
 * la partida entera -- combatInput.reloading nunca se pone en `true`,
 * stepFireControl nunca vuelve a disparar, y el bot sigue "Enfrentar"
 * apuntando sin poder hacer nada. Con partidas largas y varios bots
 * disparando en simultáneo, esto vacía la partida de acción con el correr
 * de los minutos según más bots se quedan sin balas. `syncReloadState`
 * (adentro de `stepCombat`, más abajo) es quien detecta el flanco
 * `reloading` true->false y rellena el cargador -- mismo mecanismo que ya
 * usa el jugador, no uno nuevo.
 */
export function stepBotCombat(bot: BotState, targetHitboxes: Hitbox[], dt: number): number {
  if (!bot.health.alive) return 0

  if (bot.combatInput.reloading) {
    bot.reloadTimerS -= dt
    if (bot.reloadTimerS <= 0) bot.combatInput.reloading = false
  } else if (bot.combat.fireControl.ammo <= 0) {
    bot.combatInput.reloading = true
    bot.reloadTimerS = bot.archetype.reload.empty
  }

  return stepCombat(bot.combat, bot.archetype, bot.combatInput, targetHitboxes, dt, bot.shotResult)
}

/** Aplica daño a un bot (impacto del jugador). Devuelve true si lo mató.
 *  Resetea también el estado de combate del bot al morir, igual que un arma
 *  recién equipada -- para que al revivir no arrastre retroceso/dispersión
 *  acumulados de la vida anterior. */
export function damageBot(bot: BotState, damage: number): boolean {
  const killed = applyDamageToBot(bot.health, damage)
  if (killed) resetCombatState(bot.combat, bot.archetype)
  return killed
}

export function stepAllBotsMotor(bots: BotState[], world: BotWorld, dt: number): void {
  for (let i = 0; i < bots.length; i++) stepBotMotor(bots[i], world, dt)
}

export type { BotStateName }
