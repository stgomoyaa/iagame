export const TICK_HZ = 128
export const TICK_DT = 1 / TICK_HZ

/** Techo de delta por frame. Sin esto, una pestaña en background acumula
 *  segundos de tiempo y el loop entra en espiral tratando de alcanzarlo. */
export const MAX_FRAME_DT = 0.25

/** Presupuesto de frame en milisegundos (CPU + GPU). */
export const FRAME_BUDGET_MS = 2.5
