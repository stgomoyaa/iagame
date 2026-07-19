/**
 * Screen shake al recibir daño (sección 5 del spec: "proporcional al
 * daño"). Un escalar de magnitud que crece con cada golpe recibido (clampeado
 * a shakeMax) y decae linealmente hacia 0 (mismo approachZero que la
 * recuperación de retroceso en combat/recoil.ts); el offset x/y de cada
 * frame es una muestra determinista (mulberry32) dentro de un círculo de
 * radio = magnitud actual, así que el offset nunca puede superar la
 * magnitud por construcción.
 */

import { approachZero } from '@/game/feedback/curve'
import { FEEDBACK } from '@/game/feedback/tuning'

export interface ShakeState {
  magnitude: number
  offsetX: number
  offsetY: number
  rngState: number
}

const SHAKE_SEED = 0x5eed1234

export function createShakeState(): ShakeState {
  return { magnitude: 0, offsetX: 0, offsetY: 0, rngState: SHAKE_SEED }
}

function nextRandom(state: ShakeState): number {
  let a = state.rngState
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  state.rngState = a
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Daño recibido: crece la magnitud, sin pasar de shakeMax. */
export function addShake(state: ShakeState, damage: number): void {
  state.magnitude = Math.min(FEEDBACK.shakeMax, state.magnitude + damage * FEEDBACK.shakePerDamage)
}

/** Avanza un frame: decae la magnitud y muestrea un offset nuevo dentro del
 *  círculo de radio = magnitud. Sin magnitud, el offset queda en (0,0) --
 *  no tiene sentido seguir muestreando ángulos para un shake invisible. */
export function stepShake(state: ShakeState, dt: number): void {
  state.magnitude = approachZero(state.magnitude, FEEDBACK.shakeDecayPerSecond, dt)

  if (state.magnitude <= 0) {
    state.offsetX = 0
    state.offsetY = 0
    return
  }

  const angle = nextRandom(state) * Math.PI * 2
  state.offsetX = Math.cos(angle) * state.magnitude
  state.offsetY = Math.sin(angle) * state.magnitude
}
