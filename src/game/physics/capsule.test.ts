import { describe, expect, it } from 'vitest'
import { PLAYER_CAPSULE, resolveMove } from '@/game/physics/capsule'
import type { MoveResult } from '@/game/physics/capsule'
import { box } from '@/game/map/arena'
import { vec3 } from '@/game/math/vec3'

const piso = [box(-50, -1, -50, 50, 0, 50)]
const result: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }

describe('colisión de cápsula', () => {
  it('el movimiento libre en el aire no altera el delta', () => {
    const pos = vec3(0, 10, 0)
    resolveMove(pos, vec3(1, 0, 2), PLAYER_CAPSULE, piso, result)
    expect(pos.x).toBeCloseTo(1, 6)
    expect(pos.y).toBeCloseTo(10, 6)
    expect(pos.z).toBeCloseTo(2, 6)
    expect(result.hitGround).toBe(false)
  })

  it('caer sobre el piso lo detecta y deja los pies en la superficie', () => {
    const pos = vec3(0, 5, 0)
    resolveMove(pos, vec3(0, -10, 0), PLAYER_CAPSULE, piso, result)
    expect(pos.y).toBeCloseTo(0, 4)
    expect(result.hitGround).toBe(true)
  })

  it('caminar contra una pared frena el eje bloqueado y deja libre el otro', () => {
    const pared = [...piso, box(2, 0, -10, 3, 4, 10)]
    const pos = vec3(0, 0, 0)
    resolveMove(pos, vec3(5, 0, 1), PLAYER_CAPSULE, pared, result)
    expect(pos.x).toBeLessThan(2)
    expect(pos.z).toBeCloseTo(1, 4)
    expect(result.hitWall).toBe(true)
  })

  it('a alta velocidad no atraviesa una pared delgada (sin tunneling)', () => {
    const pared = [...piso, box(2, 0, -10, 2.2, 4, 10)]
    const pos = vec3(0, 0, 0)
    // 40 m/s en un tick de 128Hz: mucho más rápido que el tope de bhop
    resolveMove(pos, vec3(40 / 128, 0, 0), PLAYER_CAPSULE, pared, result)
    expect(pos.x).toBeLessThan(2)
  })

  it('golpear un techo lo detecta', () => {
    const techo = [...piso, box(-5, 3, -5, 5, 4, 5)]
    const pos = vec3(0, 0, 0)
    resolveMove(pos, vec3(0, 5, 0), PLAYER_CAPSULE, techo, result)
    expect(result.hitCeiling).toBe(true)
    expect(pos.y).toBeLessThan(3)
  })

  it('quedarse quieto sobre el piso no lo hunde ni lo expulsa', () => {
    const pos = vec3(0, 0, 0)
    for (let i = 0; i < 100; i++) {
      resolveMove(pos, vec3(0, 0, 0), PLAYER_CAPSULE, piso, result)
    }
    expect(pos.y).toBeCloseTo(0, 4)
  })

  it('deslizarse por una esquina interior no lo traba', () => {
    const esquina = [...piso, box(2, 0, -10, 3, 4, 0), box(-10, 0, -1, 3, 4, 0)]
    const pos = vec3(0, 0, -3)
    const zAntes = pos.z
    resolveMove(pos, vec3(1, 0, 1), PLAYER_CAPSULE, esquina, result)
    expect(pos.z).toBeGreaterThan(zAntes - 0.01)
    expect(Number.isNaN(pos.x)).toBe(false)
  })

  it('es determinista: la misma entrada da la misma salida', () => {
    const a = vec3(0, 3, 0)
    const b = vec3(0, 3, 0)
    const pared = [...piso, box(1, 0, -5, 2, 4, 5)]
    for (let i = 0; i < 20; i++) {
      resolveMove(a, vec3(0.3, -0.2, 0.1), PLAYER_CAPSULE, pared, result)
      resolveMove(b, vec3(0.3, -0.2, 0.1), PLAYER_CAPSULE, pared, result)
    }
    expect(a).toEqual(b)
  })
})
