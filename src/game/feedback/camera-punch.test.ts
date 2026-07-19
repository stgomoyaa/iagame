import { describe, expect, it } from 'vitest'
import {
  createCameraPunchState,
  fireCameraPunch,
  stepCameraPunch,
} from '@/game/feedback/camera-punch'
import { FEEDBACK } from '@/game/feedback/tuning'

const DT = 1 / 240

describe('camera punch: impulso al disparar, decae hacia el origen', () => {
  it('un disparo mueve el roll fuera de 0', () => {
    const state = createCameraPunchState()
    fireCameraPunch(state)
    stepCameraPunch(state, DT)
    expect(state.roll).not.toBe(0)
  })

  it('sin más disparos, el roll decae de vuelta a 0', () => {
    const state = createCameraPunchState()
    fireCameraPunch(state)
    for (let i = 0; i < 5; i++) stepCameraPunch(state, DT)
    const trasCincoTicks = Math.abs(state.roll)

    for (let i = 0; i < 500; i++) stepCameraPunch(state, DT)
    expect(Math.abs(state.roll)).toBeLessThan(trasCincoTicks)
    expect(Math.abs(state.roll)).toBeLessThan(1e-4)
  })

  it('el roll acumulado nunca supera cameraPunchMax, ni con fuego sostenido a alta cadencia', () => {
    const state = createCameraPunchState()
    for (let i = 0; i < 2000; i++) {
      fireCameraPunch(state)
      stepCameraPunch(state, DT)
      expect(Math.abs(state.roll)).toBeLessThanOrEqual(FEEDBACK.cameraPunchMax + 1e-9)
    }
  })

  it('determinismo: la misma secuencia de disparos da el mismo roll final', () => {
    const run = (): number => {
      const state = createCameraPunchState()
      for (let i = 0; i < 300; i++) {
        if (i % 5 === 0) fireCameraPunch(state)
        stepCameraPunch(state, DT)
      }
      return state.roll
    }
    expect(run()).toBe(run())
  })

  it('cero asignaciones: miles de fire/step no hacen crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')
    const state = createCameraPunchState()

    for (let i = 0; i < 1000; i++) {
      fireCameraPunch(state)
      stepCameraPunch(state, DT)
    }

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 300_000; i++) {
      if (i % 3 === 0) fireCameraPunch(state)
      stepCameraPunch(state, DT)
    }

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })
})
