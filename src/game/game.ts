import { sanitizeDt } from '@/game/engine/dt'
import { TICK_DT } from '@/game/engine/constants'
import { createFixedLoop } from '@/game/engine/fixed-loop'
import { createGpuTimer } from '@/game/engine/gpu-timer'
import { createInputSystem } from '@/game/engine/input'
import { createRenderer, WORLD_FOV } from '@/game/engine/renderer'
import { createStatsTracker, runBenchmark } from '@/game/engine/stats'
import type { FrameStats } from '@/game/engine/stats'
import { createTuningPanel } from '@/game/engine/tuning-panel'
import { ARENA } from '@/game/map/arena'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import {
  createBotWorld,
  damageBot,
  registerGunshot,
  stepAllBotsMotor,
  stepBotCombat,
  type BotState,
} from '@/game/bots/bot'
import { applyDamageToBot, createBotHealthState, stepBotRespawn } from '@/game/bots/health'
import { buildNavGrid } from '@/game/bots/navgrid'
import { createBotsRenderer } from '@/game/bots/renderer'
import { BOTS } from '@/game/bots/tuning'
import { raycastMap } from '@/game/combat/hitscan'
import type { Hitbox } from '@/game/combat/hitboxes'
import { ARCHETYPES, type ArchetypeId } from '@/game/weapons/archetypes'
import { getWeaponVisual, weaponIndex } from '@/game/weapons/registry'
import { createRigWeapon, syncRigWeapon } from '@/game/weapons/viewmodel/adapt'
import { createViewmodelRenderer } from '@/game/weapons/viewmodel/renderer'
import {
  createViewmodelState,
  easeInOutCubic,
  fire,
  startDraw,
  startReload,
  stepViewmodel,
  type ViewmodelInput,
} from '@/game/weapons/viewmodel/rig'
import type { VmTransform } from '@/game/weapons/viewmodel/types'
import {
  createWeaponTuningPanel,
  debugModeEnabled,
  loadWeaponTuningOverrides,
} from '@/game/weapons/viewmodel/tuning-panel'
import { adsFov, adsSensitivityMultiplier, adsSpeedMultiplier } from '@/game/combat/ads'
import {
  cameraPitch,
  cameraYaw,
  createCombatState,
  resetCombatState,
  stepCombat,
  type CombatInput,
} from '@/game/combat/combat'
import { computeForward, createShotResult } from '@/game/combat/shot'
import { vec3, type Vec3 } from '@/game/math/vec3'
import type { ScreenPoint } from '@/game/engine/renderer'
import { applyHit, createDefaultTargetDefs, createTargets, stepTargets } from '@/game/targets/targets'
import { createTargetsRenderer } from '@/game/targets/renderer'
import { createFeedbackAudio } from '@/game/feedback/audio'
import { createFeedbackOverlay } from '@/game/feedback/overlay'
import {
  createFeedbackState,
  onDamageTaken,
  onHitConfirmed,
  onShotFired,
  stepFeedback,
} from '@/game/feedback/feedback'
import { directionYaw, vignetteBearing } from '@/game/feedback/vignette'
import { resetPlayerHealth } from '@/game/feedback/health-vfx'
import { FEEDBACK } from '@/game/feedback/tuning'
import { assignBotArchetypes, weaponLabel } from '@/game/match/loadouts'
import { createMatchState, recordDamage, recordKill, stepMatch, type MatchState } from '@/game/match/match'
import { invulnerabilityExpiresAt, isInvulnerable, pickFarthestSpawn } from '@/game/match/respawn'
import { createMatchBots, stepMatchBotsThink } from '@/game/match/squad'
import { createMatchTargets, type MatchTargets } from '@/game/match/targeting'
import { MATCH } from '@/game/match/tuning'
import { createMatchTuningPanel } from '@/game/match/tuning-panel'
import { isEnemy, PLAYER_ID, type MatchMode } from '@/game/match/types'

export interface Game {
  start(): void
  stop(): void
  /**
   * Costo en CPU de encolar `passes` llamadas a render(), sin esperar a que
   * la GPU termine de dibujar. Es una cota inferior del costo real de
   * frame, no una medida de capacidad o margen disponible.
   */
  benchmark(passes?: number): number
  readonly stats: FrameStats
  /** Estado de partida en vivo (sección "Build" de la tarea): killfeed,
   *  puntaje y fase, para que el HUD de React (src/ui/) lo sondee a baja
   *  frecuencia -- referencia mutable, no una copia; quien la lee no debe
   *  escribirla. */
  readonly matchState: MatchState
}

const SENSITIVITY = 0.0022

/** Cuántos bots poblar la arena, vía `?bots=N` (mismo patrón que
 *  `?debug=1` en weapons/viewmodel/tuning-panel.ts). Default MATCH.botCount
 *  (match/tuning.ts) -- vive ahí, no acá, para que el panel de tuning de
 *  partida (match/tuning-panel.ts) pueda ajustarlo sin recompilar.
 *  Clampeado a [0,20] contra un valor absurdo en la URL. */
const MAX_BOT_COUNT = 20

function getBotCount(): number {
  const raw = new URLSearchParams(window.location.search).get('bots')
  if (raw === null) return MATCH.botCount
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return MATCH.botCount
  return Math.max(0, Math.min(MAX_BOT_COUNT, n))
}

/** Override explícito de dificultad 0..1 (bots/difficulty.ts) vía
 *  `?difficulty=`, para todos los bots por igual -- gana sobre
 *  MATCH.difficultyMode ('uniform'/'mixed', ver resolveDifficultyRanks más
 *  abajo). `null` si no vino en la URL: no hay todavía un rango de jugador
 *  real del que derivarlo (sección 9 del spec, fase 4), así que el punto
 *  medio por defecto vive en MATCH.uniformDifficultyRank, no acá. */
function getDifficultyOverride(): number | null {
  const raw = new URLSearchParams(window.location.search).get('difficulty')
  if (raw === null) return null
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1, n))
}

/** Un rango de dificultad por bot: el override explícito de la URL gana
 *  sobre MATCH.difficultyMode si está presente. 'uniform': todos el mismo
 *  MATCH.uniformDifficultyRank. 'mixed': reparte cíclicamente
 *  MATCH.mixedDifficultyRanks (sección "Pacing" de la tarea: variar la
 *  dificultad dentro de la misma partida, no sólo entre partidas). */
function resolveDifficultyRanks(count: number): number[] {
  const override = getDifficultyOverride()
  if (override !== null) return new Array(count).fill(override) as number[]
  if (MATCH.difficultyMode === 'uniform') return new Array(count).fill(MATCH.uniformDifficultyRank) as number[]
  const pool = MATCH.mixedDifficultyRanks.length > 0 ? MATCH.mixedDifficultyRanks : [MATCH.uniformDifficultyRank]
  const ranks: number[] = []
  for (let i = 0; i < count; i++) ranks.push(pool[i % pool.length])
  return ranks
}

/** Modo de partida vía `?mode=tdm|ffa`, default MATCH.defaultMode. */
function getMatchMode(): MatchMode {
  const raw = new URLSearchParams(window.location.search).get('mode')
  return raw === 'tdm' || raw === 'ffa' ? raw : MATCH.defaultMode
}

/** Overrides de verificación rápida (sección "Verify" de la tarea: una
 *  partida real dura ~6 minutos, demasiado para iterar en cada corrida de
 *  QA) -- `?timeLimit=SEGUNDOS` y `?scoreLimit=N` pisan MATCH antes de
 *  arrancar la partida. Mutan el objeto MATCH compartido a propósito (no
 *  una copia local): así el panel de tuning en vivo sigue leyendo/editando
 *  la misma fuente de verdad sea cual sea el origen del valor inicial. */
function applyQuickMatchOverrides(): void {
  const params = new URLSearchParams(window.location.search)
  const timeLimitRaw = params.get('timeLimit')
  if (timeLimitRaw !== null) {
    const n = Number.parseFloat(timeLimitRaw)
    if (Number.isFinite(n) && n > 0) MATCH.timeLimitS = n
  }
  const scoreLimitRaw = params.get('scoreLimit')
  if (scoreLimitRaw !== null) {
    const n = Number.parseInt(scoreLimitRaw, 10)
    if (Number.isFinite(n) && n > 0) {
      MATCH.scoreLimitFfa = n
      MATCH.scoreLimitTdm = n
    }
  }
}

export function createGame(canvas: HTMLCanvasElement): Game {
  const gfx = createRenderer(canvas)
  const viewmodel = createViewmodelRenderer(gfx.renderer)
  const stats = createStatsTracker()
  const gpuTimer = createGpuTimer(gfx.gl)
  const tuning = createTuningPanel()
  const matchTuningPanel = createMatchTuningPanel()
  const loop = createFixedLoop()
  const player = createPlayerState(ARENA.spawns[0])

  applyQuickMatchOverrides()

  // Dianas de la arena (sección 6 del spec de fase 1): hitboxes reales,
  // estáticas y móviles, que stepCombat() consume tal cual consumía la
  // lista vacía que había acá antes -- el sistema de combate no cambia,
  // sólo deja de recibir un array vacío. No participan del puntaje de
  // partida -- son sólo para plinkear fuera del combate real.
  const targetsState = createTargets(createDefaultTargetDefs())
  const targetsRenderer = createTargetsRenderer(gfx.scene, targetsState)

  // Partida (sección "Build" de la tarea, segunda mitad de la fase 2): TDM
  // o FFA, elegido por `?mode=` (default MATCH.defaultMode). Loadout y
  // dificultad por bot en vez de un único arquetipo/rango compartido (ver
  // match/loadouts.ts y resolveDifficultyRanks más arriba) -- "todos con el
  // mismo rifle" es justo lo que pide evitar la tarea.
  const matchMode = getMatchMode()
  const botCount = getBotCount()
  const botArchetypes = assignBotArchetypes(botCount)
  const botDifficultyRanks = resolveDifficultyRanks(botCount)
  // spawns.slice(1): el jugador ya ocupa spawns[0] (arriba). No es
  // obligatorio (la física resuelve cualquier superposición inicial), pero
  // evita que todo el escuadrón aparezca encima del jugador al arrancar.
  const bots: BotState[] = createMatchBots(ARENA.spawns.slice(1), botArchetypes, botDifficultyRanks)

  // Navgrid horneado UNA vez desde la arena real -- nunca se recalcula en
  // frame().
  const botGrid = buildNavGrid(ARENA)
  const botWorld = createBotWorld(ARENA.boxes, raycastMap, botGrid)
  const botsRenderer = createBotsRenderer(gfx.scene, bots)

  // Participantes de la partida: 0 = jugador (PLAYER_ID), 1..N = bots por
  // índice+1 (match/types.ts). El jugador reusa bots/health.ts tal cual --
  // es matemática de vida/respawn genérica, no específica de bots, pese al
  // nombre del módulo (ver el comentario de MATCH.respawnDelayS sobre por
  // qué no se tocó ese archivo para renombrarlo). Se mantiene SEPARADO de
  // feedbackState.health (feedback/health-vfx.ts, sólo visual: latido y
  // desaturación) a propósito -- ese módulo no tiene noción de muerte, y no
  // hace falta tocarlo para dársela: cada golpe resta a ambos por el mismo
  // monto, y el respawn resetea ambos, así que quedan sincronizados sin
  // fusionarlos.
  const participantCount = 1 + bots.length
  const playerHealth = createBotHealthState(BOTS.maxHealth)
  const matchState: MatchState = createMatchState(matchMode, participantCount, MATCH)
  const matchTargets: MatchTargets = createMatchTargets(matchMode, participantCount)
  const invulnerableUntilS: number[] = new Array(participantCount).fill(-Infinity) as number[]
  const botWasAlive: boolean[] = new Array(bots.length).fill(true) as boolean[]
  // Scratch de posiciones enemigas para pickFarthestSpawn (match/respawn.ts):
  // tamaño máximo (participantCount - 1), reusado cada tick sin reasignar
  // -- ver fillEnemyPositions más abajo.
  const enemyPositionsScratch: Vec3[] = []
  for (let i = 0; i < participantCount; i++) enemyPositionsScratch.push(vec3())

  /** Llena enemyPositionsScratch con las posiciones vivas y enemigas de
   *  `selfId`, devuelve cuántas entradas son válidas. Cero asignaciones. */
  function fillEnemyPositions(selfId: number): number {
    let count = 0
    for (let id = 0; id < participantCount; id++) {
      if (id === selfId) continue
      if (!matchTargets.alive[id]) continue
      if (!isEnemy(matchMode, selfId, id)) continue
      const p = matchTargets.positions[id]
      const slot = enemyPositionsScratch[count]
      slot.x = p.x
      slot.y = p.y
      slot.z = p.z
      count++
    }
    return count
  }

  // Hitboxes del JUGADOR (torso + cabeza, mismo tamaño y misma altura que
  // los bots -- misma cápsula, PLAYER_CAPSULE, y mismos offsets
  // BOTS.torsoOffsetY/headOffsetY -- "mismas reglas para todos", sección 8
  // del spec). Ninguna de las dos comparte Vec3 con player.position
  // directamente (que es la BASE de la cápsula, no el torso): ambas son
  // puntos propios que frame() resincroniza cada frame más abajo, mismo
  // patrón que bots/bot.ts syncBotHitboxes.
  const playerTorsoHitboxPos = vec3()
  const playerHeadHitboxPos = vec3()
  const playerHitboxes: Hitbox[] = [
    { center: playerTorsoHitboxPos, radius: BOTS.torsoRadius, part: 'torso', owner: 0 },
    { center: playerHeadHitboxPos, radius: BOTS.headRadius, part: 'head', owner: 0 },
  ]

  // Owners de combatientes: targetCount + participantId (match/types.ts),
  // mismo truco de offset que ya separaba dianas de bots antes de esta
  // tarea, extendido para separar también al jugador de las dianas.
  const targetCount = targetsState.targets.length
  playerHitboxes[0].owner = targetCount + PLAYER_ID
  playerHitboxes[1].owner = targetCount + PLAYER_ID
  bots.forEach((bot, i) => {
    bot.hitboxes[0].owner = targetCount + (i + 1)
    bot.hitboxes[1].owner = targetCount + (i + 1)
  })

  const allCombatantHitboxes: Hitbox[] = [playerHitboxes[0], playerHitboxes[1]]
  for (const bot of bots) allCombatantHitboxes.push(bot.hitboxes[0], bot.hitboxes[1])

  // Lista de hitboxes ENEMIGAS por participante, construida UNA vez acá
  // (referencias reusadas cada frame, cero asignaciones en frame()): en TDM
  // un disparo nunca puede resolver contra un compañero de equipo porque
  // sus hitboxes ni siquiera están en la lista que ese participante usa
  // para disparar (ver stepBotCombat/stepCombat más abajo).
  const enemyHitboxesFor: Hitbox[][] = []
  for (let id = 0; id < participantCount; id++) {
    enemyHitboxesFor.push(allCombatantHitboxes.filter((hb) => isEnemy(matchMode, id, hb.owner - targetCount)))
  }

  // El jugador además puede pegarle a las dianas de práctica (targets/,
  // fase 1) -- no participan del puntaje, sólo están para plinkear.
  const playerShotHitboxes: Hitbox[] = [...targetsState.hitboxes, ...enemyHitboxesFor[PLAYER_ID]]

  // Sistema de feedback (sección 5 del spec de fase 1): un solo estado
  // preasignado, una capa de DOM imperativo para pintarlo y un controlador
  // de audio aparte (Web Audio real, no cabe en un estado puro). Ver
  // feedback/feedback.ts para por qué el audio queda afuera del estado.
  const feedbackState = createFeedbackState()
  const feedbackOverlay = createFeedbackOverlay()
  const feedbackAudio = createFeedbackAudio()

  // Scratch preasignado para proyectar el punto de impacto a pantalla
  // (sección 5: número de daño flotante en el punto de impacto). Nunca se
  // reasigna, sólo se muta dentro de frame().
  const scratchForward = vec3()
  const scratchHitPoint = vec3()
  const scratchScreenPoint: ScreenPoint = { x: 0, y: 0, visible: false }

  // Multiplicador de sensibilidad por ADS (sección 4 del spec de fase 1):
  // se lee en vivo desde el callback de createInputSystem, así que tiene
  // que existir antes de esa llamada. frame() lo actualiza cada frame con
  // el valor interpolado de combat/ads.ts.
  let sensMultiplier = 1
  const input = createInputSystem(() => SENSITIVITY * sensMultiplier)

  // Estado del viewmodel: todo preasignado una sola vez acá. El frame loop
  // sólo muta estos objetos, nunca crea uno nuevo (presupuesto de cero
  // asignaciones, sección 2 del spec).
  const vmState = createViewmodelState()
  const vmInput: ViewmodelInput = {
    speed: 0, grounded: false, ads: false, mouseDeltaX: 0, mouseDeltaY: 0,
  }
  const vmOut: VmTransform = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }
  const rigWeapon = createRigWeapon()

  // Estado de combate: preasignado una vez, igual que el viewmodel (sección
  // 1 del spec de fase 1: "cero asignaciones por disparo"). El arquetipo
  // inicial es un valor de arranque cualquiera — combatArchetypeId empieza
  // en null, así que el primer frame con un arma realmente cargada lo
  // resetea a los datos correctos de esa arma (ver frame() más abajo).
  const combatState = createCombatState(ARCHETYPES['ar-1'])
  let combatArchetypeId: ArchetypeId | null = null
  const combatInput: CombatInput = {
    triggerHeld: false,
    reloading: false,
    // Referencia directa a la posición de la cámara del mundo (mutada in
    // place cada frame más abajo, nunca reasignada): el disparo sale desde
    // la cámara, no desde la boca del arma (sección 1 del spec), así que no
    // hace falta copiar nada acá.
    origin: gfx.camera.position,
    pitch: 0,
    yaw: 0,
  }
  const shotResult = createShotResult()

  const firstSlug = weaponIndex()[0]?.slug ?? null
  let currentSlug = firstSlug
  if (currentSlug) viewmodel.setWeaponSlug(currentSlug)

  // El botón derecho del panel de tuning sostiene ADS como acción de prueba
  // (sección 6.4 del spec); el botón izquierdo sostiene disparo (fase 1),
  // para poder probar auto/ráfaga sin necesitar pointer lock. Se combinan
  // con OR contra el input real más abajo — cualquiera de los dos alcanza.
  let debugAdsHeld = false
  let debugFireHeld = false

  const weaponTuning = debugModeEnabled()
    ? createWeaponTuningPanel({
        initialSlug: currentSlug ?? '',
        onSelectWeapon(slug: string): void {
          currentSlug = slug
          viewmodel.setWeaponSlug(slug)
          startDraw(vmState, rigWeapon)
        },
        setFireHeld(held: boolean): void {
          debugFireHeld = held
        },
        onReload(): void {
          startReload(vmState, rigWeapon)
        },
        setAds(held: boolean): void {
          debugAdsHeld = held
        },
      })
    : null

  let running = false
  let lastTime = 0
  let rafId = 0

  // Aviso en pantalla del último load de arma fallido (ver
  // ViewmodelRenderer.lastLoadError, weapons/viewmodel/renderer.ts): sin
  // esto, un 404 o un GLB corrupto sólo deja rastro en la consola. Se
  // actualiza sólo cuando el mensaje cambia, no crea ni toca el DOM cada
  // frame si no hay nada nuevo que mostrar.
  let weaponErrorBanner: HTMLDivElement | null = null
  let shownLoadError: string | null = null

  function updateWeaponErrorBanner(): void {
    const message = viewmodel.lastLoadError
    if (message === shownLoadError) return
    shownLoadError = message

    if (message === null) {
      weaponErrorBanner?.remove()
      weaponErrorBanner = null
      return
    }

    if (!weaponErrorBanner && canvas.parentElement) {
      weaponErrorBanner = document.createElement('div')
      weaponErrorBanner.style.cssText =
        'position:absolute;bottom:8px;left:8px;z-index:25;max-width:60vw;' +
        'font:12px ui-monospace,monospace;color:#ffb4b4;' +
        'background:rgba(40,0,0,.85);padding:8px 10px;border-radius:4px'
      canvas.parentElement.appendChild(weaponErrorBanner)
    }
    if (weaponErrorBanner) weaponErrorBanner.textContent = message
  }

  // Pérdida de contexto WebGL (reset de GPU, cambio de GPU en una laptop
  // híbrida, driver que se cae): sin manejarla, requestAnimationFrame sigue
  // llamando a frame() para siempre, stepPlayer() sigue simulando físicas
  // que nadie ve, y el canvas queda en negro sin ningún aviso. onLost frena
  // el loop entero y muestra un mensaje; no se intenta reconstruir la
  // escena en onRestored (texturas, buffers y programs quedan inválidos
  // tras la pérdida: recrearlos en caliente es una feature aparte, no un
  // fix de QA) — hace falta recargar para volver a jugar.
  let contextLostOverlay: HTMLDivElement | null = null

  function showContextLostOverlay(message: string): void {
    if (!canvas.parentElement) return
    if (!contextLostOverlay) {
      contextLostOverlay = document.createElement('div')
      contextLostOverlay.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'text-align:center;padding:32px;z-index:40;' +
        'font:14px/1.5 ui-monospace,monospace;color:#e6e8ec;background:rgba(5,7,11,.92)'
      canvas.parentElement.appendChild(contextLostOverlay)
    }
    contextLostOverlay.textContent = message
  }

  function hideContextLostOverlay(): void {
    contextLostOverlay?.remove()
    contextLostOverlay = null
  }

  function onContextLost(e: Event): void {
    // preventDefault() le dice al navegador que este código quiere
    // manejar la pérdida (y habilita 'webglcontextrestored' más adelante).
    // WebGLRenderer ya registra su propio listener que hace lo mismo; esto
    // es defensivo, no depende de ese detalle interno de Three.
    e.preventDefault()
    console.error('game: contexto WebGL perdido, deteniendo el loop')
    running = false
    cancelAnimationFrame(rafId)
    showContextLostOverlay(
      'Se perdió el contexto gráfico (WebGL). Recargá la página para seguir jugando.',
    )
  }

  function onContextRestored(): void {
    console.error('game: contexto WebGL restaurado, hace falta recargar la página')
    showContextLostOverlay(
      'El contexto gráfico volvió, pero esta sesión no se recupera sola. Recargá la página.',
    )
  }

  function onResize(): void {
    gfx.resize(canvas.clientWidth, canvas.clientHeight)
    viewmodel.resize(canvas.clientWidth, canvas.clientHeight)
    feedbackOverlay.resize(canvas.clientWidth, canvas.clientHeight)
  }

  // Política de autoplay del navegador (sección 5 del spec: "la creación
  // del audio context tiene que estar detrás de un gesto de usuario"):
  // el primer click sobre el canvas desbloquea Web Audio. Un listener
  // aparte del que ya registra engine/input.ts para pedir el pointer lock
  // -- ambos escuchan 'click' sobre el mismo elemento sin pisarse.
  function onCanvasClickForAudio(): void {
    feedbackAudio.unlock()
  }

  // Hook de debug para ejercitar "al recibir daño" (viñeta direccional,
  // shake, latido/desaturación) sin bots todavía (fase 2): detrás del mismo
  // gate ?debug=1 que el resto de los hooks de este archivo, así que no
  // existe en producción. H simula un golpe desde un punto fijo del mundo
  // (+Z): girar en el juego mueve visiblemente el lado de la viñeta, que es
  // justo lo que hay que poder verificar a mano en el navegador (spec,
  // "confirmá que la viñeta apunta al lado correcto"). J resetea la vida
  // para no tener que recargar la página entre pruebas.
  function onDebugKeyDown(e: KeyboardEvent): void {
    if (!debugModeEnabled()) return
    if (e.code === 'KeyH') {
      const sourceYaw = directionYaw(0, 1)
      const bearing = vignetteBearing(input.player.yaw, sourceYaw)
      onDamageTaken(feedbackState, bearing, 18)
    } else if (e.code === 'KeyJ') {
      resetPlayerHealth(feedbackState.health)
    }
  }

  function frame(now: number): void {
    if (!running) return
    rafId = requestAnimationFrame(frame)
    stats.beginFrame()

    const frameDt = lastTime === 0 ? 0 : (now - lastTime) / 1000
    lastTime = now
    const dt = sanitizeDt(frameDt)

    // Dianas (sección 6 del spec de fase 1): mueven, cuentan su flash de
    // impacto y reaparecen. Corre siempre, haya o no un arma equipada
    // todavía -- son parte de la arena, no del arma -- y ANTES de
    // stepCombat() más abajo, para que el hitscan de este mismo frame vea
    // las hitboxes ya en su posición de este frame, no la del anterior.
    stepTargets(targetsState, dt)

    // Se lee una sola vez por frame: attachedSlug es el modelo
    // EFECTIVAMENTE en pantalla (ver weapons/viewmodel/renderer.ts), no el
    // pedido por el jugador — si el último load está en vuelo o falló,
    // sigue apuntando al último arma real, así que ni el viewmodel ni el
    // combate corren por delante de lo que se ve.
    const shownSlug = viewmodel.attachedSlug
    const archetype = shownSlug ? ARCHETYPES[getWeaponVisual(shownSlug).archetype] : null

    if (archetype && archetype.id !== combatArchetypeId) {
      resetCombatState(combatState, archetype)
      combatArchetypeId = archetype.id
    }

    // ADS: velocidad de movimiento para el tick de ESTE frame (sección 4
    // del spec: "velocidad de movimiento: multiplica por speedScale").
    // Usa vmState.adsT tal como quedó al FINAL del frame anterior —
    // stepViewmodel recién lo actualiza más abajo, después del loop de
    // ticks fijos— así que hay hasta un frame (<16ms) de rezago en una
    // rampa continua, imperceptible, a cambio de no atar el loop de
    // física al viewmodel que corre después en el mismo frame.
    input.player.adsSpeedScale = archetype
      ? adsSpeedMultiplier(archetype.ads, easeInOutCubic(vmState.adsT))
      : 1

    const ticks = loop.advance(frameDt)
    for (let i = 0; i < ticks; i++) {
      if (playerHealth.alive) {
        stepPlayer(player, input.player, ARENA.boxes)
      } else {
        // Congelado mientras está muerto -- sin input, sin física nueva
        // (mismo patrón que stepBotMotor con bot.health.alive=false,
        // bots/bot.ts, reusado tal cual para los bots más abajo). Recalcula
        // el spawn elegido en CADA tick mientras sigue muerto: cuando
        // stepBotRespawn revive, usa la posición más fresca posible
        // respecto a dónde están los enemigos AHORA, no a dónde estaban
        // cuando murió (sección "Build" de la tarea: "elegí por distancia a
        // enemigos vivos, no al azar").
        const enemyCount = fillEnemyPositions(PLAYER_ID)
        const spawnIndex = pickFarthestSpawn(ARENA.spawns, enemyPositionsScratch, enemyCount)
        const revived = stepBotRespawn(playerHealth, TICK_DT, MATCH.respawnDelayS)
        if (revived) {
          const spawn = ARENA.spawns[spawnIndex]
          player.position.x = spawn.x
          player.position.y = spawn.y
          player.position.z = spawn.z
          player.prevPosition.x = spawn.x
          player.prevPosition.y = spawn.y
          player.prevPosition.z = spawn.z
          player.velocity.x = 0
          player.velocity.y = 0
          player.velocity.z = 0
          resetPlayerHealth(feedbackState.health)
          invulnerableUntilS[PLAYER_ID] = invulnerabilityExpiresAt(matchState.elapsedS, MATCH.respawnInvulnerabilityS)
        }
      }

      matchTargets.positions[PLAYER_ID].x = player.position.x
      matchTargets.positions[PLAYER_ID].y = player.position.y + player.eyeHeight
      matchTargets.positions[PLAYER_ID].z = player.position.z
      matchTargets.alive[PLAYER_ID] = playerHealth.alive

      // Bots muertos eligen spawn fresco ANTES de que stepAllBotsMotor
      // pueda revivirlos este mismo tick: bot.spawn (bots/bot.ts) es el
      // punto que su respawn interno lee recién en el instante en que
      // revive, así que sobreescribirlo acá alcanza sin tocar ese archivo
      // (ver el comentario de cabecera de match/squad.ts).
      for (let b = 0; b < bots.length; b++) {
        const bot = bots[b]
        botWasAlive[b] = bot.health.alive
        if (!bot.health.alive) {
          const enemyCount = fillEnemyPositions(b + 1)
          const spawnIndex = pickFarthestSpawn(ARENA.spawns, enemyPositionsScratch, enemyCount)
          const spawn = ARENA.spawns[spawnIndex]
          bot.spawn.x = spawn.x
          bot.spawn.y = spawn.y
          bot.spawn.z = spawn.z
        }
      }

      // Bots: piensan y se mueven en el mismo tick fijo que el jugador
      // (sección 8 del spec: "movimiento y colisión siguen corriendo cada
      // tick de simulación"), no atados al framerate de render. Cada bot
      // piensa contra el enemigo vivo más cercano a SÍ MISMO
      // (match/squad.ts stepMatchBotsThink), no contra un único objetivo
      // fijo -- lo que hace que TDM y FFA sean partidas de verdad en vez de
      // "todos los bots contra el jugador nada más".
      botWorld.simTimeS += TICK_DT
      stepMatchBotsThink(bots, botWorld, matchTargets, TICK_DT)
      stepAllBotsMotor(bots, botWorld, TICK_DT)

      for (let b = 0; b < bots.length; b++) {
        const bot = bots[b]
        matchTargets.positions[b + 1].x = bot.player.position.x
        matchTargets.positions[b + 1].y = bot.player.position.y + bot.player.eyeHeight
        matchTargets.positions[b + 1].z = bot.player.position.z
        matchTargets.alive[b + 1] = bot.health.alive
        if (!botWasAlive[b] && bot.health.alive) {
          invulnerableUntilS[b + 1] = invulnerabilityExpiresAt(matchState.elapsedS, MATCH.respawnInvulnerabilityS)
        }
      }
    }

    // Radio de hitbox = 0 mientras estás muerto O invulnerable (mismo truco
    // que bots/bot.ts ya usaba para cadáveres -- syncBotHitboxes, dentro de
    // stepBotMotor, ya deja a un bot muerto en radio 0 -- extendido acá a
    // la ventana de invulnerabilidad post-respawn de match/respawn.ts): un
    // disparo no puede intersectar una hitbox de radio 0, así que no hace
    // falta un chequeo de invulnerabilidad aparte en cada resolución de
    // impacto más abajo -- el participante es literalmente intocable
    // mientras dure.
    const playerTouchable =
      playerHealth.alive && !isInvulnerable(invulnerableUntilS[PLAYER_ID], matchState.elapsedS)
    playerHitboxes[0].radius = playerTouchable ? BOTS.torsoRadius : 0
    playerHitboxes[1].radius = playerTouchable ? BOTS.headRadius : 0
    for (let b = 0; b < bots.length; b++) {
      const bot = bots[b]
      if (!bot.health.alive) continue // ya en radio 0 vía syncBotHitboxes
      if (isInvulnerable(invulnerableUntilS[b + 1], matchState.elapsedS)) {
        bot.hitboxes[0].radius = 0
        bot.hitboxes[1].radius = 0
      }
    }

    // Interpolar la posición de la cámara entre el tick anterior y el actual.
    const a = loop.alpha
    gfx.camera.position.x = player.prevPosition.x + (player.position.x - player.prevPosition.x) * a
    gfx.camera.position.y =
      player.prevPosition.y + (player.position.y - player.prevPosition.y) * a + player.eyeHeight
    gfx.camera.position.z = player.prevPosition.z + (player.position.z - player.prevPosition.z) * a

    // El delta de mouse crudo de este frame se consume acá pase lo que
    // pase con el viewmodel (ver abajo): acumularlo sin límite mientras no
    // hay ningún modelo adjunto todavía produciría un salto de sway al
    // adjuntar el primero.
    const mouseDeltaX = input.mouseDeltaX
    const mouseDeltaY = input.mouseDeltaY
    input.clearMouseDelta()

    // Pitch/yaw finales de ESTE frame: arrancan en los del jugador (mouse)
    // y, si hay un arma real cargada, el combate les suma retroceso antes
    // de que el mundo se dibuje — sin esto la cámara "saltaría" un frame
    // entero después de cada disparo en vez de moverse en el mismo frame
    // en que salió la bala.
    let finalPitch = input.pitch
    let finalYaw = input.player.yaw
    // Cuántos disparos resolvió stepCombat() este frame: se usa después de
    // este bloque (feedback de disparo/impacto), así que vive afuera del
    // `if` en vez de quedar atrapado en un `const` de bloque.
    let shotsFired = 0

    if (shownSlug && archetype) {
      syncRigWeapon(rigWeapon, getWeaponVisual(shownSlug))

      // Combate: cadencia + retroceso + dispersión + hitscan (secciones
      // 1-4 del spec de fase 1). Botón izquierdo (real o del panel de
      // debug) dispara, respetando fireRate/fireMode del arquetipo.
      //
      // combatInput.reloading lee vmState.reloading ANTES de disparar el
      // startReload() de más abajo, a propósito: startReload() sólo
      // transiciona reloading de vuelta a false dentro de stepViewmodel
      // (que corre después en el frame, sección viewmodel más abajo), así
      // que el valor de acá es el que dejó el frame ANTERIOR. Si se leyera
      // DESPUÉS de re-disparar startReload() para una R sostenida, un
      // jugador que sostiene R exactamente hasta que termina la recarga
      // reiniciaría una recarga nueva en el mismo frame en que la anterior
      // completó, antes de que combat/fire-control.ts llegara a ver la
      // transición true -> false — y la munición nunca se rellenaría
      // (bug real, no de test: ver syncReloadState en fire-control.ts).
      // Muerto no dispara -- congelado igual que en el loop de ticks de
      // arriba (bot.combatInput.triggerHeld = false en la rama muerta de
      // bots/bot.ts es el mismo criterio, acá aplicado a mano porque el
      // combate del jugador no pasa por ese archivo).
      combatInput.triggerHeld = (input.fireHeld || debugFireHeld) && playerHealth.alive
      combatInput.reloading = vmState.reloading
      combatInput.pitch = input.pitch
      combatInput.yaw = input.player.yaw
      shotsFired = stepCombat(combatState, archetype, combatInput, playerShotHitboxes, dt, shotResult)

      // Culatazo del arma (weapons/viewmodel/rig.ts: fire(), sección "qué
      // existe" del spec) + punch de cámara (feedback/camera-punch.ts,
      // sección 5) por cada disparo real que salió este frame -- no por
      // frame: un frame largo que se puso al día con más de un disparo
      // (fire-control.ts) tiene que sentir cada uno, no sólo el último.
      for (let i = 0; i < shotsFired; i++) {
        fire(vmState, rigWeapon)
        onShotFired(feedbackState)
      }

      // R sostenida: startReload() es un no-op mientras ya hay una recarga
      // en curso (ver el comentario de esa función en rig.ts), así que
      // llamarla en cada frame con la tecla sostenida no la deja en
      // deadlock. Corre DESPUÉS de que combat ya leyó reloading arriba,
      // por la razón de encima.
      if (input.reloadHeld) startReload(vmState, rigWeapon)

      finalPitch = cameraPitch(combatState, input.pitch)
      finalYaw = cameraYaw(combatState, input.player.yaw)

      // ADS: FOV y sensibilidad (velocidad ya se aplicó arriba, antes del
      // loop de ticks). Misma curva de easing que la pose visual del arma
      // (easeInOutCubic, rig.ts), para que los tres terminen de moverse
      // exactamente cuando el arma termina de moverse.
      const easedAdsT = easeInOutCubic(vmState.adsT)
      gfx.setFov(adsFov(WORLD_FOV, archetype.ads, easedAdsT))
      sensMultiplier = adsSensitivityMultiplier(archetype.ads, easedAdsT)
    }

    // Resincroniza las hitboxes de torso y cabeza del jugador (ver
    // playerHitboxes arriba: ninguna comparte Vec3 con player.position).
    // Tiene que correr ANTES del combate de bots de abajo, que es quien
    // realmente lee playerHitboxes.
    playerTorsoHitboxPos.x = player.position.x
    playerTorsoHitboxPos.y = player.position.y + BOTS.torsoOffsetY
    playerTorsoHitboxPos.z = player.position.z
    playerHeadHitboxPos.x = player.position.x
    playerHeadHitboxPos.y = player.position.y + BOTS.headOffsetY
    playerHeadHitboxPos.z = player.position.z

    // Bots: cadencia + retroceso + dispersión + hitscan contra el enemigo
    // vivo más cercano de CADA bot (match/squad.ts ya resolvió a quién le
    // apunta cada uno, sección "Build" de la tarea), el MISMO stepCombat
    // que acaba de correr arriba para el jugador (sección 8 del spec:
    // "reusa el mismo movement y combat que el jugador"). Una vez por
    // frame, no por tick fijo -- mismo modelo de cadencia que el combate
    // del jugador, así todos avanzan fire-control con el mismo dt real.
    // `enemyHitboxesFor[i+1]` excluye estructuralmente a los compañeros de
    // equipo (armado una sola vez al arrancar la partida, arriba): TDM
    // nunca puede resolver fuego amigo porque esas hitboxes ni están en la
    // lista.
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i]
      const botShots = stepBotCombat(bot, enemyHitboxesFor[i + 1], dt)
      if (botShots > 0) {
        registerGunshot(botWorld.shots, bot.combatInput.origin, botWorld.simTimeS)
      }
      if (botShots > 0 && bot.shotResult.hit && bot.shotResult.part !== 'none' && bot.shotResult.owner >= targetCount) {
        const shooterId = i + 1
        const victimId = bot.shotResult.owner - targetCount
        const damage = bot.shotResult.damage
        const headshot = bot.shotResult.part === 'head'

        let killed: boolean
        if (victimId === PLAYER_ID) {
          killed = applyDamageToBot(playerHealth, damage)
          // Feedback visual/sonoro (viñeta direccional + shake + resta de
          // vida en pantalla) -- reusa el mismo pipeline que el hook de
          // debug ya ejercitaba, feedback/feedback.ts onDamageTaken. Sólo
          // tiene sentido cuando la víctima es el JUGADOR: es su pantalla,
          // no la de nadie más -- un bot golpeando a otro bot no le debe
          // nada a feedbackState.
          const sourceYaw = directionYaw(
            bot.player.position.x - player.position.x,
            bot.player.position.z - player.position.z,
          )
          const bearing = vignetteBearing(input.player.yaw, sourceYaw)
          onDamageTaken(feedbackState, bearing, damage)
        } else {
          killed = damageBot(bots[victimId - 1], damage)
        }

        recordDamage(matchState, shooterId, damage)
        if (killed) recordKill(matchState, shooterId, victimId, weaponLabel(bot.archetype.id), headshot)
      }
    }

    // Envejece hitmarkers/números de daño/viñetas/shake e integra el
    // impulso de punch que onShotFired() acaba de sumar arriba (si hubo
    // disparo este frame): tiene que correr ANTES de leer
    // feedbackState.cameraPunch.roll de la línea de abajo, para que el
    // punch de ESTE disparo ya se sienta en la rotación de ESTE frame, no
    // en el siguiente. Corre siempre, con o sin arma equipada -- el shake
    // y la viñeta de daño recibido no dependen de tener un arma en mano.
    stepFeedback(feedbackState, dt)

    gfx.camera.rotation.set(finalPitch, finalYaw, feedbackState.cameraPunch.roll, 'YXZ')

    // Impacto confirmado contra una diana o un bot real (owner >= 0: golpear
    // el mapa da owner -1, ver combat/shot.ts) -- hitmarker + número de daño
    // + sonido + resta de vida (sección 5 y 6 del spec, más bots sección 8)
    // + puntaje/killfeed de partida (sección "Build" de la tarea). `owner`
    // viene de playerShotHitboxes (armado arriba): índices por debajo de
    // targetCount son dianas (no participan del puntaje), el resto son
    // combatientes enemigos -- nunca el jugador mismo (playerShotHitboxes
    // excluye sus propias hitboxes por construcción) y nunca un compañero
    // de equipo (enemyHitboxesFor ya los excluyó). Corre DESPUÉS de fijar
    // la rotación de cámara de arriba: worldToScreen() necesita la
    // orientación de ESTE frame para proyectar bien el punto de impacto,
    // no la del frame anterior.
    if (shotsFired > 0 && shotResult.hit && shotResult.part !== 'none' && shotResult.owner >= 0) {
      let killed: boolean
      if (shotResult.owner < targetCount) {
        killed = applyHit(targetsState, shotResult.owner, shotResult.damage)
      } else {
        const victimId = shotResult.owner - targetCount
        killed = damageBot(bots[victimId - 1], shotResult.damage)
        recordDamage(matchState, PLAYER_ID, shotResult.damage)
        if (killed) {
          recordKill(matchState, PLAYER_ID, victimId, weaponLabel(combatArchetypeId ?? 'ar-1'), shotResult.part === 'head')
        }
      }

      // Punto de impacto reconstruido: cámara + forward(pitch,yaw) * distancia.
      // No es EXACTO -- ignora la dispersión de este disparo en particular
      // (combat/spread.ts la aplica adentro de stepCombat/fireShot y no la
      // devuelve hacia afuera), así que puede quedar corrido unos pocos
      // píxeles del punto real. El cono de dispersión de este arsenal es
      // chico (<3°, ver archetypes.ts) y el número de daño sólo necesita
      // aparecer "cerca" del impacto, no exacto -- evita reimplementar la
      // proyección con el offset de dispersión sumado sólo para esto.
      computeForward(finalPitch, finalYaw, scratchForward)
      scratchHitPoint.x = combatInput.origin.x + scratchForward.x * shotResult.distance
      scratchHitPoint.y = combatInput.origin.y + scratchForward.y * shotResult.distance
      scratchHitPoint.z = combatInput.origin.z + scratchForward.z * shotResult.distance
      gfx.worldToScreen(scratchHitPoint, scratchScreenPoint)

      const tier = onHitConfirmed(
        feedbackState,
        scratchScreenPoint.x,
        scratchScreenPoint.y,
        shotResult.damage,
        shotResult.part === 'head',
        killed,
      )
      feedbackAudio.playHitmarker(tier)
    }

    // Reloj de partida + killfeed + condición de cierre (sección "Build" de
    // la tarea): corre DESPUÉS de resolver todo el combate de este frame,
    // para que la última tanda de kills/daño de un frame que agota el
    // reloj o el límite de kills todavía cuente -- ver el comentario de
    // cabecera de match/match.ts sobre la garantía de terminación.
    stepMatch(matchState, dt, MATCH)

    targetsRenderer.sync(targetsState)
    botsRenderer.sync(bots)

    // El timer de GPU bracketea desde acá (antes del clear + render del
    // mundo) hasta después de la pasada del viewmodel, más abajo: esas dos
    // pasadas y sus dos clears son exactamente lo que la auditoría de
    // performance midió como "costo de GPU de un rAF completo".
    gpuTimer.beginFrame()

    gfx.renderer.info.reset()
    gfx.render()
    // El WebGLRenderer resetea renderer.info en cada llamada a render()
    // (autoReset): hay que leer las cuentas del mundo acá, antes de que la
    // pasada del viewmodel las pise, para poder sumarlas después.
    const worldCalls = gfx.renderer.info.render.calls
    const worldTriangles = gfx.renderer.info.render.triangles

    // Viewmodel: un paso de rig por frame de render (no por tick fijo),
    // como el resto de la capa visual.
    if (shownSlug && archetype) {
      vmInput.speed = Math.hypot(player.velocity.x, player.velocity.z)
      vmInput.grounded = player.grounded
      vmInput.ads = input.adsHeld || debugAdsHeld
      vmInput.mouseDeltaX = mouseDeltaX
      vmInput.mouseDeltaY = mouseDeltaY

      stepViewmodel(vmState, vmInput, rigWeapon, vmOut, dt)

      // El pz del rig usa "+ hacia el jugador" (ver seed.ts); la cámara del
      // viewmodel mira hacia -Z como cualquier cámara de Three, así que el
      // eje que queda "delante" de ella es el negativo. x e y ya coinciden
      // con la convención de Three (derecha positiva, arriba positivo) y no
      // se tocan.
      viewmodel.weapon.position.set(vmOut.px, vmOut.py, -vmOut.pz)
      viewmodel.weapon.rotation.set(vmOut.rx, vmOut.ry, vmOut.rz)
      viewmodel.render(gfx.camera)
      gpuTimer.endFrame()

      stats.endFrame(
        worldCalls + gfx.renderer.info.render.calls,
        worldTriangles + gfx.renderer.info.render.triangles,
        gpuTimer.stats.gpuMs,
        gpuTimer.stats.peakMs,
      )
    } else {
      gpuTimer.endFrame()
      stats.endFrame(worldCalls, worldTriangles, gpuTimer.stats.gpuMs, gpuTimer.stats.peakMs)
    }

    updateWeaponErrorBanner()

    // Capa visual del feedback (hitmarkers, números de daño, viñeta,
    // latido/desaturación, shake del canvas): DOM imperativo, se actualiza
    // todos los frames -- no es React, así que no compite con el
    // presupuesto de frame del motor (ver el comentario de cabecera de
    // feedback/overlay.ts).
    feedbackOverlay.render(feedbackState)
  }

  return {
    start(): void {
      if (running) return
      running = true
      lastTime = 0
      input.attach(canvas)
      if (canvas.parentElement) {
        stats.mount(canvas.parentElement)
        tuning.mount(canvas.parentElement)
        matchTuningPanel.mount(canvas.parentElement)
        weaponTuning?.mount(canvas.parentElement)
        feedbackOverlay.mount(canvas.parentElement, canvas)
      }
      loadWeaponTuningOverrides().catch(() => {})
      window.addEventListener('resize', onResize)
      canvas.addEventListener('click', onCanvasClickForAudio)
      window.addEventListener('keydown', onDebugKeyDown)
      // 'webglcontextlost'/'webglcontextrestored' no están en el
      // HTMLElementEventMap de lib.dom.d.ts (son del spec de WebGL, no de
      // HTML): TS los acepta igual por el overload genérico de
      // addEventListener(type: string, ...).
      canvas.addEventListener('webglcontextlost', onContextLost, false)
      canvas.addEventListener('webglcontextrestored', onContextRestored, false)
      onResize()
      rafId = requestAnimationFrame(frame)

      // Hook de sólo lectura para verificar el combate numéricamente sin
      // pointer lock (que no funciona en automatización de navegador):
      // detrás del mismo gate ?debug=1 que el panel de tuning de armas, así
      // que no existe en producción. No es un canal de control — sólo lee
      // el estado que frame() ya calcula.
      if (debugModeEnabled()) {
        ;(window as unknown as { __combatDebug?: () => unknown }).__combatDebug = () => ({
          pitch: cameraPitch(combatState, input.pitch),
          yaw: cameraYaw(combatState, input.player.yaw),
          recoilPitch: combatState.recoil.pitchOffset,
          recoilYaw: combatState.recoil.yawOffset,
          spread: combatState.spread.radius,
          ammo: combatState.fireControl.ammo,
          shotIndex: combatState.recoil.shotIndex,
          archetypeId: combatArchetypeId,
          reloading: vmState.reloading,
          reloadHeld: input.reloadHeld,
          // Último disparo del JUGADOR resuelto (sección "Build" de la
          // tarea): a qué le pegó de verdad, para verificar el combate
          // contra participantes de partida sin depender sólo de lo visual
          // -- mismo espíritu que `bots[].lastShot` más abajo.
          shotResult: { ...shotResult },
          // Sección 5/6 del spec: estado del feedback y las dianas, para
          // verificar en el navegador sin depender sólo de lo visual (mismo
          // espíritu que el resto de este hook de sólo lectura).
          feedback: {
            health: feedbackState.health.health,
            shakeMagnitude: feedbackState.shake.magnitude,
            cameraPunchRoll: feedbackState.cameraPunch.roll,
            hitmarkersActivos: feedbackState.hitmarkers.pool.items.filter((e) => e.active).length,
            numerosDeDanoActivos: feedbackState.damageNumbers.pool.items.filter((e) => e.active)
              .length,
            vinetasActivas: feedbackState.vignette.pool.items.filter((e) => e.active).length,
          },
          targets: targetsState.targets.map((t) => ({
            alive: t.alive,
            health: t.health,
            x: t.position.x,
          })),
          // Sección 8 del spec (bots): estado real de cada bot, para
          // verificar en el navegador que la FSM/percepción/navegación
          // hacen lo que dicen sin depender sólo de lo visual -- mismo
          // espíritu que `targets` arriba.
          bots: bots.map((b, i) => ({
            id: b.id,
            participantId: i + 1,
            state: b.fsm.current,
            alive: b.health.alive,
            health: b.health.health,
            x: b.player.position.x,
            y: b.player.position.y,
            z: b.player.position.z,
            aimYaw: b.aimMotor.yaw,
            hasPath: b.pathIndex < b.path.length,
            archetypeId: b.archetype.id,
            invulnerable: isInvulnerable(invulnerableUntilS[i + 1], matchState.elapsedS),
            triggerHeld: b.combatInput.triggerHeld,
            ammo: b.combat.fireControl.ammo,
            // Último disparo de ESTE bot resuelto -- mismo espíritu que
            // `shotResult` del jugador más arriba.
            lastShot: { hit: b.shotResult.hit, part: b.shotResult.part, owner: b.shotResult.owner },
          })),
          // Sección "Build" de la tarea (segunda mitad de la fase 2): la
          // partida en sí -- modo, reloj, puntaje por participante y
          // killfeed -- para verificar en el navegador sin depender sólo de
          // leer el HUD de React.
          match: {
            mode: matchState.mode,
            phase: matchState.phase,
            elapsedS: matchState.elapsedS,
            timeRemainingS: matchState.timeRemainingS,
            participants: matchState.participants.map((p) => ({ ...p })),
            killfeed: matchState.killfeed.pool.items
              .filter((e) => e.active)
              .map((e) => ({ ...e })),
            playerAlive: playerHealth.alive,
            playerHealth: playerHealth.health,
            playerInvulnerable: isInvulnerable(invulnerableUntilS[PLAYER_ID], matchState.elapsedS),
          },
        })

        // Hook de control para verificación en navegador sin pointer lock
        // (que no funciona en automatización -- Playwright/CDP no pueden
        // pedirlo ni concederlo). A diferencia de __combatDebug (sólo
        // lectura), éste SÍ mueve estado: teletransporta al jugador y fija
        // pitch/yaw a mano, detrás del mismo gate ?debug=1. El disparo en sí
        // no necesita un hook nuevo -- el panel de tuning de armas ya
        // escucha 'mousedown' en `window` sin requerir el lock (ver
        // weapons/viewmodel/tuning-panel.ts), así que un MouseEvent
        // sintético alcanza.
        ;(
          window as unknown as {
            __debugTeleport?: (x: number, y: number, z: number, yaw: number, pitch: number) => void
          }
        ).__debugTeleport = (x, y, z, yaw, pitch) => {
          player.position.x = x
          player.position.y = y
          player.position.z = z
          player.prevPosition.x = x
          player.prevPosition.y = y
          player.prevPosition.z = z
          input.player.yaw = yaw
          input.pitch = pitch
        }

        // El objeto de tuning en sí (sección 5 del spec: "en un objeto
        // mutable... para poder exponerlo a un panel de debug más
        // adelante"): un panel real todavía no existe, pero exponerlo ya
        // deja el terreno preparado, y de paso sirve para inspeccionar/
        // ajustar valores en vivo desde la consola al verificar en el
        // navegador.
        ;(window as unknown as { __feedbackTuning?: typeof FEEDBACK }).__feedbackTuning = FEEDBACK

        // Objeto de tuning de partida (sección "Pacing" de la tarea): mismo
        // motivo que __feedbackTuning arriba -- ajustar en vivo desde la
        // consola al verificar, además del panel visual (tecla M).
        ;(window as unknown as { __matchTuning?: typeof MATCH }).__matchTuning = MATCH
      }
    },
    stop(): void {
      running = false
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('click', onCanvasClickForAudio)
      window.removeEventListener('keydown', onDebugKeyDown)
      canvas.removeEventListener('webglcontextlost', onContextLost, false)
      canvas.removeEventListener('webglcontextrestored', onContextRestored, false)
      input.detach()
      stats.unmount()
      tuning.unmount()
      matchTuningPanel.unmount()
      weaponTuning?.unmount()
      feedbackOverlay.unmount()
      targetsRenderer.dispose()
      botsRenderer.dispose()
      weaponErrorBanner?.remove()
      weaponErrorBanner = null
      shownLoadError = null
      hideContextLostOverlay()
      viewmodel.dispose()
      gfx.dispose()
    },
    benchmark(passes = 500): number {
      return runBenchmark(() => gfx.render(), passes)
    },
    get stats() {
      return stats.stats
    },
    get matchState() {
      return matchState
    },
  }
}
