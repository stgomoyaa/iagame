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
 */

import { describe, expect, it } from 'vitest'
import { medirDuelo, rangosSeSolapan, resumir } from '@/game/bots/medicion'
import { BOTS } from '@/game/bots/tuning'
import { DIFFICULTY_LOWEST } from '@/game/bots/difficulty'

const SEMILLAS = [1, 2, 3, 4, 5, 6]

function tanda(): ReturnType<typeof medirDuelo>[] {
  return SEMILLAS.map((s) =>
    medirDuelo({ rank: 0, seed: s * 7919, distanciaM: 16, duracionS: 12, desvioInicialDeg: 30 }),
  )
}

describe('el banco de medición puede fallar', () => {
  it('la precisión se DERRUMBA si se agranda el cono de error', () => {
    const control = resumir(tanda().map((m) => m.precision))

    const conoOrig = DIFFICULTY_LOWEST.errorConeRad
    const reacOrig = DIFFICULTY_LOWEST.reactionTimeS
    DIFFICULTY_LOWEST.errorConeRad = (25 * Math.PI) / 180
    // Tiempo de reacción larguísimo = el cono nunca se cierra, así que el
    // bot dispara con 25° de error toda la corrida.
    DIFFICULTY_LOWEST.reactionTimeS = 999
    const roto = resumir(tanda().map((m) => m.precision))
    DIFFICULTY_LOWEST.errorConeRad = conoOrig
    DIFFICULTY_LOWEST.reactionTimeS = reacOrig

    // No alcanza con "la mediana bajó": los rangos tienen que estar
    // SEPARADOS, que es la barra que este proyecto le exige a cualquier
    // comparación antes/después.
    expect(roto.mediana).toBeLessThan(control.mediana)
    expect(rangosSeSolapan(control, roto)).toBe(false)
  })

  it('el lateral se va a ~0 si se apaga el strafe', () => {
    const control = resumir(tanda().map((m) => m.lateralMPorS))

    const radioOrig = BOTS.engageStrafeRadiusM
    BOTS.engageStrafeRadiusM = 0
    const quieto = resumir(tanda().map((m) => m.lateralMPorS))
    BOTS.engageStrafeRadiusM = radioOrig

    expect(quieto.max).toBeLessThan(0.5)
    expect(control.min).toBeGreaterThan(1.0)
  })

  it('sin visión no hay disparos, y el banco lo reporta en vez de inventar un número', () => {
    const visionOrig = BOTS.visionRangeM
    BOTS.visionRangeM = 0.1
    const ciego = tanda()
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
    const conoOrig = DIFFICULTY_LOWEST.errorConeRad
    const reacOrig = DIFFICULTY_LOWEST.reactionTimeS
    DIFFICULTY_LOWEST.errorConeRad = (25 * Math.PI) / 180
    DIFFICULTY_LOWEST.reactionTimeS = 999
    const roto = resumir(tanda().map((m) => m.precision))
    DIFFICULTY_LOWEST.errorConeRad = conoOrig
    DIFFICULTY_LOWEST.reactionTimeS = reacOrig

    expect(roto.max).toBeLessThan(0.2)
  })
})
