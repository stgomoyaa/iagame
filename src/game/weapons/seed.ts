/**
 * Offsets heurísticos por defecto para `hipOffset` y `adsOffset`, derivados
 * del bounding box de cada modelo en `public/assets/weapons/index.json`.
 *
 * Son puntos de partida, no valores finales. El panel de tuning en vivo
 * (sección 6.4 del spec) los pisa cuando alguien los ajusta a mano, y
 * `weapons_tuning.json` prevalece sobre lo que devuelve este archivo. El
 * objetivo es que las 40 armas sean usables el día que el pipeline las
 * convierte, sin que nadie haya tocado nada todavía.
 */

export interface WeaponBounds {
  min: number[]
  max: number[]
}

/** Forma de una entrada de index.json. Ver scripts/convert-weapons.ts. */
export interface WeaponIndexEntry {
  slug: string
  name: string
  triangles: number
  bounds: WeaponBounds
  muzzleConfidence: number
  upAxisConfidence: number
  needsManualReview: boolean
}

/** Posición (metros) + rotación (radianes) de una pose del viewmodel. */
export interface Transform {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

// Fracciones expresadas como proporción del eje más largo del bounding box
// (en la práctica, casi siempre Z: el pipeline normaliza todos los modelos
// con el cañón apuntando a -Z, sección 6.3 del spec). Ese es el eje que más
// varía entre una pistola (~0.22m de largo) y un rifle (~0.85m); escalar
// por ancho o alto casi no cambiaría nada entre armas, porque esas dos
// dimensiones son parecidas en toda la familia de modelos convertidos.
const HIP_RIGHT_FRAC = 0.35
const HIP_DOWN_FRAC = 0.3
const HIP_BACK_FRAC = 0.55
const ADS_RAISE_FRAC = 0.5
const ADS_FORWARD_FRAC = 0.15

/**
 * Tamaño característico del modelo: el eje más largo de su bounding box.
 * Usar un solo número (en vez de escalar cada eje por su propia
 * dimensión) evita offsets asimétricos raros cuando un modelo es más ancho
 * que alto o viceversa; lo que importa para la pose es "cuán grande es
 * este objeto en general", y el eje más largo lo resume bien porque en
 * armas siempre es el largo del cañón.
 */
function characteristicSize(bounds: WeaponBounds): number {
  const sizeX = bounds.max[0] - bounds.min[0]
  const sizeY = bounds.max[1] - bounds.min[1]
  const sizeZ = bounds.max[2] - bounds.min[2]
  return Math.max(sizeX, sizeY, sizeZ)
}

/**
 * Pose de cadera: abajo y a la derecha del centro del modelo, tirada hacia
 * la cámara (+Z, porque el cañón normalizado apunta a -Z, así que +Z es
 * "hacia el jugador"). Es la pose de "cargar el arma a la cadera" clásica
 * de un shooter en primera persona: el arma no tapa el centro de la
 * pantalla y queda visible en el cuadrante inferior derecho.
 *
 * Todo se escala por el tamaño característico del arma para que una
 * pistola no termine en la misma posición que un rifle: un modelo grande
 * necesita más distancia para no invadir el centro de la pantalla, uno
 * chico puede quedar más cerca del eje de cámara.
 */
export function seedHipOffset(entry: WeaponIndexEntry): Transform {
  const { bounds } = entry
  const centerX = (bounds.min[0] + bounds.max[0]) / 2
  const centerY = (bounds.min[1] + bounds.max[1]) / 2
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2
  const size = characteristicSize(bounds)

  return {
    x: centerX + size * HIP_RIGHT_FRAC,
    y: centerY - size * HIP_DOWN_FRAC,
    z: centerZ + size * HIP_BACK_FRAC,
    rx: 0,
    ry: 0,
    rz: 0,
  }
}

/**
 * Pose de apuntado (ADS): centrada en el eje de la cámara horizontalmente
 * (las miras de hierro quedan en la línea de mira, no a un costado),
 * levantada hasta cerca del borde superior del bounding box (ahí viven las
 * miras en casi cualquier arma: por encima del cañón, no en el centro
 * vertical del modelo), y empujada hacia adelante en relación a la pose de
 * cadera: en ADS el arma se acerca al ojo para alinear la mira, así que
 * usa una fracción bastante menor que HIP_BACK_FRAC en vez de una mayor.
 */
export function seedAdsOffset(entry: WeaponIndexEntry): Transform {
  const { bounds } = entry
  const centerY = (bounds.min[1] + bounds.max[1]) / 2
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2
  const sizeY = bounds.max[1] - bounds.min[1]
  const size = characteristicSize(bounds)

  return {
    x: 0,
    y: centerY + (sizeY / 2) * ADS_RAISE_FRAC,
    z: centerZ + size * ADS_FORWARD_FRAC,
    rx: 0,
    ry: 0,
    rz: 0,
  }
}

/** Conveniencia: ambas poses de una sola pasada sobre el bounding box. */
export function seedWeaponOffsets(entry: WeaponIndexEntry): {
  hipOffset: Transform
  adsOffset: Transform
} {
  return { hipOffset: seedHipOffset(entry), adsOffset: seedAdsOffset(entry) }
}
