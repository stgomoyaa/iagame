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
      // Clampear por ambos lados: rechaza NaN y negativos, pero mantiene Infinity
      // clampeado a MAX_FRAME_DT para evitar envenenamiento permanente del
      // acumulador (NaN propaga) y alpha fuera de [0, 1).
      accumulator += Number.isFinite(frameDt)
        ? Math.min(Math.max(frameDt, 0), MAX_FRAME_DT)
        : Math.abs(frameDt) === Infinity
          ? MAX_FRAME_DT
          : 0

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
