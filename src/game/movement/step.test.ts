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

  it('adsSpeedScale escala la velocidad objetivo (el hook que frena a los bots)', () => {
    // Es el mecanismo del que cuelga BOTS.botSpeedScale: PlayerInput.adsSpeedScale
    // multiplica la velocidad objetivo en targetSpeed(). Con 0.8 un sprint que
    // sin el hook llega a sprintSpeed (8) llega a 0.8*8=6,4 — sin tocar la
    // física, sólo la velocidad. Ver bots/bot.ts (input del bot) y BOTS.botSpeedScale.
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input({ forward: 1, sprint: true, adsSpeedScale: 0.8 }), 128)
    expect(lengthHorizontal(s.velocity)).toBeCloseTo(MOVEMENT.sprintSpeed * 0.8, 1)
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

  it('la altura de los ojos converge al agacharse en vez de saltar de golpe', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input(), 5)
    const antes = s.eyeHeight

    stepPlayer(s, input({ crouch: true }), piso, TICK_DT)
    // Un solo tick no debe alcanzar el objetivo: si lo alcanzara sería el
    // salto instantáneo de 65cm que este lerp reemplaza.
    expect(s.eyeHeight).toBeGreaterThan(MOVEMENT.crouchEyeHeight)
    expect(s.eyeHeight).toBeLessThan(antes)

    simular(s, input({ crouch: true }), 200)
    expect(s.eyeHeight).toBeCloseTo(MOVEMENT.crouchEyeHeight, 3)
  })

  it('la altura de los ojos no se pasa del objetivo al converger', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input(), 5)

    for (let i = 0; i < 300; i++) {
      stepPlayer(s, input({ crouch: true }), piso, TICK_DT)
      expect(s.eyeHeight).toBeGreaterThanOrEqual(MOVEMENT.crouchEyeHeight - 1e-9)
      expect(s.eyeHeight).toBeLessThanOrEqual(MOVEMENT.eyeHeight + 1e-9)
    }

    for (let i = 0; i < 300; i++) {
      stepPlayer(s, input(), piso, TICK_DT)
      expect(s.eyeHeight).toBeLessThanOrEqual(MOVEMENT.eyeHeight + 1e-9)
      expect(s.eyeHeight).toBeGreaterThanOrEqual(MOVEMENT.crouchEyeHeight - 1e-9)
    }
    expect(s.eyeHeight).toBeCloseTo(MOVEMENT.eyeHeight, 3)
  })

  describe('robustez ante dt hostil (Defecto 4)', () => {
    // resolveMove (physics/capsule.ts) ya guarda POSITION contra un delta no
    // finito, pero la VELOCITY se calcula antes de llegar ahí (accelerate,
    // gravedad) y nada la protegía. Hoy game.ts siempre llama a stepPlayer
    // con el dt por defecto (TICK_DT), así que esto está latente, no activo:
    // el fix igual va adentro de stepPlayer, para que cualquier llamador
    // futuro quede protegido por construcción.

    it('dt=NaN no corrompe la velocidad ni la posición: el jugador se recupera con ticks normales', () => {
      const s = createPlayerState(vec3(0, 5, 0))
      simular(s, input(), 30)

      stepPlayer(s, input({ forward: 1 }), piso, NaN)
      expect(Number.isFinite(s.velocity.x)).toBe(true)
      expect(Number.isFinite(s.velocity.y)).toBe(true)
      expect(Number.isFinite(s.velocity.z)).toBe(true)
      expect(Number.isFinite(s.position.x)).toBe(true)
      expect(Number.isFinite(s.position.y)).toBe(true)
      expect(Number.isFinite(s.position.z)).toBe(true)

      simular(s, input(), 300)
      expect(s.grounded).toBe(true)
      expect(Number.isFinite(s.position.y)).toBe(true)
    })

    it('dt=Infinity no manda velocity.y a -Infinity: el jugador no queda congelado en el aire', () => {
      const s = createPlayerState(vec3(0, 5, 0))
      simular(s, input(), 30)

      stepPlayer(s, input(), piso, Infinity)
      expect(Number.isFinite(s.velocity.y)).toBe(true)

      simular(s, input(), 300)
      expect(s.grounded).toBe(true)
    })

    it('un dt absurdamente grande (1e9) no manda position.y a un valor astronómico', () => {
      const s = createPlayerState(vec3(0, 5, 0))
      simular(s, input(), 30)

      stepPlayer(s, input(), piso, 1e9)
      // Cota generosa: el dt de un solo tick queda saturado a MAX_FRAME_DT
      // (0.25s), así que ni con gravedad a tope se acerca a los 1e19 del bug.
      expect(Math.abs(s.position.y)).toBeLessThan(1000)

      simular(s, input(), 300)
      expect(s.grounded).toBe(true)
    })
  })
})
