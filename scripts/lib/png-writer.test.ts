import { describe, expect, it } from 'vitest'
import { decodePngForTest, encodePng, readPngChunks } from './png-writer.ts'

/** Imagen de 2x2 con un color distinto por píxel, para que un swap de filas/columnas o de canales sea imposible de no notar. */
function make2x2(): { width: number; height: number; rgba: Uint8Array } {
  const rgba = Uint8Array.from([
    255, 0, 0, 255, // (0,0) rojo
    0, 255, 0, 255, // (1,0) verde
    0, 0, 255, 255, // (0,1) azul
    255, 255, 0, 128, // (1,1) amarillo semitransparente
  ])
  return { width: 2, height: 2, rgba }
}

describe('encodePng', () => {
  it('produce la firma PNG y los tres chunks esperados en orden', () => {
    const { width, height, rgba } = make2x2()
    const png = encodePng(width, height, rgba)
    const chunks = readPngChunks(png)
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  it('IHDR trae width/height/bitDepth/colorType correctos', () => {
    const { width, height, rgba } = make2x2()
    const png = encodePng(width, height, rgba)
    const [ihdr] = readPngChunks(png)
    expect(ihdr.data.readUInt32BE(0)).toBe(width)
    expect(ihdr.data.readUInt32BE(4)).toBe(height)
    expect(ihdr.data[8]).toBe(8) // bitDepth
    expect(ihdr.data[9]).toBe(6) // colorType RGBA
  })

  it('round-trip: decodificar lo que se codificó da exactamente los mismos bytes RGBA', () => {
    const { width, height, rgba } = make2x2()
    const png = encodePng(width, height, rgba)
    const decoded = decodePngForTest(png)

    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    expect(Buffer.from(decoded.rgba)).toEqual(Buffer.from(rgba))
  })

  it('rechaza un rgba de largo inconsistente con width*height*4 en vez de escribir un PNG corrupto', () => {
    expect(() => encodePng(2, 2, new Uint8Array(10))).toThrow(/rgba\.length/)
  })

  /**
   * Prueba directamente lo que dice el brief: "cada fila va precedida por un
   * byte de filtro 0; olvidarse de ese byte produce diagonales". Se verifica
   * inflando el IDAT a mano (sin pasar por decodePngForTest, que ya asume el
   * byte de filtro) y confirmando que aparece un byte 0x00 exactamente al
   * principio de cada fila del stream sin filtrar.
   */
  it('cada fila del IDAT trae su byte de filtro (0) al principio, no sólo la primera', async () => {
    const { inflateSync } = await import('node:zlib')
    const { width, height, rgba } = make2x2()
    const png = encodePng(width, height, rgba)
    const [, idat] = readPngChunks(png)
    const raw = inflateSync(idat.data)

    const stride = width * 4
    expect(raw.length).toBe((stride + 1) * height)
    for (let y = 0; y < height; y++) {
      expect(raw[y * (stride + 1)]).toBe(0)
    }
  })
})
