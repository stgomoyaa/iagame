import type { Box } from '@/game/map/types'
import type { Vec3 } from '@/game/math/vec3'

export interface Capsule {
  radius: number
  /** Altura total, de los pies a la coronilla. */
  height: number
}

export const PLAYER_CAPSULE: Capsule = { radius: 0.4, height: 1.8 }

export interface MoveResult {
  /**
   * Edge-triggered, no de nivel: es `true` sólo en el tick en que la
   * corrección de penetración contra el suelo efectivamente disparó, no
   * mientras "el jugador está parado en el suelo". No hay ground probe: la
   * única señal de apoyo es esa corrección. Si el llamador deja de integrar
   * gravedad en `delta.y` al aterrizar, ya no hay penetración que corregir
   * tick a tick y `hitGround` vuelve a `false` en silencio aunque el
   * jugador siga quieto sobre el piso. Hay que seguir sumando gravedad a
   * `delta.y` todos los ticks, incluso estando apoyado, o el estado de "en
   * el suelo" queda obsoleto.
   */
  hitGround: boolean
  /** Edge-triggered igual que `hitGround`, pero para la corrección contra techo. */
  hitCeiling: boolean
  hitWall: boolean
}

/** Tolerancia para no re-resolver contactos de apoyo cada tick. */
const SKIN = 1e-4

/**
 * Techo de substeps por llamada. Cubre dos casos degenerados que si no,
 * cuelgan el loop: una cápsula con `radius <= 0` (maxPaso cae a 0 y
 * `distancia / maxPaso` se va a Infinity) y un delta con una magnitud
 * absurda. 64 es muy por encima de lo que cualquier movimiento legítimo
 * necesita a 128Hz (el caso de alta velocidad de los tests, a 40 m/s, sólo
 * pide 2 substeps con el radio del jugador), así que no toca ninguna
 * entrada normal.
 */
const MAX_SUBSTEPS = 64

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
  // Un delta no finito (NaN o Infinity) corrompería position para siempre:
  // nada más adelante la resetea. Mismo bug ya resuelto en fixed-loop.ts
  // (commits 0cfde05, 746fce3); acá se corta antes de tocar la posición,
  // con las flags ya en false por el reset de arriba.
  if (!Number.isFinite(distancia)) return

  const maxPaso = capsule.radius * 0.5
  const substepsCrudos = distancia > maxPaso ? Math.ceil(distancia / maxPaso) : 1
  const substeps = Math.min(Math.max(substepsCrudos, 1), MAX_SUBSTEPS)
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
