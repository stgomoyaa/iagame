import { describe, expect, it } from 'vitest'
import {
  hexToRgb,
  hslToRgb,
  jitterColor,
  luminanceGap,
  rgbToHex,
  rgbToHsl,
} from '@/game/skins/color'
import { hashSeed, createSkinRandom, pick, range } from '@/game/skins/hash'

describe('conversión de color', () => {
  it('hex a rgb y de vuelta no pierde nada', () => {
    for (const hex of ['#000000', '#ffffff', '#1f3550', '#a8ec2b']) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex)
    }
  })

  it('acepta hex sin numeral', () => {
    expect(hexToRgb('1f3550')).toEqual(hexToRgb('#1f3550'))
  })

  it('rechaza hex inválido en vez de devolver negro en silencio', () => {
    expect(() => hexToRgb('#12345')).toThrow()
    expect(() => hexToRgb('nada')).toThrow()
  })

  it('rgb a hsl y de vuelta conserva el color', () => {
    for (const hex of ['#1f3550', '#a8ec2b', '#808080', '#ff0000']) {
      const rgb = hexToRgb(hex)
      const round = hslToRgb(rgbToHsl(rgb))
      expect(round.r).toBeCloseTo(rgb.r, 5)
      expect(round.g).toBeCloseTo(rgb.g, 5)
      expect(round.b).toBeCloseTo(rgb.b, 5)
    }
  })

  it('un gris tiene saturación cero y sobrevive el round-trip', () => {
    const gris = hexToRgb('#4a4a4a')
    expect(rgbToHsl(gris).s).toBe(0)
    expect(rgbToHex(hslToRgb(rgbToHsl(gris)))).toBe('#4a4a4a')
  })

  it('el jitter mueve el color sin sacarlo del rango válido', () => {
    const base = hexToRgb('#4fa6ec')
    const movido = jitterColor(base, 0.05, 1.15, 0.05)
    expect(rgbToHex(movido)).not.toBe(rgbToHex(base))
    for (const canal of [movido.r, movido.g, movido.b]) {
      expect(canal).toBeGreaterThanOrEqual(0)
      expect(canal).toBeLessThanOrEqual(1)
    }
  })

  it('el jitter neutro es la identidad', () => {
    const base = hexToRgb('#c8323c')
    expect(rgbToHex(jitterColor(base, 0, 1, 0))).toBe('#c8323c')
  })

  it('luminanceGap separa negro de blanco y no separa un color de sí mismo', () => {
    expect(luminanceGap(hexToRgb('#000000'), hexToRgb('#ffffff'))).toBeCloseTo(1, 5)
    expect(luminanceGap(hexToRgb('#1f3550'), hexToRgb('#1f3550'))).toBe(0)
  })
})

describe('hash y prng de skins', () => {
  it('el hash es estable para la misma seed', () => {
    expect(hashSeed('drop:1')).toBe(hashSeed('drop:1'))
  })

  it('seeds correlativas caen lejos', () => {
    // Un hash malo (sumar códigos de carácter) haría que "drop:1" y "drop:2"
    // produzcan skins casi iguales, justo cuando las seeds son correlativas
    // porque salen de drops de partida.
    const a = hashSeed('drop:1')
    const b = hashSeed('drop:2')
    expect(Math.abs(a - b)).toBeGreaterThan(1000000)
  })

  it('el prng es determinista y se queda en [0, 1)', () => {
    const uno = createSkinRandom(12345)
    const otro = createSkinRandom(12345)
    for (let i = 0; i < 50; i++) {
      const v = uno()
      expect(v).toBe(otro())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('pick nunca se sale de la lista, ni con un rand que devuelve casi 1', () => {
    const items = ['a', 'b', 'c']
    expect(pick(() => 0, items)).toBe('a')
    expect(pick(() => 0.9999999, items)).toBe('c')
    expect(() => pick(() => 0, [])).toThrow()
  })

  it('range respeta los extremos', () => {
    expect(range(() => 0, 2, 8)).toBe(2)
    expect(range(() => 0.5, 2, 8)).toBe(5)
  })
})
