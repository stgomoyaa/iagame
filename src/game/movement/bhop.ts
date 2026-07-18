import type { Vec3 } from '@/game/math/vec3'
import type { PlayerInput, PlayerState } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'

/**
 * Con `jump` sostenido y un aterrizaje muy reciente, se omite la fricción de
 * ese tick. Sin esto, un único frame de fricción a 8.0 borra la velocidad que
 * costó varios saltos acumular, y el bhop no se siente como recompensa.
 */
export function shouldSkipFriction(state: PlayerState, input: PlayerInput): boolean {
  return input.jump && state.timeSinceLanded <= MOVEMENT.bhopFrictionSkipWindow
}

/**
 * Decaimiento exponencial del exceso por encima del tope, en vez de un corte
 * duro. Un corte se siente como chocar un muro invisible; el decay se siente
 * como resistencia del aire.
 */
export function applySoftCap(velocity: Vec3, cap: number, decay: number, dt: number): void {
  const speed = Math.hypot(velocity.x, velocity.z)
  if (speed <= cap) return

  const exceso = speed - cap
  const nuevoExceso = exceso * Math.exp(-decay * dt)
  const scale = (cap + nuevoExceso) / speed

  velocity.x *= scale
  velocity.z *= scale
}
