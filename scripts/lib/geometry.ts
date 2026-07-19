/**
 * Geometría pura del pipeline de conversión de armas.
 *
 * Todo lo de acá es determinístico y no toca disco ni un Document de
 * gltf-transform: sólo arrays de números. Eso es lo que permite testearlo
 * sin depender de un FBX real ni del binario de FBX2glTF.
 */

/** Largo objetivo del arma en metros, medido sobre su dimensión mayor. */
export const TARGET_LENGTH_M = 0.6

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
 * Determina el eje del cañón y hacia qué lado apunta la boca.
 *
 * El eje es la dimensión mayor de la caja envolvente: un arma es larga en la
 * dirección del cañón. Para el sentido, se parte el arma por la mitad de ese
 * eje y se compara el grosor promedio de cada mitad. La mitad del cañón es
 * notoriamente más delgada que la de la culata y el cargador, así que la boca
 * apunta hacia la mitad más delgada.
 *
 * La confianza es la diferencia relativa de grosor. Un arma casi simétrica da
 * confianza baja y hay que revisarla a mano.
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

  const mid = (min[axis] + max[axis]) / 2
  const perp = [0, 1, 2].filter((a) => a !== axis)

  let lowSum = 0
  let lowCount = 0
  let highSum = 0
  let highCount = 0

  for (let i = 0; i < positions.length; i += 3) {
    const centerA = (min[perp[0]] + max[perp[0]]) / 2
    const centerB = (min[perp[1]] + max[perp[1]]) / 2
    const da = positions[i + perp[0]] - centerA
    const db = positions[i + perp[1]] - centerB
    const radius = Math.hypot(da, db)

    if (positions[i + axis] < mid) {
      lowSum += radius
      lowCount++
    } else {
      highSum += radius
      highCount++
    }
  }

  const lowAvg = lowCount > 0 ? lowSum / lowCount : 0
  const highAvg = highCount > 0 ? highSum / highCount : 0
  const denom = Math.max(lowAvg, highAvg)
  const confidence = denom > 0 ? Math.abs(lowAvg - highAvg) / denom : 0

  // La boca apunta hacia la mitad más delgada.
  const sign: 1 | -1 = highAvg < lowAvg ? 1 : -1
  return { axis, sign, confidence }
}

/**
 * Matriz que lleva el eje del cañón a -Z conservando +Y arriba, escala al
 * largo objetivo y centra en el origen. Column-major, como espera glTF.
 */
export function buildNormalizeMatrix(
  positions: Float32Array,
  axis: 0 | 1 | 2,
  sign: 1 | -1,
): Mat4 {
  const { min, max } = boundsOf(positions)
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const scale = size[axis] > 0 ? TARGET_LENGTH_M / size[axis] : 1

  // Filas de la rotación: a dónde va cada eje de origen.
  // El eje del cañón va a -Z, con el signo detectado.
  const rot = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  rot[2][axis] = -sign

  // El eje vertical de origen se mantiene como +Y, salvo que sea el del cañón.
  const upAxis = axis === 1 ? 2 : 1
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
