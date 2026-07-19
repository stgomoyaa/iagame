/**
 * Mapa 3, "búnker": el mapa CERRADO. 40x40m divididos en nueve salas por
 * dos pares de muros de 4m con puertas desalineadas.
 *
 * La idea de diseño, en una frase: en la arena y en la torre ves venir al
 * enemigo; acá te lo encontrás. Ninguna línea de vista recta cruza el mapa
 * (las puertas de muros paralelos están corridas a propósito, ver el
 * comentario de cada muro), así que la distancia típica de combate cae de
 * los 20-40m de la arena a los 5-12m de una sala. El mapa premia lo
 * contrario: escuchar, cortar esquinas, y aceptar que te van a flanquear
 * porque cada sala tiene dos o tres puertas.
 *
 * Muros de 4m y no de 2.2m: a 2.2m un jugador ve por encima al saltar y el
 * mapa se convierte en la arena con más cajas. A 4m no se ve ni se sube
 * (desde el piso el alcance real es ~2.16m; encadenando una caja mantleable
 * de 1m, ~3.16m), y map/invariants.ts lo verifica en vez de creerle a este
 * comentario.
 *
 * Sin techos, igual que la torre no tiene pasarelas: el navgrid hornea una
 * superficie caminable por columna, y un techo haría que los bots
 * consideraran caminable el techo en vez del pasillo de abajo. "Cerrado"
 * acá es cerrado en planta -- muros y puertas -- no cubierto.
 */

import type { Box, MapDef } from '@/game/map/types'
import { box } from '@/game/map/box'
import { vec3 } from '@/game/math/vec3'

const HALF = 20
const WALL_H = 4
const WALL_T = 1

/** Cobertura baja: se mantlea y se dispara por encima. */
const LOW = 1.0
/** Cobertura alta: bloquea línea de vista de pie. */
const HIGH = 2.2

/**
 * Los dos bloques de la sala central. Existen para que la única línea recta
 * larga que sobrevive al trazado (la que enhebra la puerta oeste con la
 * puerta este, ambas a la altura de z=0) no sea un pasillo de tiro de 40m
 * de punta a punta. La cobertura baja más cercana está a 8m, contra un
 * alcance de salto de ~4.7m: no se suben.
 */
const coberturaBloqueante: Box[] = [
  box(-4, 0, -1, -2, HIGH, 1),
  box(2, 0, -1, 4, HIGH, 1),
]

const boxes: Box[] = [
  // Piso
  box(-HALF, -1, -HALF, HALF, 0, HALF),

  // Muros perimetrales
  box(-HALF, 0, -HALF, HALF, WALL_H, -HALF + WALL_T),
  box(-HALF, 0, HALF - WALL_T, HALF, WALL_H, HALF),
  box(-HALF, 0, -HALF, -HALF + WALL_T, WALL_H, HALF),
  box(HALF - WALL_T, 0, -HALF, HALF, WALL_H, HALF),

  // Muro interior oeste (x = -6.5). Puertas en z (-12,-8), (-2,2) y (9,13).
  box(-7, 0, -19, -6, WALL_H, -12),
  box(-7, 0, -8, -6, WALL_H, -2),
  box(-7, 0, 2, -6, WALL_H, 9),
  box(-7, 0, 13, -6, WALL_H, 19),

  // Muro interior este (x = 6.5). Puertas en z (-4,0) y (11,15): corridas
  // respecto de las del muro oeste para que ninguna línea este-oeste
  // atraviese los dos muros. La única que casi lo hace -- la puerta oeste
  // de z(-2,2) contra la este de z(-4,0), que se solapan en z(-2,0) -- es
  // justo la que cortan los dos bloques de la sala central.
  box(6, 0, -19, 7, WALL_H, -4),
  box(6, 0, 0, 7, WALL_H, 11),
  box(6, 0, 15, 7, WALL_H, 19),

  // Muro interior sur (z = -6.5). Puertas en x (-13,-9) y (8,12).
  box(-19, 0, -7, -13, WALL_H, -6),
  box(-9, 0, -7, 8, WALL_H, -6),
  box(12, 0, -7, 19, WALL_H, -6),

  // Muro interior norte (z = 6.5). Puertas en x (-16,-12) y (1,5),
  // desalineadas respecto de las del muro sur por el mismo motivo.
  box(-19, 0, 6, -16, WALL_H, 7),
  box(-12, 0, 6, 1, WALL_H, 7),
  box(5, 0, 6, 19, WALL_H, 7),

  ...coberturaBloqueante,

  // Cobertura baja, una por sala exterior: algo que mantlear y detrás de lo
  // que agacharse en peleas de 5-10m. Todas a 8m o más de la cobertura alta
  // de la sala central, para no habilitar la escalera de dos pasos.
  box(-15, 0, 11, -12, LOW, 14),
  box(-2, 0, 12, 2, LOW, 15),
  box(12, 0, 11, 15, LOW, 14),
  box(-15, 0, -2, -12, LOW, 2),
  box(12, 0, -2, 15, LOW, 2),
  box(-15, 0, -14, -12, LOW, -11),
  box(-2, 0, -15, 2, LOW, -12),
  box(12, 0, -14, 15, LOW, -11),
]

/** Ocho spawns, uno por sala exterior: nadie reaparece en la sala central
 *  (la más disputada) ni en la misma sala que otro. */
const spawns = [
  vec3(-16, 0.1, 16), vec3(0, 0.1, 16), vec3(16, 0.1, 16),
  vec3(-16, 0.1, 0), vec3(16, 0.1, 0),
  vec3(-16, 0.1, -16), vec3(0, 0.1, -16), vec3(16, 0.1, -16),
]

export const BUNKER: MapDef = {
  name: 'bunker',
  boxes,
  spawns,
  bounds: box(-HALF, -1, -HALF, HALF, WALL_H, HALF),
  wallHeight: WALL_H,
  blockingCover: coberturaBloqueante,
}
