/**
 * El decodificador se prueba contra PNGs generados acá con CADA uno de los
 * 5 filtros del spec, no contra un archivo fixture: un fixture sólo ejercita
 * los filtros que su encoder eligió, y justamente los que faltan (Paeth,
 * Average) son los que rompen el lector viejo de png-writer.ts.
 *
 * `encodeConFiltro` es un encoder de juguete que aplica el MISMO filtro a
 * todas las filas, cosa que un encoder real nunca hace (elige el mejor por
 * fila). Eso es exactamente lo que se quiere para el test: fuerza cada rama
 * de `unfilterRow` una por una en vez de dejar la cobertura a la suerte.
 */

import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32 } from './crc32.ts'
import { decodePng, samplePngRgb } from './png-reader.ts'
import { encodePng, encodePngRaw } from './png-writer.ts'
import { medirRgba } from './teselado.ts'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Encoder de juguete: aplica `filtro` a TODAS las filas. Ver cabecera. */
function encodeConFiltro(
  width: number,
  height: number,
  pixels: Uint8Array,
  channels: 3 | 4,
  filtro: 0 | 1 | 2 | 3 | 4,
): Buffer {
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = filtro
    for (let i = 0; i < stride; i++) {
      const x = pixels[y * stride + i]
      const a = i >= channels ? pixels[y * stride + i - channels] : 0
      const b = y > 0 ? pixels[(y - 1) * stride + i] : 0
      const c = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0
      let filtrado: number
      switch (filtro) {
        case 0: filtrado = x; break
        case 1: filtrado = x - a; break
        case 2: filtrado = x - b; break
        case 3: filtrado = x - ((a + b) >> 1); break
        default: filtrado = x - paeth(a, b, c); break
      }
      raw[rowStart + 1 + i] = filtrado & 0xff
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = channels === 4 ? 6 : 2
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Imagen determinista con gradientes en los dos ejes: cualquier fila o
 *  columna corrida se nota, a diferencia de un color plano. */
function imagenDePrueba(width: number, height: number, channels: 3 | 4): Uint8Array {
  const px = new Uint8Array(width * height * channels)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels
      px[o] = (x * 7 + y * 3) & 0xff
      px[o + 1] = (x * 13) & 0xff
      px[o + 2] = (y * 29 + 11) & 0xff
      if (channels === 4) px[o + 3] = 255
    }
  }
  return px
}

const ANCHO = 13
const ALTO = 9

describe('decodePng', () => {
  for (const filtro of [0, 1, 2, 3, 4] as const) {
    it(`recupera los píxeles exactos de un RGBA filtrado con ${filtro}`, () => {
      const original = imagenDePrueba(ANCHO, ALTO, 4)
      const decodificado = decodePng(encodeConFiltro(ANCHO, ALTO, original, 4, filtro))

      expect(decodificado.width).toBe(ANCHO)
      expect(decodificado.height).toBe(ALTO)
      expect(Array.from(decodificado.rgba)).toEqual(Array.from(original))
    })
  }

  it('expande RGB (tipo 2) a RGBA con alfa opaco', () => {
    const original = imagenDePrueba(ANCHO, ALTO, 3)
    const { rgba } = decodePng(encodeConFiltro(ANCHO, ALTO, original, 3, 4))

    for (let i = 0; i < ANCHO * ALTO; i++) {
      expect(rgba[i * 4]).toBe(original[i * 3])
      expect(rgba[i * 4 + 1]).toBe(original[i * 3 + 1])
      expect(rgba[i * 4 + 2]).toBe(original[i * 3 + 2])
      expect(rgba[i * 4 + 3]).toBe(255)
    }
  })

  it('lee también lo que escribe encodePng (el encoder del repo)', () => {
    const original = imagenDePrueba(ANCHO, ALTO, 4)
    const { rgba } = decodePng(encodePng(ANCHO, ALTO, original))
    expect(Array.from(rgba)).toEqual(Array.from(original))
  })

  it('rechaza lo que no entiende en vez de devolver píxeles corridos', () => {
    expect(() => decodePng(Buffer.alloc(64))).toThrow(/firma/)

    const original = imagenDePrueba(4, 4, 4)
    const png = encodeConFiltro(4, 4, original, 4, 0)
    // IHDR arranca en 8 (firma) + 8 (largo+tipo); byte 8 del chunk es el
    // bitDepth y el 9 el colorType.
    const profundidad16 = Buffer.from(png)
    profundidad16[16 + 8] = 16
    expect(() => decodePng(profundidad16)).toThrow(/profundidad/)

    const paleta = Buffer.from(png)
    paleta[16 + 9] = 3
    expect(() => decodePng(paleta)).toThrow(/tipo de color/)
  })
})

describe('samplePngRgb', () => {
  /** 2x2 con un color por téxel, para poder razonar el promedio a mano. */
  function png2x2(): ReturnType<typeof decodePng> {
    const px = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ])
    return decodePng(encodePng(2, 2, px))
  }

  it('promedia la ventana de vecinos, no devuelve el téxel crudo', () => {
    const img = png2x2()
    const c = samplePngRgb(img, 0.25, 0.25)
    // Con radio 1 sobre una imagen de 2x2 y wrap, los 9 vecinos son los 4
    // téxeles repetidos: 4 rojos, 2 verdes, 2 azules... el promedio exacto
    // depende de la repetición, pero NUNCA puede ser el rojo puro del téxel
    // central. Ésa es la propiedad que importa (ver el comentario de
    // AVERAGE_RADIUS en png-reader.ts).
    expect(c.r).toBeLessThan(1)
    expect(c.g).toBeGreaterThan(0)
    expect(c.b).toBeGreaterThan(0)
  })

  it('las UV fuera de [0,1] repiten en vez de salirse del buffer', () => {
    const img = png2x2()
    expect(samplePngRgb(img, 1.25, 1.25)).toEqual(samplePngRgb(img, 0.25, 0.25))
    expect(samplePngRgb(img, -0.75, -0.75)).toEqual(samplePngRgb(img, 0.25, 0.25))
  })
})

/**
 * Gris de un canal. Es el formato en que se escriben los patrones de
 * camuflaje (scripts/patrones-camo-prueba.ts, docs/PROMPTS-CAMOS.md): sin
 * esta rama, `scripts/verificar-teselado.ts` no puede leer los archivos que
 * existe para verificar.
 */
describe('PNG en escala de grises', () => {
  it('expande el canal único a RGB con los tres iguales', () => {
    const niveles = new Uint8Array([0, 64, 128, 255])
    const png = encodePngRaw({ width: 2, height: 2, data: niveles, channels: 1 })
    const img = decodePng(png)
    expect(img.width).toBe(2)
    expect(img.height).toBe(2)
    for (let i = 0; i < 4; i++) {
      const [r, g, b, a] = img.rgba.subarray(i * 4, i * 4 + 4)
      expect(r).toBe(niveles[i])
      // Los tres canales IGUALES: es lo que hace que el croma que mide
      // scripts/lib/teselado.ts dé exactamente 0 sobre un gris de verdad.
      expect(g).toBe(r)
      expect(b).toBe(r)
      expect(a).toBe(255)
    }
  })

  it('un gris real mide croma 0, y uno con tinte no', () => {
    const data = new Uint8Array([10, 90, 170, 250])
    const img = decodePng(encodePngRaw({ width: 2, height: 2, data, channels: 1 }))
    expect(medirRgba(img.width, img.height, img.rgba).croma).toBe(0)

    // El mismo dibujo pero escrito como RGB con un canal corrido: es lo que
    // devuelve un generador que ignoró la instrucción de escala de grises.
    const rgb = new Uint8Array(4 * 3)
    for (let i = 0; i < 4; i++) {
      rgb[i * 3] = data[i]
      rgb[i * 3 + 1] = Math.min(255, data[i] + 20)
      rgb[i * 3 + 2] = data[i]
    }
    const tinte = decodePng(encodePngRaw({ width: 2, height: 2, data: rgb, channels: 3 }))
    expect(medirRgba(tinte.width, tinte.height, tinte.rgba).esGris).toBe(false)
  })
})
