import { describe, expect, it } from 'vitest'
import { createMatchTargets, resolveNearestEnemy } from '@/game/match/targeting'
import { vec3 } from '@/game/math/vec3'

describe('resolución del enemigo más cercano', () => {
  it('ffa: elige al más cercano entre TODOS los demás participantes (todos son enemigos)', () => {
    const targets = createMatchTargets('ffa', 4)
    targets.positions[0] = vec3(0, 0, 0) // self
    targets.positions[1] = vec3(50, 0, 0)
    targets.positions[2] = vec3(5, 0, 0) // el más cercano
    targets.positions[3] = vec3(20, 0, 0)

    const out = vec3()
    const found = resolveNearestEnemy(targets, 0, out)
    expect(found).toBe(true)
    expect(out).toEqual({ x: 5, y: 0, z: 0 })
  })

  it('tdm: ignora a los del mismo equipo (misma paridad de id) aunque estén más cerca', () => {
    const targets = createMatchTargets('tdm', 4)
    targets.positions[0] = vec3(0, 0, 0) // self, equipo 0
    targets.positions[2] = vec3(1, 0, 0) // equipo 0 (mismo que self) -- ignorado pese a estar pegado
    targets.positions[1] = vec3(30, 0, 0) // equipo 1 (enemigo)
    targets.positions[3] = vec3(10, 0, 0) // equipo 1 (enemigo, más cerca)

    const out = vec3()
    const found = resolveNearestEnemy(targets, 0, out)
    expect(found).toBe(true)
    expect(out).toEqual({ x: 10, y: 0, z: 0 })
  })

  it('ignora enemigos muertos', () => {
    const targets = createMatchTargets('ffa', 3)
    targets.positions[0] = vec3(0, 0, 0)
    targets.positions[1] = vec3(5, 0, 0)
    targets.positions[2] = vec3(40, 0, 0)
    targets.alive[1] = false // el más cercano está muerto

    const out = vec3()
    const found = resolveNearestEnemy(targets, 0, out)
    expect(found).toBe(true)
    expect(out).toEqual({ x: 40, y: 0, z: 0 })
  })

  it('sin ningún enemigo vivo, devuelve false y escribe el sentinela lejano', () => {
    const targets = createMatchTargets('tdm', 2)
    targets.positions[0] = vec3(0, 0, 0)
    targets.positions[1] = vec3(5, 0, 0)
    targets.alive[1] = false

    const out = vec3(1, 1, 1)
    const found = resolveNearestEnemy(targets, 0, out)
    expect(found).toBe(false)
    expect(out.x).toBeGreaterThan(1000)
    expect(out.y).toBeGreaterThan(1000)
    expect(out.z).toBeGreaterThan(1000)
  })

  it('nunca se elige a sí mismo como enemigo', () => {
    const targets = createMatchTargets('ffa', 2)
    targets.positions[0] = vec3(0, 0, 0)
    targets.positions[1] = vec3(0, 0, 0) // exactamente en el mismo punto

    const out = vec3()
    const found = resolveNearestEnemy(targets, 0, out)
    expect(found).toBe(true)
    expect(out).toEqual({ x: 0, y: 0, z: 0 }) // el otro participante, no self
  })
})
