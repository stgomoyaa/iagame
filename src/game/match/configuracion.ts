/**
 * Qué partida se va a jugar: mapa, modo y cuánta gente. Datos y matemática
 * puros -- quien lee la URL y quien dibuja el menú viven afuera (ui/), acá
 * sólo entra y sale configuración ya resuelta, así que las reglas se pueden
 * ejercitar sin navegador.
 *
 * LOS PRESETS SUGIEREN, NO IMPONEN
 * El pedido del dueño fue explícito: "si quiero jugar 6v6 en un mapa pequeño
 * que también me deje". Así que un preset es un ATAJO que rellena la
 * configuración -- 2v2, 3v3, 6v6 -- y nada más. No hay combinación
 * prohibida, no hay opción deshabilitada por "incompatible", y el tamaño del
 * mapa (match/tamano-mapa.ts) entra como una SUGERENCIA que se muestra al
 * lado, nunca como un filtro. Este archivo no tiene una sola función que
 * rechace una combinación de mapa y tamaño de equipo, y eso es a propósito.
 *
 * LA RANKED ES LA EXCEPCIÓN, Y POR UNA RAZÓN
 * En ranked la configuración la fija el modo (`CONFIG_RANKED`) y no se
 * puede editar. No es paternalismo: el RR y el rango sólo significan algo si
 * las partidas son comparables entre sí, y una ranked 8v8 en un mapa chico
 * contra una 2v2 en uno grande no lo son. Por el mismo motivo la ranked
 * tampoco deja agregar ni sacar bots en caliente (ver `permiteEditarRoster`).
 */

import { acotarBots, MAX_BOTS, MAX_PARTICIPANTES, MIN_BOTS } from '@/game/match/roster'
import { MATCH } from '@/game/match/tuning'
import type { MatchMode } from '@/game/match/types'

export interface ConfigPartida {
  /** Nombre de mapa, tal como lo listan `mapNames()` (map/registry.ts). */
  mapa: string
  modo: MatchMode
  /** Participantes totales, JUGADOR INCLUIDO. En TDM se reparten por paridad
   *  de id en dos equipos (match/types.ts), así que un valor par da equipos
   *  parejos y uno impar deja al equipo 0 con uno más. */
  jugadores: number
  /** Ranked: configuración fija y roster cerrado. Ver la cabecera. */
  ranked: boolean
}

export interface PresetPartida {
  id: string
  /** Lo que se ve en el botón: "2v2". */
  etiqueta: string
  porEquipo: number
  jugadores: number
}

function preset(porEquipo: number): PresetPartida {
  return {
    id: `${porEquipo}v${porEquipo}`,
    etiqueta: `${porEquipo}v${porEquipo}`,
    porEquipo,
    jugadores: porEquipo * 2,
  }
}

/** Los tres atajos que pidió el dueño. Cualquier otro tamaño se arma a mano
 *  con el control de jugadores por equipo. */
export const PRESETS: readonly PresetPartida[] = [preset(2), preset(3), preset(6)]

/** Tamaño de equipo máximo elegible a mano en TDM, derivado del tope de
 *  participantes del motor. */
export const MAX_POR_EQUIPO = Math.floor(MAX_PARTICIPANTES / 2)

/**
 * La configuración de la ranked. Fija a propósito (ver la cabecera): 5v5,
 * TDM, en la arena -- el único mapa de este repo cuya densidad de jugadores
 * está calibrada jugando (ver AREA_POR_JUGADOR_M2 en tamano-mapa.ts), que es
 * lo mínimo que se le puede pedir al mapa donde se reparte RR.
 */
export const CONFIG_RANKED: ConfigPartida = {
  mapa: 'arena',
  modo: 'tdm',
  jugadores: 10,
  ranked: true,
}

export function configPorDefecto(mapa: string): ConfigPartida {
  return {
    mapa,
    modo: MATCH.defaultMode,
    // El default de siempre: MATCH.botCount bots más el jugador. Se mantiene
    // para que entrar sin tocar nada juegue la partida que este repo ya tenía
    // tuneada, no una nueva.
    jugadores: MATCH.botCount + 1,
    ranked: false,
  }
}

/** Bots que hay que poblar para esta configuración: todos menos el jugador. */
export function botsDeConfig(config: ConfigPartida): number {
  return acotarBots(config.jugadores - 1)
}

/** ¿Esta partida deja agregar y sacar bots con el teclado? Ranked no. */
export function permiteEditarRoster(config: ConfigPartida): boolean {
  return !config.ranked
}

/** Acota una configuración a lo que el motor puede correr, sin rechazar
 *  ninguna combinación de mapa y tamaño (ver la cabecera). */
export function acotarConfig(config: ConfigPartida): ConfigPartida {
  return { ...config, jugadores: acotarBots(config.jugadores - 1) + 1 }
}

/**
 * Query string con la que arranca `/play`. Reusa los parámetros que el motor
 * YA leía (`?map=`, `?mode=`, `?bots=`) en vez de inventar un formato nuevo:
 * así el menú y una URL escrita a mano para probar algo siguen siendo la
 * misma cosa, y no hay una segunda forma de configurar una partida que se
 * pueda desincronizar de la primera.
 */
export function aQuery(config: ConfigPartida): string {
  const acotada = acotarConfig(config)
  const params = new URLSearchParams()
  params.set('map', acotada.mapa)
  params.set('mode', acotada.modo)
  params.set('bots', String(botsDeConfig(acotada)))
  if (acotada.ranked) params.set('ranked', '1')
  return params.toString()
}

/**
 * Configuración a partir de la query. Un valor ausente o basura cae al
 * default en vez de romper la partida -- mismo criterio que `resolveMap`.
 * `?ranked=1` fuerza CONFIG_RANKED entera: la ranked no se configura por
 * URL, sólo se pide.
 */
export function desdeQuery(params: URLSearchParams, mapaPorDefecto: string): ConfigPartida {
  if (params.get('ranked') === '1') return { ...CONFIG_RANKED }

  const base = configPorDefecto(mapaPorDefecto)
  const mapa = params.get('map')
  const modo = params.get('mode')
  const bots = params.get('bots')
  const botsN = bots === null ? null : Number.parseInt(bots, 10)

  return acotarConfig({
    mapa: mapa !== null && mapa !== '' ? mapa : base.mapa,
    modo: modo === 'tdm' || modo === 'ffa' ? modo : base.modo,
    jugadores: botsN !== null && Number.isFinite(botsN) ? botsN + 1 : base.jugadores,
    ranked: false,
  })
}

/** Tamaño de equipo que corresponde a `jugadores` en TDM. Con un número
 *  impar el equipo 0 lleva el de más, igual que hace la paridad de ids. */
export function porEquipo(jugadores: number): number {
  return Math.ceil(jugadores / 2)
}

/** Cómo se lee una configuración en una línea: "6v6" en TDM, "8 jugadores"
 *  en FFA (donde no hay equipos que contar). */
export function etiquetaDeConfig(config: ConfigPartida): string {
  if (config.modo === 'ffa') return `${config.jugadores} jugadores`
  const a = Math.ceil(config.jugadores / 2)
  const b = Math.floor(config.jugadores / 2)
  return a === b ? `${a}v${a}` : `${a}v${b}`
}

export { MAX_BOTS, MIN_BOTS, MAX_PARTICIPANTES }
