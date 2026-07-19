/**
 * Generador determinista de skins (sección 7 del spec):
 *
 *     seed -> hash -> { colorBase, colorAcento, patrón, desgaste, metalness,
 *                       emisivo, animación }
 *
 * Determinista significa función pura: misma seed, mismo objeto, siempre y
 * en cualquier máquina. No hay Math.random(), ni Date, ni lectura de estado
 * global en ningún punto de esta cadena. De eso depende que una skin
 * guardada en localStorage (progression/store.ts) se vea igual después de
 * recargar, que es el requisito explícito del spec y lo que verifica
 * generator.test.ts.
 *
 * El orden en que se consume el stream del PRNG es parte del contrato: si
 * alguien inserta un `rand()` en el medio, todas las skins ya guardadas
 * cambian de aspecto. Cualquier parámetro nuevo va al final.
 */

import { clamp01, jitterColor, type Rgb } from '@/game/skins/color'
import { createSkinRandom, hashSeed, pick, range } from '@/game/skins/hash'
import { PALETTES_BY_RARITY } from '@/game/skins/palettes'
import {
  PATTERN_LABEL,
  PATTERN_SCALE_RANGE,
  type PatternId,
} from '@/game/skins/patterns'
import { rollRarity, type AnimationId, type RarityId } from '@/game/skins/rarity'

export interface Skin {
  /** La seed que la produjo. Es lo único que se persiste. */
  seed: string
  /** Nombre para la UI: paleta + patrón ("Carmesí Fracturado"). */
  name: string
  rarity: RarityId
  colorBase: Rgb
  colorAccent: Rgb
  pattern: PatternId
  /** Repeticiones del patrón por metro de arma. */
  patternScale: number
  /** 0 = de fábrica, 1 = destruida. Rayones y desgaste de canto. */
  wear: number
  /** 0..1. En un material unlit es la fuerza del brillo especular y del
   *  realce de canto que simula el shader, no una propiedad PBR. */
  metalness: number
  /** 0..1. Cuánto emite el acento. 0 en Común y Raro, por diseño. */
  emissive: number
  animation: AnimationId
}

/**
 * Genera la skin de una seed. Función pura y barata (un hash y ~10 tiradas
 * del PRNG): se puede llamar en el render de React para las 40 armas sin
 * pensarlo, no hace falta memoizarla.
 */
export function generateSkin(seed: string): Skin {
  const rand = createSkinRandom(hashSeed(seed))

  const tier = rollRarity(rand())
  const palette = pick(rand, PALETTES_BY_RARITY[tier.id])
  const pattern = pick(rand, tier.patterns)

  // Jitter fino sobre la paleta: dos skins de la misma familia se
  // distinguen sin salirse del par de colores que alguien eligió a ojo
  // (ver el comentario de jitterColor en color.ts).
  const hueShift = range(rand, -0.05, 0.05)
  const satScale = range(rand, 0.85, 1.15)
  const lightShift = range(rand, -0.05, 0.05)

  const colorBase = jitterColor(palette.base, hueShift, satScale, lightShift * 0.6)
  const colorAccent = jitterColor(palette.accent, hueShift, satScale, lightShift)

  const [scaleMin, scaleMax] = PATTERN_SCALE_RANGE[pattern]
  const patternScale = range(rand, scaleMin, scaleMax)

  const wear = clamp01(range(rand, tier.wear[0], tier.wear[1]))
  const metalness = clamp01(range(rand, tier.metalness[0], tier.metalness[1]))
  const emissive = clamp01(range(rand, tier.emissive[0], tier.emissive[1]))
  const animation = pick(rand, tier.animations)

  return {
    seed,
    name: `${palette.name} ${PATTERN_LABEL[pattern]}`,
    rarity: tier.id,
    colorBase,
    colorAccent,
    pattern,
    patternScale,
    wear,
    metalness,
    emissive,
    animation,
  }
}

/**
 * Genera las skins de una lista de seeds. Conveniencia para la armería, que
 * dibuja el inventario entero en cada render.
 */
export function generateSkins(seeds: readonly string[]): Skin[] {
  return seeds.map(generateSkin)
}
