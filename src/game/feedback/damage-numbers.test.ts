import { describe, expect, it } from 'vitest'
import {
  createDamageNumberState,
  damageNumberOpacity,
  damageNumberRiseOffset,
  spawnDamageNumber,
  stepDamageNumbers,
} from '@/game/feedback/damage-numbers'
import { FEEDBACK } from '@/game/feedback/tuning'

describe('damageNumberOpacity: fade in -> sostenido -> fade out', () => {
  it('arranca en 0 y llega a 1 al final del fade-in', () => {
    expect(damageNumberOpacity(0, 1)).toBeCloseTo(0, 9)
    expect(damageNumberOpacity(FEEDBACK.damageNumberFadeInFraction, 1)).toBeCloseTo(1, 6)
  })

  it('se mantiene en 1 durante el tramo sostenido', () => {
    const medio = (FEEDBACK.damageNumberFadeInFraction + FEEDBACK.damageNumberFadeOutStart) / 2
    expect(damageNumberOpacity(medio, 1)).toBeCloseTo(1, 9)
  })

  it('llega a 0 al final de la vida', () => {
    expect(damageNumberOpacity(1, 1)).toBeCloseTo(0, 9)
  })

  it('nunca es negativa ni mayor a 1 en todo el rango', () => {
    for (let t = 0; t <= 1; t += 0.01) {
      const o = damageNumberOpacity(t, 1)
      expect(o).toBeGreaterThanOrEqual(-1e-9)
      expect(o).toBeLessThanOrEqual(1 + 1e-9)
    }
  })
})

describe('damageNumberRiseOffset: sube, nunca baja', () => {
  it('arranca en 0', () => {
    expect(damageNumberRiseOffset(0, 1)).toBe(0)
  })

  it('es monótona no decreciente a lo largo de la vida', () => {
    let prev = 0
    for (let t = 0; t <= 1; t += 0.02) {
      const cur = damageNumberRiseOffset(t, 1)
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = cur
    }
  })

  it('llega a damageNumberRiseDistance al final de la vida', () => {
    expect(damageNumberRiseOffset(1, 1)).toBeCloseTo(FEEDBACK.damageNumberRiseDistance, 9)
  })
})

describe('pool de números de daño', () => {
  it('spawnDamageNumber activa un slot con el valor pedido, cerca de la posición pedida', () => {
    const state = createDamageNumberState()
    spawnDamageNumber(state, 0.1, -0.2, 24, false)
    const activos = state.pool.items.filter((e) => e.active)
    expect(activos.length).toBe(1)
    expect(activos[0].value).toBe(24)
    expect(Math.abs(activos[0].ndcX - 0.1)).toBeLessThanOrEqual(FEEDBACK.damageNumberJitterRadius)
    expect(Math.abs(activos[0].ndcY - -0.2)).toBeLessThanOrEqual(FEEDBACK.damageNumberJitterRadius)
  })

  it('stepDamageNumbers desactiva un número al cumplir su vida útil', () => {
    const state = createDamageNumberState()
    spawnDamageNumber(state, 0, 0, 10, false)
    stepDamageNumbers(state, FEEDBACK.damageNumberLifetimeS + 0.01)
    expect(state.pool.items.some((e) => e.active)).toBe(false)
  })

  it('agotar el pool recicla el slot más viejo, nunca crece', () => {
    const state = createDamageNumberState()
    for (let i = 0; i < FEEDBACK.damageNumberPoolSize + 5; i++) {
      spawnDamageNumber(state, 0, 0, i, false)
    }
    expect(state.pool.items.length).toBe(FEEDBACK.damageNumberPoolSize)
  })

  it('cero asignaciones: miles de spawn/step no hacen crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')
    const state = createDamageNumberState()

    for (let i = 0; i < 2000; i++) {
      spawnDamageNumber(state, 0.05, 0.05, 20, i % 3 === 0)
      stepDamageNumbers(state, 0.001)
    }

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 200_000; i++) {
      spawnDamageNumber(state, 0.05, 0.05, 20, i % 3 === 0)
      stepDamageNumbers(state, 0.001)
    }

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })
})
