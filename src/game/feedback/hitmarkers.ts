/**
 * Hitmarker: al impactar, un ícono en la mira que escala con el daño y
 * distingue cuatro niveles (sección 5 del spec: "impacto normal, headshot,
 * kill, headshot kill"). Siempre centrado en la mira -- un hitmarker ES la
 * mira reaccionando, no un marcador en el punto de impacto del mundo (eso
 * es el número de daño flotante, ver damage-numbers.ts) -- así que este
 * módulo no necesita ninguna posición de pantalla.
 */

import { clamp01, lerp } from '@/game/feedback/curve'
import { createRingPool, nextPoolSlot, type RingPool } from '@/game/feedback/pool'
import { FEEDBACK } from '@/game/feedback/tuning'

export type HitmarkerTier = 'normal' | 'headshot' | 'kill' | 'headshotKill'

/** Nivel del hitmarker a partir de si la parte golpeada fue la cabeza y si
 *  el impacto bajó al objetivo a 0 o menos de vida. Pura: no sabe nada de
 *  daño, distancia ni del objetivo real -- eso ya lo decidió el llamador. */
export function hitmarkerTier(isHeadshot: boolean, isKill: boolean): HitmarkerTier {
  if (isHeadshot && isKill) return 'headshotKill'
  if (isKill) return 'kill'
  if (isHeadshot) return 'headshot'
  return 'normal'
}

/** Escala visual del hitmarker: crece con el daño hasta saturar en
 *  hitmarkerDamageForMaxScale (sección 5: "escala con el daño"). */
export function hitmarkerScale(damage: number): number {
  const t = clamp01(damage / FEEDBACK.hitmarkerDamageForMaxScale)
  return lerp(FEEDBACK.hitmarkerBaseScale, FEEDBACK.hitmarkerMaxScale, t)
}

/** Opacidad del hitmarker según su edad: visible de golpe, se apaga con
 *  una rampa lineal en el último tercio de su vida. Monótona no creciente. */
export function hitmarkerOpacity(age: number, durationS: number): number {
  if (durationS <= 0) return 0
  const t = clamp01(age / durationS)
  const fadeStart = 2 / 3
  if (t < fadeStart) return 1
  return 1 - (t - fadeStart) / (1 - fadeStart)
}

export interface HitmarkerEntry {
  active: boolean
  age: number
  tier: HitmarkerTier
  scale: number
}

export interface HitmarkerState {
  pool: RingPool<HitmarkerEntry>
}

export function createHitmarkerState(): HitmarkerState {
  return {
    pool: createRingPool<HitmarkerEntry>(FEEDBACK.hitmarkerPoolSize, () => ({
      active: false,
      age: 0,
      tier: 'normal',
      scale: 1,
    })),
  }
}

/** Dispara un hitmarker nuevo desde un slot del pool (ver pool.ts: recicla
 *  el más viejo si no queda ninguno libre, nunca asigna). */
export function spawnHitmarker(state: HitmarkerState, tier: HitmarkerTier, damage: number): void {
  const slot = nextPoolSlot(state.pool)
  slot.active = true
  slot.age = 0
  slot.tier = tier
  slot.scale = hitmarkerScale(damage)
}

/** Envejece todos los hitmarkers activos un frame; desactiva los que ya
 *  cumplieron su duración. For indexado, sin callbacks (camino de frame). */
export function stepHitmarkers(state: HitmarkerState, dt: number): void {
  const items = state.pool.items
  for (let i = 0; i < items.length; i++) {
    const entry = items[i]
    if (!entry.active) continue
    entry.age += dt
    if (entry.age >= FEEDBACK.hitmarkerDurationS) entry.active = false
  }
}
