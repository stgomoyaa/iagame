import type { Box } from '@/game/map/types'
import { vec3 } from '@/game/math/vec3'

/**
 * Constructor de cajas de mapa: ordena min/max en los tres ejes, así una
 * definición escrita con las esquinas al revés no produce una AABB
 * degenerada que la colisión atravesaría en silencio.
 *
 * Vivía dentro de map/arena.ts, que era el único mapa. Con tres mapas pasa
 * acá para que ninguno tenga que importar a otro sólo por el helper.
 * arena.ts lo re-exporta: es su API pública desde antes de esta división.
 */
export function box(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): Box {
  return {
    min: vec3(Math.min(minX, maxX), Math.min(minY, maxY), Math.min(minZ, maxZ)),
    max: vec3(Math.max(minX, maxX), Math.max(minY, maxY), Math.max(minZ, maxZ)),
  }
}
