/**
 * `combatScore` y su valor esperado por dificultad (sección 9 del spec):
 *
 * ```
 * combatScore = f(kills, muertes, daño, % headshot, racha)
 * expected    = combatScore esperado para la dificultad de bots de ese rango
 * ```
 *
 * Este archivo es la mitad del sistema de RR que decide si la escalera se
 * siente justa. Dos decisiones lo gobiernan:
 *
 * **1. Todo se normaliza por minuto.** Una partida completa dura 6 minutos,
 * pero el reloj es tuneable (`?timeLimit=`, match/tuning.ts) y el límite de
 * kills puede cortarla antes. Un combatScore basado en totales le daría más
 * puntaje a la misma actuación sólo por haber durado más, y volvería
 * incomparables dos partidas de largo distinto. Por minuto, 12 kills en 6
 * minutos y 4 kills en 2 minutos valen lo mismo, que es lo correcto.
 *
 * **2. `expected` es casi plano.** Es el punto que más fácil se hace mal y
 * el que rompe la sensación de justicia si se hace mal. La tentación es que
 * `expected` suba fuerte con la dificultad ("contra bots duros se espera
 * menos"), pero la dificultad YA sube con el rango: un jugador que pertenece
 * a Diamante pelea contra bots de Diamante, igual que uno de Hierro pelea
 * contra bots de Hierro. Los dos están en un enfrentamiento parejo y los dos
 * deberían rendir parecido. Si además le bajáramos la vara al de Diamante,
 * estaríamos contando la escalada de dificultad DOS veces y cada promoción
 * se sentiría como un castigo por haber subido.
 *
 * La pendiente que sí queda (`EXPECTED_PENDIENTE`) no es una concesión de
 * diseño: salió de medir. Se simularon enfrentamientos parejos a lo largo de
 * toda la escalera (progression/simulate.ts, `medirParejos`) y se ajustó una
 * recta al combatScore que produce un jugador que pelea contra su propio
 * nivel. Es chica -- unos 9 puntos de punta a punta contra un score que
 * ronda 123 -- porque el enfrentamiento parejo es parejo en todos lados. Es
 * positiva y no negativa por una razón que no se ve venir hasta que se mide:
 * el término de headshots premia puntería ABSOLUTA, no relativa, así que un
 * jugador de rango alto puntúa algo más alto aunque su rival escale con él.
 * Que `expected` suba con la dificultad es justamente lo que neutraliza ese
 * efecto y deja que `delta` mida sólo el rendimiento relativo.
 *
 * **Límite honesto de esta calibración:** los dos coeficientes están
 * ajustados contra el jugador sintético de simulate.ts, no contra
 * telemetría de partidas reales, que todavía no existe. La ESTRUCTURA (medir
 * el enfrentamiento parejo y anclar `expected` ahí) es la correcta y no
 * cambia; los dos números se vuelven a ajustar corriendo `medirParejos`
 * sobre datos reales cuando los haya, sin tocar nada más del sistema.
 */

/** Actuación del jugador en una partida, ya cerrada. Todo lo que entra al
 *  cálculo de RR y de XP sale de acá y de nada más. */
export interface MatchPerformance {
  kills: number
  deaths: number
  /** Daño total infligido. */
  damage: number
  /** Kills que fueron headshot. El porcentaje sale de `headshots / kills`. */
  headshots: number
  /** Racha de kills más larga sin morir. */
  bestStreak: number
  /** Duración real de la partida, segundos. */
  durationS: number
  win: boolean
}

/**
 * Arma una `MatchPerformance` desde el puntaje de un participante
 * (match/scoring.ts `ParticipantStats`) más el resultado de la partida.
 *
 * El parámetro es estructural y no el tipo `ParticipantStats` importado a
 * propósito: `progression` no depende de `match`, y así la simulación y los
 * tests pueden armar una actuación sin construir una partida entera.
 */
export function performanceFromStats(
  stats: {
    kills: number
    deaths: number
    damageDealt: number
    headshots: number
    bestStreak: number
  },
  durationS: number,
  win: boolean,
): MatchPerformance {
  return {
    kills: stats.kills,
    deaths: stats.deaths,
    damage: stats.damageDealt,
    headshots: stats.headshots,
    bestStreak: stats.bestStreak,
    durationS,
    win,
  }
}

/**
 * Piso de duración para normalizar, segundos. Una partida de 5 segundos con
 * un kill daría 12 kills/minuto extrapolados y un combatScore absurdo. 30
 * segundos es el mínimo por debajo del cual la muestra no dice nada.
 */
const DURACION_MINIMA_S = 30

/** Pesos de cada término. Ver el comentario de cada uno abajo. */
export const COMBAT_SCORE = {
  /** Offset para que las actuaciones parejas caigan cerca de 100 y el
   *  número se lea como un porcentaje mental. No cambia nada del sistema
   *  (RR trabaja con la DIFERENCIA contra `expected`), pero un combatScore
   *  de 104 se entiende de un vistazo y uno de 4.2 no. */
  base: 50,
  /** Kills por minuto. El término principal: matar es el verbo del juego. */
  porKillPorMinuto: 22,
  /** Muertes por minuto. Pesa algo menos que un kill a propósito: jugar
   *  agresivo y morir por eso no puede salir peor que quedarse escondido
   *  sin hacer nada, o el rango premiaría no jugar. */
  porMuertePorMinuto: 18,
  /** Cada 100 de daño por minuto. Peso chico porque el daño está muy
   *  correlacionado con los kills y contarlo fuerte sería contar lo mismo
   *  dos veces. Está para que el que ablanda y no remata igual sume. */
  porCienDanoPorMinuto: 8,
  /** Porcentaje de headshots (0..1). Puntería, no volumen. */
  porTasaHeadshot: 25,
  /** Cada kill de la racha más larga, hasta el tope. Premia sobrevivir
   *  encadenando, que es lo que separa una buena partida de una con los
   *  mismos kills repartidos entre diez muertes. */
  porKillDeRacha: 2.5,
  /** Tope de racha que puntúa. Sin tope, una sola racha larga contra bots
   *  desconectados dominaría el score entero. */
  rachaMaxima: 8,
} as const

/**
 * combatScore de una actuación. Siempre >= 0: una partida desastrosa da 0,
 * no un número negativo que después haga cosas raras al restarle `expected`.
 */
export function combatScore(perf: MatchPerformance): number {
  const minutos = Math.max(DURACION_MINIMA_S, perf.durationS) / 60
  const kpm = perf.kills / minutos
  const mpm = perf.deaths / minutos
  const dpm = perf.damage / minutos
  const tasaHs = perf.kills > 0 ? Math.min(1, perf.headshots / perf.kills) : 0
  const racha = Math.min(COMBAT_SCORE.rachaMaxima, Math.max(0, perf.bestStreak))

  const score =
    COMBAT_SCORE.base +
    COMBAT_SCORE.porKillPorMinuto * kpm -
    COMBAT_SCORE.porMuertePorMinuto * mpm +
    COMBAT_SCORE.porCienDanoPorMinuto * (dpm / 100) +
    COMBAT_SCORE.porTasaHeadshot * tasaHs +
    COMBAT_SCORE.porKillDeRacha * racha

  return Math.max(0, score)
}

/**
 * combatScore esperado en un enfrentamiento parejo a una dificultad dada
 * (0..1, el mismo escalar de bots/difficulty.ts y de ranks.difficultyForRank).
 *
 * Los dos números salen de simular jugadores sintéticos peleando contra bots
 * de su mismo nivel a lo largo de toda la escalera y ajustar una recta a lo
 * que rindieron. Ver el reporte de la fase para las curvas.
 */
export const EXPECTED_BASE = 123.2
export const EXPECTED_PENDIENTE = 8.7

export function expectedCombatScore(difficulty: number): number {
  const d = Math.min(1, Math.max(0, Number.isFinite(difficulty) ? difficulty : 0))
  return EXPECTED_BASE + EXPECTED_PENDIENTE * d
}

/** Cuánto por encima (o por debajo) de lo esperado rindió el jugador. Es la
 *  entrada del término de escala del RR (rr.ts). */
export function combatDelta(perf: MatchPerformance, difficulty: number): number {
  return combatScore(perf) - expectedCombatScore(difficulty)
}
