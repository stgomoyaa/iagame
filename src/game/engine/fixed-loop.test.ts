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
})
