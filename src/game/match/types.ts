/**
 * Tipos y convenciones compartidas de la capa de partida (sección "Fases",
 * fase 2, segunda mitad del spec): dos modos, deathmatch por equipos (tdm) y
 * todos-contra-todos (ffa), que comparten puntaje, respawn y flujo de
 * partida -- ver match.ts.
 *
 * Identidad de participante: un entero simple, sin wrapper. `PLAYER_ID = 0`
 * es el jugador humano; cada bot ocupa `índice + 1` (índice dentro del array
 * `BotState[]` que arma match/squad.ts). No hay una clase `Participant`
 * separada -- el id ya es la clave con la que se indexa `ParticipantStats[]`
 * (scoring.ts), `MatchTargets` (targeting.ts) y el offset de `Hitbox.owner`
 * (game.ts, mismo truco que ya usaba fase 2 para distinguir dianas de bots:
 * `targetCount + participantId`).
 */

export type MatchMode = 'tdm' | 'ffa'
export type MatchPhase = 'live' | 'ended'

/** Id de participante del jugador humano. Los bots ocupan 1..N. */
export const PLAYER_ID = 0

/**
 * Equipo de un participante, derivado de su id sin ninguna tabla aparte.
 * TDM: paridad del id -- el jugador (id 0) siempre cae en el equipo 0, los
 * bots se reparten alternados. FFA: el equipo de cada uno es su propio id,
 * así que ningún par de participantes distintos comparte equipo nunca --
 * "todos contra todos" sin tener que ramificar el resto del código match/
 * según el modo.
 */
export function teamForParticipant(mode: MatchMode, participantId: number): number {
  return mode === 'ffa' ? participantId : participantId % 2
}

/** ¿`a` y `b` son de equipos distintos? Sección "Build": TDM no tiene fuego
 *  amigo -- ver cómo game.ts arma las listas de hitboxes por participante
 *  usando esto. */
export function isEnemy(mode: MatchMode, participantIdA: number, participantIdB: number): boolean {
  return teamForParticipant(mode, participantIdA) !== teamForParticipant(mode, participantIdB)
}
