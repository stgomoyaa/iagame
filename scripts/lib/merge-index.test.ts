import { describe, expect, it } from 'vitest'
import { mergeIndex, type IndexEntry } from './merge-index'

/** Entrada de índice mínima para pruebas, con overrides puntuales por caso. */
function makeEntry(slug: string, overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    slug,
    name: slug,
    triangles: 100,
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    muzzleConfidence: 0.5,
    upAxisConfidence: 0.5,
    needsManualReview: false,
    ...overrides,
  }
}

describe('mergeIndex', () => {
  it('una corrida que no convierte nada conserva todas las entradas existentes', () => {
    const existing = [makeEntry('assaultrifle-1'), makeEntry('bullpup-1'), makeEntry('pistol-1')]
    const glbsOnDisk = new Set(existing.map((e) => e.slug))

    const merged = mergeIndex(existing, [], glbsOnDisk)

    expect(merged).toHaveLength(3)
    expect(merged.map((e) => e.slug)).toEqual(['assaultrifle-1', 'bullpup-1', 'pistol-1'])
  })

  it('una corrida que convierte un subconjunto fusiona en vez de reemplazar', () => {
    const existing = [makeEntry('assaultrifle-1'), makeEntry('bullpup-1')]
    const fresh = [makeEntry('shotgun-1'), makeEntry('sniperrifle-1')]
    const glbsOnDisk = new Set([...existing, ...fresh].map((e) => e.slug))

    const merged = mergeIndex(existing, fresh, glbsOnDisk)

    expect(merged.map((e) => e.slug)).toEqual([
      'assaultrifle-1',
      'bullpup-1',
      'shotgun-1',
      'sniperrifle-1',
    ])
  })

  it('un slug re-convertido actualiza la entrada existente en vez de duplicarla', () => {
    const existing = [makeEntry('pistol-1', { triangles: 100, muzzleConfidence: 0.1 })]
    const fresh = [makeEntry('pistol-1', { triangles: 250, muzzleConfidence: 0.9 })]
    const glbsOnDisk = new Set(['pistol-1'])

    const merged = mergeIndex(existing, fresh, glbsOnDisk)

    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual(fresh[0])
  })

  it('una entrada existente cuyo .glb ya no está en disco se descarta', () => {
    const existing = [makeEntry('assaultrifle-1'), makeEntry('bullpup-1')]
    // "bullpup-1.glb" se borró (o nunca se escribió del todo) entre corridas.
    const glbsOnDisk = new Set(['assaultrifle-1'])

    const merged = mergeIndex(existing, [], glbsOnDisk)

    expect(merged.map((e) => e.slug)).toEqual(['assaultrifle-1'])
  })

  it('una corrida parcialmente fallida no pierde entradas de archivos ya convertidos antes', () => {
    // assaultrifle-1 y bullpup-1 ya estaban convertidos de una corrida
    // previa. Esta corrida sólo logra convertir shotgun-1; sniperrifle-1
    // falla (no aparece en fresh), pero como es un archivo nuevo tampoco
    // tenía entrada previa ni .glb en disco.
    const existing = [makeEntry('assaultrifle-1'), makeEntry('bullpup-1')]
    const fresh = [makeEntry('shotgun-1')]
    const glbsOnDisk = new Set(['assaultrifle-1', 'bullpup-1', 'shotgun-1'])

    const merged = mergeIndex(existing, fresh, glbsOnDisk)

    expect(merged.map((e) => e.slug)).toEqual(['assaultrifle-1', 'bullpup-1', 'shotgun-1'])
  })

  it('las entradas quedan ordenadas por slug sin importar el orden de entrada', () => {
    const existing = [makeEntry('sniperrifle-1'), makeEntry('assaultrifle-1')]
    const fresh = [makeEntry('bullpup-1')]
    const glbsOnDisk = new Set(['sniperrifle-1', 'assaultrifle-1', 'bullpup-1'])

    const merged = mergeIndex(existing, fresh, glbsOnDisk)

    expect(merged.map((e) => e.slug)).toEqual(['assaultrifle-1', 'bullpup-1', 'sniperrifle-1'])
  })

  it('con índice existente vacío, el resultado es sólo lo convertido en esta corrida', () => {
    const fresh = [makeEntry('pistol-1'), makeEntry('pistol-2')]
    const glbsOnDisk = new Set(fresh.map((e) => e.slug))

    const merged = mergeIndex([], fresh, glbsOnDisk)

    expect(merged.map((e) => e.slug)).toEqual(['pistol-1', 'pistol-2'])
  })

  it('no muta los arrays ni el set recibidos', () => {
    const existing = [makeEntry('pistol-1')]
    const fresh = [makeEntry('pistol-2')]
    const glbsOnDisk = new Set(['pistol-1', 'pistol-2'])

    mergeIndex(existing, fresh, glbsOnDisk)

    expect(existing).toHaveLength(1)
    expect(fresh).toHaveLength(1)
    expect(glbsOnDisk.size).toBe(2)
  })
})
