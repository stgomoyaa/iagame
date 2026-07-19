import { describe, expect, it } from 'vitest'
import { parseArgs } from './cli-args'
import { DEFAULT_THRESHOLDS } from './steam-workshop'

describe('parseArgs', () => {
  it('junta todos los argumentos sin -- como términos de búsqueda', () => {
    const parsed = parseArgs(['mw2019', 'css weapons', 'arccw'])
    expect(parsed.terms).toEqual(['mw2019', 'css weapons', 'arccw'])
  })

  it('sin flags, usa los umbrales default y sin tags', () => {
    const parsed = parseArgs(['mw2019'])
    expect(parsed.thresholds).toEqual(DEFAULT_THRESHOLDS)
    expect(parsed.tags).toEqual([])
    expect(parsed.matchAllTags).toBe(false)
  })

  it('--tags con un valor lo agrega', () => {
    const parsed = parseArgs(['mw2019', '--tags', 'Weapon'])
    expect(parsed.tags).toEqual(['Weapon'])
  })

  it('--tags acepta varios valores separados por coma', () => {
    const parsed = parseArgs(['mw2019', '--tags', 'Weapon, Realistic ,Fun'])
    expect(parsed.tags).toEqual(['Weapon', 'Realistic', 'Fun'])
  })

  it('--min-subs sobreescribe sólo ese umbral, los otros dos quedan en default', () => {
    const parsed = parseArgs(['mw2019', '--min-subs', '5000'])
    expect(parsed.thresholds).toEqual({ ...DEFAULT_THRESHOLDS, minSubscribers: 5000 })
  })

  it('--min-score y --min-votes también son overridables', () => {
    const parsed = parseArgs(['mw2019', '--min-score', '0.5', '--min-votes', '10'])
    expect(parsed.thresholds.minScore).toBe(0.5)
    expect(parsed.thresholds.minVotes).toBe(10)
  })

  it('--match-all-tags no consume un valor siguiente', () => {
    const parsed = parseArgs(['mw2019', '--match-all-tags', 'arccw'])
    expect(parsed.matchAllTags).toBe(true)
    expect(parsed.terms).toEqual(['mw2019', 'arccw'])
  })

  it('combina varios términos y flags mezclados en cualquier orden', () => {
    const parsed = parseArgs(['mw2019', '--tags', 'Weapon', 'css weapons', '--min-subs', '5000', 'arccw'])
    expect(parsed.terms).toEqual(['mw2019', 'css weapons', 'arccw'])
    expect(parsed.tags).toEqual(['Weapon'])
    expect(parsed.thresholds.minSubscribers).toBe(5000)
  })

  it('tira si un flag desconocido aparece', () => {
    expect(() => parseArgs(['mw2019', '--nope'])).toThrow(/flag desconocido: --nope/)
  })

  it('tira si a un flag con valor le falta el valor (al final)', () => {
    expect(() => parseArgs(['mw2019', '--min-subs'])).toThrow(/--min-subs necesita un valor/)
  })

  it('tira si el valor de --min-score no es un número', () => {
    expect(() => parseArgs(['mw2019', '--min-score', 'alto'])).toThrow(/valor inválido para --min-score/)
  })

  it('nunca acepta una key como argumento: no hay flag --key ni --api-key', () => {
    expect(() => parseArgs(['mw2019', '--key', 'ABC123'])).toThrow(/flag desconocido: --key/)
    expect(() => parseArgs(['mw2019', '--api-key', 'ABC123'])).toThrow(/flag desconocido: --api-key/)
  })
})
