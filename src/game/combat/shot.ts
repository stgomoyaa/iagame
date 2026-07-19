/**
 * Resuelve UN disparo: dirección de cámara (con dispersión aplicada),
 * hitscan contra mapa + hitboxes (el impacto más cercano gana), y daño
 * final. Todo el estado transitorio es preasignado a nivel de módulo: cero
 * asignaciones por disparo (sección 1 del spec de fase 1).
 */

import { vec3, type Vec3 } from '@/game/math/vec3'
import { damageAtRange, type WeaponArchetype } from '@/game/weapons/archetypes'
import {
  HITBOX_MULTIPLIER,
  intersectHitboxes,
  type BodyPart,
  type Hitbox,
  type HitboxHit,
} from '@/game/combat/hitboxes'
import { raycastMap, type MapHit } from '@/game/combat/hitscan'

/** Alcance máximo del hitscan: cubre cualquier distancia del arsenal (la
 *  sniper llega a maxRange=120m) y la diagonal de la arena (60m de lado,
 *  ver map/arena.ts) con margen de sobra. */
export const MAX_SHOT_DISTANCE = 500

export interface ShotResult {
  hit: boolean
  distance: number
  damage: number
  part: BodyPart | 'none'
}

export function createShotResult(): ShotResult {
  return { hit: false, distance: 0, damage: 0, part: 'none' }
}

// Scratch preasignados a nivel de módulo: fireShot() se llama por disparo
// (no por frame), pero el presupuesto de cero asignaciones del motor no
// distingue "por disparo" de "por frame" — ver el spec, sección "cero
// asignaciones por disparo".
const scratchDir: Vec3 = vec3()
const scratchMapHit: MapHit = { hit: false, distance: 0 }
const scratchHitboxHit: HitboxHit = { hit: false, distance: Infinity, part: null, owner: -1 }

/**
 * Dirección de cámara a partir de pitch/yaw, convención YXZ de Three (ver
 * game.ts: `camera.rotation.set(pitch, yaw, 0, 'YXZ')`). Escribe en `out`
 * (preasignado).
 */
export function computeForward(pitch: number, yaw: number, out: Vec3): void {
  const cosPitch = Math.cos(pitch)
  out.x = -Math.sin(yaw) * cosPitch
  out.y = Math.sin(pitch)
  out.z = -Math.cos(yaw) * cosPitch
}

/**
 * Dispara un rayo desde `origin` (la cámara, sección 1 del spec: "el
 * disparo sale desde la cámara, no desde la boca del arma") en la
 * dirección de cámara (pitch/yaw) perturbada por `spreadPitch`/`spreadYaw`
 * (la muestra de dispersión de ESTE disparo), contra el mapa y las
 * hitboxes provistas; el impacto más cercano gana. Escribe el resultado en
 * `out`.
 */
export function fireShot(
  origin: Vec3,
  pitch: number,
  yaw: number,
  spreadPitch: number,
  spreadYaw: number,
  archetype: WeaponArchetype,
  hitboxes: Hitbox[],
  out: ShotResult,
): void {
  computeForward(pitch + spreadPitch, yaw + spreadYaw, scratchDir)

  raycastMap(origin, scratchDir, MAX_SHOT_DISTANCE, scratchMapHit)
  intersectHitboxes(origin, scratchDir, hitboxes, MAX_SHOT_DISTANCE, scratchHitboxHit)

  const hitboxCloser =
    scratchHitboxHit.hit && (!scratchMapHit.hit || scratchHitboxHit.distance < scratchMapHit.distance)

  if (hitboxCloser) {
    const part = scratchHitboxHit.part as BodyPart
    out.hit = true
    out.distance = scratchHitboxHit.distance
    out.part = part
    out.damage = damageAtRange(archetype, out.distance) * HITBOX_MULTIPLIER[part]
  } else if (scratchMapHit.hit) {
    out.hit = true
    out.distance = scratchMapHit.distance
    out.part = 'none'
    out.damage = 0
  } else {
    out.hit = false
    out.distance = MAX_SHOT_DISTANCE
    out.part = 'none'
    out.damage = 0
  }
}
