import { describe, expect, it } from 'vitest'
import {
  BLOOM_QUALITIES,
  BLOOM_QUALITY_LABEL,
  createDefaultVideoSettings,
  esBloomQuality,
  normalizeVideoSettings,
  VIDEO_VERSION,
  type BloomQuality,
} from '@/game/settings/video'

describe('ajustes de video persistidos', () => {
  it('el default es bloom en bajo (el nivel medio, seguro en GPUs modestas)', () => {
    expect(createDefaultVideoSettings().bloom).toBe('bajo')
  })

  it('off es la primera calidad y alto la última (orden por costo)', () => {
    expect(BLOOM_QUALITIES[0]).toBe('off')
    expect(BLOOM_QUALITIES[BLOOM_QUALITIES.length - 1]).toBe('alto')
  })

  it('cada calidad tiene una etiqueta', () => {
    for (const q of BLOOM_QUALITIES) {
      expect(BLOOM_QUALITY_LABEL[q]).toBeTruthy()
    }
  })

  describe('esBloomQuality', () => {
    for (const q of ['off', 'bajo', 'alto'] as BloomQuality[]) {
      it(`acepta "${q}"`, () => expect(esBloomQuality(q)).toBe(true))
    }
    for (const basura of ['medio', 'ultra', '', null, undefined, 3, {}]) {
      it(`rechaza ${JSON.stringify(basura) ?? 'undefined'}`, () =>
        expect(esBloomQuality(basura)).toBe(false))
    }
  })

  describe('normalizeVideoSettings', () => {
    it('acepta un guardado válido tal cual', () => {
      const guardado = { version: VIDEO_VERSION, bloom: 'alto' as const }
      expect(normalizeVideoSettings(guardado)).toEqual(guardado)
    })

    it('descarta un guardado de otra versión', () => {
      const viejo = { version: 999, bloom: 'alto' }
      expect(normalizeVideoSettings(viejo)).toEqual(createDefaultVideoSettings())
    })

    it('cae al default ante una calidad desconocida', () => {
      const salida = normalizeVideoSettings({ version: VIDEO_VERSION, bloom: 'ultra' })
      expect(salida.bloom).toBe(createDefaultVideoSettings().bloom)
    })

    for (const basura of [null, undefined, 42, 'hola', []]) {
      it(`devuelve el default ante ${JSON.stringify(basura) ?? 'undefined'}`, () => {
        expect(normalizeVideoSettings(basura)).toEqual(createDefaultVideoSettings())
      })
    }
  })
})
