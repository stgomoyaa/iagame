import { describe, expect, it } from 'vitest'
import { mergeCatalog } from './merge-catalog'
import type { CatalogEntry } from './steam-workshop'

function makeEntry(id: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id,
    title: `pack-${id}`,
    author: '76561198000000000',
    subscribers: 1000,
    favourites: 50,
    score: 0.9,
    votesUp: 100,
    votesDown: 5,
    fileSizeBytes: 1024,
    tags: ['Weapon'],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
    ...overrides,
  }
}

describe('mergeCatalog', () => {
  it('una corrida sin resultados nuevos conserva todo el catálogo existente', () => {
    const existing = [makeEntry('1'), makeEntry('2'), makeEntry('3')]
    const merged = mergeCatalog(existing, [])
    expect(merged.map((e) => e.id).sort()).toEqual(['1', '2', '3'])
  })

  it('una corrida con un término nuevo fusiona en vez de reemplazar el catálogo entero', () => {
    const existing = [makeEntry('1', { subscribers: 9000 }), makeEntry('2', { subscribers: 8000 })]
    const fresh = [makeEntry('3', { subscribers: 7000 })]

    const merged = mergeCatalog(existing, fresh)

    expect(merged.map((e) => e.id)).toEqual(['1', '2', '3'])
  })

  it('un id repetido en fresh actualiza la entrada existente (subscribers/votos más al día) en vez de duplicarla', () => {
    const existing = [makeEntry('1', { subscribers: 1000, score: 0.7 })]
    const fresh = [makeEntry('1', { subscribers: 5000, score: 0.95 })]

    const merged = mergeCatalog(existing, fresh)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual(fresh[0])
  })

  it('ordena el resultado por subscribers descendente', () => {
    const existing = [makeEntry('a', { subscribers: 100 }), makeEntry('b', { subscribers: 9000 })]
    const fresh = [makeEntry('c', { subscribers: 4000 })]

    const merged = mergeCatalog(existing, fresh)

    expect(merged.map((e) => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('con catálogo existente vacío, el resultado es sólo lo consultado en esta corrida', () => {
    const fresh = [makeEntry('1'), makeEntry('2')]
    const merged = mergeCatalog([], fresh)
    expect(merged.map((e) => e.id).sort()).toEqual(['1', '2'])
  })

  it('no muta los arrays recibidos', () => {
    const existing = [makeEntry('1')]
    const fresh = [makeEntry('2')]

    mergeCatalog(existing, fresh)

    expect(existing).toHaveLength(1)
    expect(fresh).toHaveLength(1)
  })
})
