import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THRESHOLDS,
  GMOD_APPID,
  buildQueryFilesParams,
  meetsThresholds,
  parsePublishedFileDetails,
  parseQueryFilesResponse,
  redactApiKey,
  totalVotes,
  type CatalogEntry,
} from './steam-workshop'

/** Un publishedfiledetails crudo mínimo pero válido, con overrides puntuales por caso. */
function rawDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    publishedfileid: '111222333',
    creator: '765611110000000001',
    title: 'CSS Weapons Pack',
    subscriptions: 12000,
    favorited: 900,
    file_size: '1048576',
    time_created: 1700000000,
    time_updated: 1710000000,
    vote_data: { score: 0.93, votes_up: 500, votes_down: 20 },
    tags: [{ tag: 'Weapon' }, { tag: 'Fun' }],
    ...overrides,
  }
}

describe('buildQueryFilesParams', () => {
  it('arma los params requeridos con la key, el appid de GMod y el query_type de búsqueda por texto', () => {
    const params = buildQueryFilesParams('SECRETO123', {
      searchText: 'mw2019',
      tags: [],
      matchAllTags: false,
      cursor: '*',
      numPerPage: 100,
    })

    expect(params.get('key')).toBe('SECRETO123')
    expect(params.get('appid')).toBe(String(GMOD_APPID))
    expect(params.get('query_type')).toBe('12')
    expect(params.get('search_text')).toBe('mw2019')
    expect(params.get('cursor')).toBe('*')
    expect(params.get('numperpage')).toBe('100')
    expect(params.get('return_details')).toBe('true')
    expect(params.get('return_vote_data')).toBe('true')
    expect(params.get('return_tags')).toBe('true')
  })

  it('sin tags no manda requiredtags ni match_all_tags', () => {
    const params = buildQueryFilesParams('k', {
      searchText: 'arccw',
      tags: [],
      matchAllTags: false,
      cursor: '*',
      numPerPage: 100,
    })

    expect(params.has('requiredtags')).toBe(false)
    expect(params.has('match_all_tags')).toBe(false)
  })

  it('con tags los une con coma en un único requiredtags', () => {
    const params = buildQueryFilesParams('k', {
      searchText: 'css weapons',
      tags: ['Weapon', 'Realistic'],
      matchAllTags: true,
      cursor: '*',
      numPerPage: 100,
    })

    expect(params.get('requiredtags')).toBe('Weapon,Realistic')
    expect(params.get('match_all_tags')).toBe('true')
  })
})

describe('redactApiKey', () => {
  it('reemplaza el valor de key en una query string', () => {
    const redacted = redactApiKey('https://api.steampowered.com/x?appid=4000&key=SUPERSECRETO&page=1')
    expect(redacted).toBe('https://api.steampowered.com/x?appid=4000&key=***&page=1')
    expect(redacted).not.toContain('SUPERSECRETO')
  })

  it('no toca nada si no hay key en la query', () => {
    const url = 'https://api.steampowered.com/x?appid=4000'
    expect(redactApiKey(url)).toBe(url)
  })

  it('redacta key cuando es el primer parámetro (caso real: buildQueryFilesParams la setea primero)', () => {
    const redacted = redactApiKey(
      'https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?key=SUPERSECRETO123&query_type=12&appid=4000',
    )
    expect(redacted).toBe(
      'https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?key=***&query_type=12&appid=4000',
    )
    expect(redacted).not.toContain('SUPERSECRETO123')
  })
})

describe('parsePublishedFileDetails', () => {
  it('convierte un publishedfiledetails válido a CatalogEntry', () => {
    const entry = parsePublishedFileDetails(rawDetail(), 0)

    expect(entry).toEqual<CatalogEntry>({
      id: '111222333',
      title: 'CSS Weapons Pack',
      author: '765611110000000001',
      subscribers: 12000,
      favourites: 900,
      score: 0.93,
      votesUp: 500,
      votesDown: 20,
      fileSizeBytes: 1048576,
      tags: ['Weapon', 'Fun'],
      createdAt: new Date(1700000000 * 1000).toISOString(),
      updatedAt: new Date(1710000000 * 1000).toISOString(),
      url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=111222333',
    })
  })

  it('acepta publishedfileid como number además de string', () => {
    const entry = parsePublishedFileDetails(rawDetail({ publishedfileid: 111222333 }), 0)
    expect(entry.id).toBe('111222333')
  })

  it('tira si publishedfileid falta', () => {
    const raw = rawDetail()
    delete raw['publishedfileid']
    expect(() => parsePublishedFileDetails(raw, 3)).toThrow(/publishedfiledetails\[3\]\.publishedfileid/)
  })

  it('tira si el elemento no es un objeto', () => {
    expect(() => parsePublishedFileDetails('no-es-un-objeto', 0)).toThrow(/no es un objeto/)
  })

  it('sin vote_data, deja score y votos en 0 en vez de tirar', () => {
    const raw = rawDetail()
    delete raw['vote_data']
    const entry = parsePublishedFileDetails(raw, 0)
    expect(entry.score).toBe(0)
    expect(entry.votesUp).toBe(0)
    expect(entry.votesDown).toBe(0)
  })

  it('sin tags, devuelve un array vacío', () => {
    const raw = rawDetail()
    delete raw['tags']
    const entry = parsePublishedFileDetails(raw, 0)
    expect(entry.tags).toEqual([])
  })

  it('sin título, usa un placeholder en vez de tirar', () => {
    const raw = rawDetail()
    delete raw['title']
    const entry = parsePublishedFileDetails(raw, 0)
    expect(entry.title).toBe('(sin título)')
  })
})

describe('parseQueryFilesResponse', () => {
  it('parsea una respuesta válida con dos resultados y cursor siguiente', () => {
    const json = {
      response: {
        total: 2,
        next_cursor: 'AoJw...',
        publishedfiledetails: [rawDetail({ publishedfileid: '1' }), rawDetail({ publishedfileid: '2' })],
      },
    }

    const page = parseQueryFilesResponse(json)
    expect(page.total).toBe(2)
    expect(page.entries).toHaveLength(2)
    expect(page.entries.map((e) => e.id)).toEqual(['1', '2'])
    expect(page.nextCursor).toBe('AoJw...')
  })

  it('sin next_cursor (última página), lo deja en undefined', () => {
    const json = { response: { total: 0, publishedfiledetails: [] } }
    const page = parseQueryFilesResponse(json)
    expect(page.nextCursor).toBeUndefined()
  })

  it('tira si el body no es un objeto', () => {
    expect(() => parseQueryFilesResponse('no-es-un-objeto')).toThrow(/no es un objeto JSON/)
  })

  it('tira si falta el campo response', () => {
    expect(() => parseQueryFilesResponse({ ok: true })).toThrow(/falta el campo "response"/)
  })

  it('tira si un elemento de publishedfiledetails tiene forma inválida, en vez de devolver un catálogo parcial silencioso', () => {
    const json = {
      response: {
        total: 1,
        publishedfiledetails: [{ title: 'sin id' }],
      },
    }
    expect(() => parseQueryFilesResponse(json)).toThrow(/publishedfileid/)
  })

  it('sin publishedfiledetails, devuelve un array vacío en vez de tirar', () => {
    const json = { response: { total: 0 } }
    const page = parseQueryFilesResponse(json)
    expect(page.entries).toEqual([])
  })
})

describe('totalVotes', () => {
  it('suma arriba y abajo', () => {
    const entry = parsePublishedFileDetails(rawDetail({ vote_data: { score: 0.5, votes_up: 30, votes_down: 10 } }), 0)
    expect(totalVotes(entry)).toBe(40)
  })
})

describe('meetsThresholds', () => {
  it('pasa cuando cumple los tres umbrales', () => {
    const entry = parsePublishedFileDetails(rawDetail(), 0)
    expect(meetsThresholds(entry, DEFAULT_THRESHOLDS)).toBe(true)
  })

  it('no pasa si le faltan subscribers aunque el score y los votos sean altos', () => {
    const entry = parsePublishedFileDetails(rawDetail({ subscriptions: 100 }), 0)
    expect(meetsThresholds(entry, DEFAULT_THRESHOLDS)).toBe(false)
  })

  it('no pasa si el score es alto pero los votos son pocos (5 estrellas con 4 votos no alcanza)', () => {
    const entry = parsePublishedFileDetails(
      rawDetail({ subscriptions: 5000, vote_data: { score: 1, votes_up: 4, votes_down: 0 } }),
      0,
    )
    expect(meetsThresholds(entry, DEFAULT_THRESHOLDS)).toBe(false)
  })

  it('respeta umbrales custom', () => {
    const entry = parsePublishedFileDetails(rawDetail({ subscriptions: 100 }), 0)
    expect(meetsThresholds(entry, { minScore: 0, minVotes: 0, minSubscribers: 50 })).toBe(true)
  })
})
