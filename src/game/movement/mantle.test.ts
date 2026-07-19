import { describe, expect, it } from 'vitest'
import { tryMantle } from '@/game/movement/mantle'
import { MOVEMENT } from '@/game/movement/tuning'
import { box } from '@/game/map/arena'
import { vec3 } from '@/game/math/vec3'

const piso = box(-50, -1, -50, 50, 0, 50)

describe('mantle', () => {
  it('sube a una caja baja cuando te movés contra ella', () => {
    const caja = box(1, 0, -2, 3, 1.0, 2)
    const pos = vec3(0.5, 0, 0)
    const ok = tryMantle(pos, vec3(2, 0, 0), vec3(1, 0, 0), [piso, caja])
    expect(ok).toBe(true)
    expect(pos.y).toBeCloseTo(1.0, 2)
  })

  it('no sube a una pared más alta que el límite', () => {
    const pared = box(1, 0, -2, 3, 4, 2)
    const pos = vec3(0.5, 0, 0)
    const ok = tryMantle(pos, vec3(2, 0, 0), vec3(1, 0, 0), [piso, pared])
    expect(ok).toBe(false)
    expect(pos.y).toBeCloseTo(0, 6)
  })

  it('no sube si te movés en dirección contraria', () => {
    const caja = box(1, 0, -2, 3, 1.0, 2)
    const pos = vec3(0.5, 0, 0)
    const ok = tryMantle(pos, vec3(-2, 0, 0), vec3(-1, 0, 0), [piso, caja])
    expect(ok).toBe(false)
  })

  it('no sube si no hay espacio libre arriba', () => {
    const caja = box(1, 0, -2, 3, 1.0, 2)
    const techo = box(1, 1.2, -2, 3, 5, 2)
    const pos = vec3(0.5, 0, 0)
    const ok = tryMantle(pos, vec3(2, 0, 0), vec3(1, 0, 0), [piso, caja, techo])
    expect(ok).toBe(false)
  })

  it('no sube si vas demasiado lento', () => {
    const caja = box(1, 0, -2, 3, 1.0, 2)
    const pos = vec3(0.5, 0, 0)
    const ok = tryMantle(pos, vec3(0.1, 0, 0), vec3(1, 0, 0), [piso, caja])
    expect(ok).toBe(false)
  })

  it('respeta exactamente el límite de altura del tuning', () => {
    const justo = box(1, 0, -2, 3, MOVEMENT.mantleMaxHeight - 0.01, 2)
    const pasado = box(1, 0, -2, 3, MOVEMENT.mantleMaxHeight + 0.5, 2)
    const a = vec3(0.5, 0, 0)
    const b = vec3(0.5, 0, 0)
    expect(tryMantle(a, vec3(2, 0, 0), vec3(1, 0, 0), [piso, justo])).toBe(true)
    expect(tryMantle(b, vec3(2, 0, 0), vec3(1, 0, 0), [piso, pasado])).toBe(false)
  })
})
