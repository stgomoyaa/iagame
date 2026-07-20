import { describe, expect, it } from 'vitest'
import {
  DIFICIL,
  DIFFICULTY_HIGHEST,
  DIFFICULTY_LOWEST,
  EXPERTO,
  FACIL,
  NORMAL,
  TRAMOS,
  interpolateDifficulty,
} from '@/game/bots/difficulty'

describe('interpolación de dificultad por tramos', () => {
  it('rank=0 da exactamente Fácil, bit a bit', () => {
    const d = interpolateDifficulty(0)
    expect(d).toEqual(FACIL)
    expect(d).toEqual(DIFFICULTY_LOWEST)
  })

  it('rank=1 da exactamente Experto, bit a bit', () => {
    const d = interpolateDifficulty(1)
    expect(d).toEqual(EXPERTO)
    expect(d).toEqual(DIFFICULTY_HIGHEST)
  })

  it('los rank que caen sobre un tramo dan ese tramo exacto', () => {
    // Cuatro tramos => postes en 0, 1/3, 2/3, 1.
    expect(interpolateDifficulty(1 / 3)).toEqual(NORMAL)
    expect(interpolateDifficulty(2 / 3)).toEqual(DIFICIL)
  })

  it('interpola ENTRE tramos vecinos, no entre los extremos', () => {
    // Un punto entre Normal (1/3) y Difícil (2/3) tiene que quedar entre
    // ESOS dos, no entre Fácil y Experto. A mitad de ese tramo:
    const d = interpolateDifficulty(0.5)
    expect(d.reactionTimeS).toBeCloseTo((NORMAL.reactionTimeS + DIFICIL.reactionTimeS) / 2, 10)
    expect(d.errorConeRad).toBeCloseTo((NORMAL.errorConeRad + DIFICIL.errorConeRad) / 2, 10)
    // Y NO al promedio de los extremos, que sería otro número.
    const promedioExtremos = (FACIL.reactionTimeS + EXPERTO.reactionTimeS) / 2
    expect(d.reactionTimeS).not.toBeCloseTo(promedioExtremos, 4)
  })

  it('es monótona: más rank mejora cada palanca en su dirección "mejor"', () => {
    const samples = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]
    for (let i = 1; i < samples.length; i++) {
      const prev = interpolateDifficulty(samples[i - 1])
      const curr = interpolateDifficulty(samples[i])
      // Reacción, demora de ataque, cono inicial y cono residual BAJAN con
      // más rank; velocidad de mira, agresividad, control de retroceso y
      // calidad de reposicionamiento SUBEN. Todas en la dirección "mejor".
      expect(curr.reactionTimeS).toBeLessThanOrEqual(prev.reactionTimeS)
      expect(curr.attackDelayS).toBeLessThanOrEqual(prev.attackDelayS)
      expect(curr.errorConeRad).toBeLessThanOrEqual(prev.errorConeRad)
      expect(curr.aimSteadyRad).toBeLessThanOrEqual(prev.aimSteadyRad)
      expect(curr.aimSpeedDegPerSec).toBeGreaterThanOrEqual(prev.aimSpeedDegPerSec)
      expect(curr.aggression).toBeGreaterThanOrEqual(prev.aggression)
      expect(curr.recoilControl).toBeGreaterThanOrEqual(prev.recoilControl)
      expect(curr.repositionQuality).toBeGreaterThanOrEqual(prev.repositionQuality)
    }
  })

  it('el residual de puntería nunca supera al cono inicial, en ningún tramo', () => {
    // Si el residual fuera mayor que el cono de adquisición, el error
    // CRECERÍA con el tiempo en vez de asentarse -- lo contrario de reaccionar.
    for (const t of TRAMOS) {
      expect(t.aimSteadyRad).toBeLessThanOrEqual(t.errorConeRad)
    }
  })

  it('ni el tramo experto clava el láser: su residual es > 0', () => {
    // Un rival que no falla NUNCA se lee como tramposo, no como bueno.
    expect(EXPERTO.aimSteadyRad).toBeGreaterThan(0)
    // Y ninguno anula el retroceso por completo.
    expect(EXPERTO.recoilControl).toBeLessThan(1)
  })

  it('clampea rank fuera de [0,1] a los extremos exactos, sin extrapolar', () => {
    expect(interpolateDifficulty(-5)).toEqual(interpolateDifficulty(0))
    expect(interpolateDifficulty(5)).toEqual(interpolateDifficulty(1))
  })
})
