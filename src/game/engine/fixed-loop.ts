import { TICK_DT } from '@/game/engine/constants'
import { sanitizeDt } from '@/game/engine/dt'

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
      // Ver engine/dt.ts: sanitizeDt es el guard compartido contra NaN,
      // infinitos y deltas negativos que un clamp de sólo min/max no cubre.
      accumulator += sanitizeDt(frameDt)

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
