/**
 * Raycast del mapa contra un BVH construido una sola vez (three-mesh-bvh,
 * sección 1 del spec de fase 1: "ya está instalado como dependencia, nadie
 * lo usa todavía: es para esto"). Éste, junto con engine/renderer.ts,
 * map/mesh.ts y weapons/viewmodel/renderer.ts, es el único archivo de
 * src/game autorizado a importar three (ver architecture.test.ts):
 * three-mesh-bvh exige un Ray y una BufferGeometry reales, no alcanza con
 * un objeto {x,y,z} duck-typed.
 *
 * El resto del sistema de combate (hitboxes.ts, recoil.ts, spread.ts,
 * fire-control.ts, shot.ts) es matemática pura sin three: este archivo sólo
 * expone una función de primitivos (raycastMap) para que ese resto no
 * necesite saber que hay un MeshBVH detrás.
 */

import { BufferAttribute, BufferGeometry, Ray } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { ARENA } from '@/game/map/arena'
import type { Box } from '@/game/map/types'
import type { Vec3 } from '@/game/math/vec3'

/** Resultado de un raycast contra el mapa. Preasignado por el llamador. */
export interface MapHit {
  hit: boolean
  distance: number
}

/**
 * Geometría de colisión: 12 triángulos no indexados por caja (mismo conteo
 * que buildArenaGeometry en map/mesh.ts, pero sin normal ni color: acá sólo
 * importa la posición para el raycast). No comparte código con
 * map/mesh.ts a propósito — ese archivo arma la malla VISUAL con
 * BoxGeometry de Three; correr por 8 vértices a mano acá evita crear y
 * descartar una BoxGeometry por caja sólo para leer su buffer de posición.
 * Corre una sola vez al cargar el módulo, nunca en el camino de disparo:
 * los closures y el array literal de `verts` no cuentan contra el
 * presupuesto de cero asignaciones por disparo.
 */
function buildCollisionGeometry(boxes: Box[]): BufferGeometry {
  const positions = new Float32Array(boxes.length * 36 * 3)
  let o = 0

  for (const b of boxes) {
    const x0 = b.min.x
    const x1 = b.max.x
    const y0 = b.min.y
    const y1 = b.max.y
    const z0 = b.min.z
    const z1 = b.max.z

    // 6 caras x 2 triángulos x 3 vértices. La orientación (sentido de
    // devanado) no importa para raycastFirst con el side por defecto
    // (FrontSide evaluado desde afuera): el jugador siempre dispara desde
    // fuera de la geometría sólida del mapa.
    const verts: number[] = [
      // -X
      x0, y0, z0, x0, y1, z0, x0, y1, z1,
      x0, y0, z0, x0, y1, z1, x0, y0, z1,
      // +X
      x1, y0, z0, x1, y1, z1, x1, y1, z0,
      x1, y0, z0, x1, y0, z1, x1, y1, z1,
      // -Y
      x0, y0, z0, x1, y0, z1, x1, y0, z0,
      x0, y0, z0, x0, y0, z1, x1, y0, z1,
      // +Y
      x0, y1, z0, x1, y1, z0, x1, y1, z1,
      x0, y1, z0, x1, y1, z1, x0, y1, z1,
      // -Z
      x0, y0, z0, x1, y1, z0, x1, y0, z0,
      x0, y0, z0, x0, y1, z0, x1, y1, z0,
      // +Z
      x0, y0, z1, x1, y0, z1, x1, y1, z1,
      x0, y0, z1, x1, y1, z1, x0, y1, z1,
    ]
    positions.set(verts, o)
    o += verts.length
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  return geometry
}

/** Construye un BVH sobre `boxes`. Factory testeable: los tests le pasan
 *  geometría sintética chica en vez de la arena completa, para poder
 *  verificar distancias de impacto a mano. */
export function buildMapBvh(boxes: Box[]): MeshBVH {
  return new MeshBVH(buildCollisionGeometry(boxes))
}

// Ray preasignado una sola vez: las funciones de acá abajo sólo mutan su
// origin/direction en cada llamada, nunca construyen un Ray nuevo.
const scratchRay = new Ray()

/**
 * Raycast contra `bvh`, desde `origin` en dirección `dir` (normalizada),
 * hasta `maxDistance`. Escribe en `out` (preasignado).
 *
 * `MeshBVH.raycastFirst()` sí asigna objetos transitorios de intersección
 * durante su propio recorrido del árbol — no expone ninguna variante
 * "escribe en un target preasignado" en su API pública (ver
 * node_modules/three-mesh-bvh/src/index.d.ts). Eso es interno a la
 * librería y queda acotado por la profundidad del árbol (no crece con la
 * cantidad de disparos: nada de lo que devuelve se retiene más allá de
 * esta función), así que no rompe el guard de "el heap no crece" que mide
 * combat/allocations.test.ts — es la misma vara con la que el resto del
 * motor mide "cero asignaciones" (ver movement/allocations.test.ts), no una
 * garantía de cero objetos transitorios en absoluto dentro de una
 * dependencia de terceros que no controlamos.
 */
export function raycastAgainstBvh(
  bvh: MeshBVH,
  origin: Vec3,
  dir: Vec3,
  maxDistance: number,
  out: MapHit,
): void {
  scratchRay.origin.set(origin.x, origin.y, origin.z)
  scratchRay.direction.set(dir.x, dir.y, dir.z)

  const hit = bvh.raycastFirst(scratchRay, undefined, 0, maxDistance)
  if (hit) {
    out.hit = true
    out.distance = hit.distance
  } else {
    out.hit = false
    out.distance = Infinity
  }
}

/** BVH del mapa real, construido una sola vez al cargar el módulo (sección
 *  1 del spec: "un BVH construido una vez sobre la geometría del mapa"). */
const MAP_BVH = buildMapBvh(ARENA.boxes)

/** Raycast contra el mapa real de la arena. Atajo de raycastAgainstBvh para
 *  el único BVH que game.ts necesita en producción. */
export function raycastMap(origin: Vec3, dir: Vec3, maxDistance: number, out: MapHit): void {
  raycastAgainstBvh(MAP_BVH, origin, dir, maxDistance, out)
}
