import { describe, expect, it } from 'vitest'
import { assignBotArchetypeIds, assignBotArchetypes, weaponLabel } from '@/game/match/loadouts'
import { ARCHETYPE_LIST } from '@/game/weapons/archetypes'

describe('reparto de armas de bots', () => {
  it('con count <= 10 (el roster completo), cada bot lleva un arquetipo distinto', () => {
    const ids = assignBotArchetypeIds(8)
    expect(new Set(ids).size).toBe(8)
  })

  it('con count === el tamaño del roster, cubre los 10 arquetipos exactos', () => {
    const ids = assignBotArchetypeIds(ARCHETYPE_LIST.length)
    expect(new Set(ids).size).toBe(ARCHETYPE_LIST.length)
  })

  it('por encima de 10 bots, repite en round-robin en vez de lanzar o vaciarse', () => {
    const ids = assignBotArchetypeIds(13)
    expect(ids).toHaveLength(13)
    expect(ids[0]).toBe(ids[10]) // wrap exacto tras 10
    expect(new Set(ids).size).toBe(ARCHETYPE_LIST.length) // sigue cubriendo los 10
  })

  it('assignBotArchetypes devuelve los WeaponArchetype reales, no sólo ids', () => {
    const archetypes = assignBotArchetypes(3)
    expect(archetypes).toHaveLength(3)
    for (const a of archetypes) expect(a.magazine).toBeGreaterThan(0)
  })

  it('weaponLabel da un texto legible sin guiones', () => {
    expect(weaponLabel('ar-1')).toBe('AR 1')
    expect(weaponLabel('sniper-bolt')).toBe('SNIPER BOLT')
  })
})
