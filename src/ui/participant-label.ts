/**
 * Etiqueta legible de un participante de partida para la UI (killfeed,
 * scoreboard, resumen post-partida). Presentación pura, sin JSX -- separado
 * de los componentes para poder compartirlo entre Killfeed/Scoreboard/
 * MatchSummary sin duplicar la regla "id 0 es el jugador" en cada uno.
 */

import { PLAYER_ID } from '@/game/match/types'

export function participantLabel(id: number): string {
  return id === PLAYER_ID ? 'Vos' : `Bot ${id}`
}
