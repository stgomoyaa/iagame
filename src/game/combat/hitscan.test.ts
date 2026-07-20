import { describe, expect, it } from 'vitest'
import { vec3 } from '@/game/math/vec3'
import { box } from '@/game/map/arena'
import { buildMapBvh, raycastAgainstBvh, raycastMap, type MapHit } from '@/game/combat/hitscan'

function out(): MapHit {
  return { hit: false, distance: 0, normalX: 0, normalY: 1, normalZ: 0 }
}

describe('raycastAgainstBvh', () => {
  it('un rayo que apunta derecho a una caja da la distancia a su cara cercana', () => {
    const bvh = buildMapBvh([box(-1, -1, -11, 1, 1, -9)])
    const result = out()
    raycastAgainstBvh(bvh, vec3(0, 0, 0), vec3(0, 0, -1), 100, result)

    expect(result.hit).toBe(true)
    expect(result.distance).toBeCloseTo(9, 6)
  })

  it('un rayo que no apunta a ninguna caja no intersecta', () => {
    const bvh = buildMapBvh([box(-1, -1, -11, 1, 1, -9)])
    const result = out()
    raycastAgainstBvh(bvh, vec3(0, 0, 0), vec3(1, 0, 0), 100, result)

    expect(result.hit).toBe(false)
    expect(result.distance).toBe(Infinity)
  })

  it('una caja más allá de maxDistance no intersecta', () => {
    const bvh = buildMapBvh([box(-1, -1, -11, 1, 1, -9)])
    const result = out()
    raycastAgainstBvh(bvh, vec3(0, 0, 0), vec3(0, 0, -1), 5, result)

    expect(result.hit).toBe(false)
  })

  it('elige la caja más cercana cuando el rayo atraviesa varias', () => {
    const bvh = buildMapBvh([box(-1, -1, -30, 1, 1, -28), box(-1, -1, -11, 1, 1, -9)])
    const result = out()
    raycastAgainstBvh(bvh, vec3(0, 0, 0), vec3(0, 0, -1), 100, result)

    expect(result.hit).toBe(true)
    expect(result.distance).toBeCloseTo(9, 6)
  })

  it('llamadas repetidas con geometrías distintas no arrastran estado del rayo preasignado', () => {
    const bvhCerca = buildMapBvh([box(-1, -1, -6, 1, 1, -4)])
    const bvhLejos = buildMapBvh([box(-1, -1, -21, 1, 1, -19)])
    const result = out()

    raycastAgainstBvh(bvhCerca, vec3(0, 0, 0), vec3(0, 0, -1), 100, result)
    expect(result.distance).toBeCloseTo(4, 6)

    raycastAgainstBvh(bvhLejos, vec3(0, 0, 0), vec3(0, 0, -1), 100, result)
    expect(result.distance).toBeCloseTo(19, 6)
  })
})

describe('raycastMap: el BVH real de la arena', () => {
  it('un rayo hacia el piso desde el spawn le pega al piso', () => {
    const result = out()
    raycastMap(vec3(0, 5, 0), vec3(0, -1, 0), 100, result)
    expect(result.hit).toBe(true)
    expect(result.distance).toBeCloseTo(5, 3)
  })

  it('un rayo hacia arriba desde un punto despejado (sin cobertura encima) no le pega a nada', () => {
    // (0, 1.6, -27): cerca del spawn (0, 0.1, -27) pero fuera del footprint
    // de la cobertura alta que hay junto a ese spawn (box(-4,0,-26,4,HIGH,-24),
    // que no llega hasta z=-27) — un punto abierto de verdad, sin arena
    // sólida por encima hasta el cielo abierto del mapa.
    const result = out()
    raycastMap(vec3(0, 1.6, -27), vec3(0, 1, 0), 5, result)
    expect(result.hit).toBe(false)
  })
})
