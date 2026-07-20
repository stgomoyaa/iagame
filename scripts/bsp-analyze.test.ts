import { describe, expect, it } from 'vitest'

import { esNormalAlineada, extension } from './bsp-analyze'

/** Arma los arrays de planos que espera `extension` desde una lista legible. */
function planos(lista: Array<[number, number, number, number]>) {
  const n = lista.length
  const nx = new Float32Array(n)
  const ny = new Float32Array(n)
  const nz = new Float32Array(n)
  const dist = new Float32Array(n)
  lista.forEach(([x, y, z, d], i) => {
    nx[i] = x
    ny[i] = y
    nz[i] = z
    dist[i] = d
  })
  return { indices: lista.map((_, i) => i), nx, ny, nz, dist }
}

/** Cubo unitario: seis planos de eje, normales hacia afuera. */
const CUBO: Array<[number, number, number, number]> = [
  [-1, 0, 0, 0],
  [1, 0, 0, 1],
  [0, -1, 0, 0],
  [0, 1, 0, 1],
  [0, 0, -1, 0],
  [0, 0, 1, 1],
]

/**
 * Cuña: el cubo con la tapa de arriba reemplazada por un plano inclinado
 * (y + z <= 1). Su caja envolvente sigue siendo 1x1x1.
 *
 * Este es EL caso que importa. Una versión anterior de `extension` sacaba la
 * caja sólo de los planos alineados a los ejes, así que un brush sin plano
 * +Z -- justo una rampa -- devolvía null y pesaba cero en la estadística de
 * volumen. El resultado era que cualquier mapa daba "100% representable con
 * cajas", porque lo no representable era exactamente lo que se anulaba.
 */
const CUÑA: Array<[number, number, number, number]> = [
  [-1, 0, 0, 0],
  [1, 0, 0, 1],
  [0, -1, 0, 0],
  [0, 1, 0, 1],
  [0, 0, -1, 0],
  [0, Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2],
]

describe('esNormalAlineada', () => {
  it('acepta las seis normales de eje', () => {
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      expect(esNormalAlineada(x, y, z)).toBe(true)
    }
  })

  it('rechaza una normal inclinada de 45 grados', () => {
    expect(esNormalAlineada(0, Math.SQRT1_2, Math.SQRT1_2)).toBe(false)
  })
})

describe('extension', () => {
  it('mide el cubo unitario', () => {
    const { indices, nx, ny, nz, dist } = planos(CUBO)
    const ext = extension(indices, nx, ny, nz, dist)
    expect(ext).not.toBeNull()
    for (const lado of ext!) expect(lado).toBeCloseTo(1, 5)
  })

  it('mide una rampa en vez de darle volumen cero', () => {
    const { indices, nx, ny, nz, dist } = planos(CUÑA)
    const ext = extension(indices, nx, ny, nz, dist)

    expect(ext).not.toBeNull()
    // Si esto vuelve a dar 0 en algún eje, la estadística de volumen volvió a
    // estar rota y todo mapa va a reportar ~100% representable con cajas.
    for (const lado of ext!) expect(lado).toBeGreaterThan(0.5)
  })

  it('descarta los cruces de planos que caen fuera del cuerpo', () => {
    // La cuña tiene planos cuyo cruce cae en (0,1,1), afuera de y+z<=1. Si esos
    // puntos contaran como vértices, la caja saldría más grande que el cuerpo.
    const { indices, nx, ny, nz, dist } = planos(CUÑA)
    const ext = extension(indices, nx, ny, nz, dist)
    for (const lado of ext!) expect(lado).toBeLessThanOrEqual(1.0001)
  })
})
