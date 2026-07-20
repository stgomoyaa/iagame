/**
 * Sólo para tests: arma buffers .vtf válidos a mano, para no depender de
 * archivos reales del Workshop en las pruebas unitarias (esos viven fuera
 * del repo y sólo se usan en las pruebas de integración contra los mapas
 * reales). Sigue el mismo layout de header que scripts/lib/vtf.ts lee.
 */

const HEADER_SIZE = 64

export interface VtfFixtureOptions {
  readonly width: number
  readonly height: number
  readonly format: number
  /** Mips ya codificadas en bytes crudos del formato, de la más CHICA a la más GRANDE (mismo orden que el archivo real). */
  readonly mips: readonly Buffer[]
  readonly frames?: number
  readonly lowRes?: { format: number; width: number; height: number; data: Buffer }
}

/** Arma un .vtf completo: header de 64 bytes + miniatura opcional + cadena de mips, en el orden real (chica a grande). */
export function buildVtfBuffer(opts: VtfFixtureOptions): Buffer {
  const header = Buffer.alloc(HEADER_SIZE)
  header.write('VTF\0', 0, 'ascii')
  header.writeUInt32LE(7, 4) // version major
  header.writeUInt32LE(4, 8) // version minor
  header.writeUInt32LE(HEADER_SIZE, 12)
  header.writeUInt16LE(opts.width, 16)
  header.writeUInt16LE(opts.height, 18)
  header.writeUInt32LE(0, 20) // flags, no se usan
  const frames = opts.frames ?? 1
  header.writeUInt16LE(frames, 24)
  header.writeUInt16LE(0, 26) // firstFrame, no se usa
  header.writeUInt32LE(opts.format, 52)
  header.writeUInt8(opts.mips.length, 56)

  if (opts.lowRes) {
    header.writeUInt32LE(opts.lowRes.format, 57)
    header.writeUInt8(opts.lowRes.width, 61)
    header.writeUInt8(opts.lowRes.height, 62)
  } else {
    header.writeUInt32LE(0xffffffff, 57) // FORMAT_NONE: sin miniatura
    header.writeUInt8(0, 61)
    header.writeUInt8(0, 62)
  }

  const lowResData = opts.lowRes ? opts.lowRes.data : Buffer.alloc(0)

  // El layout real es: por mip (chica a grande), por frame. El frame 0 es
  // el real; los frames extra sólo necesitan existir para que los offsets
  // de las mips siguientes caigan en el lugar correcto (su contenido no
  // importa para estos tests).
  const mipBlocks: Buffer[] = []
  for (const mip of opts.mips) {
    mipBlocks.push(mip)
    for (let f = 1; f < frames; f++) mipBlocks.push(Buffer.alloc(mip.length))
  }

  return Buffer.concat([header, lowResData, ...mipBlocks])
}

/** Un bloque DXT1 crudo de 8 bytes: c0, c1 (RGB565 LE) + 32 bits de índices. */
export function buildDxt1BlockBytes(c0: number, c1: number, indices: number): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeUInt16LE(c0, 0)
  buf.writeUInt16LE(c1, 2)
  buf.writeUInt32LE(indices >>> 0, 4)
  return buf
}

/** Un solo píxel en formato RGB888 (orden en memoria: R, G, B). */
export function rgb888Pixel(r: number, g: number, b: number): Buffer {
  return Buffer.from([r, g, b])
}

/** Un solo píxel en formato BGR888 (orden en memoria: B, G, R — al revés de RGB888). */
export function bgr888Pixel(r: number, g: number, b: number): Buffer {
  return Buffer.from([b, g, r])
}

/** Una imagen RGBA8888 completa (todos los píxeles del mismo color), para mips de prueba fáciles de distinguir a simple vista. */
export function solidRgba8888(width: number, height: number, r: number, g: number, b: number, a: number): Buffer {
  const buf = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = r
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = b
    buf[i * 4 + 3] = a
  }
  return buf
}
