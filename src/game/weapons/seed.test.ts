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

  it('un arma LOCAL (CS nativa o COD injertada con brazos) se posa en cadera NEUTRA, no con el empujón de mundo', () => {
    // El injerto de brazos (viewmodel/graft.ts) convierte a las 69 de COD en
    // viewmodels ya posados que cuelgan del ojo del jugador, igual que las de
    // CS. La heurística de mundo (empujar abajo/derecha/atrás) sólo las corría
    // de donde ya estaban bien y estiraba los brazos (foto del dueño). La
    // semilla correcta para TODO lo local es cero.
    const csNativa = seedHipOffset({
      slug: 'ak47', name: 'AK-47 (CS)', triangles: 1, upAxisConfidence: 1,
      muzzleConfidence: 1, needsManualReview: false, origin: 'local', viewmodel: true,
      bounds: { min: [-0.05, -0.15, -0.42], max: [0.05, 0.15, 0.42] },
    })
    // Una de COD: local pero SIN viewmodel === true (el flag no lo trae; los
    // brazos se los pone el renderer). Igual tiene que salir neutra.
    const codInjertada = seedHipOffset({
      slug: 'cod4_ak47', name: 'AK-47 (COD)', triangles: 1, upAxisConfidence: 1,
      muzzleConfidence: 1, needsManualReview: false, origin: 'local',
      bounds: { min: [-0.05, -0.15, -0.42], max: [0.05, 0.15, 0.42] },
    })
    for (const hip of [csNativa, codInjertada]) {
      expect(hip).toEqual({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 })
    }
    // Y una CC0 (modelo de mundo sin brazos) SÍ conserva el empujón: no se toca.
    const cc0 = seedHipOffset(entry('assaultrifle-1'))
    expect(cc0.x).toBeGreaterThan(0)
    expect(cc0.z).toBeGreaterThan(0)
  })

  it('la pose de ADS queda centrada horizontalmente (x = 0)', () => {
    for (const slug of ['pistol-1', 'assaultrifle-1', 'bullpup-1']) {
      expect(seedAdsOffset(entry(slug)).x, slug).toBe(0)
    }
  })

  it('la pose de ADS queda por debajo del centro -no por arriba- y más cerca de la cámara que la pose de cadera', () => {
    // Reemplaza un test que exigía ads.y > centerY: encodeaba justo el bug
    // que motivó este fix (adsOffset.y positivo, que sube el CENTRO del
    // modelo por encima de su propio centro en vez de bajarlo). La mira
    // vive montada sizeY/2 por ENCIMA del centro del bounding box, así que
    // para que sea la mira -no el cuerpo del arma- la que caiga en el eje
    // de la cámara, el centro tiene que quedar esa misma distancia por
    // DEBAJO de ese eje. Con el signo viejo la cruceta quedaba enterrada en
    // el cuerpo del arma en vez de sobre la mira (ver seedAdsOffset en
    // seed.ts para la derivación completa).
    for (const slug of ['pistol-1', 'assaultrifle-1']) {
      const e = entry(slug)
      const hip = seedHipOffset(e)
      const ads = seedAdsOffset(e)
      const centerY = (e.bounds.min[1] + e.bounds.max[1]) / 2
      const sizeY = e.bounds.max[1] - e.bounds.min[1]
      expect(ads.y, slug).toBeLessThan(centerY)
      expect(ads.y, slug).toBeCloseTo(centerY - sizeY / 2, 10)
      // ADS acerca el arma a la cámara en vez de alejarla: la componente
      // hacia +Z tiene que ser menor que en la pose de cadera.
      expect(ads.z, slug).toBeLessThan(hip.z)
    }
  })

  it('adsOffset.y de assaultrifle-1 según la heurística cae a ~1.4% del valor tuneado a mano por Santiago (-0.175)', () => {
    // No es el valor final -assaultrifle-1 usa el override de
    // weapons_tuning.json, no la heurística, ver registry/tuning-panel- pero
    // sirve de test de cordura: confirma que -(sizeY / 2) efectivamente
    // reproduce el número que un humano encontró mirando la pantalla, no
    // sólo que "suena razonable" en la teoría.
    const e = entry('assaultrifle-1')
    const ads = seedAdsOffset(e)
    expect(ads.y).toBeCloseTo(-0.175, 2)
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

  // Entrada sintética estilo pack de COD: caja simétrica (min = -max, como
  // salen de buildNormalizeMatrix) con mira medida y su profundidad de alza.
  function codEntry(over: Partial<WeaponIndexEntry>): WeaponIndexEntry {
    return {
      slug: 'test-cod',
      name: 'Test (COD)',
      triangles: 1000,
      bounds: { min: [-0.05, -0.15, -0.425], max: [0.05, 0.15, 0.425] },
      muzzleConfidence: 1,
      upAxisConfidence: 1,
      needsManualReview: false,
      origin: 'local',
      sightHeight: 0.15,
      sightLateral: 0,
      sightRearZ: 0.23,
      ...over,
    }
  }

  it('ADS de un arma LOCAL (injertada) es POSE_NEUTRA: el stopgap del ADS de COD', () => {
    // El injerto de brazos donantes (viewmodel/graft.ts) mueve el rig entero,
    // así que la mira medida pre-injerto (sightRearZ) ya no corresponde a la
    // pose que se DIBUJA: anclar el arma a esa medición la trasladaba abajo y
    // lejos de la cámara (se veía ACHICAR al apuntar). El stopgap la deja en su
    // pose de cadera (neutra, como seedHipOffset) y el acercamiento lo hace el
    // zoom de FOV del estilo COD. Igual que la exención de seedHipOffset.
    const ads = seedAdsOffset(codEntry({ sightRearZ: 0.23 }))
    expect(ads).toEqual({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 })
  })

  it('el ADS local es POSE_NEUTRA sin importar la mira medida (se ignora post-injerto)', () => {
    // Cualquier sightRearZ/sightHeight da lo mismo: la medición se descarta
    // porque el injerto la invalidó. sightRearZ se conserva en el índice para
    // el fix por matriz (el injerto transformaría el punto de mira), aparte.
    const a = seedAdsOffset(codEntry({ sightRearZ: 0.23 }))
    const b = seedAdsOffset(codEntry({ sightRearZ: -0.05 }))
    const c = seedAdsOffset(codEntry({ sightRearZ: undefined, sightHeight: undefined }))
    expect(a).toEqual(b)
    expect(a).toEqual(c)
    expect(a.z).toBe(0)
  })

  it('un arma CC0 (origin cc0) NO recibe la exención: conserva su heurística de ADS', () => {
    // El stopgap es sólo para las injertadas (origin local). Las CC0 no se
    // injertan, así que su heurística de ADS (y = -sizeY/2) sigue como estaba.
    const cc0 = seedAdsOffset(entry('assaultrifle-1'))
    expect(cc0.y).not.toBe(0)
  })
})
