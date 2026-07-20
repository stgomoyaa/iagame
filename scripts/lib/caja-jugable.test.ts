import { describe, expect, it } from 'vitest'

import {
  type Caja,
  MARGEN_JUGABLE_M,
  cajaJugableDesdeMalla,
  cajaValida,
  cajaVacia,
  cajasSeTocan,
  esDelSkybox3D,
  expandirCaja,
  murosDeCierre,
  planosDeCaja,
  planosDeRecorte,
  recortarCaja,
} from './caja-jugable.ts'

const caja = (min: [number, number, number], max: [number, number, number]): Caja => ({ min, max })

describe('caja-jugable: acumulación de puntos', () => {
  it('una caja vacía no es válida y una con un punto sí', () => {
    const c = cajaVacia()
    expect(cajaValida(c)).toBe(false)
    expandirCaja(c, [1, 2, 3])
    expect(cajaValida(c)).toBe(true)
    expect(c.min).toEqual([1, 2, 3])
    expect(c.max).toEqual([1, 2, 3])
  })

  it('crece en los dos sentidos de cada eje', () => {
    const c = cajaVacia()
    expandirCaja(c, [0, 0, 0])
    expandirCaja(c, [-5, 7, 2])
    expandirCaja(c, [3, -1, -9])
    expect(c.min).toEqual([-5, -1, -9])
    expect(c.max).toEqual([3, 7, 2])
  })
})

describe('caja-jugable: separar la maqueta del skybox 3D', () => {
  // Geometría del caso real de nuketown, en metros del motor: los spawns
  // ocupan una franja alrededor del origen y sky_camera está a ~120 m.
  const spawns = caja([-23, -1, -13], [43, -1, 0])
  const sky: [number, number, number] = [-120.8, 1.5, -12.7]

  it('un punto pegado a los spawns NO es del skybox 3D', () => {
    expect(esDelSkybox3D([10, 0, -5], sky, spawns)).toBe(false)
  })

  it('un punto pegado a sky_camera SÍ es del skybox 3D', () => {
    expect(esDelSkybox3D([-119, 0, -12], sky, spawns)).toBe(true)
  })

  it('el corte está donde las dos distancias empatan, sin margen inventado', () => {
    // sky_camera está a 120.8-(-23) = 97.8 m del borde oeste de los spawns.
    // El punto medio sobre esa recta cae justo en el empate.
    const casiSpawns: [number, number, number] = [-23 - 97.8 / 2 + 1, -1, -6]
    const casiSky: [number, number, number] = [-23 - 97.8 / 2 - 1, -1, -6]
    expect(esDelSkybox3D(casiSpawns, sky, spawns)).toBe(false)
    expect(esDelSkybox3D(casiSky, sky, spawns)).toBe(true)
  })

  it('sin sky_camera no se descarta NADA: no se adivina una maqueta que el mapa no marca', () => {
    expect(esDelSkybox3D([-119, 0, -12], null, spawns)).toBe(false)
    expect(esDelSkybox3D([9999, 0, 9999], null, spawns)).toBe(false)
  })

  it('sin spawns tampoco se descarta nada: falta la otra referencia', () => {
    expect(esDelSkybox3D([-119, 0, -12], sky, cajaVacia())).toBe(false)
  })
})

describe('caja-jugable: derivar la caja de la malla', () => {
  it('agranda la caja de la malla por el margen en los dos sentidos', () => {
    const c = cajaJugableDesdeMalla(caja([-10, 0, -20], [30, 5, 40]))
    const m = MARGEN_JUGABLE_M
    expect(c.min).toEqual([-10 - m, -m, -20 - m])
    expect(c.max).toEqual([30 + m, 5 + m, 40 + m])
  })

  it('el margen queda por debajo del diámetro del jugador (0,8 m)', () => {
    // La cota de arriba de la derivación: si el margen superara el diámetro
    // de la cápsula, quedaría repisa invisible donde el jugador SÍ entra.
    expect(MARGEN_JUGABLE_M).toBeLessThan(0.8)
    // Y la de abajo: tiene que superar el muro de perímetro más grueso de
    // Source (16 unidades = 0,3048 m) para no dejarlo con espesor cero.
    expect(MARGEN_JUGABLE_M).toBeGreaterThan(16 * 0.01905)
  })
})

describe('caja-jugable: qué toca y qué no', () => {
  const jugable = caja([0, 0, 0], [10, 10, 10])

  it('un brush entero adentro toca', () => {
    expect(cajasSeTocan(caja([1, 1, 1], [2, 2, 2]), jugable)).toBe(true)
  })

  it('un brush entero afuera no toca', () => {
    expect(cajasSeTocan(caja([20, 1, 1], [22, 2, 2]), jugable)).toBe(false)
  })

  it('un brush que cruza el borde toca', () => {
    expect(cajasSeTocan(caja([-5, 1, 1], [5, 2, 2]), jugable)).toBe(true)
  })

  it('un brush que apenas roza la cara toca (no se descarta por un empate)', () => {
    expect(cajasSeTocan(caja([10, 1, 1], [12, 2, 2]), jugable)).toBe(true)
  })
})

describe('caja-jugable: recorte de brushes', () => {
  const jugable = caja([0, 0, 0], [10, 10, 10])

  it('un brush que ya está adentro NO recibe ningún plano nuevo', () => {
    // Importa para el presupuesto: overlapAndResolveConvex recorre todos los
    // planos de cada convexo cercano 128 veces por segundo.
    expect(planosDeRecorte(caja([1, 1, 1], [9, 9, 9]), jugable)).toEqual([])
  })

  it('un brush que se sale por un lado recibe exactamente UN plano', () => {
    const p = planosDeRecorte(caja([1, 1, 1], [20, 9, 9]), jugable)
    expect(p).toEqual([1, 0, 0, 10])
  })

  it('el plano nuevo apunta hacia AFUERA y deja el interior en dot(n,p) <= d', () => {
    const p = planosDeRecorte(caja([-20, 1, 1], [9, 9, 9]), jugable)
    // toBeCloseTo y no toBe: negar un cero da -0, que para la colisión es el
    // mismo número (y JSON.stringify lo escribe como 0 igual).
    expect(p.length).toBe(4)
    expect(p[0]).toBeCloseTo(-1, 12)
    expect(p[1]).toBeCloseTo(0, 12)
    expect(p[2]).toBeCloseTo(0, 12)
    expect(p[3]).toBeCloseTo(0, 12)
    // Un punto adentro (x=5) satisface dot(n,p) <= d: -5 <= 0. Uno afuera
    // (x=-5) no: 5 > 0.
    expect(-1 * 5).toBeLessThanOrEqual(p[3])
    expect(-1 * -5).toBeGreaterThan(p[3])
  })

  it('un brush que desborda por los seis lados recibe seis planos', () => {
    const p = planosDeRecorte(caja([-1, -1, -1], [11, 11, 11]), jugable)
    expect(p.length / 4).toBe(6)
  })

  it('la bbox recortada es la intersección', () => {
    const r = recortarCaja(caja([-20, 1, 1], [20, 9, 30]), jugable)
    expect(r.min).toEqual([0, 1, 1])
    expect(r.max).toEqual([10, 9, 10])
  })
})

describe('caja-jugable: muros de cierre', () => {
  const jugable = caja([0, 0, 0], [10, 4, 20])
  const muros = murosDeCierre(jugable, 0.5)

  it('emite cuatro muros laterales y un techo, sin piso', () => {
    expect(muros.length).toBe(5)
    // Ninguno queda por debajo del piso de la caja: el suelo real ya existe.
    for (const m of muros) expect(m.max[1]).toBeGreaterThan(jugable.min[1])
  })

  it('los muros están AFUERA de la caja jugable, no le comen espacio adentro', () => {
    for (const m of muros) {
      const seSolapaAdentro =
        m.min[0] < jugable.max[0] - 1e-9 &&
        m.max[0] > jugable.min[0] + 1e-9 &&
        m.min[1] < jugable.max[1] - 1e-9 &&
        m.max[1] > jugable.min[1] + 1e-9 &&
        m.min[2] < jugable.max[2] - 1e-9 &&
        m.max[2] > jugable.min[2] + 1e-9
      expect(seSolapaAdentro).toBe(false)
    }
  })

  it('el perímetro queda SELLADO: no hay hueco entre muro y muro', () => {
    // Se recorre el borde de la caja jugable, por afuera, y se comprueba que
    // cada punto cae adentro de algún muro. Sin esta prueba un muro corrido
    // medio metro dejaría una rendija por la que el jugador se escapa, que
    // es exactamente el bug que estos muros vienen a cerrar.
    const dentroDeAlgunMuro = (p: [number, number, number]) =>
      muros.some(
        (m) =>
          p[0] >= m.min[0] && p[0] <= m.max[0] &&
          p[1] >= m.min[1] && p[1] <= m.max[1] &&
          p[2] >= m.min[2] && p[2] <= m.max[2],
      )
    const y = 2 // a la altura del pecho del jugador
    for (let x = jugable.min[0]; x <= jugable.max[0]; x += 0.25) {
      expect(dentroDeAlgunMuro([x, y, jugable.min[2] - 0.25])).toBe(true)
      expect(dentroDeAlgunMuro([x, y, jugable.max[2] + 0.25])).toBe(true)
    }
    for (let z = jugable.min[2]; z <= jugable.max[2]; z += 0.25) {
      expect(dentroDeAlgunMuro([jugable.min[0] - 0.25, y, z])).toBe(true)
      expect(dentroDeAlgunMuro([jugable.max[0] + 0.25, y, z])).toBe(true)
    }
    // Y las cuatro esquinas, que es donde un muro mal dimensionado deja el
    // hueco más fácil de pasar por alto.
    for (const x of [jugable.min[0] - 0.25, jugable.max[0] + 0.25]) {
      for (const z of [jugable.min[2] - 0.25, jugable.max[2] + 0.25]) {
        expect(dentroDeAlgunMuro([x, y, z])).toBe(true)
      }
    }
  })
})

describe('caja-jugable: planos de una caja', () => {
  it('son seis, con normal afuera e interior en dot(n,p) <= d', () => {
    const p = planosDeCaja(caja([-1, -2, -3], [4, 5, 6]))
    expect(p.length / 4).toBe(6)
    const dentro: [number, number, number] = [1, 1, 1]
    const afuera: [number, number, number] = [100, 1, 1]
    const evalua = (q: [number, number, number]) => {
      let peor = -Infinity
      for (let i = 0; i < p.length; i += 4) {
        const v = p[i] * q[0] + p[i + 1] * q[1] + p[i + 2] * q[2] - p[i + 3]
        if (v > peor) peor = v
      }
      return peor
    }
    expect(evalua(dentro)).toBeLessThanOrEqual(0)
    expect(evalua(afuera)).toBeGreaterThan(0)
  })
})
