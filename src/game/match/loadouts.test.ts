import { describe, expect, it } from 'vitest'
import {
  assignBotArchetypeIds,
  assignBotArchetypes,
  assignBotWeaponSlugs,
  weaponLabel,
} from '@/game/match/loadouts'
import { ARCHETYPE_LIST, type ArchetypeId } from '@/game/weapons/archetypes'
import { resolveArchetypeId, weaponIndex, WEAPON_REGISTRY } from '@/game/weapons/registry'

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

/**
 * El arma concreta del bot existe para el AUDIO: sin ella, diez bots con
 * diez arquetipos suenan a siete armas (una por clase). Ver el comentario de
 * `assignBotWeaponSlugs` y src/game/feedback/gun-audio.ts.
 */
describe('arma concreta de cada bot', () => {
  it('le da a cada bot un slug real del catálogo, coherente con su arquetipo', () => {
    const ids = assignBotArchetypeIds(10)
    const slugs = assignBotWeaponSlugs(ids)
    expect(slugs).toHaveLength(10)
    for (let i = 0; i < slugs.length; i++) {
      const slug = slugs[i]
      if (slug === null) continue // arquetipo sin arma en el catálogo: cae a la clase
      expect(WEAPON_REGISTRY[slug], `${slug} no está en el catálogo`).toBeDefined()
      // El arma tiene que ser DEL arquetipo del bot, no una cualquiera: si no,
      // un bot con estadísticas de francotirador sonaría a subfusil.
      expect(resolveArchetypeId(slug)).toBe(ids[i])
    }
  })

  it('dos bots del mismo arquetipo llevan armas distintas mientras el catálogo dé', () => {
    // 20 bots = cada arquetipo sale dos veces (round-robin sobre 10).
    const ids = assignBotArchetypeIds(20)
    const slugs = assignBotWeaponSlugs(ids)
    for (let i = 0; i < 10; i++) {
      const primero = slugs[i]
      const segundo = slugs[i + 10]
      if (primero === null || segundo === null) continue
      // Sólo exigible si el arquetipo tiene más de un arma en el catálogo.
      const candidatos = weaponIndex().filter((e) => resolveArchetypeId(e.slug) === ids[i])
      if (candidatos.length < 2) continue
      expect(segundo, `los dos bots de ${ids[i]} llevan la misma arma`).not.toBe(primero)
    }
  })

  it('es determinista: la firma sonora de un bot no cambia entre llamadas', () => {
    const ids = assignBotArchetypeIds(10)
    expect(assignBotWeaponSlugs(ids)).toEqual(assignBotWeaponSlugs(ids))
  })

  it('un arquetipo sin armas en el catálogo da null en vez de lanzar', () => {
    // No hay ningún slug que resuelva a este id inventado, así que la única
    // salida correcta es null: ese bot suena con el sample de su clase, que
    // es exactamente lo que pasaba antes.
    const slugs = assignBotWeaponSlugs(['arquetipo-que-no-existe' as ArchetypeId])
    expect(slugs).toEqual([null])
  })
})
