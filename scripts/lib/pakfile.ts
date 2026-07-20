/**
 * Lectura mínima y autocontenida del pakfile embebido en un .bsp de Source.
 *
 * Ni esto ni scripts/lib/vtf.ts ni scripts/lib/vmt.ts dependen del parser de
 * BSP que se está escribiendo en paralelo (scripts/lib/bsp.ts, tarea
 * distinta): sólo hace falta el lump 40 (pakfile), que es un ZIP estándar
 * embebido tal cual dentro del .bsp. Todo lo demás del formato BSP
 * (texinfo, texdata, geometría) es harina de otro costal.
 */

import { inflateRawSync } from 'node:zlib'

const BSP_SIGNATURE = 'VBSP'

/** Después de "VBSP" (4 bytes) + versión (int32, 4 bytes) empieza el directorio de 64 lumps. */
const LUMP_DIR_OFFSET = 8

/** Cada lump_t es { fileofs, filelen, version, fourCC } de 4 bytes cada uno. */
const LUMP_ENTRY_SIZE = 16

/** El pakfile (un zip completo) vive en el lump 40. */
const PAKFILE_LUMP_INDEX = 40

const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50
const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50

/** Tamaño fijo del End Of Central Directory record, sin contar el comment variable. */
const EOCD_FIXED_SIZE = 22

/** Tamaño fijo de una entrada de directorio central, sin contar name/extra/comment. */
const CENTRAL_DIR_FIXED_SIZE = 46

/** Tamaño fijo de una cabecera local, sin contar name/extra. */
const LOCAL_HEADER_FIXED_SIZE = 30

export interface PakfileEntry {
  /** Ruta dentro del zip, normalizada (ver normalizeZipPath): siempre en minúsculas y con '/'. */
  readonly normalizedName: string
  readonly method: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localHeaderOffset: number
}

export interface Pakfile {
  readonly entriesByNormalizedName: ReadonlyMap<string, PakfileEntry>
  /**
   * Devuelve el contenido ya descomprimido de una entrada, o undefined si no
   * existe. Acepta la ruta como venga (mayúsculas, '\' mezclado con '/'): la
   * normaliza antes de buscar, porque así es como Source la escribe en el
   * VMT/BSP y buscar sin normalizar deja la mitad de los archivos sin
   * encontrar.
   */
  readEntry(path: string): Buffer | undefined
}

/**
 * '\' -> '/', todo a minúsculas, sin '/' inicial. Las rutas de Source no
 * distinguen mayúsculas de minúsculas y usan ambos separadores según de
 * dónde vengan (BSP, VMT, o el propio zip); normalizar antes de comparar es
 * la única forma de no perder la mitad de las coincidencias.
 */
export function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase().replace(/^\/+/, '')
}

/** El EOCD puede tener hasta 65535 bytes de comment después, así que se busca desde el final. */
function findEndOfCentralDirectory(zip: Buffer): number {
  const minOffset = Math.max(0, zip.length - EOCD_FIXED_SIZE - 0xffff)
  for (let offset = zip.length - EOCD_FIXED_SIZE; offset >= minOffset; offset--) {
    if (zip.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset
  }
  throw new Error('pakfile: no se encontró el End Of Central Directory (¿el lump 40 no es un zip válido?)')
}

/** Parsea un buffer de zip standalone (ya recortado del .bsp) en un Pakfile consultable. */
export function parsePakfile(zip: Buffer): Pakfile {
  const eocdOffset = findEndOfCentralDirectory(zip)
  const entryCount = zip.readUInt16LE(eocdOffset + 10)
  const centralDirOffset = zip.readUInt32LE(eocdOffset + 16)

  const entriesByNormalizedName = new Map<string, PakfileEntry>()

  let pos = centralDirOffset
  for (let i = 0; i < entryCount; i++) {
    const signature = zip.readUInt32LE(pos)
    if (signature !== ZIP_CENTRAL_DIR_SIGNATURE) {
      throw new Error(
        `pakfile: entrada ${i} del directorio central no empieza con la firma esperada (offset ${pos})`,
      )
    }
    const method = zip.readUInt16LE(pos + 10)
    const compressedSize = zip.readUInt32LE(pos + 20)
    const uncompressedSize = zip.readUInt32LE(pos + 24)
    const nameLength = zip.readUInt16LE(pos + 28)
    const extraLength = zip.readUInt16LE(pos + 30)
    const commentLength = zip.readUInt16LE(pos + 32)
    const localHeaderOffset = zip.readUInt32LE(pos + 42)
    const name = zip.toString('utf8', pos + CENTRAL_DIR_FIXED_SIZE, pos + CENTRAL_DIR_FIXED_SIZE + nameLength)

    const normalizedName = normalizeZipPath(name)
    entriesByNormalizedName.set(normalizedName, {
      normalizedName,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })

    pos += CENTRAL_DIR_FIXED_SIZE + nameLength + extraLength + commentLength
  }

  function readEntry(path: string): Buffer | undefined {
    const entry = entriesByNormalizedName.get(normalizeZipPath(path))
    if (!entry) return undefined

    const localSignature = zip.readUInt32LE(entry.localHeaderOffset)
    if (localSignature !== ZIP_LOCAL_HEADER_SIGNATURE) {
      throw new Error(
        `pakfile: cabecera local inválida para "${entry.normalizedName}" (offset ${entry.localHeaderOffset})`,
      )
    }
    const localNameLength = zip.readUInt16LE(entry.localHeaderOffset + 26)
    const localExtraLength = zip.readUInt16LE(entry.localHeaderOffset + 28)
    const dataOffset = entry.localHeaderOffset + LOCAL_HEADER_FIXED_SIZE + localNameLength + localExtraLength
    const compressed = zip.subarray(dataOffset, dataOffset + entry.compressedSize)

    // Las entradas de un pakfile de Source casi siempre van sin comprimir
    // (bspzip prioriza velocidad de carga sobre tamaño); deflate es el único
    // otro método que aparece en la práctica. Cualquier otra cosa (zip64,
    // otros algoritmos) se reporta en vez de intentar adivinar.
    if (entry.method === 0) return Buffer.from(compressed)
    if (entry.method === 8) return inflateRawSync(compressed)
    throw new Error(`pakfile: método de compresión ${entry.method} no soportado para "${entry.normalizedName}"`)
  }

  return { entriesByNormalizedName, readEntry }
}

/** Lee la cabecera del .bsp, ubica el lump 40 (pakfile) y lo devuelve ya parseado como zip. */
export function extractPakfileFromBsp(bsp: Buffer): Pakfile {
  const signature = bsp.toString('ascii', 0, 4)
  if (signature !== BSP_SIGNATURE) {
    throw new Error(`no es un .bsp de Source: firma "${signature}" (se esperaba "${BSP_SIGNATURE}")`)
  }

  const lumpOffset = LUMP_DIR_OFFSET + PAKFILE_LUMP_INDEX * LUMP_ENTRY_SIZE
  const fileOffset = bsp.readInt32LE(lumpOffset)
  const fileLength = bsp.readInt32LE(lumpOffset + 4)

  if (fileOffset < 0 || fileLength <= 0 || fileOffset + fileLength > bsp.length) {
    throw new Error(`.bsp: el lump del pakfile (40) tiene un rango inválido (offset ${fileOffset}, largo ${fileLength})`)
  }

  const pakfileBytes = bsp.subarray(fileOffset, fileOffset + fileLength)
  return parsePakfile(pakfileBytes)
}
