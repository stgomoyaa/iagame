import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'
import type { CatalogEntry } from './steam-workshop'

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: '123',
    title: 'Arma de prueba',
    author: '76561198000000000',
    subscribers: 3000,
    favourites: 200,
    score: 0.9,
    votesUp: 100,
    votesDown: 5,
    fileSizeBytes: 2048,
    tags: ['Weapon'],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-02-01T00:00:00.000Z',
    url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=123',
    ...overrides,
  }
}

describe('toCsv', () => {
  it('la primera línea es el header con las columnas en orden fijo', () => {
    const csv = toCsv([])
    expect(csv).toBe(
      'id,title,author,subscribers,favourites,score,votesUp,votesDown,fileSizeBytes,tags,createdAt,updatedAt,url\r\n',
    )
  })

  it('serializa una fila con los tipos convertidos a texto', () => {
    const csv = toCsv([makeEntry()])
    const lines = csv.split('\r\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe(
      '123,Arma de prueba,76561198000000000,3000,200,0.9,100,5,2048,Weapon,2024-01-01T00:00:00.000Z,2024-02-01T00:00:00.000Z,https://steamcommunity.com/sharedfiles/filedetails/?id=123',
    )
  })

  it('une varios tags con punto y coma', () => {
    const csv = toCsv([makeEntry({ tags: ['Weapon', 'Realistic', 'Fun'] })])
    expect(csv).toContain('Weapon;Realistic;Fun')
  })

  it('entrecomilla un título con coma', () => {
    const csv = toCsv([makeEntry({ title: 'CSS Weapons, Realistic Pack' })])
    expect(csv).toContain('"CSS Weapons, Realistic Pack"')
  })

  it('duplica comillas internas y entrecomilla el campo', () => {
    const csv = toCsv([makeEntry({ title: 'El pack "definitivo"' })])
    expect(csv).toContain('"El pack ""definitivo"""')
  })

  it('entrecomilla un campo con salto de línea', () => {
    const csv = toCsv([makeEntry({ title: 'línea uno\nlínea dos' })])
    expect(csv).toContain('"línea uno\nlínea dos"')
  })

  it('no entrecomilla campos sin caracteres especiales', () => {
    const csv = toCsv([makeEntry({ title: 'ArcCW Base' })])
    expect(csv).toContain('ArcCW Base')
    expect(csv).not.toContain('"ArcCW Base"')
  })
})
