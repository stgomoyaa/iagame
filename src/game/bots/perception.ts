/**
 * Percepción de bots (sección 8 del spec): "cono de visión con verificación
 * de línea de vista por raycast, más un radio de audición que se dispara con
 * los disparos. Un bot no reacciona a lo que no puede ver ni oír." Tres
 * primitivos puros -- cono, línea de vista, audición -- que bots/bot.ts
 * combina con temporizadores de memoria para decidir transiciones de FSM.
 *
 * `hasLineOfSight` es el único punto de contacto con combat/hitscan.ts (que
 * sí importa three para el BVH): recibe la función de raycast ya resuelta
 * como parámetro, así que este archivo sigue siendo matemática pura sobre
 * Vec3 y no necesita saber que hay un BVH detrás.
 */

import { vec3, type Vec3 } from '@/game/math/vec3'
import type { MapHit } from '@/game/combat/hitscan'

export type RaycastMapFn = (origin: Vec3, dir: Vec3, maxDistance: number, out: MapHit) => void

// Scratch preasignado a nivel de módulo: hasLineOfSight() puede llamarse
// varias veces por tick de IA (una por bot), nunca asigna un Vec3/MapHit
// nuevo.
const scratchDir: Vec3 = vec3()
const scratchHit: MapHit = { hit: false, distance: 0 }

/** Margen restado a la distancia del raycast de línea de vista: sin esto, un
 *  objetivo parado justo en el umbral de una puerta o pegado a una pared
 *  puede dar un falso "bloqueado" por el propio borde de la geometría en el
 *  punto exacto del objetivo. */
const LOS_EPSILON = 0.05

/**
 * ¿`target` cae dentro del cono de visión medido desde `eye` mirando hacia
 * `facingYaw` (radianes, misma convención que movement/step.ts: yaw 0 mira
 * hacia -Z)? Sólo geometría de rango + ángulo, sin raycast -- ver
 * hasLineOfSight para la parte de oclusión.
 */
export function inVisionCone(
  eye: Vec3,
  facingYaw: number,
  target: Vec3,
  rangeM: number,
  halfAngleRad: number,
): boolean {
  const dx = target.x - eye.x
  const dz = target.z - eye.z
  const dist = Math.hypot(dx, dz)
  if (dist > rangeM) return false
  if (dist < 1e-6) return true

  const forwardX = -Math.sin(facingYaw)
  const forwardZ = -Math.cos(facingYaw)
  const dot = (dx / dist) * forwardX + (dz / dist) * forwardZ
  // clamp defensivo: dot puede colarse un pelo fuera de [-1,1] por error de
  // punto flotante, y acos/comparación contra cos(halfAngle) no lo necesita
  // pero mantenerlo en rango documenta la garantía.
  return dot >= Math.cos(halfAngleRad)
}

/**
 * ¿Hay línea de vista despejada entre `eye` y `target` contra la geometría
 * del mapa? `raycastMap` es combat/hitscan.ts raycastMap (o
 * raycastAgainstBvh con un BVH sintético en los tests) -- cualquier impacto
 * contra el mapa antes de llegar a `target` bloquea.
 */
export function hasLineOfSight(raycastMap: RaycastMapFn, eye: Vec3, target: Vec3): boolean {
  const dx = target.x - eye.x
  const dy = target.y - eye.y
  const dz = target.z - eye.z
  const dist = Math.hypot(dx, dy, dz)
  if (dist < 1e-6) return true

  scratchDir.x = dx / dist
  scratchDir.y = dy / dist
  scratchDir.z = dz / dist

  const maxDistance = Math.max(0, dist - LOS_EPSILON)
  raycastMap(eye, scratchDir, maxDistance, scratchHit)
  return !scratchHit.hit
}

/**
 * Visión completa: cono + línea de vista. Un bot "ve" a un objetivo sólo si
 * ambas condiciones se cumplen -- ninguna alcanza sola (spec: "un bot no
 * reacciona a lo que no puede ver").
 */
export function canSee(
  raycastMap: RaycastMapFn,
  eye: Vec3,
  facingYaw: number,
  target: Vec3,
  rangeM: number,
  halfAngleRad: number,
): boolean {
  if (!inVisionCone(eye, facingYaw, target, rangeM, halfAngleRad)) return false
  return hasLineOfSight(raycastMap, eye, target)
}

/**
 * ¿Un disparo en `shotPosition` es audible desde `earPosition` dentro de
 * `hearingRadiusM`? Sin línea de vista ni cono -- un disparo se oye a través
 * de cobertura y fuera del campo visual, a propósito (sección 8: "un radio
 * de audición que se dispara con los disparos", sin la condición de
 * oclusión que sí tiene la visión).
 */
export function canHear(earPosition: Vec3, shotPosition: Vec3, hearingRadiusM: number): boolean {
  const dist = Math.hypot(
    shotPosition.x - earPosition.x,
    shotPosition.y - earPosition.y,
    shotPosition.z - earPosition.z,
  )
  return dist <= hearingRadiusM
}
