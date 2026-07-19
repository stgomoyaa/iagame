/**
 * Los tres efectos mecánicos del ADS (sección 4 del spec de fase 1): FOV,
 * sensibilidad y velocidad de movimiento interpolan junto con la
 * transición visual del arma, no saltan al llegar. Matemática pura:
 * game.ts lee `vmState.adsT` (ya existe, lo produce stepViewmodel en
 * weapons/viewmodel/rig.ts) y pasa la MISMA curva de easing
 * (easeInOutCubic, exportada de rig.ts) que usa la pose visual, para que
 * FOV/sensibilidad/velocidad terminen de moverse exactamente cuando el
 * arma termina de moverse, ni antes ni después.
 */

import type { AdsSpec } from '@/game/weapons/archetypes'

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** `easedT` es adsT ya pasado por easeInOutCubic (weapons/viewmodel/rig.ts):
 *  en 0 da `baseFov`, en 1 da exactamente `baseFov * ads.fovScale`. */
export function adsFov(baseFov: number, ads: AdsSpec, easedT: number): number {
  return lerp(baseFov, baseFov * ads.fovScale, easedT)
}

/** Multiplicador de sensibilidad del mouse: 1 en reposo, ads.sensScale a
 *  ADS completo. */
export function adsSensitivityMultiplier(ads: AdsSpec, easedT: number): number {
  return lerp(1, ads.sensScale, easedT)
}

/** Multiplicador de velocidad de movimiento: 1 en reposo, ads.speedScale a
 *  ADS completo. */
export function adsSpeedMultiplier(ads: AdsSpec, easedT: number): number {
  return lerp(1, ads.speedScale, easedT)
}
