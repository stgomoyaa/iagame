import { describe, expect, it } from 'vitest'
import {
  createCameraPunchState,
  fireCameraPunch,
  stepCameraPunch,
} from '@/game/feedback/camera-punch'
import { FEEDBACK } from '@/game/feedback/tuning'
import { degToRad } from '@/game/weapons/archetypes'

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

describe('golpe de vista (canal de sensación): pitch/yaw por arma', () => {
  const KICK = degToRad(13) // ar-1, la línea base

  it('un disparo con kick>0 patea el pitch hacia arriba en el PRIMER tiro (a diferencia del apuntado, que arranca en cero)', () => {
    const state = createCameraPunchState()
    fireCameraPunch(state, KICK)
    stepCameraPunch(state, DT)
    expect(state.pitch).toBeGreaterThan(0)
  })

  it('kick por defecto 0 no toca pitch/yaw (sólo el roll universal): los llamadores viejos no cambian', () => {
    const state = createCameraPunchState()
    fireCameraPunch(state)
    for (let i = 0; i < 5; i++) stepCameraPunch(state, DT)
    expect(state.pitch).toBe(0)
    expect(state.yaw).toBe(0)
    expect(state.roll).not.toBe(0)
  })

  it('un arma que pega más fuerte (escopeta) patea más alto que una suave (SMG) con el mismo número de disparos', () => {
    const pico = (kick: number): number => {
      const state = createCameraPunchState()
      let max = 0
      for (let i = 0; i < 60; i++) {
        if (i === 0) fireCameraPunch(state, kick)
        stepCameraPunch(state, DT)
        max = Math.max(max, state.pitch)
      }
      return max
    }
    expect(pico(degToRad(41))).toBeGreaterThan(pico(degToRad(7)))
  })

  it('el pitch decae de vuelta a ~0 sin más disparos', () => {
    const state = createCameraPunchState()
    fireCameraPunch(state, KICK)
    for (let i = 0; i < 5; i++) stepCameraPunch(state, DT)
    const pico = Math.abs(state.pitch)
    for (let i = 0; i < 500; i++) stepCameraPunch(state, DT)
    expect(Math.abs(state.pitch)).toBeLessThan(pico)
    expect(Math.abs(state.pitch)).toBeLessThan(1e-4)
  })

  it('el pitch acumulado nunca supera cameraKickPitchMax ni con fuego sostenido a cadencia alta', () => {
    const state = createCameraPunchState()
    for (let i = 0; i < 2000; i++) {
      fireCameraPunch(state, degToRad(41))
      stepCameraPunch(state, DT)
      expect(state.pitch).toBeLessThanOrEqual(FEEDBACK.cameraKickPitchMax + 1e-9)
    }
  })

  it('el yaw alterna de lado disparo a disparo (sacudida, no deriva a un solo lado)', () => {
    const state = createCameraPunchState()
    fireCameraPunch(state, KICK)
    const trasUno = state.yawVel
    fireCameraPunch(state, KICK)
    const trasDos = state.yawVel
    expect(trasUno).not.toBe(0)
    // el aporte del segundo disparo tiene signo opuesto al del primero
    expect(Math.sign(trasDos - trasUno)).toBe(-Math.sign(trasUno))
  })

  it('determinismo con kick: la misma secuencia da el mismo pitch/yaw final', () => {
    const run = (): [number, number] => {
      const state = createCameraPunchState()
      for (let i = 0; i < 300; i++) {
        if (i % 5 === 0) fireCameraPunch(state, KICK)
        stepCameraPunch(state, DT)
      }
      return [state.pitch, state.yaw]
    }
    expect(run()).toEqual(run())
  })

  it('cero asignaciones: miles de fire(kick)/step no hacen crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')
    const state = createCameraPunchState()
    for (let i = 0; i < 1000; i++) {
      fireCameraPunch(state, KICK)
      stepCameraPunch(state, DT)
    }
    global.gc?.()
    const antes = process.memoryUsage().heapUsed
    for (let i = 0; i < 300_000; i++) {
      if (i % 3 === 0) fireCameraPunch(state, KICK)
      stepCameraPunch(state, DT)
    }
    global.gc?.()
    const crecimientoMB = (process.memoryUsage().heapUsed - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })
})
