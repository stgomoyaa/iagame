import { describe, expect, it } from 'vitest'
import { canHear, canSee, hasLineOfSight, inVisionCone, type RaycastMapFn } from '@/game/bots/perception'
import { vec3 } from '@/game/math/vec3'
import type { MapHit } from '@/game/combat/hitscan'
import type { Box } from '@/game/map/types'

/** Raycaster sintético: intersecta contra un AABB fijo (o ninguno), sin
 *  three ni BVH real -- perception.ts sólo necesita la FORMA de raycastMap
 *  (origin, dir, maxDistance, out), no de dónde sale el dato. */
function makeRaycaster(blocker: Box | null): RaycastMapFn {
  return (origin, dir, maxDistance, out: MapHit) => {
    if (!blocker) {
      out.hit = false
      out.distance = Infinity
      return
    }
    // Intersección rayo-AABB (slab method), suficiente para geometría de
    // test alineada a ejes.
    let tMin = 0
    let tMax = maxDistance
    const axes: Array<['x' | 'y' | 'z']> = [['x'], ['y'], ['z']]
    for (const [axis] of axes) {
      const o = origin[axis]
      const d = dir[axis]
      const lo = blocker.min[axis]
      const hi = blocker.max[axis]
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) {
          out.hit = false
          out.distance = Infinity
          return
        }
        continue
      }
      let t1 = (lo - o) / d
      let t2 = (hi - o) / d
      if (t1 > t2) [t1, t2] = [t2, t1]
      tMin = Math.max(tMin, t1)
      tMax = Math.min(tMax, t2)
      if (tMin > tMax) {
        out.hit = false
        out.distance = Infinity
        return
      }
    }
    out.hit = true
    out.distance = tMin
  }
}

const NO_WALL = makeRaycaster(null)

describe('cono de visión', () => {
  it('un objetivo justo enfrente cae dentro del cono', () => {
    const eye = vec3(0, 1, 0)
    const target = vec3(0, 1, -10)
    expect(inVisionCone(eye, 0, target, 40, Math.PI / 3)).toBe(true)
  })

  it('un objetivo detrás del bot NO cae dentro del cono', () => {
    const eye = vec3(0, 1, 0)
    const target = vec3(0, 1, 10)
    expect(inVisionCone(eye, 0, target, 40, Math.PI / 3)).toBe(false)
  })

  it('un objetivo justo en el borde del semiángulo entra; apenas afuera no', () => {
    const eye = vec3(0, 1, 0)
    const halfAngle = Math.PI / 4 // 45°
    const dist = 10
    // Justo en el borde (45° desde -Z).
    const onEdge = vec3(Math.sin(halfAngle) * dist, 1, -Math.cos(halfAngle) * dist)
    expect(inVisionCone(eye, 0, onEdge, 40, halfAngle)).toBe(true)

    const outsideEdge = vec3(Math.sin(halfAngle + 0.05) * dist, 1, -Math.cos(halfAngle + 0.05) * dist)
    expect(inVisionCone(eye, 0, outsideEdge, 40, halfAngle)).toBe(false)
  })

  it('un objetivo más allá del rango no cae dentro del cono aunque esté enfrente', () => {
    const eye = vec3(0, 1, 0)
    const target = vec3(0, 1, -50)
    expect(inVisionCone(eye, 0, target, 40, Math.PI)).toBe(false)
  })

  it('rota con facingYaw: el mismo objetivo entra o no según hacia dónde mira el bot', () => {
    const eye = vec3(0, 1, 0)
    const target = vec3(10, 1, 0) // a la derecha, en +X
    expect(inVisionCone(eye, 0, target, 40, Math.PI / 3)).toBe(false)
    // Girando 90° hacia +X (yaw=-PI/2, ver aim.ts lookAt), el mismo punto
    // queda justo enfrente.
    expect(inVisionCone(eye, -Math.PI / 2, target, 40, Math.PI / 3)).toBe(true)
  })
})

describe('línea de vista', () => {
  it('sin geometría de por medio, hay línea de vista', () => {
    expect(hasLineOfSight(NO_WALL, vec3(0, 1, 0), vec3(0, 1, -10))).toBe(true)
  })

  it('una pared entre el ojo y el objetivo bloquea', () => {
    const wall: Box = { min: vec3(-5, 0, -6), max: vec3(5, 3, -5) }
    const raycast = makeRaycaster(wall)
    expect(hasLineOfSight(raycast, vec3(0, 1, 0), vec3(0, 1, -10))).toBe(false)
  })

  it('una pared FUERA del segmento ojo-objetivo no bloquea', () => {
    const wallLejos: Box = { min: vec3(-5, 0, -100), max: vec3(5, 3, -99) }
    const raycast = makeRaycaster(wallLejos)
    expect(hasLineOfSight(raycast, vec3(0, 1, 0), vec3(0, 1, -10))).toBe(true)
  })
})

describe('visión completa (cono + línea de vista): un bot no reacciona a lo que no puede ver', () => {
  it('no adquiere un objetivo a través de una pared, aunque esté dentro del cono', () => {
    const wall: Box = { min: vec3(-5, 0, -6), max: vec3(5, 3, -5) }
    const raycast = makeRaycaster(wall)
    const eye = vec3(0, 1, 0)
    const target = vec3(0, 1, -10)
    expect(inVisionCone(eye, 0, target, 40, Math.PI / 3)).toBe(true) // geometría sola diría que sí
    expect(canSee(raycast, eye, 0, target, 40, Math.PI / 3)).toBe(false) // pero hay pared de por medio
  })

  it('sí adquiere un objetivo dentro del cono y con línea de vista clara', () => {
    const eye = vec3(0, 1, 0)
    const target = vec3(0, 1, -10)
    expect(canSee(NO_WALL, eye, 0, target, 40, Math.PI / 3)).toBe(true)
  })

  it('no adquiere un objetivo fuera del cono aunque la línea de vista esté clara', () => {
    const eye = vec3(0, 1, 0)
    const target = vec3(0, 1, 10) // detrás
    expect(canSee(NO_WALL, eye, 0, target, 40, Math.PI / 3)).toBe(false)
  })
})

describe('audición', () => {
  it('un disparo dentro del radio de audición alerta', () => {
    const bot = vec3(0, 0, 0)
    const shot = vec3(10, 0, 0)
    expect(canHear(bot, shot, 15)).toBe(true)
  })

  it('un disparo fuera del radio de audición NO alerta', () => {
    const bot = vec3(0, 0, 0)
    const shot = vec3(30, 0, 0)
    expect(canHear(bot, shot, 15)).toBe(false)
  })

  it('exactamente en el borde del radio, alerta (inclusive)', () => {
    const bot = vec3(0, 0, 0)
    const shot = vec3(15, 0, 0)
    expect(canHear(bot, shot, 15)).toBe(true)
  })

  it('la audición no depende de línea de vista ni de cono -- un disparo detrás de cobertura igual se oye', () => {
    // canHear no recibe raycaster ni facingYaw: por diseño no puede
    // bloquearse por geometría, a diferencia de canSee.
    const bot = vec3(0, 0, 0)
    const shot = vec3(0, 0, 10) // detrás del bot si mirara hacia -Z
    expect(canHear(bot, shot, 15)).toBe(true)
  })
})
