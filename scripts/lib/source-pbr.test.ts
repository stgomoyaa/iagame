import { describe, expect, it } from 'vitest'
import type { RawImage } from './png-writer.ts'
import {
  analizarMascaraPhong,
  construirMetalRough,
  descartarAlfa,
  mascaraAMetalicidad,
  mascaraARugosidad,
} from './source-pbr.ts'

/** Textura RGBA de un píxel por valor de alfa pedido. */
function conAlfas(alfas: number[]): RawImage {
  const data = new Uint8Array(alfas.length * 4)
  for (let i = 0; i < alfas.length; i++) {
    data[i * 4] = 10 + i
    data[i * 4 + 1] = 20 + i
    data[i * 4 + 2] = 30 + i
    data[i * 4 + 3] = alfas[i]
  }
  return { width: alfas.length, height: 1, data, channels: 4 }
}

describe('analizarMascaraPhong', () => {
  it('reconoce como máscara el alfa del v_ak47 (rango 0..255)', () => {
    const stats = analizarMascaraPhong(conAlfas([0, 13, 200, 255]).data)
    expect(stats.min).toBe(0)
    expect(stats.max).toBe(255)
    expect(stats.usable).toBe(true)
  })

  it('descarta el alfa constante 255 de los guantes', () => {
    // Éste es el caso que importa: sin el descarte, alfa 255 se leería como
    // "metal puro" y los guantes saldrían cromados.
    const stats = analizarMascaraPhong(conAlfas([255, 255, 255, 255]).data)
    expect(stats.usable).toBe(false)
  })

  it('descarta el ruido de rango chico de la piel (0..5)', () => {
    expect(analizarMascaraPhong(conAlfas([0, 2, 5, 1]).data).usable).toBe(false)
  })

  it('acepta justo en el umbral y rechaza justo por debajo', () => {
    expect(analizarMascaraPhong(conAlfas([0, 8]).data).usable).toBe(true)
    expect(analizarMascaraPhong(conAlfas([0, 7]).data).usable).toBe(false)
  })
})

describe('mapeo de la máscara', () => {
  it('máscara baja = mate y no metálico; máscara alta = pulido y metálico', () => {
    expect(mascaraARugosidad(0)).toBeCloseTo(0.82, 5)
    expect(mascaraARugosidad(255)).toBeCloseTo(0.16, 5)
    expect(mascaraAMetalicidad(0)).toBeCloseTo(0, 5)
    expect(mascaraAMetalicidad(255)).toBeCloseTo(0.9, 5)
  })

  it('la rugosidad baja monótonamente con la máscara', () => {
    for (let m = 1; m <= 255; m++) {
      expect(mascaraARugosidad(m)).toBeLessThan(mascaraARugosidad(m - 1))
    }
  })

  it('la metalicidad crece más despacio que lineal en la zona media', () => {
    // Es la propiedad que evita el arma gris apagada: a media máscara la
    // metalicidad tiene que estar MUY por debajo de la mitad del tope.
    expect(mascaraAMetalicidad(128)).toBeLessThan(0.9 / 2)
    expect(mascaraAMetalicidad(128)).toBeCloseTo(0.9 * 0.25, 2)
  })
})

describe('construirMetalRough', () => {
  it('escribe rugosidad en G y metalicidad en B, con R en 255', () => {
    // Fija el layout de glTF. Invertir G y B no rompe nada visiblemente
    // "roto": deja el arma entera mate y metálica, que es peor que el
    // problema original y no lanza ningún error.
    const mr = construirMetalRough(conAlfas([255]))
    expect(mr.channels).toBe(3)
    expect(mr.data[0]).toBe(255) // R = oclusión
    expect(mr.data[1]).toBe(Math.round(0.16 * 255)) // G = roughness
    expect(mr.data[2]).toBe(Math.round(0.9 * 255)) // B = metalness
  })

  it('un téxel sin máscara queda mate y dieléctrico', () => {
    const mr = construirMetalRough(conAlfas([0]))
    expect(mr.data[1]).toBe(Math.round(0.82 * 255))
    expect(mr.data[2]).toBe(0)
  })

  it('rechaza una textura sin canal alfa en vez de inventar una máscara', () => {
    const rgb: RawImage = { width: 1, height: 1, data: new Uint8Array(3), channels: 3 }
    expect(() => construirMetalRough(rgb)).toThrow(/RGBA/)
  })
})

describe('descartarAlfa', () => {
  it('conserva RGB en orden y deja tres canales', () => {
    const rgb = descartarAlfa(conAlfas([200, 100]))
    expect(rgb.channels).toBe(3)
    expect(Array.from(rgb.data)).toEqual([10, 20, 30, 11, 21, 31])
  })

  it('deja pasar sin tocar una textura que ya venía RGB', () => {
    const img: RawImage = { width: 1, height: 1, data: Uint8Array.from([1, 2, 3]), channels: 3 }
    expect(descartarAlfa(img)).toBe(img)
  })
})
