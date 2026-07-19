/**
 * Etiqueta legible de un participante de partida para la UI (killfeed,
 * scoreboard, resumen post-partida). Presentación pura, sin JSX -- separado
 * de los componentes para poder compartirlo entre Killfeed/Scoreboard/
 * MatchSummary sin duplicar la regla "id 0 es el jugador" en cada uno.
 */

import { PLAYER_ID } from '@/game/match/types'

export function participantLabel(id: number): string {
  // "Tú" y no "Vos": el juego habla en español neutro con tuteo, y el
  // voseo se coló acá cuando esta etiqueta era sólo del killfeed.
  return id === PLAYER_ID ? 'Tú' : `Bot ${id}`
}
