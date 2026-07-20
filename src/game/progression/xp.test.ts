import { describe, expect, it } from 'vitest'
import { applyXp, XP, xpForMatch } from '@/game/progression/xp'
import type { MatchPerformance } from '@/game/progression/combat-score'
import { NIVEL_MAXIMO, xpParaNivel } from '@/game/progression/unlocks'

function perf(over: Partial<MatchPerformance> = {}): MatchPerformance {
  return {
    kills: 10,
    deaths: 10,
    damage: 2500,
    headshots: 3,
    bestStreak: 2,
    durationS: 360,
    win: true,
    ...over,
  }
}

describe('XP por partida', () => {
  it('usa los mismos valores que los popups de kill y headshot', () => {
    expect(XP.porKill).toBe(100)
    expect(XP.porHeadshot).toBe(50)
  })

  it('sube con kills, headshots y dano', () => {
    expect(xpForMatch(perf({ kills: 20 }))).toBeGreaterThan(xpForMatch(perf()))
    expect(xpForMatch(perf({ headshots: 9 }))).toBeGreaterThan(xpForMatch(perf()))
    expect(xpForMatch(perf({ damage: 9000 }))).toBeGreaterThan(xpForMatch(perf()))
  })

  it('ganar paga mas que perder, pero perder tambien paga', () => {
    const gana = xpForMatch(perf({ win: true }))
    const pierde = xpForMatch(perf({ win: false }))
    expect(gana).toBeGreaterThan(pierde)
    expect(pierde).toBeGreaterThan(0)
  })

  // La XP corre en paralelo al rango justamente para que una mala noche
  // igual deje algo. Una partida desastrosa no puede dar cero.
  it('la peor partida posible igual da XP', () => {
    const nada = xpForMatch(
      perf({ kills: 0, deaths: 30, damage: 0, headshots: 0, bestStreak: 0, win: false }),
    )
    expect(nada).toBeGreaterThan(0)
  })

  it('nunca es negativa ni fraccionaria aunque lleguen datos raros', () => {
    const raro = xpForMatch(
      perf({ kills: -5, headshots: -3, damage: Number.NaN, bestStreak: -1, win: false }),
    )
    expect(raro).toBeGreaterThan(0)
    expect(Number.isInteger(raro)).toBe(true)
  })

  it('los headshots no pueden superar a los kills', () => {
    expect(xpForMatch(perf({ kills: 5, headshots: 40 }))).toBe(xpForMatch(perf({ kills: 5, headshots: 5 })))
  })
})

describe('acumulacion de XP', () => {
  it('suma sobre la XP previa y nunca baja', () => {
    const r = applyXp(5000, perf())
    expect(r.xp).toBe(5000 + r.ganada)
    expect(r.xp).toBeGreaterThan(5000)
  })

  it('detecta la subida de nivel', () => {
    // Justo debajo de un nivel: cualquier partida lo cruza.
    const r = applyXp(xpParaNivel(2) - 1, perf())
    expect(r.subioDeNivel).toBe(true)
    expect(r.level).toBeGreaterThan(r.levelAnterior)
  })

  it('no inventa subidas de nivel cuando no las hubo', () => {
    const r = applyXp(0, perf({ kills: 0, deaths: 5, damage: 0, headshots: 0, win: false }))
    expect(r.ganada).toBeLessThan(xpParaNivel(2))
    expect(r.subioDeNivel).toBe(false)
  })

  it('en el techo la XP sigue sumando pero el nivel no sube', () => {
    // La barra llena es la señal de que se puede prestigiar (prestige.ts).
    // La XP igual se acumula: quien decide tirarla es el jugador al
    // prestigiar, no una resta silenciosa acá.
    const r = applyXp(xpParaNivel(NIVEL_MAXIMO), perf())
    expect(r.level).toBe(NIVEL_MAXIMO)
    expect(r.levelAnterior).toBe(NIVEL_MAXIMO)
    expect(r.subioDeNivel).toBe(false)
    expect(r.xp).toBeGreaterThan(xpParaNivel(NIVEL_MAXIMO))
  })

  it('trata una XP previa corrupta como cero en vez de propagarla', () => {
    expect(applyXp(Number.NaN, perf()).xp).toBe(xpForMatch(perf()))
    expect(applyXp(-9000, perf()).xp).toBe(xpForMatch(perf()))
  })
})
