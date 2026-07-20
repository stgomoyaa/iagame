/**
 * Historial reciente de partidas. **Tampoco existía**: el guardado sabía
 * cuántas partidas jugaste y cuántas ganaste, pero no CUÁLES, así que la
 * pantalla de carrera no tenía con qué llenar la lista de "historial
 * reciente" que pide el diseño.
 *
 * Es la mitad barata de una decisión de producto que ya estaba tomada: el
 * rango se defiende entre partidas (ver la cabecera de ui/Career.tsx), y una
 * posición que se defiende necesita mostrar cómo llegaste hasta ahí. Un
 * contador agregado ("32 jugadas, 18 ganadas") no responde "¿por qué bajé?".
 *
 *
 * POR QUÉ SÓLO 10, Y POR QUÉ NO HAY ASISTENCIAS
 *
 * **10 entradas** porque esto vive en `localStorage` junto al resto del
 * guardado y el historial es lo único que crece sin techo. Diez cubre la
 * pregunta real ("¿cómo vengo?") con un costo fijo de unos cientos de bytes.
 *
 * **No hay columna de asistencias** aunque el diseño la dibuja. El motor no
 * las cuenta: `ParticipantStats` (match/scoring.ts) tiene kills, muertes,
 * daño, headshots y rachas, y nada que se parezca a una asistencia. Inventar
 * la columna con un cero, o peor con un número derivado, sería fabricar un
 * dato. La fila muestra K/D y HS%, que sí existen.
 */

import type { MatchPerformance } from '@/game/progression/combat-score'

/** Cuántas partidas se recuerdan. Ver la cabecera. */
export const HISTORIAL_MAX = 10

export interface MatchHistoryEntry {
  /** Número de partida (`partidasJugadas` al cerrarla). Identifica la fila
   *  sin depender del reloj, que puede estar mal en la máquina del jugador. */
  readonly partida: number
  /** Epoch ms al cerrar. Sólo para mostrar; nunca se ordena por esto. */
  readonly fecha: number
  /** Nombre del mapa, o null si el llamador no lo pasó. */
  readonly mapa: string | null
  /** 'tdm' | 'ffa', o null si el llamador no lo pasó. */
  readonly modo: string | null
  readonly win: boolean
  readonly kills: number
  readonly deaths: number
  readonly headshots: number
  readonly damage: number
  /** Cambio de RR, o null si fue partida de colocación (ahí no hay RR). */
  readonly rrChange: number | null
  /** Índice de rango al cerrar, o null si seguía en colocaciones. */
  readonly rank: number | null
}

/** Contexto de la partida que no viaja en `MatchPerformance`. Opcional
 *  entero: la simulación y los tests no tienen mapa ni modo que dar. */
export interface MatchContext {
  readonly mapa?: string
  readonly modo?: string
  /** Inyectable para que los tests no dependan del reloj real. */
  readonly ahora?: number
}

export function crearEntradaHistorial(args: {
  partida: number
  perf: MatchPerformance
  rrChange: number | null
  rank: number | null
  contexto?: MatchContext
}): MatchHistoryEntry {
  const { partida, perf, rrChange, rank, contexto } = args
  return {
    partida,
    fecha: contexto?.ahora ?? Date.now(),
    mapa: contexto?.mapa ?? null,
    modo: contexto?.modo ?? null,
    win: perf.win,
    kills: Math.max(0, Math.floor(perf.kills)),
    deaths: Math.max(0, Math.floor(perf.deaths)),
    headshots: Math.max(0, Math.floor(perf.headshots)),
    damage: Math.max(0, Math.round(perf.damage)),
    rrChange,
    rank,
  }
}

/**
 * Agrega una partida al historial. **La más reciente queda primera**, que es
 * el orden en que se muestra, y se recorta al tope. No muta el original.
 */
export function pushHistorial(
  historial: readonly MatchHistoryEntry[],
  entrada: MatchHistoryEntry,
): MatchHistoryEntry[] {
  return [entrada, ...historial].slice(0, HISTORIAL_MAX)
}

/** Porcentaje de headshots de una entrada, 0..100. Sin bajas no hay
 *  porcentaje: devuelve 0 en vez de NaN. */
export function headshotPct(entrada: MatchHistoryEntry): number {
  if (entrada.kills <= 0) return 0
  return Math.round((entrada.headshots / entrada.kills) * 100)
}
