import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractTextures } from './extract-textures.ts'
import { normalizeZipPath, type Pakfile, type PakfileEntry } from './pakfile.ts'
import { extractPakfileFromBsp } from './pakfile.ts'
import { VTF_FORMAT } from './vtf.ts'
import { buildVtfBuffer, solidRgba8888 } from './vtf-fixtures.ts'

/**
 * Pakfile fabricado a mano para probar la orquestación (patch/include,
 * cacheo, razones de skip) sin pasar por bytes de zip reales: Pakfile es
 * sólo una interfaz (Map + función), así que no hace falta más que esto
 * para que extractTextures no note la diferencia.
 */
function makeFakePakfile(files: Record<string, Buffer | string>): Pakfile {
  const raw = new Map<string, Buffer>()
  const entries = new Map<string, PakfileEntry>()
  for (const [path, content] of Object.entries(files)) {
    const norm = normalizeZipPath(path)
    raw.set(norm, typeof content === 'string' ? Buffer.from(content, 'utf8') : content)
    entries.set(norm, {
      normalizedName: norm,
      method: 0,
      compressedSize: 0,
      uncompressedSize: 0,
      localHeaderOffset: 0,
    })
  }
  return {
    entriesByNormalizedName: entries,
    readEntry: (p) => raw.get(normalizeZipPath(p)),
  }
}

function simpleVtf(): Buffer {
  return buildVtfBuffer({
    width: 2,
    height: 2,
    format: VTF_FORMAT.RGBA8888,
    mips: [solidRgba8888(2, 2, 100, 150, 200, 255)],
  })
}

describe('extractTextures: orquestación completa vmt -> vtf -> png', () => {
  it('material directo (sin patch): decodifica y arma el índice', () => {
    const pakfile = makeFakePakfile({
      'materials/plaster/wallpaper01.vmt': '"LightmappedGeneric" { "$basetexture" "plaster/wallpaper01" }',
      'materials/plaster/wallpaper01.vtf': simpleVtf(),
    })

    const result = extractTextures(pakfile, 1024)

    expect(result.materialsFound).toBe(1)
    expect(result.skipped).toEqual([])
    expect(result.textures).toHaveLength(1)
    expect(result.textures[0].materialName).toBe('PLASTER/WALLPAPER01')
    expect(result.textures[0].fileName).toMatch(/\.png$/)
    // El PNG real (firma) confirma que pasó por encodePng, no un mock.
    expect(result.textures[0].png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  })

  it('material con patch/include: sigue la cadena hasta el $basetexture del incluido', () => {
    const pakfile = makeFakePakfile({
      'materials/env/skin01.vmt': `
        "patch"
        {
            "include" "materials/plaster/wallpaper01.vmt"
            "replace" { "$envmap" "maps/gg_nuketown/c0_0_0" }
        }
      `,
      'materials/plaster/wallpaper01.vmt': '"LightmappedGeneric" { "$basetexture" "plaster/wallpaper01" }',
      'materials/plaster/wallpaper01.vtf': simpleVtf(),
    })

    const result = extractTextures(pakfile, 1024)

    // El pakfile trae DOS .vmt (el patch y su include, tal como pasaría en
    // un pakfile real donde el material base también quedó empacado): las
    // dos se decodifican, cada una es "un material usado" por derecho
    // propio. Lo que importa acá es que la del patch resolvió bien la
    // cadena hasta el $basetexture del incluido.
    expect(result.skipped).toEqual([])
    expect(result.textures).toHaveLength(2)
    const skin = result.textures.find((t) => t.materialName === 'ENV/SKIN01')
    expect(skin).toBeDefined()
    expect(skin?.fileName).toMatch(/\.png$/)
  })

  it('material sin $basetexture se salta con una razón legible', () => {
    const pakfile = makeFakePakfile({
      'materials/x.vmt': '"LightmappedGeneric" { "$surfaceprop" "brick" }',
    })

    const result = extractTextures(pakfile, 1024)

    expect(result.textures).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].materialName).toBe('X')
    expect(result.skipped[0].reason).toMatch(/basetexture/)
  })

  it('$basetexture que apunta a un .vtf ausente del pakfile se salta mencionando la ruta buscada', () => {
    const pakfile = makeFakePakfile({
      'materials/x.vmt': '"LightmappedGeneric" { "$basetexture" "no/existe" }',
    })

    const result = extractTextures(pakfile, 1024)

    expect(result.textures).toEqual([])
    expect(result.skipped[0].reason).toMatch(/materials\/no\/existe\.vtf/)
  })

  it('un formato VTF no soportado se salta reportando el id, no revienta toda la corrida', () => {
    const badVtf = buildVtfBuffer({ width: 4, height: 4, format: 999, mips: [Buffer.alloc(64)] })
    const pakfile = makeFakePakfile({
      'materials/ok.vmt': '"LightmappedGeneric" { "$basetexture" "plaster/wallpaper01" }',
      'materials/plaster/wallpaper01.vtf': simpleVtf(),
      'materials/bad.vmt': '"LightmappedGeneric" { "$basetexture" "raro/formato" }',
      'materials/raro/formato.vtf': badVtf,
    })

    const result = extractTextures(pakfile, 1024)

    expect(result.materialsFound).toBe(2)
    expect(result.textures).toHaveLength(1) // "ok" sí decodificó
    expect(result.textures[0].materialName).toBe('OK')
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].materialName).toBe('BAD')
    expect(result.skipped[0].reason).toMatch(/999/)
  })

  it('dos materiales que apuntan al mismo .vtf comparten el mismo archivo .png de salida', () => {
    const pakfile = makeFakePakfile({
      'materials/a.vmt': '"LightmappedGeneric" { "$basetexture" "shared/tex" }',
      'materials/b.vmt': '"LightmappedGeneric" { "$basetexture" "shared/tex" }',
      'materials/shared/tex.vtf': simpleVtf(),
    })

    const result = extractTextures(pakfile, 1024)

    expect(result.textures).toHaveLength(2)
    const [a, b] = result.textures
    expect(a.fileName).toBe(b.fileName)
    expect(a.png.equals(b.png)).toBe(true)
  })
})

const NUKETOWN_BSP = '/Users/santiago/dev/iagame/workshop-assets/maps/nuketown/maps/dm_nuketown.bsp'
const LASERTAG_BSP = '/Users/santiago/dev/iagame/workshop-assets/maps/lasertag/maps/gm_lasertag_arena.bsp'

/**
 * Contra los mapas reales del Workshop (fuera del repo, sólo lectura, ver
 * brief de la tarea): confirma que el pipeline completo no revienta con
 * datos reales y que decoded + skipped explica el 100% de los materiales
 * encontrados. No hardcodea un conteo exacto de texturas: eso depende del
 * contenido del pakfile en el momento, y ya se reporta aparte con la corrida
 * real del CLI.
 */
describe.each([
  ['nuketown', NUKETOWN_BSP],
  ['lasertag', LASERTAG_BSP],
])('extractTextures contra %s (mapa real)', (_label, bspPath) => {
  it(
    'decodifica sin tirar excepción y decoded+skipped cubre todos los materiales encontrados',
    () => {
      const bsp = readFileSync(bspPath)
      const pakfile = extractPakfileFromBsp(bsp)
      const result = extractTextures(pakfile, 1024)

      expect(result.materialsFound).toBeGreaterThan(0)
      expect(result.textures.length + result.skipped.length).toBe(result.materialsFound)
      // Que haya decodificado AL MENOS una textura real: si todo se saltara
      // (ej. por un bug que rompe la resolución de rutas) este assert lo agarra.
      expect(result.textures.length).toBeGreaterThan(0)
    },
    60_000,
  )
})
