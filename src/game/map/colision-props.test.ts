import { describe, expect, it } from 'vitest'

import { cajasDeSopaDeTriangulos, convexDeCaja, LADO_CELDA } from '@/game/map/colision-props'
import type { Box } from '@/game/map/types'
import { PLAYER_CAPSULE, capsuleOverlapsConvex } from '@/game/physics/capsule'
import { vec3 } from '@/game/math/vec3'

/**
 * Estos tests se escribieron contra las DOS formas de equivocarse que
 * importan, no contra la implementación:
 *
 *  - envolver el prop entero en una caja (una cerca en L tapa el patio);
 *  - envolver cada tabla por separado (miles de cuerpos y ranuras de 5 cm
 *    por las que el navgrid manda bots).
 *
 * Un test que sólo mirara "devuelve alguna caja" pasa con las dos.
 */

/** Caja sólida como 12 triángulos, para alimentar al voxelizador. */
function cajaComoTriangulos(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
): number[] {
  return [
    x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z0, x0, y1, z1, x0, y0, z1,
    x1, y0, z0, x1, y1, z1, x1, y1, z0, x1, y0, z0, x1, y0, z1, x1, y1, z1,
    x0, y0, z0, x1, y0, z1, x1, y0, z0, x0, y0, z0, x0, y0, z1, x1, y0, z1,
    x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z0, x1, y1, z1, x0, y1, z1,
    x0, y0, z0, x1, y1, z0, x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y0, z1, x1, y1, z1, x0, y1, z1,
  ]
}

function sopa(floats: number[]): { posiciones: Float32Array; largo: number } {
  const posiciones = new Float32Array(floats)
  return { posiciones, largo: posiciones.length }
}

function dentro(b: Box, x: number, y: number, z: number): boolean {
  return x >= b.min.x && x <= b.max.x && y >= b.min.y && y <= b.max.y && z >= b.min.z && z <= b.max.z
}

function algunaContiene(cajas: Box[], x: number, y: number, z: number): boolean {
  return cajas.some((b) => dentro(b, x, y, z))
}

/**
 * Una cerca de tablas como las de nuketown: tablas de 10 cm de ancho y 2 cm
 * de espesor, separadas 5 cm, corriendo 3 m sobre el eje X.
 */
function cercaDeTablas(largoTablas = 20): number[] {
  const out: number[] = []
  for (let i = 0; i < largoTablas; i++) {
    const x = i * 0.15
    out.push(...cajaComoTriangulos(x, 0, 0, x + 0.1, 1.35, 0.02))
  }
  return out
}

describe('cajasDeSopaDeTriangulos', () => {
  it('funde las tablas de una cerca en una sola losa continua', () => {
    const cajas = cajasDeSopaDeTriangulos(sopa(cercaDeTablas()))

    // Si esto diera ~20, cada tabla sería su propio cuerpo: miles de
    // convexos por mapa y una ranura de 5 cm entre cada par por la que el
    // navgrid encuentra "pasaje".
    expect(cajas.length).toBe(1)
    expect(cajas[0].max.x - cajas[0].min.x).toBeCloseTo(2.95, 2)
    expect(cajas[0].max.y - cajas[0].min.y).toBeCloseTo(1.35, 2)
  })

  it('tapa los huecos ENTRE tablas (ahí es donde se colaban los bots)', () => {
    const cajas = cajasDeSopaDeTriangulos(sopa(cercaDeTablas()))
    // x = 0.125 cae justo en el medio del hueco entre la tabla 0 (0 a 0.10)
    // y la tabla 1 (0.15 a 0.25): aire en la malla, sólido en la colisión.
    expect(algunaContiene(cajas, 0.125, 0.6, 0.01)).toBe(true)
  })

  it('NO rellena el rincón de una cerca en L', () => {
    // Dos tramos perpendiculares de 6 m que se tocan en el origen. La caja
    // envolvente de esto es un bloque de 6 x 6 m que taparía el patio
    // entero -- que es exactamente lo que le pasa a fence_ph01 (14,84 x
    // 45,02 m) si se lo envuelve de una sola pieza.
    const floats = [
      ...cajaComoTriangulos(0, 0, 0, 6, 1.35, 0.1),
      ...cajaComoTriangulos(0, 0, 0, 0.1, 1.35, 6),
    ]
    const cajas = cajasDeSopaDeTriangulos(sopa(floats))

    // El medio del patio tiene que quedar libre.
    expect(algunaContiene(cajas, 3, 0.6, 3)).toBe(false)
    expect(algunaContiene(cajas, 5, 0.6, 5)).toBe(false)
    // Y los dos tramos, sólidos.
    expect(algunaContiene(cajas, 3, 0.6, 0.05)).toBe(true)
    expect(algunaContiene(cajas, 0.05, 0.6, 3)).toBe(true)
  })

  it('el volumen total queda muy por debajo de la caja envolvente', () => {
    const floats = [
      ...cajaComoTriangulos(0, 0, 0, 6, 1.35, 0.1),
      ...cajaComoTriangulos(0, 0, 0, 0.1, 1.35, 6),
    ]
    const cajas = cajasDeSopaDeTriangulos(sopa(floats))
    const volumen = cajas.reduce(
      (s, b) => s + (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z),
      0,
    )
    const envolvente = 6 * 1.35 * 6
    expect(volumen).toBeLessThan(envolvente * 0.1)
  })

  it('no deja geometría afuera: todo vértice cae dentro de alguna caja', () => {
    const floats = cercaDeTablas(8)
    const cajas = cajasDeSopaDeTriangulos(sopa(floats))
    // Tolerancia de punto flotante: las cajas se acumulan en Float32.
    const eps = 1e-4
    for (let i = 0; i < floats.length; i += 3) {
      const ok = cajas.some(
        (b) =>
          floats[i] >= b.min.x - eps && floats[i] <= b.max.x + eps &&
          floats[i + 1] >= b.min.y - eps && floats[i + 1] <= b.max.y + eps &&
          floats[i + 2] >= b.min.z - eps && floats[i + 2] <= b.max.z + eps,
      )
      expect(ok).toBe(true)
    }
  })

  it('conserva el espesor real en vez de engordar al lado de la celda', () => {
    // Una tabla sola de 2 cm de espesor: si la caja saliera del tamaño de
    // la celda mediría LADO_CELDA (25 cm) y el jugador chocaría 11 cm antes
    // de tocar la reja.
    const cajas = cajasDeSopaDeTriangulos(sopa(cajaComoTriangulos(0, 0, 0, 2, 1.35, 0.02)))
    const espesor = Math.min(...cajas.map((b) => b.max.z - b.min.z))
    expect(espesor).toBeCloseTo(0.02, 3)
    expect(espesor).toBeLessThan(LADO_CELDA)
  })

  it('una sopa vacía o degenerada no produce cajas', () => {
    expect(cajasDeSopaDeTriangulos(sopa([]))).toEqual([])
    expect(cajasDeSopaDeTriangulos(sopa([0, 0, 0]))).toEqual([])
  })
})

describe('convexDeCaja', () => {
  it('la cápsula parada adentro choca, y afuera no', () => {
    const c = convexDeCaja({ min: vec3(-1, 0, -1), max: vec3(1, 2, 1) })
    // Los pies en el centro de la caja: adentro.
    expect(capsuleOverlapsConvex(vec3(0, 0.5, 0), PLAYER_CAPSULE, c)).toBe(true)
    // Bien afuera en X, más allá del radio de la cápsula.
    expect(capsuleOverlapsConvex(vec3(5, 0, 0), PLAYER_CAPSULE, c)).toBe(false)
    // Bien afuera en Z.
    expect(capsuleOverlapsConvex(vec3(0, 0, 5), PLAYER_CAPSULE, c)).toBe(false)
  })

  it('la convención de planos es la de MapDef: normal afuera, interior dot(n,p) <= d', () => {
    const c = convexDeCaja({ min: vec3(-1, -2, -3), max: vec3(4, 5, 6) })
    expect(c.count).toBe(6)
    expect(Array.from(c.planes)).toEqual([
      1, 0, 0, 4,
      -1, 0, 0, 1,
      0, 1, 0, 5,
      0, -1, 0, 2,
      0, 0, 1, 6,
      0, 0, -1, 3,
    ])
    // Un punto adentro satisface los 6 semiespacios.
    const p = vec3(0, 0, 0)
    for (let i = 0; i < 6; i++) {
      const b = i * 4
      const dot = c.planes[b] * p.x + c.planes[b + 1] * p.y + c.planes[b + 2] * p.z
      expect(dot).toBeLessThanOrEqual(c.planes[b + 3])
    }
  })

  it('la envolvente del convexo coincide con la caja (la usa el descarte rápido)', () => {
    const caja = { min: vec3(-1, -2, -3), max: vec3(4, 5, 6) }
    const c = convexDeCaja(caja)
    expect(c.min).toEqual(caja.min)
    expect(c.max).toEqual(caja.max)
  })
})
