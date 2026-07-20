/**
 * Decodificador de texturas VTF (Valve Texture Format) a RGBA8888 plano.
 *
 * La trampa principal del formato: los datos de imagen, después de la
 * cabecera, traen PRIMERO la miniatura de baja resolución (lowres, típico
 * DXT1 de 16x16) y RECIÉN DESPUÉS las mips de la imagen grande, ordenadas de
 * la más chica a la más grande. La mip 0 (resolución completa, la que
 * interesa) es la ÚLTIMA del archivo. Leer desde el principio "funciona"
 * (produce una imagen con dimensiones que parecen razonables) pero decodifica
 * una miniatura equivocada — por eso este módulo nunca lee "desde el
 * principio": calcula el offset exacto de la mip elegida sumando el tamaño
 * de todo lo que la precede.
 *
 * Sólo se implementan los 7 formatos que aparecen en la práctica en mapas de
 * Source (ver VTF_FORMAT). Cualquier otro formato se reporta por su id y se
 * aborta la textura: adivinar un formato no soportado produce basura con
 * dimensiones correctas, que es peor que no tener la textura.
 */

export const VTF_FORMAT = {
  RGBA8888: 0,
  RGB888: 2,
  BGR888: 3,
  BGRA8888: 12,
  DXT1: 13,
  DXT3: 14,
  DXT5: 15,
} as const

/** uint32 0xFFFFFFFF (-1 como int32): "esta imagen no existe". Aparece sobre todo en lowResImageFormat. */
const FORMAT_NONE = 0xffffffff

const VTF_SIGNATURE = 'VTF\0'

export interface VtfImage {
  readonly width: number
  readonly height: number
  /** RGBA8888 fila por fila, de arriba hacia abajo — el mismo orden que espera encodePng. */
  readonly rgba: Uint8Array
}

interface VtfHeader {
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly mipmapCount: number
  readonly highResImageFormat: number
  readonly lowResImageFormat: number
  readonly lowResImageWidth: number
  readonly lowResImageHeight: number
  readonly headerSize: number
}

/**
 * Offsets fijos del header VTF 7.0+ (struct VTFHEADER de la SDK de Valve).
 * Los campos que agregan las versiones 7.2/7.3+ (depth, resources...) caen
 * DESPUÉS de lowResImageHeight y nunca se leen acá: headerSize (leído del
 * propio archivo) es lo que le dice a decodeVtf dónde empieza la data de
 * imagen, así que no importa de qué subversión exacta sea el archivo.
 */
const HEADER_OFFSET = {
  signature: 0,
  headerSize: 12,
  width: 16,
  height: 18,
  frames: 24,
  highResImageFormat: 52,
  mipmapCount: 56,
  lowResImageFormat: 57,
  lowResImageWidth: 61,
  lowResImageHeight: 62,
} as const

function readHeader(buf: Buffer): VtfHeader {
  const signature = buf.toString('ascii', HEADER_OFFSET.signature, HEADER_OFFSET.signature + 4)
  if (signature !== VTF_SIGNATURE) {
    throw new Error(`no es un .vtf: firma "${signature}"`)
  }
  return {
    headerSize: buf.readUInt32LE(HEADER_OFFSET.headerSize),
    width: buf.readUInt16LE(HEADER_OFFSET.width),
    height: buf.readUInt16LE(HEADER_OFFSET.height),
    frames: Math.max(1, buf.readUInt16LE(HEADER_OFFSET.frames)),
    highResImageFormat: buf.readUInt32LE(HEADER_OFFSET.highResImageFormat),
    mipmapCount: Math.max(1, buf.readUInt8(HEADER_OFFSET.mipmapCount)),
    lowResImageFormat: buf.readUInt32LE(HEADER_OFFSET.lowResImageFormat),
    lowResImageWidth: buf.readUInt8(HEADER_OFFSET.lowResImageWidth),
    lowResImageHeight: buf.readUInt8(HEADER_OFFSET.lowResImageHeight),
  }
}

function blockCount(dim: number): number {
  return Math.max(1, Math.ceil(dim / 4))
}

/** Bytes que ocupa una imagen completa (no un solo bloque) en el formato dado. undefined si el formato no está soportado. */
export function formatByteSize(format: number, width: number, height: number): number | undefined {
  switch (format) {
    case VTF_FORMAT.RGBA8888:
    case VTF_FORMAT.BGRA8888:
      return width * height * 4
    case VTF_FORMAT.RGB888:
    case VTF_FORMAT.BGR888:
      return width * height * 3
    case VTF_FORMAT.DXT1:
      return blockCount(width) * blockCount(height) * 8
    case VTF_FORMAT.DXT3:
    case VTF_FORMAT.DXT5:
      return blockCount(width) * blockCount(height) * 16
    default:
      return undefined
  }
}

export function isSupportedVtfFormat(format: number): boolean {
  return formatByteSize(format, 1, 1) !== undefined
}

function mipDimension(base: number, level: number): number {
  return Math.max(1, base >> level)
}

/**
 * Decodifica la mip más grande que entra en maxSize (el lado mayor <=
 * maxSize), leyéndola directo del archivo en vez de decodificar la mip 0 y
 * reescalarla a mano: las mips ya vienen generadas por la herramienta de
 * compilación de Source y son de mejor calidad que cualquier resize casero.
 */
export function decodeVtf(buf: Buffer, maxSize: number): VtfImage {
  const header = readHeader(buf)

  if (!isSupportedVtfFormat(header.highResImageFormat)) {
    throw new Error(`formato VTF no soportado: id ${header.highResImageFormat}`)
  }

  let lowResSize = 0
  if (header.lowResImageFormat !== FORMAT_NONE) {
    const size = formatByteSize(header.lowResImageFormat, header.lowResImageWidth, header.lowResImageHeight)
    if (size === undefined) {
      throw new Error(`formato de miniatura VTF no soportado: id ${header.lowResImageFormat}`)
    }
    lowResSize = size
  }

  // Nivel 0 = resolución completa. Se busca el nivel más chico posible (el
  // índice más bajo, o sea la imagen más grande) que ya cumpla maxSize; si
  // ni la mip más chica del archivo cumple, se usa esa (nunca se sube de
  // tamaño con interpolación inventada).
  let level = header.mipmapCount - 1
  for (let l = 0; l < header.mipmapCount; l++) {
    const w = mipDimension(header.width, l)
    const h = mipDimension(header.height, l)
    if (Math.max(w, h) <= maxSize) {
      level = l
      break
    }
  }

  // El archivo trae, en orden, [miniatura lowres][mip chica]...[mip grande].
  // Para llegar a `level` hay que saltar la miniatura y todas las mips más
  // chicas que ella (cada una con TODOS sus frames: el orden real es mip
  // exterior, frame interior).
  let offset = header.headerSize + lowResSize
  for (let l = header.mipmapCount - 1; l > level; l--) {
    const w = mipDimension(header.width, l)
    const h = mipDimension(header.height, l)
    const size = formatByteSize(header.highResImageFormat, w, h)
    if (size === undefined) {
      throw new Error(`formato VTF no soportado: id ${header.highResImageFormat}`)
    }
    offset += size * header.frames
  }

  const targetWidth = mipDimension(header.width, level)
  const targetHeight = mipDimension(header.height, level)
  const targetSize = formatByteSize(header.highResImageFormat, targetWidth, targetHeight)
  if (targetSize === undefined) {
    throw new Error(`formato VTF no soportado: id ${header.highResImageFormat}`)
  }

  if (offset < 0 || offset + targetSize > buf.length) {
    throw new Error(
      `.vtf truncado o con layout inesperado (frames=${header.frames}, faltan bytes para la mip ${level} de ${targetWidth}x${targetHeight})`,
    )
  }

  // Sólo se decodifica el primer frame (frame 0): las texturas de mapas
  // (paredes, pisos, normal maps) casi nunca son animadas, y si lo fueran
  // el frame 0 es una imagen estática válida igual.
  const mipData = buf.subarray(offset, offset + targetSize)
  const rgba = decodePixels(header.highResImageFormat, targetWidth, targetHeight, mipData)
  return { width: targetWidth, height: targetHeight, rgba }
}

function decodePixels(format: number, width: number, height: number, data: Buffer): Uint8Array {
  switch (format) {
    case VTF_FORMAT.RGBA8888:
      return decodeRgba8888(width, height, data)
    case VTF_FORMAT.BGRA8888:
      return decodeBgra8888(width, height, data)
    case VTF_FORMAT.RGB888:
      return decodeRgb888(width, height, data)
    case VTF_FORMAT.BGR888:
      return decodeBgr888(width, height, data)
    case VTF_FORMAT.DXT1:
      return decodeDxt1(width, height, data)
    case VTF_FORMAT.DXT3:
      return decodeDxt3(width, height, data)
    case VTF_FORMAT.DXT5:
      return decodeDxt5(width, height, data)
    default:
      // No debería llegar acá: decodeVtf ya validó el formato antes de leer bytes.
      throw new Error(`formato VTF no soportado: id ${format}`)
  }
}

function decodeRgba8888(width: number, height: number, data: Buffer): Uint8Array {
  return Uint8Array.from(data.subarray(0, width * height * 4))
}

function decodeBgra8888(width: number, height: number, data: Buffer): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    out[i * 4 + 0] = data[i * 4 + 2] // R <- B
    out[i * 4 + 1] = data[i * 4 + 1]
    out[i * 4 + 2] = data[i * 4 + 0] // B <- R
    out[i * 4 + 3] = data[i * 4 + 3]
  }
  return out
}

function decodeRgb888(width: number, height: number, data: Buffer): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    out[i * 4 + 0] = data[i * 3 + 0]
    out[i * 4 + 1] = data[i * 3 + 1]
    out[i * 4 + 2] = data[i * 3 + 2]
    out[i * 4 + 3] = 255
  }
  return out
}

function decodeBgr888(width: number, height: number, data: Buffer): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    out[i * 4 + 0] = data[i * 3 + 2] // R <- B
    out[i * 4 + 1] = data[i * 3 + 1]
    out[i * 4 + 2] = data[i * 3 + 0] // B <- R
    out[i * 4 + 3] = 255
  }
  return out
}

/** RGB565 empaquetado en un uint16 -> RGB888, expandiendo bits por replicación (el estándar de facto para S3TC). */
function rgb565to888(c: number): readonly [number, number, number] {
  const r5 = (c >> 11) & 0x1f
  const g6 = (c >> 5) & 0x3f
  const b5 = c & 0x1f
  const r = (r5 << 3) | (r5 >> 2)
  const g = (g6 << 2) | (g6 >> 4)
  const b = (b5 << 3) | (b5 >> 2)
  return [r, g, b]
}

export type Rgba = readonly [number, number, number, number]

/**
 * Decodifica un único bloque DXT1 de 4x4 (8 bytes: c0, c1, 32 bits de
 * índices) a sus 16 píxeles RGBA, en orden de fila (arriba-izquierda
 * primero). Exportada aparte de decodeDxt1 (que la usa por cada bloque de la
 * imagen completa) para poder probarla contra valores calculados a mano sin
 * tener que armar una imagen entera.
 */
export function decodeDxt1Block(c0: number, c1: number, indices: number): Rgba[] {
  const [r0, g0, b0] = rgb565to888(c0)
  const [r1, g1, b1] = rgb565to888(c1)

  // DXT1 es el único de los tres formatos DXT donde el orden de c0 vs c1
  // cambia el modo: c0 > c1 da paleta de 4 colores interpolados; si no, el
  // cuarto color es transparente (para poder tener "recorte" barato sin
  // canal de alfa aparte). DXT3/DXT5 siempre interpolan los 4 colores
  // porque el alfa ya viene aparte.
  const palette: Rgba[] =
    c0 > c1
      ? [
          [r0, g0, b0, 255],
          [r1, g1, b1, 255],
          [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3), 255],
          [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3), 255],
        ]
      : [
          [r0, g0, b0, 255],
          [r1, g1, b1, 255],
          [Math.round((r0 + r1) / 2), Math.round((g0 + g1) / 2), Math.round((b0 + b1) / 2), 255],
          [0, 0, 0, 0],
        ]

  const pixels: Rgba[] = []
  for (let texelIndex = 0; texelIndex < 16; texelIndex++) {
    const code = (indices >>> (texelIndex * 2)) & 0b11
    pixels.push(palette[code])
  }
  return pixels
}

function decodeDxt1(width: number, height: number, data: Buffer): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  const blocksX = blockCount(width)
  const blocksY = blockCount(height)
  let off = 0

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const c0 = data.readUInt16LE(off)
      const c1 = data.readUInt16LE(off + 2)
      const indices = data.readUInt32LE(off + 4)
      off += 8

      const pixels = decodeDxt1Block(c0, c1, indices)
      writeBlock(out, width, height, bx, by, pixels)
    }
  }
  return out
}

function decodeDxt3(width: number, height: number, data: Buffer): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  const blocksX = blockCount(width)
  const blocksY = blockCount(height)
  let off = 0

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const alphaBytes = data.subarray(off, off + 8) // 16 nibbles de alfa explícito, 4 bits por texel
      const c0 = data.readUInt16LE(off + 8)
      const c1 = data.readUInt16LE(off + 10)
      const colorIndices = data.readUInt32LE(off + 12)
      off += 16

      const [r0, g0, b0] = rgb565to888(c0)
      const [r1, g1, b1] = rgb565to888(c1)
      // Sin modo "transparente" acá (a diferencia de DXT1): el alfa ya es explícito, así que siempre son 4 colores interpolados.
      const colorPalette: readonly (readonly [number, number, number])[] = [
        [r0, g0, b0],
        [r1, g1, b1],
        [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3)],
        [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3)],
      ]

      const pixels: Rgba[] = []
      for (let texelIndex = 0; texelIndex < 16; texelIndex++) {
        const colorCode = (colorIndices >>> (texelIndex * 2)) & 0b11
        const nibbleByte = alphaBytes[Math.floor(texelIndex / 2)]
        const nibble = texelIndex % 2 === 0 ? nibbleByte & 0x0f : nibbleByte >> 4
        const a = nibble * 17 // 0..15 -> 0..255 replicando el nibble (0x1 * 17 = 0x11, etc.)
        const [r, g, b] = colorPalette[colorCode]
        pixels.push([r, g, b, a])
      }
      writeBlock(out, width, height, bx, by, pixels)
    }
  }
  return out
}

/** Los 8 niveles de alfa interpolado de un bloque DXT5, igual que el color de DXT1 pero para un único canal de 8 bits. */
function buildDxt5AlphaPalette(a0: number, a1: number): readonly number[] {
  if (a0 > a1) {
    return [
      a0,
      a1,
      Math.round((6 * a0 + 1 * a1) / 7),
      Math.round((5 * a0 + 2 * a1) / 7),
      Math.round((4 * a0 + 3 * a1) / 7),
      Math.round((3 * a0 + 4 * a1) / 7),
      Math.round((2 * a0 + 5 * a1) / 7),
      Math.round((1 * a0 + 6 * a1) / 7),
    ]
  }
  // Con a0 <= a1 sólo hay 6 valores interpolados; los otros dos son los extremos fijos 0 y 255.
  return [
    a0,
    a1,
    Math.round((4 * a0 + 1 * a1) / 5),
    Math.round((3 * a0 + 2 * a1) / 5),
    Math.round((2 * a0 + 3 * a1) / 5),
    Math.round((1 * a0 + 4 * a1) / 5),
    0,
    255,
  ]
}

function decodeDxt5(width: number, height: number, data: Buffer): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  const blocksX = blockCount(width)
  const blocksY = blockCount(height)
  let off = 0

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const a0 = data[off]
      const a1 = data[off + 1]
      // 6 bytes = 48 bits = 16 índices de 3 bits, leídos como dos grupos LE de 24 bits (texeles 0-7 y 8-15).
      const bitsLow = data[off + 2] | (data[off + 3] << 8) | (data[off + 4] << 16)
      const bitsHigh = data[off + 5] | (data[off + 6] << 8) | (data[off + 7] << 16)
      const c0 = data.readUInt16LE(off + 8)
      const c1 = data.readUInt16LE(off + 10)
      const colorIndices = data.readUInt32LE(off + 12)
      off += 16

      const alphaPalette = buildDxt5AlphaPalette(a0, a1)
      const [r0, g0, b0] = rgb565to888(c0)
      const [r1, g1, b1] = rgb565to888(c1)
      const colorPalette: readonly (readonly [number, number, number])[] = [
        [r0, g0, b0],
        [r1, g1, b1],
        [Math.round((2 * r0 + r1) / 3), Math.round((2 * g0 + g1) / 3), Math.round((2 * b0 + b1) / 3)],
        [Math.round((r0 + 2 * r1) / 3), Math.round((g0 + 2 * g1) / 3), Math.round((b0 + 2 * b1) / 3)],
      ]

      const pixels: Rgba[] = []
      for (let texelIndex = 0; texelIndex < 16; texelIndex++) {
        const colorCode = (colorIndices >>> (texelIndex * 2)) & 0b11
        const bits = texelIndex < 8 ? bitsLow : bitsHigh
        const localIndex = texelIndex % 8
        const alphaCode = (bits >>> (localIndex * 3)) & 0b111
        const [r, g, b] = colorPalette[colorCode]
        pixels.push([r, g, b, alphaPalette[alphaCode]])
      }
      writeBlock(out, width, height, bx, by, pixels)
    }
  }
  return out
}

/** Escribe los 16 píxeles de un bloque 4x4 en la imagen de salida, recortando contra el borde si width/height no son múltiplos de 4. */
function writeBlock(out: Uint8Array, width: number, height: number, bx: number, by: number, pixels: readonly Rgba[]): void {
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px
      const y = by * 4 + py
      if (x >= width || y >= height) continue
      const [r, g, b, a] = pixels[py * 4 + px]
      const o = (y * width + x) * 4
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = a
    }
  }
}
