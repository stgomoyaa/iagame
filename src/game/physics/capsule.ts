import type { Box } from '@/game/map/types'
import type { Vec3 } from '@/game/math/vec3'

export interface Capsule {
  radius: number
  /** Altura total, de los pies a la coronilla. */
  height: number
}

export const PLAYER_CAPSULE: Capsule = { radius: 0.4, height: 1.8 }

export interface MoveResult {
  hitGround: boolean
  hitCeiling: boolean
  hitWall: boolean
}

/** Tolerancia para no re-resolver contactos de apoyo cada tick. */
const SKIN = 1e-4

/**
 * Aproximamos la cápsula por su AABB envolvente. Para un mundo de cajas
 * alineadas a los ejes la diferencia visible es nula, y evita el costo de
 * calcular el punto más cercano del segmento capsular por caja.
 */
function overlapAndResolve(
  position: Vec3,
  capsule: Capsule,
  b: Box,
  out: MoveResult,
): void {
  const minX = position.x - capsule.radius
  const maxX = position.x + capsule.radius
  const minY = position.y
  const maxY = position.y + capsule.height
  const minZ = position.z - capsule.radius
  const maxZ = position.z + capsule.radius

  const overlapX = Math.min(maxX, b.max.x) - Math.max(minX, b.min.x)
  if (overlapX <= SKIN) return
  const overlapY = Math.min(maxY, b.max.y) - Math.max(minY, b.min.y)
  if (overlapY <= SKIN) return
  const overlapZ = Math.min(maxZ, b.max.z) - Math.max(minZ, b.min.z)
  if (overlapZ <= SKIN) return

  // Empujar por el eje de menor penetración.
  if (overlapY <= overlapX && overlapY <= overlapZ) {
    const centroY = position.y + capsule.height * 0.5
    const cajaCentroY = (b.min.y + b.max.y) * 0.5
    if (centroY >= cajaCentroY) {
      position.y += overlapY
      out.hitGround = true
    } else {
      position.y -= overlapY
      out.hitCeiling = true
    }
    return
  }

  if (overlapX <= overlapZ) {
    position.x += position.x >= (b.min.x + b.max.x) * 0.5 ? overlapX : -overlapX
  } else {
    position.z += position.z >= (b.min.z + b.max.z) * 0.5 ? overlapZ : -overlapZ
  }
  out.hitWall = true
}

export function resolveMove(
  position: Vec3,
  delta: Vec3,
  capsule: Capsule,
  boxes: Box[],
  out: MoveResult,
): void {
  out.hitGround = false
  out.hitCeiling = false
  out.hitWall = false

  const distancia = Math.hypot(delta.x, delta.y, delta.z)
  const maxPaso = capsule.radius * 0.5
  const substeps = distancia > maxPaso ? Math.ceil(distancia / maxPaso) : 1
  const inv = 1 / substeps

  const stepX = delta.x * inv
  const stepY = delta.y * inv
  const stepZ = delta.z * inv

  for (let s = 0; s < substeps; s++) {
    position.x += stepX
    position.y += stepY
    position.z += stepZ

    // Dos pasadas: la primera resuelve la penetración dominante, la segunda
    // limpia las que aparecen al haber movido la cápsula en la primera.
    for (let pasada = 0; pasada < 2; pasada++) {
      for (let i = 0; i < boxes.length; i++) {
        overlapAndResolve(position, capsule, boxes[i], out)
      }
    }
  }
}
