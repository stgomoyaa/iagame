/**
 * Viñeta roja direccional al recibir daño (sección 5 del spec: "indica de
 * dónde vino"). Matemática pura: un "bearing" (radianes relativos a hacia
 * dónde mira la cámara, misma convención de yaw que combat/shot.ts) más un
 * pool de flashes que se apagan solos, para que golpes seguidos desde
 * distintas direcciones puedan solaparse en vez de que el segundo pise al
 * primero.
 *
 * Convención de bearing (idéntica al yaw del resto del motor -- ver
 * engine/input.ts: `applyYaw` resta el movimiento del mouse, así que girar
 * a la derecha DISMINUYE el yaw): bearing 0 = el daño vino de adelante,
 * +-PI = de atrás, negativo = de la derecha del jugador, positivo = de la
 * izquierda.
 */

import { normalizeAngle } from '@/game/feedback/curve'
import { createRingPool, nextPoolSlot, type RingPool } from '@/game/feedback/pool'
import { FEEDBACK } from '@/game/feedback/tuning'

/**
 * Yaw de mundo tal que `computeForward(0, yaw)` (combat/shot.ts) apunta
 * hacia (dx, dz) desde el origen. Inversa de esa función: se deriva acá en
 * vez de importarla para no acoplar feedback/ a combat/ por una fórmula de
 * una línea; misma convención (fx = -sin(yaw), fz = -cos(yaw)).
 */
export function directionYaw(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

/** Bearing relativo a la cámara: 0 = de frente, +-PI = de atrás. */
export function vignetteBearing(playerYaw: number, sourceYawWorld: number): number {
  return normalizeAngle(sourceYawWorld - playerYaw)
}

/** Opacidad pico según el daño recibido: satura en vignetteMaxOpacity. */
export function vignettePeakOpacity(damage: number): number {
  const t = Math.min(1, damage / FEEDBACK.vignetteDamageForMaxOpacity)
  return FEEDBACK.vignetteBaseOpacity + (FEEDBACK.vignetteMaxOpacity - FEEDBACK.vignetteBaseOpacity) * t
}

/** Opacidad actual de un flash: pico inmediato, apagado lineal hasta 0. */
export function vignetteOpacity(age: number, peakOpacity: number, durationS: number): number {
  if (durationS <= 0) return 0
  const t = Math.min(1, Math.max(0, age / durationS))
  return peakOpacity * (1 - t)
}

export interface VignetteEntry {
  active: boolean
  age: number
  bearing: number
  peakOpacity: number
}

export interface VignetteState {
  pool: RingPool<VignetteEntry>
}

export function createVignetteState(): VignetteState {
  return {
    pool: createRingPool<VignetteEntry>(FEEDBACK.vignettePoolSize, () => ({
      active: false,
      age: 0,
      bearing: 0,
      peakOpacity: 0,
    })),
  }
}

export function spawnVignette(state: VignetteState, bearing: number, damage: number): void {
  const slot = nextPoolSlot(state.pool)
  slot.active = true
  slot.age = 0
  slot.bearing = bearing
  slot.peakOpacity = vignettePeakOpacity(damage)
}

export function stepVignette(state: VignetteState, dt: number): void {
  const items = state.pool.items
  for (let i = 0; i < items.length; i++) {
    const entry = items[i]
    if (!entry.active) continue
    entry.age += dt
    if (entry.age >= FEEDBACK.vignetteDurationS) entry.active = false
  }
}
