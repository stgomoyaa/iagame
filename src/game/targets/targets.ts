/**
 * Dianas de la arena (sección 6 del spec de fase 1): estáticas y móviles,
 * con hitboxes reales (cabeza + torso) que reaccionan al impacto y se
 * reinician. Matemática pura, sin Three: el mismo patrón que
 * combat/hitboxes.ts, con `owner` (hasta ahora dato opaco, ver el
 * comentario de esa interfaz) identificando a qué diana pertenece cada
 * hitbox.
 *
 * game.ts pasa el `hitboxes` de acá directo a stepCombat() (el mismo
 * parámetro que hoy recibe TARGET_HITBOXES = []), así que el hitscan las ve
 * "al lado" del BVH del mapa exactamente como ya hace fireShot() en
 * combat/shot.ts: raycastMap() contra el BVH y intersectHitboxes() contra
 * este array por separado, y gana el impacto más cercano. No hace falta
 * registrar nada en el BVH -- ésa es la vía que ya existe para geometría
 * que no cambia de forma cuadro a cuadro; las dianas móviles mutan
 * `hitbox.center` in place cada frame (stepTargets), algo que un BVH
 * estático no puede hacer sin reconstruirse.
 */

import { vec3, type Vec3 } from '@/game/math/vec3'
import type { Box } from '@/game/map/types'
import type { Hitbox } from '@/game/combat/hitboxes'
import { TARGETS } from '@/game/targets/tuning'

export type TargetKind = 'static' | 'moving'

export interface TargetDef {
  kind: TargetKind
  baseX: number
  baseY: number
  baseZ: number
  /** Sólo 'moving': amplitud del vaivén en X, metros. */
  amplitude: number
  /** Sólo 'moving': velocidad angular del vaivén, radianes/seg. */
  speed: number
  /** Desfasa dianas móviles entre sí para que no queden todas en fase. */
  phase: number
}

export interface TargetState {
  def: TargetDef
  /** Centro del torso. Para dianas móviles, se muta in place cada frame
   *  (stepTargets) -- nunca se reasigna. */
  position: Vec3
  health: number
  alive: boolean
  /** Segundos desde que se rompió (alive=false). */
  respawnT: number
  /** Segundos desde el último impacto recibido. TARGETS.hitFlashDurationS
   *  o más significa "sin flash activo" -- ver targetHitFlash() más abajo. */
  hitFlashT: number
  /** Fase acumulada del vaivén (arranca en def.phase, avanza def.speed por
   *  segundo). Con amplitude=0 (dianas estáticas) esto sigue corriendo pero
   *  sin efecto visible: sin(fase) * 0 siempre da 0, así que no hace falta
   *  ramificar por `kind` en stepTargets(). */
  phaseAccum: number
}

export interface TargetsState {
  targets: TargetState[]
  /** hitboxes[i*2] = torso de targets[i], hitboxes[i*2+1] = cabeza.
   *  Longitud fija: 2 * targets.length, preasignada una sola vez. */
  hitboxes: Hitbox[]
}

/**
 * Línea recta de la arena (mismo z, un rango de x) que las dianas usan
 * como "corredor de tiro": ¿algún box del mapa la corta, dentro del rango
 * de altura pedido? Comprobación de diseño (AABB contra AABB), no un
 * raycast real -- ver el test de targets.test.ts que la usa para blindar
 * la colocación elegida en createDefaultTargets() contra futuros cambios
 * de map/arena.ts.
 */
export function laneBlocked(
  boxes: Box[],
  laneZ: number,
  yMin: number,
  yMax: number,
  xMin: number,
  xMax: number,
): boolean {
  for (const b of boxes) {
    if (b.max.z < laneZ || b.min.z > laneZ) continue
    if (b.max.y < yMin || b.min.y > yMax) continue
    if (b.max.x < xMin || b.min.x > xMax) continue
    return true
  }
  return false
}

/**
 * Cuatro dianas sobre el corredor z=6 de la arena (ver map/arena.ts): esa
 * línea no cruza ningún separador, la estructura central ni la cobertura
 * alta cercana a los spawns -- confirmado a mano contra las cajas del mapa
 * y blindado en targets.test.ts con laneBlocked(). Dos estáticas (una a
 * rango óptimo típico, ~14m desde el muro oeste; una lejana, ~51m, más
 * allá del maxRange de la mayoría del arsenal) para que la caída de daño
 * sea observable, y dos móviles a mitad de camino, para ejercitar hitboxes
 * que se mueven.
 */
export function createDefaultTargetDefs(): TargetDef[] {
  return [
    { kind: 'static', baseX: -15, baseY: 1.5, baseZ: 6, amplitude: 0, speed: 0, phase: 0 },
    { kind: 'static', baseX: 22, baseY: 1.5, baseZ: 6, amplitude: 0, speed: 0, phase: 0 },
    { kind: 'moving', baseX: 0, baseY: 1.5, baseZ: 6, amplitude: 6, speed: 1.2, phase: 0 },
    { kind: 'moving', baseX: 10, baseY: 1.5, baseZ: 6, amplitude: 5, speed: 0.9, phase: Math.PI },
  ]
}

export function createTargets(defs: TargetDef[]): TargetsState {
  const targets: TargetState[] = []
  const hitboxes: Hitbox[] = []

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]
    const position = vec3(def.baseX, def.baseY, def.baseZ)
    targets.push({
      def,
      position,
      health: TARGETS.maxHealth,
      alive: true,
      respawnT: 0,
      hitFlashT: TARGETS.hitFlashDurationS,
      phaseAccum: def.phase,
    })

    // El torso comparte el MISMO objeto Vec3 que target.position (no una
    // copia): mover al target ya mueve su hitbox de torso gratis, sin
    // necesidad de sincronizar nada en stepTargets(). La cabeza sí necesita
    // su propio Vec3 (vive desplazada) y a ésa stepTargets() la actualiza
    // a mano cada frame.
    hitboxes.push({ center: position, radius: TARGETS.torsoRadius, part: 'torso', owner: i })
    hitboxes.push({
      center: vec3(def.baseX, def.baseY + TARGETS.headOffsetY, def.baseZ),
      radius: TARGETS.headRadius,
      part: 'head',
      owner: i,
    })
  }

  return { targets, hitboxes }
}

/** Avanza un frame: mueve las dianas móviles, cuenta el flash de impacto y
 *  hace reaparecer a las que llevan rotas más de respawnDelayS. Muta
 *  `position` y los centros de `hitboxes` in place -- cero asignaciones. */
export function stepTargets(state: TargetsState, dt: number): void {
  const { targets, hitboxes } = state

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]
    target.hitFlashT += dt

    if (!target.alive) {
      target.respawnT += dt
      if (target.respawnT >= TARGETS.respawnDelayS) {
        target.alive = true
        target.health = TARGETS.maxHealth
        target.respawnT = 0
      }
    }

    // Vaivén en X alrededor de baseX. Sin ramificar por `kind`: una diana
    // estática tiene amplitude=0, así que sin(fase)*0 da siempre 0 y
    // position.x se queda clavado en baseX pase lo que pase con la fase.
    target.phaseAccum += target.def.speed * dt
    target.position.x = target.def.baseX + Math.sin(target.phaseAccum) * target.def.amplitude

    // torso.center === target.position (mismo objeto, ver createTargets):
    // ya se movió arriba, nada que sincronizar acá. La cabeza sí es un
    // Vec3 aparte, desplazado en Y -- se resincroniza a mano cada frame.
    const torso = hitboxes[i * 2]
    const head = hitboxes[i * 2 + 1]

    head.center.x = target.position.x
    head.center.y = target.position.y + TARGETS.headOffsetY
    head.center.z = target.position.z

    // Diana rota: hitboxes con radio 0 (nunca intersectan un rayo real, ver
    // combat/hitboxes.ts intersectSphere) en vez de sacarlas del array --
    // el array de hitboxes tiene longitud fija, preasignada una sola vez.
    torso.radius = target.alive ? TARGETS.torsoRadius : 0
    head.radius = target.alive ? TARGETS.headRadius : 0
  }
}

/**
 * Impacto confirmado contra `owner` (índice de diana, viene de
 * HitboxHit.owner / ShotResult.owner -- ver combat/hitboxes.ts y
 * combat/shot.ts). Resta vida, arranca el flash visual y, si la deja en 0
 * o menos, la rompe (empieza a contar respawnDelayS). Devuelve si este
 * impacto fue el que la mató, para que el llamador elija el hitmarker de
 * kill/headshot-kill (feedback/hitmarkers.ts).
 */
export function applyHit(state: TargetsState, owner: number, damage: number): boolean {
  const target = state.targets[owner]
  if (!target || !target.alive) return false

  target.hitFlashT = 0
  target.health -= damage
  if (target.health <= 0) {
    target.health = 0
    target.alive = false
    target.respawnT = 0
    return true
  }
  return false
}

/** 1 justo al recibir un impacto, apagándose linealmente a 0 en
 *  hitFlashDurationS. Para el renderer visual (targets/renderer.ts). */
export function targetHitFlash(target: TargetState): number {
  const t = target.hitFlashT / TARGETS.hitFlashDurationS
  return t >= 1 ? 0 : 1 - t
}
