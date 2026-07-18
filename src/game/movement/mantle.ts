import type { Box } from '@/game/map/types'
import type { Vec3 } from '@/game/math/vec3'
import { MOVEMENT } from '@/game/movement/tuning'
import { PLAYER_CAPSULE } from '@/game/physics/capsule'

/** Cuánto por delante de los pies se sondea la repisa. */
const PROBE_DISTANCE = 0.6
/** Cuánto por debajo del tope se sondea, para confirmar que cae sobre la cara superior. */
const TOP_EPSILON = 0.01

function contienePunto(b: Box, x: number, y: number, z: number): boolean {
  return (
    x > b.min.x && x < b.max.x &&
    y > b.min.y && y < b.max.y &&
    z > b.min.z && z < b.max.z
  )
}

function espacioLibre(
  boxes: Box[],
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
): boolean {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (
      x + r > b.min.x && x - r < b.max.x &&
      y + h > b.min.y && y < b.max.y &&
      z + r > b.min.z && z - r < b.max.z
    ) {
      return false
    }
  }
  return true
}

/**
 * Sube automáticamente a repisas bajas cuando el jugador se mueve contra
 * ellas en el aire. Es lo que convierte las cajas de 1m de la arena en
 * parte del flujo de movimiento en vez de obstáculos que cortan el ritmo.
 *
 * Devuelve true y modifica `position` si el mantle procede.
 */
export function tryMantle(
  position: Vec3,
  velocity: Vec3,
  wishDir: Vec3,
  boxes: Box[],
): boolean {
  const velHorizontal = Math.hypot(velocity.x, velocity.z)
  if (velHorizontal < MOVEMENT.mantleMinSpeed) return false

  const dirLen = Math.hypot(wishDir.x, wishDir.z)
  if (dirLen < 1e-6) return false

  // La velocidad debe tener componente positiva hacia donde se apunta:
  // rozar una repisa yendo hacia atrás no debe subirte a ella.
  if (velocity.x * wishDir.x + velocity.z * wishDir.z <= 0) return false

  const probeX = position.x + (wishDir.x / dirLen) * PROBE_DISTANCE
  const probeZ = position.z + (wishDir.z / dirLen) * PROBE_DISTANCE

  let ledgeTop = -Infinity
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    const ledgeHeight = b.max.y - position.y
    if (ledgeHeight <= 0 || ledgeHeight > MOVEMENT.mantleMaxHeight) continue

    // El punto de sondeo debe caer sobre la cara superior de esta caja.
    if (probeX <= b.min.x || probeX >= b.max.x) continue
    if (probeZ <= b.min.z || probeZ >= b.max.z) continue
    if (!contienePunto(b, probeX, b.max.y - TOP_EPSILON, probeZ)) continue

    if (b.max.y > ledgeTop) ledgeTop = b.max.y
  }

  if (ledgeTop === -Infinity) return false

  // Espacio libre: la cápsula debe caber parada sobre la repisa antes de
  // teletransportar al jugador ahí arriba.
  if (!espacioLibre(boxes, probeX, ledgeTop, probeZ, PLAYER_CAPSULE.radius, PLAYER_CAPSULE.height)) {
    return false
  }

  position.x = probeX
  position.y = ledgeTop
  position.z = probeZ
  return true
}
