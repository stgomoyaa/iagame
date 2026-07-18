import { describe, expect, it } from 'vitest'
import { createStatsTracker, runBenchmark } from '@/game/engine/stats'
import { FRAME_BUDGET_MS } from '@/game/engine/constants'

describe('tracker de estadísticas', () => {
  it('arranca en cero', () => {
    const t = createStatsTracker()
    expect(t.stats.cpuMs).toBe(0)
    expect(t.stats.drawCalls).toBe(0)
  })

  it('registra draw calls y triángulos del frame', () => {
    const t = createStatsTracker()
    t.beginFrame()
    t.endFrame(12, 4000)
    expect(t.stats.drawCalls).toBe(12)
    expect(t.stats.triangles).toBe(4000)
  })

  it('mide tiempo de CPU no negativo', () => {
    const t = createStatsTracker()
    t.beginFrame()
    let x = 0
    for (let i = 0; i < 100_000; i++) x += i
    t.endFrame(1, 1)
    expect(t.stats.cpuMs).toBeGreaterThanOrEqual(0)
    expect(x).toBeGreaterThan(0)
  })

  it('marca overBudget cuando el frame supera el presupuesto', () => {
    const t = createStatsTracker()
    t.beginFrame()
    const fin = performance.now() + FRAME_BUDGET_MS + 2
    while (performance.now() < fin) { /* quemar tiempo a propósito */ }
    t.endFrame(1, 1)
    expect(t.stats.overBudget).toBe(true)
  })

  it('runBenchmark corre exactamente las pasadas pedidas', () => {
    let n = 0
    runBenchmark(() => { n++ }, 50)
    expect(n).toBe(50)
  })

  it('runBenchmark devuelve un promedio por pasada no negativo', () => {
    const ms = runBenchmark(() => { /* trabajo nulo */ }, 100)
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ms)).toBe(true)
  })
})
