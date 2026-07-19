/**
 * Dificultad de bots (sección 8 del spec): exactamente tres números,
 * interpolados linealmente entre el tier más bajo (Hierro) y el más alto
 * (Radiante). Nada más varía con la dificultad -- ni vida, ni daño, ni
 * velocidad de movimiento (spec: "nada más"), así que este módulo es
 * deliberadamente chico: tres campos, una interpolación, sin ramas.
 *
 * `rank` es un escalar 0..1 (0 = Hierro, 1 = Radiante) en vez de un enum de
 * 9 tiers: el sistema de rangos real (sección 9 del spec, fase 4) todavía no
 * existe -- cuando exista, mapea el rango del jugador a este mismo escalar
 * continuo sin que este módulo tenga que saber nada de tiers ni divisiones.
 */

export interface BotDifficulty {
  /** Tiempo de reacción, segundos. Cuánto tarda el cono de error en cerrarse
   *  del todo tras adquirir un objetivo -- ver bots/aim.ts. */
  reactionTimeS: number
  /** Semiángulo del cono de error al momento de adquirir el objetivo,
   *  radianes. Se cierra hacia 0 a lo largo de reactionTimeS. */
  errorConeRad: number
  /** 0..1. Cuán inteligente es la elección de punto al reposicionarse o
   *  retirarse -- ver bots/fsm.ts (repositionCandidate). No afecta nada más. */
  repositionQuality: number
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Hierro: sección 8 del spec, columna "Hierro". */
export const DIFFICULTY_LOWEST: BotDifficulty = {
  reactionTimeS: 0.4,
  errorConeRad: degToRad(6.0),
  repositionQuality: 0.0,
}

/** Radiante: sección 8 del spec, columna "Radiante". */
export const DIFFICULTY_HIGHEST: BotDifficulty = {
  reactionTimeS: 0.12,
  errorConeRad: degToRad(0.7),
  repositionQuality: 1.0,
}

function lerp(a: number, b: number, t: number): number {
  // Casos borde explícitos: `a + (b-a)*t` con t=1 puede diferir de `b` en el
  // último bit por redondeo de punto flotante. Sin esto, interpolateDifficulty(1)
  // no da BIT A BIT los mismos números que DIFFICULTY_HIGHEST -- rompe la
  // garantía de "en el extremo, exactamente los valores de la tabla".
  if (t <= 0) return a
  if (t >= 1) return b
  return a + (b - a) * t
}

/**
 * Interpola los tres números de dificultad en `rank` (clampeado a [0, 1]
 * antes de interpolar, así que valores fuera de rango dan exactamente los
 * extremos de la tabla en vez de extrapolar más allá de Hierro/Radiante).
 */
export function interpolateDifficulty(rank: number): BotDifficulty {
  const t = Math.min(1, Math.max(0, rank))
  return {
    reactionTimeS: lerp(DIFFICULTY_LOWEST.reactionTimeS, DIFFICULTY_HIGHEST.reactionTimeS, t),
    errorConeRad: lerp(DIFFICULTY_LOWEST.errorConeRad, DIFFICULTY_HIGHEST.errorConeRad, t),
    repositionQuality: lerp(
      DIFFICULTY_LOWEST.repositionQuality,
      DIFFICULTY_HIGHEST.repositionQuality,
      t,
    ),
  }
}
