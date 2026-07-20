/**
 * Camino de combate MELEE (cuchillo). Es una rama SEPARADA de la de
 * proyectiles (combat/combat.ts + shot.ts), no un caso especial adentro de
 * ella, porque un cuchillo no comparte casi nada con un arma de fuego: no
 * tiene cargador, no recarga, no tiene retroceso ni dispersión y no dispara
 * un proyectil hitscan a 500 m. Por eso NO pasa por `archetypes.ts` /
 * `ARCHETYPES` — esos 10 arquetipos son armas de fuego y su validación exige
 * `magazine > 0`, `fireRate > 0` y un patrón de retroceso no vacío (ver
 * archetypes.test.ts). Meter el cuchillo ahí lo convertiría en "una pistola
 * que dispara balas invisibles". Este módulo define su propio contrato
 * (`MeleeArchetype`) y su propia resolución.
 *
 * Lo que SÍ comparte con el arma de fuego, y por eso reusa en vez de
 * duplicar: el trace. Un golpe de cuchillo es el MISMO raycast contra mapa +
 * hitboxes que un disparo (combat/hitscan.ts + hitboxes.ts), sólo que de
 * rango corto (~1.5 m en vez de 500 m), a un solo objetivo, y con COOLDOWN
 * en vez de munición. Igual que shot.ts, todo el estado transitorio es
 * scratch preasignado a nivel de módulo: cero asignaciones por golpe/frame
 * (el guard de combat/allocations.test.ts mide con la misma vara).
 *
 * ── De dónde salen los números (todos de Counter-Strike) ──────────────────
 * Fuente citable, verificada: Valve Developer Community, "weapon_knife",
 * tabla "Damage against unarmored (armored) Players", columna CS:GO/CS2.
 *   https://developer.valvesoftware.com/wiki/Weapon_knife
 * (tabla contrastada además con la wiki de Counter-Strike, Fandom, que da los
 *  mismos valores sin armadura: https://counterstrike.fandom.com/wiki/Knife)
 *
 * Nuestro mundo es de 100 de vida y SIN armadura (ver combat/hitboxes.ts), así
 * que usamos la columna "unarmored". Los valores concretos viven en el dato
 * (`KNIFE_ARCHETYPE` en weapons/melee-catalog.ts), acá sólo la mecánica.
 *
 * A diferencia del arma de fuego, el daño del cuchillo NO se multiplica por la
 * hitbox golpeada (cabeza/torso/pierna dan lo mismo). La VDC lo dice explícito:
 * "In Source and Global Offensive, the head hitbox multiplier is removed and
 * only the backstab multiplier is present". El único modificador es el
 * backstab, que sí es masivo (la estocada por la espalda mata de un golpe).
 */

import { vec3, type Vec3 } from '@/game/math/vec3'
import {
  intersectHitboxes,
  type BodyPart,
  type Hitbox,
  type HitboxHit,
} from '@/game/combat/hitboxes'
import { raycastMap, type MapHit } from '@/game/combat/hitscan'
import { computeForward, type ImpactSurface } from '@/game/combat/shot'

/** Los dos ataques del cuchillo. */
export type MeleeAttackKind = 'slash' | 'stab'

/**
 * Estadísticas de un arma melee. Deliberadamente NO es `WeaponArchetype`: no
 * tiene `magazine`, `fireRate`, `fireMode`, `reload` ni `recoil` porque nada
 * de eso aplica a un cuchillo. Es el contrato de la rama melee.
 */
export interface MeleeArchetype {
  readonly id: string
  /** Daño del PRIMER tajo (primary, primer swing). CS:GO sin armadura: 40. */
  readonly slashDamage: number
  /**
   * Daño de un tajo CONSECUTIVO (mientras se spamea el clic). CS:GO sin
   * armadura: 25. La VDC/Fandom lo marcan como "reduced damage on any
   * consecutive swing": el primer tajo pega fuerte, los que le siguen de
   * inmediato pegan menos, para que no se pueda matar sólo spameando.
   */
  readonly slashConsecutiveDamage: number
  /** Daño de la ESTOCADA (secondary). CS:GO sin armadura: 65. */
  readonly stabDamage: number
  /** Daño de un TAJO por la espalda (primary backstab). CS:GO sin armadura: 90
   *  (no mata de un golpe a 100 de vida — sólo la estocada lo hace). */
  readonly slashBackstabDamage: number
  /** Daño de una ESTOCADA por la espalda (secondary backstab). CS:GO sin
   *  armadura: 180 → > 100 de vida, mata de un solo golpe. */
  readonly stabBackstabDamage: number
  /** Alcance del golpe, en metros. */
  readonly range: number
  /** Segundos entre tajos (cadencia del primary). */
  readonly slashInterval: number
  /** Segundos entre estocadas (cadencia del secondary). */
  readonly stabInterval: number
  /**
   * Umbral de coseno para considerar un golpe "por la espalda". VDC: un golpe
   * es backstab si el ángulo entre la ORIENTACIÓN de la víctima y el vector 2D
   * atacante→víctima es cos⁻¹(0.475) ≈ 61.64° o menos. O sea: la víctima está
   * mirando MÁS O MENOS en la misma dirección en la que el atacante avanza
   * hacia ella (le está dando la espalda). Es un cálculo 2D: no importa la
   * orientación del atacante ni la diferencia de altura entre ambos.
   */
  readonly backstabCosThreshold: number
  /**
   * Segundos de pausa tras los cuales el próximo tajo vuelve a ser "fresco"
   * (daño lleno) en vez de "consecutivo" (daño reducido). NO es un valor
   * publicado del SDK de CS — es nuestro, calibrado para que un tajo aislado
   * pegue fuerte y una ráfaga de tajos pegue menos a partir del segundo.
   */
  readonly freshSlashResetS: number
}

/**
 * Estado por arma equipada de la rama melee. Análogo a FireControlState pero
 * sin munición: el cuchillo se limita con COOLDOWN, no con balas.
 */
export interface MeleeState {
  /** Segundos desde el último golpe de CUALQUIER tipo. Gobierna el cooldown
   *  compartido entre tajo y estocada (no se puede estocar justo después de
   *  tajar, igual que en CS). Clampeado, nunca crece sin límite. */
  timeSinceLastAttack: number
  /** Segundos desde el último TAJO, para decidir si el próximo es consecutivo.
   *  Una estocada no lo toca: la reducción es sólo del primary. Clampeado. */
  timeSinceLastSlash: number
}

/** Resultado de UN golpe de cuchillo. Mismo espíritu que ShotResult (para que
 *  game.ts reuse el mismo pipeline de daño/VFX), más lo propio del melee
 *  (`kind`, `backstab`). Preasignado por el llamador: cero asignaciones. */
export interface MeleeResult {
  /** ¿El golpe conectó contra una hitbox? (false si pegó una pared o al aire). */
  hit: boolean
  /** Qué ataque fue este golpe. */
  kind: MeleeAttackKind
  /** Daño aplicado (0 si no conectó contra carne). */
  damage: number
  /** Índice de la diana/combatiente golpeado (Hitbox.owner), o -1. */
  owner: number
  /** Parte golpeada (cosmético en melee: el daño no depende de ella). */
  part: BodyPart | 'none'
  /** ¿Fue por la espalda? (aplica el multiplicador masivo). */
  backstab: boolean
  /** Distancia al impacto, en metros. */
  distance: number
  /** Contra qué pegó, para el sonido/partícula (mismo tipo que ShotResult). */
  surface: ImpactSurface
  /** Punto de impacto en mundo (para hitmarker/partícula). */
  pointX: number
  pointY: number
  pointZ: number
  /** Normal de la superficie, orientada contra el golpe. */
  normalX: number
  normalY: number
  normalZ: number
}

/** Input de un frame de melee. `slashHeld`/`stabHeld` son estados SOSTENIDOS
 *  (clic izquierdo / derecho): el cuchillo repite el golpe mientras se
 *  mantiene apretado, gateado por la cadencia — no hace falta re-clickear. */
export interface MeleeInput {
  slashHeld: boolean
  stabHeld: boolean
  origin: Vec3
  /** Pitch/yaw de cámara del jugador. */
  pitch: number
  yaw: number
}

export function createMeleeState(archetype: MeleeArchetype): MeleeState {
  return {
    // Arranca "listo para golpear ya", igual que fire-control con la munición:
    // el primer clic no espera un cooldown completo.
    timeSinceLastAttack: Math.max(archetype.slashInterval, archetype.stabInterval),
    // Grande a propósito: el primer tajo del arma recién equipada es "fresco"
    // (daño lleno), no consecutivo.
    timeSinceLastSlash: archetype.freshSlashResetS,
  }
}

/** Reinicia el estado (cuchillo recién equipado): listo para golpear, sin
 *  cadena de consecutivos heredada. */
export function resetMeleeState(state: MeleeState, archetype: MeleeArchetype): void {
  state.timeSinceLastAttack = Math.max(archetype.slashInterval, archetype.stabInterval)
  state.timeSinceLastSlash = archetype.freshSlashResetS
}

/**
 * Daño de un golpe según tipo, si fue consecutivo y si fue por la espalda. El
 * backstab MANDA sobre la reducción de consecutivo: un tajo por la espalda es
 * 90 fijo (la VDC no lista variante consecutiva del backstab), no 90
 * reducido. Función pura, testeable a mano.
 */
export function meleeDamage(
  archetype: MeleeArchetype,
  kind: MeleeAttackKind,
  consecutive: boolean,
  backstab: boolean,
): number {
  if (kind === 'stab') {
    return backstab ? archetype.stabBackstabDamage : archetype.stabDamage
  }
  // Tajo (primary)
  if (backstab) return archetype.slashBackstabDamage
  return consecutive ? archetype.slashConsecutiveDamage : archetype.slashDamage
}

// ── Scratch a nivel de módulo: cero asignaciones por golpe/frame ──────────
const scratchDir: Vec3 = vec3()
const scratchMapHit: MapHit = { hit: false, distance: 0, normalX: 0, normalY: 1, normalZ: 0 }
const scratchHitboxHit: HitboxHit = { hit: false, distance: Infinity, part: null, owner: -1 }

/**
 * ¿El golpe es por la espalda? Regla de la VDC (weapon_knife), en 2D:
 * backstab ⇔ ángulo(orientación de la víctima, dirección atacante→víctima) ≤
 * cos⁻¹(threshold). Es decir dot(víctimaForward2D, dirAtaque2D) ≥ threshold.
 *
 * Usamos la DIRECCIÓN DE APUNTADO (`aimDir`, el forward del golpe en 2D) como
 * proxy del vector atacante→víctima. Es fiel: para conectar el trace hay que
 * estar apuntando a la víctima, así que a rango de cuchillo (~1.5 m) el
 * forward y el vector atacante→víctima son prácticamente el mismo. Evita
 * tener que pasar la posición de cada víctima por separado.
 *
 * `victimForward` puede no estar normalizado y puede traer componente Y (viene
 * del yaw del enemigo): se proyecta a 2D y se normaliza acá adentro, sin
 * asignar. Si es (casi) nulo — una diana estática sin orientación —, no hay
 * backstab posible y devuelve false.
 */
function esBackstab(victimForward: Vec3, aimDir: Vec3, threshold: number): boolean {
  const vLen = Math.hypot(victimForward.x, victimForward.z)
  const aLen = Math.hypot(aimDir.x, aimDir.z)
  if (vLen < 1e-6 || aLen < 1e-6) return false
  const dot = (victimForward.x * aimDir.x + victimForward.z * aimDir.z) / (vLen * aLen)
  return dot >= threshold
}

/**
 * Resuelve UN golpe de cuchillo: trace de rango corto desde `origin` en la
 * dirección de cámara (pitch/yaw), contra el mapa y las hitboxes. Gana el
 * impacto más cercano; una pared entre medio bloquea el golpe (no se apuñala
 * a través de un muro). Si conecta contra carne, calcula backstab y daño.
 * Escribe todo en `out` (preasignado). No asigna.
 *
 * `ownerForward` da la orientación (forward) de cada objetivo, indexada por
 * `Hitbox.owner`, para el cálculo de backstab. Un objetivo sin entrada (o con
 * forward nulo) simplemente nunca recibe backstab.
 */
export function resolveMeleeHit(
  origin: Vec3,
  pitch: number,
  yaw: number,
  kind: MeleeAttackKind,
  consecutive: boolean,
  hitboxes: readonly Hitbox[],
  ownerForward: readonly Vec3[],
  archetype: MeleeArchetype,
  out: MeleeResult,
): void {
  computeForward(pitch, yaw, scratchDir)
  const range = archetype.range

  raycastMap(origin, scratchDir, range, scratchMapHit)
  intersectHitboxes(origin, scratchDir, hitboxes as Hitbox[], range, scratchHitboxHit)

  const hitboxCloser =
    scratchHitboxHit.hit &&
    (!scratchMapHit.hit || scratchHitboxHit.distance < scratchMapHit.distance)

  out.kind = kind

  if (hitboxCloser) {
    const owner = scratchHitboxHit.owner
    const forward = ownerForward[owner]
    const backstab =
      forward !== undefined && esBackstab(forward, scratchDir, archetype.backstabCosThreshold)

    out.hit = true
    out.distance = scratchHitboxHit.distance
    out.part = scratchHitboxHit.part as BodyPart
    out.owner = owner
    out.backstab = backstab
    out.damage = meleeDamage(archetype, kind, consecutive, backstab)
    out.surface = 'carne'
    // Sin normal geométrica (las hitboxes son esferas analíticas): mirar de
    // vuelta al atacante, igual que shot.ts para impactos en carne.
    out.normalX = -scratchDir.x
    out.normalY = -scratchDir.y
    out.normalZ = -scratchDir.z
  } else if (scratchMapHit.hit) {
    // Pegó una pared dentro del alcance: golpe válido (suena/chispea) pero sin
    // daño ni víctima.
    out.hit = false
    out.distance = scratchMapHit.distance
    out.part = 'none'
    out.owner = -1
    out.backstab = false
    out.damage = 0
    out.surface = 'hormigon'
    out.normalX = scratchMapHit.normalX
    out.normalY = scratchMapHit.normalY
    out.normalZ = scratchMapHit.normalZ
  } else {
    // Al aire: nada dentro del alcance.
    out.hit = false
    out.distance = range
    out.part = 'none'
    out.owner = -1
    out.backstab = false
    out.damage = 0
    out.surface = 'ninguna'
    out.normalX = -scratchDir.x
    out.normalY = -scratchDir.y
    out.normalZ = -scratchDir.z
  }

  out.pointX = origin.x + scratchDir.x * out.distance
  out.pointY = origin.y + scratchDir.y * out.distance
  out.pointZ = origin.z + scratchDir.z * out.distance
}

/** Techo del clamp de los relojes internos: una vez pasada la cadencia más
 *  lenta y la ventana de reset, el valor exacto ya no cambia ninguna decisión,
 *  así que no tiene sentido dejarlo crecer (precisión de float / overflow con
 *  una pestaña en segundo plano horas). */
function clampReloj(valor: number, techo: number): number {
  return valor > techo ? techo : valor
}

/**
 * Avanza un frame de melee. Si corresponde golpear (hay botón sostenido y ya
 * pasó el cooldown), resuelve UN golpe en `out` y devuelve `true`; si no,
 * devuelve `false` y `out.hit` queda en false. game.ts aplica el daño sólo
 * cuando devuelve `true` y `out.hit` es true con `owner >= 0`.
 *
 * A lo sumo UN golpe por frame a propósito (no el catch-up de varios que hace
 * fire-control): un frame largo no debe descargar tres puñaladas de golpe.
 *
 * Si se sostienen los dos botones a la vez, gana la ESTOCADA (decisión
 * arbitraria de un caso de borde; se documenta para que no sorprenda).
 */
export function stepMelee(
  state: MeleeState,
  archetype: MeleeArchetype,
  input: MeleeInput,
  hitboxes: readonly Hitbox[],
  ownerForward: readonly Vec3[],
  dt: number,
  out: MeleeResult,
): boolean {
  const techoAttack = Math.max(archetype.slashInterval, archetype.stabInterval)
  state.timeSinceLastAttack = clampReloj(state.timeSinceLastAttack + dt, techoAttack)
  state.timeSinceLastSlash = clampReloj(state.timeSinceLastSlash + dt, archetype.freshSlashResetS)

  const kind: MeleeAttackKind | null = input.stabHeld ? 'stab' : input.slashHeld ? 'slash' : null
  if (kind === null) {
    out.hit = false
    return false
  }

  const interval = kind === 'stab' ? archetype.stabInterval : archetype.slashInterval
  if (state.timeSinceLastAttack < interval) {
    out.hit = false
    return false
  }

  const consecutive = kind === 'slash' && state.timeSinceLastSlash < archetype.freshSlashResetS
  resolveMeleeHit(
    input.origin,
    input.pitch,
    input.yaw,
    kind,
    consecutive,
    hitboxes,
    ownerForward,
    archetype,
    out,
  )

  state.timeSinceLastAttack = 0
  if (kind === 'slash') state.timeSinceLastSlash = 0
  return true
}

export function createMeleeResult(): MeleeResult {
  return {
    hit: false,
    kind: 'slash',
    damage: 0,
    owner: -1,
    part: 'none',
    backstab: false,
    distance: 0,
    surface: 'ninguna',
    pointX: 0,
    pointY: 0,
    pointZ: 0,
    normalX: 0,
    normalY: 0,
    normalZ: 0,
  }
}
