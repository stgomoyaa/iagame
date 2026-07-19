/**
 * Números de bots (sección 8 del spec de fase 2): navegación, percepción,
 * apuntado y estados. Mismo patrón mutable que movement/tuning.ts,
 * feedback/tuning.ts y targets/tuning.ts.
 *
 * Los TRES números de dificultad (tiempo de reacción, cono de error, calidad
 * de reposicionamiento) NO viven acá -- son datos por-tier, interpolados en
 * bots/difficulty.ts. Todo lo demás en este archivo es constante para
 * cualquier bot sea cual sea su dificultad, tal como pide el spec ("la
 * dificultad escala tres números y nada más").
 */

export interface BotsTuning {
  /** Tamaño de celda del navgrid, metros. */
  navCellSize: number
  /**
   * Máxima diferencia de altura entre celdas vecinas para considerarlas
   * conectadas. Se deriva de MOVEMENT.mantleMaxHeight en navgrid.ts (no acá)
   * para que sea una sola fuente de verdad -- un bot navega exactamente por
   * donde el mismo stepPlayer() puede llevarlo caminando o mantleando.
   */

  /** Alcance del cono de visión, metros. */
  visionRangeM: number
  /** Semiángulo del cono de visión, grados (FOV total = 2x esto). */
  visionHalfAngleDeg: number
  /** Radio de audición de un disparo, metros. */
  hearingRadiusM: number

  /** Frecuencia del tick de IA (percepción + FSM + pathfinding), Hz. */
  aiTickHz: number

  /** Velocidad angular máxima del apuntado, grados/segundo. Fija: no varía
   *  con la dificultad (spec sección 8: "nada más varía"). Separada del cono
   *  de error, que sí varía por tier. */
  aimMaxAngularSpeedDegPerSec: number

  /** Segundos que un objetivo perdido de vista sigue "recordado" (Reposicionar
   *  sigue activo) antes de volver a Idle. */
  targetMemoryS: number
  /** Segundos que dura la sospecha por sonido (Rotar) sin reforzarse antes de
   *  volver a Idle. */
  suspicionMemoryS: number

  /** Fracción de vida (0-1) bajo la cual se entra en Retirarse. */
  retreatEnterHealthFraction: number
  /** Fracción de vida (0-1) sobre la cual se sale de Retirarse. Mayor que la
   *  de entrada a propósito (histéresis): sin el margen, health oscilando
   *  justo en el umbral generaría un parpadeo Retirarse<->Enfrentar cada tick. */
  retreatExitHealthFraction: number

  /** Vida máxima de un bot. Igual que la del jugador (feedback/tuning.ts
   *  startingHealth): mismas reglas para todos, sección 8 del spec. */
  maxHealth: number
  /** Segundos entre que un bot muere (vida a 0) y reaparece. Mismo patrón
   *  que TARGETS.respawnDelayS. */
  respawnDelayS: number

  torsoRadius: number
  headRadius: number
  headOffsetY: number

  /** Radio de búsqueda de candidatos al reposicionar/retirarse, metros. */
  repositionSearchRadiusM: number
  /** Cuántos candidatos de reposicionamiento se evalúan. La calidad de
   *  dificultad decide CUÁL de la lista ordenada por puntaje se elige, no
   *  cuántos se generan -- ver bots/fsm.ts. */
  repositionCandidateCount: number

  /** Radianes/seg a los que decae el error de "atascado" (empuja al bot a
   *  saltar) -- no es visual, gobierna sólo la heurística de mantle. */
  stuckSpeedThreshold: number
  /** Segundos moviéndose por debajo de stuckSpeedThreshold con intención de
   *  avanzar antes de asumir que el bot está atascado contra una pared. */
  stuckTimeS: number
}

export const BOTS: BotsTuning = {
  navCellSize: 1.0,

  // 45m cubre la mayoría de líneas de tiro reales de la arena (60x60,
  // diagonal ~85m) sin dejar que un bot "sienta" al jugador de punta a
  // punta del mapa -- las coberturas ya cortan la mayoría de esas líneas
  // igual, esto es el resto.
  visionRangeM: 45,
  // 55° de semiángulo = 110° de FOV total, banda humana típica de FPS
  // (110-120° es lo usual para el jugador; los bots usan un poco menos para
  // que "por detrás tuyo" sea de verdad un punto ciego explotable).
  visionHalfAngleDeg: 55,
  // Un disparo se oye más lejos de lo que se ve: mayor que visionRangeM a
  // propósito -- un bot puede reaccionar a un tiro fuera de su cono o
  // detrás de cobertura sin haber visto nada, que es exactamente lo que hace
  // un disparo en la vida real.
  hearingRadiusM: 30,

  aiTickHz: 15,

  // Vuelta completa (360°) en 0.6s a tope: rápido para un humano pero lejos
  // de instantáneo -- sigue siendo "seguimiento", nunca snap, sea cual sea
  // el tamaño del giro que el objetivo pida.
  aimMaxAngularSpeedDegPerSec: 600,

  targetMemoryS: 3.0,
  suspicionMemoryS: 2.0,

  retreatEnterHealthFraction: 0.3,
  retreatExitHealthFraction: 0.5,

  maxHealth: 100,
  respawnDelayS: 3.0,

  torsoRadius: 0.4,
  headRadius: 0.2,
  headOffsetY: 0.65,

  repositionSearchRadiusM: 12,
  repositionCandidateCount: 8,

  stuckSpeedThreshold: 0.6,
  stuckTimeS: 0.25,
}
