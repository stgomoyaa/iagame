/**
 * Detección de medallas de gesta. Consume los eventos de combate que la
 * partida YA produce (match/match.ts recordKill/recordDamage, el mismo
 * punto que alimenta el killfeed) y decide, en el instante, si lo que acaba
 * de pasar merece una medalla.
 *
 * El catálogo -- qué medallas existen, cómo se llaman, cuánto pagan -- vive
 * en `progression/medals.ts` y no sabe nada de esto. Acá está lo único que
 * de verdad decide si el sistema funciona: **CUÁNDO salta cada una**.
 *
 *
 * LO QUE HACE O ROMPE ESTA CAPA: LAS VENTANAS
 *
 * Una medalla no vale por lo que dice, vale por lo seguido que aparece.
 * Salta cada veinte segundos y se vuelve ruido de fondo que el ojo aprende
 * a ignorar; no salta nunca y es contenido muerto que sólo ocupa lugar en
 * la galería. Todos los números de `MEDALLAS_TUNING` están calibrados
 * contra partidas reales medidas con `scripts/medir-medallas.ts` (bots
 * reales, A* real, hitscan real, seis minutos), no elegidos a ojo. Cada uno
 * lleva su derivación al lado, igual que movement/tuning.ts.
 *
 * El ritmo de referencia contra el que están calibrados: FFA con 8 bots en
 * esta arena da del orden de 15 bajas del jugador en 6 minutos, o sea una
 * cada ~24 segundos. Cualquier ventana comparable a 24 s convierte una
 * medalla en "salta con cada baja".
 *
 *
 * CERO ASIGNACIONES
 *
 * Esto corre por evento de combate, dentro del camino de frame de game.ts.
 * Todo el estado son escalares y arrays tipados dimensionados una vez en
 * `createMedalTracker`, y los avisos salen por un `RingPool` preasignado --
 * el mismo patrón, y por la misma razón, que match/killfeed.ts y
 * feedback/hitmarkers.ts. Ninguna función de este archivo que corra durante
 * la partida asigna nada; las dos que sí lo hacen
 * (`listActiveAwardsNewestFirst`, `tallyDeMedallas`) las llama la UI de
 * baja frecuencia o el cierre de partida, y lo dicen en su comentario.
 */

import { createRingPool, nextPoolSlot, type RingPool } from '@/game/feedback/pool'
import { PLAYER_ID, teamForParticipant, type MatchMode } from '@/game/match/types'
import {
  CATALOGO_MEDALLAS,
  MEDALLA,
  MEDALLAS_TOTALES,
  type MedalId,
  type MedalTally,
} from '@/game/progression/medals'

export interface MedalTuning {
  /**
   * Segundos entre bajas para que sigan contando como la misma andanada
   * (doble / triple / masacre).
   *
   * Sin ventana, "doble baja" es cualquier par de bajas de la partida y la
   * medalla salta con cada baja a partir de la segunda -- por eso la
   * ventana ES la medalla, no un detalle de implementación.
   *
   * 4 s sale de la separación medida entre bajas consecutivas del jugador:
   * mediana 8-11 s, p25 4-6 s, p10 1.5-2.9 s. O sea que 4 s cae cerca del
   * primer cuartil: exige que las dos bajas salgan del mismo enfrentamiento
   * y no de dos encuentros distintos que casualmente cayeron cerca.
   * Resultado medido: 1.2-2.2 dobles por partida en TDM y 3.3 en FFA.
   */
  ventanaMultikillS: number

  /**
   * Segundos desde que alguien te mató para que matarlo cuente como
   * venganza.
   *
   * El respawn del jugador tarda 3 s (match/tuning.ts respawnDelayS), así
   * que 15 s de ventana son unos 12 s reales de vida para encontrarlo:
   * alcanza para cruzar la arena, no para que te lo encuentres de casualidad
   * media partida después. Más allá de eso ya no es una revancha, es una
   * baja más contra alguien que te había matado hace rato, y la medalla se
   * vuelve gratis.
   *
   * Barrido medido (medallas por partida, TDM / FFA):
   *   10 s -> 0.50 / 1.50    15 s -> 0.92 / 2.42
   *   20 s -> 1.25 / 2.92    30 s -> 1.67 / 3.75
   * A 30 s la venganza saltaba más seguido que la doble baja, que es la
   * señal de que había dejado de significar algo.
   */
  ventanaVenganzaS: number

  /**
   * Segundos desde que un enemigo le pegó a un compañero para que matarlo
   * cuente como salvada. 3 s es "le está disparando ahora": el compañero
   * todavía está en ese intercambio. Con 10 s empieza a pagar bajas contra
   * gente que ya se fue a otro lado del mapa, que no salva a nadie.
   *
   * Sólo existe en TDM: en FFA nadie tiene compañeros (match/types.ts,
   * cada participante es su propio equipo), así que no hay a quién salvar y
   * la medalla no puede dispararse. No hace falta ramificar por modo -- el
   * conjunto de compañeros sale vacío solo.
   */
  ventanaSalvadaS: number

  /** Bajas seguidas sin morir de cada escalón de racha. */
  rachaBaja: number
  rachaAlta: number

  /**
   * Metros desde los que una baja cuenta como tiro largo, y hasta los que
   * cuenta como a quemarropa.
   *
   * Los dos salen de la distribución REAL de distancias de baja, medida
   * sobre 100 partidas completas, y NO del tamaño del mapa. Es la diferencia
   * que más se paga si se hace mal: la arena mide 60x60 m, así que un
   * umbral "razonable" sacado de la geometría (40 m, digamos) daría una
   * medalla que no salta jamás. Medido, las bajas caen a una mediana de
   * 11-12 m y el percentil 90 está en 18-22 m -- pelear de lejos en estos
   * mapas simplemente no pasa, porque las líneas de visión largas están
   * cortadas por cobertura.
   *
   * Barrido medido de tiro largo (medallas por partida, los cinco
   * escenarios): 18 m -> 0.90-2.65; 21 m -> 0.50-1.15; 24 m -> 0.15-0.65;
   * 28 m -> 0.00-0.30, y en el búnker exactamente 0.00. Se eligió 21 m: es
   * el valor más alto que sigue disparando en TODOS los mapas medidos.
   *
   * A quemarropa, barrido: 4 m -> 0.10-0.90; 5 m -> 0.20-1.25; 7 m ->
   * 0.35-2.05. Se eligió 5 m. El búnker siempre queda arriba del resto
   * (pasillos angostos) y eso está bien: un mapa cerrado DEBE producir más
   * bajas a quemarropa que uno abierto, y una medalla que no notara la
   * diferencia entre mapas estaría midiendo mal.
   */
  distanciaTiroLargoM: number
  distanciaQuemarropaM: number

  /**
   * Clutch: vida máxima (de 100) y ventana desde el último impacto RECIBIDO
   * de ese mismo rival para que matarlo cuente como dar vuelta el
   * intercambio.
   *
   * ESTA MEDALLA SE REDEFINIÓ PORQUE LA VERSIÓN LITERAL ESTÁ MUERTA. La
   * lectura clásica -- "último vivo de tu equipo y ganás la ronda" -- no es
   * implementable acá por dos motivos independientes: no hay rondas, y con
   * equipos de cinco y respawn a los 3 s, quedar último vivo de tu equipo
   * es un estado que casi no ocurre. Medido sobre 100 partidas de 6 minutos
   * (scripts/medir-medallas.ts): se entra a "último vivo" 0.00 a 0.15 veces
   * POR PARTIDA. Pedir además dos bajas ahí adentro da exactamente cero en
   * las 100. Y en FFA la condición ni siquiera tiene sentido: como cada
   * participante es su propio equipo (match/types.ts), "último vivo de tu
   * equipo" sería verdad todo el tiempo.
   *
   * Lo que sí existe, y es lo que la medalla quiere premiar de verdad, es
   * ganar un intercambio que venías perdiendo. La vida del jugador en el
   * instante de sus bajas se midió así: mediana 100, p25 entre 65 y 100,
   * p10 y p05 clavados en 37. O sea que hay una cola real de bajas hechas
   * con la vida ya castigada. El corte en 40 toma esa cola.
   *
   * La ventana de 5 s sobre el daño RECIBIDO de ese mismo rival es lo que
   * separa la gesta del accidente: sin ella, cualquier baja hecha mientras
   * arrastrás vida baja de un tiroteo de hace un minuto contaría, y eso no
   * es dar vuelta nada. Con ella, el rival que cae es el que te estaba
   * ganando el duelo hace un segundo.
   *
   * Funciona igual en TDM y en FFA, que es la otra cosa que la versión
   * literal no lograba.
   */
  clutchVidaMaxima: number
  ventanaClutchS: number

  /**
   * Bajas seguidas sobre el MISMO rival, sin que él te devuelva ninguna,
   * para que cuente como dominación.
   *
   * Es el reemplazo de "Invicto de ronda", que pedía rondas que este juego
   * no tiene. Mide la misma sensación -- imponerte sobre alguien de forma
   * sostenida y no por un golpe de suerte -- con lo que sí hay: memoria de
   * quién mató a quién, que el tracker ya lleva para venganza.
   *
   * Con 8 bots, 3 seguidas sobre uno concreto es claramente intencional:
   * repartidas al azar, tres bajas caerían sobre tres rivales distintos.
   */
  dominacionBajas: number

  /**
   * "Sin morir": segundos de vida continua y bajas mínimas en esa vida.
   *
   * TAMBIÉN SE REDEFINIÓ, Y POR LA MISMA RAZÓN. La lectura literal --
   * terminar la partida entera sin morir una sola vez -- dio **cero en 100
   * partidas**, incluso corriendo al jugador con la dificultad al máximo
   * (1.0) contra rivales al mínimo (0.05): ni así baja de 4.3 muertes por
   * partida. No es que sea difícil, es que en una partida de 6 minutos con
   * nueve participantes y respawn constante no ocurre. Una medalla que no
   * salta nunca es peor que una que no existe: ocupa un lugar en la galería
   * y le enseña al jugador que esa fila es decorativa.
   *
   * Reemplazo: sobrevivir una vida LARGA con trabajo hecho. Duración medida
   * de cada vida del jugador en TDM: mediana 26 s, p75 38-47 s, p90 63-68 s,
   * máximo 125-197 s. El corte en 60 s cae cerca del percentil 90, así que
   * paga alrededor de una vez cada dos partidas en vez de nunca.
   *
   * El piso de bajas existe para que la medalla premie sobrevivir PELEANDO:
   * sin él, esconderse un minuto en un rincón sería la forma óptima de
   * ganarla, que es exactamente el comportamiento contrario al que el juego
   * quiere.
   *
   * Efecto secundario bueno: al pasar de "al terminar la partida" a "en el
   * instante en que cruzás el minuto", el set entero queda coherente --
   * las quince pagan en el momento del acto, ninguna al final.
   *
   * En FFA casi no salta (las vidas ahí duran 12 s de mediana y 53 s la más
   * larga medida): es la medalla más aspiracional del modo, no un error de
   * calibración.
   */
  supervivenciaS: number
  supervivenciaBajasMinimas: number

  /** Cuántos avisos pueden estar en pantalla a la vez y cuánto viven.
   *  Mismo criterio que el killfeed. */
  avisosMaximos: number
  avisoDuracionS: number
}

export const MEDALLAS_TUNING: MedalTuning = {
  ventanaMultikillS: 4,
  ventanaVenganzaS: 15,
  ventanaSalvadaS: 3,
  rachaBaja: 5,
  rachaAlta: 10,
  distanciaTiroLargoM: 21,
  distanciaQuemarropaM: 5,
  clutchVidaMaxima: 40,
  ventanaClutchS: 5,
  dominacionBajas: 3,
  supervivenciaS: 60,
  supervivenciaBajasMinimas: 2,
  avisosMaximos: 4,
  avisoDuracionS: 3,
}

/** Un aviso de medalla en pantalla. Vive en un anillo preasignado y
 *  envejece igual que una entrada de killfeed. */
export interface MedalAward {
  active: boolean
  age: number
  /** Orden de inserción, monótono -- desempata dos medallas del mismo
   *  frame para que la UI las liste estable. */
  seq: number
  medalId: MedalId
  /** Segundo de partida en que se ganó. */
  tiempoS: number
}

export interface MedalTrackerState {
  readonly mode: MatchMode
  readonly participantCount: number
  /** Participante cuyas gestas se miden. Siempre el jugador en el juego
   *  real; parametrizado para que la medición headless pueda seguir a un
   *  bot (scripts/medir-medallas.ts). */
  readonly seguidoId: number
  /** ¿Tiene compañeros de equipo? Falso en FFA. De esto depende "salvada",
   *  la única medalla que necesita que exista un equipo. Clutch dejó de
   *  depender de esto al redefinirse -- ver MedalTuning.clutchVidaMaxima. */
  readonly tieneCompaneros: boolean

  avisos: RingPool<MedalAward>
  nextSeq: number

  /** Veces que se ganó cada medalla en ESTA partida, indexado por MedalId. */
  conteo: Int32Array

  /** 1 si el participante está vivo. Lo mantienen registrarKillMedallas y
   *  registrarReaparicionMedallas. */
  vivo: Uint8Array
  /** Último segundo en que `i` le pegó a un compañero del seguido (sin
   *  contar al seguido mismo). -Infinity = nunca. */
  ultimoDanoAAliadoS: Float64Array
  /** Último segundo en que `i` mató al seguido. -Infinity = nunca. Se
   *  vuelve a -Infinity al cobrarse la venganza, para que una sola muerte
   *  no pague dos veces. */
  ultimaMuertePorS: Float64Array
  /** Último segundo en que `i` le pegó al SEGUIDO. Es la memoria del duelo
   *  en curso, y de ella depende clutch. -Infinity = nunca. */
  ultimoDanoRecibidoDeS: Float64Array
  /** Bajas seguidas del seguido sobre `i` sin que `i` le devolviera
   *  ninguna. Se reinicia al llegar a `dominacionBajas` y al morir a manos
   *  de `i`. */
  dominioSobre: Int32Array

  /** ¿Ya se llevó alguien la primera baja de la partida? */
  primeraSangreTomada: boolean

  /** Racha de la vida actual del seguido, y hasta qué escalón ya cobró. */
  racha: number
  /** Andanada de multikill: cuántas bajas lleva y cuándo fue la última. */
  killsEnRafaga: number
  ultimaKillS: number

  /** Segundos que lleva vivo el seguido en su vida actual, y bajas hechas
   *  en ella. Las dos alimentan "sin morir", que ahora se resuelve durante
   *  la partida y no al final. */
  tiempoVivoS: number
  killsEnVidaActual: number
  /** Ya se cobró "sin morir" en esta vida: no se paga dos veces por seguir
   *  vivo. */
  supervivenciaOtorgada: boolean

  /** Totales de la partida. */
  killsDelSeguido: number
  muertesDelSeguido: number
  finalizado: boolean
}

/**
 * Crea el tracker. Dimensiona todos sus buffers acá y nunca más: a partir
 * de este punto ninguna ruta asigna.
 */
export function createMedalTracker(
  mode: MatchMode,
  participantCount: number,
  seguidoId: number = PLAYER_ID,
  tuning: MedalTuning = MEDALLAS_TUNING,
): MedalTrackerState {
  const n = Math.max(1, Math.floor(participantCount))

  // ¿Hay al menos un compañero? En FFA nunca. De esto dependen clutch y
  // salvada, las dos medallas que hablan de equipo.
  const equipoSeguido = teamForParticipant(mode, seguidoId)
  let companeros = 0
  for (let i = 0; i < n; i++) {
    if (i !== seguidoId && teamForParticipant(mode, i) === equipoSeguido) companeros++
  }

  const ultimoDanoAAliadoS = new Float64Array(n)
  ultimoDanoAAliadoS.fill(-Infinity)
  const ultimaMuertePorS = new Float64Array(n)
  ultimaMuertePorS.fill(-Infinity)
  const ultimoDanoRecibidoDeS = new Float64Array(n)
  ultimoDanoRecibidoDeS.fill(-Infinity)
  const vivo = new Uint8Array(n)
  vivo.fill(1)

  return {
    mode,
    participantCount: n,
    seguidoId,
    tieneCompaneros: companeros > 0,

    avisos: createRingPool<MedalAward>(tuning.avisosMaximos, () => ({
      active: false,
      age: 0,
      seq: -1,
      medalId: -1,
      tiempoS: 0,
    })),
    nextSeq: 0,

    conteo: new Int32Array(MEDALLAS_TOTALES),
    vivo,
    ultimoDanoAAliadoS,
    ultimaMuertePorS,
    ultimoDanoRecibidoDeS,
    dominioSobre: new Int32Array(n),

    primeraSangreTomada: false,
    racha: 0,
    killsEnRafaga: 0,
    ultimaKillS: -Infinity,
    tiempoVivoS: 0,
    killsEnVidaActual: 0,
    supervivenciaOtorgada: false,
    killsDelSeguido: 0,
    muertesDelSeguido: 0,
    finalizado: false,
  }
}

/** ¿`otro` es compañero del seguido (y no el seguido mismo)? Rechaza ids
 *  fuera de rango: sin ese guard, en TDM un id inventado igual caería en un
 *  equipo por paridad y contaría como compañero de alguien. */
function esCompanero(state: MedalTrackerState, otro: number): boolean {
  if (otro < 0 || otro >= state.participantCount) return false
  if (otro === state.seguidoId) return false
  return teamForParticipant(state.mode, otro) === teamForParticipant(state.mode, state.seguidoId)
}

/** Otorga una medalla: suma al conteo y empuja el aviso al anillo. Cero
 *  asignaciones -- escribe sobre un slot que ya existía. */
function otorgar(state: MedalTrackerState, medalId: MedalId, tiempoS: number): void {
  state.conteo[medalId] += 1
  const slot = nextPoolSlot(state.avisos)
  slot.active = true
  slot.age = 0
  slot.seq = state.nextSeq++
  slot.medalId = medalId
  slot.tiempoS = tiempoS
}

/**
 * Todo lo que el detector necesita saber de una baja. Es un struct que el
 * llamador crea UNA vez (`createKillContext`) y reescribe campo por campo
 * antes de cada llamada -- nunca un objeto literal nuevo por baja, que sería
 * una asignación por evento de combate dentro del camino de frame. Es el
 * mismo trato que `BotWorld` tiene con game.ts.
 *
 * Existe como struct y no como siete parámetros sueltos porque siete
 * parámetros posicionales del mismo tipo (tres números seguidos, dos
 * booleanos) es una trampa: invertir dos en el sitio de llamada compila
 * perfecto y rompe la calibración en silencio.
 */
export interface KillContext {
  killerId: number
  victimId: number
  headshot: boolean
  /** Metros entre el tirador y el impacto que remató. */
  distanciaM: number
  /** Balas que quedaron en el cargador DESPUÉS del disparo que remató. */
  balasRestantes: number
  /** Vida del que mató, en el instante de la baja (0..100). */
  vidaDelKiller: number
  /** Segundo de partida (MatchState.elapsedS). */
  tiempoS: number
}

export function createKillContext(): KillContext {
  return {
    killerId: -1,
    victimId: -1,
    headshot: false,
    distanciaM: 0,
    balasRestantes: -1,
    vidaDelKiller: 100,
    tiempoS: 0,
  }
}

/**
 * Registra una baja. Se llama para TODAS las bajas de la partida, no sólo
 * las del jugador: "primera sangre" necesita saber si alguien se le
 * adelantó, y venganza y dominación necesitan saber quién mató al seguido.
 *
 * Los campos que describen el disparo (`distanciaM`, `balasRestantes`,
 * `vidaDelKiller`) sólo se leen cuando el que mató es el seguido, así que
 * un llamador que registre bajas de bot contra bot puede dejarlos como
 * estén.
 */
export function registrarKillMedallas(
  state: MedalTrackerState,
  ctx: KillContext,
  tuning: MedalTuning = MEDALLAS_TUNING,
): void {
  if (state.finalizado) return
  const killerId = ctx.killerId
  const victimId = ctx.victimId
  const tiempoS = ctx.tiempoS
  if (killerId < 0 || killerId >= state.participantCount) return
  if (victimId < 0 || victimId >= state.participantCount) return

  const esDelSeguido = killerId === state.seguidoId
  const murioElSeguido = victimId === state.seguidoId

  // --- estado de vida, primero: todo lo de abajo lo lee ---
  state.vivo[victimId] = 0

  // --- memoria de quién le hizo qué al seguido ---
  if (murioElSeguido) {
    state.muertesDelSeguido += 1
    state.tiempoVivoS = 0
    state.killsEnVidaActual = 0
    state.supervivenciaOtorgada = false
    state.racha = 0
    state.killsEnRafaga = 0
    state.ultimaKillS = -Infinity
    state.ultimaMuertePorS[killerId] = tiempoS
    // Te devolvió una: la cuenta de dominación sobre él vuelve a cero.
    state.dominioSobre[killerId] = 0
  }

  // --- medallas del seguido ---
  if (esDelSeguido) {
    state.killsDelSeguido += 1

    // Primera sangre: la primerísima baja de la partida, de quien sea.
    if (!state.primeraSangreTomada) otorgar(state, MEDALLA.primeraSangre, tiempoS)

    // Andanada: cada escalón se cobra UNA vez, con igualdad exacta. Una
    // andanada de cinco paga doble + triple + masacre y nada más -- la
    // quinta y la sexta baja no vuelven a pagar masacre, que es lo que
    // convertiría una racha caliente en una lluvia de iconos.
    if (tiempoS - state.ultimaKillS <= tuning.ventanaMultikillS) state.killsEnRafaga += 1
    else state.killsEnRafaga = 1
    state.ultimaKillS = tiempoS

    if (state.killsEnRafaga === 2) otorgar(state, MEDALLA.dobleBaja, tiempoS)
    else if (state.killsEnRafaga === 3) otorgar(state, MEDALLA.tripleBaja, tiempoS)
    else if (state.killsEnRafaga === 4) otorgar(state, MEDALLA.masacre, tiempoS)

    // Racha de vida. Igualdad exacta por el mismo motivo: una racha de 12
    // paga el escalón de 5 y el de 10, no ocho medallas.
    state.racha += 1
    if (state.racha === tuning.rachaBaja) otorgar(state, MEDALLA.rachaDe5, tiempoS)
    else if (state.racha === tuning.rachaAlta) otorgar(state, MEDALLA.rachaDe10, tiempoS)

    if (ctx.headshot) otorgar(state, MEDALLA.headshot, tiempoS)

    // Las dos son excluyentes por construcción (un tiro no puede ser largo
    // y a quemarropa), así que el `else if` no es una optimización sino la
    // forma de decir que son las dos colas de la MISMA distribución.
    if (Number.isFinite(ctx.distanciaM)) {
      if (ctx.distanciaM >= tuning.distanciaTiroLargoM) otorgar(state, MEDALLA.tiroLargo, tiempoS)
      else if (ctx.distanciaM <= tuning.distanciaQuemarropaM) otorgar(state, MEDALLA.aQuemarropa, tiempoS)
    }

    // Última bala: el cargador quedó en cero con el disparo que remató.
    if (ctx.balasRestantes === 0) otorgar(state, MEDALLA.ultimaBala, tiempoS)

    // Venganza: te mató hace poco y se la cobraste. Se consume la deuda
    // para que la misma muerte no pague dos veces.
    if (tiempoS - state.ultimaMuertePorS[victimId] <= tuning.ventanaVenganzaS) {
      otorgar(state, MEDALLA.venganza, tiempoS)
      state.ultimaMuertePorS[victimId] = -Infinity
    }

    // Salvada: el que cayó estaba castigando a un compañero hace nada.
    if (tiempoS - state.ultimoDanoAAliadoS[victimId] <= tuning.ventanaSalvadaS) {
      otorgar(state, MEDALLA.salvada, tiempoS)
      state.ultimoDanoAAliadoS[victimId] = -Infinity
    }

    // Dominación: se reinicia al cobrarla, así que seis seguidas sobre el
    // mismo rival pagan dos.
    state.dominioSobre[victimId] += 1
    if (state.dominioSobre[victimId] >= tuning.dominacionBajas) {
      otorgar(state, MEDALLA.dominacion, tiempoS)
      state.dominioSobre[victimId] = 0
    }

    // Clutch: diste vuelta un duelo que venías perdiendo -- vida en rojo y
    // el que cayó es el mismo que te venía pegando hace un instante. Se
    // consume la memoria para que no pague de nuevo con el próximo rival
    // que mates arrastrando la misma vida baja.
    if (
      ctx.vidaDelKiller <= tuning.clutchVidaMaxima &&
      tiempoS - state.ultimoDanoRecibidoDeS[victimId] <= tuning.ventanaClutchS
    ) {
      otorgar(state, MEDALLA.clutch, tiempoS)
      state.ultimoDanoRecibidoDeS[victimId] = -Infinity
    }

    state.killsEnVidaActual += 1
  }

  // La primera baja de la partida ya está tomada, la haya hecho quien la
  // haya hecho. Se marca DESPUÉS del bloque de arriba para que la propia
  // baja del seguido pueda cobrarla.
  state.primeraSangreTomada = true
}

/**
 * Registra daño de `shooterId` sobre `victimId`. Corre con CADA impacto de
 * la partida -- muchos por segundo con nueve participantes -- así que
 * descarta lo que no le sirve en las primeras líneas y no hace más que
 * escribir un número en un array tipado.
 *
 * Sólo le interesan dos casos, y son los dos duelos que el jugador
 * recuerda:
 * - le pegaron a un COMPAÑERO -> habilita "salvada" si matás al agresor;
 * - le pegaron AL SEGUIDO -> habilita "clutch" si das vuelta ese duelo.
 */
export function registrarDanoMedallas(
  state: MedalTrackerState,
  shooterId: number,
  victimId: number,
  tiempoS: number,
): void {
  if (state.finalizado) return
  if (shooterId < 0 || shooterId >= state.participantCount) return
  if (victimId === state.seguidoId) {
    state.ultimoDanoRecibidoDeS[shooterId] = tiempoS
    return
  }
  if (!esCompanero(state, victimId)) return
  state.ultimoDanoAAliadoS[shooterId] = tiempoS
}

/** Un participante volvió a aparecer. Para el seguido, arranca una vida
 *  nueva: el reloj de supervivencia vuelve a cero. */
export function registrarReaparicionMedallas(state: MedalTrackerState, participantId: number): void {
  if (state.finalizado) return
  if (participantId < 0 || participantId >= state.participantCount) return
  state.vivo[participantId] = 1
  if (participantId === state.seguidoId) {
    // Vida nueva: el reloj de supervivencia y su cuenta de bajas arrancan
    // de cero, y "sin morir" vuelve a estar disponible.
    state.tiempoVivoS = 0
    state.killsEnVidaActual = 0
    state.supervivenciaOtorgada = false
  }
}

/**
 * Un frame: envejece los avisos y hace correr el reloj de supervivencia del
 * seguido. Se llama una vez por frame, como `stepKillfeed`.
 *
 * Es el único lugar donde una medalla nace del PASO DEL TIEMPO y no de un
 * evento de combate. "Sin morir" salta en el instante exacto en que el
 * jugador cruza el minuto vivo con trabajo hecho -- mientras sigue jugando,
 * no en la pantalla de resumen. Cero asignaciones: sumas sobre escalares.
 *
 * `tiempoS` es el reloj de partida (`MatchState.elapsedS`), y sólo se usa
 * para sellar el aviso.
 */
export function stepMedallas(
  state: MedalTrackerState,
  dt: number,
  tiempoS: number,
  tuning: MedalTuning = MEDALLAS_TUNING,
): void {
  const items = state.avisos.items
  for (let i = 0; i < items.length; i++) {
    const aviso = items[i]
    if (!aviso.active) continue
    aviso.age += dt
    if (aviso.age >= tuning.avisoDuracionS) aviso.active = false
  }

  if (state.finalizado) return
  if (state.vivo[state.seguidoId] !== 1) return

  state.tiempoVivoS += dt
  if (
    !state.supervivenciaOtorgada &&
    state.tiempoVivoS >= tuning.supervivenciaS &&
    state.killsEnVidaActual >= tuning.supervivenciaBajasMinimas
  ) {
    otorgar(state, MEDALLA.sinMorir, tiempoS)
    state.supervivenciaOtorgada = true
  }
}

/**
 * Cierra el tracker: a partir de acá ningún evento tardío puede sumar una
 * medalla más. Idempotente.
 *
 * No otorga nada. Es a propósito y es el resultado de una decisión que
 * cambió durante la calibración: "sin morir" era la única medalla que se
 * resolvía al terminar, y al redefinirla como "sobrevivir un minuto
 * peleando" (ver MedalTuning.supervivenciaS) pasó a resolverse durante la
 * partida como todas las demás. El set quedó entonces sin ninguna
 * excepción: **las quince pagan en el momento del acto**, que es la única
 * propiedad que distingue a esta capa del resto de la progresión.
 */
export function finalizarMedallas(state: MedalTrackerState): void {
  state.finalizado = true
}

/**
 * Avisos activos, más nuevo primero. Asigna un array nuevo a propósito: lo
 * consume la UI de React sondeando un par de veces por segundo, fuera del
 * camino de frame -- mismo caso y misma justificación que
 * `listActiveKillsNewestFirst` en match/killfeed.ts.
 */
export function listActiveAwardsNewestFirst(state: MedalTrackerState): MedalAward[] {
  const activos = state.avisos.items.filter((a) => a.active)
  activos.sort((a, b) => b.seq - a.seq)
  return activos
}

/**
 * Conteo de la partida como `slug -> veces`, listo para sumarse al
 * acumulado histórico del guardado (`progression/medals.ts sumarTallies`).
 * Se llama una vez, al terminar; asigna.
 */
export function tallyDeMedallas(state: MedalTrackerState): MedalTally {
  const out: Record<string, number> = {}
  for (const def of CATALOGO_MEDALLAS) {
    const veces = state.conteo[def.id]
    if (veces > 0) out[def.slug] = veces
  }
  return out
}

/** Cuántas veces se ganó una medalla concreta en esta partida. Barato, sin
 *  construir el tally entero -- lo usa el HUD y la medición. */
export function vecesGanada(state: MedalTrackerState, medalId: MedalId): number {
  return state.conteo[medalId] ?? 0
}
