/**
 * Tests de la lógica pura del preparador de sonidos de disparo.
 *
 * Los casos NO son inventados: cada uno reproduce una ruta real de los tres
 * packs que ya rompió una versión anterior de estas reglas (el .mp3 de M9k
 * que parecía disparo y era una recarga, el `fire_dist` que es la versión
 * lejana, el `bo1_python` que esconde un Judge). Ver el encabezado de
 * weapon-sounds.ts para el razonamiento.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SOURCE_WEAPONS } from '@/game/weapons/source-catalog'
import { ASIGNACION, clasificarArchivo, clasificarCarpeta, normalizarToken } from './weapon-sounds.ts'

describe('clasificarArchivo', () => {
  it('en M9k toma los .wav de weapons/ como disparo', () => {
    expect(clasificarArchivo('m9k', 'sound/weapons/auga3/aug-1.wav')).toEqual({
      arma: 'auga3',
      archivo: 'aug-1.wav',
    })
  })

  it('en M9k descarta los .mp3, que son mecánica y no disparo', () => {
    // Éste es el caso que invierte la premisa "M9k ya viene en mp3": los 465
    // mp3 del pack son magin/magout/boltpull, no disparos.
    expect(clasificarArchivo('m9k', 'sound/weapons/auga3/clipin.mp3')).toBeNull()
    expect(clasificarArchivo('m9k', 'sound/weapons/amd65/boltpull.mp3')).toBeNull()
  })

  it('ignora lo que está fuera de la raíz de armas', () => {
    // Voces y memes que M9k deja sueltos en sound/.
    expect(clasificarArchivo('m9k', 'sound/wilhelm.wav')).toBeNull()
    expect(clasificarArchivo('m9k', 'sound/we_suck_again.wav')).toBeNull()
  })

  it('rechaza rutas más anidadas que <arma>/<archivo>', () => {
    expect(clasificarArchivo('m9k', 'sound/weapons/gdc/rockets/x.wav')).toBeNull()
  })

  it('en ARC9 toma fire.wav y fireN.wav', () => {
    expect(clasificarArchivo('mwclassic', 'sound/weapons/arc9/cod4_ak47/fire.wav')?.arma).toBe('cod4_ak47')
    expect(clasificarArchivo('blackops', 'sound/weapons/arc9/bo1_ak47/fire3.wav')?.arma).toBe('bo1_ak47')
  })

  it('en ARC9 descarta la versión lejana y los loops', () => {
    // fire_dist es el disparo OÍDO DE LEJOS: apagado y sin cuerpo. Usarlo en
    // primera persona suena a que el arma falló.
    expect(clasificarArchivo('blackops', 'sound/weapons/arc9/bo1_ak47/dist1.wav')).toBeNull()
    expect(clasificarArchivo('blackops', 'sound/weapons/arc9/waw_dist/fire_dist.wav')).toBeNull()
    expect(clasificarArchivo('blackops', 'sound/weapons/arc9/bo2_vulcan/fire_loop.wav')).toBeNull()
    expect(clasificarArchivo('blackops', 'sound/weapons/arc9/bo2_vulcan/fire_start.wav')).toBeNull()
    expect(clasificarArchivo('blackops', 'sound/weapons/arc9/bo2_vulcan/fire_stop.wav')).toBeNull()
  })

  it('en ARC9 descarta lo que no empieza con fire', () => {
    expect(clasificarArchivo('mwclassic', 'sound/weapons/arc9/cod4_ak47/chamber.wav')).toBeNull()
    expect(clasificarArchivo('blackops', 'sound/weapons/arc9/waw_shotgun/shotgun_shell_00.wav')).toBeNull()
  })
})

describe('clasificarCarpeta', () => {
  it('agrupa las variantes canónicas bajo una sola arma', () => {
    const r = clasificarCarpeta('blackops', 'bo1_ak47', [
      'fire1.wav',
      'fire2.wav',
      'fire3.wav',
      'ak_boltback.wav',
      'dist1.wav',
    ])
    expect([...r.keys()]).toEqual(['bo1_ak47'])
    expect(r.get('bo1_ak47')).toEqual(['fire1.wav', 'fire2.wav', 'fire3.wav'])
  })

  it('cuando hay canónicas, ignora las fire_<algo> que son OTRA arma', () => {
    // bo1_python guarda un Judge y un NMA de prestado. Si se colaran, el
    // revólver dispararía a veces como una escopeta-pistola.
    const r = clasificarCarpeta('blackops', 'bo1_python', [
      'fire1.wav',
      'fire2.wav',
      'fire_judge.wav',
      'fire_nma.wav',
    ])
    expect([...r.keys()]).toEqual(['bo1_python'])
    expect(r.get('bo1_python')).toEqual(['fire1.wav', 'fire2.wav'])
  })

  it('sin canónicas, cada fire_<algo> es su propia fuente', () => {
    // El Deagle sólo trae calibres; agruparlos daría "variantes" que suenan a
    // tres armas distintas, y descartarlos lo dejaría mudo.
    const r = clasificarCarpeta('mwclassic', 'mw3e_deagle', [
      'fire_44.wav',
      'fire_50.wav',
      'fire_357.wav',
      'lift.wav',
    ])
    expect([...r.keys()].sort()).toEqual(['mw3e_deagle__357', 'mw3e_deagle__44', 'mw3e_deagle__50'])
    expect(r.get('mw3e_deagle__50')).toEqual(['fire_50.wav'])
  })

  it('parte los pozos *generic*, que son varias armas en una carpeta', () => {
    const r = clasificarCarpeta('blackops', 'bo2_generic_smg', [
      'fire_msmc.wav',
      'fire_chicom.wav',
      'fire_pdw.wav',
    ])
    expect([...r.keys()].sort()).toEqual([
      'bo2_generic_smg__chicom',
      'bo2_generic_smg__msmc',
      'bo2_generic_smg__pdw',
    ])
  })

  it('en M9k agrupa todos los .wav de la carpeta', () => {
    const r = clasificarCarpeta('m9k', 'auga3', ['aug-1.wav', 'aug-2.wav', 'clipin.mp3', 'boltpull.mp3'])
    expect(r.get('auga3')).toEqual(['aug-1.wav', 'aug-2.wav'])
  })

  it('devuelve vacío para carpetas sin disparo', () => {
    expect(clasificarCarpeta('blackops', 'bo1_knife', ['swing.wav', 'hit.wav']).size).toBe(0)
    expect(clasificarCarpeta('mwclassic', 'cod4_mp44', ['chamber.wav', 'in.wav']).size).toBe(0)
  })
})

describe('ASIGNACION', () => {
  /** Las 79 armas reales del catálogo, leídas de sus dos fuentes de verdad. */
  function slugsDelCatalogo(): string[] {
    const cc0 = JSON.parse(
      readFileSync(join(process.cwd(), 'public/assets/weapons/index.json'), 'utf8'),
    ) as { slug: string }[]
    return [...SOURCE_WEAPONS.map((w) => w.slug), ...cc0.map((w) => w.slug)]
  }

  it('cubre exactamente el catálogo, sin faltantes ni sobrantes', () => {
    // Ata la tabla al catálogo real: si alguien agrega un arma y no le pone
    // sonido, esto falla acá y no en silencio dentro del juego.
    expect(Object.keys(ASIGNACION).sort()).toEqual(slugsDelCatalogo().sort())
  })

  it('apunta siempre a un pack conocido', () => {
    for (const fuente of Object.values(ASIGNACION)) {
      expect(fuente).toMatch(/^(m9k|mwclassic|blackops)__.+/)
    }
  })

  it('sólo comparte fuente entre un arma y su variante sin mira', () => {
    // Compartir sonido está bien SÓLO entre `x` y `x_scopeless` (son la misma
    // arma). Cualquier otro par compartiendo fuente es un descuido que dejaría
    // dos armas distintas sonando igual.
    const porFuente = new Map<string, string[]>()
    for (const [slug, fuente] of Object.entries(ASIGNACION)) {
      porFuente.set(fuente, [...(porFuente.get(fuente) ?? []), slug])
    }
    for (const [, slugs] of porFuente) {
      if (slugs.length === 1) continue
      const base = [...new Set(slugs.map((s) => s.replace(/_scopeless$/, '')))]
      expect(base).toHaveLength(1)
    }
  })
})

describe('normalizarToken', () => {
  it('saca el prefijo del pack y el sufijo de variante', () => {
    expect(normalizarToken('cod4_ak47')).toBe('ak')
    expect(normalizarToken('bo1_famas')).toBe('famas')
    expect(normalizarToken('mw3e_mp7')).toBe('mp')
  })
})
