import { FRAME_BUDGET_MS } from '@/game/engine/constants'
import type { ProfilerStats } from '@/game/engine/profiler'

export interface FrameStats {
  cpuMs: number
  /** Suavizado (ver engine/gpu-timer.ts). -1 si todavía no hay ninguna
   *  medición válida: extensión no disponible, o disponible pero sin
   *  resultado resuelto todavía. */
  gpuMs: number
  /** Pico de gpuMs observado desde que arrancó el timer. Mismo sentinel -1
   *  que gpuMs. Sin esto, el 6%-33% de frames que la auditoría encontró
   *  sobre presupuesto queda invisible detrás del promedio suavizado. */
  gpuPeakMs: number
  drawCalls: number
  triangles: number
  fps: number
  overBudget: boolean
}

export interface StatsTracker {
  readonly stats: FrameStats
  beginFrame(): void
  /** gpuMs/gpuPeakMs son opcionales y quedan en -1 por defecto: el timer de
   *  GPU (engine/gpu-timer.ts) recién resuelve resultados varios frames
   *  después de haberlos arrancado, así que game.ts los pasa acá cuando los
   *  tiene. Los tests de este tracker no necesitan simular eso.
   *  profilerStats es igual de opcional: el desglose por sistema
   *  (engine/profiler.ts) se agrega a la línea del HUD si viene, pero este
   *  tracker no depende de él para nada de lo que ya hacía. */
  endFrame(
    drawCalls: number,
    triangles: number,
    gpuMs?: number,
    gpuPeakMs?: number,
    profilerStats?: ProfilerStats,
  ): void
  mount(parent: HTMLElement): void
  unmount(): void
}

/** El HUD se refresca 4 veces por segundo: escribir texto a 240Hz cuesta más que el juego. */
const HUD_INTERVAL_MS = 250

/** Mediana/p95 de una sección, "0.12/0.34" -- ver formatProfilerBreakdown. */
function formatProfilerSection(s: { medianMs: number; p95Ms: number }): string {
  return `${s.medianMs.toFixed(2)}/${s.p95Ms.toFixed(2)}`
}

/** Arma el segmento de desglose por sistema que se agrega al final de la
 *  línea del HUD (ver el bloque de abajo, dentro de HUD_INTERVAL_MS -- esto
 *  NO corre cada frame, mismo throttle que ya tenía el resto de la línea).
 *  Nombres de sección tal cual vienen de engine/profiler.ts
 *  (fisica/ia/combate/feedback/viewmodel/render/otro): mismo vocabulario en
 *  el código, los comentarios y la pantalla, sin abreviar -- es un HUD de
 *  diagnóstico, no hace falta ahorrar caracteres a costa de tener que
 *  recordar qué significa cada sigla. */
function formatProfilerBreakdown(p: ProfilerStats): string {
  return (
    `fisica ${formatProfilerSection(p.fisica)}  ia ${formatProfilerSection(p.ia)}  ` +
    `combate ${formatProfilerSection(p.combate)}  feedback ${formatProfilerSection(p.feedback)}  ` +
    `viewmodel ${formatProfilerSection(p.viewmodel)}  render ${formatProfilerSection(p.render)}  ` +
    `otro ${formatProfilerSection(p.otro)}  (mediana/p95 ms)`
  )
}

export function createStatsTracker(): StatsTracker {
  const stats: FrameStats = {
    cpuMs: 0, gpuMs: -1, gpuPeakMs: -1, drawCalls: 0, triangles: 0, fps: 0, overBudget: false,
  }

  let frameStart = 0
  let lastHudUpdate = 0
  let hudWindowStarted = false
  let framesSinceHud = 0
  let hud: HTMLDivElement | null = null

  return {
    stats,

    beginFrame(): void {
      frameStart = performance.now()
    },

    endFrame(
      drawCalls: number,
      triangles: number,
      gpuMs = -1,
      gpuPeakMs = -1,
      profilerStats?: ProfilerStats,
    ): void {
      const now = performance.now()
      stats.cpuMs = now - frameStart
      stats.gpuMs = gpuMs
      stats.gpuPeakMs = gpuPeakMs
      stats.drawCalls = drawCalls
      stats.triangles = triangles

      // El comentario de FRAME_BUDGET_MS dice "CPU + GPU" porque así está
      // redactado el spec, pero el veredicto acá abajo usa el máximo, no la
      // suma, y es a propósito: el CPU arma el frame N+1 mientras la GPU
      // todavía está dibujando el frame N (ver el comentario de
      // runBenchmark más abajo sobre ese pipelining). El throughput
      // sostenido del juego está acotado por la mitad más lenta de las dos,
      // no por su total — sumarlas penalizaría un frame perfectamente sano
      // donde CPU y GPU están bien encimadas sólo porque ninguna de las dos
      // está ociosa. Si gpuMs es -1 (todavía sin medición válida) el
      // veredicto queda como antes: sólo cpu.
      const peorMs = gpuMs >= 0 ? Math.max(stats.cpuMs, gpuMs) : stats.cpuMs
      stats.overBudget = peorMs > FRAME_BUDGET_MS

      // Semilla perezosa: el tracker puede crearse mucho antes de que arranque
      // el loop real (ver game.ts), así que performance.now() en la creación
      // seguiría arrastrando el tiempo de carga/hidratación de la página. Se
      // ancla la ventana de fps al primer endFrame observado, no al momento
      // en que se instanció el tracker.
      if (!hudWindowStarted) {
        lastHudUpdate = now
        hudWindowStarted = true
      }

      framesSinceHud++
      const desdeHud = now - lastHudUpdate
      if (desdeHud >= HUD_INTERVAL_MS) {
        stats.fps = (framesSinceHud * 1000) / desdeHud
        framesSinceHud = 0
        lastHudUpdate = now

        if (hud) {
          const gpu =
            stats.gpuMs < 0
              ? 'n/d'
              : `${stats.gpuMs.toFixed(2)}ms (pico ${stats.gpuPeakMs.toFixed(2)}ms)`
          hud.textContent =
            `${stats.fps.toFixed(0)} fps  |  cpu ${stats.cpuMs.toFixed(2)}ms  |  ` +
            `gpu ${gpu}  |  ${stats.drawCalls} draws  |  ` +
            `${(stats.triangles / 1000).toFixed(1)}k tris  |  ` +
            `presupuesto ${FRAME_BUDGET_MS}ms` +
            // Desglose por sistema (engine/profiler.ts): se agrega al final
            // de la MISMA línea, no reemplaza nada de lo de arriba (spec de
            // la tarea de profiling: "no cambies el formato de lo que el
            // HUD ya muestra"). profilerStats es opcional -- sin él (nadie
            // llamó a profiler.beginFrame/begin/end este frame, o game.ts
            // no lo pasó) la línea queda exactamente como antes.
            (profilerStats ? `  |  ${formatProfilerBreakdown(profilerStats)}` : '')
          hud.style.color = stats.overBudget ? '#ff5f5f' : '#5fff9f'
        }
      }
    },

    mount(parent: HTMLElement): void {
      hud = document.createElement('div')
      hud.style.cssText =
        'position:absolute;top:8px;left:8px;font:12px ui-monospace,monospace;' +
        'color:#5fff9f;background:rgba(0,0,0,.6);padding:6px 10px;' +
        'border-radius:4px;pointer-events:none;z-index:10;white-space:nowrap'
      parent.appendChild(hud)
    },

    unmount(): void {
      hud?.remove()
      hud = null
    },
  }
}

/**
 * Mide el costo en CPU de encolar `passes` llamadas a `render()` seguidas,
 * con `performance.now()`. `WebGLRenderer.render()` solo envía comandos a la
 * cola de la GPU y retorna de inmediato: no bloquea hasta que la GPU termina
 * de dibujar, y este bucle no tiene ningún punto de sincronización (no hay
 * `gl.finish()` ni equivalente). Por lo tanto este número mide únicamente el
 * costo de *submission* en CPU, no el costo real de un frame terminado.
 *
 * Es una cota inferior del costo de frame, no una estimación de capacidad ni
 * de margen disponible: una escena limitada por GPU puede reportar un número
 * casi nulo acá mientras la cola de comandos absorbe todo el atraso real.
 * No agregar `gl.finish()` para "arreglar" esto — forzar sync CPU/GPU en
 * cada pasada destruye el pipelining del que depende el juego real (CPU
 * armando el frame N+1 mientras la GPU dibuja el frame N), así que el
 * número resultante subestimaría el throughput alcanzable tan mal como este
 * lo sobreestima hoy.
 *
 * Devuelve el promedio de milisegundos de CPU por pasada de encolado.
 */
export function runBenchmark(render: () => void, passes: number): number {
  const inicio = performance.now()
  for (let i = 0; i < passes; i++) render()
  return (performance.now() - inicio) / passes
}
