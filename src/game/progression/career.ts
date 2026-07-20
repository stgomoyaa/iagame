/**
 * La carrera del jugador: el único lugar donde se juntan rango, RR,
 * colocaciones, XP y drops (sección 9 del spec).
 *
 * Cada uno de esos sistemas vive en su propio archivo y no sabe de los
 * otros: `rr.ts` no sabe qué es la XP, `xp.ts` no sabe qué es un rango,
 * `drop.ts` no sabe si ganaste. Este archivo los orquesta y es el que
 * responde las dos preguntas que el resto del juego necesita hacer:
 *
 * - **Antes de la partida**: contra qué dificultad de bots juego
 *   (`careerDifficulty`). Es la que convierte el rango en algo que se siente
 *   y no un número que sube.
 * - **Después de la partida**: qué pasó con todo (`applyMatchResult`).
 *
 * `applyMatchResult` es una función pura sobre `ProgressData`: recibe el
 * guardado y devuelve uno nuevo más un resumen para la UI, sin tocar
 * `ProgressStore` ni `localStorage`. Persistir es decisión del llamador. Eso
 * es lo que permite simular cuarenta partidas seguidas en un test sin
 * navegador (simulate.ts) con exactamente el mismo código que corre el juego
 * de verdad -- si la simulación usara una copia paralela de la fórmula, no
 * estaría verificando nada.
 */

import { combatScore, expectedCombatScore, type MatchPerformance } from '@/game/progression/combat-score'
import { rollDrop, type SkinDrop } from '@/game/progression/drop'
import {
  crearEntradaHistorial,
  pushHistorial,
  type MatchContext,
  type MatchHistoryEntry,
} from '@/game/progression/history'
import {
  applyPlacement,
  createPlacementState,
  enColocacion,
  placementDifficulty,
  type PlacementOutcome,
  type PlacementState,
} from '@/game/progression/placement'
import { difficultyForRank } from '@/game/progression/ranks'
import { applyRr, createRankState, rrChange, type RankOutcome, type RankState } from '@/game/progression/rr'
import { applyXp, type XpOutcome } from '@/game/progression/xp'

/** La parte del guardado que le importa a la carrera. Se define acá y no en
 *  store.ts para que este módulo no dependa del blob entero: los tests y la
 *  simulación arman un `CareerData` pelado sin tener que inventar un
 *  loadout ni un inventario de armas. */
export interface CareerData {
  /** Posición en la escalera, o null si todavía está en colocaciones. */
  rank: RankState | null
  placement: PlacementState
  /** Partidas terminadas, colocaciones incluidas. Es lo que hace única la
   *  seed de cada drop (drop.ts). */
  partidasJugadas: number
  victorias: number
  derrotas: number
  xp: number
  skins: string[]
  /** Las últimas 10 partidas, la más reciente primero (history.ts). */
  historial: readonly MatchHistoryEntry[]
}

export function createDefaultCareer(): CareerData {
  return {
    rank: null,
    placement: createPlacementState(),
    partidasJugadas: 0,
    victorias: 0,
    derrotas: 0,
    xp: 0,
    skins: [],
    historial: [],
  }
}

/** ¿El jugador todavía está colocando? Mientras sea true no hay rango que
 *  mostrar, sólo el contador de colocaciones. */
export function estaColocando(data: CareerData): boolean {
  return data.rank === null || enColocacion(data.placement)
}

/**
 * Dificultad de bots (0..1) que le corresponde al jugador ahora mismo.
 * **Este es el enganche que le da sentido a toda la escalera** (sección 8 del
 * spec: "la dificultad de los bots se deriva del rango actual del jugador").
 *
 * En colocaciones sale de la estimación adaptativa; ya colocado, del rango.
 */
export function careerDifficulty(data: CareerData): number {
  if (data.rank === null) return placementDifficulty(data.placement)
  return difficultyForRank(data.rank.rank)
}

export interface MatchProgress {
  perf: MatchPerformance
  /** Dificultad contra la que se jugó, 0..1. */
  difficulty: number
  combatScore: number
  expected: number
  delta: number

  /** Resultado de RR, o null si esta partida fue de colocación. */
  rr: RankOutcome | null
  /** Resultado de colocación, o null si el jugador ya estaba colocado. */
  placement: PlacementOutcome | null
  /** Rango sembrado si esta partida cerró las colocaciones. */
  seededRank: number | null

  xp: XpOutcome
  drop: SkinDrop
}

export interface CareerResult {
  data: CareerData
  progress: MatchProgress
}

/**
 * Aplica una partida terminada a la carrera. No muta `data`.
 *
 * El orden de las dos ramas (colocación o RR) es excluyente por diseño:
 * durante las cinco colocaciones no se gana ni se pierde RR, porque no hay
 * rango contra el que medirlo todavía. La partida que cierra la quinta
 * siembra el rango y ya la siguiente corre por RR.
 *
 * XP y drop, en cambio, corren SIEMPRE por las dos ramas: una colocación es
 * una partida como cualquier otra en todo lo que no sea el rango, y una
 * derrota de colocación igual tiene que soltar su skin.
 */
export function applyMatchResult(
  data: CareerData,
  perf: MatchPerformance,
  contexto?: MatchContext,
): CareerResult {
  const difficulty = careerDifficulty(data)
  const score = combatScore(perf)
  const expected = expectedCombatScore(difficulty)
  const delta = score - expected

  const partidaNumero = data.partidasJugadas + 1

  let rank = data.rank
  let placement = data.placement
  let rrOutcome: RankOutcome | null = null
  let placementOutcome: PlacementOutcome | null = null
  let seededRank: number | null = null

  if (rank === null) {
    placementOutcome = applyPlacement(placement, perf)
    placement = placementOutcome.state
    if (placementOutcome.completed && placementOutcome.seededRank !== null) {
      seededRank = placementOutcome.seededRank
      rank = createRankState(seededRank)
    }
  } else {
    rrOutcome = applyRr(rank, rrChange(perf.win, delta))
    rank = rrOutcome.state
  }

  const xp = applyXp(data.xp, perf)
  const drop = rollDrop(partidaNumero, perf, data.skins)
  const skins = drop.nueva ? [...data.skins, drop.skin.seed] : [...data.skins]

  // El historial corre por las dos ramas, igual que XP y drop: una colocación
  // es una partida como cualquier otra en todo lo que no sea el rango.
  const entrada = crearEntradaHistorial({
    partida: partidaNumero,
    perf,
    rrChange: rrOutcome?.change ?? null,
    rank: rank?.rank ?? null,
    contexto,
  })

  return {
    data: {
      rank,
      placement,
      partidasJugadas: partidaNumero,
      victorias: data.victorias + (perf.win ? 1 : 0),
      derrotas: data.derrotas + (perf.win ? 0 : 1),
      xp: xp.xp,
      skins,
      historial: pushHistorial(data.historial, entrada),
    },
    progress: {
      perf,
      difficulty,
      combatScore: score,
      expected,
      delta,
      rr: rrOutcome,
      placement: placementOutcome,
      seededRank,
      xp,
      drop,
    },
  }
}
