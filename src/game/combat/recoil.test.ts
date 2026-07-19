import { describe, expect, it } from 'vitest'
import { ARCHETYPES, type ArchetypeId } from '@/game/weapons/archetypes'
import { PITCH_LIMIT } from '@/game/engine/input'
import {
  applyRecoilShot,
  applyRecoilToPitch,
  applyRecoilToYaw,
  createRecoilState,
  indexRecoveryRate,
  resetRecoil,
  stepRecoilRecovery,
  type RecoilState,
} from '@/game/combat/recoil'

const DT = 1 / 128

/** Dispara `count` tiros seguidos (gatillo sostenido, sin recuperación
 *  entre medio) contra `state`. */
function fireShots(state: RecoilState, id: ArchetypeId, count: number): void {
  const archetype = ARCHETYPES[id]
  for (let i = 0; i < count; i++) applyRecoilShot(state, archetype)
}

describe('determinismo: misma secuencia de disparos, mismo desvío, siempre', () => {
  it('dos estados independientes disparando la misma secuencia terminan bit a bit iguales', () => {
    const a = createRecoilState()
    const b = createRecoilState()
    fireShots(a, 'ar-1', 15)
    fireShots(b, 'ar-1', 15)

    expect(a.pitchOffset).toBe(b.pitchOffset)
    expect(a.yawOffset).toBe(b.yawOffset)
    expect(a.shotIndex).toBe(b.shotIndex)
  })

  it('intercalar recuperación (mismos dt) entre disparos también da resultados idénticos en dos corridas', () => {
    const run = (): RecoilState => {
      const state = createRecoilState()
      const archetype = ARCHETYPES['ar-1']
      for (let i = 0; i < 10; i++) {
        applyRecoilShot(state, archetype)
        stepRecoilRecovery(state, archetype, false, DT)
      }
      return state
    }

    const a = run()
    const b = run()
    expect(a).toEqual(b)
  })

  it('secuencias de disparo distintas producen desvíos distintos', () => {
    const a = createRecoilState()
    const b = createRecoilState()
    fireShots(a, 'ar-1', 5)
    fireShots(b, 'ar-1', 10)
    expect(a.pitchOffset).not.toBe(b.pitchOffset)
  })
})

describe('el retroceso acumulado nunca supera PITCH_LIMIT', () => {
  it('un cargador entero de la LMG (el arquetipo de más climb total) no cruza el límite', () => {
    const state = createRecoilState()
    const lmg = ARCHETYPES.lmg
    for (let i = 0; i < lmg.magazine; i++) {
      applyRecoilShot(state, lmg)
      const pitch = applyRecoilToPitch(0, state)
      expect(pitch).toBeLessThanOrEqual(PITCH_LIMIT)
      expect(pitch).toBeGreaterThanOrEqual(-PITCH_LIMIT)
    }
  })

  it('retroceso + input del jugador ya cerca del tope clampea la suma (el patrón solo no llega, pero la suma sí)', () => {
    const state = createRecoilState()
    // Empuja el pitch base casi al límite, como si el jugador ya estuviera
    // mirando casi derecho hacia arriba antes de disparar.
    const playerPitch = PITCH_LIMIT - 0.01
    fireShots(state, 'ar-1', 30)

    const pitch = applyRecoilToPitch(playerPitch, state)
    expect(pitch).toBeLessThanOrEqual(PITCH_LIMIT)
  })

  it('todos los arquetipos, cargador completo: la suma con un pitch de jugador extremo nunca cruza el límite', () => {
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      const archetype = ARCHETYPES[id]
      const state = createRecoilState()
      for (let i = 0; i < archetype.magazine; i++) {
        applyRecoilShot(state, archetype)
        const pitch = applyRecoilToPitch(PITCH_LIMIT, state)
        expect(pitch, id).toBeLessThanOrEqual(PITCH_LIMIT)
        expect(pitch, id).toBeGreaterThanOrEqual(-PITCH_LIMIT)
      }
    }
  })
})

describe('recuperación: vuelve al origen sin pasarse', () => {
  it('con tiempo suficiente, el offset vuelve exactamente a 0, nunca cruza al signo opuesto', () => {
    const state = createRecoilState()
    fireShots(state, 'ar-1', 30)
    expect(state.pitchOffset).toBeGreaterThan(0)

    // Recupera de a pasos chicos: si "se pasara" cruzaría a negativo en
    // algún paso intermedio.
    for (let i = 0; i < 10000; i++) {
      stepRecoilRecovery(state, ARCHETYPES['ar-1'], false, DT)
      expect(state.pitchOffset).toBeGreaterThanOrEqual(0)
      expect(state.yawOffset === 0 || Math.sign(state.yawOffset) !== 0).toBe(true)
    }
    expect(state.pitchOffset).toBe(0)
  })

  it('no recupera mientras se sostiene el gatillo (firing=true)', () => {
    const state = createRecoilState()
    fireShots(state, 'ar-1', 5)
    const before = state.pitchOffset
    for (let i = 0; i < 1000; i++) stepRecoilRecovery(state, ARCHETYPES['ar-1'], true, DT)
    expect(state.pitchOffset).toBe(before)
  })
})

describe('applyRecoilToYaw', () => {
  it('suma el offset de yaw sin clampear (el yaw no tiene tope)', () => {
    const state = createRecoilState()
    state.yawOffset = 5
    expect(applyRecoilToYaw(100, state)).toBe(105)
  })
})

describe('resetRecoil', () => {
  it('vuelve el estado a cero (cargador nuevo / cambio de arma)', () => {
    const state = createRecoilState()
    fireShots(state, 'ar-1', 10)
    resetRecoil(state)
    expect(state).toEqual({ shotIndex: 0, pitchOffset: 0, yawOffset: 0 })
  })
})

describe('el primer disparo de un cargador fresco no tiene retroceso apreciable', () => {
  it('shotIndex 0 da un offset ~0 (recoilOffsetForShot(archetype, 0) parte de progress=0)', () => {
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      const archetype = ARCHETYPES[id]
      const state = createRecoilState()
      applyRecoilShot(state, archetype)
      // Jitter aparte, el primer disparo tiene que quedar muy por debajo
      // del climb total del arma: no es "otro disparo más de la rampa".
      const totalClimb = Math.max(...archetype.recoil.pattern.map(([, y]) => y))
      expect(Math.abs(state.pitchOffset), id).toBeLessThan(Math.max(totalClimb * 0.3, 0.01))
    }
  })

  it('shotIndex 0 da un offset EXACTAMENTE cero, sin jitter: tap-firing tiene que ser preciso al pixel', () => {
    // Más estricto que el test de arriba: no "chico", sino cero exacto. Es
    // la propiedad puntual que pide la sección de retroceso estilo CS — el
    // primer balazo de un cargador fresco no puede tener NINGÚN desvío, ni
    // siquiera el ruido de jitter, o tirar un solo tiro de precisión deja de
    // ser preciso al 100%.
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      const archetype = ARCHETYPES[id]
      const state = createRecoilState()
      applyRecoilShot(state, archetype)
      expect(state.pitchOffset, id).toBe(0)
      expect(state.yawOffset, id).toBe(0)
    }
  })
})

/**
 * BUG (encontrado jugando, no en Vitest): shotIndex nunca decaía con el
 * tiempo, sólo se reseteaba a 0 al crear el arma o al completar una recarga.
 * Vaciar un cargador, esperar diez segundos con el gatillo suelto y volver a
 * disparar daba el retroceso de FIN de cargador en el primer tiro — el
 * patrón quedaba "caliente" para siempre hasta la próxima recarga.
 *
 * Fix: decaimiento CONTINUO de shotIndex mientras no se dispara (nunca un
 * reset por umbral). Es lo que hacen Source/CS de verdad (recovery_time por
 * arma, ~0.3-0.4s para deshacer un cargador entero) y no un simple "resetea
 * a los 1-2 segundos" por varias razones:
 *
 * - Un umbral fijo crea un cantil explotable: spray completo a los 0.99s,
 *   cero a los 1.01s. Se aprende a cronometrar el borde y se siente
 *   arbitrario, no físico.
 * - El decaimiento preserva la disciplina de ráfagas cortas como una
 *   habilidad real: disparar 3, soltar un instante y disparar 3 más tiene
 *   que acumular PARCIALMENTE (eso es lo que un buen jugador administra). Un
 *   reset binario elimina esa habilidad por completo.
 * - Toques espaciados nunca acumulan, que es justo la razón por la que
 *   tirar de a uno es preciso.
 *
 * La tasa de recuperación tiene que ser MUCHO más rápida que la de
 * acumulación: en CS se dispara ~10 balas/seg y se recupera el equivalente
 * a ~75/seg. Si fueran comparables, sprayar saldría gratis y el patrón
 * dejaría de importar (ver indexRecoveryRate() en recoil.ts y el test de
 * la propiedad más abajo).
 */
describe('recuperación continua del índice del patrón (el spray no queda caliente para siempre)', () => {
  it('cargador completo + tiempo de recuperación entero sin disparar: el próximo disparo repite el offset del primero (cero exacto)', () => {
    const archetype = ARCHETYPES['ar-1']
    const state = createRecoilState()
    fireShots(state, 'ar-1', archetype.magazine)
    expect(state.shotIndex).toBe(archetype.magazine)

    stepRecoilRecovery(state, archetype, false, archetype.recoil.indexRecoveryTime)
    // shotIndex mismo, no sólo el offset derivado: con un cargador cuyo
    // patrón mide exactamente lo mismo que el cargador (el caso normal, ver
    // recoilOffsetForShot en archetypes.ts), shotIndex == magazine ya
    // envuelve por módulo a pattern[0] SIN que haya decaído nada — el
    // offset solo daría cero por coincidencia incluso con el bug viejo.
    // Pinnear shotIndex evita ese falso negativo.
    expect(state.shotIndex).toBe(0)

    applyRecoilShot(state, archetype)

    expect(state.pitchOffset).toBe(0)
    expect(state.yawOffset).toBe(0)
  })

  it('reproduce el bug reportado: 20 de 30 balas, pausa larga, el disparo 21 vuelve a dar el offset del primero (no el de fin de cargador)', () => {
    // Escenario exacto de Santiago: jugando encontró que tras vaciar buena
    // parte del cargador y esperar, el siguiente tiro seguía saliendo con
    // retroceso de fin de carga. A diferencia del test de arriba, acá
    // shotIndex=20 NO es múltiplo del largo del patrón (30), así que ni
    // siquiera el wrap por módulo lo disimula: bajo el código viejo (sin
    // decaimiento) esto falla derecho, sin coincidencias.
    const archetype = ARCHETYPES['ar-1']
    const state = createRecoilState()
    fireShots(state, 'ar-1', 20)

    stepRecoilRecovery(state, archetype, false, archetype.recoil.indexRecoveryTime)
    applyRecoilShot(state, archetype)

    expect(state.pitchOffset).toBe(0)
    expect(state.yawOffset).toBe(0)
  })

  it('una pausa PARCIAL recupera el índice sólo parcialmente: el offset del próximo disparo queda estrictamente entre frío y caliente', () => {
    // Esta es la aserción que fallaría bajo un reset por umbral (a los
    // 0.2s de una pausa de 0.4s, un umbral de "resetea al segundo" no
    // habría hecho NADA todavía: offset == caliente, no algo intermedio).
    // Pinnea el diseño elegido, no sólo "algo decae".
    const archetype = ARCHETYPES['ar-1']

    const caliente = createRecoilState()
    fireShots(caliente, 'ar-1', archetype.magazine)
    const offsetCaliente = caliente.pitchOffset

    const parcial = createRecoilState()
    fireShots(parcial, 'ar-1', archetype.magazine)
    stepRecoilRecovery(parcial, archetype, false, archetype.recoil.indexRecoveryTime / 2)
    applyRecoilShot(parcial, archetype)

    expect(parcial.pitchOffset).toBeGreaterThan(0)
    expect(parcial.pitchOffset).toBeLessThan(offsetCaliente)
  })

  it('toques espaciados por el tiempo de recuperación completo nunca acumulan: todos los disparos repiten el offset del primero', () => {
    const archetype = ARCHETYPES['ar-1']
    const state = createRecoilState()

    for (let toque = 0; toque < 5; toque++) {
      applyRecoilShot(state, archetype)
      expect(state.pitchOffset, `toque ${toque}`).toBe(0)
      expect(state.yawOffset, `toque ${toque}`).toBe(0)
      stepRecoilRecovery(state, archetype, false, archetype.recoil.indexRecoveryTime)
    }
  })

  it('la recuperación nunca lleva el índice bajo cero, sin importar cuánto tiempo pase', () => {
    const archetype = ARCHETYPES['ar-1']
    const state = createRecoilState()
    fireShots(state, 'ar-1', 5)

    stepRecoilRecovery(state, archetype, false, 1000)

    expect(state.shotIndex).toBe(0)
  })

  it('el fuego sostenido sigue llegando al final del patrón: la recuperación no compite con la acumulación mientras se dispara', () => {
    const archetype = ARCHETYPES['ar-1']
    const state = createRecoilState()
    const dt = 1 / 128

    for (let i = 0; i < archetype.magazine; i++) {
      applyRecoilShot(state, archetype)
      // firing=true todo el tiempo: stepRecoilRecovery no debería restarle
      // nada a shotIndex mientras se sostiene el gatillo (mismo gate que ya
      // protege pitchOffset/yawOffset).
      stepRecoilRecovery(state, archetype, true, dt)
    }

    const climbFinal = archetype.recoil.pattern[archetype.magazine - 1][1]
    expect(state.pitchOffset).toBe(climbFinal)
  })

  it('la tasa de recuperación del índice supera la cadencia de disparo de CADA arquetipo (si no, sprayar sale gratis)', () => {
    // Propiedad derivada de datos (magazine/indexRecoveryTime vs
    // fireRate/60), no un número hardcodeado: un rebalanceo futuro que deje
    // la recuperación tan lenta como la cadencia real (spray gratis) tiene
    // que hacer fallar este test.
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      const archetype = ARCHETYPES[id]
      const disparosPorSegundo = archetype.fireRate / 60
      expect(indexRecoveryRate(archetype), id).toBeGreaterThan(disparosPorSegundo)
    }
  })
})
