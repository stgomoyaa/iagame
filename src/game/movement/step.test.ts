import { describe, expect, it } from 'vitest'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'
import { box } from '@/game/map/arena'
import { lengthHorizontal, vec3 } from '@/game/math/vec3'
import { TICK_DT } from '@/game/engine/constants'

const piso = [box(-50, -1, -50, 50, 0, 50)]

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false, ...over }
}

function simular(state: ReturnType<typeof createPlayerState>, inp: PlayerInput, ticks: number) {
  for (let i = 0; i < ticks; i++) stepPlayer(state, inp, piso, TICK_DT)
}

describe('paso del jugador', () => {
  it('arranca en el suelo tras un tick de asentamiento', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input(), 5)
    expect(s.grounded).toBe(true)
  })

  it('sin input se queda quieto', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input(), 60)
    expect(lengthHorizontal(s.velocity)).toBeCloseTo(0, 3)
  })

  it('caminar hacia adelante alcanza la velocidad de caminata', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input({ forward: 1 }), 128)
    expect(lengthHorizontal(s.velocity)).toBeCloseTo(MOVEMENT.walkSpeed, 1)
  })

  it('sprint alcanza la velocidad de sprint', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input({ forward: 1, sprint: true }), 128)
    expect(lengthHorizontal(s.velocity)).toBeCloseTo(MOVEMENT.sprintSpeed, 1)
  })

  it('el yaw rota la dirección de movimiento', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input({ forward: 1, yaw: Math.PI / 2 }), 128)
    expect(Math.abs(s.velocity.x)).toBeGreaterThan(Math.abs(s.velocity.z))
  })

  it('el salto despega del suelo', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input(), 5)
    stepPlayer(s, input({ jump: true }), piso, TICK_DT)
    expect(s.velocity.y).toBeGreaterThan(0)
    expect(s.grounded).toBe(false)
  })

  it('la gravedad lo devuelve al suelo', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input(), 5)
    stepPlayer(s, input({ jump: true }), piso, TICK_DT)
    simular(s, input(), 256)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 2)
  })

  it('el coyote time permite saltar poco después de dejar una repisa', () => {
    const repisa = [box(-50, -1, -50, 50, 0, 0)]
    const s = createPlayerState(vec3(0, 0, -1))
    for (let i = 0; i < 5; i++) stepPlayer(s, input(), repisa, TICK_DT)

    // Caminar hasta dejar la repisa sin asumir cuántos ticks toma: el número
    // depende de sprintSpeed, groundAccel y el radio de la cápsula, y no debe
    // volver a romper este test si alguno se tunea.
    let ticks = 0
    while (s.grounded && ticks < 500) {
      stepPlayer(s, input({ forward: -1, sprint: true }), repisa, TICK_DT)
      ticks++
    }

    expect(s.grounded).toBe(false)
    expect(ticks).toBeLessThan(500)
    expect(s.timeSinceGrounded).toBeLessThan(MOVEMENT.coyoteTime)

    stepPlayer(s, input({ forward: -1, sprint: true, jump: true }), repisa, TICK_DT)
    expect(s.velocity.y).toBeGreaterThan(0)
  })

  it('no se puede saltar en el aire pasado el coyote time', () => {
    const s = createPlayerState(vec3(0, 5, 0))
    simular(s, input(), 30)
    const yAntes = s.velocity.y
    stepPlayer(s, input({ jump: true }), piso, TICK_DT)
    expect(s.velocity.y).toBeLessThan(yAntes + 0.01)
  })

  it('prevPosition queda un tick atrás para interpolar', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input({ forward: 1, sprint: true }), 60)
    expect(s.prevPosition.z).not.toBeCloseTo(s.position.z, 6)
  })
})
