import { MAX_FRAME_DT, TICK_DT } from '@/game/engine/constants'

export interface FixedLoop {
  /** Consume el tiempo del frame. Devuelve cuántos ticks debe correr el llamador. */
  advance(frameDt: number): number
  /** Fracción 0..1 entre el penúltimo y el último tick, para interpolar el render. */
  readonly alpha: number
  /** Ticks devueltos por la última llamada a advance. */
  readonly ticksLastFrame: number
}

export function createFixedLoop(): FixedLoop {
  let accumulator = 0
  let alpha = 0
  let ticksLastFrame = 0

  return {
    advance(frameDt: number): number {
      // NaN es el único caso que las clamps no cubren: se propagaría al
      // acumulador y congelaría la simulación para siempre. Las dos clamps
      // ya resuelven ambos infinitos y los deltas negativos por sí solas.
      accumulator += Number.isNaN(frameDt)
        ? 0
        : Math.min(Math.max(frameDt, 0), MAX_FRAME_DT)

      let ticks = 0
      while (accumulator >= TICK_DT) {
        accumulator -= TICK_DT
        ticks++
      }

      ticksLastFrame = ticks
      alpha = accumulator / TICK_DT
      return ticks
    },
    get alpha() {
      return alpha
    },
    get ticksLastFrame() {
      return ticksLastFrame
    },
  }
}
