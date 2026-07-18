import { describe, expect, it } from 'vitest'
import { applySoftCap } from '@/game/movement/bhop'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'
import { box } from '@/game/map/arena'
import { lengthHorizontal, vec3 } from '@/game/math/vec3'
import { TICK_DT } from '@/game/engine/constants'

const piso = [box(-500, -1, -500, 500, 0, 500)]

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false, ...over }
}

describe('tope suave', () => {
  it('no toca velocidades por debajo del tope', () => {
    const v = vec3(5, 0, 0)
    applySoftCap(v, 14.4, 3, TICK_DT)
    expect(v.x).toBeCloseTo(5, 6)
  })

  it('decae el exceso por encima del tope sin cortarlo de golpe', () => {
    const v = vec3(20, 0, 0)
    applySoftCap(v, 14.4, 3, TICK_DT)
    expect(v.x).toBeLessThan(20)
    expect(v.x).toBeGreaterThan(14.4)
  })

  it('converge hacia el tope tras sostenerlo', () => {
    const v = vec3(30, 0, 0)
    for (let i = 0; i < 1000; i++) applySoftCap(v, 14.4, 3, TICK_DT)
    expect(v.x).toBeCloseTo(14.4, 1)
  })

  it('no toca la vertical', () => {
    const v = vec3(30, -9, 0)
    applySoftCap(v, 14.4, 3, TICK_DT)
    expect(v.y).toBe(-9)
  })
})

describe('bunny hop', () => {
  it('con salto sostenido rebota sin tocar el suelo más de un tick seguido', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    for (let i = 0; i < 10; i++) stepPlayer(s, input(), piso, TICK_DT)

    let ticksEnSuelo = 0
    for (let i = 0; i < 512; i++) {
      stepPlayer(s, input({ jump: true, forward: 1, sprint: true }), piso, TICK_DT)
      if (s.grounded) ticksEnSuelo++
    }
    // Rebotando, se pasa la enorme mayoría del tiempo en el aire.
    expect(ticksEnSuelo).toBeLessThan(120)
  })

  it('el air-strafe gana velocidad por encima del sprint', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    for (let i = 0; i < 10; i++) stepPlayer(s, input(), piso, TICK_DT)

    // Encadenar saltos girando el yaw mientras strafea, que es la técnica real.
    let yaw = 0
    for (let i = 0; i < 1500; i++) {
      yaw += 0.012
      stepPlayer(s, input({ jump: true, right: 1, yaw, sprint: true }), piso, TICK_DT)
    }
    expect(lengthHorizontal(s.velocity)).toBeGreaterThan(MOVEMENT.sprintSpeed)
  })

  it('la velocidad nunca supera el tope suave de forma sostenida', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    for (let i = 0; i < 10; i++) stepPlayer(s, input(), piso, TICK_DT)

    let yaw = 0
    let maxVista = 0
    for (let i = 0; i < 5000; i++) {
      yaw += 0.012
      stepPlayer(s, input({ jump: true, right: 1, yaw, sprint: true }), piso, TICK_DT)
      maxVista = Math.max(maxVista, lengthHorizontal(s.velocity))
    }
    // El tope es suave, así que se permite un margen por encima, no infinito.
    // El equilibrio calculado es ~18.8 m/s con decay 12; 1.5x da 21.6 de holgura.
    expect(maxVista).toBeLessThan(MOVEMENT.bhopSoftCap * 1.5)
  })

  it('sin saltar, la fricción frena hasta la velocidad de caminata', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    s.velocity.x = 20
    for (let i = 0; i < 256; i++) stepPlayer(s, input(), piso, TICK_DT)
    expect(lengthHorizontal(s.velocity)).toBeLessThan(MOVEMENT.walkSpeed)
  })
})
