import { describe, expect, it } from 'vitest'

import { box } from '@/game/map/box'
import type { Convex } from '@/game/map/types'
import { vec3 } from '@/game/math/vec3'
import { PLAYER_CAPSULE, resolveMove, type MoveResult } from '@/game/physics/capsule'
import { buildConvexGrid, queryConvexGrid } from '@/game/physics/convex-grid'

function cubo(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Convex {
  return {
    planes: new Float32Array([
      -1, 0, 0, -minX,
      1, 0, 0, maxX,
      0, -1, 0, -minY,
      0, 1, 0, maxY,
      0, 0, -1, -minZ,
      0, 0, 1, maxZ,
    ]),
    count: 6,
    min: vec3(minX, minY, minZ),
    max: vec3(maxX, maxY, maxZ),
  }
}

/** Generador determinista: los tests no pueden depender de Math.random. */
function rng(semilla: number): () => number {
  let s = semilla >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Mundo sintético con la misma forma que un mapa importado: muchos brushes
 * chicos repartidos + un par de losas enormes (el suelo y el techo del
 * mapa), que son justo las que la grilla manda a la lista de "siempre".
 */
function mundoDePrueba(n: number): Convex[] {
  const r = rng(12345)
  const out: Convex[] = [
    cubo(-100, -2, -100, 100, -1, 100), // suelo, enorme
    cubo(-100, 20, -100, 100, 21, 100), // techo, enorme
  ]
  for (let i = 0; i < n; i++) {
    const x = -90 + r() * 180
    const z = -90 + r() * 180
    const y = -1 + r() * 3
    out.push(cubo(x, y, z, x + 0.5 + r() * 3, y + 0.5 + r() * 4, z + 0.5 + r() * 3))
  }
  return out
}

/** Los que de verdad se solapan con el rectángulo, a fuerza bruta. */
function fuerzaBruta(
  convexes: Convex[],
  minX: number, maxX: number, minZ: number, maxZ: number,
): Set<Convex> {
  const out = new Set<Convex>()
  for (const c of convexes) {
    if (c.max.x < minX || c.min.x > maxX) continue
    if (c.max.z < minZ || c.min.z > maxZ) continue
    out.add(c)
  }
  return out
}

describe('queryConvexGrid', () => {
  const convexes = mundoDePrueba(400)
  const grid = buildConvexGrid(convexes)

  it('nunca se pierde un brush que la fuerza bruta sí encuentra', () => {
    // El modo de fallo que esto persigue es el peor posible de un
    // broadphase: un muro que la consulta no devuelve es un muro que el
    // jugador atraviesa, y todo lo demás sigue funcionando perfecto.
    const r = rng(99)
    const out: Convex[] = []
    for (let caso = 0; caso < 300; caso++) {
      const x = -100 + r() * 200
      const z = -100 + r() * 200
      const minX = x - 0.4
      const maxX = x + 0.4
      const minZ = z - 0.4
      const maxZ = z + 0.4
      const n = queryConvexGrid(grid, convexes, minX, maxX, minZ, maxZ, out)
      const esperados = fuerzaBruta(convexes, minX, maxX, minZ, maxZ)
      const devueltos = new Set(out.slice(0, n))
      for (const e of esperados) {
        expect(devueltos.has(e), `caso ${caso} en (${x.toFixed(1)}, ${z.toFixed(1)}) perdió un brush`).toBe(true)
      }
    }
  })

  it('no devuelve el mismo brush dos veces', () => {
    // Un brush que toca cuatro celdas entra cuatro veces si no se deduplica,
    // y resolveMove le resolvería la penetración cuatro veces seguidas: el
    // jugador saldría disparado en vez de apoyarse.
    const out: Convex[] = []
    // Rectángulo grande a propósito: garantiza celdas múltiples.
    const n = queryConvexGrid(grid, convexes, -20, 20, -20, 20, out)
    expect(new Set(out.slice(0, n)).size).toBe(n)
    expect(n).toBeGreaterThan(0)
  })

  it('descarta de verdad: una consulta puntual devuelve muchos menos que el total', () => {
    // Si la grilla devolviera todo, todos los tests de arriba pasarían igual
    // y no habría ahorro ninguno -- que es el motivo por el que existe.
    const out: Convex[] = []
    const n = queryConvexGrid(grid, convexes, -0.4, 0.4, -0.4, 0.4, out)
    expect(n).toBeLessThan(convexes.length / 10)
  })
})

describe('resolveMove con broadphase activo', () => {
  it('un muro entre 400 brushes lejanos sigue frenando al jugador', () => {
    // Integración de punta a punta: la lista supera el umbral de la grilla,
    // así que resolveMove pasa por la consulta espacial. Si el muro se
    // perdiera en el camino, el jugador lo cruzaría sin enterarse.
    const convexes = mundoDePrueba(400)
    convexes.push(cubo(2, -1, -10, 2.4, 4, 10))
    const result: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }
    const pos = vec3(0, -1, 0)
    for (let i = 0; i < 120; i++) {
      resolveMove(pos, vec3(0.05, -0.01, 0), PLAYER_CAPSULE, [], convexes, result)
    }
    expect(pos.x).toBeLessThan(2)
  })

  it('el suelo enorme (lista de "siempre") sigue sosteniendo al jugador', () => {
    const convexes = mundoDePrueba(400)
    const result: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }
    const pos = vec3(50, 10, 50)
    for (let i = 0; i < 200; i++) {
      resolveMove(pos, vec3(0, -0.15, 0), PLAYER_CAPSULE, [], convexes, result)
    }
    expect(pos.y).toBeGreaterThan(-2)
  })
})

describe('buildConvexGrid: casos degenerados', () => {
  it('una lista vacía no revienta y no devuelve nada', () => {
    const grid = buildConvexGrid([])
    const out: Convex[] = [cubo(0, 0, 0, 1, 1, 1)]
    expect(queryConvexGrid(grid, [], -10, 10, -10, 10, out)).toBe(0)
  })

  it('una consulta fuera de los límites del mapa no devuelve basura ni tira', () => {
    const convexes = [cubo(0, 0, 0, 1, 1, 1), cubo(5, 0, 5, 6, 1, 6)]
    const grid = buildConvexGrid(convexes)
    const out: Convex[] = []
    const n = queryConvexGrid(grid, convexes, 1000, 1001, 1000, 1001, out)
    // Los índices se recortan al borde de la grilla, así que puede devolver
    // los del borde; lo que no puede es devolver algo que no esté en la
    // lista, ni repetir.
    const devueltos = out.slice(0, n)
    expect(new Set(devueltos).size).toBe(n)
    for (const c of devueltos) expect(convexes).toContain(c)
  })
})

/** Sanidad: `box` se importa sólo para dejar claro que este archivo prueba
 *  el camino CONVEXO y no el de cajas, que no cambió. */
describe('las cajas no pasan por la grilla', () => {
  it('resolveMove con sólo cajas sigue funcionando igual', () => {
    const result: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }
    const pos = vec3(0, 5, 0)
    resolveMove(pos, vec3(0, -10, 0), PLAYER_CAPSULE, [box(-5, -1, -5, 5, 0, 5)], [], result)
    expect(result.hitGround).toBe(true)
    expect(pos.y).toBeCloseTo(0, 3)
  })
})
