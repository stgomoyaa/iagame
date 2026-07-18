import type { Vec3 } from '@/game/math/vec3'

/**
 * Aceleración estilo Quake. Sólo agrega velocidad en `wishDir`, y sólo hasta
 * que la proyección de la velocidad actual sobre `wishDir` alcance `wishSpeed`.
 *
 * Esa proyección es la razón de que exista el air-strafe: si vas rápido hacia
 * adelante y mirás a un costado, la proyección sobre la nueva dirección es
 * casi cero, así que todavía te queda margen para acelerar.
 */
export function accelerate(
  velocity: Vec3,
  wishDir: Vec3,
  wishSpeed: number,
  accel: number,
  dt: number,
): void {
  const currentSpeed = velocity.x * wishDir.x + velocity.z * wishDir.z
  const addSpeed = wishSpeed - currentSpeed
  if (addSpeed <= 0) return

  let accelSpeed = accel * dt * wishSpeed
  if (accelSpeed > addSpeed) accelSpeed = addSpeed

  velocity.x += wishDir.x * accelSpeed
  velocity.z += wishDir.z * accelSpeed
}

/**
 * Fricción en el plano horizontal. `stopSpeed` actúa como piso del cálculo:
 * por debajo de esa velocidad el frenado es proporcionalmente más fuerte, lo
 * que hace que detenerse se sienta firme en vez de resbaloso.
 */
export function applyFriction(
  velocity: Vec3,
  friction: number,
  stopSpeed: number,
  dt: number,
): void {
  const speed = Math.hypot(velocity.x, velocity.z)
  if (speed < 1e-4) {
    velocity.x = 0
    velocity.z = 0
    return
  }

  const control = speed < stopSpeed ? stopSpeed : speed
  const drop = control * friction * dt
  const newSpeed = speed - drop

  if (newSpeed <= 0) {
    velocity.x = 0
    velocity.z = 0
    return
  }

  const scale = newSpeed / speed
  velocity.x *= scale
  velocity.z *= scale
}
