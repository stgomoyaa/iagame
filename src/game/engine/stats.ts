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
  let hudWindowStarted = false
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
