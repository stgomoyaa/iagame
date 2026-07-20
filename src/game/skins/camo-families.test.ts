import { describe, expect, it } from 'vitest'
import {
  CAMO_FAMILY_INDEX,
  camoFamily,
  COBERTURA_EMISIVA,
  ESCALA_FAMILIA,
  type CamoFamilyId,
} from '@/game/skins/camo-families'
import { SKINS_ANTES_DE_LAS_FAMILIAS } from '@/game/skins/__fixtures__/skins-antes'
import { generateSkin } from '@/game/skins/generator'
import { RARITY_TIERS } from '@/game/skins/rarity'

function muestra(n: number): ReturnType<typeof generateSkin>[] {
  const out = []
  for (let i = 0; i < n; i++) out.push(generateSkin(`drop:${i}`))
  return out
}

describe('las skins ya guardadas no cambian de aspecto', () => {
  it('el generador devuelve exactamente lo mismo que antes de las familias', () => {
    // EL contrato del sistema (cabecera de generator.ts): en localStorage se
    // guarda sólo la seed, así que si el generador cambia lo que devuelve para
    // una seed, cambian todas las skins que la gente ya tiene. El fixture se
    // sacó corriendo el generador de HEAD, no reimprimiendo el actual: si
    // alguien mete un rand() en el medio de la cadena, o agrega un patrón a un
    // tier (que corre el resultado de `pick`), esto se cae.
    expect(SKINS_ANTES_DE_LAS_FAMILIAS.length).toBeGreaterThan(150)

    for (const fila of SKINS_ANTES_DE_LAS_FAMILIAS) {
      const [
        seed,
        name,
        rarity,
        pattern,
        animation,
        patternScale,
        wear,
        metalness,
        emissive,
        br,
        bg,
        bb,
        ar,
        ag,
        ab,
      ] = fila
      const s = generateSkin(seed as string)
      const ctx = `seed "${seed as string}"`
      expect(s.name, ctx).toBe(name)
      expect(s.rarity, ctx).toBe(rarity)
      expect(s.pattern, ctx).toBe(pattern)
      expect(s.animation, ctx).toBe(animation)
      expect(s.patternScale, ctx).toBeCloseTo(patternScale as number, 8)
      expect(s.wear, ctx).toBeCloseTo(wear as number, 8)
      expect(s.metalness, ctx).toBeCloseTo(metalness as number, 8)
      expect(s.emissive, ctx).toBeCloseTo(emissive as number, 8)
      expect(s.colorBase.r, ctx).toBeCloseTo(br as number, 8)
      expect(s.colorBase.g, ctx).toBeCloseTo(bg as number, 8)
      expect(s.colorBase.b, ctx).toBeCloseTo(bb as number, 8)
      expect(s.colorAccent.r, ctx).toBeCloseTo(ar as number, 8)
      expect(s.colorAccent.g, ctx).toBeCloseTo(ag as number, 8)
      expect(s.colorAccent.b, ctx).toBeCloseTo(ab as number, 8)
    }
  })

  it('la familia es derivada: no depende del orden del PRNG', () => {
    // Si la familia se hubiera sorteado con rand(), calcularla aparte a partir
    // de los campos ya decididos daría distinto. Que coincida es la prueba de
    // que no consume stream.
    for (const s of muestra(500)) {
      expect(
        camoFamily({
          seed: s.seed,
          rarity: s.rarity,
          pattern: s.pattern,
          animation: s.animation,
        }),
      ).toBe(s.family)
    }
  })
})

describe('mapeo de familias', () => {
  it('cumple la tabla que fijó la tarea de las teselas', () => {
    const casos: readonly [CamoFamilyId, Parameters<typeof camoFamily>[0]][] = [
      ['filigrana', { seed: 'x', rarity: 'epico', pattern: 'hidrografico', animation: 'pulso' }],
      ['gema', { seed: 'x', rarity: 'legendario', pattern: 'astillas', animation: 'pulso' }],
      ['damasco', { seed: 'x', rarity: 'legendario', pattern: 'hidrografico', animation: 'flujo' }],
      ['cebra', { seed: 'x', rarity: 'exotico', pattern: 'astillas', animation: 'espectro' }],
    ]
    for (const [esperada, entrada] of casos) {
      expect(camoFamily(entrada), JSON.stringify(entrada)).toBe(esperada)
    }
  })

  it('las seis familias son alcanzables desde seeds reales', () => {
    // Una familia que el generador nunca produce es código muerto por más
    // bonito que se vea el shader. Es exactamente lo que le pasaba a la cebra
    // con el mapeo literal de la tabla: `bandas` no existe en el tier exótico.
    const vistas = new Set(muestra(20_000).map((s) => s.family))
    for (const fam of ['multicam', 'follaje', 'filigrana', 'gema', 'damasco', 'cebra'] as const) {
      expect(vistas.has(fam), `${fam} nunca sale de una seed`).toBe(true)
    }
  })

  it('la gema nunca fluye: la retícula de piedras es fija', () => {
    // Si el patrón se desplazara, las gemas patinarían sobre el arma. Es la
    // razón por la que la tarea previa le puso pulso y no flujo.
    for (const s of muestra(20_000)) {
      if (s.family === 'gema') expect(s.animation).toBe('pulso')
    }
  })

  it('multicam y follaje nunca brillan: son camuflaje mate', () => {
    // Ropa de dotación. Un camuflaje que emite deja de leerse como camuflaje.
    for (const s of muestra(20_000)) {
      if (s.family === 'multicam' || s.family === 'follaje') {
        expect(s.emissive, `${s.seed} ${s.family}`).toBe(0)
        expect(s.animation).toBe('ninguna')
      }
    }
  })

  it('la cebra es exclusiva del exótico, como el espectro', () => {
    for (const s of muestra(20_000)) {
      if (s.family === 'cebra') expect(s.rarity).toBe('exotico')
    }
  })

  it('las familias con emisivo sólo salen de Épico para arriba', () => {
    for (const s of muestra(20_000)) {
      if (COBERTURA_EMISIVA[s.family] > 0) {
        expect(['epico', 'legendario', 'exotico']).toContain(s.rarity)
      }
    }
  })

  it('el desempate multicam/follaje reparte y es estable', () => {
    const camo = muestra(20_000).filter((s) => s.family === 'multicam' || s.family === 'follaje')
    const multi = camo.filter((s) => s.family === 'multicam').length
    // Ni colapsado a una sola ni sospechosamente exacto: sólo que las dos
    // salgan de verdad.
    expect(multi / camo.length).toBeGreaterThan(0.3)
    expect(multi / camo.length).toBeLessThan(0.7)
    // Estable entre llamadas: es un hash de la seed, no un sorteo.
    for (const s of camo.slice(0, 50)) expect(generateSkin(s.seed).family).toBe(s.family)
  })
})

describe('tablas de familias', () => {
  it('los índices del shader son únicos y arrancan en 0 para clasico', () => {
    // Contrato con el switch del GLSL: si dos familias comparten índice, una
    // se dibuja como la otra y no lo detecta nada más.
    expect(CAMO_FAMILY_INDEX.clasico).toBe(0)
    const vals = Object.values(CAMO_FAMILY_INDEX)
    expect(new Set(vals).size).toBe(vals.length)
  })

  it('todas las familias tienen escala y cobertura declaradas', () => {
    for (const fam of Object.keys(CAMO_FAMILY_INDEX) as CamoFamilyId[]) {
      expect(ESCALA_FAMILIA[fam], fam).toBeGreaterThan(0)
      expect(COBERTURA_EMISIVA[fam], fam).toBeGreaterThanOrEqual(0)
      expect(COBERTURA_EMISIVA[fam], fam).toBeLessThanOrEqual(1)
    }
  })

  it('no se agregó ningún patrón a ningún tier', () => {
    // La otra forma de romper las skins guardadas: `pick(rand, tier.patterns)`
    // depende del LARGO de la lista, así que un patrón de más en un tier
    // cambia el patrón de TODAS las seeds de ese tier. Las familias se
    // derivan justamente para no tener que tocar esto.
    const esperado: Record<string, number> = {
      comun: 2,
      raro: 4,
      epico: 5,
      legendario: 4,
      exotico: 3,
    }
    for (const t of RARITY_TIERS) {
      expect(t.patterns.length, `${t.id} cambió de cantidad de patrones`).toBe(esperado[t.id])
    }
  })
})
