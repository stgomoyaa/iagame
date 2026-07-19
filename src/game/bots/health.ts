/**
 * Vida y respawn de bots. Mismo patrón que targets/targets.ts (health,
 * alive, respawnT): un bot muerto no desaparece del array, se congela y
 * revive con vida llena tras `respawnDelayS` -- sin puntaje, sin killfeed,
 * sin lógica de partida: eso es TDM (sección "Fases" del spec, segunda
 * mitad de la fase 2, tarea aparte). Esto es lo mínimo para que "Retirarse"
 * (bots/fsm.ts) tenga una vida real de la que depender y para que probar
 * bots en el navegador no requiera reiniciar la página cada vez que uno
 * muere.
 */

import { BOTS } from '@/game/bots/tuning'

export interface BotHealthState {
  health: number
  maxHealth: number
  alive: boolean
  /** Segundos desde que murió (health llegó a 0). Sólo avanza mientras !alive. */
  respawnT: number
}

export function createBotHealthState(maxHealth: number = BOTS.maxHealth): BotHealthState {
  return { health: maxHealth, maxHealth, alive: true, respawnT: 0 }
}

/** Fracción de vida 0..1. 0 si maxHealth es 0 o menos (caso degenerado, no
 *  debería darse con la tuning real). */
export function healthFraction(state: BotHealthState): number {
  return state.maxHealth > 0 ? state.health / state.maxHealth : 0
}

/**
 * Resta `damage`. Devuelve `true` si ESTE impacto lo mató (vida a 0 o menos,
 * viniendo de estar vivo) -- mismo contrato que targets/targets.ts
 * applyHit(). No hace nada si ya estaba muerto (un cadáver no puede volver a
 * morir).
 */
export function applyDamageToBot(state: BotHealthState, damage: number): boolean {
  if (!state.alive) return false
  state.health -= damage
  if (state.health <= 0) {
    state.health = 0
    state.alive = false
    state.respawnT = 0
    return true
  }
  return false
}

/**
 * Avanza el temporizador de respawn. Devuelve `true` en el tick exacto en
 * que revivió (vida llena, alive=true) -- el llamador (bots/bot.ts) lo usa
 * para reposicionar al bot en un spawn y resetear su FSM a Idle.
 */
export function stepBotRespawn(
  state: BotHealthState,
  dt: number,
  respawnDelayS: number = BOTS.respawnDelayS,
): boolean {
  if (state.alive) return false
  state.respawnT += dt
  if (state.respawnT >= respawnDelayS) {
    state.alive = true
    state.health = state.maxHealth
    state.respawnT = 0
    return true
  }
  return false
}
