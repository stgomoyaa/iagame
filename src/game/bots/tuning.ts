/**
 * Números de bots (sección 8 del spec de fase 2): navegación, percepción,
 * apuntado y estados. Mismo patrón mutable que movement/tuning.ts,
 * feedback/tuning.ts y targets/tuning.ts.
 *
 * Los números que SÍ escalan con la dificultad (reacción, demora de ataque,
 * cono de error y su residual, velocidad de mira, agresividad, control de
 * retroceso, calidad de reposicionamiento) NO viven acá -- son datos
 * por-tier, interpolados en bots/difficulty.ts. Todo lo de este archivo es
 * constante para cualquier bot sea cual sea su dificultad; lo que cambia
 * entre Fácil y Experto vive en difficulty.ts, no acá.
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
  /** Distancia (m) por debajo de la cual un bot en Retirarse deja de huir y
   *  devuelve el fuego. Huir de alguien que ya te tiene a quemarropa es
   *  morir de espaldas: a esa distancia la única jugada que queda es pelear. */
  retreatFightBackM: number

  /** Vida máxima de un bot. Igual que la del jugador (feedback/tuning.ts
   *  startingHealth): mismas reglas para todos, sección 8 del spec. */
  maxHealth: number
  /** Segundos entre que un bot muere (vida a 0) y reaparece. Mismo patrón
   *  que TARGETS.respawnDelayS. */
  respawnDelayS: number

  /**
   * Multiplicador GLOBAL de velocidad de movimiento de los bots (no del
   * jugador). Se enchufa en el hook que ya existía sin usar:
   * PlayerInput.adsSpeedScale, que targetSpeed() (movement/step.ts) multiplica
   * sobre la velocidad objetivo. El input de los bots se arma con este valor y
   * el del jugador no lo toca (undefined = 1), así que frena a los bots sin
   * cambiar la física compartida ni la velocidad del jugador.
   *
   * Los bots esprintaban a MOVEMENT.sprintSpeed (8 m/s) en todo estado con
   * movimiento salvo Enfrentar — más rápido que cualquier FPS mainstream (CS
   * corre ~4,8, CoD esprinta ~6,7) — y combinado con el FOV ancho la velocidad
   * angular en pantalla era altísima: "van muy rápido, difícil achuntarles". La
   * dificultad NO toca velocidad (decisión de difficulty.ts), así que este es
   * el único knob global. 0.82 (sprint 8->6,6, walk/strafe 5->4,1) es el punto
   * de partida que el dueño afina jugando — misma desaceleración práctica que el
   * 0.8 del diagnóstico. NO se baja a 0.80 exacto: ese valor puntual empotra a
   * un bot contra una pared en torre (el test "un escuadrón bajo fuego no se
   * queda plantado" lo caza). Es una resonancia de trayectoria de un seed, no un
   * "bots lentos se atascan" general (0.81-0.9 pasan limpio); la raíz es que la
   * heurística de atascado (stuckSpeedThreshold, más abajo) mide |velocity| y no
   * el avance real, así que no ve a un bot que desliza pegado a un muro. Bajarlo
   * por debajo de ~0.8 con seguridad pediría arreglar esa heurística aparte.
   */
  botSpeedScale: number

  /**
   * Escala uniforme aplicada al modelo del personaje (bots/renderer.ts).
   * Los cuatro personajes comparten esqueleto: el hueso `Head` vive a 1.709 m
   * en pose de bind y el cuerpo mide 1.854 m. 0.971 = 1.8/1.854 deja la
   * silueta exactamente dentro de la cápsula de física (PLAYER_CAPSULE.height
   * = 1.8) y, de paso, el centro del cráneo a 1.66 -- que es donde vive la
   * hitbox de cabeza. Cualquier cambio acá desalinea lo que se ve de lo que
   * se dispara: ver bots/hitbox-modelo.test.ts, que ancla los dos números.
   */
  modelScale: number

  torsoRadius: number
  headRadius: number
  /** Radio de la hitbox de piernas ('limb', x0.85). */
  legsRadius: number
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
  /**
   * Altura del centro de la hitbox de piernas. Existe desde que los bots
   * dejaron de ser cápsulas: con sólo torso y cabeza, la mitad inferior de
   * un cuerpo claramente visible no registraba ningún impacto -- se le
   * disparaba a las piernas de algo que se ve como una persona y no pasaba
   * nada. Usa el multiplicador 'limb' (x0.85) que ya existía en
   * combat/hitboxes.ts y hasta ahora ningún objetivo estrenaba.
   */
  legsOffsetY: number

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

  /**
   * Distancia al objetivo, metros, por encima de la cual un bot en Enfrentar
   * deja de bailar en el sitio y CAMINA hacia él.
   *
   * Es el arreglo de fondo del amontonamiento. Enfrentar hacía `clearPath`
   * SIEMPRE: un bot que adquiría blanco se plantaba a disparar sin importar
   * la distancia, con el strafe atado a `engageStrafeRadiusM` como único
   * movimiento. Medido en nuketown con 8 bots, la mitad de las muestras de
   * bot vivo caían en Enfrentar: media partida con los bots clavados. Dos
   * que se cruzaban quedaban congelados juntos todo el tiroteo, y ese es el
   * racimo de la captura.
   *
   * Quedarse parado a cielo abierto a 45 m (el alcance de visión) tampoco es
   * lo que hace un jugador. Por encima de este umbral el bot navega -- lo
   * que además le devuelve la separación al caminar de steerAlongPath, que
   * en Enfrentar no corría nunca porque sin camino no hay steering.
   *
   * 18 m y no menos: es la separación que saldría de repartir 8 bots parejo
   * por la zona jugable de nuketown (18.2 m). Un duelo a esa distancia ya
   * está holgadamente por encima de los 3 m con que se mide el racimo, así
   * que acercarse más no compra separación, sólo la gasta.
   */
  engageAdvanceM: number
  /**
   * Distancia, metros, a la que el avance de Enfrentar se detiene y vuelve
   * el duelo lateral. Estrictamente menor que `engageAdvanceM`: es
   * histéresis, no un segundo umbral. Sin la banda muerta, un bot parado
   * justo en el umbral alterna entre navegar y strafear en cada think de
   * 15Hz y no hace ninguna de las dos cosas.
   */
  engageAdvanceStopM: number
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
  /**
   * Segundos que el bot sigue rompiendo la línea de tiro después de recibir
   * un impacto (bots/bot.ts, intención 'romper-linea'). Corto a propósito: es
   * una reacción a que te peguen, no un modo de andar. Si te siguen pegando
   * se renueva sola, porque `sinDanoS` se reinicia con cada impacto.
   */
  breakLineS: number
  /**
   * Metros de distancia a cobertura por encima de los cuales el bot se
   * considera AL DESCUBIERTO y vale la pena gastar un paso lateral en
   * taparse. Por debajo ya está lo bastante cerca de algo y moverse sólo lo
   * expondría más.
   */
  coverSeekDistanceM: number
  /**
   * Mejora MÍNIMA de distancia a cobertura, metros, para que valga la pena
   * dar el paso. Es un margen anti-empate: sin él, dos lados casi iguales se
   * alternan tick a tick y "buscar cobertura" se convierte en el temblor que
   * esta tarea saca.
   */
  coverSeekGainM: number
  /** Agresividad mínima (bots/difficulty.ts) para que un bot se moleste en
   *  rodear buscando ángulo. Los bots fáciles no rodean: se plantan y
   *  disparan, que es justamente lo que se les pide. */
  flankMinAggression: number
  /** Segundos máximos de un rodeo antes de plantarse. Acota el único
   *  movimiento lateral que nadie está forzando. */
  flankMaxS: number
  /** Segundos plantado antes de poder iniciar OTRO rodeo. Es lo que impide
   *  que "termina el rodeo" y "empieza el rodeo contrario" se encadenen y
   *  reconstruyan el péndulo por otro camino. */
  flankCooldownS: number
  /** Holgura, metros, sobre la distancia a cobertura actual: un candidato de
   *  strafe que quede más lejos de la cobertura que esto se rechaza y el bot
   *  invierte el sentido. Es lo que evita que buscar ángulo termine en
   *  "salir a campo abierto". */
  engageStrafeCoverSlackM: number
  /**
   * Radio de "espacio personal" de un bot, metros: por debajo de esto, otro
   * participante vivo cuenta como estorbo y el bot se corre.
   *
   * Es el número central de la tarea de amontonamiento. Medido en nuketown
   * con 8 bots, la distancia mínima entre bots vivos daba 2.71 m de mediana
   * contra los 18.2 m que saldrían de repartirlos parejo, y el 51% de las
   * muestras tenían dos bots a menos de 3 m. La causa no era la reaparición
   * (eso ya se arregló) sino que Enfrentar hace `clearPath`: un bot en
   * combate deja de navegar y su único movimiento es un strafe atado a
   * `engageStrafeRadiusM` del punto donde entró en el estado. Dos bots que
   * se cruzan quedan clavados juntos todo el tiroteo.
   *
   * Por qué 4 y no 18: separarlos "parejo" mata el combate -- ya pasó en
   * este proyecto (partida de 6 min con 1 kill). Este término es de CORTO
   * alcance a propósito: no reparte bots por el mapa, sólo impide que dos
   * cuerpos ocupen el mismo metro cuadrado. Apenas el bot recupera su
   * espacio el término se apaga solo, así que no cambia en nada la
   * probabilidad de que dos bots se encuentren, que es lo que gobierna los
   * kills y el mayor silencio.
   */
  personalSpaceM: number
  /**
   * Cuánto pesa el espacio personal al elegir a dónde reposicionarse.
   * Topeado por construcción (el término vale como mucho
   * personalSpaceM * este peso), y muy por debajo del 1000 con que
   * Reposicionar premia romper la línea de vista: separarse es un
   * desempate entre destinos parecidos, nunca una razón para elegir un
   * destino tácticamente peor. Mismo criterio que el término de
   * compañeros de match/respawn.ts, que arrancó demasiado fuerte y hubo
   * que bajarlo midiendo.
   */
  personalSpaceRepositionWeight: number
  /**
   * Cuánto pesa la separación al CAMINAR (bots/bot.ts steerAlongPath), como
   * fracción del rumbo hacia el waypoint. 1 = alejarse del vecino pesa tanto
   * como llegar al destino; 0 = apaga la separación al caminar.
   *
   * Por debajo de 1 a propósito: la mezcla tiene que RODEAR al vecino, no
   * abandonar el destino. Con peso >= 1 un bot con alguien justo enfrente
   * puede terminar caminando hacia atrás, y un bot que no llega nunca a
   * ningún lado es un bot que no se encuentra con nadie -- el mayor silencio
   * se dispara, que es el otro lado del equilibrio de esta tarea.
   */
  separationSteerWeight: number
  /** Altura mínima, metros, para que una caja del mapa cuente como cobertura
   *  al evaluar un strafe (bots/cover.ts). */
  coverMinHeightM: number
  /**
   * Altura sobre el suelo local, metros, a la que se sondea si hay geometría
   * sólida al hornear el campo de cobertura de un mapa importado
   * (bots/cover-field.ts). Es la altura del TORSO: lo que decide si algo te
   * tapa de un disparo no es que estorbe el paso sino que haya material
   * entre la bala y tu pecho.
   *
   * 0.9 y no 1.5 (los ojos) a propósito: una cobertura media que te deja la
   * cabeza afuera sigue siendo cobertura -- es la que usa cualquier jugador
   * asomándose. Sondear a la altura de los ojos descartaría justo las más
   * usadas.
   */
  coverProbeHeightM: number
  /**
   * Lado de la lattice del campo de cobertura, metros. Más fino que
   * `navCellSize` a propósito: la sonda cae en el CENTRO de la celda, y con
   * 1 m el centro de una celda pegada a un muro cae del lado del aire, así
   * que muros y props delgados desaparecían del campo. MEDIDO en nuketown
   * con 0.25: 5.664 sondas sólidas contra 3 (tres, no un typo) sondeando a
   * 1 m. El costo es memoria de bake, que se paga una vez por mapa.
   */
  coverFieldCellSizeM: number

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
  // 6 m es, con cualquier arma del arsenal, distancia de no fallar: por
  // dentro de eso girarse y correr regala la espalda gratis. Medido antes
  // de existir este umbral, en 6 min de nuketown: 77 muestras con un
  // enemigo a menos de 3 m y el bot en Retirarse SIN apretar el gatillo
  // ni una sola vez, contra 51 en Enfrentar disparando.
  retreatFightBackM: 6.0,

  maxHealth: 100,
  respawnDelayS: 3.0,

  // 0.82 = punto de partida (sprint 8->6,6, walk/strafe 5->4,1 m/s). El dueño
  // lo afina jugando; ver el comentario del campo en la interfaz (y por qué NO
  // 0.80 exacto: empotra un bot en torre, resonancia de un seed).
  botSpeedScale: 0.82,

  modelScale: 0.971,

  // Los tres radios y las tres alturas salen de MEDIR el modelo ya escalado
  // (scripts/convert-characters.ts imprime la geometría de origen; los
  // números de abajo son esas medidas x modelScale), no de tantear hasta
  // que "se sienta bien". Con el personaje de pie sobre y=0:
  //
  //   parte    visible          hitbox           multiplicador
  //   piernas  0.00 .. 0.83     0.02 .. 0.82     x0.85 (limb)
  //   torso    0.83 .. 1.53     0.80 .. 1.56     x1.0
  //   cabeza   1.52 .. 1.80     1.50 .. 1.82     x1.8
  //
  // La cabeza queda centrada en 1.66, a 1 cm de MOVEMENT.eyeHeight (1.65):
  // el ancla que pide el comentario de headOffsetY se respeta mejor que
  // antes, cuando estaba en 1.6 y el cráneo dibujado caía en 1.71 -- 11 cm
  // más arriba que su propia hitbox. Ese desfase es exactamente el bug que
  // esta tarea venía a evitar: la parte de arriba de una cabeza claramente
  // visible no registraba, y el pecho alto contaba como headshot.
  torsoRadius: 0.38,
  headRadius: 0.16,
  legsRadius: 0.4,
  torsoOffsetY: 1.18,
  headOffsetY: 1.66,
  legsOffsetY: 0.42,

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

  // 18/12: la banda muerta de 6m es más ancha que lo que un bot camina entre
  // dos decisiones (walkSpeed a 15Hz da ~0.35m), así que el estado no puede
  // vibrar aunque el objetivo se mueva hacia él.
  engageAdvanceM: 18,
  engageAdvanceStopM: 12,
  engageStrafeProbeM: 1.5,
  engageStrafeRadiusM: 3.0,
  // 0.9s de sostén: a la velocidad de caminata da ~3m de recorrido lateral,
  // más o menos el ancho de una cobertura de la arena -- se lee como un
  // jugador buscando ángulo, no como un temblor.
  engageStrafeHoldS: 0.9,
  // 0.7s: alcanza para salir del punto donde el tirador te tenía encuadrado
  // (~3.5m a velocidad de caminata) sin convertirse en un modo de andar.
  breakLineS: 0.7,
  // 2.0m: más lejos que esto de una caja ya no te tapa de nada. Es el mismo
  // orden que engageStrafeProbeM (1.5m), así que un solo paso lateral puede
  // de verdad cambiar la respuesta -- un umbral que ningún paso alcanza a
  // cruzar no guiaría nada.
  coverSeekDistanceM: 2.0,
  // 0.35m de mejora mínima: por debajo de eso las dos opciones son la misma
  // y elegir entre ellas es tirar una moneda cada tick.
  coverSeekGainM: 0.35,
  // 0.7 = de Difícil para arriba (bots/difficulty.ts: Difícil 0.75,
  // Experto 1.0). Fácil (0.2) y Normal (0.5) no rodean.
  flankMinAggression: 0.7,
  flankMaxS: 1.6,
  flankCooldownS: 1.2,
  engageStrafeCoverSlackM: 1.0,
  // 1.0m = la cobertura BAJA de la arena (map/arena.ts LOW). Por debajo de
  // eso no tapa a nadie ni agachado.
  personalSpaceM: 5.0,
  personalSpaceRepositionWeight: 3.0,
  separationSteerWeight: 0.7,
  coverMinHeightM: 1.0,
  coverProbeHeightM: 0.9,
  coverFieldCellSizeM: 0.25,

  stuckSpeedThreshold: 0.6,
  stuckTimeS: 0.25,
}
