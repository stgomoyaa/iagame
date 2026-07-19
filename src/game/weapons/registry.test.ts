import { describe, expect, it } from 'vitest'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import {
  getWeaponVisual,
  inferArchetypeFromSlug,
  resolveArchetype,
  resolveArchetypeId,
  weaponIndex,
  WEAPON_REGISTRY,
} from '@/game/weapons/registry'

describe('registry: catálogo de index.json', () => {
  it('index.json tiene al menos las 14 entradas conocidas al momento de escribir esto', () => {
    expect(weaponIndex().length).toBeGreaterThanOrEqual(14)
  })

  it('cada slug de index.json resuelve a un arquetipo que existe en ARCHETYPES', () => {
    for (const entry of weaponIndex()) {
      const archetypeId = resolveArchetypeId(entry.slug)
      expect(ARCHETYPES[archetypeId], `${entry.slug} -> ${archetypeId}`).toBeDefined()
      expect(ARCHETYPES[archetypeId].id).toBe(archetypeId)
    }
  })

  it('WEAPON_REGISTRY tiene una entrada por cada slug de index.json', () => {
    for (const entry of weaponIndex()) {
      expect(WEAPON_REGISTRY[entry.slug], entry.slug).toBeDefined()
      expect(WEAPON_REGISTRY[entry.slug].slug).toBe(entry.slug)
    }
    expect(Object.keys(WEAPON_REGISTRY).length).toBe(weaponIndex().length)
  })

  it('el arquetipo referenciado por cada WeaponVisual existe en ARCHETYPES', () => {
    for (const visual of Object.values(WEAPON_REGISTRY)) {
      expect(ARCHETYPES[visual.archetype], visual.slug).toBeDefined()
    }
  })
})

describe('registry: fallback de arquetipo inferido', () => {
  it('un slug sin mapeo explícito no lanza y devuelve un arquetipo válido', () => {
    expect(() => resolveArchetype('railgun-7')).not.toThrow()
    const archetype = resolveArchetype('railgun-7')
    expect(ARCHETYPES[archetype.id]).toBe(archetype)
  })

  it('sin ninguna palabra clave reconocida, cae al arquetipo de línea de base (ar-1)', () => {
    expect(inferArchetypeFromSlug('railgun-7')).toBe('ar-1')
  })

  it('infiere por palabra clave del prefijo cuando el slug la contiene', () => {
    expect(inferArchetypeFromSlug('lasersniper-9')).toBe('sniper-bolt')
    expect(inferArchetypeFromSlug('urbanshotgun-2')).toBe('shotgun')
    expect(inferArchetypeFromSlug('heavylmg-1')).toBe('lmg')
    expect(inferArchetypeFromSlug('compactpistol-3')).toBe('pistol')
    expect(inferArchetypeFromSlug('tacticalsmg-4')).toBe('smg-1')
  })

  it('"submachinegun" gana sobre "machinegun": una subfusil no es una LMG', () => {
    // Regresión: /machinegun/ matcheaba dentro de "submachinegun" y mandaba
    // los cinco modelos SubmachineGun_N del pack CC0 al arquetipo pesado.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(inferArchetypeFromSlug(`submachinegun-${n}`)).toBe('smg-1')
    }
    expect(inferArchetypeFromSlug('heavymachinegun-1')).toBe('lmg')
  })

  it('los slugs del pack CC0 completo infieren la clase que corresponde', () => {
    expect(inferArchetypeFromSlug('revolver-3')).toBe('pistol')
    expect(inferArchetypeFromSlug('shotgun-sawedoff')).toBe('shotgun')
    expect(inferArchetypeFromSlug('shotgun-shortstock')).toBe('shotgun')
    expect(inferArchetypeFromSlug('sniperrifle-6')).toBe('sniper-bolt')
  })

  it('un slug sin número de variante también funciona (no depende del sufijo -N)', () => {
    expect(() => inferArchetypeFromSlug('mysteryweapon')).not.toThrow()
  })
})

describe('registry: WeaponVisual', () => {
  it('getWeaponVisual devuelve la configuración correcta para un slug catalogado', () => {
    const visual = getWeaponVisual('pistol-1')
    expect(visual.slug).toBe('pistol-1')
    expect(visual.archetype).toBe('pistol')
    expect(visual.adsTime).toBe(ARCHETYPES.pistol.ads.time)
    expect(visual.reloadTime).toBe(ARCHETYPES.pistol.reload.tactical)
  })

  it('getWeaponVisual lanza para un slug que no está en index.json', () => {
    expect(() => getWeaponVisual('arma-que-no-existe')).toThrow()
  })

  it('cada WeaponVisual tiene hipOffset, adsOffset y rotationOffset completos', () => {
    for (const visual of Object.values(WEAPON_REGISTRY)) {
      for (const key of ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const) {
        expect(Number.isFinite(visual.hipOffset[key]), `${visual.slug}.hipOffset.${key}`).toBe(true)
        expect(Number.isFinite(visual.adsOffset[key]), `${visual.slug}.adsOffset.${key}`).toBe(true)
      }
      expect(Number.isFinite(visual.rotationOffset.rx)).toBe(true)
      expect(Number.isFinite(visual.rotationOffset.ry)).toBe(true)
      expect(Number.isFinite(visual.rotationOffset.rz)).toBe(true)
      expect(visual.scaleAdjust).toBeGreaterThan(0)
      expect(visual.adsTime).toBeGreaterThan(0)
      expect(visual.drawTime).toBeGreaterThan(0)
      expect(visual.reloadTime).toBeGreaterThan(0)
      expect(visual.kickMagnitude).toBeGreaterThan(0)
    }
  })
})
