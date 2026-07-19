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

  /**
   * Grados de retroceso vertical ya acumulado (combat/recoil.ts
   * RecoilState.pitchOffset) por encima de los cuales un bot suelta el
   * gatillo, en vez de sostenerlo mientras el objetivo siga visible. Un
   * jugador humano corrige el retroceso instintivamente (tira el mouse
   * hacia abajo); un bot no -- sin este freno, un bot en Enfrentar vacía el
   * cargador entero contra un objetivo a más de ~10m sin conectar un solo
   * disparo pasado el climb inicial, porque cada tiro sube la mira un poco
   * más. Soltar el gatillo activa la recuperación normal de retroceso
   * (combat/recoil.ts stepRecoilRecovery, que sólo corre sin el gatillo
   * sostenido) hasta volver a bajar del umbral, dando ráfagas cortas en vez
   * de un spray continuo -- más o menos lo que hace un jugador real contra
   * un objetivo lejano. Encontrado jugando una partida real de
   * bots-contra-bots (tarea de partida): 0 kills en 60s reales sin esto,
   * pese a que los bots pasaban la mayoría del tiempo en Enfrentar con
   * apuntado ya convergido -- no era un problema de percepción ni de
   * apuntado, era que el propio retroceso arruinaba cada ráfaga larga.
   */
  recoilDisciplineDeg: number

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
  /** Altura (Y, relativa a la base de la cápsula -- player.position.y es el
   *  PIE, no el centro, ver physics/capsule.ts) del centro de la hitbox de
   *  torso. Cápsula de 1.8m de alto (PLAYER_CAPSULE): pecho/torso cae más o
   *  menos a mitad de altura. */
  torsoOffsetY: number
  /** Altura del centro de la hitbox de cabeza. Ancla deliberada: casi
   *  idéntica a MOVEMENT.eyeHeight (1.65) -- el jugador y los bots APUNTAN a
   *  la altura de ojos del objetivo (bots/bot.ts lookAt, game.ts
   *  matchTargets), así que si la hitbox de cabeza no vive ahí, un disparo
   *  perfectamente apuntado nunca la toca. Bug real encontrado jugando una
   *  partida de bots-contra-bots (tarea de partida): con el valor viejo
   *  (0.65, sin relación con la altura de ojos) NINGÚN disparo entre bots
   *  conectaba nunca, aun con error de apuntado ~0 -- el rayo pasaba
   *  siempre por encima de las dos hitboxes. Invisible en fases anteriores
   *  porque los bots sólo le disparaban al jugador, cuya hitbox de cabeza
   *  SÍ usaba player.eyeHeight directamente (asimetría entre cómo se armaba
   *  la hitbox del jugador y la de los bots, ver game.ts). */
  headOffsetY: number

  /** Radio de búsqueda de candidatos al reposicionar/retirarse, metros. */
  repositionSearchRadiusM: number
  /** Cuántos candidatos de reposicionamiento se evalúan. La calidad de
   *  dificultad decide CUÁL de la lista ordenada por puntaje se elige, no
   *  cuántos se generan -- ver bots/fsm.ts. */
  repositionCandidateCount: number

  /** Separación de la retícula de nodos de patrulla, metros (bots/patrol.ts).
   *  Más chico = más destinos posibles y más A*; más grande = patrullas más
   *  gruesas. */
  patrolNodeSpacingM: number
  /** Peso del sesgo hacia el centro del mapa al elegir destino de patrulla.
   *  0 = patrulla sólo "lo más lejos posible" (las esquinas ganan siempre y
   *  los bots se reparten al borde, que es donde NO hay nadie). Alto = todos
   *  al centro y nada más, previsible. Ver bots/patrol.ts sobre por qué este
   *  número es el que decide si dos bots sin contacto se encuentran. */
  patrolCenterBias: number
  /** Amplitud del desempate determinista por bot al elegir nodo, metros de
   *  puntaje equivalente. Evita que todos elijan el mismo destino. */
  patrolJitterM: number
  /** Distancia mínima al destino de patrulla, metros: por debajo de esto no
   *  es patrullar, es temblar en el sitio. */
  patrolMinTravelM: number
  /** Distancia, metros, a partir de la cual un destino ya cuenta como "viaje
   *  largo" y el término de distancia deja de crecer. Ver bots/patrol.ts:
   *  sin esta saturación la patrulla degenera en un péndulo entre esquinas
   *  opuestas. */
  patrolPreferredTravelM: number
  /** Segundos que un bot en Idle sigue considerando "vale la pena ir a
   *  mirar" la última actividad conocida (último enemigo visto o último
   *  disparo oído) antes de pasar a patrulla normal. Sólo usa información
   *  que el bot ya tenía: nada de posiciones vivas de enemigos. */
  huntMemoryS: number

  /** Metros a los que el bot en Enfrentar sondea el terreno lateral antes de
   *  strafear hacia ahí (celda caminable + cobertura, ver bots/cover.ts). */
  engageStrafeProbeM: number
  /** Radio máximo, metros, que el strafe de Enfrentar se aleja del punto
   *  donde el bot entró en Enfrentar. Sin este ancla el bot "strafearía"
   *  derecho hasta la otra punta del mapa en vez de bailar buscando ángulo. */
  engageStrafeRadiusM: number
  /** Segundos mínimos que el bot sostiene un sentido de strafe antes de
   *  poder cambiarlo. Sin esto el bot vibra izquierda-derecha cada tick de
   *  IA, que se lee peor que quedarse quieto. */
  engageStrafeHoldS: number
  /** Holgura, metros, sobre la distancia a cobertura actual: un candidato de
   *  strafe que quede más lejos de la cobertura que esto se rechaza y el bot
   *  invierte el sentido. Es lo que evita que buscar ángulo termine en
   *  "salir a campo abierto". */
  engageStrafeCoverSlackM: number
  /** Altura mínima, metros, para que una caja del mapa cuente como cobertura
   *  al evaluar un strafe (bots/cover.ts). */
  coverMinHeightM: number

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

  // Deja pasar el "climb inicial casi plano" de cualquier arma del arsenal
  // (archetypes.ts: los primeros disparos apenas se mueven) sin cortar la
  // ráfaga de entrada, pero corta bastante antes de que el climb total de
  // cualquier arquetipo (7°-24°, ver AR_REFERENCE_CLIMB_DEG_MIN/MAX) la
  // saque del todo del objetivo a rango medio.
  recoilDisciplineDeg: 4.0,

  targetMemoryS: 3.0,
  suspicionMemoryS: 2.0,

  retreatEnterHealthFraction: 0.3,
  retreatExitHealthFraction: 0.5,

  maxHealth: 100,
  respawnDelayS: 3.0,

  torsoRadius: 0.4,
  headRadius: 0.2,
  // Cápsula de 1.8m: torso a mitad de altura, cabeza cerca de la altura de
  // ojos real (MOVEMENT.eyeHeight = 1.65) -- ver el comentario del campo.
  torsoOffsetY: 0.95,
  headOffsetY: 1.6,

  repositionSearchRadiusM: 12,
  repositionCandidateCount: 8,

  // 10m en una arena de 60x60 da ~30 nodos: suficientes destinos para que
  // ocho bots no marchen en fila india, pocos como para que elegir uno sea
  // un bucle de 30 iteraciones sin asignaciones en el tick de IA.
  patrolNodeSpacingM: 10,
  // 0.45 calibrado jugando: por debajo de ~0.3 los destinos ganadores son
  // siempre las esquinas opuestas (los bots patrullan el perímetro y se
  // cruzan poco); por encima de ~0.7 todos convergen al centro y la partida
  // se vuelve una pila en el mismo pasillo. 0.45 manda el tráfico por la
  // banda central sin que el destino final sea siempre el mismo punto.
  patrolCenterBias: 0.45,
  patrolJitterM: 7,
  patrolMinTravelM: 9,
  // 22m en una arena de 60x60: cruza al menos un carril y la banda central,
  // que es donde ocurre el contacto.
  patrolPreferredTravelM: 22,
  // 12s: más largo que targetMemoryS/suspicionMemoryS (3s/2s, las ventanas
  // en las que Reposicionar/Rotar todavía persiguen el rastro). Este número
  // gobierna el escalón siguiente: ya no persigo, pero antes de ponerme a
  // patrullar voy a mirar dónde pasó la cosa.
  huntMemoryS: 12,

  engageStrafeProbeM: 1.5,
  engageStrafeRadiusM: 3.0,
  // 0.9s de sostén: a la velocidad de caminata da ~3m de recorrido lateral,
  // más o menos el ancho de una cobertura de la arena -- se lee como un
  // jugador buscando ángulo, no como un temblor.
  engageStrafeHoldS: 0.9,
  engageStrafeCoverSlackM: 1.0,
  // 1.0m = la cobertura BAJA de la arena (map/arena.ts LOW). Por debajo de
  // eso no tapa a nadie ni agachado.
  coverMinHeightM: 1.0,

  stuckSpeedThreshold: 0.6,
  stuckTimeS: 0.25,
}
