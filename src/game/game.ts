import { sanitizeDt } from '@/game/engine/dt'
import { TICK_DT } from '@/game/engine/constants'
import { createFixedLoop } from '@/game/engine/fixed-loop'
import { createGpuTimer } from '@/game/engine/gpu-timer'
import { createInputSystem } from '@/game/engine/input'
import { createProfiler } from '@/game/engine/profiler'
import { createRenderer, WORLD_FOV } from '@/game/engine/renderer'
import { createPostFx } from '@/game/engine/postprocess'
import { createStatsTracker, runBenchmark } from '@/game/engine/stats'
import type { FrameStats } from '@/game/engine/stats'
import { createTuningPanel } from '@/game/engine/tuning-panel'
import { ARENA } from '@/game/map/arena'
import { mapNames, resolveMap } from '@/game/map/registry'
import { fuentesDeMapa } from '@/game/map/seleccion'
import type { MapaExternoCargado } from '@/game/map/external-map'
import type { MapDef } from '@/game/map/types'
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
import { raycastMap, setRaycastMap } from '@/game/combat/hitscan'
import type { Hitbox } from '@/game/combat/hitboxes'
import { archetypeForStyle, ARCHETYPES, type ArchetypeId } from '@/game/weapons/archetypes'
import { tacticalStyleForSlug, weaponAllowsAds } from '@/game/weapons/source-catalog'
import {
  camoForSlot,
  equipWeapon,
  LOADOUT_SLOTS,
  opticForSlot,
  skinForSlot,
  type Loadout,
  type LoadoutSlot,
} from '@/game/progression/loadout'
import {
  accountLevel,
  careerFromProgress,
  createProgressStore,
  progressWithCareer,
  progressWithWeaponXp,
  progressWithMedals,
} from '@/game/progression/store'
import { applyMatchResult, careerDifficulty, type MatchProgress } from '@/game/progression/career'
import { performanceFromStats } from '@/game/progression/combat-score'
import {
  applyWeaponXp,
  createWeaponTally,
  registrarDano,
  registrarKill,
  type WeaponXpOutcome,
} from '@/game/progression/weapon-xp'
import { getWeaponVisual, resolveArchetypeId, weaponIndex } from '@/game/weapons/registry'
import { resolveRecoilPattern } from '@/game/weapons/recoil-patterns'
import { createRigWeapon, syncRigWeapon } from '@/game/weapons/viewmodel/adapt'
import { createViewmodelRenderer } from '@/game/weapons/viewmodel/renderer'
import { createMagTransform, magazinePose } from '@/game/weapons/viewmodel/reload'
import { VIEWMODEL } from '@/game/weapons/viewmodel/tuning'
import {
  createViewmodelState,
  easeInOutCubic,
  fire,
  reloadFraction,
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
import { createShotResult, type ShotResult } from '@/game/combat/shot'
import {
  createMeleeResult,
  createMeleeState,
  resetMeleeState,
  stepMelee,
  type MeleeInput,
  type MeleeResult,
  type MeleeState,
} from '@/game/combat/melee'
import { getMeleeArchetype, isMeleeSlug, KNIFE_ARCHETYPE, MELEE_WEAPONS } from '@/game/weapons/melee-catalog'
import { vec3, type Vec3 } from '@/game/math/vec3'
import type { ScreenPoint } from '@/game/engine/renderer'
import { applyHit, createDefaultTargetDefs, createTargets, stepTargets } from '@/game/targets/targets'
import { createTargetsRenderer } from '@/game/targets/renderer'
import { esModoPractica } from '@/game/targets/practica'
import { createSensitivityStore, radianesPorConteo } from '@/game/settings/store'
import { createVideoSettingsStore, type BloomQuality } from '@/game/settings/video'
import { createFeedbackAudio } from '@/game/feedback/audio'
import { createWeaponAudio, gananciaPorDistancia } from '@/game/feedback/gun-audio'
import { createVfxRenderer } from '@/game/feedback/vfx-renderer'
import {
  createVfxState,
  spawnCalcomania,
  spawnFulgor,
  spawnImpacto,
  spawnTrazador,
  SUPERFICIE_CARNE,
  SUPERFICIE_HORMIGON,
} from '@/game/feedback/vfx'
import { createFeedbackOverlay } from '@/game/feedback/overlay'
import {
  scopeAlpha,
  scopeReticleForWeapon,
  sightForSlug,
  weaponHiddenByScope,
  type ScopeReticle,
} from '@/game/feedback/scope'
import {
  createFeedbackState,
  onDamageTaken,
  onHitConfirmed,
  onShotFired,
  stepFeedback,
} from '@/game/feedback/feedback'
import { directionYaw, vignetteBearing } from '@/game/feedback/vignette'
import { resetPlayerHealth } from '@/game/feedback/health-vfx'
import { FEEDBACK, VFX } from '@/game/feedback/tuning'
import { assignBotArchetypes, assignBotWeaponSlugs, weaponLabel } from '@/game/match/loadouts'
import {
  buildSummary,
  createMatchState,
  playerWon,
  recordDamage,
  recordKill,
  stepMatch,
  type MatchState,
} from '@/game/match/match'
import {
  createSpawnHistory,
  invulnerabilityExpiresAt,
  isInvulnerable,
  pickFarthestSpawn,
  recordSpawnUse,
  spreadInitialSpawns,
} from '@/game/match/respawn'
import {
  createKillContext,
  createMedalTracker,
  finalizarMedallas,
  registrarDanoMedallas,
  registrarKillMedallas,
  registrarReaparicionMedallas,
  stepMedallas,
  tallyDeMedallas,
  type MedalTrackerState,
} from '@/game/match/medal-tracker'
import type { MedalTally } from '@/game/progression/medals'
import { createMatchBots, stepMatchBotsThink } from '@/game/match/squad'
import { acotarBotsIniciales, MAX_BOTS, MAX_PARTICIPANTES } from '@/game/match/roster'
import {
  agregarBot as agregarBotAlRoster,
  crearRosterVivo,
  quitarBot as quitarBotDelRoster,
} from '@/game/match/roster-vivo'
import { createMatchTargets, type MatchTargets } from '@/game/match/targeting'
import { MATCH } from '@/game/match/tuning'
import { createMatchTuningPanel } from '@/game/match/tuning-panel'
import { isEnemy, PLAYER_ID, teamForParticipant, type MatchMode } from '@/game/match/types'

/**
 * Ranura en mano del jugador. Amplía las dos ranuras del loadout persistido
 * (primary/secondary, elegibles en la armería) con `'melee'`: el CUCHILLO, que
 * es un slot 3 FIJO -- siempre presente, no se elige ni se desbloquea (como en
 * CS/COD). Su slug no vive en el loadout guardado porque no es una decisión del
 * jugador; sale de la constante de abajo.
 */
export type RanuraEnMano = LoadoutSlot | 'melee'

/** Slug del cuchillo del slot 3 fijo. Sale del catálogo melee (la primera arma
 *  melee del catálogo), no se hardcodea acá el nombre del archivo. */
const MELEE_SLUG: string = MELEE_WEAPONS[0]?.slug ?? 'knife_t'

/**
 * Lo que el HUD de combate necesita saber, en un objeto plano que el motor
 * RELLENA (no devuelve). Es un `out` param preasignado por quien lee, igual
 * que `ShotResult` o `VmTransform`: el HUD lo lee una vez por frame y no
 * puede permitirse que cada lectura genere un objeto nuevo -- son 240
 * objetos por segundo que después hay que juntar (regla de "cero
 * asignaciones por frame" de AGENTS.md, que vale para todo lo que corre en
 * el ritmo del rAF, no sólo para lo que corre adentro de frame()).
 *
 * Todos los campos son primitivos. `weaponName` es una referencia a una
 * cadena YA construida al equipar el arma, nunca una cadena armada acá.
 */
export interface HudSnapshot {
  /** Balas en el cargador y capacidad del cargador del arma equipada. */
  ammo: number
  magazine: number
  /** Recargando ahora mismo: el HUD baja la opacidad del contador en vez de
   *  mostrar un número que no significa nada durante la animación. */
  reloading: boolean
  health: number
  maxHealth: number
  alive: boolean
  /** Segundos que faltan para reaparecer. 0 mientras se está vivo. */
  respawnInS: number
  /** Nombre de catálogo del arma equipada ("AK-47"), o cadena vacía si la
   *  ranura quedó vacía. */
  weaponName: string
  /** Ranura equipada, para que el HUD marque cuál está en mano (incluye 'melee'). */
  slot: RanuraEnMano
  /** Nombres de las tres ranuras, para el selector rápido del HUD. `meleeName`
   *  es fijo (el cuchillo del slot 3 siempre presente). */
  primaryName: string
  secondaryName: string
  meleeName: string
}

export function createHudSnapshot(): HudSnapshot {
  return {
    ammo: 0,
    magazine: 0,
    reloading: false,
    health: 0,
    maxHealth: 0,
    alive: true,
    respawnInS: 0,
    weaponName: '',
    slot: 'primary',
    primaryName: '',
    secondaryName: '',
    meleeName: '',
  }
}

export interface Game {
  start(): void
  stop(): void
  /**
   * Costo en CPU de encolar `passes` llamadas a render(), sin esperar a que
   * la GPU termine de dibujar. Es una cota inferior del costo real de
   * frame, no una medida de capacidad o margen disponible.
   */
  benchmark(passes?: number): number
  /**
   * Captura de pantalla para debug. Devuelve el frame ACTUAL del canvas como
   * data URL PNG. Se resuelve en el próximo frame de render, justo después de
   * dibujar el mundo + viewmodel + overlay y ANTES del clear del siguiente
   * frame: así el drawing buffer todavía tiene la imagen y no hace falta
   * `preserveDrawingBuffer` en el renderer (que costaría GPU en TODOS los
   * frames de TODOS los jugadores por una función que se usa a demanda).
   * `null` si el juego no está corriendo o el toDataURL falla.
   */
  capturarPantalla(): Promise<string | null>
  readonly stats: FrameStats
  /** Estado de partida en vivo (sección "Build" de la tarea): killfeed,
   *  puntaje y fase, para que el HUD de React (src/ui/) lo sondee a baja
   *  frecuencia -- referencia mutable, no una copia; quien la lee no debe
   *  escribirla. */
  readonly matchState: MatchState
  /** Resultado de progresión de la partida (fase 4): RR, colocación, XP y
   *  drop de skin. `null` mientras la partida sigue viva; se llena una sola
   *  vez, al terminar. */
  readonly matchProgress: MatchProgress | null
  /**
   * Detector de medallas de gesta en vivo (match/medal-tracker.ts).
   * Referencia mutable, igual que `matchState`: la UI la sondea a baja
   * frecuencia y NO debe escribirla.
   *
   * Para los avisos que aparecen y se van:
   * `listActiveAwardsNewestFirst(medalTracker)`.
   * Para el conteo de la partida en curso: `tallyDeMedallas(medalTracker)`.
   * Para el histórico de toda la carrera: `ProgressData.medallas`.
   */
  readonly medalTracker: MedalTrackerState
  /** Medallas ganadas en esta partida, `slug -> veces`. `null` mientras la
   *  partida sigue viva; se llena una sola vez al terminar, junto con
   *  `matchProgress`. Es lo que muestra la pantalla de resumen. */
  readonly medallasDeLaPartida: MedalTally | null

  /**
   * XP ganada por cada arma que el jugador usó en la partida, con su ascenso
   * de nivel y los camos de maestría que desbloqueó
   * (progression/weapon-xp.ts). Vacío mientras la partida sigue viva y
   * mientras el jugador no haya hecho daño con ninguna arma.
   *
   * Va aparte de `matchProgress` a propósito: la XP de arma no es parte de
   * la carrera y no toca el rango.
   */
  readonly weaponXp: readonly WeaponXpOutcome[]

  /**
   * Rellena `out` con el estado de combate del jugador. Lectura pura: no
   * toca nada del motor y no asigna. La llama la capa de HUD (src/ui/Hud.ts)
   * una vez por frame desde su propio rAF -- el motor no sabe que el HUD
   * existe, que es lo que evita el acoplamiento al revés (src/game nunca
   * importa src/ui).
   */
  readHud(out: HudSnapshot): void

  /**
   * Mete un bot más, en el equipo con menos gente. Devuelve `false` si no se
   * pudo (roster lleno, partida terminada, o es una ranked -- ahí el roster
   * está cerrado a propósito, ver match/configuracion.ts).
   *
   * La llama la UI desde una tecla (ui/GameCanvas.tsx). Vive en el motor y
   * no en la UI porque quién entra y en qué equipo es una decisión de
   * partida, no de presentación.
   */
  agregarBot(): boolean
  /** Saca al último bot que entró. `false` si ya está en el piso de un bot,
   *  si la partida terminó, o si es ranked. */
  quitarBot(): boolean
  /** Bots en cancha ahora mismo. Lo lee la UI para el aviso de la tecla y
   *  para saber qué filas del marcador tienen a alguien jugando. */
  readonly botsActivos: number
  /**
   * Participantes que el marcador y el resumen deben MOSTRAR: el jugador más
   * todo bot que alguna vez estuvo en cancha (incluido el que ya salió), y
   * ninguno de los slots que nunca entraron. Es `1 + marca de agua` del
   * roster (ver match/roster-vivo.ts).
   *
   * `matchState.participants` siempre tiene el tamaño del roster completo
   * (hace falta para indexar por id a cualquier bot que pueda entrar), así
   * que la UI corta con esto antes de dibujar -- sin el corte, el marcador
   * mostraría filas fantasma de bots que nunca jugaron.
   */
  readonly participantesVisibles: number
  /** ¿Esta partida deja tocar el roster? Falso en ranked. */
  readonly rosterEditable: boolean

  /**
   * Congela la simulación Y el render. Con `true`, frame() sale antes de
   * simular nada: el último cuadro dibujado se queda en pantalla como fondo
   * del menú (el compositor conserva lo último presentado mientras nadie
   * limpie el buffer) y los bots no siguen jugando contra un jugador que
   * está mirando un menú.
   */
  setPaused(paused: boolean): void
  readonly paused: boolean

  /**
   * Vuelve a leer la sensibilidad guardada (settings/store.ts). La llama la
   * UI al cerrar el menú de pausa: el conversor de sensibilidad ahora vive
   * también adentro de la partida, y sin esto sería un panel que guarda un
   * valor que el motor no mira hasta la próxima partida.
   */
  recargarSensibilidad(): void

  /**
   * Vuelve a leer la calidad de bloom guardada (settings/video.ts) y la aplica
   * en vivo. La llama la UI al cerrar el menú de pausa, igual que
   * `recargarSensibilidad`: el panel de video guarda al instante, pero como el
   * juego está congelado con el menú abierto, el cambio recién se ve al
   * reanudar. Sin esto sería un control que guarda un valor que el motor no
   * mira hasta la próxima partida.
   */
  recargarVideo(): void

  /** Loadout vivo de la partida. Referencia de sólo lectura para la UI: se
   *  cambia por `equipEnPartida`, nunca escribiéndolo. */
  readonly loadout: Loadout
  /** Ranura en mano ahora mismo (incluye 'melee', el cuchillo del slot 3). */
  readonly slotEquipado: RanuraEnMano

  /**
   * Cambia el arma de una ranura CON LA PARTIDA CORRIENDO (menú de pausa) y
   * la deja en mano. Persiste el cambio en el guardado, así que sobrevive a
   * salir de la partida: es la misma decisión que el jugador habría tomado
   * en la armería, tomada sin salir del juego.
   */
  equipEnPartida(slot: LoadoutSlot, slug: string): void
  /** Cambia de ranura sin cambiar de arma (teclas 1, 2 y 3 -- 3 = cuchillo -- y el HUD). */
  equiparRanura(slot: RanuraEnMano): void
}

/**
 * Sensibilidad base en radianes por conteo de mouse. Ya no es una constante:
 * sale del conversor de sensibilidad que el jugador usa en la armería
 * (settings/store.ts + settings/sensitivity.ts). Con nada guardado da
 * exactamente 0.0022, el valor fijo que este archivo tuvo desde la fase 1
 * -- ver SENS_POR_DEFECTO para la derivación.
 *
 * Se lee UNA vez, acá, al construir la partida: es el mismo criterio que el
 * loadout y el mapa. localStorage es síncrono, así que no hay carrera
 * posible entre "leer el ajuste" y "arrancar el motor" (el bug de foto
 * vieja que ya pasó con el registro de armas, ver ui/GameCanvas.tsx).
 */
function sensibilidadBase(): number {
  return radianesPorConteo(createSensitivityStore().load())
}

/**
 * Calidad de bloom guardada por el jugador (settings/video.ts). Se lee UNA vez
 * al construir la partida, mismo criterio que la sensibilidad: localStorage es
 * síncrono, así que no hay carrera entre leer el ajuste y arrancar el motor.
 * Con nada guardado da `bajo`, el default balanceado.
 */
function calidadBloomInicial(): BloomQuality {
  return createVideoSettingsStore().load().bloom
}

/** Cuántos bots poblar la arena, vía `?bots=N` (mismo patrón que
 *  `?debug=1` en weapons/viewmodel/tuning-panel.ts). Default MATCH.botCount
 *  (match/tuning.ts) -- vive ahí, no acá, para que el panel de tuning de
 *  partida (match/tuning-panel.ts) pueda ajustarlo sin recompilar.
 *  Clampeado contra un valor absurdo en la URL por `acotarBotsIniciales`
 *  (match/roster.ts), que es donde vive el tope real del motor. */

/** Cuánto se corre la boca aproximada respecto del ojo, en metros. */
const BOCA_ADELANTE = 0.45
const BOCA_DERECHA = 0.13
const BOCA_ABAJO = 0.1

/**
 * Boca aproximada del arma en coordenadas de mundo, para que el trazador no
 * nazca en el centro de la pantalla. Se deriva de la recta ojo -> impacto
 * que ya resolvió el disparo, así que no necesita ni pitch ni yaw ni la
 * escena del viewmodel. Escribe en `out` (preasignado).
 */
function posicionBoca(origen: Vec3, disparo: ShotResult, out: Vec3): void {
  let fx = disparo.pointX - origen.x
  let fy = disparo.pointY - origen.y
  let fz = disparo.pointZ - origen.z
  const largo = Math.sqrt(fx * fx + fy * fy + fz * fz)
  if (largo > 1e-5) {
    fx /= largo
    fy /= largo
    fz /= largo
  } else {
    fx = 0
    fy = 0
    fz = -1
  }

  // Derecha = forward x (0,1,0) = (-fz, 0, fx). Si el jugador mira casi
  // recto arriba o abajo el producto cruz degenera (forward casi paralelo a
  // arriba), así que se cae a un lateral fijo en vez de normalizar un
  // vector de largo cero.
  let rx = -fz
  let rz = fx
  const rlargo = Math.sqrt(rx * rx + rz * rz)
  if (rlargo > 1e-4) {
    rx /= rlargo
    rz /= rlargo
  } else {
    rx = 1
    rz = 0
  }

  out.x = origen.x + fx * BOCA_ADELANTE + rx * BOCA_DERECHA
  out.y = origen.y + fy * BOCA_ADELANTE - BOCA_ABAJO
  out.z = origen.z + fz * BOCA_ADELANTE + rz * BOCA_DERECHA
}

function getBotCount(): number {
  const raw = new URLSearchParams(window.location.search).get('bots')
  // En modo práctica (targets/practica.ts) el default es 0 bots, no
  // MATCH.botCount: el punto del modo es plinkear dianas sin nadie
  // disparándote. `?bots=N` explícito sigue mandando -- practicar con un
  // par de bots sueltos al lado de las dianas es un caso legítimo, sólo
  // no es lo que pasa si no lo pedís.
  if (raw === null) return acotarBotsIniciales(esModoPractica() ? 0 : MATCH.botCount)
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return acotarBotsIniciales(esModoPractica() ? 0 : MATCH.botCount)
  return acotarBotsIniciales(n)
}

/** ¿Esta partida deja agregar y sacar bots con el teclado? La ranked no
 *  (match/configuracion.ts): su roster es parte de lo que hace comparables
 *  dos partidas rankeadas entre sí. */
function getPermiteEditarRoster(): boolean {
  return new URLSearchParams(window.location.search).get('ranked') !== '1'
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

/**
 * Un rango de dificultad por bot, centrado en el rango del jugador.
 *
 * **Este es el enganche de la fase 4** (sección 8 del spec: "la dificultad
 * de los bots se deriva del rango actual del jugador"). Hasta la fase 3 el
 * centro era una constante de tuneo; ahora lo trae `careerDifficulty`
 * (progression/career.ts), que sale del rango o, en colocaciones, de la
 * estimación adaptativa. Hierro juega contra 400ms de reacción y 6.0° de
 * error; Radiante contra 120ms y 0.7°.
 *
 * 'mixed' sigue existiendo y sigue haciendo lo mismo que antes -- repartir
 * bots más blandos y más duros dentro de la misma partida para que haya
 * respiros -- pero ahora reparte ALREDEDOR del centro del jugador
 * (MATCH.mixedDifficultySpread) en vez de sobre una lista fija de rangos
 * absolutos. Un jugador de Diamante encuentra bots de Platino y de
 * Ascendente, no de Hierro y de Radiante.
 *
 * `?difficulty=` sigue ganando sobre todo: es el override de QA que permite
 * mirar un nivel concreto sin tener que llegar ahí jugando.
 */
function resolveDifficultyRanks(count: number, centro: number): number[] {
  const override = getDifficultyOverride()
  if (override !== null) return new Array(count).fill(override) as number[]
  if (MATCH.difficultyMode === 'uniform') return new Array(count).fill(centro) as number[]

  const spread = MATCH.mixedDifficultySpread
  const ranks: number[] = []
  for (let i = 0; i < count; i++) {
    // Reparto simétrico y determinista alrededor del centro: con 4 offsets
    // y 8 bots salen dos de cada escalón.
    const paso = count > 1 ? (i % 4) / 3 : 0.5
    const offset = (paso - 0.5) * 2 * spread
    ranks.push(Math.min(1, Math.max(0, centro + offset)))
  }
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

/**
 * Mapa de esta partida. `?map=NOMBRE` gana; si no vino, se usa el último
 * elegido en el panel de debug (localStorage). Se resuelve UNA vez acá,
 * antes de construir nada, porque el mapa alimenta cuatro cosas que se
 * arman una sola vez: la malla del renderer, el BVH de hitscan, el navgrid
 * de los bots y las posiciones de spawn.
 */
function resolveMapaActual(): MapDef {
  const { fromQuery, fromStorage } = fuentesDeMapa()
  return resolveMap(fromQuery, fromStorage)
}

/**
 * `mapaImportado` llega ya bajado desde ui/GameCanvas.tsx: un mapa de
 * Source son dos archivos que hay que buscar por red, y este constructor es
 * sincrónico a propósito -- arma el motor de una sola vez, con el mapa en
 * mano. null = partida en uno de los tres mapas escritos en código, que es
 * exactamente el camino de antes.
 */
export function createGame(
  canvas: HTMLCanvasElement,
  mapaImportado: MapaExternoCargado | null = null,
): Game {
  const mapaActual = mapaImportado?.def ?? resolveMapaActual()
  // El BVH de hitscan es estado de módulo (un mapa activo a la vez): hay que
  // apuntarlo al mapa de esta partida ANTES del primer disparo.
  setRaycastMap(mapaActual)

  const gfx = createRenderer(canvas, mapaActual, mapaImportado?.objeto ?? null)
  const viewmodel = createViewmodelRenderer(gfx.renderer)
  // Postprocesado (bloom) sobre el resultado combinado de mundo + viewmodel.
  // Comparte el WebGLRenderer con las dos pasadas de render: actúa DESPUÉS de
  // ellas, sobre el canvas ya dibujado (ver engine/postprocess.ts). La calidad
  // guardada se lee y se aplica una vez acá; en `off` el pipeline no toca la
  // GPU. Los render targets se crean en el primer resize (más abajo), no acá.
  const postfx = createPostFx(gfx.renderer)
  postfx.setQuality(calidadBloomInicial())
  const stats = createStatsTracker()
  const gpuTimer = createGpuTimer(gfx.gl)
  // Desglose de costo por sistema (engine/profiler.ts): "cuánto" ya lo
  // muestra `stats` de arriba, esto agrega el "qué". Instrumentación pura
  // -- ver los begin()/end() repartidos en frame() más abajo, uno por cada
  // llamada real que hace ese trabajo, y profiler.endFrame() al final del
  // archivo.
  const profiler = createProfiler()
  const tuning = createTuningPanel()
  const matchTuningPanel = createMatchTuningPanel(mapNames(), mapaActual.name)
  const loop = createFixedLoop()
  // Reparto de spawns del ARRANQUE. Se calcula antes de crear al jugador
  // porque él es el participante 0 del plan: en un mapa de Source los
  // spawns vienen agrupados por bando y pegados entre sí, y tomarlos en
  // orden dejaba a media partida dentro de la misma casa (ver
  // spreadInitialSpawns en match/respawn.ts). getBotCount() es una lectura
  // pura de la query, se la puede llamar acá arriba sin efectos.
  const spawnPlan = spreadInitialSpawns(mapaActual.spawns, 1 + getBotCount())
  const player = createPlayerState(mapaActual.spawns[spawnPlan[0]])

  applyQuickMatchOverrides()

  // Dianas de práctica (sección 6 del spec de fase 1): hitboxes reales,
  // estáticas y móviles, que stepCombat() consume tal cual consumía la
  // lista vacía que había acá antes -- el sistema de combate no cambia,
  // sólo deja de recibir un array vacío. No participan del puntaje.
  //
  // SÓLO EN MODO PRÁCTICA (`?practica=1`, ver targets/practica.ts). Se
  // construyeron en la fase 1, antes de que existieran los bots, y hasta
  // ahora seguían apareciendo durante las partidas: esferas azules sin
  // silueta humanoide mezcladas con los bots, que ensucian la lectura de a
  // qué se le puede disparar. En partida la lista va vacía, que es
  // exactamente el estado que este mismo código manejaba antes de la fase 1.
  //
  // Las dianas de plinkeo viven sobre el corredor z=6 de la arena, verificado
  // libre de geometría y blindado con un test (targets/targets.test.ts). Ese
  // corredor no existe en los otros mapas: ahí la lista va vacía aunque se
  // pida el modo práctica, en vez de dejar dianas flotando dentro de un muro.
  const targetsState = createTargets(
    mapaActual === ARENA && esModoPractica() ? createDefaultTargetDefs() : [],
  )
  const targetsRenderer = createTargetsRenderer(gfx.scene, targetsState)

  // Partida (sección "Build" de la tarea, segunda mitad de la fase 2): TDM
  // o FFA, elegido por `?mode=` (default MATCH.defaultMode). Loadout y
  // dificultad por bot en vez de un único arquetipo/rango compartido (ver
  // match/loadouts.ts y resolveDifficultyRanks más arriba) -- "todos con el
  // mismo rifle" es justo lo que pide evitar la tarea.
  // Progresión del jugador (fase 4, sección 9 del spec). Se lee ACÁ, antes
  // de crear los bots, porque la dificultad del escuadrón se deriva del
  // rango: sin el guardado en mano no se sabe contra quién se juega.
  const progressStore = createProgressStore()
  const progress = progressStore.load()
  const carreraInicial = careerFromProgress(progress)

  const matchMode = getMatchMode()
  // ROSTER COMPLETO CONTRA ROSTER ACTIVO
  //
  // El motor construye SIEMPRE el roster máximo (match/roster.ts
  // MAX_PARTICIPANTES) -- estadísticas, hitboxes, posiciones, personajes
  // dibujados, mixers de animación -- y después juega con un PREFIJO de él.
  // `rosterCompleto` no cambia nunca de largo; `bots` sí, y es el que ve
  // todo el resto de este archivo: los bucles de frame ya iteraban
  // `bots.length`, así que agregar y sacar en caliente no necesitó tocar ni
  // uno solo de ellos.
  //
  // Por qué reservar de más en vez de crecer cuando hace falta: crecer
  // significa asignar (arrays de estadísticas, cargar un personaje nuevo,
  // rearmar las listas de hitboxes enemigas) en medio de una partida, y este
  // motor tiene guards que detectan fugas de 8 bytes por frame. Reservando
  // arriba, la tecla sólo enciende un slot que ya existía.
  //
  // Y por qué el activo es un PREFIJO y no un conjunto cualquiera: el equipo
  // sale de la paridad del id, así que activar en orden pone al bot nuevo en
  // el equipo con menos gente sin necesidad de una tabla de equipos que
  // pudiera discrepar del puntaje o del color del personaje. La derivación
  // completa está en la cabecera de match/roster.ts.
  const botCount = getBotCount()
  const botArchetypes = assignBotArchetypes(MAX_BOTS)
  // Arma concreta de cada bot. El arquetipo sigue decidiendo las
  // estadísticas; el slug existe SÓLO para que el disparo del bot suene a un
  // arma y no a una familia entera (ver match/loadouts.ts). Se resuelve una
  // vez acá y no por disparo: el catálogo no cambia durante la partida.
  const botWeaponSlugs = assignBotWeaponSlugs(botArchetypes.map((a) => a.id))
  // Para el roster COMPLETO, no sólo para los que arrancan: un bot que entra
  // a mitad de partida tiene que traer su arquetipo, su arma y su dificultad
  // ya resueltos, sin recalcular nada con la partida corriendo. Las tres
  // asignaciones son cíclicas por índice (`i % n` en match/loadouts.ts y en
  // resolveDifficultyRanks), así que los primeros N de una tanda de 15 son
  // exactamente los mismos que los N de una tanda de N -- el roster inicial
  // no cambia por reservar de más.
  const botDifficultyRanks = resolveDifficultyRanks(MAX_BOTS, careerDifficulty(carreraInicial))
  // Los bots toman los spawns 1..N del MISMO plan que ubicó al jugador
  // (spawnPlan, arriba), no `spawns.slice(1)`. El slice repartía en el
  // orden en que el mapper los escribió, que en nuketown es "los 16 de una
  // casa primero": con 5 bots, cuatro arrancaban a menos de 5 m del
  // jugador. El plan los separa lo más posible entre sí.
  const rosterCompleto: BotState[] = createMatchBots(
    spawnPlan.slice(1).map((i) => mapaActual.spawns[i]),
    botArchetypes,
    botDifficultyRanks,
  )
  // El prefijo activo. Es un array MUTABLE (push/pop) y es el que ve el
  // resto del archivo -- de ahí que agregar y sacar bots no haya requerido
  // cambiar ningún bucle de frame. Nunca se reasigna ni se copia: el
  // push/pop pasa sólo al apretar una tecla, jamás por frame.
  const bots: BotState[] = rosterCompleto.slice(0, botCount)

  // Navgrid horneado UNA vez desde la arena real -- nunca se recalcula en
  // frame().
  const botGrid = buildNavGrid(mapaActual)
  const botWorld = createBotWorld(mapaActual.boxes, raycastMap, botGrid, mapaActual.convexes)
  // El equipo de cada bot sale de la MISMA función que usa el puntaje
  // (match/types.ts): el color que ve el jugador y el bando que decide si
  // hay fuego amigo no pueden salir de dos fuentes distintas o el juego
  // mentiría sobre a quién se le puede disparar.
  //
  // Se arma para el roster COMPLETO: el personaje y su tinte de equipo se
  // cargan una vez al arrancar, así que un bot que entra a mitad de partida
  // ya tiene su malla lista y no dispara ninguna carga con el juego
  // corriendo. `sync()` dibuja los primeros `bots.length` y esconde el resto
  // -- ese bucle final ya existía en bots/renderer.ts para los bots que
  // sobran, y es exactamente el comportamiento que hacía falta acá, así que
  // ese archivo no se tocó.
  const botTeams = rosterCompleto.map((_, i) => teamForParticipant(matchMode, i + 1))
  const botsRenderer = createBotsRenderer(gfx.scene, rosterCompleto, botTeams)

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
  // Dimensionado por el roster COMPLETO, no por el que está en cancha: todo
  // lo que se indexa por id de participante (estadísticas, posiciones,
  // invulnerabilidad, historial de spawns, medallas) tiene que tener slot
  // para un bot que todavía no entró Y conservar el del que ya salió. Ésa es
  // la razón de que el marcador sobreviva a que cambie la cantidad de
  // jugadores a mitad de partida: los kills de un bot que se fue siguen
  // estando en `matchState.participants[su id]`, porque ese array nunca se
  // reindexa ni se compacta.
  const participantCount = MAX_PARTICIPANTES
  const playerHealth = createBotHealthState(BOTS.maxHealth)
  const matchState: MatchState = createMatchState(matchMode, participantCount, MATCH)
  const matchTargets: MatchTargets = createMatchTargets(matchMode, participantCount)
  // Medallas de gesta (match/medal-tracker.ts): consume los MISMOS eventos
  // que el killfeed y el puntaje -- no vuelve a detectar nada por su cuenta.
  // `medalKill` es un struct reusado: registrar una baja no puede asignar.
  const medalTracker = createMedalTracker(matchMode, participantCount, PLAYER_ID)
  const medalKill = createKillContext()
  const invulnerableUntilS: number[] = new Array(participantCount).fill(-Infinity) as number[]
  const botWasAlive: boolean[] = new Array(MAX_BOTS).fill(true) as boolean[]
  // Spawn elegido por cada bot muerto, para anotarlo en el historial recién
  // cuando revive. Int32Array preasignado: se escribe por tick, nunca asigna.
  const botSpawnIndex = new Int32Array(MAX_BOTS)
  // Scratch de posiciones enemigas para pickFarthestSpawn (match/respawn.ts):
  // tamaño máximo (participantCount - 1), reusado cada tick sin reasignar
  // -- ver fillEnemyPositions más abajo.
  const enemyPositionsScratch: Vec3[] = []
  for (let i = 0; i < participantCount; i++) enemyPositionsScratch.push(vec3())
  // Mismo scratch, pero para los COMPAÑEROS vivos: el maximin de
  // pickFarthestSpawn sólo mira enemigos, así que sin esto todos los
  // compañeros que reaparecen con el mismo cuadro de enemigos eligen el
  // mismo punto y salen apilados (ver el comentario de la función).
  const allyPositionsScratch: Vec3[] = []
  for (let i = 0; i < participantCount; i++) allyPositionsScratch.push(vec3())
  // Historial de spawns recién usados, compartido por todos los
  // participantes: se crea una vez por partida, nunca asigna después.
  const spawnHistory = createSpawnHistory(participantCount)

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

  /** Igual que fillEnemyPositions pero con los compañeros vivos de `selfId`
   *  (mismo equipo, sin contarlo a él). Cero asignaciones. */
  function fillAllyPositions(selfId: number): number {
    let count = 0
    for (let id = 0; id < participantCount; id++) {
      if (id === selfId) continue
      if (!matchTargets.alive[id]) continue
      if (isEnemy(matchMode, selfId, id)) continue
      const p = matchTargets.positions[id]
      const slot = allyPositionsScratch[count]
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
  rosterCompleto.forEach((bot, i) => {
    for (const hitbox of bot.hitboxes) hitbox.owner = targetCount + (i + 1)
  })

  const allCombatantHitboxes: Hitbox[] = [playerHitboxes[0], playerHitboxes[1]]
  for (const bot of rosterCompleto) allCombatantHitboxes.push(...bot.hitboxes)

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

  // Orientación 2D (forward derivado del yaw) de cada participante, indexada por
  // Hitbox.owner IGUAL que playerShotHitboxes, para que stepMelee decida el
  // backstab del cuchillo. Se preasigna una vez (un Vec3 por ranura de owner) y
  // se reescribe in place cada frame con cuchillo equipado -- cero asignaciones
  // por frame. Las ranuras de diana (owner < targetCount) quedan en (0,0,0): una
  // diana sin orientación nunca recibe backstab (ver resolveMeleeHit). El largo
  // cubre hasta el owner más alto: targetCount + (bots.length) para el último bot.
  const ownerForward: Vec3[] = []
  for (let i = 0; i < targetCount + bots.length + 1; i++) ownerForward.push(vec3())

  // ---- Bots que entran y salen a mitad de partida ----
  //
  // La lógica vive en match/roster-vivo.ts, no acá: `createGame` necesita un
  // canvas y una GPU, así que nada definido adentro se puede ejercitar en un
  // test -- y el borde que esta tarea tenía que cuidar (que el marcador
  // sobreviva a que cambie la cantidad de jugadores) es justo el que hay que
  // poder probar a mano. `bots` es el mismo array que `rosterVivo.activos`,
  // por referencia: los bucles de frame de más abajo lo siguen recorriendo
  // sin enterarse de que ahora puede crecer y encogerse.
  //
  // Ranked no deja tocarlo: su roster es parte de lo que hace comparables
  // dos partidas rankeadas entre sí (ver match/configuracion.ts).
  const rosterVivo = crearRosterVivo(
    rosterCompleto,
    bots,
    matchTargets,
    botWasAlive,
    getPermiteEditarRoster(),
  )

  // Sistema de feedback (sección 5 del spec de fase 1): un solo estado
  // preasignado, una capa de DOM imperativo para pintarlo y un controlador
  // de audio aparte (Web Audio real, no cabe en un estado puro). Ver
  // feedback/feedback.ts para por qué el audio queda afuera del estado.
  const feedbackState = createFeedbackState()
  const feedbackOverlay = createFeedbackOverlay()
  const feedbackAudio = createFeedbackAudio()

  // Audio de arma (samples reales) y efectos de disparo (fase 5). El audio
  // de hitmarker de arriba sigue siendo procedural y no se toca: son dos
  // controladores separados a propósito, cada uno con su AudioContext y su
  // grafo (ver la cabecera de feedback/gun-audio.ts).
  const weaponAudio = createWeaponAudio()
  const vfxState = createVfxState()
  const vfxRenderer = createVfxRenderer(gfx.scene)
  // Momento en que empezó la recarga en curso, para detectar el flanco de
  // subida: startReload() es idempotente y no avisa si arrancó una nueva,
  // así que el sonido se dispara mirando la transición de vmState.reloading.
  let recargando = false
  // Flanco del draw, para lanzar el clip importado de sacar el arma una sola
  // vez. Mismo patrón que `recargando`: `startDraw` es idempotente y no avisa
  // si arrancó uno nuevo, así que el disparador se cuelga de la transición.
  let dibujando = false
  let tiempoVfxS = 0

  // Scratch preasignado para proyectar el punto de impacto a pantalla
  // (sección 5: número de daño flotante en el punto de impacto). Nunca se
  // reasigna, sólo se muta dentro de frame().
  const scratchHitPoint = vec3()
  /** Boca aproximada del arma, origen de los trazadores. Ver posicionBoca(). */
  const scratchMuzzle = vec3()
  const scratchScreenPoint: ScreenPoint = { x: 0, y: 0, visible: false }

  // Multiplicador de sensibilidad por ADS (sección 4 del spec de fase 1):
  // se lee en vivo desde el callback de createInputSystem, así que tiene
  // que existir antes de esa llamada. frame() lo actualiza cada frame con
  // el valor interpolado de combat/ads.ts.
  let sensMultiplier = 1
  // Ya no es `const`: el menú de pausa muestra el conversor de sensibilidad
  // (ui/SensitivitySettings.tsx) DENTRO de la partida, y ese panel guarda en
  // localStorage al instante. Sin poder releerlo, el jugador movería la
  // sensibilidad, cerraría el menú y la cámara seguiría girando exactamente
  // igual: un control que no hace nada, que es peor que no tener el control.
  // Se relee al cerrar el menú (`recargarSensibilidad`), no por movimiento
  // de mouse -- leer localStorage en cada `mousemove` sería absurdo.
  let sensBase = sensibilidadBase()
  const input = createInputSystem(() => sensBase * sensMultiplier)

  /**
   * Deja al jugador mirando hacia donde el mapper apuntó ese spawn. Sin
   * esto todos aparecen con yaw 0 (mirando a -Z), que en nuketown es
   * perpendicular al eje del mapa: 27 de los 32 spawns quedan mirando al
   * vacío fuera de la zona jugable en vez de a la calle por donde viene el
   * enemigo. Es una escritura, no una animación: el jugador todavía no
   * movió el mouse, así que no le estamos sacando el control de la cámara.
   *
   * Un mapa sin `spawnYaws` (los tres escritos en código, o un JSON de un
   * conversor viejo) no toca el yaw y se comporta igual que antes.
   */
  function mirarComoElSpawn(spawnIndex: number): void {
    const yaws = mapaActual.spawnYaws
    if (yaws === undefined) return
    const yaw = yaws[spawnIndex]
    if (yaw === undefined) return
    input.player.yaw = yaw
  }

  mirarComoElSpawn(spawnPlan[0])

  // Estado del viewmodel: todo preasignado una sola vez acá. El frame loop
  // sólo muta estos objetos, nunca crea uno nuevo (presupuesto de cero
  // asignaciones, sección 2 del spec).
  const vmState = createViewmodelState()
  const vmInput: ViewmodelInput = {
    speed: 0, grounded: false, ads: false, mouseDeltaX: 0, mouseDeltaY: 0,
    clipDriven: false,
  }
  const vmOut: VmTransform = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }
  // Pose del cargador durante la recarga. Preasignada por el mismo motivo que
  // vmOut: se muta cada frame, nunca se reemplaza.
  const vmMag = createMagTransform()
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

  // Estado de la rama MELEE (cuchillo): preasignado UNA vez igual que el
  // combate de fuego, porque comparte la misma regla de "cero asignaciones por
  // golpe/frame" (combat/melee.ts). El arquetipo inicial es un valor de arranque
  // -- `meleeArchetypeId` empieza en null, así que el primer frame con un
  // cuchillo realmente equipado resetea el estado a los datos de esa arma.
  const meleeState: MeleeState = createMeleeState(KNIFE_ARCHETYPE)
  let meleeArchetypeId: string | null = null
  const meleeResult = createMeleeResult()
  const meleeInput: MeleeInput = {
    slashHeld: false,
    stabHeld: false,
    // Misma referencia viva a la cámara del mundo que combatInput.origin: el
    // golpe sale del ojo del jugador, no de la hoja (igual que el disparo).
    origin: gfx.camera.position,
    pitch: 0,
    yaw: 0,
  }

  /** Duración a la que se estira el clip 'fire' del cuchillo en cada golpe. El
   *  clip original dura ~1.3 s; comprimirlo así hace que el tajo/estocada se
   *  vea y termine antes del próximo golpe, y que una ráfaga de tajos (cadencia
   *  0.4 s) reinicie la animación en cada swing en vez de arrastrar el anterior. */
  const SWING_CLIP_S = 0.35

  /** Vuelca un MeleeResult en un ShotResult para reusar el pipeline de daño,
   *  hitmarker y número de daño de un disparo. MeleeResult es un superconjunto
   *  de ShotResult, así que es copia de campos, sin asignar. */
  function copiarMeleeAShot(m: MeleeResult, s: ShotResult): void {
    s.hit = m.hit
    s.distance = m.distance
    s.damage = m.damage
    s.part = m.part
    s.pointX = m.pointX
    s.pointY = m.pointY
    s.pointZ = m.pointZ
    s.normalX = m.normalX
    s.normalY = m.normalY
    s.normalZ = m.normalZ
    s.surface = m.surface
    s.owner = m.owner
  }

  /** Forward 2D desde un yaw, con la MISMA convención que computeForward
   *  (combat/shot.ts): (x,z) = (-sin yaw, -cos yaw). El backstab es un cálculo
   *  2D (resolveMeleeHit proyecta a XZ), así que la componente Y va en 0. */
  function setForward2D(v: Vec3, yaw: number): void {
    v.x = -Math.sin(yaw)
    v.y = 0
    v.z = -Math.cos(yaw)
  }

  // Loadout del jugador (fase 3, sección 6 del spec: un arma primaria y una
  // secundaria). Se lee UNA vez al crear la partida y la ranura arranca en
  // la primaria, así que el arma con la que el jugador spawnea es la que
  // eligió.
  //
  // Ya no es `const`: el menú de pausa puede cambiar el arma de una ranura
  // sin salir a la armería (equipEnPartida, más abajo). `equipWeapon`
  // devuelve un loadout NUEVO en vez de mutar el que le pasan --
  // progression/loadout.ts es puro a propósito-- así que la referencia de
  // acá tiene que poder reapuntar.
  const nivel = accountLevel(progress)
  let loadout = progress.loadout

  /**
   * Resultado de progresión de esta partida, o null mientras siga viva.
   * Lo lee la UI (src/ui/MatchSummary.tsx) para mostrar el cambio de RR, la
   * ceremonia de ascenso y el drop de skin.
   */
  let matchProgress: MatchProgress | null = null
  let medallasDeLaPartida: MedalTally | null = null

  /**
   * Acumulado de XP por arma de ESTA partida (progression/weapon-xp.ts). Se
   * crea una sola vez y se llena desde el camino del disparo, que por eso no
   * puede asignar: los buffers ya están reservados acá.
   */
  const weaponTally = createWeaponTally()

  /** Qué le pasó a cada arma usada en la partida. Lo lee la UI del resumen
   *  para mostrar la barra del arma y los camos de maestría ganados. */
  let weaponXp: WeaponXpOutcome[] = []

  /**
   * Cobra la partida terminada: aplica RR (o colocación), XP y drop sobre
   * el guardado, y persiste. Se llama exactamente una vez por partida
   * (ver el guard en frame()).
   *
   * Toda la matemática vive en progression/career.ts, que es puro y
   * testeado; acá sólo se arma la actuación del jugador desde el puntaje y
   * se guarda el resultado. Si `save` falla (cuota, almacenamiento
   * bloqueado) el jugador igual ve su resumen: perder el guardado no puede
   * costar también la pantalla de recompensa.
   */
  function cerrarPartida(): void {
    const summary = buildSummary(matchState, MATCH)
    const perf = performanceFromStats(
      matchState.participants[PLAYER_ID],
      summary.durationS,
      playerWon(matchState),
    )
    // El mapa y el modo no viajan en `MatchPerformance` (que es sólo la
    // actuación del jugador) pero sí los necesita el historial de la pantalla
    // de carrera: "‑12 RR" sin saber dónde ni en qué modo no dice nada.
    const resultado = applyMatchResult(careerFromProgress(progress), perf, {
      mapa: mapaActual.name,
      modo: summary.mode,
    })
    matchProgress = resultado.progress

    // XP de arma: va aparte de la carrera a propósito. No toca rango ni RR
    // (son ejes separados), así que se aplica sobre el guardado ya
    // actualizado por la carrera en vez de mezclarse con applyMatchResult.
    const armas = applyWeaponXp(progress.armas, weaponTally)
    weaponXp = armas.outcomes

    // Medallas: se cierra el tracker y se acumulan sobre el histórico. Van
    // por separado de la carrera a propósito -- suman XP de cuenta (cuánto
    // jugaste) y NO tocan el RR (qué tan bien jugás). Ver progression/xp.ts
    // sobre por qué esas dos escaleras no se cruzan.
    finalizarMedallas(medalTracker)
    medallasDeLaPartida = tallyDeMedallas(medalTracker)

    // UN SOLO guardado que compone las tres capas, y el orden importa poco
    // pero el anidado importa mucho: cada `progressWith*` devuelve un
    // guardado nuevo a partir del que recibe. Dos llamadas separadas a
    // `save()`, cada una partiendo de `progress`, harían que la última pise
    // a la anterior y se pierda una capa entera -- la XP de arma se
    // guardaría y la sobreescribiría el guardado de medallas medio
    // milisegundo después, sin ningún error.
    progressStore.save(
      progressWithMedals(
        progressWithWeaponXp(progressWithCareer(progress, resultado.data), armas.armas),
        medallasDeLaPartida,
      ),
    )

    // Soltar el puntero al terminar la partida. El resumen (ui/MatchSummary)
    // tiene botones y una caja que se abre con un click: con el mouse
    // todavía capturado por el canvas, el cursor no existe y esos controles
    // son inalcanzables. Se hace acá, en la transición única a 'ended', y no
    // en frame(), para no llamar a exitPointerLock() en cada frame posterior
    // al final.
    if (typeof document !== 'undefined' && document.pointerLockElement === canvas) {
      document.exitPointerLock()
    }
  }

  let currentSlot: RanuraEnMano = 'primary'
  let currentSlug = loadout.primary.slug ?? loadout.secondary.slug ?? weaponIndex()[0]?.slug ?? null

  /**
   * `forzar` existe por el menú de pausa: cambiar el arma DE LA RANURA QUE
   * YA ESTÁ EN MANO deja `slug === currentSlug` en falso sólo si el slug es
   * distinto, pero volver a equipar la misma ranura después de un cambio de
   * skin, o re-aplicar tras editar el loadout, sí cae en el early-return. Es
   * el mismo guard que evita que apretar "1" con la primaria en mano
   * reinicie la animación de draw en cada pulsación, así que no se saca: se
   * hace saltar explícitamente desde equipEnPartida.
   */
  function equipSlot(slot: RanuraEnMano, forzar = false): void {
    // Slot 3 = cuchillo FIJO: su slug es la constante MELEE_SLUG, no algo del
    // loadout persistido (no se elige). Sin skin: el cuchillo base no la tiene.
    const slug = slot === 'melee' ? MELEE_SLUG : loadout[slot].slug
    if (slug === null) return
    if (!forzar && slug === currentSlug) return
    currentSlot = slot
    currentSlug = slug
    if (slot === 'melee') {
      // El cuchillo no lleva aspecto ni accesorios: sin skin, sin camo, sin mira.
      viewmodel.setSkin(null)
      viewmodel.setOptic(null)
    } else {
      // Camo por textura y skin procedural son EXCLUYENTES en el loadout: si hay
      // camo equipado gana; si no, va la skin (o null = aspecto de fábrica).
      const camo = camoForSlot(loadout, slot)
      if (camo) viewmodel.setCamo(camo)
      else viewmodel.setSkin(skinForSlot(loadout, slot))
      // La mira es un accesorio FÍSICO, independiente del aspecto: se monta
      // tenga el arma camo, skin o los hierros, así que este llamado va SIEMPRE
      // aparte del branch de arriba.
      viewmodel.setOptic(opticForSlot(loadout, slot)?.id ?? null)
    }
    viewmodel.setWeaponSlug(slug)
    // Bajar el sonido propio del arma al equiparla, no al dispararla: así
    // el primer tiro ya sale con su firma sonora en vez de con el sample
    // genérico de la clase (ver feedback/gun-audio.ts).
    weaponAudio.prewarm(slug)
    startDraw(vmState, rigWeapon)
    // Acá y no en cada llamador: que el nombre y el cargador que muestra el
    // HUD salgan del MISMO punto que cambia el arma es lo que garantiza que
    // no puedan desincronizarse. Un HUD que dice "AK-47" con una pistola en
    // mano es peor que no tener HUD.
    refrescarDatosDeHud()
  }

  if (currentSlug) {
    // Aspecto y mira iniciales, mismo branch que equipSlot. currentSlot arranca
    // en 'primary' (nunca el cuchillo), así que va directo sin guard de melee.
    const camo = camoForSlot(loadout, currentSlot)
    if (camo) viewmodel.setCamo(camo)
    else viewmodel.setSkin(skinForSlot(loadout, currentSlot))
    viewmodel.setOptic(opticForSlot(loadout, currentSlot)?.id ?? null)
    viewmodel.setWeaponSlug(currentSlug)
    weaponAudio.prewarm(currentSlug)
  }

  /**
   * Nombre de catálogo de un slug ("AK-47"), o cadena vacía si la ranura
   * está vacía o el slug no está en el índice.
   *
   * Existe para que `readHud` NUNCA arme una cadena: el HUD corre a 240 Hz
   * y `weaponIndex().find(...)` por frame sería tanto un recorrido lineal
   * sobre 79 entradas como -- peor -- una fuente de basura. Se resuelve al
   * equipar, que pasa un puñado de veces por partida.
   */
  function nombreDeArma(slug: string | null): string {
    if (slug === null) return ''
    return weaponIndex().find((e) => e.slug === slug)?.name ?? slug
  }

  /**
   * Capacidad del cargador de un slug. Mismo motivo que `nombreDeArma`: se
   * cachea al equipar en vez de resolver el arquetipo por frame.
   */
  function cargadorDe(slug: string | null): number {
    if (slug === null) return 0
    // El cuchillo no tiene cargador: el HUD no debe mostrar munición de fuego
    // (si no, saldría la del arquetipo de reserva 'ar', 30 balas falsas).
    if (isMeleeSlug(slug)) return 0
    return ARCHETYPES[resolveArchetypeId(slug)].magazine
  }

  // Datos derivados del loadout que el HUD lee cada frame. Se recalculan
  // SÓLO cuando el loadout o la ranura cambian (ver refrescarDatosDeHud):
  // el camino de frame los copia y nada más.
  let hudWeaponName = nombreDeArma(currentSlug)
  let hudMagazine = cargadorDe(currentSlug)
  let hudPrimaryName = nombreDeArma(loadout.primary.slug)
  let hudSecondaryName = nombreDeArma(loadout.secondary.slug)
  // Nombre del cuchillo del slot 3: es FIJO (siempre el mismo), así que se
  // resuelve una vez y no se recalcula en refrescarDatosDeHud.
  const hudMeleeName = nombreDeArma(MELEE_SLUG)

  function refrescarDatosDeHud(): void {
    hudWeaponName = nombreDeArma(currentSlug)
    hudMagazine = cargadorDe(currentSlug)
    hudPrimaryName = nombreDeArma(loadout.primary.slug)
    hudSecondaryName = nombreDeArma(loadout.secondary.slug)
  }

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
          refrescarDatosDeHud()
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
  // Captura de pantalla a demanda (Game.capturarPantalla). El resolver queda
  // pendiente hasta que `frame` termine de dibujar y lea el canvas; es un
  // callback y no un flag booleano para poder devolverle el data URL a quien
  // pidió la captura. `null` = no hay captura pendiente.
  let capturaPendiente: ((url: string | null) => void) | null = null
  /**
   * Partida congelada por el menú de pausa (ui/PauseMenu.tsx). Frena la
   * simulación entera, no sólo el input: sin esto, abrir el menú te deja
   * parado en el mapa mientras cinco bots te siguen disparando, que es
   * exactamente el bug que hace que un menú de pausa no sirva para nada.
   */
  let paused = false

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
    // DESPUÉS de gfx.resize: el bloom lee el tamaño del drawing buffer del
    // renderer, que recién ahí quedó actualizado. No-op con bloom en `off`.
    postfx.resize()
  }

  // Política de autoplay del navegador (sección 5 del spec: "la creación
  // del audio context tiene que estar detrás de un gesto de usuario"):
  // el primer click sobre el canvas desbloquea Web Audio. Un listener
  // aparte del que ya registra engine/input.ts para pedir el pointer lock
  // -- ambos escuchan 'click' sobre el mismo elemento sin pisarse.
  function onCanvasClickForAudio(): void {
    feedbackAudio.unlock()
    // Mismo contrato para el audio de arma: unlock() en CADA gesto, no sólo
    // el primero, porque el navegador puede suspender un contexto ya
    // desbloqueado en cualquier momento (ver la cabecera de gun-audio.ts).
    weaponAudio.unlock()
  }

  // Hook de debug para ejercitar "al recibir daño" (viñeta direccional,
  // shake, latido/desaturación) sin bots todavía (fase 2): detrás del mismo
  // gate ?debug=1 que el resto de los hooks de este archivo, así que no
  // existe en producción. H simula un golpe desde un punto fijo del mundo
  // (+Z): girar en el juego mueve visiblemente el lado de la viñeta, que es
  // justo lo que hay que poder verificar a mano en el navegador (spec,
  // "confirmá que la viñeta apunta al lado correcto"). J resetea la vida
  // para no tener que recargar la página entre pruebas.
  // Cambio de ranura del loadout: 1 primaria, 2 secundaria (fase 3, sección
  // 6 del spec). Va acá y no en engine/input.ts porque no es un estado
  // sostenido que el motor lea cada tick: es un evento puntual que cambia
  // qué arma está equipada, igual que la selección del panel de tuning.
  function onLoadoutKeyDown(e: KeyboardEvent): void {
    // Con el menú abierto las teclas 1 y 2 le pertenecen al menú (elegir
    // ranura para editar), no al arma en mano: cambiar de arma detrás de un
    // menú que muestra otra cosa deja las dos pantallas mintiendo.
    if (paused) return
    if (e.code === 'Digit1') equipSlot(LOADOUT_SLOTS[0])
    else if (e.code === 'Digit2') equipSlot(LOADOUT_SLOTS[1])
    // Tecla 3 = cuchillo. Slot FIJO, siempre presente (como en CS/COD): no
    // depende del loadout ni del nivel, equipSlot('melee') usa MELEE_SLUG.
    else if (e.code === 'Digit3') equipSlot('melee')
  }

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

  // La barra de perf (engine/stats.ts) arranca OCULTA y se enciende con F3:
  // es una herramienta de medición, no HUD de combate, así que no tiene que
  // estar siempre robándole jerarquía a la vida y la munición. F3 es idioma
  // conocido (Minecraft) y no la usa ninguna otra parte del juego (las armas
  // van en Digit1/2/3, el scoreboard en Tab, los bots en +/-). Sin gate de
  // debug: el dueño mide cuando quiere, sin recargar con ?debug=1.
  let statsVisible = false
  function onPerfKeyDown(e: KeyboardEvent): void {
    if (e.code !== 'F3') return
    e.preventDefault()
    statsVisible = !statsVisible
    stats.setVisible(statsVisible)
  }

  function frame(now: number): void {
    if (!running) return
    rafId = requestAnimationFrame(frame)

    // Pausa: se sale ANTES de stats.beginFrame() y de profiler.beginFrame()
    // a propósito. Esos dos abren una medición que sólo cierran endFrame()
    // al final de este mismo cuerpo; salir después de abrirlas dejaría un
    // frame a medio medir por cada frame pausado y ensuciaría el p95 del
    // profiler con cientos de muestras que no midieron nada.
    //
    // `lastTime = now` es lo que impide el salto: sin esto, reanudar
    // después de treinta segundos de menú entrega un dt de 30 s al primer
    // frame. sanitizeDt lo clampearía, pero el clamp es la red de
    // seguridad, no el diseño -- acá el tiempo pausado simplemente no
    // existió.
    //
    // No se dibuja nada: el compositor conserva el último cuadro
    // presentado mientras nadie limpie el buffer, así que la pantalla
    // queda congelada en el momento exacto en que se abrió el menú. Eso es
    // el fondo que queremos, y además hace que el menú cueste cero GPU.
    if (paused) {
      lastTime = now
      return
    }

    stats.beginFrame()
    profiler.beginFrame()

    const frameDt = lastTime === 0 ? 0 : (now - lastTime) / 1000
    lastTime = now
    const dt = sanitizeDt(frameDt)

    // Reloj de efectos: se acumula del dt ya saneado en vez de usar `now`
    // directo, para que un salto del reloj del navegador (pestaña en
    // segundo plano) no haga aparecer y desaparecer partículas de golpe.
    // Es el mismo valor que se le pasa a los shaders como uTime.
    tiempoVfxS += dt

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
    // ¿El arma en pantalla es MELEE (cuchillo)? Es el discriminante de la rama:
    // si lo es, el combate corre por stepMelee (combat/melee.ts) y NO por el
    // camino de arma de fuego (arquetipo de fuego / recoil / dispersión / ADS /
    // recarga). `archetype` de fuego se sigue resolviendo igual más abajo -- el
    // cuchillo cae en la clase de reserva 'ar' -- porque el bloque de VIEWMODEL
    // lo usa para dibujar el modelo; lo único que se saltea es el de COMBATE.
    const melee = shownSlug !== null && isMeleeSlug(shownSlug)
    // Eje táctico CS/COD: el arquetipo EFECTIVO ya resuelto por el estilo del
    // arma (su procedencia, no su arquetipo base). Cambia daño por bala y
    // penalización de dispersión al moverse; el id/clase/ads son los mismos, y
    // es un lookup en una tabla precomputada (cero asignaciones por frame). Las
    // CC0 y los bots caen en 'neutral' = el arquetipo base tal cual.
    const style = tacticalStyleForSlug(shownSlug)
    const archetype = shownSlug
      ? archetypeForStyle(getWeaponVisual(shownSlug).archetype, style)
      : null
    // El patrón es POR ARMA, no por arquetipo: el AK-47 y la M4A4 comparten
    // `ar-1` y aun así se disparan distinto (weapons/recoil-patterns.ts). Se
    // resuelve acá, junto al arquetipo, y no adentro de stepCombat: es una
    // búsqueda por slug que no tiene por qué repetirse por disparo.
    const recoilPattern = archetype ? resolveRecoilPattern(shownSlug, archetype) : null

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
        profiler.begin('fisica')
        stepPlayer(player, input.player, mapaActual.boxes, TICK_DT, mapaActual.convexes)
        profiler.end('fisica')
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
        const allyCount = fillAllyPositions(PLAYER_ID)
        const spawnIndex = pickFarthestSpawn(
          mapaActual.spawns,
          enemyPositionsScratch,
          enemyCount,
          allyPositionsScratch,
          allyCount,
          spawnHistory,
          matchState.elapsedS,
        )
        const revived = stepBotRespawn(playerHealth, TICK_DT, MATCH.respawnDelayS)
        if (revived) {
          // El historial se anota sólo cuando la reaparición OCURRE de
          // verdad: mientras sigue muerto, el índice se recalcula cada tick
          // y anotar cada tentativa llenaría el anillo con un mismo punto
          // que todavía no usó nadie.
          recordSpawnUse(spawnHistory, spawnIndex, matchState.elapsedS)
          const spawn = mapaActual.spawns[spawnIndex]
          player.position.x = spawn.x
          player.position.y = spawn.y
          player.position.z = spawn.z
          player.prevPosition.x = spawn.x
          player.prevPosition.y = spawn.y
          player.prevPosition.z = spawn.z
          player.velocity.x = 0
          player.velocity.y = 0
          player.velocity.z = 0
          // Mismo criterio que al arrancar: reaparecer mirando hacia donde
          // el spawn apunta. Reaparecer conservando el yaw de la muerte
          // deja al jugador mirando hacia donde lo mataron, que en otro
          // punto del mapa no significa nada.
          mirarComoElSpawn(spawnIndex)
          resetPlayerHealth(feedbackState.health)
          invulnerableUntilS[PLAYER_ID] = invulnerabilityExpiresAt(matchState.elapsedS, MATCH.respawnInvulnerabilityS)
          // Vida nueva: reinicia el reloj de supervivencia de "sin morir".
          registrarReaparicionMedallas(medalTracker, PLAYER_ID)
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
          const allyCount = fillAllyPositions(b + 1)
          const spawnIndex = pickFarthestSpawn(
            mapaActual.spawns,
            enemyPositionsScratch,
            enemyCount,
            allyPositionsScratch,
            allyCount,
            spawnHistory,
            matchState.elapsedS,
          )
          // Se guarda para anotarlo en el historial recién cuando el bot
          // REVIVA de verdad (más abajo): acá todavía es una tentativa que
          // se recalcula cada tick.
          botSpawnIndex[b] = spawnIndex
          const spawn = mapaActual.spawns[spawnIndex]
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
      profiler.begin('ia')
      stepMatchBotsThink(bots, botWorld, matchTargets, TICK_DT)
      profiler.end('ia')
      profiler.begin('fisica')
      stepAllBotsMotor(bots, botWorld, TICK_DT)
      profiler.end('fisica')

      for (let b = 0; b < bots.length; b++) {
        const bot = bots[b]
        matchTargets.positions[b + 1].x = bot.player.position.x
        matchTargets.positions[b + 1].y = bot.player.position.y + bot.player.eyeHeight
        matchTargets.positions[b + 1].z = bot.player.position.z
        matchTargets.alive[b + 1] = bot.health.alive
        if (!botWasAlive[b] && bot.health.alive) {
          invulnerableUntilS[b + 1] = invulnerabilityExpiresAt(matchState.elapsedS, MATCH.respawnInvulnerabilityS)
          registrarReaparicionMedallas(medalTracker, b + 1)
          // Reaparición consumada: recién ahora el punto queda "usado" y
          // empieza a penalizar a quien reaparezca en los próximos
          // segundos (match/respawn.ts RECENT_WINDOW_S).
          recordSpawnUse(spawnHistory, botSpawnIndex[b], matchState.elapsedS)
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
      // For indexado y no for-of: esto corre por bot y por frame, y el
      // iterador de for-of asigna (ver bots/allocations.test.ts).
      if (isInvulnerable(invulnerableUntilS[b + 1], matchState.elapsedS)) {
        for (let h = 0; h < bot.hitboxes.length; h++) bot.hitboxes[h].radius = 0
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
    // Estampa de visor (feedback/scope.ts): qué retícula lleva esta arma y
    // cuán entrada está. Se suben a este alcance (en vez de quedarse en el
    // bloque de ADS) porque hacen falta en dos lugares más abajo — esconder
    // el arma antes del render, y pintar la capa de DOM al final del frame.
    // Son un número y una referencia a string en el stack: no asignan nada.
    let easedAdsTForScope = 0
    let scopeReticleNow: ScopeReticle | null = null
    // Cuántos disparos resolvió stepCombat() este frame: se usa después de
    // este bloque (feedback de disparo/impacto), así que vive afuera del
    // `if` en vez de quedar atrapado en un `const` de bloque.
    let shotsFired = 0

    if (shownSlug && archetype && !melee) {
      profiler.begin('viewmodel')
      syncRigWeapon(rigWeapon, getWeaponVisual(shownSlug))
      profiler.end('viewmodel')

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
      // Velocidad horizontal del jugador para la dispersión por movimiento del
      // eje CS/COD (mismo valor que alimenta el bob del viewmodel más abajo):
      // parado no penaliza, moviéndote sí, y cuánto depende del estilo.
      combatInput.moveSpeed = Math.hypot(player.velocity.x, player.velocity.z)
      profiler.begin('combate')
      shotsFired = stepCombat(
        combatState,
        archetype,
        combatInput,
        playerShotHitboxes,
        dt,
        shotResult,
        recoilPattern ?? undefined,
      )
      profiler.end('combate')

      // Culatazo del arma (weapons/viewmodel/rig.ts: fire(), sección "qué
      // existe" del spec) + punch de cámara (feedback/camera-punch.ts,
      // sección 5) por cada disparo real que salió este frame -- no por
      // frame: un frame largo que se puso al día con más de un disparo
      // (fire-control.ts) tiene que sentir cada uno, no sólo el último.
      profiler.begin('feedback')
      for (let i = 0; i < shotsFired; i++) {
        fire(vmState, rigWeapon)
        onShotFired(feedbackState)

        // Audio y VFX del disparo, en el MISMO frame en que el disparo se
        // resolvió: nada de esto se encola ni se difiere. El sample arranca
        // con start() sin offset, así que el sonido sale con el fotograma.
        // El slug elige el sample propio del arma; la clase es la red de
        // seguridad cuando ese sample no está (ver feedback/gun-audio.ts).
        weaponAudio.playShot(shownSlug, archetype.class)
        spawnFulgor(vfxState, tiempoVfxS)

        // El trazador NO sale de la cámara aunque el hitscan sí (ver
        // combat/shot.ts): uno que nace en el ojo del jugador se ve brotar
        // del centro de la pantalla y delata el truco. Se lo corre a una
        // boca aproximada -- adelante, a la derecha y algo abajo del ojo --
        // que es donde el viewmodel dibuja el arma. Converge igual al mismo
        // punto de impacto, así que no miente sobre dónde pegó.
        //
        // Se calcula acá y no pidiéndole la boca real al viewmodel porque
        // ese modelo vive en la escena del viewmodel (cámara propia en el
        // origen, segunda pasada) y su posición sólo se convierte a mundo
        // con la rotación de cámara de ESTE frame, que todavía no se fijó
        // en este punto del loop. La aproximación evita ese desfasaje.
        posicionBoca(combatInput.origin, shotResult, scratchMuzzle)
        spawnTrazador(
          vfxState,
          scratchMuzzle.x,
          scratchMuzzle.y,
          scratchMuzzle.z,
          shotResult.pointX,
          shotResult.pointY,
          shotResult.pointZ,
          tiempoVfxS,
        )

        if (shotResult.hit) {
          const carne = shotResult.surface === 'carne'
          spawnImpacto(
            vfxState,
            shotResult.pointX,
            shotResult.pointY,
            shotResult.pointZ,
            shotResult.normalX,
            shotResult.normalY,
            shotResult.normalZ,
            carne ? SUPERFICIE_CARNE : SUPERFICIE_HORMIGON,
            tiempoVfxS,
          )
          weaponAudio.playImpact(carne ? SUPERFICIE_CARNE : SUPERFICIE_HORMIGON)
          // Sólo las superficies duras dejan marca: una calcomanía sobre un
          // bot quedaría flotando en el aire en cuanto el bot se mueva.
          if (!carne) {
            spawnCalcomania(
              vfxState,
              shotResult.pointX,
              shotResult.pointY,
              shotResult.pointZ,
              shotResult.normalX,
              shotResult.normalY,
              shotResult.normalZ,
              tiempoVfxS,
            )
          }
        }
      }
      profiler.end('feedback')

      // R sostenida: startReload() es un no-op mientras ya hay una recarga
      // en curso (ver el comentario de esa función en rig.ts), así que
      // llamarla en cada frame con la tecla sostenida no la deja en
      // deadlock. Corre DESPUÉS de que combat ya leyó reloading arriba,
      // por la razón de encima.
      if (input.reloadHeld) startReload(vmState, rigWeapon)

      // Flanco de subida de la recarga: startReload() es idempotente y no
      // avisa si arrancó una nueva, así que el sonido se cuelga de la
      // transición false -> true. Sin esto, con R sostenida el sample se
      // relanzaría en cada frame.
      if (vmState.reloading && !recargando) {
        weaponAudio.playReload(archetype.class)
        // La recarga de CS se estira o comprime al `reloadTime` del arma para
        // que la animación y el estado de juego terminen juntos (ver playClip).
        viewmodel.playClip('reload', vmState.reloadTime)
      }
      recargando = vmState.reloading

      if (vmState.drawing && !dibujando) viewmodel.playClip('draw', vmState.drawTime)
      dibujando = vmState.drawing

      finalPitch = cameraPitch(combatState, input.pitch)
      finalYaw = cameraYaw(combatState, input.player.yaw)

      // ADS: FOV y sensibilidad (velocidad ya se aplicó arriba, antes del
      // loop de ticks). Misma curva de easing que la pose visual del arma
      // (easeInOutCubic, rig.ts), para que los tres terminen de moverse
      // exactamente cuando el arma termina de moverse.
      const easedAdsT = easeInOutCubic(vmState.adsT)
      gfx.setFov(adsFov(WORLD_FOV, archetype.ads, easedAdsT))
      sensMultiplier = adsSensitivityMultiplier(archetype.ads, easedAdsT)
      easedAdsTForScope = easedAdsT
      // El criterio completo (y por qué es la conjunción de arquetipo y
      // propiedad del arma) vive en scopeReticleForWeapon(). Para todo lo
      // que no sea precisión CON óptica esto es null y nada más abajo se
      // activa: el ADS de hierros no cambia ni un píxel.
      scopeReticleNow = scopeReticleForWeapon(archetype.id, sightForSlug(shownSlug))
    } else if (shownSlug && melee) {
      // ── Rama MELEE (cuchillo) ────────────────────────────────────────────
      // No pasa por stepCombat: un cuchillo no tiene cargador, recoil,
      // dispersión ni ADS. Corre stepMelee (combat/melee.ts) con su propio
      // estado de cooldown, y el resultado se vuelca en `shotResult` para reusar
      // EXACTAMENTE el mismo pipeline de daño / hitmarker / número de daño de
      // más abajo -- MeleeResult es un superconjunto de ShotResult a propósito.
      profiler.begin('viewmodel')
      syncRigWeapon(rigWeapon, getWeaponVisual(shownSlug))
      profiler.end('viewmodel')

      const meleeArch = getMeleeArchetype(shownSlug)
      if (meleeArch) {
        // Reinicio del estado melee al cambiar de arma (mismo criterio que
        // combatArchetypeId con las de fuego): listo para golpear, sin cadena de
        // tajos consecutivos heredada del arma anterior.
        if (meleeArchetypeId !== meleeArch.id) {
          resetMeleeState(meleeState, meleeArch)
          meleeArchetypeId = meleeArch.id
        }

        // Orientación 2D de cada participante para el backstab, derivada del yaw
        // que ya tenemos: el del jugador (mouse) y el de cada bot (su aimMotor).
        // For indexado y no for-of: corre por bot y por frame (bots/allocations).
        setForward2D(ownerForward[targetCount + PLAYER_ID], input.player.yaw)
        for (let b = 0; b < bots.length; b++) {
          setForward2D(ownerForward[targetCount + (b + 1)], bots[b].aimMotor.yaw)
        }

        // Clic izquierdo = tajo; clic derecho = estocada. El cuchillo NO apunta,
        // así que el botón derecho -- que en las de fuego es ADS -- acá estoca (y
        // el ADS queda suprimido más abajo, en el bloque de viewmodel). Muerto no
        // ataca, mismo criterio que el trigger de fuego.
        meleeInput.slashHeld = (input.fireHeld || debugFireHeld) && playerHealth.alive
        meleeInput.stabHeld = (input.adsHeld || debugAdsHeld) && playerHealth.alive
        meleeInput.pitch = input.pitch
        meleeInput.yaw = input.player.yaw

        profiler.begin('combate')
        const golpeo = stepMelee(
          meleeState,
          meleeArch,
          meleeInput,
          playerShotHitboxes,
          ownerForward,
          dt,
          meleeResult,
        )
        profiler.end('combate')

        if (golpeo) {
          // Salió un golpe este frame (haya o no conectado con carne): kick
          // procedural del viewmodel + clip 'fire' con la animación de tajo /
          // estocada. El clip es LoopOnce y vuelve solo a idle al terminar
          // (renderer.advanceAnimation), así que spamear no lo deja pegado.
          profiler.begin('feedback')
          fire(vmState, rigWeapon)
          viewmodel.playClip('fire', SWING_CLIP_S)
          profiler.end('feedback')

          // Vuelca el golpe en shotResult y enciende shotsFired: el bloque de
          // daño de abajo lo aplica igual que un disparo (applyHit / damageBot +
          // hitmarker). Si el golpe fue al aire o a una pared, meleeResult.hit es
          // false y ese bloque no aplica nada -- el guard es el mismo.
          copiarMeleeAShot(meleeResult, shotResult)
          shotsFired = 1
        }
      }

      // Draw del cuchillo al equiparlo (espejo del disparo de 'draw' del bloque
      // de fuego, que acá quedó fuera del alcance de ese `if`).
      //
      // A VELOCIDAD NATIVA (segundos = 0), no estirado a `drawTime`: el cuchillo
      // no tiene arquetipo de fuego propio y hereda el `drawTime` de la clase
      // inferida (ar, 0,3 s), pero su clip de "sacar" mide ~1 s. Comprimirlo a
      // 0,3 s lo convertía en un parpadeo (~3,3x). El draw del cuchillo es
      // puramente cosmético —no hay ventana de juego que dependa de su
      // duración, a diferencia de la recarga— así que se reproduce como lo
      // animaron: se saca como un cuchillo, no de un pestañeo.
      if (vmState.drawing && !dibujando) viewmodel.playClip('draw', 0)
      dibujando = vmState.drawing

      // Sin recoil ni ADS: la cámara final es la del mouse tal cual (finalPitch
      // y finalYaw ya arrancan en input.pitch / input.player.yaw más arriba).
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
      profiler.begin('combate')
      const botShots = stepBotCombat(bot, enemyHitboxesFor[i + 1], dt)
      profiler.end('combate')
      if (botShots > 0) {
        profiler.begin('feedback')
        registerGunshot(botWorld.shots, bot.combatInput.origin, botWorld.simTimeS)

        // Disparo de bot: se oye atenuado por distancia al jugador y deja
        // trazador e impacto igual que el del jugador -- ver de dónde te
        // están tirando es información de combate, no adorno. El fulgor no
        // se replica: cuelga del viewmodel, que es sólo del jugador.
        const bdx = bot.player.position.x - player.position.x
        const bdy = bot.player.position.y - player.position.y
        const bdz = bot.player.position.z - player.position.z
        const bdist = Math.sqrt(bdx * bdx + bdy * bdy + bdz * bdz)
        const ganancia = gananciaPorDistancia(bdist)
        if (ganancia > 0) weaponAudio.playShot(botWeaponSlugs[i], bot.archetype.class, ganancia)

        const br = bot.shotResult
        spawnTrazador(
          vfxState,
          bot.combatInput.origin.x,
          bot.combatInput.origin.y,
          bot.combatInput.origin.z,
          br.pointX,
          br.pointY,
          br.pointZ,
          tiempoVfxS,
        )
        if (br.hit) {
          const carneBot = br.surface === 'carne'
          spawnImpacto(
            vfxState,
            br.pointX,
            br.pointY,
            br.pointZ,
            br.normalX,
            br.normalY,
            br.normalZ,
            carneBot ? SUPERFICIE_CARNE : SUPERFICIE_HORMIGON,
            tiempoVfxS,
          )
          // Los disparos de bot NO dejan calcomanía a propósito. Diez bots
          // disparando generan ~100 impactos por segundo entre todos, así
          // que si cada uno marcara la pared, el anillo de 64 se daría
          // vuelta dos veces por segundo y las marcas del JUGADOR --  las
          // únicas que está mirando, en la pared que tiene enfrente --
          // durarían medio segundo antes de que las pisara el tiroteo del
          // otro extremo del mapa. Medido: era exactamente lo que pasaba.
          // Las chispas de bot sí se generan (son la pista de desde dónde
          // te tiran) y ésas viven 0.22 s, así que el anillo les alcanza.
        }
        profiler.end('feedback')
      }
      // Daño/puntaje (applyDamageToBot/damageBot + recordDamage/recordKill)
      // queda deliberadamente SIN instrumentar acá abajo: no es ninguna de
      // las seis secciones del desglose (combate ya se cerró arriba con el
      // hitscan en sí). Cae en "otro" -- ver engine/profiler.ts sobre por
      // qué eso es información, no un hueco. onDamageTaken (unas líneas más
      // abajo) SÍ es feedback -- viñeta direccional + shake -- y se marca
      // aparte, más angosto, en vez de envolver todo este bloque.
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
          profiler.begin('feedback')
          onDamageTaken(feedbackState, bearing, damage)
          profiler.end('feedback')
        } else {
          killed = damageBot(bots[victimId - 1], damage)
        }

        recordDamage(matchState, shooterId, damage)
        // Las medallas necesitan saber QUIÉN recibió el daño, no sólo quién
        // lo hizo: de ahí salen "salvada" (le pegaron a un compañero) y
        // "clutch" (te venían pegando a vos). recordDamage no lleva la
        // víctima porque el puntaje no la necesita.
        registrarDanoMedallas(medalTracker, shooterId, victimId, matchState.elapsedS)
        if (killed) {
          recordKill(matchState, shooterId, victimId, weaponLabel(bot.archetype.id), headshot)
          // También se registran las bajas de bot contra bot: "primera
          // sangre" necesita saber si alguien se le adelantó al jugador, y
          // venganza y dominación necesitan recordar quién lo mató a él.
          medalKill.killerId = shooterId
          medalKill.victimId = victimId
          medalKill.headshot = headshot
          medalKill.distanciaM = bot.shotResult.distance
          medalKill.balasRestantes = bot.combat.fireControl.ammo
          medalKill.vidaDelKiller = bot.health.health
          medalKill.tiempoS = matchState.elapsedS
          registrarKillMedallas(medalTracker, medalKill)
        }
      }
    }

    // Envejece hitmarkers/números de daño/viñetas/shake e integra el
    // impulso de punch que onShotFired() acaba de sumar arriba (si hubo
    // disparo este frame): tiene que correr ANTES de leer
    // feedbackState.cameraPunch.roll de la línea de abajo, para que el
    // punch de ESTE disparo ya se sienta en la rotación de ESTE frame, no
    // en el siguiente. Corre siempre, con o sin arma equipada -- el shake
    // y la viñeta de daño recibido no dependen de tener un arma en mano.
    profiler.begin('feedback')
    stepFeedback(feedbackState, dt)
    profiler.end('feedback')

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
        const headshot = shotResult.part === 'head'
        if (killed) {
          recordKill(matchState, PLAYER_ID, victimId, (melee ? 'CUCHILLO' : weaponLabel(combatArchetypeId ?? 'ar-1')), headshot)
        }

        // XP del ARMA EN MANO (progression/weapon-xp.ts). Se atribuye acá y
        // no en el resumen porque `currentSlug` es lo único que sabe con qué
        // se disparó ESTE tiro: el menú de pausa deja cambiar de arma en
        // vivo, así que el loadout del final de la partida no dice quién
        // hizo qué. Cero asignaciones: los buffers del acumulado ya están
        // reservados (createWeaponTally, arriba).
        if (currentSlug !== null) {
          registrarDano(weaponTally, currentSlug, shotResult.damage)
          if (killed) registrarKill(weaponTally, currentSlug, headshot)
        }

        // Las medallas se registran SIEMPRE, fuera del `if` de arriba: ese
        // condicional existe porque la XP de arma necesita saber CON QUÉ
        // arma fue, y sin slug no hay a quién acreditársela. Una medalla no
        // depende del arma, así que meterla adentro la haría desaparecer en
        // cualquier caso donde el slug todavía no esté resuelto.
        registrarDanoMedallas(medalTracker, PLAYER_ID, victimId, matchState.elapsedS)
        if (killed) {
          recordKill(matchState, PLAYER_ID, victimId, (melee ? 'CUCHILLO' : weaponLabel(combatArchetypeId ?? 'ar-1')), shotResult.part === 'head')
          // La distancia y el cargador salen del disparo REAL que remató
          // (combat/shot.ts y el control de fuego), no de una reconstrucción:
          // "tiro largo", "a quemarropa" y "última bala" se calibran contra
          // la distribución medida de esos valores exactos.
          medalKill.killerId = PLAYER_ID
          medalKill.victimId = victimId
          medalKill.headshot = shotResult.part === 'head'
          medalKill.distanciaM = shotResult.distance
          medalKill.balasRestantes = combatState.fireControl.ammo
          medalKill.vidaDelKiller = playerHealth.health
          medalKill.tiempoS = matchState.elapsedS
          registrarKillMedallas(medalTracker, medalKill)
        }
      }

      // Punto de impacto EXACTO, tal como lo resolvió fireShot con la
      // dirección real del tiro. Antes se reconstruía acá como cámara +
      // forward(pitch,yaw) * distancia, lo que ignoraba la dispersión de
      // este disparo en particular y dejaba el número de daño corrido unos
      // píxeles. Eso se toleraba mientras el punto sólo alimentaba un número
      // flotante; desde que también planta impactos y calcomanías, un error
      // de unos píxeles deja la marca visiblemente fuera del agujero, así
      // que ahora el dato viaja en ShotResult (ver combat/shot.ts).
      //
      // profiler.begin/end('feedback') arrancan ACÁ y no antes: applyHit/
      // damageBot/recordDamage/recordKill de arriba son daño y puntaje, no
      // ninguna de las seis secciones del desglose (mismo criterio que el
      // bloque análogo de bots más arriba) -- quedan sin instrumentar,
      // caen en "otro" a propósito.
      profiler.begin('feedback')
      scratchHitPoint.x = shotResult.pointX
      scratchHitPoint.y = shotResult.pointY
      scratchHitPoint.z = shotResult.pointZ
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
      profiler.end('feedback')
    }

    // Reloj de partida + killfeed + condición de cierre (sección "Build" de
    // la tarea): corre DESPUÉS de resolver todo el combate de este frame,
    // para que la última tanda de kills/daño de un frame que agota el
    // reloj o el límite de kills todavía cuente -- ver el comentario de
    // cabecera de match/match.ts sobre la garantía de terminación.
    stepMatch(matchState, dt, MATCH)
    // Envejece los avisos y hace correr el reloj de supervivencia. Va
    // DESPUÉS de stepMatch para que use el reloj de partida ya avanzado de
    // este frame.
    stepMedallas(medalTracker, dt, matchState.elapsedS)

    // Cierre de partida (fase 4, sección 9 del spec): la transición de
    // 'live' a 'ended' ocurre UNA sola vez y es acá donde se cobra la
    // carrera -- RR o colocación, XP y drop de skin. El guard de
    // `matchProgress === null` es lo que garantiza el "una sola vez": sin
    // él, cada frame posterior al final volvería a aplicar el resultado y
    // el jugador subiría de rango indefinidamente mirando el resumen.
    if (matchState.phase === 'ended' && matchProgress === null) {
      cerrarPartida()
    }

    targetsRenderer.sync(targetsState)
    // La distancia para el throttle de mixers se mide desde la CÁMARA ya
    // interpolada de este frame, no desde player.position: es el punto de
    // vista real, que es lo único que define si alguien puede notar que una
    // animación corre a menos Hz.
    botsRenderer.sync(bots, dt, gfx.camera.position.x, gfx.camera.position.z)

    // VFX: sube a la GPU sólo los anillos que cambiaron de versión y
    // adelanta el reloj de los shaders. Con nadie disparando esto son cinco
    // escrituras de uniform y ni una subida de buffer -- las partículas ya
    // en vuelo se animan solas en el vertex shader. El fulgor se re-ata sólo
    // cuando cambia el arma en pantalla (attachWeapon es idempotente).
    vfxRenderer.attachWeapon(viewmodel.weapon, shownSlug)
    vfxRenderer.sync(vfxState, tiempoVfxS)

    // El timer de GPU bracketea desde acá (antes del clear + render del
    // mundo) hasta después de la pasada del viewmodel, más abajo: esas dos
    // pasadas y sus dos clears son exactamente lo que la auditoría de
    // performance midió como "costo de GPU de un rAF completo".
    gpuTimer.beginFrame()

    gfx.renderer.info.reset()
    profiler.begin('render')
    gfx.render()
    profiler.end('render')
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
      // Eje táctico CS/COD: las armas de CS de HIERROS no apuntan (se tira a la
      // cadera, tap). weaponAllowsAds las filtra; el botón derecho queda muerto
      // para ellas. Como adsT nunca sube, FOV/sensibilidad/velocidad/pose se
      // quedan en base solos, sin tocar combat/ads.ts ni el rig. Las CS con
      // óptica (AWP, SSG08, SCAR-20, G3SG1), las de COD y las CC0 apuntan normal.
      // El cuchillo NO apunta: el clic derecho es su estocada, no un ADS. Con
      // `!melee` el botón derecho no sube adsT y el arma no entra en mira (el
      // resto del bloque queda en base solo, sin tocar combat/ads.ts ni el rig).
      vmInput.ads = !melee && (input.adsHeld || debugAdsHeld) && weaponAllowsAds(shownSlug)
      vmInput.mouseDeltaX = mouseDeltaX
      vmInput.mouseDeltaY = mouseDeltaY
      // La fuente de verdad es el renderer, no el índice: lo decide por lo que
      // encontró adentro del .glb que efectivamente cargó (ver `animated` en
      // viewmodel/renderer.ts). Mientras el arma todavía se está bajando esto
      // es false y corre la coreografía procedural, que es el comportamiento
      // correcto para ese frame: el modelo animado todavía no está en pantalla.
      vmInput.clipDriven = viewmodel.animated

      profiler.begin('viewmodel')
      stepViewmodel(vmState, vmInput, rigWeapon, vmOut, dt)
      profiler.end('viewmodel')

      // El pz del rig usa "+ hacia el jugador" (ver seed.ts); la cámara del
      // viewmodel mira hacia -Z como cualquier cámara de Three, así que el
      // eje que queda "delante" de ella es el negativo. x e y ya coinciden
      // con la convención de Three (derecha positiva, arriba positivo) y no
      // se tocan.
      viewmodel.weapon.position.set(vmOut.px, vmOut.py, -vmOut.pz)
      viewmodel.weapon.rotation.set(vmOut.rx, vmOut.ry, vmOut.rz)
      // Mirando por el visor no se ve el arma, se ve lo que hay del otro
      // lado del vidrio (ver weaponHiddenByScope). Es una bandera de
      // Object3D, no una llamada a three: apagarla saca el arma del
      // recorrido de render sin tocar el rig ni sus materiales. Con
      // cualquier arma sin estampa `scopeReticleNow` es null, esto da
      // siempre `true` y la línea es un no-op idempotente.
      viewmodel.weapon.visible =
        scopeReticleNow === null || !weaponHiddenByScope(scopeAlpha(easedAdsTForScope))

      // Cargador: sale, cae y entra uno nuevo durante la recarga. Misma
      // convención de pz que arriba (se niega al escribir). Se escribe sin
      // preguntar si el arma tiene cargador — un arma sin él tiene el pivote
      // vacío y mover un grupo vacío no cuesta nada ni se ve.
      //
      // No hace falta cruzarlo con la visibilidad del arma de la línea de
      // arriba: `magPivot` es hijo de `weapon` (viewmodel/renderer.ts), y en
      // three la visibilidad es jerárquica, así que apagar el arma al mirar
      // por el visor ya se lleva al cargador con ella.
      magazinePose(reloadFraction(vmState), vmMag)
      viewmodel.magPivot.position.set(vmMag.px, vmMag.py, -vmMag.pz)
      viewmodel.magPivot.rotation.set(vmMag.rx, 0, vmMag.rz)
      viewmodel.magPivot.visible = vmMag.visible
      // now/1000: el reloj de las animaciones de skin (pulso, flujo, ciclo
      // de tono). Se pasa el timestamp del rAF en vez de acumular un
      // contador propio para no sumar estado que se pueda desincronizar.
      // El mezclador escribe HUESOS; el bloque de arriba escribió el GRUPO que
      // los contiene. Van en este orden por claridad, no por dependencia: son
      // dos espacios distintos y por eso ninguno pisa al otro.
      viewmodel.advanceAnimation(dt)

      profiler.begin('render')
      viewmodel.render(gfx.camera, now / 1000)
      // Cuentas del viewmodel ANTES del bloom: postfx.render() dibuja quads
      // full-screen que resetean renderer.info (autoReset) y borrarían el
      // conteo del arma. Se leen acá y se suman al del mundo en stats.endFrame.
      const vmCalls = gfx.renderer.info.render.calls
      const vmTriangles = gfx.renderer.info.render.triangles
      // Bloom sobre mundo + viewmodel ya dibujados en el canvas. Va DENTRO del
      // bracket del gpu-timer (beginFrame arriba, endFrame abajo) para que el
      // "gpu Xms" del HUD incluya el costo del postprocesado -- honesto. En
      // `off` es un no-op instantáneo (mismo costo que antes de esta feature).
      postfx.render()
      profiler.end('render')
      gpuTimer.endFrame()

      stats.endFrame(
        worldCalls + vmCalls,
        worldTriangles + vmTriangles,
        gpuTimer.stats.gpuMs,
        gpuTimer.stats.peakMs,
        profiler.stats,
      )
    } else {
      // Sin arma en mano el bloom igual corre (fogonazos, VFX de otros), dentro
      // del bracket del gpu-timer por el mismo motivo. `off` lo deja en no-op.
      postfx.render()
      gpuTimer.endFrame()
      stats.endFrame(worldCalls, worldTriangles, gpuTimer.stats.gpuMs, gpuTimer.stats.peakMs, profiler.stats)
    }

    // Cierra la contabilidad del profiler de ESTE frame: recién acá se
    // conoce el costo total de CPU (stats.stats.cpuMs, que stats.endFrame()
    // de arriba acaba de calcular) -- profiler.ts deriva "otro" contra ese
    // total, así que tiene que correr DESPUÉS, no antes. El `stats` de
    // arriba usa profiler.stats tal como quedó del frame ANTERIOR (mismo
    // desfasaje de un frame que ya tiene gpuTimer -- ver su cabecera): no
    // hace falta que el HUD esté al día al ciclo exacto, y evita tener que
    // calcular el desglose antes de tener el total real.
    profiler.endFrame(stats.stats.cpuMs)

    updateWeaponErrorBanner()

    // Capa visual del feedback (hitmarkers, números de daño, viñeta,
    // latido/desaturación, shake del canvas): DOM imperativo, se actualiza
    // todos los frames -- no es React, así que no compite con el
    // presupuesto de frame del motor (ver el comentario de cabecera de
    // feedback/overlay.ts).
    // Estampa de mira telescópica (feedback/scope.ts). Con `reticle` en null
    // —todo lo que no sea precisión con óptica— setScope() no toca el DOM,
    // así que el ADS de hierros queda intacto.
    feedbackOverlay.setScope(scopeReticleNow, easedAdsTForScope)

    feedbackOverlay.render(feedbackState)

    // Captura de pantalla: acá es el único punto del frame donde el drawing
    // buffer tiene la imagen COMPLETA (mundo + viewmodel + overlay ya
    // dibujados) y todavía no se limpió para el próximo frame. Leer el canvas
    // en cualquier otro momento daría negro sin `preserveDrawingBuffer`. Se
    // consume una sola vez por pedido.
    if (capturaPendiente !== null) {
      const resolver = capturaPendiente
      capturaPendiente = null
      try {
        resolver(canvas.toDataURL('image/png'))
      } catch {
        resolver(null)
      }
    }
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
      // Los bytes de los samples se bajan ya, sin esperar gesto: decodificar
      // sí necesita AudioContext, pero bajar no. Así al primer click ya está
      // todo en memoria y no se pierden los primeros disparos de la partida.
      weaponAudio.precargar()
      // Las armas de los bots también: son ~10 archivos de 10-70 KB que se
      // van a necesitar sí o sí apenas empiece el tiroteo, y pedirlos acá
      // (en vez de al primer disparo de cada uno) evita que los primeros
      // tiros de la partida sean justo los que suenan genéricos.
      for (const slug of botWeaponSlugs) {
        if (slug !== null) weaponAudio.prewarm(slug)
      }
      window.addEventListener('resize', onResize)
      canvas.addEventListener('click', onCanvasClickForAudio)
      window.addEventListener('keydown', onDebugKeyDown)
      window.addEventListener('keydown', onLoadoutKeyDown)
      window.addEventListener('keydown', onPerfKeyDown)
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
          // Estampa de visor (feedback/scope.ts): con qué retícula y a qué
          // opacidad quedó este frame. Una captura sola no distingue "el
          // arma no lleva estampa" de "la lleva pero no se activó", y sin
          // pointer lock no hay forma de mirar el estado de otra manera.
          scope: (() => {
            const reticle = scopeReticleForWeapon(
              combatArchetypeId,
              sightForSlug(viewmodel.attachedSlug),
            )
            // `alpha` es la opacidad EFECTIVA, no la de la curva: con un
            // arma sin estampa tiene que dar 0 aunque el ADS esté completo.
            // Reportar la curva pelada haría que un fusil de hierros a ADS
            // full dijera "alpha 1" y una verificación automatizada leyera
            // eso como que la estampa se activó.
            const alpha = reticle === null ? 0 : scopeAlpha(easeInOutCubic(vmState.adsT))
            return { reticle, adsT: vmState.adsT, alpha, weaponVisible: viewmodel.weapon.visible }
          })(),
          // Posición y apoyo del jugador: sin esto no hay forma de
          // verificar en un navegador automatizado (sin pointer lock) que
          // en un mapa importado el piso frena de verdad. "Se ve el suelo"
          // y "el suelo es sólido" son cosas distintas, y una captura sola
          // no distingue caer 200 m de estar parado.
          player: {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
            grounded: player.grounded,
          },
          mapa: mapaActual.name,
          // Costo de CPU de la IA (engine/profiler.ts, sección 'ia'), para
          // poder comparar el presupuesto de bots ANTES y DESPUÉS de tocar
          // su comportamiento sin tener que leer el HUD. El desglose ya lo
          // calcula el profiler cada frame: esto sólo lo copia, no mide
          // nada nuevo ni agrega trabajo al camino de frame.
          perfil: {
            iaMedianaMs: profiler.stats.ia.medianMs,
            iaP95Ms: profiler.stats.ia.p95Ms,
          },
          // Loadout y skin equipada (fase 3): para verificar sin pointer
          // lock que el arma con la que se spawnea es la elegida en la
          // armería, y que la skin persistida es la que se aplicó.
          loadout: {
            nivel,
            slot: currentSlot,
            slug: currentSlug,
            attachedSlug: viewmodel.attachedSlug,
            primary: { ...loadout.primary },
            secondary: { ...loadout.secondary },
            // El slot melee (cuchillo) no tiene skin: skinForSlot sólo entiende
            // las dos ranuras del loadout persistido.
            skin: currentSlot === 'melee' ? null : skinForSlot(loadout, currentSlot)?.name ?? null,
            skinRareza:
              currentSlot === 'melee' ? null : skinForSlot(loadout, currentSlot)?.rarity ?? null,
          },
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
          // `practica` acompaña a `targets` para que la verificación en el
          // navegador distinga las dos razones por las que la lista puede
          // venir vacía: no se pidió el modo, o se pidió en un mapa que no
          // tiene corredor de dianas (ver targets/practica.ts).
          practica: esModoPractica(),
          // Sensibilidad EFECTIVA de esta partida (settings/store.ts), para
          // verificar en el navegador que lo elegido en la armería llegó de
          // verdad al motor y no se quedó en el panel.
          sensibilidadRadPorConteo: sensBase,
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

        // Hook de control para EJERCITAR el feedback de combate desde el
        // navegador sin pointer lock ni tener que acertarle a un bot: dispara
        // el mismo camino que el combate real (onHitConfirmed/onDamageTaken de
        // feedback/feedback.ts, applyDamageToBot para la vida real del HUD),
        // así una captura puede mostrar el hitmarker, la confirmación de baja,
        // el arco de daño direccional y el número de vida en rojo de forma
        // determinista. Mismo gate ?debug=1 que el resto: no existe en
        // producción. No duplica lógica de combate, sólo la invoca.
        ;(
          window as unknown as {
            __hudDebug?: (accion: string, a?: number, b?: number) => void
          }
        ).__hudDebug = (accion, a = 0, b = 0) => {
          if (accion === 'hitmarker') {
            // a=1 headshot, b=1 baja. NDC cerca de la mira para el número de daño.
            onHitConfirmed(feedbackState, 0.14, 0.08, 42, a === 1, b === 1)
          } else if (accion === 'danio') {
            // a = bearing en radianes (0 = de frente), b = daño del arco.
            onDamageTaken(feedbackState, a, b || 40)
          } else if (accion === 'herir') {
            // Baja la vida REAL del jugador (la que lee el HUD), para ver el
            // número en rojo bajo el umbral crítico.
            applyDamageToBot(playerHealth, a || 70)
          } else if (accion === 'sanar') {
            playerHealth.health = playerHealth.maxHealth
            playerHealth.alive = true
          }
        }

        // Contraparte de sólo lectura de __debugTeleport, detrás del mismo
        // gate ?debug=1. Sin esto, verificar "¿el jugador subió la escalera?"
        // o "¿se salió del mapa?" desde el navegador obliga a mirar una
        // captura y adivinar la altura: la cámara no expone la posición de
        // los pies, que es la que decide la colisión. Devuelve un objeto
        // nuevo por llamada a propósito -- se invoca a mano desde la consola
        // o desde CDP, nunca dentro del frame, así que no cuenta para el
        // presupuesto de cero asignaciones por cuadro.
        ;(
          window as unknown as {
            __debugPos?: () => { x: number; y: number; z: number; onGround: boolean }
          }
        ).__debugPos = () => ({
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
          onGround: player.grounded,
        })

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

        // Tuning de efectos de disparo (fase 5): mismo motivo que los dos de
        // arriba. Acá sirve especialmente para verificar en el navegador --
        // el fulgor de boca dura 45 ms y es casi imposible de cazar en una
        // captura sin poder estirarlo desde la consola.
        ;(window as unknown as { __vfxTuning?: typeof VFX }).__vfxTuning = VFX

        // Tuning del viewmodel: mismo motivo que los tres de arriba, y con el
        // mismo problema agudo que __vfxTuning. La coreografía de recarga
        // (weapons/viewmodel/reload.ts) se aprueba MIRÁNDOLA, y sus fases
        // duran décimas de segundo: ajustar roll, caída o golpes editando el
        // archivo y esperando el rebuild hace que cada iteración cueste una
        // recarga entera de la página. Desde la consola es inmediato.
        ;(window as unknown as { __viewmodelTuning?: typeof VIEWMODEL }).__viewmodelTuning =
          VIEWMODEL

        // Estado vivo de los efectos, sólo lectura. Los shaders deciden qué
        // se dibuja a partir de spawnTimeS contra el reloj, así que cuando
        // algo "no se ve" no hay forma de saber desde afuera si es que no se
        // generó, si nació en el lugar equivocado o si simplemente ya venció:
        // esto responde esa pregunta sin tener que instrumentar el shader.
        ;(
          window as unknown as { __vfxDebug?: () => { tiempoS: number; lotes: unknown; impactos: unknown[] } }
        ).__vfxDebug = () => ({
          tiempoS: tiempoVfxS,
          lotes: vfxRenderer.info(),
          impactos: vfxState.impactos.items
            .filter((i) => i.usada)
            .map((i) => ({
              edad: +(tiempoVfxS - i.spawnTimeS).toFixed(3),
              pos: [+i.x.toFixed(2), +i.y.toFixed(2), +i.z.toFixed(2)],
              escala: i.escala,
              superficie: i.superficie,
            })),
        })

        // Estado del roster en caliente, sólo lectura. Verificar en el
        // navegador que agregar/sacar bots reparte bien los equipos y que el
        // marcador sobrevive requiere leer el reparto real y las
        // estadísticas por id, no mirarlo a ojo -- este hook responde eso sin
        // abrir un canal de control (las teclas + y - son el único canal, en
        // ui/GameCanvas.tsx). Mismo gate ?debug=1 que el resto: no existe en
        // producción.
        ;(
          window as unknown as {
            __rosterDebug?: () => {
              botsActivos: number
              participantesVisibles: number
              equipoA: number
              equipoB: number
              stats: { id: number; kills: number; deaths: number }[]
            }
          }
        ).__rosterDebug = () => {
          let equipoA = 0
          let equipoB = 0
          for (let id = 0; id <= bots.length; id++) {
            if (teamForParticipant(matchMode, id) === 0) equipoA++
            else equipoB++
          }
          const visibles = 1 + rosterVivo.maxBotsActivos
          return {
            botsActivos: bots.length,
            participantesVisibles: visibles,
            equipoA,
            equipoB,
            stats: matchState.participants
              .slice(0, visibles)
              .map((p) => ({ id: p.id, kills: p.kills, deaths: p.deaths })),
          }
        }
      }
    },
    stop(): void {
      running = false
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('click', onCanvasClickForAudio)
      window.removeEventListener('keydown', onDebugKeyDown)
      window.removeEventListener('keydown', onLoadoutKeyDown)
      window.removeEventListener('keydown', onPerfKeyDown)
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
      vfxRenderer.dispose()
      // Antes de gfx.dispose(): postfx comparte el WebGLRenderer y libera sus
      // propios render targets (VRAM). Soltarlos después de tirar el renderer
      // sería tarde.
      postfx.dispose()
      gfx.dispose()
    },
    benchmark(passes = 500): number {
      return runBenchmark(() => gfx.render(), passes)
    },
    capturarPantalla(): Promise<string | null> {
      // Sin loop andando no hay frame que capturar: se resuelve a null en vez
      // de dejar la promesa colgada para siempre.
      if (!running) return Promise.resolve(null)
      return new Promise((resolve) => {
        // Si ya había una captura pendiente (doble tecla en el mismo frame),
        // se la cancela con null: sólo la última gana el próximo frame.
        capturaPendiente?.(null)
        capturaPendiente = resolve
      })
    },
    get stats() {
      return stats.stats
    },
    get matchState() {
      return matchState
    },
    get weaponXp() {
      return weaponXp
    },
    get matchProgress() {
      return matchProgress
    },
    get medalTracker() {
      return medalTracker
    },
    get medallasDeLaPartida() {
      return medallasDeLaPartida
    },

    readHud(out: HudSnapshot): void {
      // Sólo copias de primitivos y de referencias a cadenas ya existentes.
      // Cero asignaciones, cero recorridos, cero cadenas nuevas: esta
      // función corre una vez por frame desde el rAF del HUD.
      // Con cuchillo la munición del control de fuego es la que dejó la última
      // arma de fuego (stale): se muestra 0 para no mentir. `hudMagazine` ya es
      // 0 (cargadorDe), así que el HUD queda en "0 / 0" en vez de balas falsas.
      out.ammo =
        currentSlug !== null && isMeleeSlug(currentSlug) ? 0 : combatState.fireControl.ammo
      out.magazine = hudMagazine
      out.reloading = vmState.reloading
      out.health = playerHealth.health
      out.maxHealth = playerHealth.maxHealth
      out.alive = playerHealth.alive
      // `respawnT` cuenta hacia ARRIBA desde la muerte (bots/health.ts), así
      // que lo que falta es el delay menos lo transcurrido. Se clampea a 0
      // porque el respawn se resuelve en el tick fijo y puede quedar un
      // instante con el contador ya vencido y `alive` todavía en false.
      out.respawnInS = playerHealth.alive
        ? 0
        : Math.max(0, MATCH.respawnDelayS - playerHealth.respawnT)
      out.weaponName = hudWeaponName
      out.slot = currentSlot
      out.primaryName = hudPrimaryName
      out.secondaryName = hudSecondaryName
      out.meleeName = hudMeleeName
    },

    agregarBot(): boolean {
      return agregarBotAlRoster(rosterVivo, matchState.phase === 'ended')
    },
    quitarBot(): boolean {
      return quitarBotDelRoster(rosterVivo, matchState.phase === 'ended')
    },
    get botsActivos() {
      return bots.length
    },
    get participantesVisibles() {
      return 1 + rosterVivo.maxBotsActivos
    },
    get rosterEditable() {
      return rosterVivo.editable
    },

    setPaused(value: boolean): void {
      paused = value
    },

    recargarSensibilidad(): void {
      sensBase = sensibilidadBase()
    },

    recargarVideo(): void {
      postfx.setQuality(calidadBloomInicial())
    },

    get paused() {
      return paused
    },

    get loadout() {
      return loadout
    },
    get slotEquipado() {
      return currentSlot
    },

    equipEnPartida(slot: LoadoutSlot, slug: string): void {
      loadout = equipWeapon(loadout, slot, slug)
      // El guardado se actualiza EN EL LUGAR además de persistirse. Es
      // deliberado y no redundante: `cerrarPartida()` guarda
      // `progressWithCareer(progress, ...)` al terminar la partida, o sea
      // que parte del objeto `progress` que se cargó al arrancar. Si acá
      // sólo se persistiera una copia, el guardado de fin de partida
      // escribiría encima el loadout VIEJO y el arma elegida en el menú se
      // perdería al terminar de jugar -- un bug que no se ve hasta la
      // siguiente partida.
      progress.loadout = loadout
      progressStore.save(progress)
      // `forzar`: se equipa siempre, incluso si el slug elegido es el que ya
      // estaba en mano. Sin esto, cambiar el arma de la ranura secundaria
      // desde el menú mientras tenés la primaria en mano no cambiaría de
      // ranura si por casualidad los slugs coincidían.
      equipSlot(slot, true)
      // Los nombres de las DOS ranuras cambian cuando se edita el loadout,
      // no sólo el de la que quedó en mano; equipSlot ya llama a esto, pero
      // sólo entra si la ranura tiene arma. Repetirlo es barato y cubre el
      // caso de una ranura vacía.
      refrescarDatosDeHud()
    },

    equiparRanura(slot: RanuraEnMano): void {
      equipSlot(slot)
    },
  }
}
