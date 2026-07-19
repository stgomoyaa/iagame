/**
 * Orquesta el sistema de feedback completo (sección 5 del spec de fase 1):
 * un `FeedbackState` preasignado una vez, tres puntos de entrada
 * (`onShotFired`, `onHitConfirmed`, `onDamageTaken`) que los eventos de
 * combate disparan, y `stepFeedback` que envejece todo una vez por frame.
 * Mismo rol que combat/combat.ts para el combate: matemática pura, sin DOM
 * ni Three -- feedback/overlay.ts es quien lee este estado para pintar.
 *
 * El audio (feedback/audio.ts) queda AFUERA de este estado a propósito: es
 * el único módulo de esta carpeta que no es puro (Web Audio real), y
 * `FeedbackAudio` no tiene nada preasignado que un test de asignaciones
 * necesite cubrir. game.ts llama a `audio.playHitmarker(tier)` con el nivel
 * que devuelve `onHitConfirmed`, por su cuenta.
 */

import {
  createCameraPunchState,
  fireCameraPunch,
  stepCameraPunch,
  type CameraPunchState,
} from '@/game/feedback/camera-punch'
import {
  createDamageNumberState,
  spawnDamageNumber,
  stepDamageNumbers,
  type DamageNumberState,
} from '@/game/feedback/damage-numbers'
import {
  createHitmarkerState,
  hitmarkerTier,
  spawnHitmarker,
  stepHitmarkers,
  type HitmarkerState,
  type HitmarkerTier,
} from '@/game/feedback/hitmarkers'
import {
  applyDamageToPlayer,
  createPlayerHealthState,
  type PlayerHealthState,
} from '@/game/feedback/health-vfx'
import { addShake, createShakeState, stepShake, type ShakeState } from '@/game/feedback/shake'
import {
  createVignetteState,
  spawnVignette,
  stepVignette,
  type VignetteState,
} from '@/game/feedback/vignette'

export interface FeedbackState {
  hitmarkers: HitmarkerState
  damageNumbers: DamageNumberState
  cameraPunch: CameraPunchState
  shake: ShakeState
  vignette: VignetteState
  health: PlayerHealthState
  /** Reloj propio, para la fase del latido (health-vfx.ts: heartbeatPulse
   *  necesita un tiempo transcurrido, no sólo dt). */
  elapsedSeconds: number
}

export function createFeedbackState(): FeedbackState {
  return {
    hitmarkers: createHitmarkerState(),
    damageNumbers: createDamageNumberState(),
    cameraPunch: createCameraPunchState(),
    shake: createShakeState(),
    vignette: createVignetteState(),
    health: createPlayerHealthState(),
    elapsedSeconds: 0,
  }
}

/** Envejece todos los pools y resortes un frame. Llamar una vez por frame
 *  renderizado, sin importar si hubo eventos nuevos o no (igual que
 *  stepSpreadRecovery/stepRecoilRecovery en combat/). */
export function stepFeedback(state: FeedbackState, dt: number): void {
  state.elapsedSeconds += dt
  stepHitmarkers(state.hitmarkers, dt)
  stepDamageNumbers(state.damageNumbers, dt)
  stepCameraPunch(state.cameraPunch, dt)
  stepShake(state.shake, dt)
  stepVignette(state.vignette, dt)
}

/** Un disparo salió (haya pegado o no): punch de cámara. */
export function onShotFired(state: FeedbackState): void {
  fireCameraPunch(state.cameraPunch)
}

/** Un disparo confirmó impacto contra un objetivo real: hitmarker + número
 *  de daño. Devuelve el nivel resuelto para que el llamador dispare el
 *  sonido correspondiente (feedback/audio.ts, fuera de este estado). */
export function onHitConfirmed(
  state: FeedbackState,
  ndcX: number,
  ndcY: number,
  damage: number,
  isHeadshot: boolean,
  isKill: boolean,
): HitmarkerTier {
  const tier = hitmarkerTier(isHeadshot, isKill)
  spawnHitmarker(state.hitmarkers, tier, damage)
  spawnDamageNumber(state.damageNumbers, ndcX, ndcY, damage, isHeadshot)
  return tier
}

/** El jugador recibió daño desde `bearing` (ver vignette.ts: 0 = de
 *  frente). Viñeta direccional + shake + resta de vida. */
export function onDamageTaken(state: FeedbackState, bearing: number, damage: number): void {
  spawnVignette(state.vignette, bearing, damage)
  addShake(state.shake, damage)
  applyDamageToPlayer(state.health, damage)
}
