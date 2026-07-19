import { describe, expect, it } from 'vitest'
import {
  TARGET_LENGTH_M,
  boundsOf,
  buildNormalizeMatrix,
  detectMuzzle,
  displayName,
  slugify,
} from './geometry'

// ---------- helpers de prueba ----------

type Vec3 = [number, number, number]

/** Aplica una matriz 4x4 column-major (como espera glTF) a un punto. */
function applyMat4(m: readonly number[], p: Vec3): Vec3 {
  const [x, y, z] = p
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

/** Igual que applyMat4 pero ignora la traslación: sirve para direcciones. */
function applyMat4Direction(m: readonly number[], v: Vec3): Vec3 {
  const [x, y, z] = v
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ]
}

/**
 * Determinante del bloque 3x3 superior izquierdo de la matriz (la parte
 * lineal: rotación + escala, sin la traslación). Si es negativo, la
 * transformación incluye un reflejo y el arma sale espejada.
 */
function linearDeterminant(m: readonly number[]): number {
  const c0: Vec3 = [m[0], m[1], m[2]]
  const c1: Vec3 = [m[4], m[5], m[6]]
  const c2: Vec3 = [m[8], m[9], m[10]]
  const cross: Vec3 = [
    c1[1] * c2[2] - c1[2] * c2[1],
    c1[2] * c2[0] - c1[0] * c2[2],
    c1[0] * c2[1] - c1[1] * c2[0],
  ]
  return c0[0] * cross[0] + c0[1] * cross[1] + c0[2] * cross[2]
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

function flattenPoints(points: readonly Vec3[]): Float32Array {
  const out = new Float32Array(points.length * 3)
  points.forEach((p, i) => out.set(p, i * 3))
  return out
}

/**
 * Nube de puntos con forma de arma: un extremo delgado (el cañón) y uno
 * grueso (la culata), alineados sobre `axis` y centrados en el origen. Si
 * `muzzleSign` es 1 el extremo delgado queda en +axis; si es -1, en -axis.
 * Ambos extremos llegan exactamente a ±1 y el perfil perpendicular queda
 * centrado en 0, así el centro de la caja envolvente es el origen exacto y
 * las cuentas de las pruebas no dependen de redondeos.
 */
function makeGunCloud(axis: 0 | 1 | 2, muzzleSign: 1 | -1): Float32Array {
  const perp = ([0, 1, 2] as const).filter((a) => a !== axis)
  const THIN = 0.03
  const THICK = 0.25
  const ring = (r: number): Array<[number, number]> => [
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ]
  // Valores altos (>= mid=0): un extremo. Valores bajos (< mid): el otro.
  const highAxisValues = [0.55, 0.7, 0.85, 1.0]
  const lowAxisValues = [-1.0, -0.85, -0.7, -0.55]

  const highRadius = muzzleSign === 1 ? THIN : THICK
  const lowRadius = muzzleSign === 1 ? THICK : THIN

  const points: Vec3[] = []
  const push = (axisVal: number, a: number, b: number): void => {
    const p: Vec3 = [0, 0, 0]
    p[axis] = axisVal
    p[perp[0]] = a
    p[perp[1]] = b
    points.push(p)
  }

  for (const av of highAxisValues) for (const [a, b] of ring(highRadius)) push(av, a, b)
  for (const av of lowAxisValues) for (const [a, b] of ring(lowRadius)) push(av, a, b)

  return flattenPoints(points)
}

/** Cubo simétrico: mismo grosor en ambas mitades, sin extremo delgado. */
function makeSymmetricBoxCloud(): Float32Array {
  const points: Vec3[] = []
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) points.push([x, y, z])
    }
  }
  return flattenPoints(points)
}

// ---------- slugify ----------

describe('slugify', () => {
  it('pasa a minúsculas y separa con guiones', () => {
    expect(slugify('AK-47 Rifle_v2')).toBe('ak-47-rifle-v2')
  })

  it('colapsa separadores consecutivos', () => {
    expect(slugify('Desert   Eagle!!')).toBe('desert-eagle')
  })

  it('recorta guiones al inicio y al final', () => {
    expect(slugify('__Katana__')).toBe('katana')
  })
})

// ---------- displayName ----------

describe('displayName', () => {
  it('cambia guiones y guiones bajos por espacios', () => {
    expect(displayName('ak47_assault-rifle')).toBe('ak47 assault rifle')
  })

  it('colapsa espacios y recorta bordes', () => {
    expect(displayName('  spaced   out_name  ')).toBe('spaced out name')
  })
})

// ---------- boundsOf ----------

describe('boundsOf', () => {
  it('calcula min y max sobre una nube conocida', () => {
    const cloud = flattenPoints([
      [1, 2, 3],
      [-1, 5, 0],
      [4, -2, 8],
    ])
    const { min, max } = boundsOf(cloud)
    expect(min).toEqual([-1, -2, 0])
    expect(max).toEqual([4, 5, 8])
  })

  it('con un solo punto, min y max son ese punto', () => {
    const cloud = flattenPoints([[2, -3, 7]])
    const { min, max } = boundsOf(cloud)
    expect(min).toEqual([2, -3, 7])
    expect(max).toEqual([2, -3, 7])
  })

  it('maneja coordenadas negativas', () => {
    const cloud = flattenPoints([
      [-5, -5, -5],
      [-1, -9, -2],
    ])
    const { min, max } = boundsOf(cloud)
    expect(min).toEqual([-5, -9, -5])
    expect(max).toEqual([-1, -5, -2])
  })
})

// ---------- detectMuzzle ----------

describe('detectMuzzle', () => {
  it('detecta el cañón apuntando a +X', () => {
    const cloud = makeGunCloud(0, 1)
    const { axis, sign, confidence } = detectMuzzle(cloud)
    expect(axis).toBe(0)
    expect(sign).toBe(1)
    expect(confidence).toBeGreaterThan(0.5)
  })

  it('detecta el cañón apuntando a -X', () => {
    const cloud = makeGunCloud(0, -1)
    const { axis, sign, confidence } = detectMuzzle(cloud)
    expect(axis).toBe(0)
    expect(sign).toBe(-1)
    expect(confidence).toBeGreaterThan(0.5)
  })

  it('detecta el cañón apuntando a +Z', () => {
    const cloud = makeGunCloud(2, 1)
    const { axis, sign, confidence } = detectMuzzle(cloud)
    expect(axis).toBe(2)
    expect(sign).toBe(1)
    expect(confidence).toBeGreaterThan(0.5)
  })

  it('una forma simétrica (un cubo) da confianza baja', () => {
    const cloud = makeSymmetricBoxCloud()
    const { confidence } = detectMuzzle(cloud)
    expect(confidence).toBeLessThan(0.05)
  })
})

// ---------- buildNormalizeMatrix ----------

describe('buildNormalizeMatrix', () => {
  const axes = [0, 1, 2] as const
  const signs = [1, -1] as const

  for (const axis of axes) {
    for (const sign of signs) {
      it(`eje ${axis}, signo ${sign}: cañón a -Z, arriba a +Y, sin reflejo, escala uniforme, centrado`, () => {
        const cloud = makeGunCloud(axis, sign)

        // La nube está armada para que detectMuzzle confirme el eje y el
        // signo que le estamos pasando a mano a buildNormalizeMatrix.
        const detected = detectMuzzle(cloud)
        expect(detected.axis).toBe(axis)
        expect(detected.sign).toBe(sign)

        const m = buildNormalizeMatrix(cloud, axis, sign)

        // No es un reflejo: el determinante de la parte lineal debe ser
        // positivo. Un determinante negativo aquí significa que cada arma
        // sale espejada, un bug que se ve "casi bien" y es fácil pasar por
        // alto sin este chequeo explícito.
        expect(linearDeterminant(m)).toBeGreaterThan(0)

        // El extremo delgado (la boca) termina en -Z, sin componente en
        // X ni en Y.
        const muzzlePoint: Vec3 = [0, 0, 0]
        muzzlePoint[axis] = sign === 1 ? 1 : -1
        const transformedMuzzle = applyMat4(m, muzzlePoint)
        expect(transformedMuzzle[2]).toBeLessThan(0)
        expect(transformedMuzzle[0]).toBeCloseTo(0, 4)
        expect(transformedMuzzle[1]).toBeCloseTo(0, 4)

        // El eje "arriba" original termina en +Y puro.
        const upAxis = axis === 1 ? 2 : 1
        const upVector: Vec3 = [0, 0, 0]
        upVector[upAxis] = 1
        const transformedUp = applyMat4Direction(m, upVector)
        expect(transformedUp[1]).toBeGreaterThan(0)
        expect(transformedUp[0]).toBeCloseTo(0, 4)
        expect(transformedUp[2]).toBeCloseTo(0, 4)

        // Escala uniforme: los tres ejes se estiran por el mismo factor,
        // sin deformar el arma.
        const scaleX = length(applyMat4Direction(m, [1, 0, 0]))
        const scaleY = length(applyMat4Direction(m, [0, 1, 0]))
        const scaleZ = length(applyMat4Direction(m, [0, 0, 1]))
        expect(scaleX).toBeCloseTo(scaleY, 4)
        expect(scaleY).toBeCloseTo(scaleZ, 4)

        // Transformar la nube completa (no sólo las esquinas) y releer sus
        // límites con boundsOf: la caja resultante debe quedar centrada en
        // el origen y su dimensión mayor debe medir exactamente el largo
        // objetivo.
        const transformed: Vec3[] = []
        for (let i = 0; i < cloud.length; i += 3) {
          transformed.push(applyMat4(m, [cloud[i], cloud[i + 1], cloud[i + 2]]))
        }
        const { min: txMin, max: txMax } = boundsOf(flattenPoints(transformed))

        for (let a = 0; a < 3; a++) {
          expect(txMin[a] + txMax[a]).toBeCloseTo(0, 4)
        }

        const dims = [0, 1, 2].map((a) => txMax[a] - txMin[a])
        expect(Math.max(...dims)).toBeCloseTo(TARGET_LENGTH_M, 4)
      })
    }
  }
})
