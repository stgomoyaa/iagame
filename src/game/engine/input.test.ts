import { describe, expect, it } from 'vitest'
import { applyPitch, applyYaw, clampPitch, PITCH_LIMIT } from '@/game/engine/input'

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

  it('applyYaw decrementa el yaw al mover el mouse a la derecha', () => {
    const yaw = applyYaw(0, 100, 0.002)
    expect(yaw).toBeCloseTo(-0.2, 6)
  })

  it('applyPitch incrementa el pitch al mover el mouse hacia arriba', () => {
    const pitch = applyPitch(0, -100, 0.002)
    expect(pitch).toBeGreaterThan(0)
  })

  it('applyYaw respeta la sensibilidad', () => {
    const lento = applyYaw(0, 100, 0.001)
    const rapido = applyYaw(0, 100, 0.004)
    expect(Math.abs(rapido)).toBeGreaterThan(Math.abs(lento))
  })

  it('applyPitch respeta la sensibilidad', () => {
    const lento = applyPitch(0, -100, 0.001)
    const rapido = applyPitch(0, -100, 0.004)
    expect(Math.abs(rapido)).toBeGreaterThan(Math.abs(lento))
  })

  it('applyPitch queda clampeado en ambos extremos', () => {
    expect(applyPitch(0, -100000, 0.002)).toBeCloseTo(PITCH_LIMIT, 6)
    expect(applyPitch(0, 100000, 0.002)).toBeCloseTo(-PITCH_LIMIT, 6)
  })

  it('dos llamadas independientes con sensibilidades distintas se pueden comparar entre sí', () => {
    const lento = applyYaw(0, 100, 0.001)
    const rapido = applyYaw(0, 100, 0.004)
    expect(lento).toBeCloseTo(-0.1, 6)
    expect(rapido).toBeCloseTo(-0.4, 6)
    expect(lento).not.toBe(rapido)
    expect(rapido).toBeLessThan(lento)
  })
})
