import { describe, expect, it } from 'vitest'
import {
  DIFFICULTY_HIGHEST,
  DIFFICULTY_LOWEST,
  interpolateDifficulty,
} from '@/game/bots/difficulty'

describe('interpolación de dificultad', () => {
  it('rank=0 da exactamente los valores de Hierro de la sección 8 del spec', () => {
    const d = interpolateDifficulty(0)
    expect(d.reactionTimeS).toBeCloseTo(0.4, 10)
    expect(d.errorConeRad).toBeCloseTo((6.0 * Math.PI) / 180, 10)
    expect(d.repositionQuality).toBeCloseTo(0.0, 10)
    expect(d).toEqual(DIFFICULTY_LOWEST)
  })

  it('rank=1 da exactamente los valores de Radiante de la sección 8 del spec', () => {
    const d = interpolateDifficulty(1)
    expect(d.reactionTimeS).toBeCloseTo(0.12, 10)
    expect(d.errorConeRad).toBeCloseTo((0.7 * Math.PI) / 180, 10)
    expect(d.repositionQuality).toBeCloseTo(1.0, 10)
    expect(d).toEqual(DIFFICULTY_HIGHEST)
  })

  it('rank=0.5 cae exactamente a mitad de camino entre los dos extremos', () => {
    const d = interpolateDifficulty(0.5)
    expect(d.reactionTimeS).toBeCloseTo((DIFFICULTY_LOWEST.reactionTimeS + DIFFICULTY_HIGHEST.reactionTimeS) / 2, 10)
    expect(d.errorConeRad).toBeCloseTo((DIFFICULTY_LOWEST.errorConeRad + DIFFICULTY_HIGHEST.errorConeRad) / 2, 10)
    expect(d.repositionQuality).toBeCloseTo(0.5, 10)
  })

  it('es monótona: más rank nunca empeora ninguno de los tres números', () => {
    const samples = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]
    for (let i = 1; i < samples.length; i++) {
      const prev = interpolateDifficulty(samples[i - 1])
      const curr = interpolateDifficulty(samples[i])
      // Tiempo de reacción y cono de error BAJAN con más rank; calidad de
      // reposicionamiento SUBE -- las tres en la misma dirección "mejor".
      expect(curr.reactionTimeS).toBeLessThanOrEqual(prev.reactionTimeS)
      expect(curr.errorConeRad).toBeLessThanOrEqual(prev.errorConeRad)
      expect(curr.repositionQuality).toBeGreaterThanOrEqual(prev.repositionQuality)
    }
  })

  it('clampea rank fuera de [0,1] a los extremos exactos, sin extrapolar', () => {
    expect(interpolateDifficulty(-5)).toEqual(interpolateDifficulty(0))
    expect(interpolateDifficulty(5)).toEqual(interpolateDifficulty(1))
  })

  it('nada más que estos tres campos determina la dificultad', () => {
    const d = interpolateDifficulty(0.3)
    expect(Object.keys(d).sort()).toEqual(['errorConeRad', 'reactionTimeS', 'repositionQuality'])
  })
})
