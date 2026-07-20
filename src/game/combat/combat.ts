/**
 * Orquesta un frame de combate: cadencia de disparo (fire-control.ts),
 * retroceso determinista + recuperación (recoil.ts), dispersión aleatoria
 * (spread.ts) y resolución del disparo (shot.ts). game.ts llama a
 * stepCombat() una vez por frame renderizado; el resto de este módulo no
 * sabe nada de Three, del canvas ni del input system — recibe primitivos.
 */

import type { Vec3 } from '@/game/math/vec3'
import type { WeaponArchetype } from '@/game/weapons/archetypes'
import type { RecoilPattern } from '@/game/weapons/recoil-patterns'
import {
  createFireControlState,
  resetFireControl,
  stepFireControl,
  syncReloadState,
  type FireControlState,
} from '@/game/combat/fire-control'
import {
  applyRecoilShot,
  applyRecoilToPitch,
  applyRecoilToYaw,
  createRecoilState,
  resetRecoil,
  resetRecoilPattern,
  stepRecoilRecovery,
  type RecoilState,
} from '@/game/combat/recoil'
import {
  createSpreadState,
  growSpread,
  resetSpread,
  sampleSpread,
  stepSpreadRecovery,
  type SpreadSample,
  type SpreadState,
} from '@/game/combat/spread'
import { fireShot, type ShotResult } from '@/game/combat/shot'
import type { Hitbox } from '@/game/combat/hitboxes'

export interface CombatState {
  fireControl: FireControlState
  recoil: RecoilState
  spread: SpreadState
}

/** Semilla fija para el PRNG de dispersión: a diferencia del patrón de
 *  retroceso, el jugador no puede "memorizar" dispersión aleatoria de todos
 *  modos, así que no hace falta que varíe entre sesiones — y mantenerla fija
 *  hace que el comportamiento sea reproducible al testear. */
const SPREAD_SEED = 0x9e3779b9

export function createCombatState(archetype: WeaponArchetype): CombatState {
  return {
    fireControl: createFireControlState(archetype),
    recoil: createRecoilState(),
    spread: createSpreadState(archetype.recoil.spread, SPREAD_SEED),
  }
}

/** Reinicia todo el estado de combate para un arma recién equipada:
 *  munición llena, sin retroceso acumulado, dispersión en reposo. */
export function resetCombatState(state: CombatState, archetype: WeaponArchetype): void {
  resetFireControl(state.fireControl, archetype)
  resetRecoil(state.recoil)
  resetSpread(state.spread, archetype.recoil.spread)
}

export interface CombatInput {
  triggerHeld: boolean
  reloading: boolean
  origin: Vec3
  /** Pitch/yaw del JUGADOR (mouse), antes de aplicar retroceso. */
  pitch: number
  yaw: number
}

// Scratch preasignado a nivel de módulo: cero asignaciones por frame/disparo.
const scratchSpreadSample: SpreadSample = { dPitch: 0, dYaw: 0 }

/**
 * Avanza un frame de combate. Devuelve cuántos disparos resolvió este
 * frame (0 si no correspondía disparar). `out` recibe el resultado del
 * ÚLTIMO disparo resuelto este frame — en el arsenal actual, más de un
 * disparo por frame sólo pasa si un frame se cuelga más que el intervalo
 * de cadencia del arma (ver fire-control.ts), un caso raro que fase 2
 * (dianas con vida real) puede revisar si hace falta granularidad por
 * disparo dentro del mismo frame.
 */
export function stepCombat(
  state: CombatState,
  archetype: WeaponArchetype,
  input: CombatInput,
  hitboxes: Hitbox[],
  dt: number,
  out: ShotResult,
  /**
   * Patrón de retroceso del ARMA (weapons/recoil-patterns.ts). Opcional y al
   * final a propósito: quien no lo pasa (los bots, que eligen por arquetipo y
   * no por modelo) sigue recibiendo el del arquetipo, sin cambiar su llamada.
   */
  recoilPattern?: RecoilPattern,
): number {
  const reloadJustCompleted = syncReloadState(state.fireControl, archetype, input.reloading)
  if (reloadJustCompleted) resetRecoilPattern(state.recoil)
  const shots = stepFireControl(state.fireControl, archetype, input.triggerHeld, input.reloading, dt)

  for (let i = 0; i < shots; i++) {
    applyRecoilShot(state.recoil, archetype, recoilPattern)
    growSpread(state.spread, archetype.recoil.spread)
    sampleSpread(state.spread, scratchSpreadSample)
    fireShot(
      input.origin,
      applyRecoilToPitch(input.pitch, state.recoil),
      applyRecoilToYaw(input.yaw, state.recoil),
      scratchSpreadSample.dPitch,
      scratchSpreadSample.dYaw,
      archetype,
      hitboxes,
      out,
    )
  }

  // La recuperación de retroceso y dispersión sólo corre mientras el
  // jugador NO está activamente sosteniendo el gatillo: mientras lo
  // sostiene, el patrón/crecimiento de arriba ya son la fuente de verdad
  // de este frame (ver el comentario de stepRecoilRecovery en recoil.ts).
  stepRecoilRecovery(state.recoil, archetype, input.triggerHeld, dt)
  stepSpreadRecovery(state.spread, archetype.recoil.spread, input.triggerHeld, dt)

  return shots
}

/** Pitch/yaw finales de cámara para ESTE frame (jugador + retroceso ya
 *  clampeado a PITCH_LIMIT). game.ts los usa para tanto renderizar la
 *  cámara como para el próximo stepCombat(). */
export function cameraPitch(state: CombatState, playerPitch: number): number {
  return applyRecoilToPitch(playerPitch, state.recoil)
}

export function cameraYaw(state: CombatState, playerYaw: number): number {
  return applyRecoilToYaw(playerYaw, state.recoil)
}
