/**
 * Punch de cámara al disparar (sección 5 del spec: "sutil, al disparar").
 * Este es el CANAL DE SENSACIÓN, deliberadamente separado del canal de
 * APUNTADO (combat/recoil.ts). El de apuntado mueve hacia dónde van las
 * balas (el patrón determinista, aprendible, preciso en el primer tiro); el
 * de acá es un golpe visual amortiguado que NO toca el hitscan, sólo la
 * rotación con la que se renderiza la cámara (game.ts lo suma sobre
 * finalPitch/finalYaw/roll). Por eso este golpe SÍ patea en el primer tiro y
 * en cada tap, mientras el patrón de apuntado arranca en cero (bala precisa):
 * es exactamente lo que hace que un arma "se sienta" sin arruinar la
 * mecánica de spray calibrada.
 *
 * Tres ejes:
 * - roll (eje Z): el punch sutil universal, igual para toda arma
 *   (FEEDBACK.cameraPunchPerShot). Alterna de lado disparo a disparo.
 * - pitch (eje X, "mirar arriba"): el golpe principal hacia arriba, con
 *   magnitud POR ARMA (archetype.recoil.viewKick). Una escopeta patea fuerte,
 *   una SMG apenas. Es lo que diferencia el tacto de las 10 clases.
 * - yaw (eje Y): una fracción lateral del golpe de pitch, alternando de lado,
 *   para que el kick no sea puramente vertical (se lee como sacudida, no como
 *   ascensor).
 *
 * Resorte amortiguado de segundo orden por eje, mismo esquema que sway/kick
 * del viewmodel (weapons/viewmodel/rig.ts: springVelocity) pero
 * reimplementado acá en vez de importado: evita acoplar feedback/ a
 * weapons/viewmodel/.
 */

import { FEEDBACK } from '@/game/feedback/tuning'

export interface CameraPunchState {
  /** Roll acumulado, radianes. Se suma al roll final de cámara. */
  roll: number
  rollVel: number
  /** Pitch (golpe hacia arriba) acumulado, radianes. Se suma al pitch final
   *  de cámara SÓLO para renderizar — nunca alimenta el hitscan. */
  pitch: number
  pitchVel: number
  /** Yaw (sacudida lateral) acumulado, radianes. View-only igual que pitch. */
  yaw: number
  yawVel: number
  /** +1 o -1: alterna en cada disparo para que el punch no repita siempre
   *  el mismo lado (mismo truco que kickSide en rig.ts). Gobierna el signo
   *  de roll e yaw a la vez, así ambos se inclinan al mismo lado por disparo. */
  side: number
}

export function createCameraPunchState(): CameraPunchState {
  return { roll: 0, rollVel: 0, pitch: 0, pitchVel: 0, yaw: 0, yawVel: 0, side: 1 }
}

/**
 * Impulso de un disparo. Llamar una vez por bala (game.ts la invoca `shots`
 * veces, el conteo que devuelve stepCombat). `kick` es la magnitud del golpe
 * de pitch/yaw POR ARMA (archetype.recoil.viewKick, radianes/seg de impulso
 * de velocidad); por defecto 0 para llamadores que sólo quieren el roll
 * universal (tests, hooks de debug sin arquetipo).
 */
export function fireCameraPunch(state: CameraPunchState, kick = 0): void {
  // pitch siempre hacia arriba (positivo = mirar arriba, misma convención que
  // el retroceso de apuntado en combat/recoil.ts).
  state.pitchVel += kick
  // yaw e roll alternan del mismo lado en este disparo.
  state.yawVel += kick * FEEDBACK.cameraKickLateralFraction * state.side
  state.rollVel += FEEDBACK.cameraPunchPerShot * state.side
  state.side = -state.side
}

/**
 * Avanza los tres resortes un frame: cada eje decae hacia 0, clampeado a su
 * tope para que fuego sostenido a cadencia alta no pueda acumular más rápido
 * de lo que decae. Pitch e yaw usan sus propios topes
 * (cameraKickPitchMax/cameraKickYawMax): el desfase entre el punch de vista y
 * el apuntado real nunca puede crecer más allá de eso, así que las balas
 * nunca caen "muy lejos" de la retícula durante un spray largo.
 */
export function stepCameraPunch(state: CameraPunchState, dt: number): void {
  const stiffness = FEEDBACK.cameraPunchStiffness
  const decay = Math.exp(-FEEDBACK.cameraPunchDamping * dt)

  state.rollVel = (state.rollVel + (0 - state.roll) * stiffness * dt) * decay
  state.roll += state.rollVel * dt
  clampAxisRoll(state)

  state.pitchVel = (state.pitchVel + (0 - state.pitch) * stiffness * dt) * decay
  state.pitch += state.pitchVel * dt
  if (state.pitch > FEEDBACK.cameraKickPitchMax) {
    state.pitch = FEEDBACK.cameraKickPitchMax
    state.pitchVel = 0
  } else if (state.pitch < -FEEDBACK.cameraKickPitchMax) {
    state.pitch = -FEEDBACK.cameraKickPitchMax
    state.pitchVel = 0
  }

  state.yawVel = (state.yawVel + (0 - state.yaw) * stiffness * dt) * decay
  state.yaw += state.yawVel * dt
  if (state.yaw > FEEDBACK.cameraKickYawMax) {
    state.yaw = FEEDBACK.cameraKickYawMax
    state.yawVel = 0
  } else if (state.yaw < -FEEDBACK.cameraKickYawMax) {
    state.yaw = -FEEDBACK.cameraKickYawMax
    state.yawVel = 0
  }
}

/** Clamp del roll a cameraPunchMax (el eje histórico; extraído sólo para que
 *  stepCameraPunch se lea igual en los tres ejes). */
function clampAxisRoll(state: CameraPunchState): void {
  const max = FEEDBACK.cameraPunchMax
  if (state.roll > max) {
    state.roll = max
    state.rollVel = 0
  } else if (state.roll < -max) {
    state.roll = -max
    state.rollVel = 0
  }
}
