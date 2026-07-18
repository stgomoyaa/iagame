import { FRAME_BUDGET_MS } from '@/game/engine/constants'

export interface FrameStats {
  cpuMs: number
  /** -1 si la extensión de timing de GPU no está disponible. */
  gpuMs: number
  drawCalls: number
  triangles: number
  fps: number
  overBudget: boolean
}

export interface StatsTracker {
  readonly stats: FrameStats
  beginFrame(): void
  endFrame(drawCalls: number, triangles: number): void
  mount(parent: HTMLElement): void
  unmount(): void
}

/** El HUD se refresca 4 veces por segundo: escribir texto a 240Hz cuesta más que el juego. */
const HUD_INTERVAL_MS = 250

export function createStatsTracker(): StatsTracker {
  const stats: FrameStats = {
    cpuMs: 0, gpuMs: -1, drawCalls: 0, triangles: 0, fps: 0, overBudget: false,
  }

  let frameStart = 0
  let lastHudUpdate = 0
  let framesSinceHud = 0
  let hud: HTMLDivElement | null = null

  return {
    stats,

    beginFrame(): void {
      frameStart = performance.now()
    },

    endFrame(drawCalls: number, triangles: number): void {
      const now = performance.now()
      stats.cpuMs = now - frameStart
      stats.drawCalls = drawCalls
      stats.triangles = triangles
      stats.overBudget = stats.cpuMs > FRAME_BUDGET_MS

      framesSinceHud++
      const desdeHud = now - lastHudUpdate
      if (desdeHud >= HUD_INTERVAL_MS) {
        stats.fps = (framesSinceHud * 1000) / desdeHud
        framesSinceHud = 0
        lastHudUpdate = now

        if (hud) {
          const gpu = stats.gpuMs < 0 ? 'n/d' : `${stats.gpuMs.toFixed(2)}ms`
          hud.textContent =
            `${stats.fps.toFixed(0)} fps  |  cpu ${stats.cpuMs.toFixed(2)}ms  |  ` +
            `gpu ${gpu}  |  ${stats.drawCalls} draws  |  ` +
            `${(stats.triangles / 1000).toFixed(1)}k tris  |  ` +
            `presupuesto ${FRAME_BUDGET_MS}ms`
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
 * Mide throughput crudo del motor corriendo N pasadas de render seguidas sin
 * esperar al vsync. Es el número de "FPS del motor" independiente de los Hz
 * del monitor: en un panel de 240Hz nunca se dibujan más de 240 frames, pero
 * esto revela cuánto margen real queda.
 *
 * Devuelve el promedio de milisegundos por pasada.
 */
export function runBenchmark(render: () => void, passes: number): number {
  const inicio = performance.now()
  for (let i = 0; i < passes; i++) render()
  return (performance.now() - inicio) / passes
}
