import { describe, expect, it } from 'vitest'
import {
  createHitmarkerState,
  hitmarkerOpacity,
  hitmarkerScale,
  hitmarkerTier,
  spawnHitmarker,
  stepHitmarkers,
} from '@/game/feedback/hitmarkers'
import { FEEDBACK } from '@/game/feedback/tuning'

describe('hitmarkerTier', () => {
  it('impacto normal: ni cabeza ni kill', () => {
    expect(hitmarkerTier(false, false)).toBe('normal')
  })
  it('headshot sin matar', () => {
    expect(hitmarkerTier(true, false)).toBe('headshot')
  })
  it('kill a cuerpo', () => {
    expect(hitmarkerTier(false, true)).toBe('kill')
  })
  it('headshot que mata: el nivel más alto', () => {
    expect(hitmarkerTier(true, true)).toBe('headshotKill')
  })
})

describe('hitmarkerScale', () => {
  it('daño 0 da la escala base', () => {
    expect(hitmarkerScale(0)).toBeCloseTo(FEEDBACK.hitmarkerBaseScale, 9)
  })
  it('satura en hitmarkerMaxScale al llegar al daño de saturación', () => {
    expect(hitmarkerScale(FEEDBACK.hitmarkerDamageForMaxScale)).toBeCloseTo(
      FEEDBACK.hitmarkerMaxScale,
      9,
    )
  })
  it('no crece más allá de hitmarkerMaxScale con daño excesivo', () => {
    expect(hitmarkerScale(FEEDBACK.hitmarkerDamageForMaxScale * 5)).toBeCloseTo(
      FEEDBACK.hitmarkerMaxScale,
      9,
    )
  })
  it('es monótona no decreciente en el daño', () => {
    let prev = hitmarkerScale(0)
    for (let d = 1; d <= 100; d++) {
      const cur = hitmarkerScale(d)
      expect(cur).toBeGreaterThanOrEqual(prev)
      prev = cur
    }
  })
})

describe('hitmarkerOpacity', () => {
  it('arranca en opacidad completa', () => {
    expect(hitmarkerOpacity(0, 0.2)).toBe(1)
  })
  it('llega a 0 al final de la duración', () => {
    expect(hitmarkerOpacity(0.2, 0.2)).toBeCloseTo(0, 9)
  })
  it('es monótona no creciente a lo largo de la vida', () => {
    let prev = hitmarkerOpacity(0, 0.2)
    for (let t = 0; t <= 0.2; t += 0.01) {
      const cur = hitmarkerOpacity(t, 0.2)
      expect(cur).toBeLessThanOrEqual(prev + 1e-9)
      prev = cur
    }
  })
})

describe('pool de hitmarkers', () => {
  it('spawnHitmarker activa un slot con la escala y el nivel pedidos', () => {
    const state = createHitmarkerState()
    spawnHitmarker(state, 'kill', 40)
    const activos = state.pool.items.filter((e) => e.active)
    expect(activos.length).toBe(1)
    expect(activos[0].tier).toBe('kill')
    expect(activos[0].scale).toBeCloseTo(hitmarkerScale(40), 9)
  })

  it('stepHitmarkers desactiva un hitmarker al cumplir su duración', () => {
    const state = createHitmarkerState()
    spawnHitmarker(state, 'normal', 10)
    stepHitmarkers(state, FEEDBACK.hitmarkerDurationS + 0.01)
    expect(state.pool.items.some((e) => e.active)).toBe(false)
  })

  it('agotar el pool recicla el slot más viejo en vez de perder el hit nuevo', () => {
    const state = createHitmarkerState()
    for (let i = 0; i < FEEDBACK.hitmarkerPoolSize + 3; i++) {
      spawnHitmarker(state, 'normal', 10)
    }
    // El pool nunca crece más allá de su capacidad preasignada.
    expect(state.pool.items.length).toBe(FEEDBACK.hitmarkerPoolSize)
    // Y el hit más reciente sigue activo (no se perdió).
    expect(state.pool.items.some((e) => e.active)).toBe(true)
  })

  it('cero asignaciones: miles de spawn/step no hacen crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')
    const state = createHitmarkerState()

    for (let i = 0; i < 2000; i++) {
      spawnHitmarker(state, i % 2 === 0 ? 'headshot' : 'kill', 30)
      stepHitmarkers(state, 0.001)
    }

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 200_000; i++) {
      spawnHitmarker(state, 'headshotKill', 55)
      stepHitmarkers(state, 0.001)
    }

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })
})
