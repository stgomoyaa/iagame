/**
 * Medallas de partida. **Este sistema no existía**: el diseño de progresión
 * (docs/design/progresion.dc.html) las especifica y las marca como "diseño
 * propuesto, sin código aún". Este archivo es la parte que sí se puede
 * construir hoy con datos verdaderos, y la frontera honesta con la parte que
 * no.
 *
 *
 * POR QUÉ HAY DOS FUENTES Y NO UNA
 *
 * Las 15 medallas del diseño no son todas la misma clase de cosa, aunque se
 * vean igual en la galería. Se parten en dos según de qué dato dependen:
 *
 * - **`actuacion`**: se deciden con la `MatchPerformance` que ya llega a
 *   `applyMatchResult` al cerrar la partida (kills, muertes, daño,
 *   headshots, mejor racha). Estas se otorgan de verdad, hoy. Son 6.
 *
 * - **`eventos`**: necesitan telemetría por evento de combate que el motor
 *   todavía no emite hacia progresión: quién hizo la primera baja, cuántos
 *   rivales quedaban vivos en un 1vX, si dos bajas salieron de la misma
 *   bala, el marcador minuto a minuto para saber si hubo remontada. Son 9.
 *
 * La distinción está en el DATO, no en la UI, y por eso vive acá: la galería
 * la lee para no mostrar como "todavía no la conseguiste" una medalla que en
 * realidad **no puede** conseguirse porque el sistema que la dispara no
 * existe. Esas dos frases significan cosas distintas para el jugador y
 * mezclarlas sería mentirle con un contador en cero.
 *
 * Cuando el motor emita eventos de combate, cada medalla `eventos` cambia su
 * `fuente` y suma su condición en `evaluarMedallas`. Nada más se mueve: la
 * persistencia, la galería y el conteo ya están construidos para las 15.
 *
 * Los umbrales de las 6 implementadas son los del diseño, textuales. No se
 * ajustó ninguno: son la especificación del dueño, no un número elegido acá.
 */

import type { MatchPerformance } from '@/game/progression/combat-score'

/**
 * De dónde sale el veredicto de una medalla.
 *
 * - `actuacion`: derivable de `MatchPerformance`. Implementada.
 * - `eventos`: requiere telemetría de combate por evento. Sin implementar.
 */
export type MedalSource = 'actuacion' | 'eventos'

export interface MedalDef {
  readonly key: string
  /** Nombre visible, en mayúsculas como en el diseño. */
  readonly nombre: string
  /** Condición, redactada para el jugador. */
  readonly desc: string
  /** Glifo de respaldo mientras no exista el icono en `public/assets/ui/`. */
  readonly glyph: string
  readonly color: string
  readonly fuente: MedalSource
}

/**
 * Las 15 medallas del diseño, en el orden del diseño. El orden importa poco
 * funcionalmente, pero mantenerlo hace que la galería portada se pueda
 * comparar contra el HTML original de un vistazo.
 */
export const MEDALLAS: readonly MedalDef[] = [
  { key: 'firstblood', nombre: 'PRIMERA SANGRE', desc: 'Consigue la primera baja de la partida.', glyph: '✦', color: '#ff5d6c', fuente: 'eventos' },
  { key: 'headhunter', nombre: 'HEADHUNTER', desc: '10 headshots en una sola partida.', glyph: '◎', color: '#46f08a', fuente: 'actuacion' },
  { key: 'clutch', nombre: 'CLUTCH', desc: 'Gana un enfrentamiento 1vX en desventaja.', glyph: '◆', color: '#a06bff', fuente: 'eventos' },
  { key: 'triple', nombre: 'TRIPLE', desc: '3 bajas en menos de 5 segundos.', glyph: '▲', color: '#ffce4d', fuente: 'eventos' },
  { key: 'racha', nombre: 'RACHA', desc: 'Racha de 5 bajas sin morir.', glyph: '⚡', color: '#4fe3cf', fuente: 'actuacion' },
  { key: 'racha10', nombre: 'IMPARABLE', desc: 'Racha de 10 bajas sin morir.', glyph: '⚡', color: '#7bb0ff', fuente: 'actuacion' },
  { key: 'melee', nombre: 'CUERPO A CUERPO', desc: 'Baja con arma cuerpo a cuerpo.', glyph: '✕', color: '#c9ced6', fuente: 'eventos' },
  { key: 'longshot', nombre: 'LONG SHOT', desc: 'Baja a larga distancia con sniper.', glyph: '⊹', color: '#7bb0ff', fuente: 'eventos' },
  { key: 'collateral', nombre: 'COLATERAL', desc: '2 bajas con una sola bala.', glyph: '⇥', color: '#a06bff', fuente: 'eventos' },
  { key: 'flawless', nombre: 'INTACTO', desc: 'Termina la partida sin morir.', glyph: '❖', color: '#fff2c4', fuente: 'actuacion' },
  { key: 'mvp', nombre: 'MVP', desc: 'Mejor puntaje de la partida.', glyph: '★', color: '#ffce4d', fuente: 'eventos' },
  { key: 'sharpshooter', nombre: 'PUNTERÍA', desc: 'Cierra la partida con HS% sobre 40.', glyph: '◈', color: '#46f08a', fuente: 'actuacion' },
  { key: 'comeback', nombre: 'REMONTADA', desc: 'Gana tras ir perdiendo por 10 o más.', glyph: '↺', color: '#ff9a3c', fuente: 'eventos' },
  { key: 'demolition', nombre: 'DEMOLICIÓN', desc: 'Daño total sobre 4000 en una partida.', glyph: '◼', color: '#ff5d6c', fuente: 'actuacion' },
  { key: 'survivor', nombre: 'SUPERVIVIENTE', desc: 'Termina con vida bajo 10 tras un clutch.', glyph: '✚', color: '#3fe07e', fuente: 'eventos' },
]

export const MEDALLAS_BY_KEY: ReadonlyMap<string, MedalDef> = new Map(
  MEDALLAS.map((m) => [m.key, m]),
)

/** Cuántas veces sacó el jugador cada medalla. Clave ausente = nunca. */
export type MedalCounts = Readonly<Record<string, number>>

/**
 * Medallas que otorga una partida, por clave. Sólo evalúa las de fuente
 * `actuacion`: las otras no tienen con qué decidirse todavía, y devolver
 * `false` por ellas sería técnicamente cierto pero engañoso, así que
 * directamente no se las nombra acá.
 *
 * Es pura y determinista: la misma actuación da siempre las mismas medallas,
 * que es lo que la hace testeable sin motor.
 */
export function evaluarMedallas(perf: MatchPerformance): string[] {
  const ganadas: string[] = []

  // Los umbrales son los del diseño, literales. `headshots` cuenta bajas que
  // fueron a la cabeza (ver combat-score.ts), no disparos a la cabeza.
  if (perf.headshots >= 10) ganadas.push('headhunter')
  if (perf.bestStreak >= 5) ganadas.push('racha')
  if (perf.bestStreak >= 10) ganadas.push('racha10')

  // INTACTO pide además haber matado a alguien: quedarse quieto toda la
  // partida también termina con cero muertes, y eso no es una gesta.
  if (perf.deaths === 0 && perf.kills > 0) ganadas.push('flawless')

  // "HS% sobre 40" se mide sobre bajas, igual que la columna HS% del
  // marcador. Sin bajas no hay porcentaje que medir (evita el 0/0).
  if (perf.kills > 0 && perf.headshots / perf.kills > 0.4) ganadas.push('sharpshooter')

  if (perf.damage > 4000) ganadas.push('demolition')

  return ganadas
}

/** Suma las medallas de una partida al acumulado. No muta el original. */
export function acumularMedallas(previas: MedalCounts, ganadas: readonly string[]): MedalCounts {
  if (ganadas.length === 0) return previas
  const next: Record<string, number> = { ...previas }
  for (const key of ganadas) next[key] = (next[key] ?? 0) + 1
  return next
}

/** Cuántas medallas distintas consiguió el jugador al menos una vez. */
export function medallasDistintas(counts: MedalCounts): number {
  return MEDALLAS.filter((m) => (counts[m.key] ?? 0) > 0).length
}

/** Cuántas de las 15 pueden otorgarse hoy. La galería lo usa para explicar
 *  por qué el resto está en gris permanente. */
export function medallasImplementadas(): number {
  return MEDALLAS.filter((m) => m.fuente === 'actuacion').length
}
