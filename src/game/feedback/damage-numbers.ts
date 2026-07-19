/**
 * Números de daño flotantes: aparecen en el punto de impacto proyectado a
 * pantalla, suben y se apagan (sección 5 del spec). La posición de pantalla
 * (NDC, [-1,1] en cada eje) la calcula el llamador -- game.ts, con
 * engine/renderer.ts haciendo la proyección real vía Three (ver
 * GameRenderer.worldToScreen) -- este módulo es matemática pura sobre esos
 * dos números, sin saber nada de cámaras ni de three.
 */

import { clamp01 } from '@/game/feedback/curve'
import { createRingPool, nextPoolSlot, type RingPool } from '@/game/feedback/pool'
import { FEEDBACK } from '@/game/feedback/tuning'

export interface DamageNumberEntry {
  active: boolean
  age: number
  value: number
  /** Posición NDC de aparición ([-1,1]), fija durante toda la vida del
   *  número: sube en espacio de pantalla desde ahí, no vuelve a proyectarse
   *  cada frame (si la cámara gira mientras el número flota, no lo sigue --
   *  mismo comportamiento que Overwatch/Apex, y evita repetir la proyección
   *  3D cada frame por cada número activo). */
  ndcX: number
  ndcY: number
  isHeadshot: boolean
}

export interface DamageNumberState {
  pool: RingPool<DamageNumberEntry>
  /** Estado del PRNG determinista (mulberry32) para el jitter de aparición.
   *  Mismo algoritmo que combat/spread.ts, duplicado localmente en vez de
   *  importado: son 6 líneas y evita acoplar feedback/ a combat/. */
  rngState: number
}

const JITTER_SEED = 0xa17e3f01

export function createDamageNumberState(): DamageNumberState {
  return {
    pool: createRingPool<DamageNumberEntry>(FEEDBACK.damageNumberPoolSize, () => ({
      active: false,
      age: 0,
      value: 0,
      ndcX: 0,
      ndcY: 0,
      isHeadshot: false,
    })),
    rngState: JITTER_SEED,
  }
}

function nextRandom(state: DamageNumberState): number {
  let a = state.rngState
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  state.rngState = a
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Dispara un número de daño nuevo, con un jitter chico alrededor de
 *  (ndcX, ndcY) para que hits simultáneos (p. ej. una escopeta) no queden
 *  perfectamente superpuestos. */
export function spawnDamageNumber(
  state: DamageNumberState,
  ndcX: number,
  ndcY: number,
  damage: number,
  isHeadshot: boolean,
): void {
  const slot = nextPoolSlot(state.pool)
  const jitter = FEEDBACK.damageNumberJitterRadius
  slot.active = true
  slot.age = 0
  slot.value = damage
  slot.ndcX = ndcX + (nextRandom(state) * 2 - 1) * jitter
  slot.ndcY = ndcY + (nextRandom(state) * 2 - 1) * jitter
  slot.isHeadshot = isHeadshot
}

export function stepDamageNumbers(state: DamageNumberState, dt: number): void {
  const items = state.pool.items
  for (let i = 0; i < items.length; i++) {
    const entry = items[i]
    if (!entry.active) continue
    entry.age += dt
    if (entry.age >= FEEDBACK.damageNumberLifetimeS) entry.active = false
  }
}

/**
 * Curva de opacidad: sube rápido a 1 (fadeInFraction de la vida), se
 * sostiene, y se apaga desde fadeOutStart hasta el final. Monótona por
 * tramos: nunca "parpadea".
 */
export function damageNumberOpacity(age: number, lifetimeS: number): number {
  if (lifetimeS <= 0) return 0
  const t = clamp01(age / lifetimeS)
  const fadeInEnd = FEEDBACK.damageNumberFadeInFraction
  const fadeOutStart = FEEDBACK.damageNumberFadeOutStart
  if (t < fadeInEnd) return fadeInEnd > 0 ? t / fadeInEnd : 1
  if (t < fadeOutStart) return 1
  return 1 - (t - fadeOutStart) / (1 - fadeOutStart)
}

/** Cuánto subió (en NDC) desde su punto de aparición: arranca rápido y se
 *  frena (ease-out), nunca baja. */
export function damageNumberRiseOffset(age: number, lifetimeS: number): number {
  if (lifetimeS <= 0) return 0
  const t = clamp01(age / lifetimeS)
  const eased = 1 - (1 - t) * (1 - t)
  return FEEDBACK.damageNumberRiseDistance * eased
}
