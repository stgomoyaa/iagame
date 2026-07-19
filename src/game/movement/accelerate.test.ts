import { describe, expect, it } from 'vitest'
import { accelerate, applyFriction } from '@/game/movement/accelerate'
import { lengthHorizontal, vec3 } from '@/game/math/vec3'

describe('accelerate', () => {
  it('acelera desde el reposo en la dirección deseada', () => {
    const v = vec3(0, 0, 0)
    accelerate(v, vec3(1, 0, 0), 5, 60, 1 / 128)
    expect(v.x).toBeGreaterThan(0)
    expect(v.z).toBe(0)
  })

  it('no supera la wishSpeed acelerando en línea recta', () => {
    const v = vec3(0, 0, 0)
    for (let i = 0; i < 1000; i++) accelerate(v, vec3(1, 0, 0), 5, 60, 1 / 128)
    expect(v.x).toBeCloseTo(5, 3)
  })

  it('no agrega velocidad si ya vas más rápido que wishSpeed en esa dirección', () => {
    const v = vec3(10, 0, 0)
    accelerate(v, vec3(1, 0, 0), 5, 60, 1 / 128)
    expect(v.x).toBeCloseTo(10, 6)
  })

  it('sí acelera perpendicular aunque vayas rapidísimo: la base del air-strafe', () => {
    const v = vec3(15, 0, 0)
    const antes = lengthHorizontal(v)
    accelerate(v, vec3(0, 0, 1), 0.5, 100, 1 / 128)
    expect(v.z).toBeGreaterThan(0)
    expect(lengthHorizontal(v)).toBeGreaterThan(antes)
  })

  it('no toca la componente vertical', () => {
    const v = vec3(0, -9, 0)
    accelerate(v, vec3(1, 0, 0), 5, 60, 1 / 128)
    expect(v.y).toBe(-9)
  })
})

describe('applyFriction', () => {
  it('reduce la velocidad horizontal', () => {
    const v = vec3(5, 0, 0)
    applyFriction(v, 8, 1.5, 1 / 128)
    expect(v.x).toBeLessThan(5)
    expect(v.x).toBeGreaterThan(0)
  })

  it('frena a cero y no cruza a negativo', () => {
    const v = vec3(5, 0, 0)
    for (let i = 0; i < 1000; i++) applyFriction(v, 8, 1.5, 1 / 128)
    expect(v.x).toBe(0)
    expect(v.z).toBe(0)
  })

  it('no toca la componente vertical', () => {
    const v = vec3(5, -9, 0)
    applyFriction(v, 8, 1.5, 1 / 128)
    expect(v.y).toBe(-9)
  })

  it('preserva la dirección mientras frena', () => {
    const v = vec3(3, 0, 4)
    applyFriction(v, 8, 1.5, 1 / 128)
    expect(v.x / v.z).toBeCloseTo(3 / 4, 6)
  })
})
