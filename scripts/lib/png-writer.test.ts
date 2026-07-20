import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodePng } from './png-reader.ts'
import {
  decodePngForTest,
  encodePng,
  encodePngRaw,
  type RawImage,
  readPngChunks,
  resizeArea,
  targetSide,
} from './png-writer.ts'

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

/**
 * Imagen con estructura variada a propósito: un degradado suave (donde ganan
 * los filtros de predicción), una franja de ruido determinista (donde gana
 * "ninguno") y bordes duros. Sirve para que el filtrado adaptativo tenga que
 * elegir filtros DISTINTOS en filas distintas; con una imagen plana todas las
 * filas elegirían el mismo y el test no probaría nada.
 */
function imagenVariada(channels: number): RawImage {
  const width = 37 // primo y no múltiplo de nada: descoloca cualquier stride mal calculado
  const height = 23
  const data = new Uint8Array(width * height * channels)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = (y * width + x) * channels
      for (let c = 0; c < channels; c++) {
        if (y < 8) data[base + c] = (x * 7 + y * 3 + c * 11) & 0xff // degradado
        else if (y < 16) data[base + c] = (x * 131 + y * 197 + c * 59) & 0xff // "ruido"
        else data[base + c] = x < width / 2 ? 20 + c : 230 - c // borde duro
      }
    }
  }
  return { width, height, data, channels }
}

describe('encodePngRaw', () => {
  // El decoder de png-reader.ts se escribió por separado y entiende los cinco
  // filtros. Que lo que sale de acá se lea allá es la verificación fuerte: si
  // el filtrado adaptativo estuviera mal, el round-trip daría distinto.
  it('RGBA sobrevive el round-trip contra el decoder real de png-reader', () => {
    const img = imagenVariada(4)
    const leida = decodePng(encodePngRaw(img))
    expect(leida.width).toBe(img.width)
    expect(leida.height).toBe(img.height)
    expect(Array.from(leida.rgba)).toEqual(Array.from(img.data))
  })

  it('RGB sobrevive el round-trip y el decoder lo expande con alfa opaco', () => {
    const img = imagenVariada(3)
    const leida = decodePng(encodePngRaw(img))
    expect(leida.width).toBe(img.width)
    for (let i = 0; i < img.width * img.height; i++) {
      expect(leida.rgba[i * 4]).toBe(img.data[i * 3])
      expect(leida.rgba[i * 4 + 1]).toBe(img.data[i * 3 + 1])
      expect(leida.rgba[i * 4 + 2]).toBe(img.data[i * 3 + 2])
      expect(leida.rgba[i * 4 + 3]).toBe(255)
    }
  })

  it('el filtrado adaptativo elige filtros distintos según la fila', () => {
    // Sin esto, un encoder que emitiera siempre filtro 0 pasaría los
    // round-trips de arriba sin problema: son correctos, pero ciegos a si el
    // filtrado hace algo. Acá se mira el byte de filtro de cada fila.
    const img = imagenVariada(3)
    const png = encodePngRaw(img)
    const idat = readPngChunks(png).find((c) => c.type === 'IDAT')
    expect(idat).toBeDefined()
    const raw = inflateSync((idat as { data: Buffer }).data)
    const stride = img.width * img.channels
    const tipos = new Set<number>()
    for (let y = 0; y < img.height; y++) tipos.add(raw[y * (stride + 1)])
    expect(tipos.size).toBeGreaterThan(1)
  })

  it('el degradado comprime mejor que sin filtrar', () => {
    // encodePng (filtro 0 siempre) es la línea de base honesta.
    const img = imagenVariada(4)
    const conFiltro = encodePngRaw(img).length
    const sinFiltro = encodePng(img.width, img.height, img.data).length
    expect(conFiltro).toBeLessThan(sinFiltro)
  })

  it('rechaza una cantidad de canales que no sabe emitir', () => {
    const img: RawImage = { width: 1, height: 1, data: new Uint8Array(2), channels: 2 }
    expect(() => encodePngRaw(img)).toThrow(/canales/)
  })
})

describe('resizeArea', () => {
  it('promedia el bloque de origen en vez de tomar una muestra', () => {
    // 2x2 -> 1x1: el resultado tiene que ser el PROMEDIO de los cuatro, no el
    // primero. Un vecino-más-cercano devolvería 0 y pasaría desapercibido con
    // una imagen plana; con estos valores no.
    const img: RawImage = {
      width: 2,
      height: 2,
      channels: 1,
      data: Uint8Array.from([0, 100, 100, 200]),
    }
    const chica = resizeArea(img, 1, 1)
    expect(chica.width).toBe(1)
    expect(Array.from(chica.data)).toEqual([100])
  })

  it('mantiene los canales separados', () => {
    const img: RawImage = {
      width: 2,
      height: 1,
      channels: 3,
      data: Uint8Array.from([0, 10, 20, 100, 110, 120]),
    }
    expect(Array.from(resizeArea(img, 1, 1).data)).toEqual([50, 60, 70])
  })

  it('no agranda: devuelve la misma imagen', () => {
    const img = imagenVariada(3)
    expect(resizeArea(img, img.width * 2, img.height * 2)).toBe(img)
  })
})

describe('targetSide', () => {
  it('baja a la potencia de dos que entra en el máximo', () => {
    expect(targetSide(2048, 1024)).toBe(1024)
    expect(targetSide(2048, 2048)).toBe(2048)
    expect(targetSide(512, 1024)).toBe(512) // nunca agranda
    expect(targetSide(1000, 1024)).toBe(512) // 1000 no es potencia de dos
  })
})

describe('encodePngRaw: heurística de filtro con signo', () => {
  /**
   * Degradado DECRECIENTE en horizontal. Es el caso que separa la heurística
   * correcta de la ingenua: con filtro Sub cada residuo vale -7, que viajan
   * como 0xf9. Leídos con signo cuestan 7 y Sub gana por lejos; leídos como
   * bytes crudos cuestan 249 y el encoder elige "ninguno", que comprime mucho
   * peor. Creciente no sirve para esto: ahí los residuos son positivos y las
   * dos lecturas coinciden.
   */
  function degradadoDecreciente(): RawImage {
    const width = 64
    const height = 16
    const data = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) data[y * width + x] = (250 - x * 7 + 256) & 0xff
    }
    return { width, height, data, channels: 1 }
  }

  it('elige un filtro predictivo, no "ninguno", cuando los residuos son negativos', () => {
    const img = degradadoDecreciente()
    const idat = readPngChunks(encodePngRaw(img)).find((c) => c.type === 'IDAT')
    const raw = inflateSync((idat as { data: Buffer }).data)
    const stride = img.width * img.channels
    for (let y = 0; y < img.height; y++) {
      expect(raw[y * (stride + 1)]).not.toBe(0)
    }
  })

  it('ese degradado queda muy por debajo del tamaño sin filtrar', () => {
    const img = degradadoDecreciente()
    const rgba = new Uint8Array(img.width * img.height * 4)
    for (let i = 0; i < img.width * img.height; i++) {
      rgba[i * 4] = img.data[i]
      rgba[i * 4 + 1] = img.data[i]
      rgba[i * 4 + 2] = img.data[i]
      rgba[i * 4 + 3] = 255
    }
    // Un cuarto del baseline es holgado para un degradado perfectamente
    // predecible, y lo bastante estricto como para que elegir "ninguno" no
    // llegue.
    expect(encodePngRaw(img).length * 4).toBeLessThan(encodePng(img.width, img.height, rgba).length)
  })
})
