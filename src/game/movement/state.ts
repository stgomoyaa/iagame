import type { Vec3 } from '@/game/math/vec3'

export interface PlayerInput {
  /** -1 atrás, 1 adelante. */
  forward: number
  /** -1 izquierda, 1 derecha. */
  right: number
  /** Rotación horizontal de la cámara, en radianes. */
  yaw: number
  /** Estado sostenido, no flanco. El auto-hop depende de que sea sostenido. */
  jump: boolean
  sprint: boolean
  crouch: boolean
}

export interface PlayerState {
  position: Vec3
  velocity: Vec3
  /** Posición al inicio del tick anterior. El render interpola entre ésta y position. */
  prevPosition: Vec3

  grounded: boolean
  /** Segundos desde que dejó de estar en el suelo. Habilita el coyote time. */
  timeSinceGrounded: number
  /** Segundos desde que aterrizó. Habilita el skip de fricción del bhop. */
  timeSinceLanded: number
  /** Segundos desde que se presionó saltar. Habilita el jump buffering. */
  timeSinceJumpPressed: number
  jumpWasPressed: boolean

  sliding: boolean
  slideTime: number

  eyeHeight: number
}
