/**
 * Punch de cámara al disparar (sección 5 del spec: "sutil, al disparar").
 * Roll de cámara (eje Z), no pitch/yaw: esos dos ya los usa el retroceso
 * aprendible (combat/recoil.ts) y sumarle un canal más ahí distorsionaría
 * un patrón ya calibrado a magnitudes físicas (spec de fase 1, sección 3).
 * game.ts pasa `cameraPunchRoll(state)` como el tercer argumento de
 * `camera.rotation.set(pitch, yaw, roll, 'YXZ')`, que hoy siempre recibe 0.
 *
 * Resorte amortiguado de segundo orden, mismo esquema que sway/kick del
 * viewmodel (weapons/viewmodel/rig.ts: springVelocity) pero reimplementado
 * acá en vez de importado: es una función de tres líneas y evita acoplar
 * feedback/ a weapons/viewmodel/.
 */

import { FEEDBACK } from '@/game/feedback/tuning'

export interface CameraPunchState {
  /** Roll acumulado, radianes. Se suma al roll final de cámara. */
  roll: number
  rollVel: number
  /** +1 o -1: alterna en cada disparo para que el punch no repita siempre
   *  el mismo lado (mismo truco que kickSide en rig.ts). */
  side: number
}

export function createCameraPunchState(): CameraPunchState {
  return { roll: 0, rollVel: 0, side: 1 }
}

/** Impulso de un disparo. Llamar una vez por bala (game.ts la invoca
 *  `shots` veces, el conteo que devuelve stepCombat). */
export function fireCameraPunch(state: CameraPunchState): void {
  state.rollVel += FEEDBACK.cameraPunchPerShot * state.side
  state.side = -state.side
}

/** Avanza el resorte un frame: decae hacia 0, clampeado a cameraPunchMax
 *  para que fuego sostenido a cadencia alta no pueda acumular más rápido de
 *  lo que decae. */
export function stepCameraPunch(state: CameraPunchState, dt: number): void {
  const v = state.rollVel + (0 - state.roll) * FEEDBACK.cameraPunchStiffness * dt
  state.rollVel = v * Math.exp(-FEEDBACK.cameraPunchDamping * dt)
  state.roll += state.rollVel * dt

  const max = FEEDBACK.cameraPunchMax
  if (state.roll > max) {
    state.roll = max
    state.rollVel = 0
  } else if (state.roll < -max) {
    state.roll = -max
    state.rollVel = 0
  }
}
