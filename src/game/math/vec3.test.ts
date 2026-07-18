import { describe, expect, it } from 'vitest'
import {
  addScaled, copy, dot, lengthHorizontal, normalizeHorizontal, scale, set, vec3,
} from '@/game/math/vec3'

describe('vec3', () => {
  it('vec3 crea el vector cero por defecto', () => {
    expect(vec3()).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('set escribe en out y lo devuelve', () => {
    const out = vec3()
    const returned = set(out, 1, 2, 3)
    expect(returned).toBe(out)
    expect(out).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('copy no comparte referencia', () => {
    const a = vec3(1, 2, 3)
    const out = vec3()
    copy(out, a)
    set(a, 9, 9, 9)
    expect(out).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('addScaled suma b escalado por s', () => {
    const out = vec3()
    addScaled(out, vec3(1, 1, 1), vec3(2, 0, 4), 0.5)
    expect(out).toEqual({ x: 2, y: 1, z: 3 })
  })

  it('scale multiplica las tres componentes', () => {
    const out = vec3()
    scale(out, vec3(1, -2, 3), 2)
    expect(out).toEqual({ x: 2, y: -4, z: 6 })
  })

  it('dot es el producto punto 3D', () => {
    expect(dot(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32)
  })

  it('lengthHorizontal ignora Y', () => {
    expect(lengthHorizontal(vec3(3, 100, 4))).toBe(5)
  })

  it('normalizeHorizontal deja Y en cero y largo 1', () => {
    const out = vec3()
    normalizeHorizontal(out, vec3(3, 7, 4))
    expect(out.y).toBe(0)
    expect(lengthHorizontal(out)).toBeCloseTo(1, 10)
  })

  it('normalizeHorizontal de un vector vertical devuelve cero sin NaN', () => {
    const out = vec3()
    normalizeHorizontal(out, vec3(0, 5, 0))
    expect(out).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('las operaciones aceptan out === a sin corromperse', () => {
    const v = vec3(3, 0, 4)
    normalizeHorizontal(v, v)
    expect(lengthHorizontal(v)).toBeCloseTo(1, 10)
  })
})
