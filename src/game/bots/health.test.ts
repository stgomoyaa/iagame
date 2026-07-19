import { describe, expect, it } from 'vitest'
import { applyDamageToBot, createBotHealthState, healthFraction, stepBotRespawn } from '@/game/bots/health'

describe('vida y respawn de bots', () => {
  it('arranca viva, con vida llena', () => {
    const h = createBotHealthState(100)
    expect(h.alive).toBe(true)
    expect(h.health).toBe(100)
    expect(healthFraction(h)).toBe(1)
  })

  it('el daño resta vida sin matar si queda por encima de 0', () => {
    const h = createBotHealthState(100)
    const killed = applyDamageToBot(h, 30)
    expect(killed).toBe(false)
    expect(h.health).toBe(70)
    expect(h.alive).toBe(true)
  })

  it('el daño que iguala o supera la vida mata y clampea a 0 (nunca negativo)', () => {
    const h = createBotHealthState(100)
    const killed = applyDamageToBot(h, 150)
    expect(killed).toBe(true)
    expect(h.health).toBe(0)
    expect(h.alive).toBe(false)
  })

  it('un cadáver no puede volver a morir ni perder más vida', () => {
    const h = createBotHealthState(100)
    applyDamageToBot(h, 100)
    expect(h.alive).toBe(false)
    const killedOtraVez = applyDamageToBot(h, 50)
    expect(killedOtraVez).toBe(false)
    expect(h.health).toBe(0)
  })

  it('no revive antes de respawnDelayS', () => {
    const h = createBotHealthState(100)
    applyDamageToBot(h, 100)
    const revived = stepBotRespawn(h, 2.9, 3.0)
    expect(revived).toBe(false)
    expect(h.alive).toBe(false)
  })

  it('revive con vida llena exactamente al cruzar respawnDelayS', () => {
    const h = createBotHealthState(100)
    applyDamageToBot(h, 100)
    stepBotRespawn(h, 2.9, 3.0)
    const revived = stepBotRespawn(h, 0.2, 3.0)
    expect(revived).toBe(true)
    expect(h.alive).toBe(true)
    expect(h.health).toBe(100)
  })

  it('stepBotRespawn no hace nada si ya está vivo', () => {
    const h = createBotHealthState(100)
    const revived = stepBotRespawn(h, 10, 3.0)
    expect(revived).toBe(false)
    expect(h.health).toBe(100)
  })

  it('healthFraction es proporcional y llega a 0 con el bot muerto', () => {
    const h = createBotHealthState(200)
    applyDamageToBot(h, 50)
    expect(healthFraction(h)).toBeCloseTo(0.75, 10)
    applyDamageToBot(h, 150)
    expect(healthFraction(h)).toBe(0)
  })
})
