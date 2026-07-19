import { describe, expect, it } from 'vitest'
import { createFixedLoop } from '@/game/engine/fixed-loop'
import { MAX_FRAME_DT, TICK_DT } from '@/game/engine/constants'

describe('loop de timestep fijo', () => {
  it('un frame más corto que un tick no corre ninguno', () => {
    const loop = createFixedLoop()
    loop.advance(TICK_DT * 0.5)
    expect(loop.ticksLastFrame).toBe(0)
  })

  it('acumula frames cortos hasta completar un tick', () => {
    const loop = createFixedLoop()
    loop.advance(TICK_DT * 0.6)
    loop.advance(TICK_DT * 0.6)
    expect(loop.ticksLastFrame).toBe(1)
  })

  it('un frame de tres ticks corre exactamente tres', () => {
    const loop = createFixedLoop()
    loop.advance(TICK_DT * 3)
    expect(loop.ticksLastFrame).toBe(3)
  })

  it('el alpha refleja el resto dentro del tick', () => {
    const loop = createFixedLoop()
    loop.advance(TICK_DT * 1.5)
    expect(loop.alpha).toBeCloseTo(0.5, 6)
  })

  it('el alpha siempre queda en el rango 0..1', () => {
    const loop = createFixedLoop()
    for (const dt of [0.001, 0.033, 0.5, 0.0001, 0.2]) {
      loop.advance(dt)
      expect(loop.alpha).toBeGreaterThanOrEqual(0)
      expect(loop.alpha).toBeLessThanOrEqual(1)
    }
  })

  it('un frame gigante se recorta a MAX_FRAME_DT y no dispara una avalancha', () => {
    const loop = createFixedLoop()
    loop.advance(30)
    expect(loop.ticksLastFrame).toBe(Math.floor(MAX_FRAME_DT / TICK_DT))
  })

  it('no acumula deriva a lo largo de muchos frames', () => {
    const loop = createFixedLoop()
    let ticks = 0
    for (let i = 0; i < 1000; i++) {
      loop.advance(1 / 240)
      ticks += loop.ticksLastFrame
    }
    // 1000 frames a 240Hz son 4.1667s de simulación; a 128Hz eso son ~533 ticks.
    expect(ticks).toBeGreaterThanOrEqual(532)
    expect(ticks).toBeLessThanOrEqual(534)
  })

  it('un NaN no envenena el loop permanentemente', () => {
    const loop = createFixedLoop()
    // Llamamos con NaN
    loop.advance(NaN)
    expect(loop.ticksLastFrame).toBe(0)
    // Ahora con un valor normal
    const ticks = loop.advance(TICK_DT * 2)
    expect(ticks).toBe(2)
    expect(Number.isFinite(loop.alpha)).toBe(true)
    expect(loop.alpha).toBeGreaterThanOrEqual(0)
    expect(loop.alpha).toBeLessThan(1)
  })

  it('Infinity se recorta igual que MAX_FRAME_DT', () => {
    const loop = createFixedLoop()
    loop.advance(Infinity)
    const ticksInfinity = loop.ticksLastFrame
    const alphaInfinity = loop.alpha

    const loop2 = createFixedLoop()
    loop2.advance(MAX_FRAME_DT)
    const ticksMax = loop2.ticksLastFrame
    const alphaMax = loop2.alpha

    expect(ticksInfinity).toBe(ticksMax)
    expect(alphaInfinity).toBeCloseTo(alphaMax, 6)
  })

  it('-Infinity debe contribuir cero ticks y mantener alpha sin cambios', () => {
    const loop = createFixedLoop()
    loop.advance(TICK_DT * 2) // Antes: 2 ticks, alpha = 0
    const alphaBefore = loop.alpha

    loop.advance(-Infinity)
    expect(loop.ticksLastFrame).toBe(0)
    expect(loop.alpha).toBe(alphaBefore)
  })

  it('un frameDt negativo no saca el alpha fuera de [0, 1)', () => {
    const loop = createFixedLoop()
    loop.advance(-0.05)
    expect(loop.alpha).toBeGreaterThanOrEqual(0)
    expect(loop.alpha).toBeLessThan(1)
  })

  it('el alpha se mantiene en [0, 1) incluso con secuencia mixta', () => {
    const loop = createFixedLoop()
    const deltas = [
      -0.05,
      NaN,
      0.001,
      Infinity,
      TICK_DT * 0.5,
      -0.1,
      0.02,
      TICK_DT * 2,
      NaN,
    ]
    for (const dt of deltas) {
      loop.advance(dt)
      expect(Number.isFinite(loop.alpha)).toBe(true)
      expect(loop.alpha).toBeGreaterThanOrEqual(0)
      expect(loop.alpha).toBeLessThan(1)
    }
  })
})
