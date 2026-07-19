import { describe, expect, it } from 'vitest'
import {
  advanceRingIndex,
  canBeginGpuQuery,
  createGpuTimer,
  GPU_QUERY_RING_SIZE,
  nsToMs,
  resolveGpuSample,
  resolveGpuTimerAvailability,
  smoothGpuSample,
  trackGpuPeak,
} from '@/game/engine/gpu-timer'

// Las llamadas de GL reales no se pueden probar en el entorno de Node de
// este proyecto (environment: 'node', sin jsdom, y no se agrega). Lo que
// sigue cubre: (a) toda la lógica pura extraída de gpu-timer.ts con tests
// directos, y (b) el comportamiento completo de createGpuTimer() contra un
// contexto WebGL2 falso que implementa a mano el mismo contrato que usa el
// módulo (createQuery/beginQuery/endQuery/getQueryParameter/getParameter/
// getExtension) — no es un navegador real, así que la verificación final
// contra un GPU real quedó para el paso manual en el navegador, no acá.

describe('funciones puras de gpu-timer', () => {
  it('advanceRingIndex avanza y da la vuelta al llegar al tamaño', () => {
    expect(advanceRingIndex(0, 4)).toBe(1)
    expect(advanceRingIndex(1, 4)).toBe(2)
    expect(advanceRingIndex(2, 4)).toBe(3)
    expect(advanceRingIndex(3, 4)).toBe(0)
  })

  it('nsToMs convierte nanosegundos a milisegundos', () => {
    expect(nsToMs(1_000_000)).toBe(1)
    expect(nsToMs(1_700_000)).toBeCloseTo(1.7, 10)
    expect(nsToMs(0)).toBe(0)
  })

  it('smoothGpuSample pondera el sample nuevo por alpha', () => {
    expect(smoothGpuSample(2, 4, 0.5)).toBe(3)
    expect(smoothGpuSample(10, 10, 0.3)).toBe(10)
    expect(smoothGpuSample(0, 2, 0.25)).toBe(0.5)
  })

  it('trackGpuPeak sólo sube, nunca baja', () => {
    expect(trackGpuPeak(1, 5)).toBe(5)
    expect(trackGpuPeak(5, 1)).toBe(5)
    expect(trackGpuPeak(-1, 0.01)).toBe(0.01)
  })

  it('resolveGpuSample descarta el resultado si hubo un disjoint', () => {
    expect(resolveGpuSample(1_700_000, true)).toBeNull()
  })

  it('resolveGpuSample convierte a ms cuando no hubo disjoint', () => {
    expect(resolveGpuSample(2_000_000, false)).toBeCloseTo(2, 10)
  })

  it('canBeginGpuQuery bloquea el slot mientras tenga un resultado pendiente', () => {
    expect(canBeginGpuQuery([false, true, false], 0)).toBe(true)
    expect(canBeginGpuQuery([false, true, false], 1)).toBe(false)
  })

  it('resolveGpuTimerAvailability mapea presencia de extensión a estado', () => {
    expect(resolveGpuTimerAvailability(true)).toBe('available')
    expect(resolveGpuTimerAvailability(false)).toBe('unsupported')
  })
})

/** Entrada programada para una llamada a beginQuery: qué va a devolver esa
 *  query cuando finalmente esté lista, y cuántos polls (llamadas a
 *  getQueryParameter con QUERY_RESULT_AVAILABLE sobre esa query puntual)
 *  hacen falta antes de reportarla lista. readyIn: 0 = lista en el primer
 *  poll (mismo frame en que se llamó a beginQuery). */
interface ScriptEntry {
  rawNs: number
  readyIn: number
}

/**
 * Contexto WebGL2 falso: implementa a mano el subconjunto del contrato que
 * gpu-timer.ts usa (createQuery/beginQuery/endQuery/getQueryParameter/
 * getParameter/getExtension), sin ningún WebGL real de por medio. Cada
 * llamada a beginQuery consume la siguiente entrada de `schedule` en orden
 * de invocación (no por slot físico del ring, que se reusa): así el test
 * describe "la 1ª query arrancada", "la 2ª", etc, sin tener que saber en qué
 * slot del ring cayó cada una.
 */
function createFakeGl(schedule: ScriptEntry[]): {
  gl: WebGL2RenderingContext
  setDisjoint(value: boolean): void
  beginCalls(): number
} {
  const QUERY_RESULT = 1
  const QUERY_RESULT_AVAILABLE = 2
  const TIME_ELAPSED_EXT = 111
  const GPU_DISJOINT_EXT = 222
  const ext = { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }

  const perQuery = new Map<object, { rawNs: number; readyIn: number }>()
  let beginCount = 0
  let disjoint = false

  const fake = {
    QUERY_RESULT,
    QUERY_RESULT_AVAILABLE,
    createQuery(): object {
      return {}
    },
    beginQuery(_target: number, query: object): void {
      const entry = schedule[beginCount] ?? { rawNs: 0, readyIn: Number.POSITIVE_INFINITY }
      beginCount++
      perQuery.set(query, { rawNs: entry.rawNs, readyIn: entry.readyIn })
    },
    endQuery(): void {},
    getQueryParameter(query: object, pname: number): unknown {
      const state = perQuery.get(query)
      if (!state) return pname === QUERY_RESULT_AVAILABLE ? false : 0
      if (pname === QUERY_RESULT_AVAILABLE) {
        if (state.readyIn > 0) {
          state.readyIn -= 1
          return false
        }
        return true
      }
      return state.rawNs
    },
    getParameter(): unknown {
      return disjoint
    },
    getExtension(name: string): unknown {
      return name === 'EXT_disjoint_timer_query_webgl2' ? ext : null
    },
  }

  return {
    gl: fake as unknown as WebGL2RenderingContext,
    setDisjoint(value: boolean): void {
      disjoint = value
    },
    beginCalls(): number {
      return beginCount
    },
  }
}

describe('createGpuTimer', () => {
  it('degrada con gracia cuando no hay contexto (extensión no disponible)', () => {
    const timer = createGpuTimer(null)
    expect(timer.stats.availability).toBe('unsupported')
    expect(() => {
      timer.beginFrame()
      timer.endFrame()
    }).not.toThrow()
    expect(timer.stats.gpuMs).toBe(-1)
    expect(timer.stats.peakMs).toBe(-1)
  })

  it('degrada con gracia cuando el contexto existe pero la extensión no', () => {
    const gl = { getExtension: () => null } as unknown as WebGL2RenderingContext
    const timer = createGpuTimer(gl)
    expect(timer.stats.availability).toBe('unsupported')
    timer.beginFrame()
    timer.endFrame()
    expect(timer.stats.gpuMs).toBe(-1)
  })

  it('reporta el primer resultado válido directo, sin promediarlo contra -1', () => {
    const fake = createFakeGl([{ rawNs: 1_700_000, readyIn: 0 }])
    const timer = createGpuTimer(fake.gl)
    expect(timer.stats.availability).toBe('available')

    timer.beginFrame()
    timer.endFrame()

    expect(timer.stats.gpuMs).toBeCloseTo(1.7, 10)
    expect(timer.stats.peakMs).toBeCloseTo(1.7, 10)
  })

  it('un resultado con latencia no se refleja hasta que la query completa, frames después', () => {
    const fake = createFakeGl([{ rawNs: 2_000_000, readyIn: 2 }])
    const timer = createGpuTimer(fake.gl)

    timer.beginFrame()
    timer.endFrame()
    expect(timer.stats.gpuMs).toBe(-1)

    timer.beginFrame()
    timer.endFrame()
    expect(timer.stats.gpuMs).toBe(-1)

    timer.beginFrame()
    timer.endFrame()
    expect(timer.stats.gpuMs).toBeCloseTo(2, 10)
  })

  it('un evento disjoint descarta la medición pendiente en vez de reportarla', () => {
    const fake = createFakeGl([
      { rawNs: 9_000_000, readyIn: 0 }, // se descarta por disjoint
      { rawNs: 1_500_000, readyIn: 0 }, // válida, ya sin disjoint
    ])
    const timer = createGpuTimer(fake.gl)

    fake.setDisjoint(true)
    timer.beginFrame()
    timer.endFrame()
    expect(timer.stats.gpuMs).toBe(-1)
    expect(timer.stats.peakMs).toBe(-1)

    fake.setDisjoint(false)
    timer.beginFrame()
    timer.endFrame()
    expect(timer.stats.gpuMs).toBeCloseTo(1.5, 10)
  })

  it('el pico se queda arriba aunque el promedio suavizado baje después', () => {
    const fake = createFakeGl([
      { rawNs: 1_000_000, readyIn: 0 },
      { rawNs: 6_000_000, readyIn: 0 },
      { rawNs: 1_000_000, readyIn: 0 },
    ])
    const timer = createGpuTimer(fake.gl)

    timer.beginFrame()
    timer.endFrame()
    timer.beginFrame()
    timer.endFrame()
    timer.beginFrame()
    timer.endFrame()

    expect(timer.stats.peakMs).toBeCloseTo(6, 10)
    expect(timer.stats.gpuMs).toBeLessThan(6)
  })

  it('si ninguna query resuelve nunca, deja de arrancar nuevas al agotar el ring', () => {
    const fake = createFakeGl([])
    const timer = createGpuTimer(fake.gl)

    for (let i = 0; i < GPU_QUERY_RING_SIZE + 5; i++) {
      timer.beginFrame()
      timer.endFrame()
    }

    expect(fake.beginCalls()).toBe(GPU_QUERY_RING_SIZE)
    expect(timer.stats.gpuMs).toBe(-1)
  })
})
