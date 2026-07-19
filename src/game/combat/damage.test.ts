import { describe, expect, it } from 'vitest'
import { ARCHETYPES, damageAtRange } from '@/game/weapons/archetypes'
import { vec3 } from '@/game/math/vec3'
import { intersectHitboxes, type Hitbox, type HitboxHit } from '@/game/combat/hitboxes'
import { resolveDamage } from '@/game/combat/damage'

describe('resolveDamage: multiplicador de hitbox aplicado sobre la curva de daño por distancia', () => {
  const ar1 = ARCHETYPES['ar-1']

  it('torso (x1.0) da exactamente el daño base de la curva', () => {
    const dmg = resolveDamage(ar1, ar1.damage.optimalRange, 'torso')
    expect(dmg).toBe(damageAtRange(ar1, ar1.damage.optimalRange))
  })

  it('cabeza (x1.8) multiplica el daño de la curva', () => {
    const dmg = resolveDamage(ar1, ar1.damage.optimalRange, 'head')
    expect(dmg).toBeCloseTo(damageAtRange(ar1, ar1.damage.optimalRange) * 1.8, 9)
  })

  it('extremidad (x0.85) reduce el daño de la curva', () => {
    const dmg = resolveDamage(ar1, ar1.damage.optimalRange, 'limb')
    expect(dmg).toBeCloseTo(damageAtRange(ar1, ar1.damage.optimalRange) * 0.85, 9)
  })

  it('un headshot lejos (con la caída de daño ya aplicada) sigue multiplicando por 1.8', () => {
    const lejos = ar1.damage.maxRange
    const dmg = resolveDamage(ar1, lejos, 'head')
    expect(dmg).toBeCloseTo(damageAtRange(ar1, lejos) * 1.8, 9)
  })
})

describe('de punta a punta: un disparo simulado contra hitboxes reales', () => {
  function out(): HitboxHit {
    return { hit: false, distance: Infinity, part: null, owner: -1 }
  }

  it('un headshot a rango óptimo mata en menos disparos que un torso shot (más daño por multiplicador)', () => {
    const ar1 = ARCHETYPES['ar-1']
    const distancia = ar1.damage.optimalRange

    const hitboxes: Hitbox[] = [
      { center: vec3(0, 1.7, -distancia), radius: 0.15, part: 'head', owner: 1 },
    ]
    const hitResult = out()
    intersectHitboxes(vec3(0, 1.7, 0), vec3(0, 0, -1), hitboxes, 500, hitResult)

    expect(hitResult.hit).toBe(true)
    expect(hitResult.part).toBe('head')

    const headDmg = resolveDamage(ar1, hitResult.distance, hitResult.part!)
    const torsoDmg = resolveDamage(ar1, hitResult.distance, 'torso')

    expect(headDmg).toBeGreaterThan(torsoDmg)
    expect(Math.ceil(100 / headDmg)).toBeLessThanOrEqual(Math.ceil(100 / torsoDmg))
  })

  it('un impacto en una extremidad a la misma distancia que uno de torso da menos daño', () => {
    const ar1 = ARCHETYPES['ar-1']
    const distancia = ar1.damage.optimalRange

    const torsoHit: Hitbox[] = [{ center: vec3(0, 1.2, -distancia), radius: 0.3, part: 'torso', owner: 1 }]
    const limbHit: Hitbox[] = [{ center: vec3(0, 1.2, -distancia), radius: 0.3, part: 'limb', owner: 1 }]

    const rTorso = out()
    intersectHitboxes(vec3(0, 1.2, 0), vec3(0, 0, -1), torsoHit, 500, rTorso)
    const rLimb = out()
    intersectHitboxes(vec3(0, 1.2, 0), vec3(0, 0, -1), limbHit, 500, rLimb)

    const dmgTorso = resolveDamage(ar1, rTorso.distance, rTorso.part!)
    const dmgLimb = resolveDamage(ar1, rLimb.distance, rLimb.part!)
    expect(dmgLimb).toBeLessThan(dmgTorso)
  })
})
