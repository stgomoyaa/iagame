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
const COLOR_TYPE_GRAY = 0
const COLOR_TYPE_RGB = 2
const COLOR_TYPE_RGBA = 6

/** Tipo de color del IHDR para cada cantidad de canales que se sabe emitir. */
const COLOR_TYPE_BY_CHANNELS: Record<number, number> = {
  1: COLOR_TYPE_GRAY,
  3: COLOR_TYPE_RGB,
  4: COLOR_TYPE_RGBA,
}

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

/** Imagen en memoria con cantidad de canales explícita. */
export interface RawImage {
  readonly width: number
  readonly height: number
  /** Píxeles planos, `channels` bytes por píxel, fila por fila. */
  readonly data: Uint8Array
  /** 1 (gris), 3 (RGB) o 4 (RGBA). */
  readonly channels: number
}

/** Predictor Paeth del estándar. a=izquierda, b=arriba, c=diagonal. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * Filtra una fila con los cinco filtros del estándar y se queda con el que
 * menos "energía" deja.
 *
 * El criterio —suma de los residuos leídos como enteros CON SIGNO— es la
 * heurística que recomienda la propia especificación de PNG. Leerlos como
 * bytes crudos es el error clásico: un residuo de -1 llega como 0xff, o sea
 * 255, y con esa cuenta el filtro 0 gana siempre y el filtrado no sirve de
 * nada.
 */
function filterRow(
  row: Uint8Array,
  prev: Uint8Array | null,
  bpp: number,
  out: Buffer,
  offset: number,
): number {
  const n = row.length
  let bestType = 0
  let bestSum = Infinity
  let best: Uint8Array | null = null

  for (let type = 0; type < 5; type++) {
    const cand = new Uint8Array(n)
    let sum = 0
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? row[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      let pred = 0
      if (type === 1) pred = a
      else if (type === 2) pred = b
      else if (type === 3) pred = (a + b) >> 1
      else if (type === 4) pred = paeth(a, b, c)
      const v = (row[i] - pred) & 0xff
      cand[i] = v
      sum += v < 128 ? v : 256 - v
    }
    if (sum < bestSum) {
      bestSum = sum
      bestType = type
      best = cand
    }
  }

  out[offset] = bestType
  out.set(best as Uint8Array, offset + 1)
  return offset + 1 + n
}

/**
 * Codifica gris/RGB/RGBA con filtrado adaptativo.
 *
 * Es el hermano "para producción" de `encodePng`: aquél emite siempre RGBA
 * con filtro 0 porque su objetivo es que cualquier visor —incluida la
 * herramienta Read— abra el archivo, y se usa para volcados de depuración.
 * Éste existe para las texturas que viajan DENTRO del GLB de un arma, donde
 * cada byte se paga en cada carga: elegir el filtro por fila y no arrastrar
 * un canal alfa que nadie va a leer sacan, juntos, más de la mitad del peso.
 */
export function encodePngRaw(img: RawImage): Buffer {
  const { width, height, data, channels } = img
  const colorType = COLOR_TYPE_BY_CHANNELS[channels]
  if (colorType === undefined) {
    throw new Error(`encodePngRaw: ${channels} canales no es un tipo de color soportado`)
  }
  const expected = width * height * channels
  if (data.length !== expected) {
    throw new Error(`encodePngRaw: data.length (${data.length}) no coincide con ${expected}`)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = BIT_DEPTH_8
  ihdr[9] = colorType
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  let offset = 0
  let prev: Uint8Array | null = null
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride)
    offset = filterRow(row, prev, channels, raw, offset)
    prev = row
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Reescala promediando por área (box filter).
 *
 * Es el filtro correcto para ACHICAR: promedia TODOS los téxeles de origen
 * que caen dentro de cada téxel de destino, así que ninguno se pierde. Un
 * muestreo bilineal —y mucho peor, el vecino más cercano— tira información y
 * deja aliasing que después, con el arma moviéndose en la mano, hierve.
 *
 * Sólo achica: si se le pide agrandar devuelve la imagen tal cual. El
 * pipeline nunca necesita ampliar, y una implementación a medias del caso
 * que nadie usa es una trampa esperando a alguien.
 */
export function resizeArea(img: RawImage, dstWidth: number, dstHeight: number): RawImage {
  const { width, height, data, channels } = img
  // Se clampea POR EJE en vez de descartar el reescalado entero cuando alguno
  // no achica. Con un `||` acá, una textura de 2048x1024 pedida a 1024x1024
  // se devolvería intacta —porque el alto ya coincidía— y el ahorro de la
  // mitad del ancho se perdería sin ruido.
  const w = Math.min(dstWidth, width)
  const h = Math.min(dstHeight, height)
  if (w === width && h === height) return img

  dstWidth = w
  dstHeight = h
  const out = new Uint8Array(dstWidth * dstHeight * channels)
  const scaleX = width / dstWidth
  const scaleY = height / dstHeight
  const acc = new Float64Array(channels)

  for (let y = 0; y < dstHeight; y++) {
    const y0 = Math.floor(y * scaleY)
    const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil((y + 1) * scaleY)))
    for (let x = 0; x < dstWidth; x++) {
      const x0 = Math.floor(x * scaleX)
      const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil((x + 1) * scaleX)))

      acc.fill(0)
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const base = (sy * width + sx) * channels
          for (let c = 0; c < channels; c++) acc[c] += data[base + c]
          n++
        }
      }

      const dst = (y * dstWidth + x) * channels
      for (let c = 0; c < channels; c++) out[dst + c] = Math.round(acc[c] / n)
    }
  }

  return { width: dstWidth, height: dstHeight, data: out, channels }
}

/**
 * Mayor potencia de dos que no supera ni `max` ni el lado actual.
 *
 * Potencias de dos porque estas texturas llevan mipmaps: con lados
 * arbitrarios WebGL igual los genera, pero la cadena deja de ser una
 * división exacta y reaparece el hervor que el box filter vino a evitar.
 */
export function targetSide(current: number, max: number): number {
  let side = 1
  while (side * 2 <= Math.min(current, max)) side *= 2
  return side
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
