import { describe, expect, it } from 'vitest'
import {
  applyMatchResult,
  careerDifficulty,
  createDefaultCareer,
  estaColocando,
  type CareerData,
} from '@/game/progression/career'
import type { MatchPerformance } from '@/game/progression/combat-score'
import { difficultyForRank, RANK_MAX, RANK_MIN } from '@/game/progression/ranks'
import { createRankState, RR } from '@/game/progression/rr'
import { PLACEMENT } from '@/game/progression/placement'

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

function colocado(rank: number, rr = 50): CareerData {
  return { ...createDefaultCareer(), rank: createRankState(rank, rr), placement: { played: PLACEMENT.partidas, skill: difficultyForRank(rank) } }
}

describe('carrera', () => {
  it('una cuenta nueva arranca en colocaciones y sin rango', () => {
    const c = createDefaultCareer()
    expect(c.rank).toBeNull()
    expect(estaColocando(c)).toBe(true)
  })

  // El enganche que le da sentido a la escalera: el rango decide contra qué
  // pelea el jugador (sección 8 del spec).
  it('la dificultad de bots sale del rango una vez colocado', () => {
    expect(careerDifficulty(colocado(RANK_MIN))).toBe(0)
    expect(careerDifficulty(colocado(RANK_MAX))).toBe(1)
    expect(careerDifficulty(colocado(12))).toBeCloseTo(difficultyForRank(12), 6)
  })

  it('la dificultad crece de forma estricta con el rango', () => {
    for (let i = 1; i <= RANK_MAX; i++) {
      expect(careerDifficulty(colocado(i))).toBeGreaterThan(careerDifficulty(colocado(i - 1)))
    }
  })

  it('durante las colocaciones la dificultad sale de la estimacion, no de un rango', () => {
    const c = createDefaultCareer()
    expect(careerDifficulty(c)).toBeCloseTo(PLACEMENT.skillInicial, 6)
  })

  it('las colocaciones no mueven RR y la sexta partida si', () => {
    let data = createDefaultCareer()
    for (let i = 0; i < PLACEMENT.partidas; i++) {
      const r = applyMatchResult(data, perf())
      expect(r.progress.rr, `colocacion ${i + 1}`).toBeNull()
      expect(r.progress.placement).not.toBeNull()
      data = r.data
    }
    expect(data.rank).not.toBeNull()

    const rankeada = applyMatchResult(data, perf())
    expect(rankeada.progress.rr).not.toBeNull()
    expect(rankeada.progress.placement).toBeNull()
  })

  // XP y drop no distinguen colocación de partida rankeada: una colocación
  // es una partida como cualquier otra en todo lo que no sea el rango.
  it('toda partida da XP y suelta una skin, colocaciones incluidas', () => {
    let data = createDefaultCareer()
    for (let i = 0; i < 8; i++) {
      const antesXp = data.xp
      const antesSkins = data.skins.length
      const r = applyMatchResult(data, perf({ win: i % 2 === 0 }))
      expect(r.progress.xp.ganada, `partida ${i + 1}`).toBeGreaterThan(0)
      expect(r.data.xp).toBeGreaterThan(antesXp)
      expect(r.progress.drop.skin.seed).toBeTruthy()
      expect(r.data.skins.length).toBe(antesSkins + 1)
      data = r.data
    }
  })

  it('lleva la cuenta de partidas, victorias y derrotas', () => {
    let data = createDefaultCareer()
    for (let i = 0; i < 10; i++) data = applyMatchResult(data, perf({ win: i < 6 })).data
    expect(data.partidasJugadas).toBe(10)
    expect(data.victorias).toBe(6)
    expect(data.derrotas).toBe(4)
  })

  it('ganar sube RR y perder lo baja, ya colocado', () => {
    const base = colocado(12, 50)
    const gana = applyMatchResult(base, perf({ win: true }))
    const pierde = applyMatchResult(base, perf({ win: false }))
    expect(gana.progress.rr?.change ?? 0).toBeGreaterThan(0)
    expect(pierde.progress.rr?.change ?? 0).toBeLessThan(0)
  })

  it('no muta la carrera que recibe', () => {
    const antes = colocado(12, 50)
    const copia = JSON.parse(JSON.stringify(antes)) as CareerData
    applyMatchResult(antes, perf())
    expect(antes).toEqual(copia)
  })

  it('el ascenso se reporta para que la UI haga la ceremonia', () => {
    const alBorde = colocado(10, 95)
    const r = applyMatchResult(alBorde, perf({ kills: 40, deaths: 3, damage: 9000, headshots: 20, bestStreak: 15, win: true }))
    expect(r.progress.rr?.movement).toBe('ascenso')
    expect(r.data.rank?.rank).toBe(11)
  })

  it('el colchon evita que una sola derrota mala baje de rango', () => {
    const casiEnElPiso = colocado(10, 5)
    const r = applyMatchResult(casiEnElPiso, perf({ kills: 2, deaths: 28, damage: 400, headshots: 0, bestStreak: 0, win: false }))
    expect(r.progress.rr?.movement).toBe('ninguno')
    expect(r.data.rank?.rank).toBe(10)
    expect(r.data.rank?.rr).toBe(0)
    expect(r.data.rank?.cushion).toBeLessThan(RR.colchon)

    // La segunda seguida, ya desde el piso, sí desciende.
    const segunda = applyMatchResult(r.data, perf({ kills: 2, deaths: 28, damage: 400, headshots: 0, bestStreak: 0, win: false }))
    expect(segunda.progress.rr?.movement).toBe('descenso')
    expect(segunda.data.rank?.rank).toBe(9)
  })

  it('una carrera larga nunca deja el estado fuera de la escalera', () => {
    let data = createDefaultCareer()
    for (let i = 0; i < 500; i++) {
      data = applyMatchResult(data, perf({ kills: i % 30, deaths: (i * 7) % 25, win: i % 3 !== 0 })).data
      if (data.rank !== null) {
        expect(data.rank.rank).toBeGreaterThanOrEqual(RANK_MIN)
        expect(data.rank.rank).toBeLessThanOrEqual(RANK_MAX)
        expect(data.rank.rr).toBeGreaterThanOrEqual(0)
        expect(data.rank.rr).toBeLessThanOrEqual(100)
      }
    }
  })
})
