/**
 * Partidas de colocación (sección 9 del spec: "5 partidas de colocación para
 * sembrar el rango inicial").
 *
 * El problema que resuelven no es cosmético. Sin colocaciones, todo jugador
 * nuevo arranca en Hierro 1 peleando contra bots de 400ms de reacción y 6°
 * de error, y alguien que ya sabe jugar tiene que arrastrarse por veinte
 * rangos de bots que no le ofrecen nada antes de encontrar una partida real.
 * Con colocaciones, cinco partidas alcanzan para ubicarlo cerca.
 *
 * El mecanismo es una **estimación continua de habilidad** (`skill`, 0..1,
 * la misma escala que la dificultad de bots) que se corrige después de cada
 * partida, y contra la que se calibran los bots de la partida siguiente.
 * Eso es lo que hace que cinco partidas informen: si la primera te sale
 * holgada, la segunda ya es más dura, y el rango final sale de dónde dejaste
 * de ganar cómodo. Cinco partidas contra bots de dificultad fija dirían
 * mucho menos.
 *
 * Arranca en `SKILL_INICIAL`, por debajo del medio, a propósito: es mejor
 * colocar bajo y que el jugador suba rápido con victorias que colocarlo alto
 * y que su primera experiencia con el rango sea un descenso.
 */

import { combatDelta, type MatchPerformance } from '@/game/progression/combat-score'
import { rankForDifficulty } from '@/game/progression/ranks'

export const PLACEMENT = {
  /** Partidas de colocación. El spec fija 5. */
  partidas: 5,

  /** Estimación con la que arranca una cuenta nueva. 0.35 sobre 25 rangos
   *  cae cerca de Plata, que es donde tiene sentido empezar a medir: deja
   *  margen real para bajar a Hierro/Bronce y para subir varios tiers. */
  skillInicial: 0.35,

  /**
   * Cuánto puede mover la estimación una sola partida de colocación. Con
   * 0.18 y cinco partidas, la ventana total es +-0.9 sobre una escala de 1:
   * alcanza para llegar de 0.35 a cualquier extremo de la escalera si el
   * jugador es consistente, sin que una sola partida rara decida todo.
   */
  paso: 0.18,

  /** Delta de combatScore que satura el paso. Rendir 40 puntos por encima
   *  de lo esperado ya es el máximo movimiento posible; más que eso no
   *  acelera nada. */
  deltaSaturacion: 40,

  /** Corrección extra por el resultado. Chica al lado del paso por
   *  actuación: ganar importa, pero en colocaciones lo que se está midiendo
   *  es el nivel del jugador, no la suerte del equipo que le tocó. */
  ajusteVictoria: 0.04,
} as const

export interface PlacementState {
  /** Cuántas colocaciones lleva jugadas, 0..PLACEMENT.partidas. */
  played: number
  /** Estimación de habilidad 0..1. También es la dificultad de bots que se
   *  usa en la próxima colocación. */
  skill: number
}

export function createPlacementState(): PlacementState {
  return { played: 0, skill: PLACEMENT.skillInicial }
}

/** ¿Quedan colocaciones por jugar? Mientras sea true no hay rango que
 *  mostrar todavía, sólo "colocación 3 de 5". */
export function enColocacion(state: PlacementState): boolean {
  return state.played < PLACEMENT.partidas
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

/**
 * Dificultad de bots para la próxima colocación: la estimación actual. Es
 * lo que hace adaptativa la serie.
 */
export function placementDifficulty(state: PlacementState): number {
  return clamp01(state.skill)
}

export interface PlacementOutcome {
  state: PlacementState
  /** true si esta partida cerró las 5 y hay que sembrar el rango. */
  completed: boolean
  /** Rango sembrado, o null si todavía faltan colocaciones. */
  seededRank: number | null
}

/**
 * Aplica una colocación. No muta el estado que recibe.
 *
 * La corrección es proporcional al delta contra lo esperado A LA DIFICULTAD
 * QUE SE ENFRENTÓ, no contra una vara fija: rendir por encima de lo esperado
 * contra bots de 0.8 mueve la estimación hacia arriba aunque el combatScore
 * bruto haya sido más bajo que el de una partida cómoda contra bots de 0.2.
 */
export function applyPlacement(state: PlacementState, perf: MatchPerformance): PlacementOutcome {
  const dificultad = placementDifficulty(state)
  const delta = combatDelta(perf, dificultad)

  const porActuacion =
    PLACEMENT.paso *
    Math.max(-1, Math.min(1, delta / PLACEMENT.deltaSaturacion))
  const porResultado = perf.win ? PLACEMENT.ajusteVictoria : -PLACEMENT.ajusteVictoria

  const skill = clamp01(state.skill + porActuacion + porResultado)
  const played = Math.min(PLACEMENT.partidas, state.played + 1)
  const next: PlacementState = { played, skill }
  const completed = played >= PLACEMENT.partidas

  return {
    state: next,
    completed,
    seededRank: completed ? rankForDifficulty(skill) : null,
  }
}
