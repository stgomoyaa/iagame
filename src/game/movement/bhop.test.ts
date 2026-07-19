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
    // Medido: el pico real converge a ~15.01 m/s (ver el comentario de
    // bhopSoftCapDecay en tuning.ts), no a los ~18.8 que sugería el cálculo
    // teórico de antes (bhopSoftCap * 1.5 = 21.6, un 44% por encima de la
    // realidad). 17 da margen real sin dejar pasar una regresión que
    // acerque el equilibrio de vuelta a ese 18.8 teórico.
    expect(maxVista).toBeLessThan(17)
  })

  it('el bhop llega de verdad a su velocidad de recompensa medida, no sólo "más que sprint"', () => {
    // El test anterior (arriba) sólo pedía superar el sprint (8.0): una
    // regresión que redujera el equilibrio del bhop a, digamos, 9 m/s
    // seguiría pasando esa barra sin que nada la detectara. Éste pin-ea el
    // número real: ~14.45 m/s sostenido (ver bhop.test, medido sobre 20k
    // ticks) es el piso de la oscilación en régimen, una vez que convergió.
    const s = createPlayerState(vec3(0, 0, 0))
    for (let i = 0; i < 10; i++) stepPlayer(s, input(), piso, TICK_DT)

    let yaw = 0
    const N = 20000
    const speeds: number[] = []
    for (let i = 0; i < N; i++) {
      yaw += 0.012
      stepPlayer(s, input({ jump: true, right: 1, yaw, sprint: true }), piso, TICK_DT)
      speeds.push(lengthHorizontal(s.velocity))
    }

    const cola = speeds.slice(Math.floor(N * 0.75))
    const sostenido = Math.min(...cola)
    // Margen alrededor del 14.45 medido: suficiente para no ser frágil
    // ante variación de punto flotante, ajustado para que una regresión
    // real (bhop roto, o de vuelta cerca del 18.8 teórico) sí falle.
    expect(sostenido).toBeGreaterThan(13.5)
    expect(sostenido).toBeLessThan(15.5)
  })

  it('sin saltar, la fricción frena hasta la velocidad de caminata', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    s.velocity.x = 20
    for (let i = 0; i < 256; i++) stepPlayer(s, input(), piso, TICK_DT)
    expect(lengthHorizontal(s.velocity)).toBeLessThan(MOVEMENT.walkSpeed)
  })
})
