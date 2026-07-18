import { describe, expect, it } from 'vitest'
import { applyLook, clampPitch, PITCH_LIMIT } from '@/game/engine/input'

describe('acumulación de mirada', () => {
  it('clampPitch limita mirar hacia arriba', () => {
    expect(clampPitch(10)).toBeCloseTo(PITCH_LIMIT, 6)
  })

  it('clampPitch limita mirar hacia abajo', () => {
    expect(clampPitch(-10)).toBeCloseTo(-PITCH_LIMIT, 6)
  })

  it('clampPitch nunca deja dar la vuelta completa', () => {
    expect(Math.abs(clampPitch(100))).toBeLessThan(Math.PI / 2)
  })

  it('applyLook acumula yaw negativo al mover el mouse a la derecha', () => {
    const r = applyLook(0, 0, 100, 0, 0.002)
    expect(r.yaw).toBeCloseTo(-0.2, 6)
  })

  it('applyLook invierte el pitch para que mover el mouse arriba mire arriba', () => {
    const r = applyLook(0, 0, 0, -100, 0.002)
    expect(r.pitch).toBeGreaterThan(0)
  })

  it('applyLook respeta la sensibilidad', () => {
    const lento = applyLook(0, 0, 100, 0, 0.001).yaw
    const rapido = applyLook(0, 0, 100, 0, 0.004).yaw
    expect(Math.abs(rapido)).toBeGreaterThan(Math.abs(lento))
  })
})
