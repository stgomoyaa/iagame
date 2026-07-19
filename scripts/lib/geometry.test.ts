import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TARGET_LENGTH_M,
  WEAPON_CLASS_LENGTHS_M,
  boundsOf,
  buildNormalizeMatrix,
  detectMuzzle,
  detectUpAxis,
  displayName,
  slugify,
  targetLengthFor,
} from './geometry'

/**
 * Largo usado sólo en las pruebas genéricas de normalización, que no
 * representan ninguna clase de arma real. Desacoplado de la tabla de
 * `geometry.ts` a propósito: si la tabla cambia, estas pruebas geométricas no
 * deben cambiar de resultado.
 */
const TEST_TARGET_LENGTH_M = 0.6

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

/**
 * Nube de puntos con forma de arma real, con silueta rectangular en vez de
 * circular: además del extremo delgado (la boca) y el grueso (la culata)
 * sobre `barrelAxis`, la sección transversal es alta en `tallAxis` y angosta
 * en el otro eje perpendicular. Esto simula un arma exportada de Blender
 * (Z-up): el eje realmente "arriba" no es necesariamente Y, sino el que
 * tiene mayor extensión en la caja envolvente, tal como en un arma real
 * (más alta por la mira/cargador/culata que ancha por el grosor del cuerpo).
 */
function makeGunCloudZUp(
  barrelAxis: 0 | 1 | 2,
  muzzleSign: 1 | -1,
  tallAxis: 0 | 1 | 2,
): Float32Array {
  const perp = ([0, 1, 2] as const).filter((a) => a !== barrelAxis)
  const narrowAxis = perp[0] === tallAxis ? perp[1] : perp[0]
  const TALL = 0.3
  const NARROW = 0.05
  const THIN = 0.03
  const THICK = 0.25

  const highAxisValues = [0.55, 0.7, 0.85, 1.0]
  const lowAxisValues = [-1.0, -0.85, -0.7, -0.55]

  const highRadius = muzzleSign === 1 ? THIN : THICK
  const lowRadius = muzzleSign === 1 ? THICK : THIN

  const points: Vec3[] = []
  const push = (axisVal: number, tall: number, narrow: number): void => {
    const p: Vec3 = [0, 0, 0]
    p[barrelAxis] = axisVal
    p[tallAxis] = tall
    p[narrowAxis] = narrow
    points.push(p)
  }

  // Rectángulo (no círculo) por corte transversal: extremos en ambos ejes
  // perpendiculares, escalados por TALL/NARROW en vez de un único radio.
  const corners = (r: number): Array<[number, number]> => [
    [r * TALL, r * NARROW],
    [r * TALL, -r * NARROW],
    [-r * TALL, r * NARROW],
    [-r * TALL, -r * NARROW],
  ]

  for (const av of highAxisValues) for (const [t, n] of corners(highRadius)) push(av, t, n)
  for (const av of lowAxisValues) for (const [t, n] of corners(lowRadius)) push(av, t, n)

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

        // El eje "arriba" ya no se asume: se deriva de la geometría, igual
        // que el eje del cañón.
        const detectedUp = detectUpAxis(cloud, axis)

        const m = buildNormalizeMatrix(cloud, axis, sign, detectedUp.axis, TEST_TARGET_LENGTH_M)

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

        // El eje "arriba" detectado (no uno asumido a priori) termina en +Y
        // puro.
        const upVector: Vec3 = [0, 0, 0]
        upVector[detectedUp.axis] = 1
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
        expect(Math.max(...dims)).toBeCloseTo(TEST_TARGET_LENGTH_M, 4)
      })
    }
  }
})

// ---------- detectUpAxis ----------

describe('detectUpAxis', () => {
  it('elige el eje perpendicular de mayor extensión como "arriba"', () => {
    // Cañón en X: los ejes candidatos son Y y Z. Se arma la nube más alta
    // en Z que en Y, así que "arriba" debe ser Z.
    const cloud = makeGunCloudZUp(0, 1, 2)
    const { axis, confidence } = detectUpAxis(cloud, 0)
    expect(axis).toBe(2)
    expect(confidence).toBeGreaterThan(0.5)
  })

  it('también reconoce el otro eje candidato como "arriba"', () => {
    // Mismo cañón en X, pero ahora la nube es más alta en Y que en Z: el
    // resultado no puede estar fijo a un solo candidato.
    const cloud = makeGunCloudZUp(0, 1, 1)
    const { axis, confidence } = detectUpAxis(cloud, 0)
    expect(axis).toBe(1)
    expect(confidence).toBeGreaterThan(0.5)
  })

  it('una sección transversal casi cuadrada da confianza baja', () => {
    const cloud = makeGunCloud(0, 1)
    const { confidence } = detectUpAxis(cloud, 0)
    expect(confidence).toBeLessThan(0.05)
  })
})

// ---------- buildNormalizeMatrix con fuente Z-up (bug de la boca 90°) ----------

describe('buildNormalizeMatrix con sección transversal no circular (fuente Z-up)', () => {
  const barrelAxes = [0, 1, 2] as const
  const signs = [1, -1] as const

  for (const barrelAxis of barrelAxes) {
    const perp = ([0, 1, 2] as const).filter((a) => a !== barrelAxis)

    for (const sign of signs) {
      for (const tallAxis of perp) {
        it(`cañón eje ${barrelAxis} signo ${sign}, alto real en eje ${tallAxis}: la altura final supera al ancho`, () => {
          // Nube armada en convención Z-up de Blender: el eje realmente alto
          // (mira, cargador, culata) no es Y, sino `tallAxis`. Con el código
          // viejo (que asume Y-up salvo que el cañón sea Y) esta prueba
          // falla porque el arma queda acostada de lado.
          const cloud = makeGunCloudZUp(barrelAxis, sign, tallAxis)

          const detectedMuzzle = detectMuzzle(cloud)
          expect(detectedMuzzle.axis).toBe(barrelAxis)
          expect(detectedMuzzle.sign).toBe(sign)

          const detectedUp = detectUpAxis(cloud, barrelAxis)
          expect(detectedUp.axis).toBe(tallAxis)

          const m = buildNormalizeMatrix(
            cloud,
            barrelAxis,
            detectedMuzzle.sign,
            detectedUp.axis,
            TEST_TARGET_LENGTH_M,
          )

          // Garantías que ya existían y no se pueden regresionar.
          expect(linearDeterminant(m)).toBeGreaterThan(0)

          const scaleX = length(applyMat4Direction(m, [1, 0, 0]))
          const scaleY = length(applyMat4Direction(m, [0, 1, 0]))
          const scaleZ = length(applyMat4Direction(m, [0, 0, 1]))
          expect(scaleX).toBeCloseTo(scaleY, 4)
          expect(scaleY).toBeCloseTo(scaleZ, 4)

          const muzzlePoint: Vec3 = [0, 0, 0]
          muzzlePoint[barrelAxis] = sign === 1 ? 1 : -1
          const transformedMuzzle = applyMat4(m, muzzlePoint)
          expect(transformedMuzzle[2]).toBeLessThan(0)

          const transformed: Vec3[] = []
          for (let i = 0; i < cloud.length; i += 3) {
            transformed.push(applyMat4(m, [cloud[i], cloud[i + 1], cloud[i + 2]]))
          }
          const { min: txMin, max: txMax } = boundsOf(flattenPoints(transformed))

          // Centrado en el origen, igual que antes.
          for (let a = 0; a < 3; a++) {
            expect(txMin[a] + txMax[a]).toBeCloseTo(0, 4)
          }

          // La prueba que debe fallar contra el código actual: el ancho
          // (X) tiene que ser menor que el alto (Y) una vez normalizada.
          // Con la asunción vieja de Y-up, el arma sale acostada de lado y
          // esta comparación se invierte.
          const width = txMax[0] - txMin[0]
          const height = txMax[1] - txMin[1]
          expect(height).toBeGreaterThan(width)
        })
      }
    }
  }
})

// ---------- targetLengthFor ----------

describe('targetLengthFor', () => {
  it('pistol y revolver usan el largo de arma corta', () => {
    expect(targetLengthFor('Pistol_1')).toBe(WEAPON_CLASS_LENGTHS_M.pistol)
    expect(targetLengthFor('Revolver_3')).toBe(WEAPON_CLASS_LENGTHS_M.revolver)
    expect(WEAPON_CLASS_LENGTHS_M.pistol).toBe(0.22)
    expect(WEAPON_CLASS_LENGTHS_M.revolver).toBe(0.22)
  })

  it('submachinegun usa su propio largo, no el de una regla genérica de "gun"', () => {
    // Este es el caso puntual que pide la spec: "submachinegun" contiene
    // el substring "gun", igual que "shotgun". Un matcher mal ordenado que
    // detecte la clase por una regla genérica de "gun" (o que chequee
    // "shotgun" antes con una regla laxa) puede confundir una submetralleta
    // con una escopeta. Acá se verifica que da su propio valor.
    const result = targetLengthFor('SubmachineGun_2')
    expect(result).toBe(WEAPON_CLASS_LENGTHS_M.submachinegun)
    expect(result).not.toBe(WEAPON_CLASS_LENGTHS_M.shotgun)
    expect(result).toBe(0.45)
  })

  it('bullpup usa su propio largo', () => {
    expect(targetLengthFor('Bullpup_3')).toBe(WEAPON_CLASS_LENGTHS_M.bullpup)
    expect(WEAPON_CLASS_LENGTHS_M.bullpup).toBe(0.65)
  })

  it('assaultrifle usa el largo de fusil de asalto', () => {
    expect(targetLengthFor('AssaultRifle_4')).toBe(WEAPON_CLASS_LENGTHS_M.assaultrifle)
    expect(WEAPON_CLASS_LENGTHS_M.assaultrifle).toBe(0.85)
  })

  it('AssaultRifle2 es una variante de fusil de asalto, no la clase por defecto', () => {
    const result = targetLengthFor('AssaultRifle2_1')
    expect(result).toBe(WEAPON_CLASS_LENGTHS_M.assaultrifle)
    expect(result).not.toBe(DEFAULT_TARGET_LENGTH_M)
  })

  it('shotgun usa su propio largo', () => {
    expect(targetLengthFor('Shotgun_5')).toBe(WEAPON_CLASS_LENGTHS_M.shotgun)
    expect(WEAPON_CLASS_LENGTHS_M.shotgun).toBe(0.95)
  })

  it('sniperrifle usa su propio largo, no el de fusil de asalto', () => {
    const result = targetLengthFor('SniperRifle_6')
    expect(result).toBe(WEAPON_CLASS_LENGTHS_M.sniperrifle)
    expect(result).not.toBe(WEAPON_CLASS_LENGTHS_M.assaultrifle)
    expect(result).toBe(1.15)
  })

  it('un nombre desconocido cae al largo por defecto', () => {
    expect(targetLengthFor('Katana_1')).toBe(DEFAULT_TARGET_LENGTH_M)
    expect(DEFAULT_TARGET_LENGTH_M).toBe(0.75)
  })

  it('el matcheo no distingue mayúsculas de minúsculas', () => {
    expect(targetLengthFor('PISTOL_1')).toBe(WEAPON_CLASS_LENGTHS_M.pistol)
    expect(targetLengthFor('pistol_1')).toBe(WEAPON_CLASS_LENGTHS_M.pistol)
    expect(targetLengthFor('pIsToL_1')).toBe(WEAPON_CLASS_LENGTHS_M.pistol)
  })
})

// ---------- largo objetivo por clase, no fijo, en buildNormalizeMatrix ----------

describe('buildNormalizeMatrix usa el largo objetivo recibido, no un valor fijo', () => {
  it('la dimensión mayor final es el largo de la clase pasada, no 0.6 fijo', () => {
    const cloud = makeGunCloud(2, 1)
    const detectedMuzzle = detectMuzzle(cloud)
    const detectedUp = detectUpAxis(cloud, 2)

    const pistolLength = targetLengthFor('Pistol_1')
    const rifleLength = targetLengthFor('AssaultRifle_4')
    expect(pistolLength).not.toBe(rifleLength)
    expect(pistolLength).not.toBe(0.6)
    expect(rifleLength).not.toBe(0.6)

    const maxDimension = (targetLengthM: number): number => {
      const m = buildNormalizeMatrix(cloud, 2, detectedMuzzle.sign, detectedUp.axis, targetLengthM)
      const transformed: Vec3[] = []
      for (let i = 0; i < cloud.length; i += 3) {
        transformed.push(applyMat4(m, [cloud[i], cloud[i + 1], cloud[i + 2]]))
      }
      const { min, max } = boundsOf(flattenPoints(transformed))
      return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
    }

    expect(maxDimension(pistolLength)).toBeCloseTo(pistolLength, 4)
    expect(maxDimension(rifleLength)).toBeCloseTo(rifleLength, 4)
  })
})
