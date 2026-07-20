import { describe, expect, it } from 'vitest'
import {
  isWeaponUnlocked,
  levelForXp,
  NIVEL_INICIAL,
  nivelMaximoDeDesbloqueo,
  unlockedWeapons,
  unlockLevelFor,
  unlockLevelsSnapshot,
  xpParaNivel,
  XP_POR_NIVEL,
} from '@/game/progression/unlocks'
import { resolveArchetype, weaponIndex } from '@/game/weapons/registry'

describe('desbloqueo por nivel de cuenta', () => {
  it('cubre las 40 armas del pack', () => {
    const slugs = weaponIndex().map((e) => e.slug)
    expect(slugs.length).toBe(40)
    for (const slug of slugs) expect(unlockLevelsSnapshot()[slug]).toBeGreaterThan(0)
  })

  it('tira con un arma que no existe en vez de dejarla desbloqueada', () => {
    expect(() => unlockLevelFor('no-existe')).toThrow()
  })

  it('una cuenta nueva tiene al menos un fusil y una pistola', () => {
    // La condición que hace que defaultLoadout() siempre pueda armar un
    // loadout jugable, y que un jugador nuevo nunca spawnee sin arma.
    const clases = unlockedWeapons(NIVEL_INICIAL).map((s) => resolveArchetype(s).class)
    expect(clases).toContain('ar')
    expect(clases).toContain('pistol')
  })

  it('una cuenta nueva no tiene todo el arsenal', () => {
    expect(unlockedWeapons(NIVEL_INICIAL).length).toBeLessThan(weaponIndex().length)
  })

  it('el arsenal sólo crece con el nivel', () => {
    let anterior = 0
    for (let nivel = 1; nivel <= nivelMaximoDeDesbloqueo() + 1; nivel++) {
      const cantidad = unlockedWeapons(nivel).length
      expect(cantidad).toBeGreaterThanOrEqual(anterior)
      anterior = cantidad
    }
    expect(anterior).toBe(weaponIndex().length)
  })

  it('las clases de nicho llegan después que fusiles y pistolas', () => {
    const minimoDeClase = (clase: string): number =>
      Math.min(
        ...weaponIndex()
          .filter((e) => resolveArchetype(e.slug).class === clase)
          .map((e) => unlockLevelFor(e.slug)),
      )
    expect(minimoDeClase('smg')).toBeGreaterThan(minimoDeClase('ar'))
    expect(minimoDeClase('smg')).toBeGreaterThan(minimoDeClase('pistol'))
  })

  it('isWeaponUnlocked es coherente con unlockLevelFor', () => {
    for (const entry of weaponIndex()) {
      const nivel = unlockLevelFor(entry.slug)
      expect(isWeaponUnlocked(entry.slug, nivel - 1)).toBe(false)
      expect(isWeaponUnlocked(entry.slug, nivel)).toBe(true)
    }
  })
})

describe('nivel por xp', () => {
  it('una cuenta sin xp está en el nivel inicial', () => {
    expect(levelForXp(0)).toBe(NIVEL_INICIAL)
    expect(levelForXp(-100)).toBe(NIVEL_INICIAL)
    expect(levelForXp(Number.NaN)).toBe(NIVEL_INICIAL)
  })

  it('sube un nivel por cada tramo de xp', () => {
    expect(levelForXp(XP_POR_NIVEL - 1)).toBe(NIVEL_INICIAL)
    expect(levelForXp(XP_POR_NIVEL)).toBe(NIVEL_INICIAL + 1)
    expect(levelForXp(XP_POR_NIVEL * 5)).toBe(NIVEL_INICIAL + 5)
  })

  it('xpParaNivel es la inversa', () => {
    for (const nivel of [1, 2, 7, 20]) {
      expect(levelForXp(xpParaNivel(nivel))).toBe(nivel)
    }
  })
})
