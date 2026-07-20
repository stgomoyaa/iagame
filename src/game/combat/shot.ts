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

/**
 * Material contra el que pegó el disparo. Decide el sonido de impacto y el
 * aspecto de la partícula/calcomanía (feedback/vfx.ts).
 *
 * Son sólo dos porque el mapa hoy no tiene concepto de material: MapDef son
 * cajas desnudas (map/types.ts) y la malla es un único MeshBasicMaterial con
 * vertexColors, así que no hay de dónde sacar "esto es metal y esto madera"
 * sin inventarlo. La distinción que SÍ existe en los datos es carne (pegó en
 * una hitbox) contra mundo (pegó en la geometría), y esa es la que se
 * modela. El tipo queda abierto para sumar materiales el día que las cajas
 * declaren uno.
 */
export type ImpactSurface = 'carne' | 'hormigon' | 'ninguna'

export interface ShotResult {
  hit: boolean
  distance: number
  damage: number
  part: BodyPart | 'none'
  /**
   * Punto de impacto exacto en coordenadas de mundo. Lo escribe fireShot con
   * la dirección REAL del disparo (la que ya incluye la muestra de
   * dispersión de este tiro), así que es exacto.
   *
   * Antes game.ts lo reconstruía por su cuenta como `origen + forward *
   * distancia` usando pitch/yaw SIN dispersión, y por eso el número de daño
   * aparecía unos píxeles corrido del impacto real. Ahora que los impactos y
   * las calcomanías también se plantan en este punto, ese error dejaría las
   * marcas visiblemente fuera del agujero, así que se calcula donde se tiene
   * el dato bueno.
   */
  pointX: number
  pointY: number
  pointZ: number
  /** Normal de la superficie golpeada, orientada contra el disparo. Para
   *  impactos en carne es simplemente la dirección de vuelta al tirador. */
  normalX: number
  normalY: number
  normalZ: number
  /** Contra qué pegó, para elegir sonido y partícula de impacto. */
  surface: ImpactSurface
  /**
   * Índice de la diana golpeada (Hitbox.owner, ver combat/hitboxes.ts),
   * o -1 si el impacto fue contra el mapa o no hubo impacto. Hasta la
   * sección 6 del spec (dianas) `owner` viajaba como dato opaco -- nadie lo
   * leía todavía, TARGET_HITBOXES estaba vacío en game.ts -- así que no
   * hacía falta exponerlo acá. Ahora que las dianas existen (targets/), lo
   * necesitan para saber A CUÁL de ellas restarle vida.
   */
  owner: number
}

export function createShotResult(): ShotResult {
  return {
    hit: false,
    distance: 0,
    damage: 0,
    part: 'none',
    pointX: 0,
    pointY: 0,
    pointZ: 0,
    normalX: 0,
    normalY: 0,
    normalZ: 0,
    surface: 'ninguna',
    owner: -1,
  }
}

// Scratch preasignados a nivel de módulo: fireShot() se llama por disparo
// (no por frame), pero el presupuesto de cero asignaciones del motor no
// distingue "por disparo" de "por frame" — ver el spec, sección "cero
// asignaciones por disparo".
const scratchDir: Vec3 = vec3()
const scratchMapHit: MapHit = { hit: false, distance: 0, normalX: 0, normalY: 1, normalZ: 0 }
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
    out.owner = scratchHitboxHit.owner
    out.surface = 'carne'
    // Las hitboxes son esferas analíticas (combat/hitboxes.ts) y HitboxHit no
    // devuelve el centro, así que no hay normal geométrica que sacar. Mirar
    // de vuelta al tirador es lo correcto igual: la partícula de impacto en
    // carne se dibuja como billboard contra la cámara, no pegada a una cara.
    out.normalX = -scratchDir.x
    out.normalY = -scratchDir.y
    out.normalZ = -scratchDir.z
  } else if (scratchMapHit.hit) {
    out.hit = true
    out.distance = scratchMapHit.distance
    out.part = 'none'
    out.damage = 0
    out.owner = -1
    out.surface = 'hormigon'
    out.normalX = scratchMapHit.normalX
    out.normalY = scratchMapHit.normalY
    out.normalZ = scratchMapHit.normalZ
  } else {
    out.hit = false
    out.distance = MAX_SHOT_DISTANCE
    out.part = 'none'
    out.damage = 0
    out.owner = -1
    out.surface = 'ninguna'
    out.normalX = -scratchDir.x
    out.normalY = -scratchDir.y
    out.normalZ = -scratchDir.z
  }

  // Punto de impacto con la dirección real del tiro (dispersión incluida).
  // Cuando no hubo impacto igual se escribe, a MAX_SHOT_DISTANCE: es el
  // destino del trazador, que tiene que salir igual aunque el tiro se pierda.
  out.pointX = origin.x + scratchDir.x * out.distance
  out.pointY = origin.y + scratchDir.y * out.distance
  out.pointZ = origin.z + scratchDir.z * out.distance
}
