import { describe, expect, it } from 'vitest'
import {
  createFeedbackState,
  onDamageTaken,
  onHitConfirmed,
  onShotFired,
  stepFeedback,
} from '@/game/feedback/feedback'

const DT = 1 / 240

describe('orquestación de feedback', () => {
  it('onShotFired mueve el punch de cámara', () => {
    const state = createFeedbackState()
    onShotFired(state)
    stepFeedback(state, DT)
    expect(state.cameraPunch.roll).not.toBe(0)
  })

  it('onHitConfirmed activa un hitmarker y un número de daño, y devuelve el nivel correcto', () => {
    const state = createFeedbackState()
    const tier = onHitConfirmed(state, 0, 0, 45, true, true)
    expect(tier).toBe('headshotKill')
    expect(state.hitmarkers.pool.items.some((e) => e.active)).toBe(true)
    expect(state.damageNumbers.pool.items.some((e) => e.active)).toBe(true)
  })

  it('onDamageTaken activa una viñeta, suma shake y resta vida', () => {
    const state = createFeedbackState()
    const vidaAntes = state.health.health
    onDamageTaken(state, Math.PI / 2, 20)
    expect(state.vignette.pool.items.some((e) => e.active)).toBe(true)
    expect(state.shake.magnitude).toBeGreaterThan(0)
    expect(state.health.health).toBeLessThan(vidaAntes)
  })

  it('stepFeedback envejece todo junto: un hitmarker y un número de daño terminan desactivándose', () => {
    const state = createFeedbackState()
    onHitConfirmed(state, 0.1, 0.1, 20, false, false)
    for (let i = 0; i < 2000; i++) stepFeedback(state, DT)
    expect(state.hitmarkers.pool.items.some((e) => e.active)).toBe(false)
    expect(state.damageNumbers.pool.items.some((e) => e.active)).toBe(false)
  })

  it('cero asignaciones: miles de eventos de disparo/impacto/daño no hacen crecer el heap', () => {
    // Ver combat/allocations.test.ts para el patrón (gc() antes Y después
    // del tramo medido): acá adentro todo es matemática pura sobre pools
    // preasignados, sin ninguna dependencia como three-mesh-bvh que asigne
    // objetos transitorios por su cuenta, así que ni siquiera hace falta
    // ese margen extra.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const state = createFeedbackState()

    function simularFrame(i: number): void {
      if (i % 3 === 0) onShotFired(state)
      if (i % 5 === 0) onHitConfirmed(state, 0.05, -0.1, 25 + (i % 40), i % 2 === 0, i % 11 === 0)
      if (i % 13 === 0) onDamageTaken(state, (i % 7) - 3, 10 + (i % 20))
      stepFeedback(state, DT)
    }

    // Calentar.
    for (let i = 0; i < 5000; i++) simularFrame(i)

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 300_000; i++) simularFrame(i)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    expect(crecimientoMB).toBeLessThan(1.5)
  })
})
