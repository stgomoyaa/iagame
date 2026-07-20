import { describe, expect, it } from 'vitest'
import {
  crearEntradaHistorial,
  headshotPct,
  HISTORIAL_MAX,
  pushHistorial,
  type MatchHistoryEntry,
} from '@/game/progression/history'
import type { MatchPerformance } from '@/game/progression/combat-score'
import { applyMatchResult, createDefaultCareer } from '@/game/progression/career'
import { createRankState } from '@/game/progression/rr'
import { PLACEMENT } from '@/game/progression/placement'
import { difficultyForRank } from '@/game/progression/ranks'

function perf(over: Partial<MatchPerformance> = {}): MatchPerformance {
  return {
    kills: 15,
    deaths: 10,
    damage: 3500,
    headshots: 6,
    bestStreak: 3,
    durationS: 360,
    win: true,
    ...over,
  }
}

function entrada(over: Partial<MatchHistoryEntry> = {}): MatchHistoryEntry {
  return {
    ...crearEntradaHistorial({
      partida: 1,
      perf: perf(),
      rrChange: 12,
      rank: 10,
      contexto: { ahora: 1000 },
    }),
    ...over,
  }
}

describe('entrada de historial', () => {
  it('copia la actuación y el contexto', () => {
    const e = crearEntradaHistorial({
      partida: 7,
      perf: perf({ kills: 21, deaths: 4, headshots: 9, damage: 6200.6, win: false }),
      rrChange: -8,
      rank: 12,
      contexto: { mapa: 'Arena', modo: 'tdm', ahora: 555 },
    })
    expect(e).toMatchObject({
      partida: 7, mapa: 'Arena', modo: 'tdm', fecha: 555,
      win: false, kills: 21, deaths: 4, headshots: 9, damage: 6201, rrChange: -8, rank: 12,
    })
  })

  it('sin contexto deja mapa y modo en null en vez de inventarlos', () => {
    const e = crearEntradaHistorial({ partida: 1, perf: perf(), rrChange: null, rank: null })
    expect(e.mapa).toBeNull()
    expect(e.modo).toBeNull()
  })

  // null y 0 significan cosas distintas y confundirlos haría que una
  // colocación se lea como "no te movió el RR".
  it('rrChange null (colocación) es distinto de 0 (no se movió)', () => {
    expect(crearEntradaHistorial({ partida: 1, perf: perf(), rrChange: null, rank: null }).rrChange).toBeNull()
    expect(crearEntradaHistorial({ partida: 1, perf: perf(), rrChange: 0, rank: 3 }).rrChange).toBe(0)
  })

  it('headshotPct redondea sobre bajas y no explota sin bajas', () => {
    expect(headshotPct(entrada({ kills: 10, headshots: 4 }))).toBe(40)
    expect(headshotPct(entrada({ kills: 0, headshots: 0 }))).toBe(0)
  })
})

describe('lista de historial', () => {
  it('la más reciente queda primera', () => {
    const lista = pushHistorial(pushHistorial([], entrada({ partida: 1 })), entrada({ partida: 2 }))
    expect(lista.map((e) => e.partida)).toEqual([2, 1])
  })

  it('se recorta al tope y descarta la más vieja', () => {
    let lista: MatchHistoryEntry[] = []
    for (let i = 1; i <= HISTORIAL_MAX + 5; i++) lista = pushHistorial(lista, entrada({ partida: i }))
    expect(lista).toHaveLength(HISTORIAL_MAX)
    expect(lista[0].partida).toBe(HISTORIAL_MAX + 5)
    expect(lista.some((e) => e.partida === 1)).toBe(false)
  })

  it('no muta la lista original', () => {
    const original = [entrada({ partida: 1 })]
    pushHistorial(original, entrada({ partida: 2 }))
    expect(original).toHaveLength(1)
  })
})

describe('integración con la carrera', () => {
  it('cada partida agrega una fila, también en colocaciones', () => {
    let data = createDefaultCareer()
    data = applyMatchResult(data, perf()).data
    expect(data.historial).toHaveLength(1)
    // En colocaciones no hay RR, y la fila lo dice con null.
    expect(data.historial[0].rrChange).toBeNull()
    expect(data.historial[0].partida).toBe(1)
  })

  it('ya colocado, la fila guarda el cambio real de RR', () => {
    const colocado = {
      ...createDefaultCareer(),
      rank: createRankState(10, 50),
      placement: { played: PLACEMENT.partidas, skill: difficultyForRank(10) },
    }
    const r = applyMatchResult(colocado, perf({ win: true }))
    expect(r.data.historial[0].rrChange).toBe(r.progress.rr?.change)
    expect(r.data.historial[0].rrChange).not.toBeNull()
  })

})
