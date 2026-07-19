import { describe, expect, it } from 'vitest'
import { vec3 } from '@/game/math/vec3'
import {
  HITBOX_MULTIPLIER,
  intersectHitboxes,
  intersectSphere,
  type Hitbox,
  type HitboxHit,
} from '@/game/combat/hitboxes'

describe('multiplicadores de hitbox', () => {
  it('cabeza 1.8, torso 1.0, extremidades 0.85 (sección 5 del spec)', () => {
    expect(HITBOX_MULTIPLIER.head).toBe(1.8)
    expect(HITBOX_MULTIPLIER.torso).toBe(1.0)
    expect(HITBOX_MULTIPLIER.limb).toBe(0.85)
  })
})

describe('intersectSphere', () => {
  it('un rayo que apunta derecho a una esfera al frente da la distancia al punto más cercano', () => {
    const t = intersectSphere(0, 0, 0, 0, 0, -1, 0, 0, -10, 1, 100)
    expect(t).toBeCloseTo(9, 9)
  })

  it('un rayo que no apunta a la esfera no intersecta', () => {
    const t = intersectSphere(0, 0, 0, 0, 0, -1, 5, 5, -10, 1, 100)
    expect(t).toBe(-1)
  })

  it('una esfera detrás del origen (en la dirección opuesta) no intersecta', () => {
    const t = intersectSphere(0, 0, 0, 0, 0, -1, 0, 0, 10, 1, 100)
    expect(t).toBe(-1)
  })

  it('una esfera más allá de maxDistance no intersecta', () => {
    const t = intersectSphere(0, 0, 0, 0, 0, -1, 0, 0, -10, 1, 5)
    expect(t).toBe(-1)
  })

  it('el origen ADENTRO de la esfera da t=0 (la salida), no negativo', () => {
    const t = intersectSphere(0, 0, -10, 0, 0, -1, 0, 0, -10, 1, 100)
    expect(t).toBeCloseTo(1, 9)
  })
})

describe('intersectHitboxes: end to end de un disparo simulado', () => {
  function hitbox(part: Hitbox['part'], z: number, radius: number, owner = 1): Hitbox {
    return { center: vec3(0, 0, z), radius, part, owner }
  }

  function out(): HitboxHit {
    return { hit: false, distance: Infinity, part: null, owner: -1 }
  }

  it('elige la hitbox más cercana cuando varias están en línea', () => {
    const hitboxes = [hitbox('torso', -20, 1), hitbox('head', -10, 0.5)]
    const result = out()
    intersectHitboxes(vec3(0, 0, 0), vec3(0, 0, -1), hitboxes, 100, result)

    expect(result.hit).toBe(true)
    expect(result.part).toBe('head')
    expect(result.distance).toBeCloseTo(9.5, 9)
  })

  it('sin hitboxes en el camino, no hay impacto', () => {
    const result = out()
    intersectHitboxes(vec3(0, 0, 0), vec3(0, 0, -1), [], 100, result)
    expect(result.hit).toBe(false)
  })

  it('una lista vacía de hitboxes no revienta (arena sin dianas todavía, sección 6 es la próxima tarea)', () => {
    const result = out()
    expect(() => intersectHitboxes(vec3(1, 2, 3), vec3(0, 0, -1), [], 500, result)).not.toThrow()
    expect(result.hit).toBe(false)
  })
})
