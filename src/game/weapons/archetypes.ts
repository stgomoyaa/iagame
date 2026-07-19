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
  /**
   * Offsets [x, y] determinista, indexado por número de disparo, en
   * radianes de cámara: mismo eje que `PITCH_LIMIT` (engine/input.ts), ya
   * que el pitch de la cámara es lo que va a consumir este patrón. `y` es
   * la subida vertical acumulada (siempre >= 0, monótona no decreciente
   * dentro del patrón); `x` es el serpenteo horizontal. Ver
   * recoilOffsetForShot() y generateRecoilPattern(). Referencia física
   * para calibrar `y`: AR_REFERENCE_CLIMB_DEG_MIN/MAX más abajo.
   */
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
 * Referencia física para la subida vertical total del retroceso sobre un
 * cargador completo de fuego sostenido: un rifle de asalto real (CS,
 * Valorant) sube 15-20° en total a lo largo de todo el cargador. Es el
 * ancla de todo el arsenal — `ar-1` la reproduce casi exacta porque es el
 * arquetipo de línea base (sección 6 del spec). El resto escala relativo a
 * esto por carácter: la LMG sube más en total por su cargador de 100 (más
 * balas acumulando climb, aunque el ritmo por disparo sea el más suave del
 * arsenal); un arma semi/cerrojo de cadencia bajísima (sniper-bolt) da un
 * golpe seco chico en vez de una escalada, porque en la práctica hay
 * sobra de tiempo para que la cámara se recupere entre disparos; una
 * ráfaga corta (ar-2) resetea antes de acercarse siquiera al techo de un
 * cargador completo, porque su "cargador" a efectos de retroceso es la
 * ráfaga de 3 balas, no las 30 del arma. Ver los tests de banda física en
 * archetypes.test.ts.
 */
export const AR_REFERENCE_CLIMB_DEG_MIN = 15
export const AR_REFERENCE_CLIMB_DEG_MAX = 20

/**
 * Conversión grados <-> radianes: sólo para expresar de forma legible los
 * parámetros de retroceso de cada arquetipo (y sus tests) en grados, la
 * unidad en la que humanamente se razona un ángulo de cámara. El resto del
 * archivo y el motor siguen trabajando 100% en radianes (ver encabezado).
 */
export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI
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
 * Cuántos disparos (en absoluto, no como fracción del cargador) le toma a
 * la curva vertical llegar a su punto medio de subida. Es un conteo
 * ABSOLUTO a propósito, no una fracción del largo del patrón: la ventana
 * real en la que un jugador puede seguir tirando "al bulto" antes de que el
 * arma empiece a subir en serio es fisiológica (el retroceso tarda lo mismo
 * en manifestarse en un cargador de 12 que en uno de 100), no proporcional
 * al tamaño del cargador. Con un valor fijo, cualquier arma (pistola de 12
 * o LMG de 100) tiene una apertura ajustada de verdad en vez de que el
 * cargador largo la diluya. 16 deja los primeros 2-3 disparos bien planos
 * (ver el test de share en archetypes.test.ts) sin que el paso más
 * pronunciado de la rampa (que cae justo en este punto medio) se dispare
 * por encima del múltiplo de paso típico que ya vigila el test de
 * discontinuidades (la lmg, con su cargador de 100, es la que más al límite
 * queda: ~8.7x el paso típico, bajo el techo de 12x).
 */
const VERTICAL_RISE_SHOTS = 16

/**
 * Fracción (chica) del climb total que sigue subiendo de forma lineal y
 * pareja a lo largo de TODO el patrón, por encima de la curva de rampa
 * (`smoothstep`). Sin esto, una vez pasado el punto de rise, la pendiente
 * de la rampa cae a casi cero (plateau perfecto) y el jitter — que es
 * ruido, puede ir para cualquier lado — podría hacer que un disparo quede
 * más abajo que el anterior, rompiendo la garantía de "nunca baja" incluso
 * antes del clamp de abajo. Un colchón lineal chico mantiene una pendiente
 * de fondo siempre positiva bajo la rampa, así el plateau es "casi plano",
 * no "matemáticamente plano".
 */
const VERTICAL_TAIL_SHARE = 0.08

/**
 * Fracción del patrón (relativa, no absoluta como VERTICAL_RISE_SHOTS)
 * antes de que el serpenteo horizontal empiece a moverse. A diferencia de
 * la vertical, acá SÍ tiene que ser una fracción del cargador entero: la
 * propiedad que hay que garantizar es "el primer cuarto del cargador se
 * mueve poco", así que el punto de arranque del serpenteo tiene que quedar
 * por delante de ese cuarto (0.3 > 0.25) para cualquier arma, sea cual sea
 * su largo — con un conteo absoluto (como el de la vertical) un cargador de
 * 100 balas (lmg) dejaría el arranque mucho antes del primer cuarto.
 */
const HORIZONTAL_RISE_FRACTION = 0.3

/** Cuántos ciclos completos de seno entra el serpenteo horizontal una vez
 *  que arranca (después de HORIZONTAL_RISE_FRACTION): más de un ciclo
 *  entero para que se note el zigzag izquierda-derecha-izquierda típico de
 *  CS, no el medio-arco suave que tenía la curva vieja. */
const HORIZONTAL_SWEEP_CYCLES = 2.25

/** Curva de Hermite: 0 en x=0, 1 en x=1, pendiente 0 en ambos extremos. Es
 *  la "S" que da la apertura ajustada al arrancar y el aplanado al llegar
 *  al final de la rampa, sin discontinuidad de pendiente en ninguno de los
 *  dos empalmes (con el plateau de después, y con el cero de shot 0). */
function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/**
 * Genera un patrón de retroceso determinista de `length` disparos, con la
 * silueta de tres fases de un spray estilo CS/Valorant:
 *
 * 1. Apertura: los primeros disparos casi no se mueven (tirar al bulto
 *    tiene que ser preciso). El disparo 0 es EXACTAMENTE [0, 0] — sin
 *    jitter siquiera — porque el primer balazo de un cargador fresco no
 *    puede tener ningún desvío, ni el del ruido.
 * 2. Rampa: una subida vertical larga y bastante recta a lo largo de más o
 *    menos el primer tercio del cargador (`VERTICAL_RISE_SHOTS` disparos en
 *    términos absolutos — ver su comentario). `smoothstep` da el tramo
 *    lento-rápido-lento característico: lento al arrancar (fase 1), rápido
 *    en el medio (la rampa en sí), lento otra vez al acercarse al techo
 *    (el aplane hacia la fase 3).
 * 3. Plateau + serpenteo: pasado el punto de rise, la vertical ya está
 *    prácticamente en su techo (`VERTICAL_TAIL_SHARE` la sigue empujando
 *    un poco, apenas, para no quedar matemáticamente plana bajo jitter — ver
 *    su comentario) y el resto del cargador lo domina el serpenteo
 *    horizontal, que recién ahí arranca (antes de `HORIZONTAL_RISE_FRACTION`
 *    del cargador el horizontal es CERO exacto, no sólo chico).
 *
 * Antes (bug corregido): la vertical subía con `sqrt(progress)`, que tiene
 * su pendiente más pronunciada justo al arrancar — el primer disparo solo
 * ya se comía ~18% de todo el climb del cargador (medido sobre un AR de 30
 * balas), exactamente al revés de cómo sube un arma real. El horizontal
 * serpenteaba con un solo medio-seno a lo largo de TODO el cargador en
 * simultáneo con esa subida — la combinación daba una "banana" suave en vez
 * de la silueta de tallo-recto-y-luego-zigzag de un patrón real. Ver los
 * tests de forma en archetypes.test.ts (comparan proporciones, no números
 * fijos, para que una futura recalibración los siga poniendo a prueba).
 *
 * `jitter` tiene que quedar chico *relativo al paso típico entre disparos*
 * (`verticalClimb / (length - 1)`), no relativo a `verticalClimb` total: un
 * patrón largo (la LMG, 100 disparos) tiene pasos típicos diminutos, así
 * que un jitter pensado como fracción del climb total puede terminar
 * siendo varias veces más grande que el paso real entre dos disparos
 * consecutivos y generar saltos erráticos que rompen la aprendibilidad
 * tanto como un wrap roto (ver el test de pasos en archetypes.test.ts).
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
  const riseFraction = length > 1 ? Math.min(1, VERTICAL_RISE_SHOTS / (length - 1)) : 1
  const sweepSpan = Math.max(1e-6, 1 - HORIZONTAL_RISE_FRACTION)
  let previousVertical = 0

  for (let i = 0; i < length; i++) {
    const progress = length > 1 ? i / (length - 1) : 1
    const verticalNoise = (rand() - 0.5) * jitter
    const horizontalNoise = (rand() - 0.5) * jitter

    // Disparo 0: exactamente cero, sin jitter. Se descarta el ruido ya
    // consumido del PRNG (no se salta la llamada a rand()) para que el resto
    // de la secuencia no dependa de si el disparo 0 tiene o no jitter.
    if (i === 0) {
      pattern.push([0, 0])
      previousVertical = 0
      continue
    }

    const climbShape = (1 - VERTICAL_TAIL_SHARE) * smoothstep(progress / riseFraction) + VERTICAL_TAIL_SHARE * progress
    const verticalRaw = verticalClimb * climbShape + verticalNoise
    // Nunca baja del disparo anterior: la rampa de base (climbShape) ya es
    // monótona por construcción, pero el jitter solo, sumado encima de un
    // tramo casi plano del plateau, sí podría hacerla retroceder un pelo.
    // Este clamp es la garantía dura, no una esperanza estadística.
    const vertical = Math.max(verticalRaw, previousVertical)
    previousVertical = vertical

    const sweepProgress = Math.max(0, progress - HORIZONTAL_RISE_FRACTION) / sweepSpan
    const horizontal =
      horizontalDrift * Math.sin(sweepProgress * HORIZONTAL_SWEEP_CYCLES * Math.PI * 2) + horizontalNoise

    pattern.push([horizontal, vertical])
  }

  return pattern
}

/**
 * Offset de retroceso para el disparo `shotIndex` (0-based, absoluto desde
 * que se vació el cargador, no desde que empezó a disparar).
 *
 * Decisión: el patrón cubre el cargador entero, sin wrap. Antes se envolvía
 * por módulo cuando el patrón era más corto que el cargador, justificado
 * como si reprodujera "un micro-patrón cíclico" — pero generateRecoilPattern()
 * genera una rampa monótonamente creciente (`verticalClimb * sqrt(progress)`),
 * no un ciclo, así que el wrap hacía caer la cámara del pico a casi cero de
 * un salto en medio del spray (hasta 110° de discontinuidad medidos por QA).
 * Eso rompe exactamente la "aprendibilidad" que pide la sección 5 del spec:
 * si además el cargador no es múltiplo exacto del patrón, el último ciclo
 * queda truncado y las últimas balas de la carga tienen un offset distinto
 * al que tuvieron la vez anterior que se llegó a ese índice. Ahora cada
 * arma automática o semiautomática tiene un patrón del mismo largo que su
 * cargador (`pattern.length === magazine`): es más datos, pero es barato, y
 * es lo que hacen CS y Valorant.
 *
 * Excepción: las armas en ráfaga (`fireMode === 'burst'`, ver ar-2) sí
 * repiten un patrón corto — pero el ciclo que se repite es la ráfaga, no el
 * cargador entero, y el retroceso se resetea a propósito ráfaga a ráfaga
 * (hay una pausa de gatillo real entre cada una, tiempo de sobra para que
 * la cámara recupere). Ahí el wrap es intencional, y el cargador siempre es
 * múltiplo exacto del patrón (`magazine % pattern.length === 0`), así que
 * ninguna ráfaga queda truncada a mitad de ciclo.
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
      // Climb total 12° sobre el cargador entero (30 balas): menos que el
      // AR base porque el calibre es más chico, ver AR_REFERENCE_CLIMB_DEG_MIN/MAX.
      pattern: generateRecoilPattern(101, 30, degToRad(12), degToRad(6), degToRad(0.1)),
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
      // Climb total 9° sobre el cargador entero (25 balas): menos que la
      // smg-1, coherente con "gana en control" del comentario de arriba.
      pattern: generateRecoilPattern(202, 25, degToRad(9), degToRad(3), degToRad(0.1)),
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
      // Climb total 17.5° sobre el cargador entero (30 balas): el punto
      // medio de la referencia real de 15-20°, porque este es el arquetipo
      // de línea base contra el que se mide el resto del arsenal.
      pattern: generateRecoilPattern(303, 30, degToRad(17.5), degToRad(8), degToRad(0.15)),
      recovery: 9,
      spread: { base: 0.004, max: 0.02, growthPerShot: 0.0025, recoverySpeed: 0.18 },
    },
  },

  // AR 2: ráfaga de 3. El patrón de retroceso tiene sólo 3 entradas a
  // propósito: una ráfaga entera es el ciclo completo, y el kick se resetea
  // ráfaga a ráfaga en vez de acumularse como en un arma automática, porque
  // hay una pausa de gatillo real entre ráfagas con tiempo de sobra para que
  // la cámara recupere. Con un cargador de 30 eso son 10 ráfagas por carga,
  // y el patrón se repite (wrap) en cada una, exacto (30 % 3 === 0, ninguna
  // ráfaga queda truncada): el retroceso dentro de una ráfaga se aprende
  // igual que el de una automática, sólo que el "ciclo" dura 3 disparos en
  // vez de todo el cargador. Climb total 5° por ráfaga: consistente con lo
  // que ar-1 (el AR base) alcanza en sus primeros 3 disparos.
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
      pattern: generateRecoilPattern(404, 3, degToRad(5), degToRad(1.5), degToRad(0.3)),
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
      // Climb total 20° sobre el cargador entero (25 balas): más que el AR
      // base porque pega más fuerte por disparo, aunque con menos balas.
      pattern: generateRecoilPattern(505, 25, degToRad(20), degToRad(6), degToRad(0.2)),
      recovery: 8,
      spread: { base: 0.0035, max: 0.017, growthPerShot: 0.002, recoverySpeed: 0.16 },
    },
  },

  // Francotirador de cerrojo: el "110 de cuerpo es un solo tiro" de la
  // sección 5. Cadencia bajísima (ciclo de cerrojo manual), cargador
  // chico, ADS lenta con zoom fuerte. Su TTK a rango óptimo da 0ms por la
  // fórmula (un solo disparo mata): es la excepción explícita que el
  // propio spec marca como "instantáneo", no un valor que quedó mal. El
  // retroceso tampoco es una escalada de spray: entre disparo y disparo hay
  // sobra de tiempo para ciclar el cerrojo a mano, la cámara ya recuperó
  // antes del siguiente tiro. Climb total bajo (7°) sobre sólo 5 disparos,
  // cada uno un golpe seco más que un peldaño de una rampa.
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
      pattern: generateRecoilPattern(707, 5, degToRad(7), degToRad(0.3), degToRad(0.2)),
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
      pattern: generateRecoilPattern(606, 10, degToRad(11), degToRad(1), degToRad(0.2)),
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
      pattern: generateRecoilPattern(808, 6, degToRad(9), degToRad(2.5), degToRad(0.3)),
      recovery: 10,
      spread: { base: 0.02, max: 0.05, growthPerShot: 0.01, recoverySpeed: 0.3 },
    },
  },

  // LMG: cargador de 100, la mayor sostenibilidad de fuego del arsenal.
  // Daño por disparo bajo. La subida total de retroceso (24°) es la más
  // alta del arsenal en términos absolutos porque el cargador es el más
  // largo con diferencia — pero el ritmo por disparo es el más suave con
  // diferencia (24° repartidos en 100 disparos vs. 17.5° en 30 para ar-1):
  // está diseñada para disparar mucho tiempo seguido sin perder el
  // control, no para ráfagas cortas. Recarga la más lenta con diferencia.
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
      pattern: generateRecoilPattern(909, 100, degToRad(24), degToRad(13), degToRad(0.05)),
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
      pattern: generateRecoilPattern(1010, 12, degToRad(10), degToRad(4), degToRad(0.15)),
      recovery: 12,
      spread: { base: 0.006, max: 0.022, growthPerShot: 0.005, recoverySpeed: 0.28 },
    },
  },
}

export const ARCHETYPE_LIST: WeaponArchetype[] = Object.values(ARCHETYPES)
