/**
 * Estado y flujo de una partida completa: arranca en 'live', corre un
 * reloj que cuenta hacia atrás, acumula puntaje y killfeed, y termina en
 * 'ended' apenas se cumple el límite de kills o se acaba el reloj -- lo que
 * pase primero (sección "Build" de la tarea). Una vez 'ended', cualquier
 * llamada nueva (stepMatch, recordKill, recordDamage) es un no-op: el
 * estado queda congelado para el resumen post-partida, nunca "revive".
 *
 * Garantía de terminación (sección "Test" de la tarea: "una partida siempre
 * termina, ninguna secuencia de input la deja corriendo para siempre"):
 * `stepMatch` resta `dt` de `timeRemainingS` sin importar qué haya pasado
 * con el puntaje, así que mientras el llamador seguga avanzando el reloj
 * con dt > 0 (game.ts, cada frame real), `timeRemainingS` llega a 0 en un
 * número finito de llamadas y `isMatchOver` lo detecta -- el límite de
 * kills es una salida más rápida, nunca la única.
 */

import type { MatchMode, MatchPhase } from '@/game/match/types'
import { PLAYER_ID, teamForParticipant } from '@/game/match/types'
import { type MatchTuning, MATCH } from '@/game/match/tuning'
import {
  addDamage,
  addKill,
  createParticipantStats,
  leadingKills,
  sortedByKills,
  teamScore,
  type ParticipantStats,
} from '@/game/match/scoring'
import { createKillfeedState, pushKill, stepKillfeed, type KillfeedState } from '@/game/match/killfeed'

export interface MatchState {
  mode: MatchMode
  phase: MatchPhase
  /** Segundos transcurridos desde que arrancó la partida. Reloj de
   *  invulnerabilidad (match/respawn.ts) y de killfeed -- crece monótono,
   *  nunca se resetea (mismo rol que BotWorld.simTimeS). */
  elapsedS: number
  /** Cuenta atrás desde MatchTuning.timeLimitS hasta 0, clampeada. */
  timeRemainingS: number
  /** Índice por id de participante (0 = jugador, 1..N = bots). */
  participants: ParticipantStats[]
  killfeed: KillfeedState
}

export function createMatchState(
  mode: MatchMode,
  participantCount: number,
  tuning: MatchTuning = MATCH,
): MatchState {
  const participants: ParticipantStats[] = []
  for (let i = 0; i < participantCount; i++) participants.push(createParticipantStats(i))
  return {
    mode,
    phase: 'live',
    elapsedS: 0,
    timeRemainingS: tuning.timeLimitS,
    participants,
    killfeed: createKillfeedState(tuning.killfeedMaxEntries),
  }
}

/** ¿Se cumplió el límite de kills o se acabó el reloj? Pura -- no muta
 *  nada, sólo lee `state`. */
export function isMatchOver(state: MatchState, tuning: MatchTuning = MATCH): boolean {
  if (state.timeRemainingS <= 0) return true
  if (state.mode === 'ffa') return leadingKills(state.participants) >= tuning.scoreLimitFfa
  return (
    teamScore(state.mode, state.participants, 0) >= tuning.scoreLimitTdm ||
    teamScore(state.mode, state.participants, 1) >= tuning.scoreLimitTdm
  )
}

/** Avanza el reloj y el killfeed un frame, y cierra la partida si
 *  corresponde. No-op total si ya está 'ended' -- ver el comentario de
 *  cabecera sobre la garantía de terminación. */
export function stepMatch(state: MatchState, dt: number, tuning: MatchTuning = MATCH): void {
  if (state.phase === 'ended') return

  const clampedDt = Number.isFinite(dt) && dt > 0 ? dt : 0
  state.elapsedS += clampedDt
  state.timeRemainingS = Math.max(0, state.timeRemainingS - clampedDt)
  stepKillfeed(state.killfeed, clampedDt)

  if (isMatchOver(state, tuning)) state.phase = 'ended'
}

/** Registra un kill: puntaje + entrada de killfeed. No-op si la partida ya
 *  terminó -- un disparo que resuelve en el mismo instante en que expira el
 *  reloj no puede seguir sumando kills a una partida ya cerrada. */
export function recordKill(
  state: MatchState,
  killerId: number,
  victimId: number,
  weaponLabel: string,
  headshot: boolean,
): void {
  if (state.phase === 'ended') return
  addKill(state.participants[killerId], state.participants[victimId], headshot)
  pushKill(state.killfeed, killerId, victimId, weaponLabel, headshot)
}

/** Registra daño hecho por `participantId` (para el resumen post-partida --
 *  la sección "Test" de la tarea pide daño en el scoreboard, no sólo
 *  kills/deaths). No-op si la partida ya terminó, mismo motivo que arriba. */
export function recordDamage(state: MatchState, participantId: number, amount: number): void {
  if (state.phase === 'ended') return
  addDamage(state.participants[participantId], amount)
}

export interface MatchSummary {
  mode: MatchMode
  durationS: number
  /** 'jugador' | 'equipo N' | 'empate' -- ver buildSummary. */
  winnerLabel: string
  standings: ParticipantStats[]
}

function winnerLabelFor(state: MatchState): string {
  if (state.mode === 'ffa') {
    const sorted = sortedByKills(state.participants)
    if (sorted.length === 0 || sorted[0].kills === 0) return 'sin ganador'
    const top = sorted[0]
    if (sorted.length > 1 && sorted[1].kills === top.kills) return 'empate'
    return top.id === PLAYER_ID ? 'jugador' : `bot ${top.id}`
  }

  const scoreA = teamScore(state.mode, state.participants, 0)
  const scoreB = teamScore(state.mode, state.participants, 1)
  if (scoreA === scoreB) return 'empate'
  return scoreA > scoreB ? 'equipo del jugador' : 'equipo enemigo'
}

/**
 * ¿Ganó el jugador? Es la entrada `win` de la fórmula de RR (sección 9 del
 * spec), que sólo conoce victoria y derrota.
 *
 * El empate cuenta como derrota, y conviene que sea explícito y no un
 * descuido: la fórmula no tiene un tercer caso, y darle la base de victoria
 * (+18) a un empate premiaría no haber ganado. Con los límites de puntaje
 * altos y el reloj como cierre habitual (match/tuning.ts), un empate exacto
 * es raro de todos modos.
 */
export function playerWon(state: MatchState): boolean {
  if (state.mode === 'ffa') {
    const mios = state.participants[PLAYER_ID]?.kills ?? 0
    for (const p of state.participants) {
      if (p.id !== PLAYER_ID && p.kills >= mios) return false
    }
    return true
  }
  const propio = teamForParticipant(state.mode, PLAYER_ID)
  const rival = propio === 0 ? 1 : 0
  return teamScore(state.mode, state.participants, propio) > teamScore(state.mode, state.participants, rival)
}

/** Resumen post-partida: duración real, ganador y tabla ordenada por kills.
 *  Se puede llamar en cualquier momento (no exige 'ended'), pero el sentido
 *  natural es llamarlo una vez terminada -- game.ts lo hace apenas
 *  `state.phase` pasa a 'ended'. */
export function buildSummary(state: MatchState, tuning: MatchTuning = MATCH): MatchSummary {
  return {
    mode: state.mode,
    durationS: tuning.timeLimitS - state.timeRemainingS,
    winnerLabel: winnerLabelFor(state),
    standings: sortedByKills(state.participants),
  }
}
