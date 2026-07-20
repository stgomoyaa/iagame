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
import type { Box, MapDef } from '@/game/map/types'
import type { Vec3 } from '@/game/math/vec3'

/** Resultado de un raycast contra el mapa. Preasignado por el llamador. */
export interface MapHit {
  hit: boolean
  distance: number
  /**
   * Normal de la cara golpeada, en espacio de mundo y ya orientada CONTRA el
   * rayo (ver raycastAgainstBvh). La necesitan los impactos y las calcomanías
   * de feedback/vfx.ts para orientar el quad contra la pared en vez de
   * dejarlo mirando a cámara. Sólo es válida cuando `hit` es true; con `hit`
   * en false queda como estaba, nadie la lee.
   */
  normalX: number
  normalY: number
  normalZ: number
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

    // La normal sale de la cara golpeada, pero buildCollisionGeometry arma
    // los triángulos con devanado inconsistente a propósito (ver el
    // comentario de `verts`: a raycastFirst le da igual), así que la normal
    // cruda puede apuntar hacia adentro de la caja. Se la orienta contra el
    // rayo: siempre se dispara desde AFUERA de la geometría sólida, así que
    // la normal correcta es siempre la que se opone a la dirección de tiro.
    // Sin esto, la mitad de las calcomanías quedarían enterradas en la pared.
    const face = hit.face
    if (face) {
      const d = face.normal.x * dir.x + face.normal.y * dir.y + face.normal.z * dir.z
      const s = d > 0 ? -1 : 1
      out.normalX = face.normal.x * s
      out.normalY = face.normal.y * s
      out.normalZ = face.normal.z * s
    } else {
      // Sin cara (no debería pasar con este BVH, pero la firma de three lo
      // permite): mirar de vuelta al tirador es la aproximación segura.
      out.normalX = -dir.x
      out.normalY = -dir.y
      out.normalZ = -dir.z
    }
  } else {
    out.hit = false
    out.distance = Infinity
  }
}

/** BVH del mapa activo, construido una sola vez por mapa (sección 1 del
 *  spec: "un BVH construido una vez sobre la geometría del mapa"). Arranca
 *  en la arena: es el mapa por defecto y el que usan los tests, así que
 *  ninguno tiene que acordarse de inicializar nada. */
let mapaActivo: MapDef = ARENA
let bvhActivo = buildMapBvh(ARENA.boxes)

/**
 * Cambia el mapa contra el que dispara raycastMap. Se llama UNA vez al
 * armar la partida (game.ts), nunca en el camino de frame: reconstruye el
 * BVH entero. Idempotente, así que llamarla con el mapa que ya está activo
 * no cuesta nada.
 */
export function setRaycastMap(map: MapDef): void {
  if (map === mapaActivo) return
  mapaActivo = map
  bvhActivo = buildMapBvh(map.boxes)
}

/** Raycast contra el mapa activo. Atajo de raycastAgainstBvh para el único
 *  BVH que game.ts necesita en producción. */
export function raycastMap(origin: Vec3, dir: Vec3, maxDistance: number, out: MapHit): void {
  raycastAgainstBvh(bvhActivo, origin, dir, maxDistance, out)
}
