/**
 * Geometría pura del pipeline de conversión de armas.
 *
 * Todo lo de acá es determinístico y no toca disco ni un Document de
 * gltf-transform: sólo arrays de números. Eso es lo que permite testearlo
 * sin depender de un FBX real ni del binario de FBX2glTF.
 */

/**
 * Largo objetivo por clase de arma, en metros, medido sobre la dimensión
 * mayor tras normalizar. Valores aproximados al largo real de cada clase:
 * una pistola no puede terminar del mismo largo que un fusil de asalto, o
 * se pierde la sensación de escala entre el arsenal en el viewmodel.
 *
 * Las claves son substrings en minúscula que se buscan en el nombre del
 * archivo de origen (ver `targetLengthFor`). Ninguna clave es substring de
 * otra, así que el orden de este objeto no importa: no hay forma de que,
 * por ejemplo, "submachinegun" matchee por accidente la entrada de
 * "shotgun" (ambas contienen "gun", pero ninguna contiene a la otra
 * completa), ni que "assaultrifle" y "sniperrifle" se confundan entre sí
 * (ambas contienen "rifle", pero tampoco una es substring de la otra).
 */
export const WEAPON_CLASS_LENGTHS_M = {
  pistol: 0.22,
  revolver: 0.22,
  submachinegun: 0.45,
  bullpup: 0.65,
  assaultrifle: 0.85,
  shotgun: 0.95,
  sniperrifle: 1.15,
} as const

/** Largo objetivo cuando el nombre del archivo no matchea ninguna clase conocida. */
export const DEFAULT_TARGET_LENGTH_M = 0.75

/**
 * Largo objetivo en metros para un arma, a partir del nombre de su archivo
 * de origen (p.ej. "AssaultRifle2_1"). El matcheo es por substring, sin
 * distinguir mayúsculas de minúsculas, así "AssaultRifle2_1" matchea
 * "assaultrifle" (es una variante del fusil de asalto, no una clase aparte)
 * igual que "AssaultRifle_4". Si no matchea nada, cae a
 * `DEFAULT_TARGET_LENGTH_M`.
 */
export function targetLengthFor(name: string): number {
  const normalized = name.toLowerCase()
  for (const [key, length] of Object.entries(WEAPON_CLASS_LENGTHS_M)) {
    if (normalized.includes(key)) return length
  }
  return DEFAULT_TARGET_LENGTH_M
}

/** Matriz 4x4 column-major, igual al tipo `mat4` de @gltf-transform/core. */
export type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
]

/** Angosta un array de 16 números a Mat4 sin recurrir a `any`. */
function assertMat4(arr: number[]): asserts arr is Mat4 {
  if (arr.length !== 16) {
    throw new Error(`la matriz debe tener 16 elementos, tiene ${arr.length}`)
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function displayName(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function boundsOf(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a]
      if (v < min[a]) min[a] = v
      if (v > max[a]) max[a] = v
    }
  }
  return { min, max }
}

/**
 * Cantidad de rebanadas en que se corta el arma a lo largo del eje del cañón
 * para medir su perfil de grosor. Doce alcanza para separar cañón de culata
 * incluso en una pistola de 22 cm (rebanadas de ~18 mm) y es lo bastante
 * grueso como para que ninguna quede vacía por falta de vértices en un
 * modelo low-poly.
 */
const MUZZLE_PROFILE_SLICES = 12

/**
 * Mediana de una lista no vacía de números. La mediana -y no el promedio- es
 * lo que hace robusta la medición de grosor: un arma tiene una o dos
 * rebanadas gordas (el cajón de mecanismos, la mira telescópica) que
 * arrastran cualquier promedio, mientras que lo que distingue al lado del
 * cañón es que la MAYORÍA de sus rebanadas son finas.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Determina el eje del cañón y hacia qué lado apunta la boca.
 *
 * El eje es la dimensión mayor de la caja envolvente: un arma es larga en la
 * dirección del cañón. Para el sentido vale la regla física obvia -la boca
 * está en el extremo más delgado, porque del lado opuesto viven culata,
 * empuñadura y cargador- pero lo que decide el resultado no es la regla sino
 * cómo se mide "más delgada". Acá se mide así:
 *
 *   1. Se corta el arma en rebanadas perpendiculares al eje del cañón.
 *   2. De cada rebanada se toma su sección transversal LOCAL: la mayor de
 *      las dos extensiones perpendiculares dentro de esa rebanada.
 *   3. Se compara la MEDIANA de las rebanadas de cada mitad. La boca apunta
 *      hacia la mitad de mediana menor.
 *
 * Los tres puntos son deliberados, porque la versión anterior medía el
 * grosor como el promedio, por vértice, de la distancia de cada vértice al
 * EJE CENTRAL de la caja envolvente, y eso se equivocaba en la mayoría de un
 * pack CC0 real (33 de 40 armas quedaban al revés) por dos razones
 * independientes:
 *
 *   - Distancia al eje central no es grosor. La empuñadura y el cargador
 *     cuelgan hacia abajo, así que el centro de la caja envolvente queda por
 *     DEBAJO de la línea del cañón. Medido desde ahí, el cañón -fino pero
 *     lejos del centro- puntúa alto, y el cajón de mecanismos -gordo pero
 *     montado justo sobre ese centro- puntúa bajo. La medición terminaba
 *     diciendo que el cañón era la parte gruesa. Medir la extensión dentro
 *     de la rebanada elimina el problema: no hay un centro global del que
 *     depender.
 *   - Promediar por vértice mide densidad de malla, no geometría. Miras,
 *     guardamontes y empuñaduras concentran muchos vértices en poco volumen
 *     y dominaban el promedio. Una rebanada pesa lo mismo que cualquier otra
 *     tenga 8 vértices o 400.
 *
 * Se usa la MAYOR de las dos extensiones y no el área ni la diagonal porque
 * distingue mejor un cañón de una culata: el cañón es fino en las dos
 * direcciones, mientras que la culata es angosta pero alta, y esa altura es
 * justamente la señal.
 *
 * La confianza es la diferencia relativa entre ambas medianas. Un arma casi
 * simétrica sobre su eje -un subfusil con culata plegable, tan fina como su
 * cañón- da confianza baja y hay que revisarla a mano.
 */
export function detectMuzzle(positions: Float32Array): {
  axis: 0 | 1 | 2
  sign: 1 | -1
  confidence: number
} {
  const { min, max } = boundsOf(positions)
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]

  let axis: 0 | 1 | 2 = 0
  if (size[1] > size[axis]) axis = 1
  if (size[2] > size[axis]) axis = 2

  const perp = [0, 1, 2].filter((a) => a !== axis)
  const span = size[axis]

  // Extensión perpendicular por rebanada, acumulada como min/max local.
  const sliceMin = Array.from({ length: MUZZLE_PROFILE_SLICES }, () => [Infinity, Infinity])
  const sliceMax = Array.from({ length: MUZZLE_PROFILE_SLICES }, () => [-Infinity, -Infinity])

  for (let i = 0; i < positions.length; i += 3) {
    const t = span > 0 ? (positions[i + axis] - min[axis]) / span : 0
    let slice = Math.floor(t * MUZZLE_PROFILE_SLICES)
    if (slice >= MUZZLE_PROFILE_SLICES) slice = MUZZLE_PROFILE_SLICES - 1
    if (slice < 0) slice = 0

    for (let k = 0; k < 2; k++) {
      const v = positions[i + perp[k]]
      if (v < sliceMin[slice][k]) sliceMin[slice][k] = v
      if (v > sliceMax[slice][k]) sliceMax[slice][k] = v
    }
  }

  const low: number[] = []
  const high: number[] = []
  const half = MUZZLE_PROFILE_SLICES / 2

  for (let s = 0; s < MUZZLE_PROFILE_SLICES; s++) {
    // Una rebanada sin vértices no aporta: no es "delgada", es un hueco del
    // modelo, y contarla como cero inclinaría la mediana de esa mitad.
    if (sliceMin[s][0] === Infinity) continue
    const thickness = Math.max(sliceMax[s][0] - sliceMin[s][0], sliceMax[s][1] - sliceMin[s][1])
    if (s < half) low.push(thickness)
    else high.push(thickness)
  }

  // Sin vértices de un lado no hay comparación posible: se devuelve una
  // orientación cualquiera con confianza nula, que es exactamente lo que
  // `needsManualReview` está para atrapar.
  if (low.length === 0 || high.length === 0) return { axis, sign: -1, confidence: 0 }

  const lowThickness = median(low)
  const highThickness = median(high)
  const denom = Math.max(lowThickness, highThickness)
  const confidence = denom > 0 ? Math.abs(lowThickness - highThickness) / denom : 0

  // La boca apunta hacia la mitad más delgada.
  const sign: 1 | -1 = highThickness < lowThickness ? 1 : -1
  return { axis, sign, confidence }
}

/**
 * Determina cuál de los dos ejes perpendiculares al cañón es el eje
 * "arriba" real del arma.
 *
 * No se puede asumir Y-up: los packs de Quaternius vienen exportados desde
 * Blender, que es Z-up, así que asumir Y a secas deja el arma acostada de
 * lado. En vez de asumir, se mide: de los dos ejes que no son el del cañón,
 * el de mayor extensión en la caja envolvente es "arriba", porque la
 * silueta de un arma es más alta (mira, cargador, culata) que ancha
 * (grosor del cuerpo).
 *
 * La confianza se calcula igual que en `detectMuzzle`: la diferencia
 * relativa entre las dos extensiones candidatas. Una sección transversal
 * casi cuadrada da confianza baja y hay que revisarla a mano.
 */
export function detectUpAxis(
  positions: Float32Array,
  barrelAxis: 0 | 1 | 2,
): { axis: 0 | 1 | 2; confidence: number } {
  const { min, max } = boundsOf(positions)
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const candidates = ([0, 1, 2] as const).filter((a) => a !== barrelAxis)
  const [a, b] = candidates

  const axis = size[a] >= size[b] ? a : b
  const denom = Math.max(size[a], size[b])
  const confidence = denom > 0 ? Math.abs(size[a] - size[b]) / denom : 0

  return { axis, confidence }
}

/**
 * Matriz que lleva el eje del cañón a -Z conservando el eje "arriba" como
 * +Y, escala al largo objetivo y centra en el origen. Column-major, como
 * espera glTF.
 */
export function buildNormalizeMatrix(
  positions: Float32Array,
  axis: 0 | 1 | 2,
  sign: 1 | -1,
  upAxis: 0 | 1 | 2,
  targetLengthM: number,
): Mat4 {
  const { min, max } = boundsOf(positions)
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const scale = size[axis] > 0 ? targetLengthM / size[axis] : 1

  // Filas de la rotación: a dónde va cada eje de origen.
  // El eje del cañón va a -Z, con el signo detectado.
  const rot = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  rot[2][axis] = -sign

  // El eje "arriba", detectado por `detectUpAxis` y no asumido, se mantiene
  // como +Y.
  rot[1][upAxis] = 1

  // El tercero sale del producto cruz para conservar la orientación.
  const r1 = rot[1]
  const r2 = rot[2]
  rot[0] = [
    r1[1] * r2[2] - r1[2] * r2[1],
    r1[2] * r2[0] - r1[0] * r2[2],
    r1[0] * r2[1] - r1[1] * r2[0],
  ]

  // Componer: primero trasladar al centro, después rotar y escalar.
  const m = new Array<number>(16).fill(0)
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      m[col * 4 + row] = rot[row][col] * scale
    }
  }
  for (let row = 0; row < 3; row++) {
    m[12 + row] = -(
      rot[row][0] * center[0] +
      rot[row][1] * center[1] +
      rot[row][2] * center[2]
    ) * scale
  }
  m[15] = 1
  assertMat4(m)
  return m
}
