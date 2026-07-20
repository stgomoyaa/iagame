/**
 * Etiqueta legible de un participante de partida para la UI (killfeed,
 * scoreboard, resumen post-partida). Presentación pura, sin JSX -- separado
 * de los componentes para poder compartirlo entre Killfeed/Scoreboard/
 * MatchSummary sin duplicar la regla "id 0 es el jugador" en cada uno.
 */

import { PLAYER_ID } from '@/game/match/types'
import { BOT_NAMES } from '@/ui/bot-names'

export function participantLabel(id: number): string {
  // "Tú" y no "Vos": el juego habla en español neutro con tuteo, y el
  // voseo se coló acá cuando esta etiqueta era sólo del killfeed.
  if (id === PLAYER_ID) return 'Tú'

  // Nombre por id, no al azar: el mismo bot conserva su nombre toda la
  // partida. Sin eso, el killfeed sería una lista de desconocidos y no se
  // podría reconocer al que te viene matando, que es la mitad de para qué
  // sirve un killfeed.
  //
  // El módulo se lee con el índice envuelto en vez de indexar directo: con
  // más bots que nombres, `BOT_NAMES[id]` daría `undefined` y el killfeed
  // mostraría "undefined" en pantalla. Repetir un nombre es peor que
  // ninguno sólo en teoría; mostrar `undefined` es peor en la práctica.
  const nombre = BOT_NAMES[((id % BOT_NAMES.length) + BOT_NAMES.length) % BOT_NAMES.length]
  return nombre ?? `Bot ${id}`
}
