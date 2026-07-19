import { describe, expect, it } from 'vitest'
import { seedAdsOffset, seedHipOffset, seedWeaponOffsets, type WeaponIndexEntry } from '@/game/weapons/seed'
import { weaponIndex } from '@/game/weapons/registry'

function entry(slug: string): WeaponIndexEntry {
  const found = weaponIndex().find((e) => e.slug === slug)
  if (!found) throw new Error(`no está en index.json: ${slug}`)
  return found
}

describe('seed: offsets heurísticos desde el bounding box', () => {
  it('el offset de cadera de un rifle es notablemente mayor que el de una pistola', () => {
    const pistola = seedHipOffset(entry('pistol-1'))
    const rifle = seedHipOffset(entry('assaultrifle-1'))

    // El rifle mide ~0.85m de largo contra ~0.22m de la pistola: el offset
    // escalado por tamaño característico tiene que reflejar esa diferencia,
    // no quedar parecido "por las dudas".
    expect(Math.abs(rifle.x)).toBeGreaterThan(Math.abs(pistola.x) * 2)
    expect(Math.abs(rifle.y)).toBeGreaterThan(Math.abs(pistola.y) * 2)
    expect(Math.abs(rifle.z)).toBeGreaterThan(Math.abs(pistola.z) * 2)
  })

  it('la pose de cadera va abajo (y negativa) y a la derecha (x positiva) del centro', () => {
    for (const slug of ['pistol-1', 'assaultrifle-1', 'bullpup-1']) {
      const hip = seedHipOffset(entry(slug))
      expect(hip.x, slug).toBeGreaterThan(0)
      expect(hip.y, slug).toBeLessThan(0)
      // Tirada hacia la cámara: +Z, porque el cañón normalizado apunta a -Z.
      expect(hip.z, slug).toBeGreaterThan(0)
    }
  })

  it('la pose de ADS queda centrada horizontalmente (x = 0)', () => {
    for (const slug of ['pistol-1', 'assaultrifle-1', 'bullpup-1']) {
      expect(seedAdsOffset(entry(slug)).x, slug).toBe(0)
    }
  })

  it('la pose de ADS está más arriba que el centro y menos atrás que la pose de cadera', () => {
    for (const slug of ['pistol-1', 'assaultrifle-1']) {
      const e = entry(slug)
      const hip = seedHipOffset(e)
      const ads = seedAdsOffset(e)
      const centerY = (e.bounds.min[1] + e.bounds.max[1]) / 2
      expect(ads.y, slug).toBeGreaterThan(centerY)
      // ADS acerca el arma a la cámara en vez de alejarla: la componente
      // hacia +Z tiene que ser menor que en la pose de cadera.
      expect(ads.z, slug).toBeLessThan(hip.z)
    }
  })

  it('ninguna rotación queda seteada por la heurística: es sólo posición hasta que alguien la tunee a mano', () => {
    for (const entryData of weaponIndex()) {
      const { hipOffset, adsOffset } = seedWeaponOffsets(entryData)
      expect(hipOffset.rx).toBe(0)
      expect(hipOffset.ry).toBe(0)
      expect(hipOffset.rz).toBe(0)
      expect(adsOffset.rx).toBe(0)
      expect(adsOffset.ry).toBe(0)
      expect(adsOffset.rz).toBe(0)
    }
  })

  it('seedWeaponOffsets es determinista: mismo bounding box, mismo resultado', () => {
    const e = entry('assaultrifle-1')
    expect(seedWeaponOffsets(e)).toEqual(seedWeaponOffsets(e))
  })
})
