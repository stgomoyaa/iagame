/**
 * Puntaje por participante y agregación por equipo. Matemática pura sobre
 * `ParticipantStats[]` -- match.ts es quien decide CUÁNDO sumar un kill/daño
 * y cuándo consultar el ganador; este módulo sólo sabe sumar y comparar.
 */

import type { MatchMode } from '@/game/match/types'
import { teamForParticipant } from '@/game/match/types'

export interface ParticipantStats {
  readonly id: number
  kills: number
  deaths: number
  damageDealt: number
}

export function createParticipantStats(id: number): ParticipantStats {
  return { id, kills: 0, deaths: 0, damageDealt: 0 }
}

/** Daño negativo o NaN no debería llegar nunca desde combat/, pero clampear
 *  acá es barato y evita que un caso borde upstream corrompa el puntaje. */
export function addDamage(stats: ParticipantStats, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return
  stats.damageDealt += amount
}

/** Un kill de `killer` sobre `victim`. No valida equipos -- game.ts sólo
 *  llama esto cuando el impacto ya vino de una hitbox enemiga (las listas
 *  por participante que arma game.ts excluyen a los propios compañeros de
 *  equipo, así que un "kill" entre aliados no puede ocurrir en la práctica;
 *  ver el comentario de cabecera de game.ts sobre esas listas). Suicidio
 *  (killer === victim) no está modelado -- no hay ninguna fuente de daño
 *  propio en este juego (sin explosivos, sin caída) -- así que no hace
 *  falta un caso especial. */
export function addKill(killer: ParticipantStats, victim: ParticipantStats): void {
  killer.kills += 1
  victim.deaths += 1
}

/** Suma de kills de todos los participantes de `team` (mismo criterio de
 *  equipo que match/types.ts: en FFA cada quien es su propio equipo, así
 *  que esto degenera a "los kills de ese único participante"). */
export function teamScore(
  mode: MatchMode,
  participants: readonly ParticipantStats[],
  team: number,
): number {
  let total = 0
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i]
    if (teamForParticipant(mode, p.id) === team) total += p.kills
  }
  return total
}

/** El kill count más alto entre todos los participantes (0 si la lista está
 *  vacía). Usado por FFA para el límite de puntaje. */
export function leadingKills(participants: readonly ParticipantStats[]): number {
  let max = 0
  for (let i = 0; i < participants.length; i++) if (participants[i].kills > max) max = participants[i].kills
  return max
}

/** Copia ordenada por kills descendente (empate: menos muertes primero,
 *  luego id ascendente para que el orden sea determinista). Asigna un array
 *  nuevo a propósito -- ver el comentario de listActiveKillsNewestFirst en
 *  killfeed.ts: esto lo consume la UI de baja frecuencia (scoreboard,
 *  resumen de partida), no el loop de frame. */
export function sortedByKills(participants: readonly ParticipantStats[]): ParticipantStats[] {
  return [...participants].sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills
    if (a.deaths !== b.deaths) return a.deaths - b.deaths
    return a.id - b.id
  })
}
