/**
 * Los 10 arquetipos de estadísticas de armas. Sección 6 del spec (corregida
 * el 2026-07-18): 40 modelos cosméticos mapean sobre estos 10 arquetipos.
 * El modelo no cambia cómo se juega, sólo cómo se ve. Estos son la
 * superficie de balance completa del juego: todo lo que un jugador siente
 * al disparar sale de acá, no del modelo 3D.
 *
 * Unidades: metros, segundos, radianes, RPM (rondas por minuto).
 */

export type WeaponClass = 'smg' | 'ar' | 'sniper' | 'shotgun' | 'lmg' | 'pistol' | 'marksman'

export type FireMode = 'auto' | 'semi' | 'burst'

export type ArchetypeId =
  | 'smg-1'
  | 'smg-2'
  | 'ar-1'
  | 'ar-2'
  | 'ar-3'
  | 'sniper-bolt'
  | 'sniper-marksman'
  | 'shotgun'
  | 'lmg'
  | 'pistol'

/**
 * Curva de daño por distancia: daño completo hasta optimalRange, caída
 * lineal hasta maxRange, y un piso porcentual (minMultiplier) más allá.
 * Ver damageAtRange() más abajo.
 */
export interface DamageCurve {
  base: number
  optimalRange: number
  maxRange: number
  minMultiplier: number
}

export interface ReloadSpec {
  /** Recarga táctica: queda munición en el cargador retirado. */
  tactical: number
  /** Recarga a cargador vacío: secuencia más larga (a veces con paso extra). */
  empty: number
}

export interface AdsSpec {
  /** Segundos de hip a ads. */
  time: number
  /** Multiplicador de FOV al apuntar (1 = sin zoom, más chico = más zoom). */
  fovScale: number
  /** Multiplicador de sensibilidad del mouse al apuntar. */
  sensScale: number
  /** Multiplicador de velocidad de movimiento al apuntar. */
  speedScale: number
}

/**
 * Cono de dispersión aleatorio que se suma sobre el patrón determinista de
 * retroceso. Crece con fuego sostenido y se cierra al soltar el gatillo,
 * por eso lleva su propia velocidad de crecimiento y de recuperación
 * independientes de `recovery` (que es la recuperación de la cámara, no
 * de la dispersión).
 */
export interface SpreadCurve {
  /** Dispersión en reposo, radianes: la del primer disparo tras soltar el gatillo. */
  base: number
  /** Techo de dispersión bajo fuego sostenido, radianes. */
  max: number
  /** Radianes que se suman por cada disparo mientras se sostiene el gatillo. */
  growthPerShot: number
  /** Radianes por segundo que se recupera la dispersión al soltar el gatillo. */
  recoverySpeed: number
}

export interface RecoilSpec {
  /** Offsets [x, y] determinista, indexado por número de disparo. Ver recoilOffsetForShot(). */
  pattern: Array<[number, number]>
  /** Velocidad con la que la cámara vuelve hacia el origen tras cada impulso, radianes/seg. */
  recovery: number
  spread: SpreadCurve
}

export interface WeaponArchetype {
  id: ArchetypeId
  class: WeaponClass
  damage: DamageCurve
  /** RPM: rondas por minuto. */
  fireRate: number
  fireMode: FireMode
  magazine: number
  reload: ReloadSpec
  ads: AdsSpec
  recoil: RecoilSpec
}

/**
 * PRNG con seed, mulberry32. No usamos Math.random(): el patrón de
 * retroceso tiene que ser el mismo en cada carga del juego (aprenderlo es
 * la habilidad, sección 5 del spec), y el mismo criterio aplica acá para
 * poder testear que dos llamadas con la misma seed dan el mismo resultado.
 */
function mulberry32(seed: number): () => number {
  let a = seed
  return function next(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Genera un patrón de retroceso determinista de `length` disparos.
 *
 * La componente vertical sube con la raíz cuadrada del progreso: los
 * primeros disparos suben rápido y los últimos ya están cerca del techo,
 * igual que el retroceso real de un arma de fuego. La componente
 * horizontal serpentea con un seno (medio período hacia un lado, medio
 * hacia el otro), el patrón en "checkmark" típico de un rifle. `jitter`
 * agrega ruido de la seed para que ningún arma tenga un patrón
 * perfectamente geométrico, pero el ruido sale del mismo PRNG determinista,
 * no de Math.random(): misma seed, mismo patrón, siempre.
 */
export function generateRecoilPattern(
  seed: number,
  length: number,
  verticalClimb: number,
  horizontalDrift: number,
  jitter: number,
): Array<[number, number]> {
  const rand = mulberry32(seed)
  const pattern: Array<[number, number]> = []
  for (let i = 0; i < length; i++) {
    const progress = length > 1 ? i / (length - 1) : 1
    const vertical = verticalClimb * Math.sqrt(progress) + (rand() - 0.5) * jitter
    const horizontal = horizontalDrift * Math.sin(progress * Math.PI * 1.5) + (rand() - 0.5) * jitter
    pattern.push([horizontal, vertical])
  }
  return pattern
}

/**
 * Offset de retroceso para el disparo `shotIndex` (0-based, absoluto desde
 * que se vació el cargador, no desde que empezó a disparar).
 *
 * Decisión: cuando el patrón es más corto que el cargador, se repite desde
 * el principio (wrap por módulo), no se clampea al último valor. El
 * retroceso real de fuego sostenido cae en un micro-patrón cíclico después
 * de la subida inicial (la mano ya está compensando en un ritmo estable);
 * repetir el patrón completo reproduce ese ciclo, mientras que clampear al
 * último valor congelaría la cámara en un solo punto, que se siente peor y
 * deja de ser "aprendible" a partir de ahí. Ver recoilOffsetForShot.test
 * para el caso donde el arma dispara más balas que las que tiene el patrón.
 */
export function recoilOffsetForShot(archetype: WeaponArchetype, shotIndex: number): [number, number] {
  const { pattern } = archetype.recoil
  return pattern[shotIndex % pattern.length]
}

/**
 * Daño en `distance` metros: completo hasta optimalRange, cae linealmente
 * hasta maxRange, y no baja de base * minMultiplier más allá. Nunca sube
 * con la distancia (monotónica no creciente), como pide la sección 5.
 */
export function damageAtRange(archetype: WeaponArchetype, distance: number): number {
  const { base, optimalRange, maxRange, minMultiplier } = archetype.damage
  if (distance <= optimalRange) return base
  const floor = base * minMultiplier
  if (distance >= maxRange) return floor
  const t = (distance - optimalRange) / (maxRange - optimalRange)
  return base - (base - floor) * t
}

/** Disparos necesarios para matar `health` puntos de vida a `distance` metros. */
export function shotsToKill(archetype: WeaponArchetype, health: number, distance: number): number {
  const dmg = damageAtRange(archetype, distance)
  return Math.ceil(health / dmg)
}

/**
 * TTK en milisegundos a `distance` metros (por defecto, el rango óptimo del
 * arma: es donde el spec da sus ejemplos). Fórmula verificada contra los
 * dos ejemplos numéricos de la sección 5:
 *
 * - AR 24 daño / 600 RPM: ceil(100/24) = 5 disparos, (5-1) * 60000/600 = 400ms.
 * - SMG 18 daño / 850 RPM: ceil(100/18) = 6 disparos, (6-1) * 60000/850 ≈ 353ms.
 *
 * El primer disparo es instantáneo (hitscan): el tiempo transcurrido es el
 * intervalo entre disparos multiplicado por (disparos - 1), no por
 * disparos. Un arma de un solo tiro da TTK = 0: es intencional, no un
 * caso sin definir (ver el comentario en sniper-bolt y shotgun más abajo).
 */
export function ttkMs(
  archetype: WeaponArchetype,
  health: number,
  distance: number = archetype.damage.optimalRange,
): number {
  const shots = shotsToKill(archetype, health, distance)
  return (shots - 1) * (60000 / archetype.fireRate)
}

export const ARCHETYPES: Record<ArchetypeId, WeaponArchetype> = {
  // SMG 1: la de la sección 5 ("SMG 18 daño / 850 RPM"). Cadencia altísima,
  // daño bajo, cargador grande, ADS instantánea: el arma de correr y
  // disparar de cerca, sin pretensión de alcance.
  'smg-1': {
    id: 'smg-1',
    class: 'smg',
    damage: { base: 18, optimalRange: 10, maxRange: 28, minMultiplier: 0.55 },
    fireRate: 850,
    fireMode: 'auto',
    magazine: 30,
    reload: { tactical: 1.6, empty: 2.1 },
    ads: { time: 0.16, fovScale: 0.95, sensScale: 0.9, speedScale: 0.92 },
    recoil: {
      pattern: generateRecoilPattern(101, 12, 0.9, 0.5, 0.15),
      recovery: 14,
      spread: { base: 0.006, max: 0.03, growthPerShot: 0.004, recoverySpeed: 0.25 },
    },
  },

  // SMG 2: PDW de cadencia más controlada y más daño por impacto que la
  // SMG 1, mejor alcance óptimo, cargador más chico. No es "una SMG 1 un
  // poco peor": gana en control y alcance lo que pierde en cadencia bruta.
  'smg-2': {
    id: 'smg-2',
    class: 'smg',
    damage: { base: 20, optimalRange: 16, maxRange: 34, minMultiplier: 0.65 },
    fireRate: 750,
    fireMode: 'auto',
    magazine: 25,
    reload: { tactical: 1.8, empty: 2.3 },
    ads: { time: 0.2, fovScale: 0.93, sensScale: 0.88, speedScale: 0.9 },
    recoil: {
      pattern: generateRecoilPattern(202, 10, 1.1, 0.35, 0.1),
      recovery: 11,
      spread: { base: 0.005, max: 0.026, growthPerShot: 0.0035, recoverySpeed: 0.22 },
    },
  },

  // AR 1: el fusil de asalto de línea de base, el ejemplo exacto de la
  // sección 5 (24 daño / 600 RPM / 400ms de TTK). El resto del arsenal se
  // mide contra esta.
  'ar-1': {
    id: 'ar-1',
    class: 'ar',
    damage: { base: 24, optimalRange: 24, maxRange: 48, minMultiplier: 0.65 },
    fireRate: 600,
    fireMode: 'auto',
    magazine: 30,
    reload: { tactical: 2.2, empty: 2.8 },
    ads: { time: 0.22, fovScale: 0.9, sensScale: 0.85, speedScale: 0.85 },
    recoil: {
      pattern: generateRecoilPattern(303, 15, 1.6, 0.8, 0.08),
      recovery: 9,
      spread: { base: 0.004, max: 0.02, growthPerShot: 0.0025, recoverySpeed: 0.18 },
    },
  },

  // AR 2: ráfaga de 3. El patrón de retroceso tiene sólo 3 entradas a
  // propósito: una ráfaga entera es el ciclo completo, y el kick se resetea
  // ráfaga a ráfaga en vez de acumularse como en un arma automática. Con un
  // cargador de 30 eso son 10 ráfagas por carga, y el patrón se repite
  // (wrap) en cada una: el retroceso dentro de una ráfaga se aprende igual
  // que el de una automática, sólo que el "ciclo" dura 3 disparos en vez
  // de todo el cargador.
  'ar-2': {
    id: 'ar-2',
    class: 'ar',
    damage: { base: 35, optimalRange: 28, maxRange: 52, minMultiplier: 0.7 },
    fireRate: 360,
    fireMode: 'burst',
    magazine: 30,
    reload: { tactical: 2.3, empty: 2.9 },
    ads: { time: 0.2, fovScale: 0.88, sensScale: 0.83, speedScale: 0.84 },
    recoil: {
      pattern: generateRecoilPattern(404, 3, 1.2, 0.3, 0.03),
      recovery: 13,
      spread: { base: 0.003, max: 0.012, growthPerShot: 0.004, recoverySpeed: 0.3 },
    },
  },

  // AR 3: fusil de batalla. Más daño y más alcance que AR 1, a costa de
  // cadencia y cargador más chico: la variante para peleas a media/larga
  // distancia dentro de la clase AR.
  'ar-3': {
    id: 'ar-3',
    class: 'ar',
    damage: { base: 32, optimalRange: 32, maxRange: 60, minMultiplier: 0.75 },
    fireRate: 500,
    fireMode: 'auto',
    magazine: 25,
    reload: { tactical: 2.4, empty: 3.0 },
    ads: { time: 0.26, fovScale: 0.85, sensScale: 0.8, speedScale: 0.8 },
    recoil: {
      pattern: generateRecoilPattern(505, 12, 1.9, 0.6, 0.1),
      recovery: 8,
      spread: { base: 0.0035, max: 0.017, growthPerShot: 0.002, recoverySpeed: 0.16 },
    },
  },

  // Francotirador de cerrojo: el "110 de cuerpo es un solo tiro" de la
  // sección 5. Cadencia bajísima (ciclo de cerrojo manual), cargador
  // chico, ADS lenta con zoom fuerte. Su TTK a rango óptimo da 0ms por la
  // fórmula (un solo disparo mata): es la excepción explícita que el
  // propio spec marca como "instantáneo", no un valor que quedó mal.
  'sniper-bolt': {
    id: 'sniper-bolt',
    class: 'sniper',
    damage: { base: 110, optimalRange: 60, maxRange: 120, minMultiplier: 0.85 },
    fireRate: 45,
    fireMode: 'semi',
    magazine: 5,
    reload: { tactical: 3.0, empty: 3.6 },
    ads: { time: 0.45, fovScale: 0.3, sensScale: 0.35, speedScale: 0.55 },
    recoil: {
      pattern: generateRecoilPattern(707, 3, 3.2, 0.1, 0.02),
      recovery: 4,
      spread: { base: 0.0005, max: 0.002, growthPerShot: 0.001, recoverySpeed: 0.5 },
    },
  },

  // Marksman semiautomático: el segundo francotirador de la sección 6,
  // agregado para que "francotirador" no sea sinónimo de "un solo tiro".
  // Mata en 2 disparos a rango óptimo con una cadencia semi bastante más
  // alta que el cerrojo: DMR, no rifle de precisión puro.
  'sniper-marksman': {
    id: 'sniper-marksman',
    class: 'marksman',
    damage: { base: 70, optimalRange: 45, maxRange: 90, minMultiplier: 0.8 },
    fireRate: 200,
    fireMode: 'semi',
    magazine: 10,
    reload: { tactical: 2.6, empty: 3.2 },
    ads: { time: 0.35, fovScale: 0.55, sensScale: 0.55, speedScale: 0.65 },
    recoil: {
      pattern: generateRecoilPattern(606, 5, 2.5, 0.2, 0.05),
      recovery: 6,
      spread: { base: 0.001, max: 0.006, growthPerShot: 0.002, recoverySpeed: 0.4 },
    },
  },

  // Escopeta: "8 pellets x 14" de la sección 5 se pliega en damage.base =
  // 112 (8 * 14), porque WeaponSpec sólo tiene un escalar de daño, no un
  // conteo de pellets separado. A optimalRange (quemarropa, 6m) mata de un
  // tiro, igual que el cerrojo: mismo caso de TTK = 0ms por diseño. La
  // caída es la más agresiva del arsenal (minMultiplier 0.35): a maxRange
  // ya no es un solo tiro.
  shotgun: {
    id: 'shotgun',
    class: 'shotgun',
    damage: { base: 112, optimalRange: 6, maxRange: 20, minMultiplier: 0.35 },
    fireRate: 70,
    fireMode: 'semi',
    magazine: 6,
    reload: { tactical: 2.8, empty: 3.4 },
    ads: { time: 0.28, fovScale: 0.97, sensScale: 0.92, speedScale: 0.88 },
    recoil: {
      pattern: generateRecoilPattern(808, 6, 1.4, 0.4, 0.12),
      recovery: 10,
      spread: { base: 0.02, max: 0.05, growthPerShot: 0.01, recoverySpeed: 0.3 },
    },
  },

  // LMG: cargador de 100, la mayor sostenibilidad de fuego del arsenal.
  // Daño por disparo bajo y subida de retroceso lenta a propósito (climb
  // 0.8, el más chico del arsenal automático): está diseñada para
  // disparar mucho tiempo seguido sin perder el control, no para ráfagas
  // cortas. Recarga la más lenta con diferencia.
  lmg: {
    id: 'lmg',
    class: 'lmg',
    damage: { base: 22, optimalRange: 22, maxRange: 55, minMultiplier: 0.7 },
    fireRate: 700,
    fireMode: 'auto',
    magazine: 100,
    reload: { tactical: 4.5, empty: 5.5 },
    ads: { time: 0.4, fovScale: 0.92, sensScale: 0.8, speedScale: 0.7 },
    recoil: {
      pattern: generateRecoilPattern(909, 20, 0.8, 0.45, 0.1),
      recovery: 7,
      spread: { base: 0.005, max: 0.035, growthPerShot: 0.0015, recoverySpeed: 0.1 },
    },
  },

  // Pistola: la secundaria. Daño alto por disparo para un arma de
  // respaldo, cadencia limitada por el gatillo semiauto, ADS la más rápida
  // del arsenal (arma liviana), caída agresiva: es para rematar de cerca,
  // no para pelear a distancia.
  pistol: {
    id: 'pistol',
    class: 'pistol',
    damage: { base: 34, optimalRange: 12, maxRange: 30, minMultiplier: 0.55 },
    fireRate: 400,
    fireMode: 'semi',
    magazine: 12,
    reload: { tactical: 1.3, empty: 1.7 },
    ads: { time: 0.14, fovScale: 0.96, sensScale: 0.92, speedScale: 0.95 },
    recoil: {
      pattern: generateRecoilPattern(1010, 12, 1.3, 0.5, 0.12),
      recovery: 12,
      spread: { base: 0.006, max: 0.022, growthPerShot: 0.005, recoverySpeed: 0.28 },
    },
  },
}

export const ARCHETYPE_LIST: WeaponArchetype[] = Object.values(ARCHETYPES)
