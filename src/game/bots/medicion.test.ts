/**
 * Pruebas del BANCO de medición, no de los bots.
 *
 * Un banco que no puede dar un mal resultado no mide nada. Este archivo
 * rompe el apuntado y el movimiento A PROPÓSITO y exige que los números se
 * muevan en la dirección correcta. Existe por un error real: la primera
 * versión medía la precisión con el valor de retorno de `stepBotCombat`, que
 * es la CANTIDAD DE DISPAROS y no el daño, así que daba precisión 1.000 con
 * cualquier apuntado -- incluso con un cono de error de 25° permanente. La
 * prueba de abajo es la que lo habría cazado.
 *
 * Los sabotajes se hacen sobre EXPERTO (rank 1) y no sobre Fácil: un bot
 * experto tiene una precisión base alta y flanquea de verdad, así que
 * romperle el apuntado o el strafe produce una caída inequívoca. Fácil ya
 * apunta mal y se planta por diseño, y contra ese piso bajo los sabotajes no
 * se leen.
 */

import { describe, expect, it } from 'vitest'
import { medirDuelo, rangosSeSolapan, resumir, type Resumen } from '@/game/bots/medicion'
import { BOTS } from '@/game/bots/tuning'
import { EXPERTO } from '@/game/bots/difficulty'

const SEMILLAS = [1, 2, 3, 4, 5, 6]

function tanda(rank: number): ReturnType<typeof medirDuelo>[] {
  return SEMILLAS.map((s) =>
    medirDuelo({ rank, seed: s * 7919, distanciaM: 16, duracionS: 12, desvioInicialDeg: 30 }),
  )
}

describe('el banco de medición puede fallar', () => {
  it('la precisión se DERRUMBA si se agranda el cono de error', () => {
    const control = resumir(tanda(1).map((m) => m.precision))

    const conoOrig = EXPERTO.errorConeRad
    const steadyOrig = EXPERTO.aimSteadyRad
    const reacOrig = EXPERTO.reactionTimeS
    EXPERTO.errorConeRad = (25 * Math.PI) / 180
    EXPERTO.aimSteadyRad = (25 * Math.PI) / 180
    // Tiempo de reacción larguísimo = el cono nunca se asienta, así que el
    // bot dispara con 25° de error toda la corrida.
    EXPERTO.reactionTimeS = 999
    const roto = resumir(tanda(1).map((m) => m.precision))
    EXPERTO.errorConeRad = conoOrig
    EXPERTO.aimSteadyRad = steadyOrig
    EXPERTO.reactionTimeS = reacOrig

    // No alcanza con "la mediana bajó": los rangos tienen que estar
    // SEPARADOS, que es la barra que este proyecto le exige a cualquier
    // comparación antes/después.
    expect(roto.mediana).toBeLessThan(control.mediana)
    expect(rangosSeSolapan(control, roto)).toBe(false)
  })

  it('el lateral se va a ~0 si se apaga el strafe', () => {
    // Rank 1: un bot experto flanquea (intención 'rodear'), así que su
    // lateral base es alto. Fácil se plantaría y este test no mediría nada.
    const control = resumir(tanda(1).map((m) => m.lateralMPorS))

    const radioOrig = BOTS.engageStrafeRadiusM
    BOTS.engageStrafeRadiusM = 0
    const quieto = resumir(tanda(1).map((m) => m.lateralMPorS))
    BOTS.engageStrafeRadiusM = radioOrig

    expect(quieto.max).toBeLessThan(0.5)
    expect(control.min).toBeGreaterThan(1.0)
  })

  it('sin visión no hay disparos, y el banco lo reporta en vez de inventar un número', () => {
    const visionOrig = BOTS.visionRangeM
    BOTS.visionRangeM = 0.1
    const ciego = tanda(1)
    BOTS.visionRangeM = visionOrig

    for (const m of ciego) {
      expect(m.disparos).toBe(0)
      expect(m.ttffS).toBeNull()
      expect(Number.isNaN(m.precision)).toBe(true)
    }
  })

  it('un impacto contra la pared no cuenta como acierto', () => {
    // El blanco vive en owner=99. Si el bot le pega a una caja de la arena,
    // shotResult.hit es true pero owner no es 99. Con un cono enorme la
    // mayoría de los disparos se van a la geometría, así que la precisión
    // tiene que quedar MUY por debajo de 1 -- si contáramos las paredes,
    // rondaría 1.
    const conoOrig = EXPERTO.errorConeRad
    const steadyOrig = EXPERTO.aimSteadyRad
    const reacOrig = EXPERTO.reactionTimeS
    EXPERTO.errorConeRad = (25 * Math.PI) / 180
    EXPERTO.aimSteadyRad = (25 * Math.PI) / 180
    EXPERTO.reactionTimeS = 999
    const roto = resumir(tanda(1).map((m) => m.precision))
    EXPERTO.errorConeRad = conoOrig
    EXPERTO.aimSteadyRad = steadyOrig
    EXPERTO.reactionTimeS = reacOrig

    expect(roto.max).toBeLessThan(0.2)
  })
})

/**
 * El entregable de la tarea, anclado como prueba: la dificultad tiene que
 * escalar de verdad en REACCIÓN y PUNTERÍA, con rangos SEPARADOS entre los
 * extremos (la barra de AGENTS.md: si se solapan, no mejoró). Y el zigzag
 * tiene que estar muerto: los tramos bajos se plantan.
 *
 * Números MEDIDOS (duelo de 12 s a 16 m, 6 semillas, mediana [min..max]),
 * sistema viejo -> nuevo:
 *
 *   ttff s      viejo: 0.000 en TODOS los tramos (no había reacción)
 *               nuevo: Fácil 0.602 -> Experto 0.063, sin solaparse
 *   precisión   viejo: ~0.079 plano en todos los tramos
 *               nuevo: Fácil 0.100 [.033..150] -> Experto 0.183 [.159..238]
 *   lateral m/s viejo: 4.863 en todos (zigzag, 97% de la caminata)
 *               nuevo: Fácil/Normal 0.000 (se plantan) -> Experto ~1.9
 */
describe('la dificultad escala de verdad (entregable)', () => {
  it('el tiempo hasta el primer disparo baja de Fácil a Experto, con rangos separados', () => {
    const facil = resumir(tanda(0).map((m) => (m.ttffS === null ? NaN : m.ttffS)))
    const experto = resumir(tanda(1).map((m) => (m.ttffS === null ? NaN : m.ttffS)))
    // Experto reacciona MÁS RÁPIDO (ttff menor) y sin solape con Fácil.
    expect(experto.mediana).toBeLessThan(facil.mediana)
    expect(rangosSeSolapan(facil, experto)).toBe(false)
  })

  it('el ttff es monótono a lo largo de la escalera', () => {
    let prev = Infinity
    for (const rank of [0, 1 / 3, 2 / 3, 1]) {
      const r = resumir(tanda(rank).map((m) => (m.ttffS === null ? NaN : m.ttffS)))
      expect(r.mediana).toBeLessThanOrEqual(prev)
      prev = r.mediana
    }
  })

  it('la precisión de Experto supera a la de Fácil con rangos separados', () => {
    const facil = resumir(tanda(0).map((m) => m.precision))
    const experto = resumir(tanda(1).map((m) => m.precision))
    expect(experto.mediana).toBeGreaterThan(facil.mediana)
    expect(rangosSeSolapan(facil, experto)).toBe(false)
  })

  it('el zigzag murió: Fácil y Normal no se mueven de lado, y ninguno llega al temblor viejo', () => {
    // El sistema viejo daba 4.863 m/s de lateral en TODOS los tramos. Ahora
    // los tramos bajos se plantan (0) y hasta el más agresivo queda muy por
    // debajo de ese temblor.
    const facil = resumir(tanda(0).map((m) => m.lateralMPorS))
    const normal = resumir(tanda(1 / 3).map((m) => m.lateralMPorS))
    const experto = resumir(tanda(1).map((m) => m.lateralMPorS))
    expect(facil.max).toBeLessThan(0.1)
    expect(normal.max).toBeLessThan(0.1)
    // El experto SÍ se mueve (flanquea), pero con intención: lejísimos del
    // 4.863 del zigzag viejo.
    const VIEJO_ZIGZAG = 4.5
    expect(experto.max).toBeLessThan(VIEJO_ZIGZAG)
    expect(experto.min).toBeGreaterThan(0.5)
  })

  it('cuando el tramo agresivo se mueve, lo hace comprometido: pocos cambios de sentido', () => {
    // El zigzag viejo daba ~20 inversiones en 12 s. Un flanqueo con intención
    // da un puñado.
    const cambios: Resumen = resumir(tanda(1).map((m) => m.cambiosDeSentido))
    expect(cambios.max).toBeLessThanOrEqual(8)
  })
})
