/**
 * Números del sistema de dianas (sección 6 del spec de fase 1), mismo
 * patrón mutable que movement/tuning.ts y feedback/tuning.ts.
 */
export interface TargetsTuning {
  torsoRadius: number
  headRadius: number
  /** Metros que la cabeza queda por encima del centro del torso. */
  headOffsetY: number
  maxHealth: number
  /** Segundos entre que una diana se rompe (vida a 0) y reaparece. */
  respawnDelayS: number
  /** Segundos que dura el flash visual de "acabo de recibir un impacto". */
  hitFlashDurationS: number
}

export const TARGETS: TargetsTuning = {
  torsoRadius: 0.45,
  headRadius: 0.22,
  headOffsetY: 0.62,
  maxHealth: 100,
  respawnDelayS: 2.5,
  hitFlashDurationS: 0.15,
}
