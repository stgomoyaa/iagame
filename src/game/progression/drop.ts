/**
 * Drop de skin al final de cada partida (sección 9 del spec, y sección 10:
 * "el momento de dopamina más fuerte del ciclo", presentado con animación de
 * apertura).
 *
 * Todo el trabajo pesado ya está hecho: `skins/generator.ts` produce una
 * skin determinista a partir de una seed, con la rareza saliendo del mismo
 * hash. Así que un drop no es más que **elegir una seed nueva**, y este
 * archivo se ocupa sólo de eso.
 *
 * La seed se arma con tres ingredientes:
 *
 * - **El número de partida** (`partidasJugadas`), que garantiza que dos
 *   drops seguidos nunca sean el mismo aunque el jugador repita la
 *   actuación exacta. Es el único ingrediente estrictamente necesario.
 * - **Kills y daño de la partida**, que hacen que la secuencia de drops de
 *   un jugador dependa de cómo jugó y no sea la misma lista fija para todo
 *   el mundo en el mismo orden.
 *
 * Lo que NO hace es sesgar la rareza por actuación, y es deliberado. La
 * tentación es obvia (mejor partida, mejor skin), pero rompe el drop como
 * momento: si la rareza es una función del rendimiento, deja de haber
 * sorpresa y el jugador bueno no vuelve a ver una común nunca. La rareza
 * sale del sorteo por pesos de `skins/rarity.ts` y de ningún otro lado. Lo
 * que se gana jugando bien es RR y XP, que son las monedas que sí deberían
 * responder a la habilidad.
 */

import { generateSkin, type Skin } from '@/game/skins/generator'
import type { MatchPerformance } from '@/game/progression/combat-score'

/** Prefijo de las seeds de drop. Las distingue de las de arranque
 *  (`inicial:N`, store.ts) de un vistazo al mirar un guardado. */
export const DROP_PREFIX = 'drop'

/**
 * Seed del drop de una partida. Determinista: los mismos argumentos dan
 * siempre la misma seed, y por lo tanto la misma skin, que es la propiedad
 * de la que depende poder guardar seeds en vez de skins (ver el comentario
 * de cabecera de store.ts).
 */
export function dropSeed(partidaNumero: number, perf: MatchPerformance): string {
  const n = Math.max(0, Math.floor(partidaNumero))
  const kills = Math.max(0, Math.floor(perf.kills))
  const dano = Math.max(0, Math.round(perf.damage))
  return `${DROP_PREFIX}:${n}:${kills}:${dano}`
}

export interface SkinDrop {
  skin: Skin
  /** false si la seed ya estaba en el inventario. La UI igual muestra la
   *  apertura -- esconder un duplicado sería peor que mostrarlo -- pero
   *  puede decir que ya la tenías en vez de anunciarla como nueva. */
  nueva: boolean
}

/**
 * Resuelve el drop de una partida contra el inventario actual. No modifica
 * el inventario: quien persiste es career.ts.
 */
export function rollDrop(
  partidaNumero: number,
  perf: MatchPerformance,
  inventario: readonly string[],
): SkinDrop {
  const seed = dropSeed(partidaNumero, perf)
  return { skin: generateSkin(seed), nueva: !inventario.includes(seed) }
}
