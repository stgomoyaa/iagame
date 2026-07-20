import { describe, expect, it } from 'vitest'
import { decodeDxt1Block, decodeVtf, formatByteSize, isSupportedVtfFormat, VTF_FORMAT } from './vtf.ts'
import { bgr888Pixel, buildDxt1BlockBytes, buildVtfBuffer, rgb888Pixel, solidRgba8888 } from './vtf-fixtures.ts'

describe('formatByteSize / isSupportedVtfFormat', () => {
  it('calcula bytes por bloque para los formatos DXT (4x4 -> 1 bloque)', () => {
    expect(formatByteSize(VTF_FORMAT.DXT1, 4, 4)).toBe(8)
    expect(formatByteSize(VTF_FORMAT.DXT3, 4, 4)).toBe(16)
    expect(formatByteSize(VTF_FORMAT.DXT5, 4, 4)).toBe(16)
  })

  it('redondea hacia arriba a bloques completos cuando el lado no es múltiplo de 4 (mips chicas)', () => {
    // 5x5 necesita 2x2 bloques de 4x4, igual que 8x8.
    expect(formatByteSize(VTF_FORMAT.DXT1, 5, 5)).toBe(formatByteSize(VTF_FORMAT.DXT1, 8, 8))
    // 1x1 (la mip más chica de cualquier cadena) sigue necesitando un bloque completo.
    expect(formatByteSize(VTF_FORMAT.DXT1, 1, 1)).toBe(8)
  })

  it('formatos sin comprimir: bytes por píxel directos', () => {
    expect(formatByteSize(VTF_FORMAT.RGBA8888, 4, 4)).toBe(4 * 4 * 4)
    expect(formatByteSize(VTF_FORMAT.RGB888, 4, 4)).toBe(4 * 4 * 3)
  })

  it('un id de formato desconocido no adivina un tamaño: undefined', () => {
    expect(formatByteSize(999, 4, 4)).toBeUndefined()
    expect(isSupportedVtfFormat(999)).toBe(false)
  })
})

describe('decodeDxt1Block: bloque armado a mano contra valores calculados a mano', () => {
  it('c0 > c1: paleta de 4 colores interpolados (rojo puro / azul puro / dos mezclas), sin transparencia', () => {
    // c0 = rojo puro en RGB565 (R5=31,G6=0,B5=0), c1 = azul puro (R5=0,G6=0,B5=31).
    const c0 = 0b11111_000000_00000 // 0xF800
    const c1 = 0b00000_000000_11111 // 0x001F
    expect(c0).toBeGreaterThan(c1) // confirma que este caso ejercita la rama de 4 colores, no la de transparencia

    // Cada byte de índices = 0b11_10_01_00 = 0xE4: texel local 0->código0, 1->código1, 2->código2, 3->código3.
    // Los 4 bytes son iguales porque las 4 filas del bloque repiten el mismo patrón.
    const indices = 0xe4e4e4e4
    const pixels = decodeDxt1Block(c0, c1, indices)

    expect(pixels).toHaveLength(16)

    // Expansión 5/6 bit -> 8 bit de un canal al máximo (31 o 63) siempre da 255 exacto.
    const red: readonly [number, number, number, number] = [255, 0, 0, 255]
    const blue: readonly [number, number, number, number] = [0, 0, 255, 255]
    // Interpolación calculada a mano: (2*255+0)/3=170, (2*0+255)/3=85.
    const mix1: readonly [number, number, number, number] = [170, 0, 85, 255]
    // (255+2*0)/3=85, (0+2*255)/3=170.
    const mix2: readonly [number, number, number, number] = [85, 0, 170, 255]

    for (let row = 0; row < 4; row++) {
      expect(pixels[row * 4 + 0]).toEqual(red)
      expect(pixels[row * 4 + 1]).toEqual(blue)
      expect(pixels[row * 4 + 2]).toEqual(mix1)
      expect(pixels[row * 4 + 3]).toEqual(mix2)
    }
  })

  it('c0 <= c1: paleta de 3 colores + transparente (el 4to color es (0,0,0,0), no un color inventado)', () => {
    const c0 = 0 // negro
    const c1 = 1 // casi negro con un pelín de azul (B5=1 -> B8=8)
    expect(c0).toBeLessThanOrEqual(c1)

    const indices = 0xe4e4e4e4 // mismo patrón: codes 0,1,2,3 por fila
    const pixels = decodeDxt1Block(c0, c1, indices)

    expect(pixels[0]).toEqual([0, 0, 0, 255]) // color0
    expect(pixels[1]).toEqual([0, 0, 8, 255]) // color1
    expect(pixels[2]).toEqual([0, 0, 4, 255]) // punto medio: (0+8)/2=4
    expect(pixels[3]).toEqual([0, 0, 0, 0]) // ¡transparente! no es "negro opaco"
  })

  it('todos los índices en 0: los 16 píxeles son exactamente color0', () => {
    const c0 = 0b11111_000000_00000 // rojo puro
    const c1 = 0
    const pixels = decodeDxt1Block(c0, c1, 0)
    for (const p of pixels) expect(p).toEqual([255, 0, 0, 255])
  })
})

describe('decodeVtf: la trampa del orden de las mips', () => {
  it('con varias mips y una miniatura lowres, decodifica la mip 0 (grande), nunca la miniatura ni una mip más chica', () => {
    const big = solidRgba8888(4, 4, 10, 20, 30, 255) // mip 0, la que interesa
    const small = solidRgba8888(2, 2, 200, 200, 200, 255) // mip 1
    const lowResThumb = buildDxt1BlockBytes(0xffff, 0x0000, 0) // miniatura: un bloque DXT1 cualquiera, nunca debería decodificarse como si fuera la imagen

    const buf = buildVtfBuffer({
      width: 4,
      height: 4,
      format: VTF_FORMAT.RGBA8888,
      mips: [small, big], // orden real del archivo: chica primero, grande al final
      lowRes: { format: VTF_FORMAT.DXT1, width: 4, height: 4, data: lowResThumb },
    })

    const image = decodeVtf(buf, 1024)

    expect(image.width).toBe(4)
    expect(image.height).toBe(4)
    // Si el decoder leyera desde el principio (el bug clásico), estos bytes
    // saldrían del bloque DXT1 de la miniatura interpretado como RGBA crudo:
    // basura, no (10,20,30,255) repetido.
    for (let i = 0; i < image.rgba.length; i += 4) {
      expect([image.rgba[i], image.rgba[i + 1], image.rgba[i + 2], image.rgba[i + 3]]).toEqual([10, 20, 30, 255])
    }
  })

  it('--max más chico que la mip 0 elige la mip más chica que todavía entra, no la mip 0 reescalada', () => {
    const big = solidRgba8888(4, 4, 10, 20, 30, 255)
    const small = solidRgba8888(2, 2, 200, 200, 200, 255)

    const buf = buildVtfBuffer({
      width: 4,
      height: 4,
      format: VTF_FORMAT.RGBA8888,
      mips: [small, big],
    })

    const image = decodeVtf(buf, 2)

    expect(image.width).toBe(2)
    expect(image.height).toBe(2)
    expect([image.rgba[0], image.rgba[1], image.rgba[2], image.rgba[3]]).toEqual([200, 200, 200, 255])
  })
})

describe('decodeVtf: canales (el bug más común y más difícil de ver a simple vista)', () => {
  it('un píxel BGR888 rojo puro sale rojo (255,0,0), no azul', () => {
    const buf = buildVtfBuffer({
      width: 1,
      height: 1,
      format: VTF_FORMAT.BGR888,
      mips: [bgr888Pixel(255, 0, 0)],
    })
    const image = decodeVtf(buf, 1024)
    expect(Array.from(image.rgba)).toEqual([255, 0, 0, 255])
  })

  it('un píxel RGB888 azul puro sale azul (control: si el test de arriba pasara por casualidad con canales cambiados, este lo detecta)', () => {
    const buf = buildVtfBuffer({
      width: 1,
      height: 1,
      format: VTF_FORMAT.RGB888,
      mips: [rgb888Pixel(0, 0, 255)],
    })
    const image = decodeVtf(buf, 1024)
    expect(Array.from(image.rgba)).toEqual([0, 0, 255, 255])
  })

  it('BGRA8888 respeta también el canal de alfa', () => {
    const buf = buildVtfBuffer({
      width: 1,
      height: 1,
      format: VTF_FORMAT.BGRA8888,
      mips: [Buffer.from([0, 0, 255, 128])], // B,G,R,A -> rojo semitransparente
    })
    const image = decodeVtf(buf, 1024)
    expect(Array.from(image.rgba)).toEqual([255, 0, 0, 128])
  })
})

describe('decodeVtf: casos de error que no deben adivinar', () => {
  it('un formato desconocido se reporta con su id en vez de decodificarse como cualquier cosa', () => {
    const buf = buildVtfBuffer({
      width: 4,
      height: 4,
      format: 999,
      mips: [Buffer.alloc(64)],
    })
    expect(() => decodeVtf(buf, 1024)).toThrow(/999/)
  })

  it('un archivo truncado (le faltan bytes a la mip elegida) revienta con un mensaje claro en vez de leer basura', () => {
    const buf = buildVtfBuffer({
      width: 8,
      height: 8,
      format: VTF_FORMAT.DXT1,
      mips: [Buffer.alloc(10)], // 8x8 DXT1 necesita 4 bloques * 8 = 32 bytes; sólo hay 10
    })
    expect(() => decodeVtf(buf, 1024)).toThrow(/truncado/)
  })

  it('una firma que no es "VTF\\0" se rechaza de entrada', () => {
    const buf = Buffer.alloc(64)
    buf.write('NOPE', 0, 'ascii')
    expect(() => decodeVtf(buf, 1024)).toThrow(/no es un \.vtf/)
  })
})
