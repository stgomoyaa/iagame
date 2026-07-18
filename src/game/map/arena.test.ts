import { describe, expect, it } from 'vitest'
import { ARENA, box } from '@/game/map/arena'

/** Límite máximo de altura de mantle (metros) */
const MAX_MANTLE_HEIGHT = 1.2
/** Altura de los muros perimetrales (metros); marcan las superficies inescalables */
const PERIMETER_WALL_HEIGHT = 6

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

  it('toda superficie escalable es alcanzable por una cadena de escalones menores a max mantle height', () => {
    // El piso siempre es alcanzable en y=0
    const floorY = 0

    for (const testBox of ARENA.boxes) {
      // Los muros perimetrales (altura 6m) son intencionalmente inescalables
      if (testBox.max.y === PERIMETER_WALL_HEIGHT) {
        continue
      }

      // Si la caja está al nivel del piso, no hay nada que verificar
      if (testBox.max.y <= floorY) {
        continue
      }

      // La caja es escalable: verificar que existe un camino desde el piso
      // mediante saltos de max mantle height.
      const targetHeight = testBox.max.y
      let reachable = false

      // Método de escalada: comenzar en el piso y buscar si podemos alcanzar
      // la altura objetivo subiendo en pasos de max mantle height.
      // Una altura es alcanzable si existe una caja cuya parte superior está
      // entre la altura anterior y (altura anterior + max mantle height).

      let currentHeight = floorY
      const maxSteps = 100 // Límite de iteraciones para detectar ciclos infinitos

      for (let step = 0; step < maxSteps; step++) {
        if (currentHeight >= targetHeight) {
          reachable = true
          break
        }

        // Buscar una caja que podemos pisar desde la altura actual
        let nextHeight: number | null = null

        for (const climbBox of ARENA.boxes) {
          const boxTopHeight = climbBox.max.y

          // Ignorar muros perimetrales (son inescalables)
          if (climbBox.max.y === PERIMETER_WALL_HEIGHT) {
            continue
          }

          // La caja debe estar por encima de donde estamos
          if (boxTopHeight <= currentHeight) {
            continue
          }

          // La diferencia de altura debe ser mantleable
          if (boxTopHeight - currentHeight > MAX_MANTLE_HEIGHT) {
            continue
          }

          // Esta caja es un paso válido; registrar la altura si es más alta
          if (nextHeight === null || boxTopHeight > nextHeight) {
            nextHeight = boxTopHeight
          }
        }

        if (nextHeight === null) {
          // No hay más pasos disponibles desde esta altura
          break
        }

        currentHeight = nextHeight
      }

      if (!reachable) {
        throw new Error(`Caja en [${testBox.min.x}, ${testBox.min.y}, ${testBox.min.z}] a [${testBox.max.x}, ${testBox.max.y}, ${testBox.max.z}] (altura ${targetHeight}m) no es alcanzable`)
      }
      expect(reachable).toBe(true)
    }
  })
})
