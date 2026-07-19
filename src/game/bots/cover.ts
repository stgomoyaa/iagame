/**
 * Distancia a la cobertura más cercana, en el plano XZ.
 *
 * Lo usa el strafe de Enfrentar (bots/bot.ts): un bot que busca ángulo tiene
 * que moverse LATERALMENTE, pero moverse lateralmente sin condiciones lo
 * saca de detrás de la caja que lo estaba tapando y lo deja parado en campo
 * abierto pegando tiros -- que es peor que quedarse quieto. La regla es
 * simple y honesta: se permite el strafe mientras el candidato no quede
 * MÁS lejos de la cobertura que la posición actual (con una holgura). El bot
 * se desliza a lo largo de la cobertura en vez de abandonarla.
 *
 * "Cobertura" acá son las mismas cajas del mapa que ya usa la colisión
 * (map/types.ts Box), filtradas por altura: sólo cuentan las que de verdad
 * tapan algo (`minHeightM`). El piso y cualquier losa baja no son cobertura.
 * No conoce Three ni el BVH: matemática pura punto-contra-rectángulo, barata
 * de sobra para correr en el tick de IA de 15Hz (la arena tiene ~25 cajas).
 *
 * Es información de MAPA, no de enemigos: un bot puede saber dónde hay una
 * caja igual que un jugador que ya caminó la arena.
 */

import type { Box } from '@/game/map/types'

/**
 * Distancia (metros, plano XZ) de (x,z) a la caja de cobertura más cercana
 * con al menos `minHeightM` de alto. 0 si el punto cae dentro de la huella
 * de una. Infinity si no hay ninguna caja que califique.
 */
export function nearestCoverDistanceXZ(
  boxes: readonly Box[],
  x: number,
  z: number,
  minHeightM: number,
): number {
  let best = Infinity

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (b.max.y - Math.max(b.min.y, 0) < minHeightM) continue

    // Distancia punto-rectángulo: cero adentro, y afuera sólo cuenta el eje
    // (o los dos, en las esquinas) por el que el punto se salió.
    const dx = Math.max(b.min.x - x, 0, x - b.max.x)
    const dz = Math.max(b.min.z - z, 0, z - b.max.z)
    const d = dx === 0 ? dz : dz === 0 ? dx : Math.hypot(dx, dz)

    if (d < best) best = d
  }

  return best
}
