import { describe, expect, it } from 'vitest'
import {
  createAimBrainState,
  createAimMotorState,
  currentErrorConeRadius,
  lookAt,
  sampleErrorOffset,
  stepAimTowards,
  type YawPitch,
} from '@/game/bots/aim'
import { PITCH_LIMIT } from '@/game/engine/input'

describe('motor de apuntado: velocidad angular acotada', () => {
  it('nunca gira más que maxAngularSpeedRad*dt en un solo tick', () => {
    const state = createAimMotorState(0, 0)
    const maxSpeed = 1.0 // rad/seg
    const dt = 1 / 128
    // Objetivo MUY lejos (media vuelta): si esto no estuviera acotado, el
    // motor saltaría directo -- el snap instantáneo que el spec prohíbe.
    stepAimTowards(state, Math.PI, 0, maxSpeed, dt)
    expect(Math.abs(state.yaw)).toBeLessThanOrEqual(maxSpeed * dt + 1e-9)
  })

  it('nunca hay snap instantáneo: converge gradualmente en muchos ticks pequeños, no en uno', () => {
    const state = createAimMotorState(0, 0)
    const maxSpeed = 2.0
    const dt = 1 / 128
    const targetYaw = 1.5

    let ticksHastaConverger = 0
    for (let i = 0; i < 100000; i++) {
      stepAimTowards(state, targetYaw, 0, maxSpeed, dt)
      ticksHastaConverger++
      if (Math.abs(state.yaw - targetYaw) < 1e-6) break
    }
    // Tiempo mínimo teórico: distancia / velocidad máxima. Con margen chico
    // por la resolución del tick -- pero SIGUE siendo muchos ticks, no uno.
    const minTicksTeorico = (targetYaw / maxSpeed) / dt
    expect(ticksHastaConverger).toBeGreaterThan(minTicksTeorico * 0.9)
    expect(ticksHastaConverger).toBeLessThan(100000)
  })

  it('converge exactamente al objetivo cuando ya está a un paso de distancia', () => {
    const state = createAimMotorState(0.1, 0)
    stepAimTowards(state, 0.1 + 1e-10, 0, 10, 1 / 128)
    expect(state.yaw).toBeCloseTo(0.1 + 1e-10, 8)
  })

  it('gira por el camino más corto cruzando el corte de +-PI', () => {
    const state = createAimMotorState(Math.PI - 0.01, 0)
    // Objetivo cruzando el corte: -(PI-0.01), a sólo 0.02 rad de distancia
    // por el camino corto, casi 2*PI por el largo.
    stepAimTowards(state, -(Math.PI - 0.01), 0, 100, 1 / 128)
    // Con velocidad angular de sobra, converge -- si tomara el camino largo
    // no convergería en un tick con esta velocidad.
    const wrapped = ((state.yaw + Math.PI) % (Math.PI * 2)) - Math.PI
    expect(Math.abs(wrapped - -(Math.PI - 0.01))).toBeLessThan(1e-6)
  })

  it('clampea el pitch resultante a PITCH_LIMIT, igual que la cámara del jugador', () => {
    const state = createAimMotorState(0, 0)
    stepAimTowards(state, 0, Math.PI, 1000, 1)
    expect(state.pitch).toBeLessThanOrEqual(PITCH_LIMIT + 1e-9)
  })

  it('velocidad angular más alta converge en menos ticks (monotonía de la garantía)', () => {
    function ticksParaConverger(maxSpeed: number): number {
      const state = createAimMotorState(0, 0)
      const dt = 1 / 128
      let ticks = 0
      for (let i = 0; i < 200000; i++) {
        stepAimTowards(state, 2.0, 0, maxSpeed, dt)
        ticks++
        if (Math.abs(state.yaw - 2.0) < 1e-6) break
      }
      return ticks
    }
    expect(ticksParaConverger(0.5)).toBeGreaterThan(ticksParaConverger(5))
  })
})

describe('lookAt: convención de ejes', () => {
  it('mirando hacia -Z da yaw=0, pitch=0 (misma convención que combat/shot.ts)', () => {
    const out: YawPitch = { yaw: 0, pitch: 0 }
    lookAt(0, 0, 0, 0, 0, -10, out)
    expect(out.yaw).toBeCloseTo(0, 10)
    expect(out.pitch).toBeCloseTo(0, 10)
  })

  it('mirando hacia +X da yaw=-PI/2 (misma convención que computeForward: yaw=-PI/2 apunta a +X)', () => {
    const out: YawPitch = { yaw: 0, pitch: 0 }
    lookAt(0, 0, 0, 10, 0, 0, out)
    expect(out.yaw).toBeCloseTo(-Math.PI / 2, 10)
  })

  it('mirando hacia arriba da pitch positivo', () => {
    const out: YawPitch = { yaw: 0, pitch: 0 }
    lookAt(0, 0, 0, 0, 10, -10, out)
    expect(out.pitch).toBeGreaterThan(0)
  })
})

describe('cono de error: se cierra monótonamente durante el tiempo de reacción', () => {
  it('arranca en errorConeRad completo en t=0', () => {
    expect(currentErrorConeRadius(0.1, 0.4, 0)).toBeCloseTo(0.1, 10)
  })

  it('llega a 0 en t=reactionTimeS', () => {
    expect(currentErrorConeRadius(0.1, 0.4, 0.4)).toBeCloseTo(0, 10)
  })

  it('se queda en 0 más allá de reactionTimeS (no rebota)', () => {
    expect(currentErrorConeRadius(0.1, 0.4, 10)).toBe(0)
  })

  it('es monótona no creciente en el tiempo', () => {
    const errorConeRad = 0.1
    const reactionTimeS = 0.4
    let previous = currentErrorConeRadius(errorConeRad, reactionTimeS, 0)
    for (let t = 0.01; t <= reactionTimeS; t += 0.01) {
      const current = currentErrorConeRadius(errorConeRad, reactionTimeS, t)
      expect(current).toBeLessThanOrEqual(previous + 1e-12)
      previous = current
    }
  })

  it('nunca es negativo ni supera errorConeRad', () => {
    for (let t = -1; t <= 2; t += 0.05) {
      const r = currentErrorConeRadius(0.1, 0.4, t)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(0.1 + 1e-12)
    }
  })
})

describe('sampleErrorOffset: disco de error determinista', () => {
  it('nunca produce un offset de magnitud mayor al radio pedido', () => {
    const state = createAimBrainState(12345)
    const out: YawPitch = { yaw: 0, pitch: 0 }
    for (let i = 0; i < 5000; i++) {
      sampleErrorOffset(state, 0.05, out)
      expect(Math.hypot(out.yaw, out.pitch)).toBeLessThanOrEqual(0.05 + 1e-12)
    }
  })

  it('con radio 0 siempre da offset (0,0)', () => {
    const state = createAimBrainState(999)
    const out: YawPitch = { yaw: 1, pitch: 1 }
    sampleErrorOffset(state, 0, out)
    // toBeCloseTo (no toBe): con radio 0 el resultado puede caer en -0
    // (cos(angle)*0), matemáticamente igual a 0 pero distinto bit a bit.
    expect(out.yaw).toBeCloseTo(0, 10)
    expect(out.pitch).toBeCloseTo(0, 10)
  })

  it('es determinista: misma seed produce la misma secuencia de offsets', () => {
    const a = createAimBrainState(42)
    const b = createAimBrainState(42)
    const outA: YawPitch = { yaw: 0, pitch: 0 }
    const outB: YawPitch = { yaw: 0, pitch: 0 }
    for (let i = 0; i < 20; i++) {
      sampleErrorOffset(a, 0.1, outA)
      sampleErrorOffset(b, 0.1, outB)
      expect(outA).toEqual(outB)
    }
  })
})

describe('el apuntado nunca llega al objetivo más rápido de lo que la dificultad permite', () => {
  it('con reactionTimeS=0.4 y errorConeRad=6°, el ángulo entre la mira y el objetivo real sigue pudiendo ser grande a los 100ms', () => {
    // No es una garantía de que el offset SEA grande (es aleatorio, puede
    // salir chico) -- es una garantía de que la COTA (el cono) sigue abierta:
    // a 100ms de 400ms de reacción, el cono todavía cerró sólo 1/4.
    const errorConeRad = (6.0 * Math.PI) / 180
    const reactionTimeS = 0.4
    const radius = currentErrorConeRadius(errorConeRad, reactionTimeS, 0.1)
    expect(radius).toBeCloseTo(errorConeRad * 0.75, 6)
    expect(radius).toBeGreaterThan(0)
  })

  it('el motor de apuntado tarda más de un tick en cerrar una distancia grande incluso con el máximo de dificultad más alta', () => {
    const state = createAimMotorState(0, 0)
    // Radiante: 600°/seg de velocidad angular (bots/tuning.ts), a 128Hz.
    const maxSpeedRad = (600 * Math.PI) / 180
    const dt = 1 / 128
    stepAimTowards(state, Math.PI, 0, maxSpeedRad, dt)
    // Un giro de 180° a 600°/s tarda 0.3s = 38.4 ticks a 128Hz: un solo tick
    // no alcanza a cubrir ni el 5% del camino.
    expect(Math.abs(state.yaw)).toBeLessThan(Math.PI * 0.05)
  })
})
