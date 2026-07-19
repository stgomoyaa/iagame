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
  /**
   * Multiplicador de velocidad de movimiento por ADS (sección 4 del spec
   * de fase 1: "velocidad de movimiento: multiplica por speedScale").
   * Opcional para no romper los ~370 tests existentes que arman un
   * PlayerInput sin este campo — `undefined` se trata como 1 (sin efecto),
   * ver targetSpeed() en step.ts. game.ts lo escribe cada frame con el
   * valor interpolado de combat/ads.ts (adsSpeedMultiplier), no un booleano
   * fijo: así la desaceleración entra suave junto con la transición visual
   * del ADS, no de golpe.
   */
  adsSpeedScale?: number
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
  /** Estado de crouch del tick anterior. El slide entra por flanco de subida,
   *  no por tecla mantenida: mantener agachado tras el slide sólo camina
   *  agachado, en vez de re-entrar en slide para siempre. */
  crouchWasPressed: boolean

  sliding: boolean
  slideTime: number
  /** Segundos desde que terminó el último slide (por cualquier vía: expiró,
   *  se soltó agachar o se canceló saltando). Habilita el cooldown de
   *  entrada: sin esto, re-presionar agachar reaplica el boost sobre una
   *  velocidad ya boosteada y crece sin límite. */
  timeSinceSlideEnded: number

  eyeHeight: number
}
