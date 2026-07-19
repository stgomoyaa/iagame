import { describe, expect, it } from 'vitest'
import {
  addDamage,
  addKill,
  createParticipantStats,
  leadingKills,
  sortedByKills,
  teamScore,
} from '@/game/match/scoring'
import type { ParticipantStats } from '@/game/match/scoring'

/** Puntaje armado a mano para los tests de agregación, que sólo miran
 *  kills/muertes. Headshots y rachas quedan en cero: no participan de
 *  teamScore ni de sortedByKills. */
function stats(id: number, kills: number, deaths: number, damageDealt: number): ParticipantStats {
  return { id, kills, deaths, damageDealt, headshots: 0, streak: 0, bestStreak: 0 }
}

describe('puntaje de participantes', () => {
  it('createParticipantStats arranca en cero', () => {
    const s = createParticipantStats(3)
    expect(s).toEqual({
      id: 3,
      kills: 0,
      deaths: 0,
      damageDealt: 0,
      headshots: 0,
      streak: 0,
      bestStreak: 0,
    })
  })

  it('addKill suma un kill al asesino y una muerte a la víctima, nada más', () => {
    const killer = createParticipantStats(0)
    const victim = createParticipantStats(1)
    addKill(killer, victim)
    expect(killer).toMatchObject({ kills: 1, deaths: 0 })
    expect(victim).toMatchObject({ kills: 0, deaths: 1 })
  })

  it('addKill cuenta el headshot solo cuando lo hubo', () => {
    const killer = createParticipantStats(0)
    const victim = createParticipantStats(1)
    addKill(killer, victim, true)
    addKill(killer, victim, false)
    expect(killer.kills).toBe(2)
    expect(killer.headshots).toBe(1)
    expect(victim.headshots).toBe(0)
  })

  it('la racha encadena kills y se corta al morir', () => {
    const a = createParticipantStats(0)
    const b = createParticipantStats(1)
    addKill(a, b)
    addKill(a, b)
    addKill(a, b)
    expect(a.streak).toBe(3)
    expect(a.bestStreak).toBe(3)

    // Ahora muere: la racha actual se corta, la mejor queda.
    addKill(b, a)
    expect(a.streak).toBe(0)
    expect(a.bestStreak).toBe(3)
    expect(b.streak).toBe(1)
  })

  it('bestStreak se queda con la racha mas larga, no con la ultima', () => {
    const a = createParticipantStats(0)
    const b = createParticipantStats(1)
    for (let i = 0; i < 5; i++) addKill(a, b)
    addKill(b, a)
    addKill(a, b)
    expect(a.streak).toBe(1)
    expect(a.bestStreak).toBe(5)
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
      stats(0, 3, 0, 0), // equipo 0
      stats(1, 2, 0, 0), // equipo 1
      stats(2, 1, 0, 0), // equipo 0
      stats(3, 5, 0, 0), // equipo 1
    ]
    expect(teamScore('tdm', participants, 0)).toBe(4) // 3 + 1
    expect(teamScore('tdm', participants, 1)).toBe(7) // 2 + 5
  })

  it('teamScore (ffa) degenera a los kills de un único participante (cada uno es su propio equipo)', () => {
    const participants = [
      stats(0, 3, 0, 0),
      stats(1, 9, 0, 0),
    ]
    expect(teamScore('ffa', participants, 0)).toBe(3)
    expect(teamScore('ffa', participants, 1)).toBe(9)
  })

  it('leadingKills devuelve el máximo de kills, 0 si la lista está vacía', () => {
    expect(leadingKills([])).toBe(0)
    expect(
      leadingKills([
        stats(0, 2, 0, 0),
        stats(1, 9, 0, 0),
        stats(2, 5, 0, 0),
      ]),
    ).toBe(9)
  })

  it('sortedByKills ordena descendente por kills, desempata por menos muertes y luego por id', () => {
    const participants = [
      stats(2, 5, 3, 0),
      stats(0, 5, 1, 0),
      stats(1, 9, 0, 0),
      stats(3, 5, 1, 0),
    ]
    const sorted = sortedByKills(participants)
    expect(sorted.map((p) => p.id)).toEqual([1, 0, 3, 2])
  })

  it('sortedByKills no muta el array original', () => {
    const participants = [
      stats(0, 1, 0, 0),
      stats(1, 9, 0, 0),
    ]
    const copy = [...participants]
    sortedByKills(participants)
    expect(participants).toEqual(copy)
  })
})
