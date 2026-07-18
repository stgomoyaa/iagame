import { createFixedLoop } from '@/game/engine/fixed-loop'
import { createInputSystem } from '@/game/engine/input'
import { createRenderer } from '@/game/engine/renderer'
import { ARENA } from '@/game/map/arena'
import { createPlayerState, stepPlayer } from '@/game/movement/step'

export interface Game {
  start(): void
  stop(): void
}

const SENSITIVITY = 0.0022

export function createGame(canvas: HTMLCanvasElement): Game {
  const gfx = createRenderer(canvas)
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

    gfx.render()
  }

  return {
    start(): void {
      if (running) return
      running = true
      lastTime = 0
      input.attach(canvas)
      window.addEventListener('resize', onResize)
      onResize()
      rafId = requestAnimationFrame(frame)
    },
    stop(): void {
      running = false
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      input.detach()
      gfx.dispose()
    },
  }
}
