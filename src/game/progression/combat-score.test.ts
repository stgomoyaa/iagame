import { describe, expect, it } from 'vitest'
import {
  combatDelta,
  combatScore,
  expectedCombatScore,
  type MatchPerformance,
} from '@/game/progression/combat-score'

function perf(over: Partial<MatchPerformance> = {}): MatchPerformance {
  return {
    kills: 15,
    deaths: 15,
    damage: 3500,
    headshots: 4,
    bestStreak: 3,
    durationS: 360,
    win: true,
    ...over,
  }
}

describe('combatScore', () => {
  it('sube con los kills y baja con las muertes', () => {
    expect(combatScore(perf({ kills: 25 }))).toBeGreaterThan(combatScore(perf()))
    expect(combatScore(perf({ deaths: 25 }))).toBeLessThan(combatScore(perf()))
  })

  it('sube con el dano, con los headshots y con la racha', () => {
    expect(combatScore(perf({ damage: 6000 }))).toBeGreaterThan(combatScore(perf()))
    expect(combatScore(perf({ headshots: 12 }))).toBeGreaterThan(combatScore(perf()))
    expect(combatScore(perf({ bestStreak: 8 }))).toBeGreaterThan(combatScore(perf()))
  })

  it('no depende del resultado: el puntaje mide como jugaste, no si ganaste', () => {
    expect(combatScore(perf({ win: true }))).toBe(combatScore(perf({ win: false })))
  })

  // La normalización por minuto es lo que hace comparables una partida de 6
  // minutos y una cortada por límite de kills.
  it('normaliza por minuto: el doble de todo en el doble de tiempo puntua igual', () => {
    const corta = perf({ kills: 8, deaths: 8, damage: 1800, headshots: 2, durationS: 180 })
    const larga = perf({ kills: 16, deaths: 16, damage: 3600, headshots: 4, durationS: 360 })
    expect(combatScore(corta)).toBeCloseTo(combatScore(larga), 5)
  })

  it('una partida absurdamente corta no dispara el puntaje', () => {
    // Sin piso de duración, 1 kill en 2 segundos serían 30 kills/minuto.
    const relampago = perf({ kills: 1, deaths: 0, damage: 150, headshots: 1, durationS: 2 })
    expect(combatScore(relampago)).toBeLessThan(combatScore(perf({ kills: 40 })))
  })

  it('nunca es negativo', () => {
    expect(combatScore(perf({ kills: 0, deaths: 200, damage: 0, headshots: 0, bestStreak: 0 }))).toBe(0)
  })

  it('la tasa de headshots esta acotada aunque lleguen datos incoherentes', () => {
    const coherente = combatScore(perf({ kills: 10, headshots: 10 }))
    const imposible = combatScore(perf({ kills: 10, headshots: 40 }))
    expect(imposible).toBe(coherente)
  })

  it('sin kills no explota la division de la tasa de headshots', () => {
    expect(Number.isFinite(combatScore(perf({ kills: 0, headshots: 0 })))).toBe(true)
  })

  it('la racha tiene tope: una racha enorme no domina el puntaje', () => {
    expect(combatScore(perf({ bestStreak: 8 }))).toBe(combatScore(perf({ bestStreak: 500 })))
  })
})

describe('combatScore esperado', () => {
  // El punto de diseño central: como los bots escalan con el rango, la vara
  // NO puede subir fuerte con la dificultad o cada promoción se sentiría un
  // castigo. Ver el comentario de cabecera de combat-score.ts.
  it('es casi plano a lo largo de toda la escalera', () => {
    const hierro = expectedCombatScore(0)
    const radiante = expectedCombatScore(1)
    expect(Math.abs(radiante - hierro)).toBeLessThan(hierro * 0.15)
  })

  it('clampea la dificultad fuera de rango', () => {
    expect(expectedCombatScore(-2)).toBe(expectedCombatScore(0))
    expect(expectedCombatScore(9)).toBe(expectedCombatScore(1))
    expect(expectedCombatScore(Number.NaN)).toBe(expectedCombatScore(0))
  })

  it('el delta es el puntaje menos lo esperado', () => {
    const p = perf()
    expect(combatDelta(p, 0.5)).toBeCloseTo(combatScore(p) - expectedCombatScore(0.5), 6)
  })

  // La vara es la de tus PARES: en rangos altos los pares puntúan un poco
  // más (mejor puntería absoluta), así que repetir los mismos números
  // crudos allá arriba te deja algo más abajo respecto de ellos. Lo que
  // NO pasa es que promocionar te castigue: contra bots que escalan con
  // vos, tu propio puntaje sube junto con la vara y el delta queda en cero
  // (verificado en simulate.test.ts, no acá).
  it('la vara sube con la dificultad, asi que la misma actuacion cruda rinde menos arriba', () => {
    const p = perf()
    expect(combatDelta(p, 1)).toBeLessThan(combatDelta(p, 0))
  })
})
