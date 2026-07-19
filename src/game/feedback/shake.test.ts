import { describe, expect, it } from 'vitest'
import { addShake, createShakeState, stepShake } from '@/game/feedback/shake'
import { FEEDBACK } from '@/game/feedback/tuning'

const DT = 1 / 240

describe('addShake: proporcional al daño, clampeado', () => {
  it('más daño produce más magnitud', () => {
    const chico = createShakeState()
    const grande = createShakeState()
    addShake(chico, 5)
    addShake(grande, 40)
    expect(grande.magnitude).toBeGreaterThan(chico.magnitude)
  })

  it('la magnitud nunca supera shakeMax, ni con daño extremo', () => {
    const state = createShakeState()
    addShake(state, 100000)
    expect(state.magnitude).toBeLessThanOrEqual(FEEDBACK.shakeMax)
  })
})

describe('stepShake: decae hacia 0 sin más golpes', () => {
  it('la magnitud decae de forma monótona', () => {
    const state = createShakeState()
    addShake(state, 30)
    let prev = state.magnitude
    for (let i = 0; i < 200; i++) {
      stepShake(state, DT)
      expect(state.magnitude).toBeLessThanOrEqual(prev + 1e-9)
      prev = state.magnitude
    }
  })

  it('nunca queda negativa', () => {
    const state = createShakeState()
    addShake(state, 30)
    for (let i = 0; i < 1000; i++) {
      stepShake(state, DT)
      expect(state.magnitude).toBeGreaterThanOrEqual(0)
    }
  })

  it('llega a 0 y el offset se apaga con ella', () => {
    const state = createShakeState()
    addShake(state, 10)
    for (let i = 0; i < 2000; i++) stepShake(state, DT)
    expect(state.magnitude).toBe(0)
    expect(state.offsetX).toBe(0)
    expect(state.offsetY).toBe(0)
  })

  it('el offset nunca excede la magnitud actual', () => {
    const state = createShakeState()
    addShake(state, 25)
    for (let i = 0; i < 300; i++) {
      stepShake(state, DT)
      const dist = Math.hypot(state.offsetX, state.offsetY)
      expect(dist).toBeLessThanOrEqual(state.magnitude + 1e-9)
    }
  })

  it('determinismo: la misma secuencia de golpes da la misma trayectoria de offsets', () => {
    const run = (): number[] => {
      const state = createShakeState()
      const out: number[] = []
      for (let i = 0; i < 50; i++) {
        if (i % 7 === 0) addShake(state, 15)
        stepShake(state, DT)
        out.push(state.offsetX, state.offsetY)
      }
      return out
    }
    expect(run()).toEqual(run())
  })

  it('cero asignaciones: miles de add/step no hacen crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')
    const state = createShakeState()

    for (let i = 0; i < 1000; i++) {
      if (i % 4 === 0) addShake(state, 20)
      stepShake(state, DT)
    }

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 300_000; i++) {
      if (i % 4 === 0) addShake(state, 20)
      stepShake(state, DT)
    }

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })
})
