import { describe, expect, it, vi } from 'vitest'
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

  it('gpuMs y gpuPeakMs arrancan en -1 (sin medición todavía)', () => {
    const t = createStatsTracker()
    expect(t.stats.gpuMs).toBe(-1)
    expect(t.stats.gpuPeakMs).toBe(-1)
  })

  it('overBudget usa el máximo entre cpu y gpu, no la suma', () => {
    const t = createStatsTracker()
    t.beginFrame()
    // cpu real del test es prácticamente nulo; gpu bien por sobre presupuesto.
    t.endFrame(1, 1, 5, 5)
    expect(t.stats.gpuMs).toBe(5)
    expect(t.stats.overBudget).toBe(true)
  })

  it('gpu bajo presupuesto no tapa un cpu que sí lo supera', () => {
    const t = createStatsTracker()
    t.beginFrame()
    const fin = performance.now() + FRAME_BUDGET_MS + 2
    while (performance.now() < fin) { /* quemar tiempo a propósito */ }
    t.endFrame(1, 1, 0.1, 0.2)
    expect(t.stats.overBudget).toBe(true)
  })

  it('gpuMs desconocido (-1) no arrastra el veredicto: sólo cuenta cpu', () => {
    const t = createStatsTracker()
    t.beginFrame()
    t.endFrame(1, 1)
    expect(t.stats.gpuMs).toBe(-1)
    expect(t.stats.overBudget).toBe(false)
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

  it('el primer fps no arrastra el tiempo previo a la creación del tracker', () => {
    // performance.now() se mide desde el inicio de la navegación. El tracker
    // suele crearse (como en game.ts) bien antes de que arranque el loop real
    // — mientras la página termina de hidratar e inicializar WebGL. Ese hueco
    // no debe colarse en el primer fps reportado.
    const INIT_DELAY_MS = 800
    const FRAME_MS = 8 // ~125 fps simulados, dentro del presupuesto

    let now = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now)

    const t = createStatsTracker()

    // Recién acá "llega" el primer frame real: simula la hidratación de la
    // página + init de WebGL transcurriendo entre la creación del tracker y
    // el primer beginFrame/endFrame.
    now = INIT_DELAY_MS

    let firstReportedFps: number | null = null
    for (let i = 0; i < 100 && firstReportedFps === null; i++) {
      t.beginFrame()
      now += FRAME_MS
      t.endFrame(1, 1)
      if (t.stats.fps > 0) firstReportedFps = t.stats.fps
    }

    expect(firstReportedFps).not.toBeNull()
    // El fps real simulado es ~125 (1000 / FRAME_MS). Si el primer fps
    // arrastrara los 800ms previos al primer frame, el resultado rondaría 1
    // fps en vez de acercarse a la tasa real de frames simulados.
    expect(firstReportedFps as number).toBeGreaterThan(60)

    spy.mockRestore()
  })
})
