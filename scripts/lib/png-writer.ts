/**
 * Encoder (y lector mínimo, sólo para tests) de PNG sin dependencias: no
 * hace falta más que width/height/RGBA8888 -> bytes de archivo .png. Nada de
 * paletas, interlace, ni más filtro que "ninguno" (filtro 0): las texturas
 * ya vienen decodificadas a RGBA plano, y el objetivo es que cualquier
 * visor (incluida la herramienta Read) las pueda abrir, no comprimir al
 * máximo.
 */

import { deflateSync, inflateSync } from 'node:zlib'
import { crc32 } from './crc32.ts'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const BIT_DEPTH_8 = 8
const COLOR_TYPE_RGBA = 6

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

/** Codifica una imagen RGBA8888 plana a un .png completo (firma + IHDR + IDAT + IEND). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const expectedLength = width * height * 4
  if (rgba.length !== expectedLength) {
    throw new Error(`encodePng: rgba.length (${rgba.length}) no coincide con width*height*4 (${expectedLength})`)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = BIT_DEPTH_8
  ihdr[9] = COLOR_TYPE_RGBA
  ihdr[10] = 0 // compression: sólo existe el método 0 (deflate)
  ihdr[11] = 0 // filter: método de filtrado adaptativo estándar, no elegimos ninguno por fila (ver abajo)
  ihdr[12] = 0 // interlace: sin entrelazado (Adam7)

  // Cada fila necesita SU PROPIO byte de filtro (0 = "ninguno") adelante.
  // Olvidarse de ese byte por fila es el bug clásico: todo el resto del
  // stream queda corrido un byte, y el resultado son diagonales de basura
  // en vez de la imagen (el decoder interpreta el primer píxel de la fila
  // siguiente como si fuera el filtro de esta).
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0
    raw.set(rgba.subarray(y * stride, y * stride + stride), rowStart + 1)
  }
  const idat = deflateSync(raw)

  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

export interface PngChunk {
  readonly type: string
  readonly data: Buffer
}

/** Recorre los chunks de un .png ya armado. Sólo para verificarlo en tests: el proyecto nunca necesita leer PNGs en runtime. */
export function readPngChunks(png: Buffer): PngChunk[] {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('readPngChunks: firma de PNG inválida')
  }
  const chunks: PngChunk[] = []
  let pos = 8
  while (pos < png.length) {
    const length = png.readUInt32BE(pos)
    const type = png.toString('ascii', pos + 4, pos + 8)
    const data = png.subarray(pos + 8, pos + 8 + length)
    chunks.push({ type, data })
    pos += 8 + length + 4 // largo + tipo + datos + crc
  }
  return chunks
}

export interface DecodedPngForTest {
  readonly width: number
  readonly height: number
  readonly rgba: Buffer
}

/**
 * Deshace encodePng con zlib.inflateSync, quitando el byte de filtro de cada
 * fila. Sólo entiende filtro 0 (que es lo único que encodePng produce):
 * alcanza para el test de round-trip, no para leer un PNG arbitrario de
 * afuera.
 */
export function decodePngForTest(png: Buffer): DecodedPngForTest {
  const chunks = readPngChunks(png)
  const ihdr = chunks.find((c) => c.type === 'IHDR')
  const idatChunks = chunks.filter((c) => c.type === 'IDAT')
  if (!ihdr) throw new Error('decodePngForTest: falta el chunk IHDR')
  if (idatChunks.length === 0) throw new Error('decodePngForTest: falta el chunk IDAT')

  const width = ihdr.data.readUInt32BE(0)
  const height = ihdr.data.readUInt32BE(4)
  const raw = inflateSync(Buffer.concat(idatChunks.map((c) => c.data)))

  const stride = width * 4
  const rgba = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    const filterByte = raw[rowStart]
    if (filterByte !== 0) {
      throw new Error(`decodePngForTest: filtro ${filterByte} en la fila ${y} no soportado (sólo filtro 0)`)
    }
    raw.copy(rgba, y * stride, rowStart + 1, rowStart + 1 + stride)
  }
  return { width, height, rgba }
}
