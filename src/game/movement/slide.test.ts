import { describe, expect, it } from 'vitest'
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

function correrHastaSprint(s: ReturnType<typeof createPlayerState>) {
  for (let i = 0; i < 200; i++) {
    stepPlayer(s, input({ forward: 1, sprint: true }), piso, TICK_DT)
  }
}

describe('slide', () => {
  it('agacharse corriendo entra en slide y da un boost de velocidad', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    const antes = lengthHorizontal(s.velocity)

    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)

    expect(s.sliding).toBe(true)
    expect(lengthHorizontal(s.velocity)).toBeGreaterThan(antes)
  })

  it('no entra en slide si vas muy lento', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    for (let i = 0; i < 20; i++) stepPlayer(s, input(), piso, TICK_DT)
    stepPlayer(s, input({ crouch: true }), piso, TICK_DT)
    expect(s.sliding).toBe(false)
  })

  it('el slide baja la altura de los ojos', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    // El eyeHeight ya no salta de golpe: converge de a poco (ver
    // movement/step.test.ts para el test dedicado al lerp). Acá alcanza con
    // confirmar que, dado tiempo, el slide efectivamente lo baja.
    for (let i = 0; i < 200; i++) {
      stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    }
    expect(s.eyeHeight).toBeCloseTo(MOVEMENT.crouchEyeHeight, 3)
  })

  it('el slide termina solo pasada su duración', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    const ticks = Math.ceil(MOVEMENT.slideDuration / TICK_DT) + 10
    for (let i = 0; i < ticks; i++) {
      stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    }
    expect(s.sliding).toBe(false)
  })

  it('el slide-cancel conserva la velocidad, que es lo que permite encadenar', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    const velEnSlide = lengthHorizontal(s.velocity)

    stepPlayer(s, input({ forward: 1, crouch: true, jump: true }), piso, TICK_DT)

    expect(s.sliding).toBe(false)
    expect(s.velocity.y).toBeGreaterThan(0)
    expect(lengthHorizontal(s.velocity)).toBeGreaterThan(velEnSlide * 0.9)
  })

  it('deslizando no se puede acelerar con las teclas de movimiento', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    const alEntrar = lengthHorizontal(s.velocity)

    for (let i = 0; i < 20; i++) {
      stepPlayer(s, input({ forward: 1, sprint: true, crouch: true }), piso, TICK_DT)
    }
    expect(lengthHorizontal(s.velocity)).toBeLessThan(alEntrar)
  })

  it('soltar agacharse termina el slide', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    expect(s.sliding).toBe(true)
    stepPlayer(s, input({ forward: 1 }), piso, TICK_DT)
    expect(s.sliding).toBe(false)
  })

  it('mantener agachado no reinicia el slide: entra por flanco, no por tecla sostenida', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    const ticks = Math.ceil(MOVEMENT.slideDuration / TICK_DT) + 10
    let slidingTicks = 0
    for (let i = 0; i < ticks; i++) {
      stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
      if (s.sliding) slidingTicks++
    }

    expect(s.sliding).toBe(false)
    expect(slidingTicks).toBeLessThanOrEqual(Math.ceil(MOVEMENT.slideDuration / TICK_DT) + 1)

    // Soltar agachar y esperar a que pase el cooldown de re-entrada (ver
    // MOVEMENT.slideCooldown): un re-presionado inmediato tras soltar no se
    // puede distinguir del spam que el cooldown existe para bloquear.
    const ticksCooldown = Math.ceil(MOVEMENT.slideCooldown / TICK_DT) + 5
    for (let i = 0; i < ticksCooldown; i++) {
      stepPlayer(s, input({ forward: 1 }), piso, TICK_DT)
      expect(s.sliding).toBe(false)
    }

    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    expect(s.sliding).toBe(true)
  })

  it('el cooldown bloquea re-entrar al slide apenas se suelta y se re-presiona', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    expect(s.sliding).toBe(true)
    const velTrasBoost = lengthHorizontal(s.velocity)

    // Soltar y re-presionar de inmediato: el flanco es válido, pero el
    // cooldown todavía no pasó.
    stepPlayer(s, input({ forward: 1 }), piso, TICK_DT)
    expect(s.sliding).toBe(false)
    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)

    expect(s.sliding).toBe(false)
    // Sin el cooldown, este segundo re-presionado multiplicaría la
    // velocidad otra vez por slideBoost (~x1.35). Con el cooldown activo se
    // queda cerca de donde estaba, sólo con el roce normal de 2 ticks.
    expect(lengthHorizontal(s.velocity)).toBeLessThan(velTrasBoost * MOVEMENT.slideBoost)
  })

  it('el boost de slide se clampea a slideMaxSpeed en vez de multiplicar sin techo', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    // Forzar una velocidad de entrada ya cerca del techo: sin clamp, boostear
    // esto se iría muy por encima de slideMaxSpeed.
    s.velocity.x = MOVEMENT.slideMaxSpeed * 0.9
    s.velocity.z = 0

    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)

    expect(s.sliding).toBe(true)
    expect(lengthHorizontal(s.velocity)).toBeLessThanOrEqual(MOVEMENT.slideMaxSpeed + 1e-9)
  })
})
