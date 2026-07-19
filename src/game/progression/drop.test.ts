import { describe, expect, it } from 'vitest'
import { dropSeed, rollDrop } from '@/game/progression/drop'
import type { MatchPerformance } from '@/game/progression/combat-score'
import { generateSkin } from '@/game/skins/generator'
import { RARITY_TIERS } from '@/game/skins/rarity'

function perf(over: Partial<MatchPerformance> = {}): MatchPerformance {
  return {
    kills: 12,
    deaths: 9,
    damage: 2800,
    headshots: 4,
    bestStreak: 5,
    durationS: 360,
    win: true,
    ...over,
  }
}

describe('drop de skin de fin de partida', () => {
  // Lo que hace que guardar seeds en vez de skins funcione (store.ts).
  it('la misma partida siempre suelta la misma skin', () => {
    const a = rollDrop(7, perf(), [])
    const b = rollDrop(7, perf(), [])
    expect(a.skin).toEqual(b.skin)
    expect(a.skin).toEqual(generateSkin(dropSeed(7, perf())))
  })

  it('dos partidas seguidas nunca comparten seed, aunque se repita la actuacion', () => {
    const seeds = new Set<string>()
    for (let i = 1; i <= 200; i++) seeds.add(dropSeed(i, perf()))
    expect(seeds.size).toBe(200)
  })

  it('la actuacion tambien entra en la seed', () => {
    expect(dropSeed(3, perf({ kills: 12 }))).not.toBe(dropSeed(3, perf({ kills: 13 })))
  })

  it('marca como nueva solo la que no estaba en el inventario', () => {
    const seed = dropSeed(4, perf())
    expect(rollDrop(4, perf(), []).nueva).toBe(true)
    expect(rollDrop(4, perf(), [seed]).nueva).toBe(false)
  })

  it('la seed aguanta numeros y danos raros sin romperse', () => {
    expect(dropSeed(-3, perf({ damage: -100, kills: -2 }))).toBe('drop:0:0:0')
    expect(typeof rollDrop(1.7, perf({ damage: 12.4 }), []).skin.name).toBe('string')
  })

  // La rareza sale del sorteo por pesos de skins/rarity.ts y NO del
  // rendimiento: si dependiera de la actuación, el drop dejaría de ser una
  // sorpresa. Ver el comentario de cabecera de drop.ts.
  it('jugar mejor no mejora la rareza', () => {
    const cuenta = (kills: number): Record<string, number> => {
      const out: Record<string, number> = {}
      for (let i = 1; i <= 600; i++) {
        const r = rollDrop(i, perf({ kills, damage: kills * 230 }), []).skin.rarity
        out[r] = (out[r] ?? 0) + 1
      }
      return out
    }
    const malo = cuenta(2)
    const bueno = cuenta(40)
    // Las dos distribuciones tienen que ser parecidas: comparamos la
    // proporción de comunes, que es el tier más frecuente.
    const propMalo = (malo.comun ?? 0) / 600
    const propBueno = (bueno.comun ?? 0) / 600
    expect(Math.abs(propMalo - propBueno)).toBeLessThan(0.12)
  })

  it('a lo largo de muchas partidas salen todas las rarezas', () => {
    const vistas = new Set<string>()
    for (let i = 1; i <= 4000; i++) vistas.add(rollDrop(i, perf(), []).skin.rarity)
    for (const tier of RARITY_TIERS) {
      expect(vistas.has(tier.id), `nunca salio ${tier.id}`).toBe(true)
    }
  })
})
