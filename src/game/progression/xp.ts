/**
 * XP de cuenta por partida (sección 9 del spec: "Nivel de cuenta por XP, que
 * desbloquea armas").
 *
 * La progresión de XP corre en **paralelo** a la de rango y a propósito no
 * comparte ninguna de sus reglas. El rango sube y baja y mide qué tan bien
 * jugás comparado con tu nivel; la XP sólo sube y mide cuánto jugaste. Las
 * dos existen porque responden preguntas distintas: después de una derrota
 * fea el rango baja, y la barra de XP igual avanza y suelta un arma nueva.
 * Si la XP también castigara, una mala noche no dejaría nada.
 *
 * Los valores por kill y por headshot son los mismos que ya muestran los
 * popups de la sección 10 del spec (+100 KILL, +50 HEADSHOT): la barra que
 * se llena al final de la partida tiene que sumar lo que el jugador vio
 * caer en pantalla mientras jugaba, o los números se contradicen.
 */

import type { MatchPerformance } from '@/game/progression/combat-score'
import { levelForXp } from '@/game/progression/unlocks'

export const XP = {
  /** Sólo por terminar la partida. Una partida floja nunca da cero. */
  participacion: 100,
  /** Por kill. Mismo valor que el popup +100 KILL. */
  porKill: 100,
  /** Extra por kill de headshot. Mismo valor que el popup +50 HEADSHOT. */
  porHeadshot: 50,
  /** Por cada 10 de daño. Es el término que hace que una partida donde
   *  ablandaste mucho y remataste poco igual valga. */
  porDiezDeDano: 1,
  /** Bono de victoria y de derrota. La derrota también paga: ver arriba. */
  bonoVictoria: 400,
  bonoDerrota: 150,
} as const

/** XP que otorga una partida. Siempre > 0 y siempre entero. */
export function xpForMatch(perf: MatchPerformance): number {
  const kills = Math.max(0, perf.kills)
  const headshots = Math.max(0, Math.min(kills, perf.headshots))
  const dano = Math.max(0, Number.isFinite(perf.damage) ? perf.damage : 0)

  return Math.round(
    XP.participacion +
      XP.porKill * kills +
      XP.porHeadshot * headshots +
      XP.porDiezDeDano * (dano / 10) +
      (perf.win ? XP.bonoVictoria : XP.bonoDerrota),
  )
}

export interface XpOutcome {
  /** XP total tras la partida. */
  xp: number
  /** XP que otorgó esta partida. */
  ganada: number
  levelAnterior: number
  level: number
  /** true si la partida subió al menos un nivel: dispara la ceremonia y el
   *  aviso de armas nuevas. */
  subioDeNivel: boolean
}

export function applyXp(xpActual: number, perf: MatchPerformance): XpOutcome {
  const base = Number.isFinite(xpActual) && xpActual > 0 ? xpActual : 0
  const ganada = xpForMatch(perf)
  const xp = base + ganada
  const levelAnterior = levelForXp(base)
  const level = levelForXp(xp)
  return { xp, ganada, levelAnterior, level, subioDeNivel: level > levelAnterior }
}
