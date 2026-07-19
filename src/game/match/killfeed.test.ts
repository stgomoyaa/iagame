import { describe, expect, it } from 'vitest'
import {
  createKillfeedState,
  listActiveKillsNewestFirst,
  pushKill,
  stepKillfeed,
} from '@/game/match/killfeed'

describe('killfeed', () => {
  it('arranca sin entradas activas', () => {
    const state = createKillfeedState(3)
    expect(listActiveKillsNewestFirst(state)).toHaveLength(0)
  })

  it('lista las entradas activas de más nueva a más vieja', () => {
    const state = createKillfeedState(5)
    pushKill(state, 0, 1, 'ar-1', false)
    pushKill(state, 2, 0, 'smg-1', true)
    pushKill(state, 1, 2, 'pistol', false)

    const activas = listActiveKillsNewestFirst(state)
    expect(activas.map((e) => e.weaponLabel)).toEqual(['pistol', 'smg-1', 'ar-1'])
  })

  it('evicción: al superar la capacidad, la entrada más vieja desaparece de la lista', () => {
    const state = createKillfeedState(2)
    pushKill(state, 0, 1, 'primera', false)
    pushKill(state, 0, 2, 'segunda', false)
    pushKill(state, 0, 3, 'tercera', false)

    const activas = listActiveKillsNewestFirst(state)
    expect(activas).toHaveLength(2)
    expect(activas.map((e) => e.weaponLabel)).toEqual(['tercera', 'segunda'])
  })

  it('una entrada se apaga sola al superar killfeedEntryLifetimeS y ya no aparece en la lista', () => {
    const state = createKillfeedState(3)
    pushKill(state, 0, 1, 'ar-1', false)

    stepKillfeed(state, 3)
    expect(listActiveKillsNewestFirst(state)).toHaveLength(1)

    stepKillfeed(state, 10) // pasa el umbral (MATCH.killfeedEntryLifetimeS)
    expect(listActiveKillsNewestFirst(state)).toHaveLength(0)
  })

  it('registra headshot y los ids de killer/víctima tal cual se pasaron', () => {
    const state = createKillfeedState(3)
    pushKill(state, 4, 7, 'sniper-bolt', true)
    const [entry] = listActiveKillsNewestFirst(state)
    expect(entry.killerId).toBe(4)
    expect(entry.victimId).toBe(7)
    expect(entry.headshot).toBe(true)
  })
})
