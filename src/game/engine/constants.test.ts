import { describe, expect, it } from 'vitest'
import { FRAME_BUDGET_MS, MAX_FRAME_DT, TICK_DT, TICK_HZ } from '@/game/engine/constants'

describe('constantes del motor', () => {
  it('el tick corre a 128Hz', () => {
    expect(TICK_HZ).toBe(128)
    expect(TICK_DT).toBeCloseTo(1 / 128, 10)
  })

  it('el guard de frame largo evita la espiral de la muerte', () => {
    expect(MAX_FRAME_DT).toBeGreaterThan(TICK_DT)
    expect(MAX_FRAME_DT).toBeLessThanOrEqual(0.25)
  })

  it('el presupuesto de frame es 2.5ms', () => {
    expect(FRAME_BUDGET_MS).toBe(2.5)
  })
})
