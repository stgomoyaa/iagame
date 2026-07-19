import { describe, expect, it } from 'vitest'
import { PLAYER_CAPSULE, resolveMove } from '@/game/physics/capsule'
import type { Capsule, MoveResult } from '@/game/physics/capsule'
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

  it('gravedad real integrada tick a tick lo mantiene apoyado sin hundirse ni flotar', () => {
    // A diferencia del test anterior (delta cero desde penetración cero, que
    // nunca dispara la rama de corrección), acá se integra gravedad real
    // cada tick como lo hará el sistema de movimiento, para ejercitar de
    // verdad el contacto en reposo del que depende todo el diseño de "sin
    // ground probe".
    const pos = vec3(0, 0, 0)
    const gravedad = 22
    const tick = 1 / 128
    const deltaY = -gravedad * tick * tick
    const iteraciones = 5000
    let contactos = 0
    for (let i = 0; i < iteraciones; i++) {
      resolveMove(pos, vec3(0, deltaY, 0), PLAYER_CAPSULE, piso, result)
      expect(Math.abs(pos.y)).toBeLessThan(1e-6)
      if (result.hitGround) contactos++
    }
    expect(contactos).toBe(iteraciones)
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

  it('un delta no finito no corrompe la posición ni deja flags obsoletas', () => {
    const pos = vec3(0, 5, 0)
    const out: MoveResult = { hitGround: true, hitCeiling: true, hitWall: true }
    resolveMove(pos, vec3(NaN, 0, 0), PLAYER_CAPSULE, piso, out)
    expect(pos.x).toBe(0)
    expect(pos.y).toBe(5)
    expect(pos.z).toBe(0)
    expect(out.hitGround).toBe(false)
    expect(out.hitCeiling).toBe(false)
    expect(out.hitWall).toBe(false)
  })

  it('una cápsula de radio cero no cuelga el loop de substeps', () => {
    const capsuleDegenerada: Capsule = { radius: 0, height: 1.8 }
    const pos = vec3(0, 5, 0)
    resolveMove(pos, vec3(0, -1, 0), capsuleDegenerada, piso, result)
    expect(Number.isFinite(pos.y)).toBe(true)
  }, 1000)
})
