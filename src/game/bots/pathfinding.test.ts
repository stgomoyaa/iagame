import { describe, expect, it } from 'vitest'
import { buildNavGrid, cellCenterX, cellCenterZ, cellCol, cellRow, cellsConnected, worldToCellIndex } from '@/game/bots/navgrid'
import {
  clearPathCache,
  createPathCache,
  createPathfindingContext,
  findPath,
  findPathCached,
} from '@/game/bots/pathfinding'
import type { Box, MapDef } from '@/game/map/types'
import { vec3 } from '@/game/math/vec3'
import { ARENA } from '@/game/map/arena'

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box {
  return { min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) }
}

function mapOf(boxes: Box[], bounds: Box): MapDef {
  return { name: 'test', boxes, spawns: [], bounds }
}

const CAPSULE_H = 1.8

describe('A* sobre el navgrid', () => {
  it('encuentra un camino directo en un piso plano y despejado', () => {
    const map = mapOf([box(-10, -1, -10, 10, 0, 10)], box(-10, 0, -10, 10, 3, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)

    const start = worldToCellIndex(grid, -8, -8)
    const goal = worldToCellIndex(grid, 8, 8)
    expect(findPath(ctx, start, goal)).toBe(true)
    expect(ctx.resultPath[0]).toBe(start)
    expect(ctx.resultPath[ctx.resultLength - 1]).toBe(goal)
  })

  it('el camino de una celda a sí misma es trivial (longitud 1)', () => {
    const map = mapOf([box(-5, -1, -5, 5, 0, 5)], box(-5, 0, -5, 5, 3, 5))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)
    const cell = worldToCellIndex(grid, 0, 0)
    expect(findPath(ctx, cell, cell)).toBe(true)
    expect(ctx.resultLength).toBe(1)
    expect(ctx.resultPath[0]).toBe(cell)
  })

  it('cada par de celdas consecutivas del camino está realmente conectado (nunca cruza geometría sólida)', () => {
    // Separador con un hueco, como los carriles de la arena real: fuerza al
    // camino a rodear en vez de ir en línea recta.
    const floor = box(-20, -1, -20, 20, 0, 20)
    const wall = box(-1, 0, -20, 1, 3, 5) // corta z<5, deja hueco en z>=5
    const map = mapOf([floor, wall], box(-20, 0, -20, 20, 4, 20))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)

    const start = worldToCellIndex(grid, -10, -10)
    const goal = worldToCellIndex(grid, 10, -10)
    expect(findPath(ctx, start, goal)).toBe(true)

    for (let i = 0; i < ctx.resultLength - 1; i++) {
      const a = ctx.resultPath[i]
      const b = ctx.resultPath[i + 1]
      expect(cellsConnected(grid, a, b), `paso ${i}: celdas ${a}->${b} no conectadas`).toBe(true)
    }

    // Y de verdad rodeó: el camino pasa por z>=5 en algún punto (el hueco),
    // no sólo en línea recta por z=-10 (que cruzaría el muro en x=[-1,1]).
    const pasaPorElHueco = Array.from({ length: ctx.resultLength }, (_, i) => ctx.resultPath[i]).some((idx) => {
      const z = cellCenterZ(grid, cellRow(grid, idx))
      return z >= 5
    })
    expect(pasaPorElHueco).toBe(true)
  })

  it('no encuentra camino cuando el objetivo queda completamente aislado', () => {
    const floor = box(-20, -1, -20, 20, 0, 20)
    // Muro sin hueco: parte la arena en dos mitades imposibles de cruzar.
    const wall = box(-1, 0, -20, 1, 3, 20)
    const map = mapOf([floor, wall], box(-20, 0, -20, 20, 4, 20))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)

    const start = worldToCellIndex(grid, -10, 0)
    const goal = worldToCellIndex(grid, 10, 0)
    expect(findPath(ctx, start, goal)).toBe(false)
  })

  it('devuelve false si el origen o el destino caen en una celda no caminable', () => {
    const map = mapOf([box(-5, -1, -5, 5, 0, 5)], box(-5, 0, -5, 5, 3, 5))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)
    expect(findPath(ctx, -1, 0)).toBe(false)
    expect(findPath(ctx, 0, -1)).toBe(false)
  })

  it('es determinista: la misma búsqueda repetida da siempre el mismo camino', () => {
    const floor = box(-15, -1, -15, 15, 0, 15)
    const wall = box(-1, 0, -15, 1, 3, 3)
    const map = mapOf([floor, wall], box(-15, 0, -15, 15, 4, 15))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)

    const start = worldToCellIndex(grid, -10, -10)
    const goal = worldToCellIndex(grid, 10, 10)

    findPath(ctx, start, goal)
    const first = Array.from(ctx.resultPath.subarray(0, ctx.resultLength))

    findPath(ctx, start, goal)
    const second = Array.from(ctx.resultPath.subarray(0, ctx.resultLength))

    expect(second).toEqual(first)
  })

  it('un camino más largo por un rodeo cuesta más que uno directo despejado (heurística admisible razonable)', () => {
    const floor = box(-15, -1, -15, 15, 0, 15)
    const map = mapOf([floor], box(-15, 0, -15, 15, 3, 15))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)
    const start = worldToCellIndex(grid, -10, 0)
    const goal = worldToCellIndex(grid, 10, 0)
    findPath(ctx, start, goal)
    // Camino recto: ~20 celdas. Muy por debajo de un rodeo artificialmente
    // largo (control de cordura, no un número exacto).
    expect(ctx.resultLength).toBeLessThan(25)
    expect(ctx.resultLength).toBeGreaterThan(15)
  })
})

describe('caché de caminos', () => {
  it('la misma clave (origen,destino) siempre devuelve el mismo camino', () => {
    const map = mapOf([box(-10, -1, -10, 10, 0, 10)], box(-10, 0, -10, 10, 3, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)
    const cache = createPathCache()

    const start = worldToCellIndex(grid, -8, -8)
    const goal = worldToCellIndex(grid, 8, 8)

    const first = findPathCached(ctx, cache, start, goal)
    const second = findPathCached(ctx, cache, start, goal)
    expect(second.found).toBe(first.found)
    expect(second.path).toEqual(first.path)
  })

  it('una entrada de caché no se corrompe cuando ctx corre OTRA búsqueda después', () => {
    const map = mapOf([box(-10, -1, -10, 10, 0, 10)], box(-10, 0, -10, 10, 3, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)
    const cache = createPathCache()

    const start = worldToCellIndex(grid, -8, -8)
    const goal = worldToCellIndex(grid, 8, 8)
    const entry = findPathCached(ctx, cache, start, goal)
    const snapshot = [...entry.path]

    // Ensucia ctx.resultPath con una búsqueda totalmente distinta.
    findPath(ctx, worldToCellIndex(grid, 0, 0), worldToCellIndex(grid, -9, -9))

    expect(entry.path).toEqual(snapshot)
  })

  it('respeta la capacidad: desaloja la entrada más vieja (FIFO) al llenarse', () => {
    const map = mapOf([box(-10, -1, -10, 10, 0, 10)], box(-10, 0, -10, 10, 3, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)
    const cache = createPathCache(2)

    const a = worldToCellIndex(grid, -8, -8)
    const b = worldToCellIndex(grid, -8, 8)
    const c = worldToCellIndex(grid, 8, -8)
    const d = worldToCellIndex(grid, 8, 8)

    findPathCached(ctx, cache, a, b) // entrada 1
    findPathCached(ctx, cache, a, c) // entrada 2 (capacidad llena)
    expect(cache.entries.size).toBe(2)
    findPathCached(ctx, cache, a, d) // fuerza desalojo de la entrada 1
    expect(cache.entries.size).toBe(2)
    expect(cache.entries.has(`${a}:${b}`)).toBe(false)
    expect(cache.entries.has(`${a}:${d}`)).toBe(true)
  })

  it('clearPathCache vacía la caché por completo', () => {
    const map = mapOf([box(-10, -1, -10, 10, 0, 10)], box(-10, 0, -10, 10, 3, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const ctx = createPathfindingContext(grid)
    const cache = createPathCache()
    findPathCached(ctx, cache, worldToCellIndex(grid, -8, -8), worldToCellIndex(grid, 8, 8))
    expect(cache.entries.size).toBeGreaterThan(0)
    clearPathCache(cache)
    expect(cache.entries.size).toBe(0)
  })
})

describe('navgrid + A* sobre la arena real del juego', () => {
  const grid = buildNavGrid(ARENA, 1, CAPSULE_H)
  const ctx = createPathfindingContext(grid)

  it('existe un camino entre cualquier par de spawns', () => {
    for (let i = 0; i < ARENA.spawns.length; i++) {
      for (let j = 0; j < ARENA.spawns.length; j++) {
        if (i === j) continue
        const a = worldToCellIndex(grid, ARENA.spawns[i].x, ARENA.spawns[i].z)
        const b = worldToCellIndex(grid, ARENA.spawns[j].x, ARENA.spawns[j].z)
        expect(a, `spawn ${i}`).toBeGreaterThanOrEqual(0)
        expect(b, `spawn ${j}`).toBeGreaterThanOrEqual(0)
        expect(findPath(ctx, a, b), `spawn ${i} -> spawn ${j}`).toBe(true)
      }
    }
  })

  it('el camino entre spawns opuestos nunca cruza geometría sólida (todos los pasos conectados)', () => {
    const a = worldToCellIndex(grid, ARENA.spawns[0].x, ARENA.spawns[0].z)
    const b = worldToCellIndex(grid, ARENA.spawns[1].x, ARENA.spawns[1].z)
    expect(findPath(ctx, a, b)).toBe(true)
    for (let i = 0; i < ctx.resultLength - 1; i++) {
      expect(cellsConnected(grid, ctx.resultPath[i], ctx.resultPath[i + 1])).toBe(true)
    }
  })

  it('ninguna celda del camino cae dentro de un box sólido no mantleable', () => {
    const a = worldToCellIndex(grid, ARENA.spawns[0].x, ARENA.spawns[0].z)
    const b = worldToCellIndex(grid, ARENA.spawns[3].x, ARENA.spawns[3].z)
    expect(findPath(ctx, a, b)).toBe(true)
    for (let i = 0; i < ctx.resultLength; i++) {
      const idx = ctx.resultPath[i]
      expect(grid.walkable[idx]).toBe(1)
      const x = cellCenterX(grid, cellCol(grid, idx))
      const z = cellCenterZ(grid, cellRow(grid, idx))
      const height = grid.heights[idx]
      // La celda tiene que estar sobre una superficie real del mapa: para
      // cada box que cubre (x,z), o la celda queda claramente sobre su
      // techo, o claramente afuera de su rango vertical -- nunca "adentro".
      for (const b2 of ARENA.boxes) {
        const dentroXZ = x > b2.min.x && x < b2.max.x && z > b2.min.z && z < b2.max.z
        if (!dentroXZ) continue
        const sobreElTecho = height >= b2.max.y - 1e-6
        const debajoDelPiso = height <= b2.min.y + 1e-6
        expect(sobreElTecho || debajoDelPiso, `celda en (${x},${z}) altura ${height} cae dentro de un box`).toBe(true)
      }
    }
  })
})
