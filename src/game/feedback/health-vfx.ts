/**
 * Latido + desaturación bajo 30 de vida (sección 5 del spec). No existe
 * ningún sistema de vida real todavía -- fase 2 son los bots, la única
 * fuente de daño al jugador -- así que este módulo también posee el
 * escalar mínimo de vida que hace falta para poder ejercitar estos efectos
 * hoy: un hook de debug (ver game.ts) y los tests son sus únicos llamadores
 * por ahora. No es un sistema de vida (sin muerte, sin regeneración): es
 * el dato mínimo que las curvas de acá abajo necesitan leer.
 */

import { clamp01, lerp } from '@/game/feedback/curve'
import { FEEDBACK } from '@/game/feedback/tuning'

export interface PlayerHealthState {
  health: number
}

export function createPlayerHealthState(): PlayerHealthState {
  return { health: FEEDBACK.startingHealth }
}

export function applyDamageToPlayer(state: PlayerHealthState, damage: number): void {
  state.health = Math.max(0, state.health - damage)
}

export function resetPlayerHealth(state: PlayerHealthState): void {
  state.health = FEEDBACK.startingHealth
}

/** 0 en o sobre el umbral; sube hasta desaturationMax a vida 0. */
export function desaturationAmount(health: number): number {
  if (health >= FEEDBACK.lowHealthThreshold) return 0
  const t = clamp01(1 - health / FEEDBACK.lowHealthThreshold)
  return t * FEEDBACK.desaturationMax
}

/** BPM del latido: 0 en o sobre el umbral, sube hacia heartbeatBpmAtZero
 *  mientras la vida baja hacia 0. */
export function heartbeatBpm(health: number): number {
  if (health >= FEEDBACK.lowHealthThreshold) return 0
  const t = clamp01(1 - health / FEEDBACK.lowHealthThreshold)
  return lerp(FEEDBACK.heartbeatBpmAtThreshold, FEEDBACK.heartbeatBpmAtZero, t)
}

/** Pulso 0..1 en el instante `elapsedSeconds`, a partir del bpm que da
 *  `heartbeatBpm(health)`. 0 constante si el bpm es 0 (vida por sobre el
 *  umbral): sin esto, Math.sin(0) igual daría 0.5 en vez de "sin latido". */
export function heartbeatPulse(health: number, elapsedSeconds: number): number {
  const bpm = heartbeatBpm(health)
  if (bpm <= 0) return 0
  const phase = elapsedSeconds * (bpm / 60) * Math.PI * 2
  return Math.sin(phase) * 0.5 + 0.5
}
