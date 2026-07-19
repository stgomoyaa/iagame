import { describe, expect, it } from 'vitest'
import { luminanceGap, rgbToHex } from '@/game/skins/color'
import { generateSkin, generateSkins } from '@/game/skins/generator'
import { PATTERN_INDEX } from '@/game/skins/patterns'
import { RARITY_BY_ID, RARITY_TIERS, rollRarity } from '@/game/skins/rarity'

/** Muestra grande de seeds, para las propiedades que valen para todas. */
function muestra(n: number): ReturnType<typeof generateSkin>[] {
  const out = []
  for (let i = 0; i < n; i++) out.push(generateSkin(`muestra:${i}`))
  return out
}

describe('generador de skins', () => {
  it('la misma seed produce siempre la misma skin', () => {
    // El requisito del spec (sección 7 y 13): una skin guardada en
    // localStorage tiene que verse igual después de recargar.
    for (const seed of ['drop:1', 'inicial:0', 'seed-larga-con-guiones', '']) {
      expect(generateSkin(seed)).toEqual(generateSkin(seed))
    }
  })

  it('sobrevive a un round-trip por JSON, que es como se persiste', () => {
    // Recargar la página no vuelve a llamar al generador con el objeto
    // viejo: lo llama con la seed leída de localStorage, que pasó por
    // JSON.stringify/parse. Este test es esa recarga.
    const seed = 'drop:42'
    const antes = generateSkin(seed)
    const seedPersistida: string = JSON.parse(JSON.stringify({ s: seed })).s
    expect(generateSkin(seedPersistida)).toEqual(antes)
  })

  it('seeds distintas producen skins distintas', () => {
    const nombres = new Set(muestra(200).map((s) => `${s.name}|${rgbToHex(s.colorAccent)}`))
    // No se exige unicidad total (el espacio de paletas es finito, y dos
    // seeds pueden caer en la misma familia): se exige que el generador no
    // esté colapsando todo a un puñado de resultados.
    expect(nombres.size).toBeGreaterThan(80)
  })

  it('nunca genera parámetros fuera de rango', () => {
    for (const skin of muestra(300)) {
      expect(skin.wear).toBeGreaterThanOrEqual(0)
      expect(skin.wear).toBeLessThanOrEqual(1)
      expect(skin.metalness).toBeGreaterThanOrEqual(0)
      expect(skin.metalness).toBeLessThanOrEqual(1)
      expect(skin.emissive).toBeGreaterThanOrEqual(0)
      expect(skin.emissive).toBeLessThanOrEqual(1)
      expect(skin.patternScale).toBeGreaterThan(0)
      expect(PATTERN_INDEX[skin.pattern]).toBeDefined()
    }
  })

  it('respeta los rangos del tier que le tocó', () => {
    for (const skin of muestra(300)) {
      const tier = RARITY_BY_ID[skin.rarity]
      expect(tier.patterns, `${skin.rarity} no permite ${skin.pattern}`).toContain(skin.pattern)
      expect(tier.animations).toContain(skin.animation)
      expect(skin.wear).toBeGreaterThanOrEqual(tier.wear[0])
      expect(skin.wear).toBeLessThanOrEqual(tier.wear[1])
      expect(skin.emissive).toBeGreaterThanOrEqual(tier.emissive[0])
      expect(skin.emissive).toBeLessThanOrEqual(tier.emissive[1])
    }
  })

  it('generateSkins mapea seed a seed en orden', () => {
    const seeds = ['a', 'b', 'c']
    expect(generateSkins(seeds).map((s) => s.seed)).toEqual(seeds)
  })
})

describe('rarezas visibles de un vistazo', () => {
  it('sólo Épico para arriba emite luz', () => {
    // La regla del spec: "Solo las rarezas altas desbloquean emisivos y
    // shaders animados, así una legendaria se distingue de una común de un
    // vistazo".
    for (const skin of muestra(400)) {
      if (skin.rarity === 'comun' || skin.rarity === 'raro') {
        expect(skin.emissive, `${skin.rarity} no debería emitir`).toBe(0)
        expect(skin.animation).toBe('ninguna')
      }
    }
  })

  it('Legendario y Exótico siempre están animados', () => {
    for (const skin of muestra(400)) {
      if (skin.rarity === 'legendario' || skin.rarity === 'exotico') {
        expect(skin.animation).not.toBe('ninguna')
        expect(skin.emissive).toBeGreaterThan(0.5)
      }
    }
  })

  it('el ciclo de tono es exclusivo del Exótico', () => {
    for (const skin of muestra(600)) {
      if (skin.animation === 'espectro') expect(skin.rarity).toBe('exotico')
    }
  })

  it('el desgaste baja a medida que sube la rareza', () => {
    // Una común es un arma de dotación gastada; una exótica sale de fábrica.
    const maximos = RARITY_TIERS.map((t) => t.wear[1])
    for (let i = 1; i < maximos.length; i++) {
      expect(maximos[i]).toBeLessThan(maximos[i - 1])
    }
  })
})

describe('sorteo de rareza', () => {
  it('cubre los cinco tiers y respeta el orden de los pesos', () => {
    const conteo = new Map<string, number>()
    for (let i = 0; i < 4000; i++) {
      const id = generateSkin(`peso:${i}`).rarity
      conteo.set(id, (conteo.get(id) ?? 0) + 1)
    }
    for (const tier of RARITY_TIERS) {
      expect(conteo.get(tier.id) ?? 0, `${tier.id} nunca salió`).toBeGreaterThan(0)
    }
    expect(conteo.get('comun')!).toBeGreaterThan(conteo.get('raro')!)
    expect(conteo.get('raro')!).toBeGreaterThan(conteo.get('epico')!)
    expect(conteo.get('epico')!).toBeGreaterThan(conteo.get('legendario')!)
    expect(conteo.get('legendario')!).toBeGreaterThan(conteo.get('exotico')!)
  })

  it('los bordes del sorteo caen en el primer y el último tier', () => {
    expect(rollRarity(0).id).toBe('comun')
    expect(rollRarity(0.9999999).id).toBe('exotico')
    expect(rollRarity(1.5).id).toBe('exotico')
    expect(rollRarity(-1).id).toBe('comun')
  })
})

describe('las skins no son cuarenta variantes de gris', () => {
  it('base y acento siempre tienen contraste suficiente', () => {
    // El modo de falla que este sistema tiene que evitar: si el color base y
    // el acento se ven iguales, el patrón es invisible y la skin no existe.
    for (const skin of muestra(400)) {
      const gap = luminanceGap(skin.colorBase, skin.colorAccent)
      expect(gap, `${skin.name} (${skin.seed}) casi no contrasta`).toBeGreaterThan(0.08)
    }
  })

  it('de Raro para arriba el acento tiene color, no gris', () => {
    for (const skin of muestra(400)) {
      if (skin.rarity === 'comun') continue
      const { r, g, b } = skin.colorAccent
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const sat = max > 0 ? (max - min) / max : 0
      expect(sat, `${skin.name} tiene un acento gris`).toBeGreaterThan(0.3)
    }
  })
})
