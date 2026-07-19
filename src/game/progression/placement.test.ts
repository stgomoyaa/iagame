import { describe, expect, it } from 'vitest'
import {
  applyPlacement,
  createPlacementState,
  enColocacion,
  PLACEMENT,
  placementDifficulty,
} from '@/game/progression/placement'
import type { MatchPerformance } from '@/game/progression/combat-score'
import { RANK_MAX, RANK_MIN } from '@/game/progression/ranks'

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

const DOMINANTE = perf({ kills: 45, deaths: 2, damage: 11_000, headshots: 25, bestStreak: 20, win: true })
const DESASTROSA = perf({ kills: 1, deaths: 30, damage: 300, headshots: 0, bestStreak: 0, win: false })

describe('colocaciones', () => {
  it('son 5, como pide el spec', () => {
    expect(PLACEMENT.partidas).toBe(5)
  })

  it('una cuenta nueva arranca en colocacion', () => {
    const s = createPlacementState()
    expect(s.played).toBe(0)
    expect(enColocacion(s)).toBe(true)
  })

  it('la quinta partida cierra la serie y siembra un rango', () => {
    let s = createPlacementState()
    for (let i = 0; i < 4; i++) {
      const r = applyPlacement(s, perf())
      expect(r.completed, `colocacion ${i + 1}`).toBe(false)
      expect(r.seededRank).toBeNull()
      s = r.state
    }
    const quinta = applyPlacement(s, perf())
    expect(quinta.completed).toBe(true)
    expect(quinta.seededRank).not.toBeNull()
    expect(enColocacion(quinta.state)).toBe(false)
  })

  // Lo que hace que 5 partidas informen: los bots de la siguiente se
  // calibran contra lo que mostraste en la anterior.
  it('la dificultad de la proxima colocacion sigue a la estimacion', () => {
    const inicial = createPlacementState()
    const subio = applyPlacement(inicial, DOMINANTE).state
    const bajo = applyPlacement(inicial, DESASTROSA).state
    expect(placementDifficulty(subio)).toBeGreaterThan(placementDifficulty(inicial))
    expect(placementDifficulty(bajo)).toBeLessThan(placementDifficulty(inicial))
  })

  it('cinco partidas dominantes siembran mucho mas alto que cinco desastrosas', () => {
    let bueno = createPlacementState()
    let malo = createPlacementState()
    let seedBueno: number | null = null
    let seedMalo: number | null = null
    for (let i = 0; i < PLACEMENT.partidas; i++) {
      const rb = applyPlacement(bueno, DOMINANTE)
      const rm = applyPlacement(malo, DESASTROSA)
      bueno = rb.state
      malo = rm.state
      seedBueno = rb.seededRank ?? seedBueno
      seedMalo = rm.seededRank ?? seedMalo
    }
    expect(seedBueno).not.toBeNull()
    expect(seedMalo).not.toBeNull()
    expect(seedBueno as number).toBeGreaterThan((seedMalo as number) + 10)
  })

  it('la estimacion nunca sale de 0..1 por mucho que se insista', () => {
    let s = createPlacementState()
    for (let i = 0; i < 50; i++) s = applyPlacement(s, DOMINANTE).state
    expect(s.skill).toBeLessThanOrEqual(1)
    expect(s.skill).toBeGreaterThanOrEqual(0)

    let t = createPlacementState()
    for (let i = 0; i < 50; i++) t = applyPlacement(t, DESASTROSA).state
    expect(t.skill).toBeGreaterThanOrEqual(0)
    expect(t.skill).toBeLessThanOrEqual(1)
  })

  it('el rango sembrado siempre cae dentro de la escalera', () => {
    for (const p of [DOMINANTE, DESASTROSA, perf()]) {
      let s = createPlacementState()
      let seeded: number | null = null
      for (let i = 0; i < PLACEMENT.partidas; i++) {
        const r = applyPlacement(s, p)
        s = r.state
        seeded = r.seededRank ?? seeded
      }
      expect(seeded as number).toBeGreaterThanOrEqual(RANK_MIN)
      expect(seeded as number).toBeLessThanOrEqual(RANK_MAX)
    }
  })

  it('no muta el estado que recibe', () => {
    const antes = createPlacementState()
    const copia = { ...antes }
    applyPlacement(antes, DOMINANTE)
    expect(antes).toEqual(copia)
  })

  it('el contador no pasa de 5 aunque se sigan aplicando partidas', () => {
    let s = createPlacementState()
    for (let i = 0; i < 20; i++) s = applyPlacement(s, perf()).state
    expect(s.played).toBe(PLACEMENT.partidas)
  })
})
