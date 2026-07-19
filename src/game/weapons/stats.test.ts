import { describe, expect, it } from 'vitest'
import { ARCHETYPES, ARCHETYPE_LIST } from '@/game/weapons/archetypes'
import { CLASS_LABEL, statBars, STAT_DEFS } from '@/game/weapons/stats'

describe('barras de estadísticas', () => {
  it('devuelve las seis barras para cualquier arquetipo', () => {
    for (const archetype of ARCHETYPE_LIST) {
      const bars = statBars(archetype)
      expect(bars).toHaveLength(STAT_DEFS.length)
      for (const bar of bars) {
        expect(bar.value).toBeGreaterThan(0)
        expect(bar.value).toBeLessThanOrEqual(1)
        expect(bar.detail.length).toBeGreaterThan(0)
      }
    }
  })

  it('el arquetipo tope de cada eje llega a 1', () => {
    for (const def of STAT_DEFS) {
      const mejor = ARCHETYPE_LIST.reduce((a, b) => (def.raw(b) > def.raw(a) ? b : a))
      const barra = statBars(mejor).find((b) => b.id === def.id)
      expect(barra?.value).toBeCloseTo(1, 5)
    }
  })

  it('el francotirador pega más fuerte y dispara más lento que la SMG', () => {
    const sniper = statBars(ARCHETYPES['sniper-bolt'])
    const smg = statBars(ARCHETYPES['smg-1'])
    const eje = (bars: ReturnType<typeof statBars>, id: string): number =>
      bars.find((b) => b.id === id)!.value

    expect(eje(sniper, 'dano')).toBeGreaterThan(eje(smg, 'dano'))
    expect(eje(smg, 'cadencia')).toBeGreaterThan(eje(sniper, 'cadencia'))
    expect(eje(smg, 'movilidad')).toBeGreaterThan(eje(sniper, 'movilidad'))
  })

  it('más retroceso es menos control', () => {
    const control = (id: 'lmg' | 'pistol'): number =>
      statBars(ARCHETYPES[id]).find((b) => b.id === 'control')!.value
    expect(control('pistol')).toBeGreaterThan(control('lmg'))
  })

  it('hay etiqueta para todas las clases del arsenal', () => {
    for (const archetype of ARCHETYPE_LIST) {
      expect(CLASS_LABEL[archetype.class]).toBeTruthy()
    }
  })
})
