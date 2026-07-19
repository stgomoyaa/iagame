/**
 * Tiers de rareza (sección 7 del spec): Común, Raro, Épico, Legendario,
 * Exótico. La rareza no es una etiqueta decorativa: es la que decide
 * **cuántos parámetros exóticos se habilitan**, y sólo las rarezas altas
 * desbloquean emisivos y shaders animados, "así una legendaria se distingue
 * de una común de un vistazo".
 *
 * Cada tier declara qué patrones puede usar y en qué rango caen desgaste,
 * metalness, emisivo y animación. El generador (generator.ts) nunca elige
 * fuera de estos rangos, así que la garantía "una común nunca brilla" es
 * estructural y no depende de que el generador se acuerde de chequearla.
 */

import type { PatternId } from '@/game/skins/patterns'

export type RarityId = 'comun' | 'raro' | 'epico' | 'legendario' | 'exotico'

export type AnimationId = 'ninguna' | 'pulso' | 'flujo' | 'espectro'

export interface RarityTier {
  id: RarityId
  /** Nombre para la UI. */
  label: string
  /** Color del tier en la armería (borde, etiqueta). */
  color: string
  /**
   * Peso relativo del sorteo por seed. Una skin sale de una seed y la seed
   * sale de un drop, así que la rareza tiene que caer del hash igual que el
   * resto (sección 7): estos pesos son la distribución de ese sorteo.
   */
  weight: number
  patterns: readonly PatternId[]
  wear: readonly [number, number]
  metalness: readonly [number, number]
  emissive: readonly [number, number]
  animations: readonly AnimationId[]
}

export const RARITY_TIERS: readonly RarityTier[] = [
  {
    id: 'comun',
    label: 'Común',
    color: '#8b939c',
    weight: 50,
    // Sin patrón elaborado, sin brillo y con bastante desgaste: una común es
    // un arma de dotación gastada, y se lee así de lejos.
    patterns: ['solido', 'bandas'],
    wear: [0.35, 0.7],
    metalness: [0.1, 0.3],
    emissive: [0, 0],
    animations: ['ninguna'],
  },
  {
    id: 'raro',
    label: 'Raro',
    color: '#4f9fe0',
    // Aparece el color y el camuflaje, todavía sin nada que brille.
    weight: 27,
    patterns: ['solido', 'bandas', 'camo', 'digital'],
    wear: [0.2, 0.5],
    metalness: [0.25, 0.5],
    emissive: [0, 0],
    animations: ['ninguna'],
  },
  {
    id: 'epico',
    label: 'Épico',
    color: '#b45cf0',
    weight: 14,
    // Primer tier con emisivo. El piso de 0.25 no es cero a propósito: si
    // una épica pudiera salir con emisivo 0 sería indistinguible de una
    // rara, y el tier dejaría de significar algo mirando el arma.
    patterns: ['camo', 'digital', 'astillas', 'hidrografico', 'degradado'],
    wear: [0.1, 0.35],
    metalness: [0.4, 0.7],
    emissive: [0.25, 0.5],
    animations: ['ninguna', 'pulso'],
  },
  {
    id: 'legendario',
    label: 'Legendario',
    color: '#f0a83c',
    weight: 7,
    // Siempre animada: es el salto visual que hace que se note el tier.
    patterns: ['astillas', 'hidrografico', 'degradado', 'bandas'],
    wear: [0, 0.18],
    metalness: [0.6, 0.9],
    emissive: [0.55, 0.85],
    animations: ['pulso', 'flujo'],
  },
  {
    id: 'exotico',
    label: 'Exótico',
    color: '#ff4fd8',
    weight: 2,
    // `espectro` (ciclo de tono en el shader) es exclusivo de este tier: es
    // el único efecto que rompe la paleta fija, y hay uno solo así en todo
    // el sistema para que se lea como "esto no es una skin normal".
    patterns: ['astillas', 'hidrografico', 'degradado'],
    wear: [0, 0.1],
    metalness: [0.75, 1],
    emissive: [0.8, 1],
    animations: ['flujo', 'espectro'],
  },
]

export const RARITY_BY_ID: Record<RarityId, RarityTier> = Object.fromEntries(
  RARITY_TIERS.map((t) => [t.id, t]),
) as Record<RarityId, RarityTier>

const TOTAL_WEIGHT = RARITY_TIERS.reduce((sum, t) => sum + t.weight, 0)

/** Sorteo de rareza por peso a partir de un número en [0, 1). */
export function rollRarity(roll: number): RarityTier {
  let acc = 0
  const target = Math.min(Math.max(roll, 0), 0.999999) * TOTAL_WEIGHT
  for (const tier of RARITY_TIERS) {
    acc += tier.weight
    if (target < acc) return tier
  }
  return RARITY_TIERS[RARITY_TIERS.length - 1]
}

/** Índice del tier en la escalera (0 = Común). Para ordenar en la armería. */
export function rarityRank(id: RarityId): number {
  return RARITY_TIERS.findIndex((t) => t.id === id)
}
