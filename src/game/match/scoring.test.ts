import { describe, expect, it } from 'vitest'
import {
  addDamage,
  addKill,
  createParticipantStats,
  leadingKills,
  sortedByKills,
  teamScore,
} from '@/game/match/scoring'

describe('puntaje de participantes', () => {
  it('createParticipantStats arranca en cero', () => {
    const s = createParticipantStats(3)
    expect(s).toEqual({ id: 3, kills: 0, deaths: 0, damageDealt: 0 })
  })

  it('addKill suma un kill al asesino y una muerte a la víctima, nada más', () => {
    const killer = createParticipantStats(0)
    const victim = createParticipantStats(1)
    addKill(killer, victim)
    expect(killer).toMatchObject({ kills: 1, deaths: 0 })
    expect(victim).toMatchObject({ kills: 0, deaths: 1 })
  })

  it('addDamage acumula, e ignora valores no positivos o no finitos', () => {
    const s = createParticipantStats(0)
    addDamage(s, 24)
    addDamage(s, 43.2)
    addDamage(s, -10)
    addDamage(s, 0)
    addDamage(s, NaN)
    addDamage(s, Infinity)
    expect(s.damageDealt).toBeCloseTo(67.2)
  })

  it('teamScore (tdm) suma los kills de todos los participantes del mismo equipo (paridad de id)', () => {
    const participants = [
      { id: 0, kills: 3, deaths: 0, damageDealt: 0 }, // equipo 0
      { id: 1, kills: 2, deaths: 0, damageDealt: 0 }, // equipo 1
      { id: 2, kills: 1, deaths: 0, damageDealt: 0 }, // equipo 0
      { id: 3, kills: 5, deaths: 0, damageDealt: 0 }, // equipo 1
    ]
    expect(teamScore('tdm', participants, 0)).toBe(4) // 3 + 1
    expect(teamScore('tdm', participants, 1)).toBe(7) // 2 + 5
  })

  it('teamScore (ffa) degenera a los kills de un único participante (cada uno es su propio equipo)', () => {
    const participants = [
      { id: 0, kills: 3, deaths: 0, damageDealt: 0 },
      { id: 1, kills: 9, deaths: 0, damageDealt: 0 },
    ]
    expect(teamScore('ffa', participants, 0)).toBe(3)
    expect(teamScore('ffa', participants, 1)).toBe(9)
  })

  it('leadingKills devuelve el máximo de kills, 0 si la lista está vacía', () => {
    expect(leadingKills([])).toBe(0)
    expect(
      leadingKills([
        { id: 0, kills: 2, deaths: 0, damageDealt: 0 },
        { id: 1, kills: 9, deaths: 0, damageDealt: 0 },
        { id: 2, kills: 5, deaths: 0, damageDealt: 0 },
      ]),
    ).toBe(9)
  })

  it('sortedByKills ordena descendente por kills, desempata por menos muertes y luego por id', () => {
    const participants = [
      { id: 2, kills: 5, deaths: 3, damageDealt: 0 },
      { id: 0, kills: 5, deaths: 1, damageDealt: 0 },
      { id: 1, kills: 9, deaths: 0, damageDealt: 0 },
      { id: 3, kills: 5, deaths: 1, damageDealt: 0 },
    ]
    const sorted = sortedByKills(participants)
    expect(sorted.map((p) => p.id)).toEqual([1, 0, 3, 2])
  })

  it('sortedByKills no muta el array original', () => {
    const participants = [
      { id: 0, kills: 1, deaths: 0, damageDealt: 0 },
      { id: 1, kills: 9, deaths: 0, damageDealt: 0 },
    ]
    const copy = [...participants]
    sortedByKills(participants)
    expect(participants).toEqual(copy)
  })
})
