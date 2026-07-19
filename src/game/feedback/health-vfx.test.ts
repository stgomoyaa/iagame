import { describe, expect, it } from 'vitest'
import {
  applyDamageToPlayer,
  createPlayerHealthState,
  desaturationAmount,
  heartbeatBpm,
  heartbeatPulse,
  resetPlayerHealth,
} from '@/game/feedback/health-vfx'
import { FEEDBACK } from '@/game/feedback/tuning'

describe('estado de vida mínimo', () => {
  it('arranca en startingHealth', () => {
    const state = createPlayerHealthState()
    expect(state.health).toBe(FEEDBACK.startingHealth)
  })

  it('applyDamageToPlayer resta y nunca baja de 0', () => {
    const state = createPlayerHealthState()
    applyDamageToPlayer(state, 1000)
    expect(state.health).toBe(0)
  })

  it('resetPlayerHealth vuelve a startingHealth', () => {
    const state = createPlayerHealthState()
    applyDamageToPlayer(state, 50)
    resetPlayerHealth(state)
    expect(state.health).toBe(FEEDBACK.startingHealth)
  })
})

describe('desaturationAmount', () => {
  it('0 en o sobre el umbral', () => {
    expect(desaturationAmount(FEEDBACK.lowHealthThreshold)).toBe(0)
    expect(desaturationAmount(100)).toBe(0)
  })

  it('sube hasta desaturationMax a vida 0', () => {
    expect(desaturationAmount(0)).toBeCloseTo(FEEDBACK.desaturationMax, 9)
  })

  it('es monótona no creciente en la vida (más vida, menos desaturación)', () => {
    let prev = desaturationAmount(0)
    for (let h = 1; h <= FEEDBACK.lowHealthThreshold; h++) {
      const cur = desaturationAmount(h)
      expect(cur).toBeLessThanOrEqual(prev + 1e-9)
      prev = cur
    }
  })
})

describe('heartbeatBpm', () => {
  it('0 en o sobre el umbral: sin latido con vida sana', () => {
    expect(heartbeatBpm(FEEDBACK.lowHealthThreshold)).toBe(0)
    expect(heartbeatBpm(100)).toBe(0)
  })

  it('sube a medida que la vida baja', () => {
    expect(heartbeatBpm(5)).toBeGreaterThan(heartbeatBpm(25))
  })

  it('llega a heartbeatBpmAtZero exactamente a vida 0', () => {
    expect(heartbeatBpm(0)).toBeCloseTo(FEEDBACK.heartbeatBpmAtZero, 9)
  })
})

describe('heartbeatPulse', () => {
  it('constante en 0 con vida sana (sin latido que pulsar)', () => {
    expect(heartbeatPulse(100, 0)).toBe(0)
    expect(heartbeatPulse(100, 5)).toBe(0)
  })

  it('oscila entre 0 y 1 bajo el umbral', () => {
    for (let t = 0; t < 2; t += 0.05) {
      const p = heartbeatPulse(10, t)
      expect(p).toBeGreaterThanOrEqual(-1e-9)
      expect(p).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('es periódico en el bpm que da heartbeatBpm', () => {
    const health = 10
    const bpm = heartbeatBpm(health)
    const periodo = 60 / bpm
    expect(heartbeatPulse(health, 1.3)).toBeCloseTo(heartbeatPulse(health, 1.3 + periodo), 6)
  })
})
