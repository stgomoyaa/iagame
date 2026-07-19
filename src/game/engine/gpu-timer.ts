/**
 * Timer de GPU real, hablando directo contra el contexto WebGL2 crudo vía
 * EXT_disjoint_timer_query_webgl2.
 *
 * Three.js WebGLRenderer no expone ningún timestamp de GPU — eso sólo existe
 * en el renderer WebGPU de Three (three/webgpu), que este proyecto no usa —
 * así que no hay ninguna API de más alto nivel a la que engancharse acá.
 *
 * Por qué un ring de queries y no una sola:
 * la extensión sólo permite una query TIME_ELAPSED_EXT *activa* a la vez
 * (entre beginQuery y endQuery), pero el resultado no está listo al cerrar
 * esa misma query: la GPU sigue drenando su cola de comandos varios frames
 * después de que el CPU encoló el último draw call. beginFrame()/endFrame()
 * de este frame arrancan y cierran una medición nueva; el resultado de una
 * medición arrancada hace N frames recién puede estar listo ahora. El ring
 * preasignado (creado una sola vez en createGpuTimer, nunca en el per-frame
 * path) resuelve esto: cada frame arranca una query en el siguiente slot y
 * además revisa todos los slots pendientes por si ya tienen resultado. Sigue
 * habiendo una sola query activa a la vez — el ring es sobre solapamiento de
 * queries *pendientes de leer*, no de queries activas.
 */

/** Cuántas queries preasignadas tiene el ring. Un resultado suele tardar
 *  1-3 frames en estar listo; con este margen no debería agotarse nunca en
 *  uso normal. */
export const GPU_QUERY_RING_SIZE = 4

/** Peso del sample nuevo en el promedio exponencial reportado. Mismo
 *  espíritu que el suavizado de fps en stats.ts (HUD_INTERVAL_MS): que el
 *  número se pueda leer en vez de parpadear con el ruido de cada sample. */
export const GPU_SMOOTHING_ALPHA = 0.15

/** Avanza un índice de ring buffer con wraparound. Pura, sin estado propio. */
export function advanceRingIndex(index: number, size: number): number {
  return (index + 1) % size
}

/** GLuint64 de nanosegundos (lo que devuelve QUERY_RESULT) a milisegundos. */
export function nsToMs(ns: number): number {
  return ns / 1_000_000
}

/** Promedio exponencial: pondera el sample nuevo por `alpha` contra el valor
 *  previo ya suavizado. */
export function smoothGpuSample(previous: number, sample: number, alpha: number): number {
  return previous + (sample - previous) * alpha
}

/** Pico: el mayor sample válido visto hasta ahora. No decae — un frame
 *  puntual sobre presupuesto (el 6%-33% de frames que encontró la auditoría)
 *  tiene que seguir visible aunque el promedio lo diluya. */
export function trackGpuPeak(previousPeak: number, sample: number): number {
  return sample > previousPeak ? sample : previousPeak
}

/**
 * Resuelve un resultado crudo de query. Si la GPU tuvo un evento disjoint
 * (cambio de power state, context switch, hiccup de driver) mientras la
 * query estaba en vuelo, el resultado es basura y hay que descartarlo:
 * reportar un número inventado es peor que reportar nada, que es exactamente
 * lo que este HUD existe para evitar.
 */
export function resolveGpuSample(rawNs: number, disjointOccurred: boolean): number | null {
  if (disjointOccurred) return null
  return nsToMs(rawNs)
}

/** Si el slot del ring en `index` todavía tiene un resultado pendiente de
 *  leer, no hay que pisarlo con una query nueva: se saltea la medición de
 *  este frame en vez de perder el resultado anterior sin leerlo. */
export function canBeginGpuQuery(pending: readonly boolean[], index: number): boolean {
  return !pending[index]
}

export type GpuTimerAvailability = 'unsupported' | 'available'

/** Estado derivado de si la extensión se encontró en este contexto. */
export function resolveGpuTimerAvailability(extensionFound: boolean): GpuTimerAvailability {
  return extensionFound ? 'available' : 'unsupported'
}

/** Forma mínima de EXT_disjoint_timer_query_webgl2 que este módulo usa.
 *  gl.getExtension() tipa como `any` en lib.dom.d.ts (no hay overload para
 *  este nombre): se recibe como `unknown` y se valida en tiempo de
 *  ejecución con isDisjointTimerQueryExt en vez de confiar en el tipo. */
interface DisjointTimerQueryExt {
  readonly TIME_ELAPSED_EXT: number
  readonly GPU_DISJOINT_EXT: number
}

function isDisjointTimerQueryExt(value: unknown): value is DisjointTimerQueryExt {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.TIME_ELAPSED_EXT === 'number' &&
    typeof candidate.GPU_DISJOINT_EXT === 'number'
  )
}

export interface GpuTimerStats {
  readonly availability: GpuTimerAvailability
  /** Milisegundos de GPU suavizados. -1 mientras no hay ninguna medición
   *  válida todavía (recién arrancando, o extensión no disponible). */
  gpuMs: number
  /** Pico de milisegundos de GPU observado desde que arrancó el timer.
   *  -1 en el mismo caso que gpuMs. */
  peakMs: number
}

export interface GpuTimer {
  readonly stats: GpuTimerStats
  /** Arranca la medición de este frame. Llamar antes de la primera pasada
   *  de render (mundo, con su clear). No-op si la extensión no está
   *  disponible o si el slot del ring que le toca sigue pendiente de leer. */
  beginFrame(): void
  /** Cierra la medición de este frame y revisa resultados pendientes.
   *  Llamar después de la última pasada de render (viewmodel, con su
   *  clearDepth) para que la medición cubra ambas pasadas y ambos clears. */
  endFrame(): void
}

/**
 * `gl` es `null` cuando el contexto de Three no resultó ser WebGL2 (no
 * debería pasar con este WebGLRenderer, pero engine/renderer.ts no fuerza
 * un cast: prefiere devolver null y que este módulo degrade). Sin contexto
 * WebGL2 o sin extensión, beginFrame/endFrame quedan como no-ops y
 * stats.gpuMs se queda en -1 para siempre — stats.ts ya interpreta ese
 * sentinel como "n/d" en el HUD.
 */
export function createGpuTimer(gl: WebGL2RenderingContext | null): GpuTimer {
  const rawExt: unknown = gl ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null
  const ext = isDisjointTimerQueryExt(rawExt) ? rawExt : null
  const availability = resolveGpuTimerAvailability(ext !== null)

  const stats: GpuTimerStats = { availability, gpuMs: -1, peakMs: -1 }

  if (!gl || !ext) {
    return {
      stats,
      beginFrame(): void {},
      endFrame(): void {},
    }
  }

  const activeGl: WebGL2RenderingContext = gl
  const activeExt: DisjointTimerQueryExt = ext

  // Ring preasignado una sola vez acá. beginFrame/endFrame de acá abajo no
  // crean objetos, arrays ni closures nuevos: sólo leen y mutan estos.
  const queries: WebGLQuery[] = []
  const pending: boolean[] = []
  for (let i = 0; i < GPU_QUERY_RING_SIZE; i++) {
    queries.push(activeGl.createQuery())
    pending.push(false)
  }

  let writeIndex = 0
  let frameHasQuery = false
  let hasSample = false

  return {
    stats,

    beginFrame(): void {
      if (!canBeginGpuQuery(pending, writeIndex)) {
        frameHasQuery = false
        return
      }
      activeGl.beginQuery(activeExt.TIME_ELAPSED_EXT, queries[writeIndex])
      frameHasQuery = true
    },

    endFrame(): void {
      if (frameHasQuery) {
        activeGl.endQuery(activeExt.TIME_ELAPSED_EXT)
        pending[writeIndex] = true
        writeIndex = advanceRingIndex(writeIndex, GPU_QUERY_RING_SIZE)
        frameHasQuery = false
      }

      // GPU_DISJOINT_EXT es una bandera con efecto de lectura (el driver la
      // resetea al leerla): se lee una sola vez por frame, no una vez por
      // query pendiente, y ese único valor decide todos los resultados que
      // se recojan en este mismo endFrame().
      const disjointValue: unknown = activeGl.getParameter(activeExt.GPU_DISJOINT_EXT)
      const disjointOccurred = disjointValue !== false

      for (let i = 0; i < GPU_QUERY_RING_SIZE; i++) {
        if (!pending[i]) continue
        const query = queries[i]
        const isAvailable: unknown = activeGl.getQueryParameter(
          query,
          activeGl.QUERY_RESULT_AVAILABLE,
        )
        if (isAvailable !== true) continue

        pending[i] = false

        const rawResult: unknown = activeGl.getQueryParameter(query, activeGl.QUERY_RESULT)
        const rawNs = typeof rawResult === 'number' ? rawResult : 0
        const sample = resolveGpuSample(rawNs, disjointOccurred || typeof rawResult !== 'number')
        if (sample === null) continue

        stats.gpuMs = hasSample ? smoothGpuSample(stats.gpuMs, sample, GPU_SMOOTHING_ALPHA) : sample
        stats.peakMs = trackGpuPeak(stats.peakMs, sample)
        hasSample = true
      }
    },
  }
}
