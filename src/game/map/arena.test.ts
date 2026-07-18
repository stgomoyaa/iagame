import { describe, expect, it } from 'vitest'
import { ARENA, box } from '@/game/map/arena'

describe('arena', () => {
  it('box construye min y max ordenados', () => {
    const b = box(0, 0, 0, 2, 3, 4)
    expect(b.min).toEqual({ x: 0, y: 0, z: 0 })
    expect(b.max).toEqual({ x: 2, y: 3, z: 4 })
  })

  it('toda caja tiene min estrictamente menor que max en los tres ejes', () => {
    for (const b of ARENA.boxes) {
      expect(b.max.x).toBeGreaterThan(b.min.x)
      expect(b.max.y).toBeGreaterThan(b.min.y)
      expect(b.max.z).toBeGreaterThan(b.min.z)
    }
  })

  it('tiene al menos 8 spawns', () => {
    expect(ARENA.spawns.length).toBeGreaterThanOrEqual(8)
  })

  it('todos los spawns caen dentro de los límites del mapa', () => {
    for (const s of ARENA.spawns) {
      expect(s.x).toBeGreaterThan(ARENA.bounds.min.x)
      expect(s.x).toBeLessThan(ARENA.bounds.max.x)
      expect(s.z).toBeGreaterThan(ARENA.bounds.min.z)
      expect(s.z).toBeLessThan(ARENA.bounds.max.z)
    }
  })

  it('ningún spawn queda dentro de una caja sólida', () => {
    for (const s of ARENA.spawns) {
      for (const b of ARENA.boxes) {
        const dentro =
          s.x > b.min.x && s.x < b.max.x &&
          s.y > b.min.y && s.y < b.max.y &&
          s.z > b.min.z && s.z < b.max.z
        expect(dentro).toBe(false)
      }
    }
  })

  it('el conteo de cajas se mantiene bajo el presupuesto de draw calls', () => {
    expect(ARENA.boxes.length).toBeLessThanOrEqual(200)
  })
})
