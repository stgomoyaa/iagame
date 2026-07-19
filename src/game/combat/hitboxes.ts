/**
 * Hitboxes esféricas y sus multiplicadores de daño (secciones 1 y 2 del spec
 * de fase 1). Matemática pura: sin Three, para poder testear "apuntado x
 * hitbox x curva de daño" de punta a punta sin levantar WebGL ni el BVH del
 * mapa (ver combat/hitscan.ts, que sí lo necesita).
 */

import type { Vec3 } from '@/game/math/vec3'

export type BodyPart = 'head' | 'torso' | 'limb'

/** Cabeza 1.8, torso 1.0, extremidades 0.85 — sección 5 del spec, sobre 100
 *  de vida y sin armadura. */
export const HITBOX_MULTIPLIER: Record<BodyPart, number> = {
  head: 1.8,
  torso: 1.0,
  limb: 0.85,
}

/**
 * Hitbox esférica de un objetivo. `owner` identifica a qué objetivo
 * pertenece (un objetivo real tiene varias hitboxes: cabeza + torso +
 * extremidades) — acá viaja como dato opaco nada más, fase 2 (dianas) es
 * quien le da significado.
 */
export interface Hitbox {
  center: Vec3
  radius: number
  part: BodyPart
  owner: number
}

/** Resultado de intersectar un rayo contra una lista de hitboxes.
 *  Preasignado por el llamador: cero asignaciones por disparo. */
export interface HitboxHit {
  hit: boolean
  distance: number
  part: BodyPart | null
  owner: number
}

/**
 * Distancia al punto de impacto más cercano entre el rayo (origin, dir
 * normalizado) y una esfera, o -1 si no hay intersección hacia adelante
 * dentro de [0, maxDistance]. Fórmula analítica estándar rayo-esfera,
 * en componentes sueltas (no Vec3) para no depender de ninguna asignación
 * ni de las funciones de vec3.ts en el camino caliente.
 */
export function intersectSphere(
  originX: number,
  originY: number,
  originZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
  maxDistance: number,
): number {
  const ocX = originX - centerX
  const ocY = originY - centerY
  const ocZ = originZ - centerZ
  const b = dirX * ocX + dirY * ocY + dirZ * ocZ
  const c = ocX * ocX + ocY * ocY + ocZ * ocZ - radius * radius
  const disc = b * b - c
  if (disc < 0) return -1

  const sqrtDisc = Math.sqrt(disc)
  const t0 = -b - sqrtDisc
  if (t0 >= 0 && t0 <= maxDistance) return t0
  const t1 = -b + sqrtDisc
  if (t1 >= 0 && t1 <= maxDistance) return t1
  return -1
}

/**
 * Busca la hitbox más cercana que intersecta el rayo, dentro de
 * maxDistance, y escribe el resultado en `out` (preasignado). For indexado
 * sobre `hitboxes` a propósito (nada de .filter/.map/.reduce): el costo por
 * disparo tiene que ser O(hitboxes) sin generar basura.
 */
export function intersectHitboxes(
  origin: Vec3,
  dir: Vec3,
  hitboxes: Hitbox[],
  maxDistance: number,
  out: HitboxHit,
): void {
  out.hit = false
  out.distance = Infinity
  out.part = null
  out.owner = -1

  for (let i = 0; i < hitboxes.length; i++) {
    const hb = hitboxes[i]
    const t = intersectSphere(
      origin.x,
      origin.y,
      origin.z,
      dir.x,
      dir.y,
      dir.z,
      hb.center.x,
      hb.center.y,
      hb.center.z,
      hb.radius,
      maxDistance,
    )
    if (t >= 0 && t < out.distance) {
      out.hit = true
      out.distance = t
      out.part = hb.part
      out.owner = hb.owner
    }
  }
}
