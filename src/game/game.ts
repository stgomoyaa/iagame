import { createFixedLoop } from '@/game/engine/fixed-loop'
import { createInputSystem } from '@/game/engine/input'
import { createRenderer } from '@/game/engine/renderer'
import { createStatsTracker, runBenchmark } from '@/game/engine/stats'
import type { FrameStats } from '@/game/engine/stats'
import { createTuningPanel } from '@/game/engine/tuning-panel'
import { ARENA } from '@/game/map/arena'
import { createPlayerState, stepPlayer } from '@/game/movement/step'

export interface Game {
  start(): void
  stop(): void
  /**
   * Costo en CPU de encolar `passes` llamadas a render(), sin esperar a que
   * la GPU termine de dibujar. Es una cota inferior del costo real de
   * frame, no una medida de capacidad o margen disponible.
   */
  benchmark(passes?: number): number
  readonly stats: FrameStats
}

const SENSITIVITY = 0.0022

export function createGame(canvas: HTMLCanvasElement): Game {
  const gfx = createRenderer(canvas)
  const stats = createStatsTracker()
  const tuning = createTuningPanel()
  const input = createInputSystem(() => SENSITIVITY)
  const loop = createFixedLoop()
  const player = createPlayerState(ARENA.spawns[0])

  let running = false
  let lastTime = 0
  let rafId = 0

  function onResize(): void {
    gfx.resize(canvas.clientWidth, canvas.clientHeight)
  }

  function frame(now: number): void {
    if (!running) return
    rafId = requestAnimationFrame(frame)
    stats.beginFrame()

    const frameDt = lastTime === 0 ? 0 : (now - lastTime) / 1000
    lastTime = now

    const ticks = loop.advance(frameDt)
    for (let i = 0; i < ticks; i++) {
      stepPlayer(player, input.player, ARENA.boxes)
    }

    // Interpolar la posición de la cámara entre el tick anterior y el actual.
    const a = loop.alpha
    gfx.camera.position.x = player.prevPosition.x + (player.position.x - player.prevPosition.x) * a
    gfx.camera.position.y =
      player.prevPosition.y + (player.position.y - player.prevPosition.y) * a + player.eyeHeight
    gfx.camera.position.z = player.prevPosition.z + (player.position.z - player.prevPosition.z) * a

    gfx.camera.rotation.set(input.pitch, input.player.yaw, 0, 'YXZ')

    gfx.renderer.info.reset()
    gfx.render()
    stats.endFrame(gfx.renderer.info.render.calls, gfx.renderer.info.render.triangles)
  }

  return {
    start(): void {
      if (running) return
      running = true
      lastTime = 0
      input.attach(canvas)
      if (canvas.parentElement) {
        stats.mount(canvas.parentElement)
        tuning.mount(canvas.parentElement)
      }
      window.addEventListener('resize', onResize)
      onResize()
      rafId = requestAnimationFrame(frame)
    },
    stop(): void {
      running = false
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      input.detach()
      stats.unmount()
      tuning.unmount()
      gfx.dispose()
    },
    benchmark(passes = 500): number {
      return runBenchmark(() => gfx.render(), passes)
    },
    get stats() {
      return stats.stats
    },
  }
}
