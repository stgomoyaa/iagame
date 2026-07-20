/**
 * Qué tan grande es un mapa, MEDIDO, para que el menú pueda sugerir un
 * tamaño de equipo sin que nadie mantenga una lista a mano.
 *
 * POR QUÉ MEDIDO Y NO UNA TABLA
 * Una tabla `{ nuketown: 'grande', ... }` funciona hasta el siguiente mapa
 * que se importe de Source, y a partir de ahí miente en silencio: el mapa
 * nuevo no está en la tabla, cae en el default, y el preset sugiere 2v2 para
 * una ciudad. Acá el número sale de la geometría del propio mapa, así que un
 * mapa importado mañana se mide solo.
 *
 * QUÉ SE MIDE
 * El **área navegable alcanzable desde los spawns**, en metros cuadrados:
 * las celdas caminables del navgrid (bots/navgrid.ts) que están en la misma
 * componente conexa que los puntos de aparición. Se reusa el navgrid entero
 * en vez de escribir un medidor aparte porque es exactamente la misma
 * pregunta que ya contesta para los bots ("¿dónde se puede caminar?") y
 * porque una segunda implementación sería una segunda respuesta que puede
 * discrepar de la primera.
 *
 * El filtro por componente conexa NO es cosmético, y es la diferencia entre
 * un número honesto y uno inventado. Medido sobre los mapas de este repo:
 * nuketown da 13989 m² de celdas caminables sueltas contra 4945 m²
 * alcanzables desde los spawns -- casi tres veces más. La diferencia son
 * techos, cornisas y suelo fuera de la zona jugable, que el mapa tiene pero
 * nadie pisa. Sin el filtro, nuketown mediría como un mapa enorme.
 *
 * Por la misma razón no se usan ni `MapDef.bounds` (en nuketown son 36284 m²,
 * casi todo cielo) ni la cantidad de spawns (nuketown tiene 32 y bunker 8, y
 * nuketown NO es cuatro veces más grande: el mapper puso muchos spawns
 * juntos, no un mapa grande).
 */

import { buildMainComponentMask, buildNavGrid } from '@/game/bots/navgrid'
import type { MapDef } from '@/game/map/types'
import { MATCH } from '@/game/match/tuning'
import { MAX_PARTICIPANTES } from '@/game/match/roster'

/**
 * Metros cuadrados de área navegable por jugador con los que la partida se
 * siente bien.
 *
 * NO es un número elegido a ojo: sale de despejar la única calibración que
 * este repo ya tenía hecha jugando. `MATCH.botCount` es 8 y su comentario
 * documenta que ese valor se verificó jugando FFA real contra la arena
 * (8 bots dan hueco para reposicionarse entre kills; 10 saturan el
 * killfeed). Ocho bots más el jugador son 9 participantes, y la arena mide
 * 3284 m² de área navegable alcanzable: 3284 / 9 = 365.
 *
 * O sea que este módulo no propone una densidad nueva -- extiende a los
 * demás mapas la densidad que ya se había tuneado para uno. Si algún día se
 * retunea `MATCH.botCount` jugando, este número hay que volver a despejarlo
 * (ver `tamano-mapa.test.ts`, que ata las dos cosas para que no se
 * desincronicen sin que falle un test).
 */
export const AREA_POR_JUGADOR_M2 = 365

/** El área navegable de la arena, medida con `areaNavegableM2(ARENA)`. Vive
 *  acá como constante SÓLO para poder documentar y testear de dónde salió
 *  AREA_POR_JUGADOR_M2; nada del motor la lee. */
export const AREA_NAVEGABLE_ARENA_M2 = 3284

export type TamanoMapa = 'pequeno' | 'mediano' | 'grande'

export interface MedidaMapa {
  nombre: string
  /** Metros cuadrados caminables alcanzables desde los spawns. */
  areaNavegableM2: number
  /** Participantes totales (jugador incluido) que el área sostiene a
   *  AREA_POR_JUGADOR_M2. Acotado a lo que el motor puede correr. */
  jugadoresSugeridos: number
  /** El mismo número, dicho como tamaño de equipo para TDM. */
  porEquipoSugerido: number
  tamano: TamanoMapa
}

/**
 * Área caminable, en m², alcanzable desde los spawns del mapa. Puro sobre la
 * geometría: mismo resultado en el navegador y en un test sin DOM.
 *
 * CUESTA. Hornear el navgrid de un mapa importado recorre cientos de miles
 * de celdas contra los brushes del mapa; no es algo para llamar por frame ni
 * por render de React. Se llama una vez por mapa y se guarda el resultado
 * (ver ui/medidas-mapa.ts, que además lo cachea entre visitas).
 */
export function areaNavegableM2(def: MapDef): number {
  const grid = buildNavGrid(def)
  const principal = buildMainComponentMask(grid)
  let celdas = 0
  for (let i = 0; i < principal.length; i++) {
    if (principal[i] === 1) celdas++
  }
  return celdas * grid.cellSize * grid.cellSize
}

/**
 * Participantes que sostiene un área. Se redondea a PAR porque el consumidor
 * principal es TDM, donde un número impar no se puede repartir en dos
 * equipos iguales, y porque un "9 jugadores sugeridos" que el menú tiene que
 * traducir a 4v4 o 5v5 no ayuda a nadie a decidir más rápido.
 */
export function jugadoresQueSostiene(areaM2: number): number {
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return 2
  const crudo = areaM2 / AREA_POR_JUGADOR_M2
  const par = Math.round(crudo / 2) * 2
  return Math.max(2, Math.min(MAX_PARTICIPANTES, par))
}

/**
 * Etiqueta de tamaño a partir de cuántos jugadores sostiene, no a partir de
 * los metros: así "pequeño" quiere decir algo accionable ("acá entra un
 * 2v2/3v3") en vez de un umbral de superficie que el jugador no puede
 * traducir. Los cortes coinciden con los presets que pidió el dueño: hasta
 * 3v3 es pequeño, 6v6 y más es grande.
 */
export function tamanoPorJugadores(jugadores: number): TamanoMapa {
  if (jugadores <= 6) return 'pequeno'
  if (jugadores < 12) return 'mediano'
  return 'grande'
}

export const ETIQUETA_TAMANO: Readonly<Record<TamanoMapa, string>> = {
  pequeno: 'Pequeño',
  mediano: 'Mediano',
  grande: 'Grande',
}

/** Medida completa de un mapa ya cargado. */
export function medirMapa(def: MapDef): MedidaMapa {
  const area = areaNavegableM2(def)
  const jugadores = jugadoresQueSostiene(area)
  return {
    nombre: def.name,
    areaNavegableM2: area,
    jugadoresSugeridos: jugadores,
    porEquipoSugerido: Math.max(1, Math.round(jugadores / 2)),
    tamano: tamanoPorJugadores(jugadores),
  }
}

/** Le recuerda a quien retunee `MATCH.botCount` que este módulo depende de
 *  ese número. Lo usa el test; no lo llama el motor. */
export function densidadImplicitaDeLaArena(): number {
  return AREA_NAVEGABLE_ARENA_M2 / (MATCH.botCount + 1)
}
