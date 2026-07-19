/**
 * Mapa 2, "torre": el mapa VERTICAL. 48x48m, un cuarto del tamaño de la
 * arena en superficie útil pero con cuatro alturas de juego en vez de dos.
 *
 * La idea de diseño, en una frase: en la arena peleás por CARRILES, acá
 * peleás por ALTURA. Toda la mitad interior es una pirámide escalonada
 * sólida (1.1 -> 2.2 -> 3.3 -> 4.4m) y el resto es un anillo perimetral de
 * 11m de ancho. Desde la cima se ve el anillo entero; desde el anillo casi
 * no se ve nada del otro lado del mapa, porque la pirámide tapa el centro.
 * Eso invierte la relación de la arena: ahí la ventaja era el ángulo
 * horizontal (rotar por un carril), acá es el escalón de arriba.
 *
 * Por qué la pirámide es SÓLIDA y no una torre con pisos y pasarelas:
 * el navgrid (bots/navgrid.ts) hornea UNA superficie caminable por columna
 * (x,z), la más alta con espacio para la cápsula. Una pasarela sobre el
 * piso haría que la columna de abajo reporte la altura de la pasarela, y
 * los bots pretenderían caminar por el techo del túnel. Con masa sólida no
 * hay ambigüedad: cada columna tiene exactamente una superficie, la que se
 * ve. La verticalidad se consigue apilando, no colgando. Esta restricción
 * es del navgrid 2.5D, no del gusto: está documentada acá porque es lo
 * primero que un mapa futuro va a querer romper.
 *
 * Cada escalón sube 1.1m, por debajo del límite de mantle de 1.2m
 * (movement/tuning.ts), así que la cima se alcanza caminando desde
 * cualquier lado sin saltar -- y map/invariants.ts lo verifica en vez de
 * confiar en que los números de acá estén bien.
 */

import type { Box, MapDef } from '@/game/map/types'
import { box } from '@/game/map/box'
import { vec3 } from '@/game/math/vec3'

const HALF = 24
const WALL_H = 8
const WALL_T = 1

/** Cobertura baja: se mantlea y se dispara por encima. */
const LOW = 1.0
/** Cobertura alta: bloquea línea de vista de pie. */
const HIGH = 2.2

/** Altura de cada escalón de la pirámide. Debajo de MOVEMENT.mantleMaxHeight
 *  (1.2m) a propósito: subir es caminar, no una maniobra. */
const PASO = 1.1

/**
 * Cobertura que rompe la línea de vista LARGA del anillo. Sin esto, cada
 * lado del anillo es un pasillo recto de 46m contra dos spawns: la peor
 * pelea posible en un mapa que se supone que trata de altura.
 *
 * Están a 6m de la falda de la pirámide y a 11m de las plataformas de
 * esquina, contra un alcance de salto de ~4.7m: no hay escalera de dos
 * pasos hasta arriba de ninguna. Ese chequeo lo hace map/invariants.ts, no
 * la buena fe de este comentario.
 */
const coberturaBloqueante: Box[] = [
  box(18, 0, -4, 20, HIGH, 4),
  box(-20, 0, -4, -18, HIGH, 4),
  box(-4, 0, 18, 4, HIGH, 20),
  box(-4, 0, -20, 4, HIGH, -18),
]

const boxes: Box[] = [
  // Piso
  box(-HALF, -1, -HALF, HALF, 0, HALF),

  // Muros perimetrales
  box(-HALF, 0, -HALF, HALF, WALL_H, -HALF + WALL_T),
  box(-HALF, 0, HALF - WALL_T, HALF, WALL_H, HALF),
  box(-HALF, 0, -HALF, -HALF + WALL_T, WALL_H, HALF),
  box(HALF - WALL_T, 0, -HALF, HALF, WALL_H, HALF),

  // Pirámide central: cuatro niveles anidados, 3m de ancho por escalón (tres
  // celdas de navgrid, suficiente para que un bot camine por el escalón y no
  // sólo lo cruce). Anidadas y no apiladas por una razón concreta: cada
  // nivel se solapa en planta con el de abajo, que es exactamente lo que
  // pide el chequeo de alcanzabilidad para aceptar que hay un escalón de
  // apoyo REAL debajo y no uno en la otra punta del mapa.
  box(-12, 0, -12, 12, PASO, 12),
  box(-9, 0, -9, 9, PASO * 2, 9),
  box(-6, 0, -6, 6, PASO * 3, 6),
  box(-3, 0, -3, 3, PASO * 4, 3),

  ...coberturaBloqueante,

  // Plataformas de esquina: la segunda altura del mapa. Escalón de 1.1m que
  // sube a una repisa de 2.2m mirando al anillo. No compiten con la cima
  // (4.4m) -- sirven para pelear el anillo desde arriba sin exponerse a
  // quien tiene la pirámide, y para dar un ángulo de tiro a quien acaba de
  // reaparecer en ese lado.
  box(14, 0, 14, 18, PASO, 18),
  box(16, 0, 16, 21, HIGH, 21),
  box(-18, 0, 14, -14, PASO, 18),
  box(-21, 0, 16, -16, HIGH, 21),
  box(14, 0, -18, 18, PASO, -14),
  box(16, 0, -21, 21, HIGH, -16),
  box(-18, 0, -18, -14, PASO, -14),
  box(-21, 0, -21, -16, HIGH, -16),

  // Cobertura baja suelta en las diagonales del anillo, entre la falda de la
  // pirámide y las plataformas de esquina. Va en las diagonales y no en el
  // medio de cada lado por una razón dura, no estética: una caja mantleable
  // de 1m a menos de ~4.7m de una cobertura alta la convierte en escalera de
  // dos pasos (el bug real de la arena). En el medio de cada lado quedaría a
  // 3m de la cobertura bloqueante; en la diagonal queda a 8.5m.
  box(12, 0, 12, 15, LOW, 15),
  box(-15, 0, 12, -12, LOW, 15),
  box(12, 0, -15, 15, LOW, -12),
  box(-15, 0, -15, -12, LOW, -12),
]

/**
 * Ocho spawns en el anillo, dos por lado, ninguno mirando de frente a otro:
 * los pares de cada lado están separados 20m y la pirámide corta cualquier
 * línea que cruce el centro.
 */
const spawns = [
  vec3(22, 0.1, 10), vec3(22, 0.1, -10),
  vec3(-22, 0.1, 10), vec3(-22, 0.1, -10),
  vec3(10, 0.1, 22), vec3(-10, 0.1, 22),
  vec3(10, 0.1, -22), vec3(-10, 0.1, -22),
]

export const TORRE: MapDef = {
  name: 'torre',
  boxes,
  spawns,
  bounds: box(-HALF, -1, -HALF, HALF, WALL_H, HALF),
  wallHeight: WALL_H,
  blockingCover: coberturaBloqueante,
}
