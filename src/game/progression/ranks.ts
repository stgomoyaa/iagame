/**
 * La escalera de rangos (sección 9 del spec): 9 tiers, 3 divisiones cada uno
 * salvo Deidad que tiene una sola. **25 rangos totales**, RR de 0 a 100
 * dentro de cada uno.
 *
 * El rango se representa como un **índice plano 0..24**, no como un par
 * (tier, división). Es la decisión central de este archivo y de la que
 * cuelga todo lo demás:
 *
 * - Promocionar es `+1`, descender es `-1`. No hay que acordarse de que
 *   Oro 3 sube a Platino 1 y no a Oro 4: la aritmética lo resuelve sola.
 * - La dificultad de bots es `índice / 24`, un escalar 0..1 que
 *   `bots/difficulty.ts` ya sabía consumir desde la fase 2 (ese módulo se
 *   escribió con `rank` continuo justamente esperando esto). Hierro 1 da 0
 *   y cae exacto en los 400ms de la tabla del spec; Deidad da 1 y cae
 *   exacto en los 120ms.
 * - Deidad siendo un tier de una sola división no es un caso especial: es
 *   simplemente el último índice de la lista.
 *
 * Tier y división se derivan del índice para mostrarlos, nunca se guardan.
 */

/** Los 9 tiers, de menor a mayor. El orden es la escalera. */
export const TIERS: readonly string[] = [
  'Hierro',
  'Bronce',
  'Plata',
  'Oro',
  'Platino',
  'Diamante',
  'Master',
  'Grand Master',
  'Deidad',
]

/** Divisiones por tier. Deidad es el único con una sola (spec: "3
 *  divisiones cada uno excepto Deidad"). */
const DIVISIONES_POR_TIER = 3

/** Índice de Deidad dentro de TIERS. */
const TIER_DEIDAD = TIERS.length - 1

/** Cantidad total de rangos: 8 tiers x 3 divisiones + Deidad = 25. */
export const RANK_COUNT = TIER_DEIDAD * DIVISIONES_POR_TIER + 1

/** Primer rango de la escalera (Hierro 1). */
export const RANK_MIN = 0
/** Último rango de la escalera (Deidad). */
export const RANK_MAX = RANK_COUNT - 1

/** RR máximo dentro de un rango. Superarlo promociona (ver rr.ts). */
export const RR_MAXIMO = 100

export interface RankName {
  /** Nombre del tier, ej. "Oro". */
  tier: string
  /** 1..3, o 0 para Deidad, que no tiene divisiones. */
  division: number
  /** Etiqueta lista para la UI, ej. "Oro 2" o "Deidad". */
  label: string
}

function clampRank(index: number): number {
  if (!Number.isFinite(index)) return RANK_MIN
  return Math.min(RANK_MAX, Math.max(RANK_MIN, Math.floor(index)))
}

/**
 * Descompone un índice plano en tier y división para mostrarlo. Deidad no
 * lleva número: "Deidad 1" no existe, y escribirlo delataría que el tier
 * de una sola división es un caso pegado con cinta.
 */
export function rankName(index: number): RankName {
  const i = clampRank(index)
  if (i === RANK_MAX) return { tier: 'Deidad', division: 0, label: 'Deidad' }
  const tier = Math.floor(i / DIVISIONES_POR_TIER)
  const division = (i % DIVISIONES_POR_TIER) + 1
  return { tier: TIERS[tier], division, label: `${TIERS[tier]} ${division}` }
}

/** Etiqueta corta del rango, ej. "Platino 3". */
export function rankLabel(index: number): string {
  return rankName(index).label
}

/**
 * Índice plano a partir de tier y división. Inversa de `rankName`, pensada
 * para tests y para sembrar un rango a mano; el juego trabaja siempre con el
 * índice.
 */
export function rankIndex(tier: string, division: number): number {
  const t = TIERS.indexOf(tier)
  if (t < 0) throw new Error(`tier desconocido: "${tier}"`)
  if (t === TIER_DEIDAD) return RANK_MAX
  const d = Math.min(DIVISIONES_POR_TIER, Math.max(1, Math.floor(division)))
  return t * DIVISIONES_POR_TIER + (d - 1)
}

/**
 * Dificultad de bots que le toca a un rango: el escalar 0..1 que consume
 * `bots/difficulty.ts` (sección 8 del spec: "la dificultad de los bots se
 * deriva del rango actual del jugador").
 *
 * Lineal sobre los 25 rangos a propósito. La tabla del spec sólo fija los
 * dos extremos ("los tiers intermedios interpolan") y cualquier curva que le
 * metamos acá sería un número inventado: con lineal, subir un rango siempre
 * cuesta lo mismo en tiempo de reacción de los bots (~11ms por rango) y en
 * cono de error (~0.22° por rango), que es lo que hace que la escalera se
 * lea pareja de abajo a arriba.
 */
export function difficultyForRank(index: number): number {
  return clampRank(index) / RANK_MAX
}

/**
 * Inversa de `difficultyForRank`: el rango al que corresponde una dificultad
 * 0..1. La usan las colocaciones (placement.ts) para convertir su estimación
 * continua de habilidad en un rango sembrado.
 */
export function rankForDifficulty(difficulty: number): number {
  if (!Number.isFinite(difficulty)) return RANK_MIN
  const d = Math.min(1, Math.max(0, difficulty))
  return clampRank(Math.round(d * RANK_MAX))
}

/** Color del tier para la UI. Sube en temperatura y en brillo con la
 *  escalera, así el rango se lee de un vistazo sin leer el texto. */
export const TIER_COLORS: Record<string, string> = {
  Hierro: '#6b7280',
  Bronce: '#a97142',
  Plata: '#b8c0cc',
  Oro: '#d4a02a',
  Platino: '#3fb6c4',
  Diamante: '#8b6fe0',
  Master: '#3fa86b',
  'Grand Master': '#c8385a',
  Deidad: '#f2e9c4',
}

/** Color del rango, derivado de su tier. */
export function rankColor(index: number): string {
  return TIER_COLORS[rankName(index).tier] ?? '#e6e8ec'
}
