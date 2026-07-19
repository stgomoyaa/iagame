/**
 * Matemática de RR (sección 9 del spec):
 *
 * ```
 * rrChange = base(victoria +18, derrota -16) + escala(delta)
 * rrChange = clamp(rrChange, victoria [5,35], derrota [-30,-5])
 * ```
 *
 * Promoción al llegar a 100 RR, descenso al bajar de 0, con un colchón de 10
 * RR en el piso de cada división "para que un mal partido no te haga bajar
 * de tier inmediatamente".
 *
 * Los clamps del spec no son un detalle defensivo, son la garantía de
 * sensación que sostiene toda la escalera, y conviene leerlos por lo que
 * prohíben:
 *
 * - **Ganar nunca resta RR.** El piso de victoria es +5. Un jugador que gana
 *   y ve bajar su barra deja de creer en el sistema en esa misma pantalla,
 *   por más defendible que sea la aritmética que lo produjo.
 * - **Perder nunca suma RR.** El techo de derrota es -5. Perder tiene que
 *   costar algo o el rango deja de significar nada.
 * - **Ningún partido solo te mueve más de un tercio de división.** El techo
 *   de +35 y el piso de -30 acotan lo que una partida puede hacer, así que
 *   la escalera responde a una racha y no a un golpe de suerte.
 *
 * El colchón se guarda como estado (`cushion`) y no se deriva del RR, porque
 * es memoria: representa "cuánto crédito te queda en el piso de esta
 * división". Se gasta con las derrotas que te dejarían bajo 0 y se repone
 * entero apenas volvés a sumar RR.
 *
 * La regla concreta, que es más fuerte que "10 RR de margen": **si entrás a
 * la partida con RR > 0, esa partida no puede descenderte.** Te deja apoyado
 * en 0 y sin colchón, y recién la derrota siguiente baja de división. Con un
 * colchón que fuera sólo un presupuesto de 10 RR, una derrota de -30 desde 8
 * RR lo atravesaba y descendía de una sola partida, que es justo lo que el
 * spec pide evitar.
 */

import { RANK_MAX, RANK_MIN, RR_MAXIMO } from '@/game/progression/ranks'

/** Los números de RR en un objeto mutable, mismo patrón que match/tuning.ts
 *  y bots/tuning.ts: son valores de tuneo, no constantes del dominio, y
 *  poder barrerlos desde la simulación es justamente cómo se eligieron. */
export interface RrTuning {
  baseVictoria: number
  baseDerrota: number
  minVictoria: number
  maxVictoria: number
  minDerrota: number
  maxDerrota: number
  porPuntoDeDelta: number
  escalaMaxima: number
  colchon: number
  rrTrasDescenso: number
}

export const RR: RrTuning = {
  /** Base por victoria y por derrota, tal cual el spec. */
  baseVictoria: 18,
  baseDerrota: -16,

  /** Clamp final por resultado, tal cual el spec. */
  minVictoria: 5,
  maxVictoria: 35,
  minDerrota: -30,
  maxDerrota: -5,

  /**
   * Cuánto RR aporta cada punto de `delta` (combatScore - expected).
   *
   * Es el número que decide si la escalera converge o si todo el mundo va a
   * la deriva. Con base +18/-16, un jugador en un enfrentamiento perfectamente
   * parejo (50% de victorias, delta 0) ganaría +1 RR por partida en promedio
   * y subiría para siempre. Lo que frena esa deriva es este acoplamiento: al
   * subir por encima de tu nivel real los bots se endurecen, el combatScore
   * cae bajo lo esperado y el término de escala se vuelve negativo hasta
   * cancelar el +1. Cuanto más alto este valor, más pegado queda el rango
   * final a la habilidad real. Verificado en simulación (simulate.ts): con
   * 0.45 los niveles de habilidad simulados se estacionan cerca de su rango
   * teórico en vez de irse todos a Radiante o quedarse trabados en Hierro.
   */
  porPuntoDeDelta: 0.45,

  /** Tope del término de escala, en RR. Acota lo que una sola actuación
   *  puede aportar antes de que actúen los clamps de arriba. */
  escalaMaxima: 17,

  /** Colchón, en RR, en el piso de cada división. */
  colchon: 10,

  /**
   * RR con el que arrancás la división de abajo tras descender. No es 100
   * (quedarías al borde de re-promocionar con una sola victoria) ni 0
   * (quedarías al borde de volver a caer con una sola derrota): 75 deja
   * margen real en las dos direcciones.
   */
  rrTrasDescenso: 75,
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * Término de escala: cuánto suma o resta la actuación por encima de la base
 * del resultado. Lineal en `delta` y acotado, sin curvas: cualquier
 * no linealidad acá haría imposible que un jugador prediga qué le va a dar
 * una buena partida, y poder predecirlo es justo lo que hace que el sistema
 * se sienta justo.
 */
export function escalaDeDelta(delta: number): number {
  if (!Number.isFinite(delta)) return 0
  return clamp(delta * RR.porPuntoDeDelta, -RR.escalaMaxima, RR.escalaMaxima)
}

/**
 * RR que otorga una partida. Es la fórmula del spec, entera, y no toca
 * estado: dado un resultado y un delta siempre devuelve lo mismo.
 */
export function rrChange(win: boolean, delta: number): number {
  const bruto = (win ? RR.baseVictoria : RR.baseDerrota) + escalaDeDelta(delta)
  return Math.round(
    win ? clamp(bruto, RR.minVictoria, RR.maxVictoria) : clamp(bruto, RR.minDerrota, RR.maxDerrota),
  )
}

/** Posición del jugador en la escalera. Es lo que se persiste. */
export interface RankState {
  /** Índice plano 0..24 (ranks.ts). */
  rank: number
  /** 0..100 dentro del rango. */
  rr: number
  /** RR de colchón que queda en el piso de esta división, 0..RR.colchon. */
  cushion: number
}

export function createRankState(rank: number, rr = 0): RankState {
  return {
    rank: clamp(Math.floor(rank), RANK_MIN, RANK_MAX),
    rr: clamp(Math.floor(rr), 0, RR_MAXIMO),
    cushion: RR.colchon,
  }
}

/** Qué pasó con el rango al aplicar una partida. Lo consume la UI para saber
 *  si tiene que hacer la ceremonia de ascenso (sección 10 del spec). */
export type RankMovement = 'ninguno' | 'ascenso' | 'descenso'

export interface RankOutcome {
  /** Estado nuevo. `applyRr` no muta el que recibe. */
  state: RankState
  /** RR que se sumó o restó, ya clampeado. */
  change: number
  movement: RankMovement
  /** Rango del que se venía, para la ceremonia. */
  rankAnterior: number
  /** Colchón que se consumió en esta partida, si se consumió. Permite a la
   *  UI decir "te salvó el colchón" en vez de mostrar un -0 inexplicable. */
  colchonConsumido: number
}

/**
 * Aplica un cambio de RR resolviendo promoción, descenso y colchón.
 *
 * El orden importa y es este:
 *
 * 1. Si el RR resultante supera 100 y hay rango por encima, promociona y el
 *    sobrante arranca la división nueva. Un ascenso repone el colchón: la
 *    división nueva se estrena con crédito entero.
 * 2. Si el RR resultante queda bajo 0, primero se gasta el colchón. Mientras
 *    quede colchón el jugador se queda en 0 RR y no baja de división, que es
 *    exactamente lo que pide el spec: un mal partido no te saca del tier.
 * 3. Sólo cuando el colchón se agota hay descenso, y el jugador aparece en
 *    `RR.rrTrasDescenso` de la división de abajo con el colchón repuesto.
 * 4. En Hierro 1 no hay a dónde bajar: el RR se apoya en 0 y ahí se queda.
 *    En Radiante no hay a dónde subir: el RR se apoya en 100.
 */
export function applyRr(state: RankState, change: number): RankOutcome {
  const rankAnterior = state.rank
  const bruto = state.rr + change

  // `>=` y no `>`: llegar a 100 RR promociona. El spec dice "al superar 100
  // RR", pero con `>` un jugador puede quedarse sentado en "100 / 100 RR"
  // sin ascender hasta la próxima victoria, y una barra llena que no hace
  // nada se lee como un sistema roto. Con `>=`, el RR dentro de una división
  // vive en 0..99 y 100 nunca es un estado en el que se descansa. Verificado
  // jugando: una victoria de +5 desde 95 caía justo en ese estado.
  if (bruto >= RR_MAXIMO) {
    if (state.rank >= RANK_MAX) {
      return {
        state: { rank: state.rank, rr: RR_MAXIMO, cushion: RR.colchon },
        change,
        movement: 'ninguno',
        rankAnterior,
        colchonConsumido: 0,
      }
    }
    return {
      state: {
        rank: state.rank + 1,
        rr: clamp(bruto - RR_MAXIMO, 0, RR_MAXIMO),
        cushion: RR.colchon,
      },
      change,
      movement: 'ascenso',
      rankAnterior,
      colchonConsumido: 0,
    }
  }

  if (bruto < 0) {
    const deficit = -bruto

    if (state.rank <= RANK_MIN) {
      // Piso absoluto de la escalera: no hay descenso posible, así que el
      // colchón tampoco tiene sentido gastarlo acá.
      return {
        state: { rank: state.rank, rr: 0, cushion: RR.colchon },
        change,
        movement: 'ninguno',
        rankAnterior,
        colchonConsumido: 0,
      }
    }

    if (state.rr > 0) {
      // Entraste a la partida con RR en el banco: ESTE partido no puede
      // descenderte, sin importar lo grande que sea el déficit. Es la
      // lectura literal del spec ("un mal partido no te hace bajar de tier
      // inmediatamente") y la razón de que el colchón exista.
      //
      // Sin esta rama, una derrota de -30 desde 8 RR atravesaba los 10 de
      // colchón y descendía de una, que es exactamente lo que el colchón
      // tenía que impedir. El déficit que sobra se descarta: la penalización
      // de esa partida es quedarse sin colchón y apoyado en 0, y el descenso
      // queda para la SIGUIENTE derrota.
      const consumido = Math.min(deficit, state.cushion)
      return {
        state: { rank: state.rank, rr: 0, cushion: state.cushion - consumido },
        change,
        movement: 'ninguno',
        rankAnterior,
        colchonConsumido: consumido,
      }
    }

    // Ya venías apoyado en el piso: acá sí se juega el descenso contra lo
    // que quede de colchón.
    if (deficit <= state.cushion) {
      return {
        state: { rank: state.rank, rr: 0, cushion: state.cushion - deficit },
        change,
        movement: 'ninguno',
        rankAnterior,
        colchonConsumido: deficit,
      }
    }

    return {
      state: { rank: state.rank - 1, rr: RR.rrTrasDescenso, cushion: RR.colchon },
      change,
      movement: 'descenso',
      rankAnterior,
      colchonConsumido: state.cushion,
    }
  }

  // Caso normal: el RR se mueve dentro de la división. Sumar RR repone el
  // colchón entero -- el crédito es para "un mal partido", no para una
  // caída sostenida, así que no se acumula deuda entre derrotas separadas
  // por victorias.
  return {
    state: { rank: state.rank, rr: bruto, cushion: change > 0 ? RR.colchon : state.cushion },
    change,
    movement: 'ninguno',
    rankAnterior,
    colchonConsumido: 0,
  }
}
