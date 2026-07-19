import type { Box, MapDef } from '@/game/map/types'
import { vec3 } from '@/game/math/vec3'

export function box(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): Box {
  return {
    min: vec3(Math.min(minX, maxX), Math.min(minY, maxY), Math.min(minZ, maxZ)),
    max: vec3(Math.max(minX, maxX), Math.max(minY, maxY), Math.max(minZ, maxZ)),
  }
}

const HALF = 30
const WALL_H = 6
const WALL_T = 1

/** Cobertura baja: se mantlea y se dispara por encima. */
const LOW = 1.0
/** Cobertura alta: bloquea línea de vista de pie. */
const HIGH = 2.2

const boxes: Box[] = [
  // Piso
  box(-HALF, -1, -HALF, HALF, 0, HALF),

  // Muros perimetrales
  box(-HALF, 0, -HALF, HALF, WALL_H, -HALF + WALL_T),
  box(-HALF, 0, HALF - WALL_T, HALF, WALL_H, HALF),
  box(-HALF, 0, -HALF, -HALF + WALL_T, WALL_H, HALF),
  box(HALF - WALL_T, 0, -HALF, HALF, WALL_H, HALF),

  // Separadores de los tres carriles, con huecos para rotar. El extremo que
  // mira a la estructura central quedaba a sólo 3m (en Z, tocando en X) del
  // escalón de 1.1m de esa estructura: un salto+mantle desde el escalón
  // llegaba igual al tope de 2.2m del separador, aunque el separador nunca
  // estuviera cerca de una caja suelta de 1m. El hueco central se agranda de
  // 12m a 20m para sacar ese extremo del alcance de un salto (7m, contra un
  // alcance máximo de ~4.7m a velocidad de sprint). Ver arena.test.ts.
  box(-10, 0, -22, -9, HIGH, -10),
  box(-10, 0, 10, -9, HIGH, 22),
  box(9, 0, -22, 10, HIGH, -10),
  box(9, 0, 10, 10, HIGH, 22),

  // Estructura central: plataforma elevada con escalones a ambos lados.
  // Cada salto es de 1.1m, bajo el límite de mantle de 1.2m: floor -> 1.1 -> 2.2.
  box(-6, 0, -3, 6, HIGH, 3),
  box(-9, 0, -3, -6, HIGH / 2, 3),
  box(6, 0, -3, 9, HIGH / 2, 3),

  // Cobertura baja del carril izquierdo
  box(-24, 0, -14, -20, LOW, -10),
  box(-24, 0, 10, -20, LOW, 14),
  box(-18, 0, -2, -14, LOW, 2),

  // Cobertura baja del carril derecho (espejada)
  box(20, 0, -14, 24, LOW, -10),
  box(20, 0, 10, 24, LOW, 14),
  box(14, 0, -2, 18, LOW, 2),

  // Cobertura alta cerca de los spawns, para romper líneas de vista largas
  box(-4, 0, -26, 4, HIGH, -24),
  box(-4, 0, 24, 4, HIGH, 26),

  // Cajas mantleables sueltas para encadenar movimiento.
  // Las dos primeras estaban a 4m de un separador (cobertura alta, 2.2m):
  // dentro del alcance de un salto (~4.7m a velocidad de sprint), lo que las
  // convertía en el primer peldaño de una escalera de dos pasos hasta un
  // lugar que el mapa documenta como "bloquea línea de vista de pie". Quedan
  // a 8m del separador más cercano (casi el doble del alcance de un salto),
  // así que siguen sirviendo para encadenar movimiento cerca del spawn sin
  // habilitar la escalera. Ver arena.test.ts.
  box(-20, 0, -24, -18, LOW, -22),
  box(18, 0, 22, 20, LOW, 24),
  box(-2, 0, 12, 0, LOW, 14),
  box(0, 0, -14, 2, LOW, -12),
]

const spawns = [
  vec3(-25, 0.1, -25), vec3(-25, 0.1, 25),
  vec3(25, 0.1, -25), vec3(25, 0.1, 25),
  vec3(0, 0.1, -27), vec3(0, 0.1, 27),
  vec3(-27, 0.1, 0), vec3(27, 0.1, 0),
]

export const ARENA: MapDef = {
  name: 'arena',
  boxes,
  spawns,
  bounds: box(-HALF, -1, -HALF, HALF, WALL_H, HALF),
}
