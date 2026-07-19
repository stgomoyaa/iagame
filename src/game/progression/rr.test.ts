import { describe, expect, it } from 'vitest'
import {
  applyRr,
  createRankState,
  escalaDeDelta,
  RR,
  rrChange,
  type RankState,
} from '@/game/progression/rr'
import { RANK_MAX, RANK_MIN, RR_MAXIMO } from '@/game/progression/ranks'

describe('cambio de RR', () => {
  it('sin delta da exactamente la base del spec', () => {
    expect(rrChange(true, 0)).toBe(18)
    expect(rrChange(false, 0)).toBe(-16)
  })

  it('una buena actuacion suma y una mala resta sobre esa base', () => {
    expect(rrChange(true, 20)).toBeGreaterThan(rrChange(true, 0))
    expect(rrChange(true, -20)).toBeLessThan(rrChange(true, 0))
    expect(rrChange(false, 20)).toBeGreaterThan(rrChange(false, 0))
    expect(rrChange(false, -20)).toBeLessThan(rrChange(false, 0))
  })

  // Las dos garantías de sensación que sostienen la escalera entera.
  it('ganar nunca resta RR, por mal que hayas jugado', () => {
    for (const delta of [-500, -100, -40, -20, 0]) {
      expect(rrChange(true, delta), `delta ${delta}`).toBeGreaterThanOrEqual(RR.minVictoria)
    }
  })

  it('perder nunca suma RR, por bien que hayas jugado', () => {
    for (const delta of [500, 100, 40, 20, 0]) {
      expect(rrChange(false, delta), `delta ${delta}`).toBeLessThanOrEqual(RR.maxDerrota)
    }
  })

  it('respeta los clamps del spec en los dos extremos', () => {
    expect(rrChange(true, 10_000)).toBe(RR.maxVictoria)
    expect(rrChange(true, -10_000)).toBe(RR.minVictoria)
    expect(rrChange(false, 10_000)).toBe(RR.maxDerrota)
    expect(rrChange(false, -10_000)).toBe(RR.minDerrota)
  })

  it('la escala esta acotada y trata NaN como delta cero', () => {
    expect(escalaDeDelta(10_000)).toBe(RR.escalaMaxima)
    expect(escalaDeDelta(-10_000)).toBe(-RR.escalaMaxima)
    expect(escalaDeDelta(Number.NaN)).toBe(0)
  })

  it('siempre devuelve enteros: la UI muestra RR sin decimales', () => {
    for (const delta of [-33, -7, 0, 3, 11, 29]) {
      expect(Number.isInteger(rrChange(true, delta)), `delta ${delta}`).toBe(true)
      expect(Number.isInteger(rrChange(false, delta)), `delta ${delta}`).toBe(true)
    }
  })
})

describe('promocion, descenso y colchon', () => {
  it('pasar de 100 RR promociona y arrastra el sobrante', () => {
    const r = applyRr({ rank: 5, rr: 90, cushion: RR.colchon }, 25)
    expect(r.movement).toBe('ascenso')
    expect(r.state.rank).toBe(6)
    expect(r.state.rr).toBe(15)
  })

  // Llegar justo a 100 promociona: una barra llena que no asciende se lee
  // como un sistema roto. Encontrado jugando, no razonando.
  it('llegar exactamente a 100 RR promociona, sin quedarse en la barra llena', () => {
    const r = applyRr({ rank: 5, rr: 95, cushion: RR.colchon }, 5)
    expect(r.movement).toBe('ascenso')
    expect(r.state.rank).toBe(6)
    expect(r.state.rr).toBe(0)
  })

  it('el RR de una division nunca descansa en 100 salvo en Radiante', () => {
    let state = createRankState(3, 0)
    for (let i = 0; i < 400; i++) {
      state = applyRr(state, rrChange(i % 3 !== 0, ((i * 53) % 100) - 50)).state
      if (state.rank !== RANK_MAX) {
        expect(state.rr, `partida ${i}`).toBeLessThan(RR_MAXIMO)
      }
    }
  })

  it('un ascenso repone el colchon entero', () => {
    const r = applyRr({ rank: 5, rr: 95, cushion: 2 }, 20)
    expect(r.movement).toBe('ascenso')
    expect(r.state.cushion).toBe(RR.colchon)
  })

  // El corazón del colchón: "un mal partido no te hace bajar de tier".
  it('bajar de 0 gasta el colchon en vez de descender', () => {
    const r = applyRr({ rank: 6, rr: 3, cushion: RR.colchon }, -9)
    expect(r.movement).toBe('ninguno')
    expect(r.state.rank).toBe(6)
    expect(r.state.rr).toBe(0)
    expect(r.state.cushion).toBe(RR.colchon - 6)
    expect(r.colchonConsumido).toBe(6)
  })

  it('recien con el colchon agotado hay descenso', () => {
    const r = applyRr({ rank: 6, rr: 0, cushion: 4 }, -20)
    expect(r.movement).toBe('descenso')
    expect(r.state.rank).toBe(5)
    expect(r.state.rr).toBe(RR.rrTrasDescenso)
    expect(r.state.cushion).toBe(RR.colchon)
  })

  // La garantía que da sentido al colchón: entrando con RR en el banco,
  // NINGUNA derrota sola te saca del tier, ni la peor posible.
  it('entrando con RR arriba de 0, un solo mal partido nunca desciende', () => {
    for (let rr = 1; rr <= 100; rr++) {
      for (const cushion of [0, 3, RR.colchon]) {
        const r = applyRr({ rank: 6, rr, cushion }, RR.minDerrota)
        expect(r.movement, `rr ${rr} colchon ${cushion}`).toBe('ninguno')
        expect(r.state.rank).toBe(6)
      }
    }
  })

  it('hacen falta dos derrotas para descender: la segunda ya desde el piso', () => {
    const primera = applyRr({ rank: 6, rr: 8, cushion: RR.colchon }, RR.minDerrota)
    expect(primera.movement).toBe('ninguno')
    expect(primera.state.rr).toBe(0)
    expect(primera.state.cushion).toBe(0)

    const segunda = applyRr(primera.state, RR.minDerrota)
    expect(segunda.movement).toBe('descenso')
    expect(segunda.state.rank).toBe(5)
  })

  it('sumar RR repone el colchon: no se acumula deuda entre derrotas', () => {
    const gastado: RankState = { rank: 6, rr: 0, cushion: 1 }
    const r = applyRr(gastado, 18)
    expect(r.state.cushion).toBe(RR.colchon)
    expect(r.state.rr).toBe(18)
  })

  it('en Hierro 1 el RR se apoya en 0 y no hay descenso', () => {
    const r = applyRr({ rank: RANK_MIN, rr: 2, cushion: RR.colchon }, -30)
    expect(r.movement).toBe('ninguno')
    expect(r.state.rank).toBe(RANK_MIN)
    expect(r.state.rr).toBe(0)
  })

  it('en Radiante el RR se apoya en 100 y no hay ascenso', () => {
    const r = applyRr({ rank: RANK_MAX, rr: 95, cushion: RR.colchon }, 30)
    expect(r.movement).toBe('ninguno')
    expect(r.state.rank).toBe(RANK_MAX)
    expect(r.state.rr).toBe(RR_MAXIMO)
  })

  it('no muta el estado que recibe', () => {
    const antes: RankState = { rank: 6, rr: 95, cushion: RR.colchon }
    const copia = { ...antes }
    applyRr(antes, 20)
    expect(antes).toEqual(copia)
  })

  it('createRankState clampea rango y RR', () => {
    expect(createRankState(-4)).toEqual({ rank: RANK_MIN, rr: 0, cushion: RR.colchon })
    expect(createRankState(999, 500)).toEqual({
      rank: RANK_MAX,
      rr: RR_MAXIMO,
      cushion: RR.colchon,
    })
  })

  // Propiedad global: ninguna secuencia de partidas puede sacar el estado
  // de la escalera, que es lo que protege a la UI de tener que defenderse.
  it('ninguna secuencia de resultados deja el estado fuera de la escalera', () => {
    let state = createRankState(12, 50)
    for (let i = 0; i < 2000; i++) {
      const win = (i * 7919) % 3 !== 0
      state = applyRr(state, rrChange(win, ((i * 37) % 120) - 60)).state
      expect(state.rank).toBeGreaterThanOrEqual(RANK_MIN)
      expect(state.rank).toBeLessThanOrEqual(RANK_MAX)
      expect(state.rr).toBeGreaterThanOrEqual(0)
      expect(state.rr).toBeLessThanOrEqual(RR_MAXIMO)
      expect(state.cushion).toBeGreaterThanOrEqual(0)
      expect(state.cushion).toBeLessThanOrEqual(RR.colchon)
    }
  })
})
