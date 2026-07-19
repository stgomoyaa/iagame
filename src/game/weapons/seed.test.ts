import { describe, expect, it } from 'vitest'
import { seedAdsOffset, seedHipOffset, seedWeaponOffsets, type WeaponIndexEntry } from '@/game/weapons/seed'
import { weaponIndex } from '@/game/weapons/registry'

function entry(slug: string): WeaponIndexEntry {
  const found = weaponIndex().find((e) => e.slug === slug)
  if (!found) throw new Error(`no está en index.json: ${slug}`)
  return found
}

describe('seed: offsets heurísticos desde el bounding box', () => {
  it('el offset de cadera de un rifle es apenas mayor que el de una pistola, no proporcional al tamaño', () => {
    const pistola = seedHipOffset(entry('pistol-1'))
    const rifle = seedHipOffset(entry('assaultrifle-1'))

    // Este test reemplaza uno que exigía rifle > pistola * 2: esa aserción
    // encodeaba justo el bug que motivó el fix (offset escalado
    // proporcional al tamaño del arma, HIP_BACK_FRAC * size, que ponía al
    // rifle a más de un metro de la cámara). El rifle mide ~3.9x lo que
    // mide la pistola (0.85m vs 0.22m); si el offset escalara con esa
    // proporción, el rifle quedaría a ~3.9x la distancia de la pistola. La
    // distancia real la fija el brazo del jugador, no el arma, así que la
    // diferencia entre ambas tiene que quedar muy por debajo de esa
    // proporción de tamaño.
    const sizeRatio = 0.85 / 0.22
    expect(Math.abs(rifle.x)).toBeLessThan(Math.abs(pistola.x) * sizeRatio)
    expect(Math.abs(rifle.y)).toBeLessThan(Math.abs(pistola.y) * sizeRatio)
    expect(Math.abs(rifle.z)).toBeLessThan(Math.abs(pistola.z) * sizeRatio)

    // Pero tampoco es idéntico: la culata de un rifle vive más lejos de su
    // propio centro que la de una pistola (ver el comentario de
    // HIP_SIZE_BACK_FRAC en seed.ts), así que el rifle sigue un poco más
    // atrás que la pistola en los tres ejes.
    expect(Math.abs(rifle.x)).toBeGreaterThan(Math.abs(pistola.x))
    expect(Math.abs(rifle.y)).toBeGreaterThan(Math.abs(pistola.y))
    expect(Math.abs(rifle.z)).toBeGreaterThan(Math.abs(pistola.z))

    // Y en términos absolutos, z queda a distancia de brazo extendido, no
    // "más de un metro" como el bug original (0.85 * HIP_BACK_FRAC 1.25 =
    // 1.0625).
    expect(rifle.z).toBeLessThan(1.0)
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
