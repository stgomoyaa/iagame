/**
 * Constructores de brushes convexos para armar mapas de prueba a mano.
 *
 * Los mapas reales de este tipo llegan como JSON desde `scripts/bsp-convert.ts`
 * (map/source-map.ts). Eso sirve para probar la CARGA, pero no para probar la
 * navegación: un test que quiere afirmar "una rampa de 30 grados es caminable
 * y una de 60 no" necesita construir exactamente esas dos rampas, no salir a
 * buscarlas dentro de nuketown y esperar que existan.
 *
 * Vive en `src/game/map` y no dentro de un archivo de test porque lo usan dos
 * (bots/navgrid-convexos.test.ts y bots/coherencia-fisica.test.ts) y porque
 * lo que produce son `Convex` de verdad, los mismos que come la colisión: si
 * mañana cambia la representación de un brush, esto deja de compilar, que es
 * exactamente lo que uno quiere que pase.
 */

import type { Convex, MapDef } from '@/game/map/types'
import { vec3 } from '@/game/math/vec3'

function convexo(planes: number[], min: [number, number, number], max: [number, number, number]): Convex {
  return {
    planes: new Float32Array(planes),
    count: planes.length / 4,
    min: vec3(min[0], min[1], min[2]),
    max: vec3(max[0], max[1], max[2]),
  }
}

/** Caja alineada a los ejes, pero expresada como brush convexo (seis
 *  semiespacios) -- o sea recorriendo el MISMO código que un brush importado,
 *  no el atajo de `Box`. */
export function cajaConvexa(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Convex {
  return convexo(
    [
      1, 0, 0, maxX,
      -1, 0, 0, -minX,
      0, 1, 0, maxY,
      0, -1, 0, -minY,
      0, 0, 1, maxZ,
      0, 0, -1, -minZ,
    ],
    [minX, minY, minZ],
    [maxX, maxY, maxZ],
  )
}

/**
 * Cuña: una rampa que sube a lo largo de +X, de `y0` en `x0` hasta `y1` en
 * `x1`, ancha entre `z0` y `z1`. Maciza hacia abajo (un metro por debajo de
 * `y0`) para que apoye en el piso en vez de flotar.
 *
 * La normal de la cara inclinada se deriva de la propia pendiente y queda
 * unitaria, como las que produce el conversor de BSP: `(-dy, dx, 0) / |d|`.
 * Para una subida de 45 grados eso da ny = 1/sqrt(2), justo el umbral de
 * `esNormalPisable` -- lo que hace de esta función el instrumento con el que
 * se mide dónde está de verdad el corte.
 */
export function cuna(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
): Convex {
  const dx = x1 - x0
  const dy = y1 - y0
  const largo = Math.hypot(dx, dy)
  const nx = -dy / largo
  const ny = dx / largo
  const d = nx * x0 + ny * y0
  const base = y0 - 1

  return convexo(
    [
      nx, ny, 0, d,
      0, -1, 0, -base,
      1, 0, 0, x1,
      -1, 0, 0, -x0,
      0, 0, 1, z1,
      0, 0, -1, -z0,
    ],
    [x0, base, z0],
    [x1, Math.max(y0, y1), z1],
  )
}

/** `MapDef` hecho sólo de brushes, como los importados: `boxes` vacío. */
export function mapaDeBrushes(
  convexes: Convex[],
  bounds: { min: [number, number, number]; max: [number, number, number] },
  spawns: Array<[number, number, number]> = [],
): MapDef {
  return {
    name: 'brushes-de-prueba',
    boxes: [],
    convexes,
    spawns: spawns.map((s) => vec3(s[0], s[1], s[2])),
    bounds: {
      min: vec3(bounds.min[0], bounds.min[1], bounds.min[2]),
      max: vec3(bounds.max[0], bounds.max[1], bounds.max[2]),
    },
  }
}
