import { describe, expect, it } from 'vitest'
import { parseVmt, resolveBaseTexture, type VmtIncludeResolver } from './vmt.ts'

const noIncludes: VmtIncludeResolver = { readVmt: () => undefined }

describe('parseVmt + resolveBaseTexture', () => {
  it('lee $basetexture de un VMT directo (sin patch)', () => {
    const text = `
      "LightmappedGeneric"
      {
          "$basetexture" "brick/brickwall001"
          "$surfaceprop" "brick"
      }
    `
    const block = parseVmt(text)
    expect(resolveBaseTexture(block, noIncludes)).toBe('brick/brickwall001')
  })

  it('es insensible a mayúsculas en las keys', () => {
    const text = `"LightmappedGeneric" { "$BaseTexture" "brick/brickwall001" }`
    expect(resolveBaseTexture(parseVmt(text), noIncludes)).toBe('brick/brickwall001')
  })

  it('ignora comentarios "//"', () => {
    const text = `
      "LightmappedGeneric"
      {
          // esto no es una key
          "$basetexture" "brick/brickwall001" // tampoco esto
      }
    `
    expect(resolveBaseTexture(parseVmt(text), noIncludes)).toBe('brick/brickwall001')
  })

  it('sin $basetexture, devuelve undefined en vez de inventar algo', () => {
    const text = `"LightmappedGeneric" { "$surfaceprop" "brick" }`
    expect(resolveBaseTexture(parseVmt(text), noIncludes)).toBeUndefined()
  })

  it('sigue "patch" -> "include" hasta el $basetexture del incluido', () => {
    const patchText = `
      "patch"
      {
          "include" "materials/plaster/wallpaper01.vmt"
          "replace" { "$envmap" "maps/gg_nuketown/c0_0_0" }
      }
    `
    const includedText = `"LightmappedGeneric" { "$basetexture" "plaster/wallpaper01" }`

    const resolver: VmtIncludeResolver = {
      readVmt: (path) => (path === 'materials/plaster/wallpaper01.vmt' ? includedText : undefined),
    }

    expect(resolveBaseTexture(parseVmt(patchText), resolver)).toBe('plaster/wallpaper01')
  })

  it('"replace" con su propio $basetexture pisa el del include', () => {
    const patchText = `
      "patch"
      {
          "include" "materials/plaster/wallpaper01.vmt"
          "replace" { "$basetexture" "plaster/wallpaper01_variant" }
      }
    `
    const includedText = `"LightmappedGeneric" { "$basetexture" "plaster/wallpaper01" }`

    const resolver: VmtIncludeResolver = {
      readVmt: () => includedText,
    }

    expect(resolveBaseTexture(parseVmt(patchText), resolver)).toBe('plaster/wallpaper01_variant')
  })

  it('un include circular no cuelga el proceso: el límite de profundidad corta la recursión', () => {
    // A se incluye a sí mismo. Sin el límite de profundidad, esto sería recursión infinita.
    const circularText = `
      "patch"
      {
          "include" "materials/circular.vmt"
      }
    `
    const resolver: VmtIncludeResolver = {
      readVmt: () => circularText,
    }

    expect(resolveBaseTexture(parseVmt(circularText), resolver)).toBeUndefined()
  })

  it('include a un archivo que no está en el pakfile no revienta, sólo no encuentra basetexture', () => {
    const patchText = `"patch" { "include" "materials/no_existe.vmt" }`
    expect(resolveBaseTexture(parseVmt(patchText), noIncludes)).toBeUndefined()
  })
})
