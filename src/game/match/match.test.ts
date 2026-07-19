import { describe, expect, it } from 'vitest'
import {
  buildSummary,
  createMatchState,
  isMatchOver,
  recordDamage,
  recordKill,
  stepMatch,
  type MatchState,
} from '@/game/match/match'
import type { MatchTuning } from '@/game/match/tuning'
import { PLAYER_ID } from '@/game/match/types'

const TUNING: MatchTuning = {
  defaultMode: 'ffa',
  botCount: 4,
  difficultyMode: 'uniform',
  uniformDifficultyRank: 0.5,
  mixedDifficultyRanks: [0.5],
  respawnDelayS: 3,
  respawnInvulnerabilityS: 1.5,
  scoreLimitFfa: 5,
  scoreLimitTdm: 8,
  timeLimitS: 60,
  killfeedMaxEntries: 5,
  killfeedEntryLifetimeS: 6,
}

describe('creación de estado de partida', () => {
  it('arranca en live, reloj lleno, sin kills', () => {
    const state = createMatchState('ffa', 5, TUNING)
    expect(state.phase).toBe('live')
    expect(state.timeRemainingS).toBe(60)
    expect(state.participants).toHaveLength(5)
    for (const p of state.participants) expect(p.kills).toBe(0)
  })
})

describe('flujo de partida y transiciones', () => {
  it('stepMatch resta el reloj y termina la partida cuando llega a 0', () => {
    const state = createMatchState('ffa', 3, TUNING)
    stepMatch(state, 59, TUNING)
    expect(state.phase).toBe('live')
    expect(state.timeRemainingS).toBeCloseTo(1)

    stepMatch(state, 2, TUNING)
    expect(state.phase).toBe('ended')
    expect(state.timeRemainingS).toBe(0)
  })

  it('recordKill suma puntaje y termina la partida al llegar al límite de kills (ffa)', () => {
    const state = createMatchState('ffa', 3, TUNING)
    for (let i = 0; i < TUNING.scoreLimitFfa - 1; i++) {
      recordKill(state, PLAYER_ID, 1, 'ar-1', false)
      stepMatch(state, 1, TUNING)
    }
    expect(state.phase).toBe('live')

    recordKill(state, PLAYER_ID, 1, 'ar-1', false)
    stepMatch(state, 1, TUNING)
    expect(state.phase).toBe('ended')
    expect(state.participants[PLAYER_ID].kills).toBe(TUNING.scoreLimitFfa)
  })

  it('tdm: termina cuando UN equipo llega a scoreLimitTdm (suma de kills del equipo)', () => {
    const state = createMatchState('tdm', 4, TUNING)
    // ids 0 y 2 caen en el equipo 0 (paridad par); reparte los kills entre
    // ambos para probar que se SUMAN a nivel de equipo, no por individuo.
    for (let i = 0; i < TUNING.scoreLimitTdm; i++) {
      const killer = i % 2 === 0 ? 0 : 2
      recordKill(state, killer, 1, 'ar-1', false)
      stepMatch(state, 0.5, TUNING)
    }
    expect(state.phase).toBe('ended')
  })

  it('una vez ended, stepMatch/recordKill/recordDamage son no-ops (el estado no revive)', () => {
    const state = createMatchState('ffa', 3, TUNING)
    stepMatch(state, 1000, TUNING) // agota el reloj de un golpe
    expect(state.phase).toBe('ended')

    const frozenKills = state.participants[0].kills
    const frozenTime = state.timeRemainingS

    recordKill(state, 0, 1, 'ar-1', false)
    recordDamage(state, 0, 50)
    stepMatch(state, 5, TUNING)

    expect(state.phase).toBe('ended')
    expect(state.participants[0].kills).toBe(frozenKills)
    expect(state.timeRemainingS).toBe(frozenTime)
  })

  it('isMatchOver no muta el estado (es pura)', () => {
    const state = createMatchState('ffa', 3, TUNING)
    const before = JSON.stringify(state.participants)
    isMatchOver(state, TUNING)
    expect(JSON.stringify(state.participants)).toBe(before)
    expect(state.phase).toBe('live')
  })
})

describe('garantía de terminación', () => {
  it('con un límite de puntaje inalcanzable, el reloj igual cierra la partida', () => {
    // scoreLimitFfa/Tdm absurdamente altos: la única vía de cierre posible
    // es el reloj. Si stepMatch no lo garantizara, este bucle nunca saldría
    // (el propio test se colgaría, no sólo fallaría una aserción).
    const highLimitTuning: MatchTuning = { ...TUNING, scoreLimitFfa: 1_000_000, scoreLimitTdm: 1_000_000 }
    const state = createMatchState('ffa', 6, highLimitTuning)
    let steps = 0
    const maxSteps = 10_000
    while (state.phase === 'live' && steps < maxSteps) {
      recordKill(state, (steps % 5) + 1, 0, 'ar-1', false)
      stepMatch(state, 0.1, highLimitTuning)
      steps++
    }
    expect(state.phase).toBe('ended')
    expect(steps).toBeLessThan(maxSteps)
    expect(state.timeRemainingS).toBe(0)
  })

  it('fuzz: cualquier secuencia aleatoria de kills/daño/steps termina en un número acotado de pasos', () => {
    let seed = 12345
    function rand(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }

    for (let trial = 0; trial < 20; trial++) {
      const state: MatchState = createMatchState(rand() < 0.5 ? 'ffa' : 'tdm', 6, TUNING)
      let steps = 0
      const maxSteps = 5000
      while (state.phase === 'live' && steps < maxSteps) {
        if (rand() < 0.3) {
          const killer = Math.floor(rand() * 6)
          const victim = Math.floor(rand() * 6)
          recordKill(state, killer, victim, 'ar-1', rand() < 0.2)
        }
        if (rand() < 0.3) recordDamage(state, Math.floor(rand() * 6), rand() * 40)
        stepMatch(state, rand() * 0.5, TUNING)
        steps++
      }
      expect(state.phase).toBe('ended')
      expect(steps).toBeLessThan(maxSteps)
    }
  })
})

describe('resumen post-partida', () => {
  it('duración = tiempo límite - tiempo restante', () => {
    const state = createMatchState('ffa', 3, TUNING)
    stepMatch(state, 20, TUNING)
    const summary = buildSummary(state, TUNING)
    expect(summary.durationS).toBeCloseTo(20)
  })

  it('standings viene ordenado por kills descendente', () => {
    const state = createMatchState('ffa', 3, TUNING)
    recordKill(state, 2, 0, 'ar-1', false)
    recordKill(state, 2, 0, 'ar-1', false)
    recordKill(state, 1, 0, 'ar-1', false)
    const summary = buildSummary(state, TUNING)
    expect(summary.standings.map((p) => p.id)).toEqual([2, 1, 0])
  })

  it('ffa: declara ganador al participante con más kills', () => {
    const state = createMatchState('ffa', 3, TUNING)
    recordKill(state, PLAYER_ID, 1, 'ar-1', false)
    recordKill(state, PLAYER_ID, 1, 'ar-1', false)
    const summary = buildSummary(state, TUNING)
    expect(summary.winnerLabel).toBe('jugador')
  })

  it('tdm: declara ganador al equipo con más kills sumados', () => {
    const state = createMatchState('tdm', 4, TUNING)
    recordKill(state, 0, 1, 'ar-1', false) // equipo 0
    recordKill(state, 2, 1, 'ar-1', false) // equipo 0
    recordKill(state, 1, 0, 'ar-1', false) // equipo 1
    const summary = buildSummary(state, TUNING)
    expect(summary.winnerLabel).toBe('equipo del jugador')
  })

  it('empate se reporta explícitamente, no un ganador arbitrario', () => {
    const state = createMatchState('tdm', 4, TUNING)
    recordKill(state, 0, 1, 'ar-1', false)
    recordKill(state, 1, 0, 'ar-1', false)
    const summary = buildSummary(state, TUNING)
    expect(summary.winnerLabel).toBe('empate')
  })
})
