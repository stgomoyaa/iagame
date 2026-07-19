/**
 * Simulador de carrera: corre jugadores sintéticos de habilidad conocida a
 * lo largo de decenas de partidas y mira dónde se estaciona la escalera.
 *
 * **Por qué existe.** La fórmula de RR se puede testear término por término
 * (rr.test.ts lo hace: clamps, colchón, promoción, descenso) y aun así estar
 * completamente mal. Un test que verifica que `rrChange(true, 0) === 18` no
 * dice nada sobre la única pregunta que importa: si un jugador de habilidad
 * fija juega cuarenta partidas, ¿termina donde corresponde, o se va a
 * Radiante, o se queda trabado en Hierro? Eso es una propiedad del sistema
 * completo -- fórmula, dificultad que escala con el rango, y expected -- y
 * sólo se ve corriéndolo.
 *
 * **El modelo de jugador.** Un jugador es un número: `skill` en 0..1, la
 * misma escala que la dificultad de bots. La partida se resuelve con la
 * ventaja `skill - difficulty`, que gobierna a la vez la probabilidad de
 * ganar y el volumen de kills, muertes y daño. No pretende simular el juego
 * (para eso está jugarlo), sino capturar la única relación de la que depende
 * la convergencia: **enfrentar bots más duros produce peores números**. Si
 * esa relación existe, la escalera tiene que encontrar el punto de
 * equilibrio sola.
 *
 * El PRNG es determinista y propio, así que dos corridas del mismo escenario
 * dan exactamente lo mismo y una regresión en la fórmula se ve como un
 * cambio en las curvas y no como ruido.
 *
 * No es un test: es una herramienta de calibración cuyo resultado se lee.
 * Los tests que sí fallan viven en simulate.test.ts, y verifican las
 * propiedades gruesas (converge, ordena por habilidad, nadie se va a los
 * extremos) sin fijar números exactos.
 */

import { applyMatchResult, careerDifficulty, createDefaultCareer, type CareerData } from '@/game/progression/career'
import { combatScore, type MatchPerformance } from '@/game/progression/combat-score'
import { difficultyForRank, RANK_MAX, rankLabel } from '@/game/progression/ranks'

/** PRNG determinista (mulberry32). Mismo criterio que skins/hash.ts: nada de
 *  Math.random en algo cuyo resultado se compara entre corridas. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Duración nominal de una partida simulada: los 6 minutos del spec. */
const DURACION_S = 360

/**
 * Cuánta ventaja hace falta para dominar. Con `ventaja = skill - difficulty`
 * de 0.35 el jugador sintético gana casi siempre; es la escala que convierte
 * la diferencia de nivel en diferencia de resultados.
 */
const ESCALA_VENTAJA = 0.35

function gaussian(rand: () => number): number {
  // Box-Muller. Hace falta ruido con colas: si cada partida diera exactamente
  // la media, la convergencia sería trivial y la simulación no probaría que
  // el sistema aguanta partidas malas sueltas.
  const u = Math.max(1e-9, rand())
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Resuelve una partida de un jugador de habilidad `skill` contra bots de
 * dificultad `difficulty`.
 *
 * Los números base (kills, muertes, daño y headshots de un enfrentamiento
 * parejo) están elegidos para parecerse al ritmo real observado al jugar
 * FFA con 8 bots en esta arena, no para hacer quedar bien a la fórmula.
 */
export function simulateMatch(skill: number, difficulty: number, rand: () => number): MatchPerformance {
  const ventaja = (skill - difficulty) / ESCALA_VENTAJA

  // Enfrentamiento parejo: ~15 kills y ~15 muertes en 6 minutos.
  const killsMedia = 15 * (1 + 0.55 * ventaja)
  const muertesMedia = 15 * (1 - 0.45 * ventaja)

  const kills = Math.max(0, Math.round(killsMedia + gaussian(rand) * 3))
  const deaths = Math.max(0, Math.round(muertesMedia + gaussian(rand) * 3))

  // ~230 de daño por kill: remates limpios más lo que se reparte sin
  // rematar.
  const damage = Math.max(0, kills * 230 + Math.abs(gaussian(rand)) * 600)

  // La puntería mejora con la habilidad, no con la ventaja: un jugador bueno
  // pega headshots contra cualquiera.
  const tasaHs = Math.min(0.6, Math.max(0.05, 0.12 + 0.35 * skill + gaussian(rand) * 0.05))
  const headshots = Math.min(kills, Math.round(kills * tasaHs))

  // La racha más larga crece con la ventaja y con lo poco que moriste.
  const bestStreak = Math.max(
    0,
    Math.round((kills / Math.max(1, deaths)) * 2.2 + ventaja * 1.5 + Math.abs(gaussian(rand))),
  )

  // Probabilidad de ganar: logística en la ventaja. En un enfrentamiento
  // parejo es exactamente 50%.
  const pVictoria = 1 / (1 + Math.exp(-2.2 * ventaja))
  const win = rand() < pVictoria

  return { kills, deaths, damage, headshots, bestStreak, durationS: DURACION_S, win }
}

export interface CareerSample {
  partida: number
  rank: number | null
  rr: number
  /** Dificultad enfrentada en esa partida. */
  difficulty: number
  rrChange: number
  win: boolean
}

export interface CareerRun {
  skill: number
  /** Rango teórico si la escalera fuera perfecta: el que da esa dificultad. */
  rankTeorico: number
  samples: CareerSample[]
  data: CareerData
  /** Rango final. */
  rankFinal: number
  /** Rango promedio de las últimas `ventanaFinal` partidas: dónde se
   *  estacionó de verdad, sin que una partida suelta decida la lectura. */
  rankEstacionario: number
  victorias: number
  derrotas: number
}

/**
 * Corre la carrera completa de un jugador sintético: 5 colocaciones más
 * `partidas` partidas rankeadas, usando el MISMO `applyMatchResult` que el
 * juego.
 */
export function simulateCareer(skill: number, partidas: number, seed: number, ventanaFinal = 20): CareerRun {
  const rand = createRandom(seed)
  let data = createDefaultCareer()
  const samples: CareerSample[] = []

  for (let i = 0; i < partidas; i++) {
    const difficulty = careerDifficulty(data)
    const perf = simulateMatch(skill, difficulty, rand)
    const result = applyMatchResult(data, perf)
    data = result.data
    samples.push({
      partida: i + 1,
      rank: data.rank?.rank ?? null,
      rr: data.rank?.rr ?? 0,
      difficulty,
      rrChange: result.progress.rr?.change ?? 0,
      win: perf.win,
    })
  }

  const finales = samples.slice(-ventanaFinal).filter((s) => s.rank !== null)
  const rankEstacionario =
    finales.length > 0 ? finales.reduce((acc, s) => acc + (s.rank ?? 0), 0) / finales.length : 0

  return {
    skill,
    rankTeorico: Math.round(skill * RANK_MAX),
    samples,
    data,
    rankFinal: data.rank?.rank ?? 0,
    rankEstacionario,
    victorias: data.victorias,
    derrotas: data.derrotas,
  }
}

/**
 * Mide el combatScore de enfrentamientos parejos a lo largo de la escalera.
 * Es lo que calibra `expectedCombatScore` (combat-score.ts): se corre esto,
 * se mira la recta que sale y se copian los dos coeficientes.
 */
export function medirParejos(muestras: number, seed: number): { difficulty: number; media: number }[] {
  const rand = createRandom(seed)
  const out: { difficulty: number; media: number }[] = []
  for (let r = 0; r <= RANK_MAX; r++) {
    const d = difficultyForRank(r)
    let suma = 0
    for (let i = 0; i < muestras; i++) suma += combatScore(simulateMatch(d, d, rand))
    out.push({ difficulty: d, media: suma / muestras })
  }
  return out
}

/** Ajuste lineal por mínimos cuadrados. Devuelve la base y la pendiente que
 *  van a `expectedCombatScore`. */
export function ajustarRecta(puntos: readonly { difficulty: number; media: number }[]): {
  base: number
  pendiente: number
} {
  const n = puntos.length
  if (n === 0) return { base: 0, pendiente: 0 }
  let sx = 0
  let sy = 0
  let sxy = 0
  let sxx = 0
  for (const p of puntos) {
    sx += p.difficulty
    sy += p.media
    sxy += p.difficulty * p.media
    sxx += p.difficulty * p.difficulty
  }
  const denom = n * sxx - sx * sx
  if (denom === 0) return { base: sy / n, pendiente: 0 }
  const pendiente = (n * sxy - sx * sy) / denom
  return { base: (sy - pendiente * sx) / n, pendiente }
}

/** Etiqueta legible de un rango promedio (que cae entre dos rangos). */
export function etiquetaRango(rankPromedio: number): string {
  return rankLabel(Math.round(rankPromedio))
}
