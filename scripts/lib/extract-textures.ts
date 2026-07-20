/**
 * Orquesta la cadena completa por cada material que aparece en el pakfile:
 *
 *   materials/plaster/wallpaper01.vmt (encontrado en el zip)
 *     -> resolver patch/include si lo hay
 *     -> leer $basetexture
 *     -> materials/<eso>.vtf
 *     -> decodificar a RGBA
 *     -> codificar a PNG
 *
 * Devuelve todo en memoria (nada de fs acá): así se puede probar con un
 * Pakfile fabricado a mano, sin tocar disco ni depender de los .bsp reales.
 * scripts/extract-textures.ts (el CLI) es el único que escribe archivos.
 */

import type { Pakfile } from './pakfile.ts'
import { decodeVtf } from './vtf.ts'
import { encodePng } from './png-writer.ts'
import { parseVmt, resolveBaseTexture } from './vmt.ts'
import { resolveMaterialPath } from './source-paths.ts'

export interface ExtractedTexture {
  readonly materialName: string
  readonly fileName: string
  readonly png: Buffer
}

export interface SkippedMaterial {
  readonly materialName: string
  readonly reason: string
}

export interface ExtractionResult {
  readonly materialsFound: number
  readonly textures: readonly ExtractedTexture[]
  readonly skipped: readonly SkippedMaterial[]
}

/** "materials/plaster/wallpaper01.vmt" -> "PLASTER/WALLPAPER01": así referencia Source sus materiales desde el BSP (ver brief). */
function materialNameFromVmtPath(normalizedVmtPath: string): string {
  return normalizedVmtPath.replace(/^materials\//, '').replace(/\.vmt$/, '').toUpperCase()
}

function slugifyMaterialName(materialName: string): string {
  return materialName.toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

export function extractTextures(pakfile: Pakfile, maxSize: number): ExtractionResult {
  const vmtEntries = [...pakfile.entriesByNormalizedName.values()].filter(
    (e) => e.normalizedName.startsWith('materials/') && e.normalizedName.endsWith('.vmt'),
  )

  const textures: ExtractedTexture[] = []
  const skipped: SkippedMaterial[] = []
  // Dos materiales pueden apuntar al mismo .vtf (normal maps compartidos,
  // variantes de color de la misma textura base): decodificar una sola vez
  // por ruta de .vtf evita repetir el trabajo de DXT + deflate.
  const decodedByVtfPath = new Map<string, { fileName: string; png: Buffer }>()

  for (const entry of vmtEntries) {
    const materialName = materialNameFromVmtPath(entry.normalizedName)
    try {
      const vmtBuf = pakfile.readEntry(entry.normalizedName)
      if (vmtBuf === undefined) {
        skipped.push({ materialName, reason: 'no se pudo leer el .vmt del pakfile' })
        continue
      }

      const block = parseVmt(vmtBuf.toString('utf8'))
      const baseTexture = resolveBaseTexture(block, {
        readVmt: (path) => {
          const resolved = resolveMaterialPath(path, '.vmt')
          return pakfile.readEntry(resolved)?.toString('utf8')
        },
      })
      if (baseTexture === undefined) {
        skipped.push({ materialName, reason: 'sin $basetexture (directo ni vía patch/include)' })
        continue
      }

      const vtfPath = resolveMaterialPath(baseTexture, '.vtf')

      const cached = decodedByVtfPath.get(vtfPath)
      if (cached) {
        textures.push({ materialName, fileName: cached.fileName, png: cached.png })
        continue
      }

      const vtfBuf = pakfile.readEntry(vtfPath)
      if (vtfBuf === undefined) {
        skipped.push({
          materialName,
          reason: `$basetexture "${baseTexture}" no encontrado en el pakfile (${vtfPath})`,
        })
        continue
      }

      const image = decodeVtf(vtfBuf, maxSize)
      const png = encodePng(image.width, image.height, image.rgba)
      const fileName = `${slugifyMaterialName(materialName)}.png`

      decodedByVtfPath.set(vtfPath, { fileName, png })
      textures.push({ materialName, fileName, png })
    } catch (err) {
      skipped.push({ materialName, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  return { materialsFound: vmtEntries.length, textures, skipped }
}
