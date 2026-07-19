import { describe, expect, it } from 'vitest'
import { nearestCoverDistanceXZ } from '@/game/bots/cover'
import { vec3 } from '@/game/math/vec3'
import type { Box } from '@/game/map/types'

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box {
  return { min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) }
}

const PISO = box(-30, -1, -30, 30, 0, 30)
const COBERTURA = box(-2, 0, -2, 2, 2.2, 2)
const LOSA_BAJA = box(8, 0, 8, 12, 0.2, 12)

describe('distancia a la cobertura más cercana', () => {
  it('cero dentro de la huella de una caja', () => {
    expect(nearestCoverDistanceXZ([PISO, COBERTURA], 0, 0, 1)).toBe(0)
  })

  it('mide sobre un solo eje cuando el punto sale de costado', () => {
    expect(nearestCoverDistanceXZ([COBERTURA], 5, 0, 1)).toBeCloseTo(3, 5)
    expect(nearestCoverDistanceXZ([COBERTURA], 0, -6, 1)).toBeCloseTo(4, 5)
  })

  it('mide en diagonal cuando el punto sale por una esquina', () => {
    expect(nearestCoverDistanceXZ([COBERTURA], 5, 6, 1)).toBeCloseTo(Math.hypot(3, 4), 5)
  })

  it('ignora el piso y cualquier losa por debajo de la altura mínima: no tapan a nadie', () => {
    expect(nearestCoverDistanceXZ([PISO, LOSA_BAJA], 10, 10, 1)).toBe(Infinity)
  })

  it('sin ninguna caja que califique devuelve Infinity, no 0', () => {
    expect(nearestCoverDistanceXZ([], 0, 0, 1)).toBe(Infinity)
  })

  it('se queda con la caja más cercana cuando hay varias', () => {
    const lejos = box(20, 0, 20, 22, 3, 22)
    expect(nearestCoverDistanceXZ([lejos, COBERTURA], 4, 0, 1)).toBeCloseTo(2, 5)
  })
})
