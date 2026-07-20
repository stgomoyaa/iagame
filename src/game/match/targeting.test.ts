import { describe, expect, it } from 'vitest'
import {
  createMatchTargets,
  resolveNearestEnemy,
  resolveNearestNeighbour,
} from '@/game/match/targeting'
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

describe('preferencia por el enemigo dentro del cono', () => {
  // yaw 0 mira hacia -Z. Cono de 55° de semiángulo y 45m de alcance, los
  // mismos valores que usa squad.ts desde BOTS.
  const YAW_HACIA_MENOS_Z = 0
  const RANGO = 45
  const SEMI = (55 * Math.PI) / 180

  it('elige al enemigo del cono aunque otro esté más cerca a la espalda', () => {
    // FFA: todos son enemigos entre sí.
    const targets = createMatchTargets('ffa', 3)
    targets.positions[0] = vec3(0, 0, 0) // self, mirando hacia -Z
    targets.positions[1] = vec3(0, 0, 2) // 2m JUSTO DETRÁS (fuera del cono)
    targets.positions[2] = vec3(0, 0, -8) // 8m al frente, dentro del cono

    const out = vec3()
    // Sin cono: gana el de atrás por ser el más cercano -- el bot se queda
    // fijado en alguien que no puede ver nunca.
    expect(resolveNearestEnemy(targets, 0, out)).toBe(true)
    expect(out.z).toBe(2)

    // Con cono: gana el que efectivamente tiene delante.
    expect(resolveNearestEnemy(targets, 0, out, YAW_HACIA_MENOS_Z, RANGO, SEMI)).toBe(true)
    expect(out.z).toBe(-8)
  })

  it('sin nadie en el cono cae al más cercano (lo que mantiene vivos Rotar y Reposicionar)', () => {
    const targets = createMatchTargets('ffa', 3)
    targets.positions[0] = vec3(0, 0, 0)
    targets.positions[1] = vec3(0, 0, 3) // detrás
    targets.positions[2] = vec3(0, 0, 20) // detrás y más lejos

    const out = vec3()
    expect(resolveNearestEnemy(targets, 0, out, YAW_HACIA_MENOS_Z, RANGO, SEMI)).toBe(true)
    expect(out.z).toBe(3)
  })

  it('entre dos enemigos dentro del cono, gana el más cercano', () => {
    const targets = createMatchTargets('ffa', 3)
    targets.positions[0] = vec3(0, 0, 0)
    targets.positions[1] = vec3(0, 0, -30)
    targets.positions[2] = vec3(0, 0, -6)

    const out = vec3()
    expect(resolveNearestEnemy(targets, 0, out, YAW_HACIA_MENOS_Z, RANGO, SEMI)).toBe(true)
    expect(out.z).toBe(-6)
  })

  it('un enemigo dentro del cono pero fuera de alcance no cuenta', () => {
    const targets = createMatchTargets('ffa', 3)
    targets.positions[0] = vec3(0, 0, 0)
    targets.positions[1] = vec3(0, 0, -100) // al frente pero a 100m (> 45m)
    targets.positions[2] = vec3(0, 0, 50) // detrás, más lejos que el alcance

    const out = vec3()
    // Ninguno califica para el cono -> cae al más cercano global (el de -100
    // está a 100m, el de 50 a 50m: gana ese).
    expect(resolveNearestEnemy(targets, 0, out, YAW_HACIA_MENOS_Z, RANGO, SEMI)).toBe(true)
    expect(out.z).toBe(50)
  })

  it('respeta los equipos: un compañero dentro del cono no se elige nunca', () => {
    // TDM: el equipo es la paridad del id. self=0 (equipo 0), 2 es compañero.
    const targets = createMatchTargets('tdm', 3)
    targets.positions[0] = vec3(0, 0, 0)
    targets.positions[1] = vec3(0, 0, 12) // enemigo (id impar), detrás
    targets.positions[2] = vec3(0, 0, -4) // COMPAÑERO, justo al frente

    const out = vec3()
    expect(resolveNearestEnemy(targets, 0, out, YAW_HACIA_MENOS_Z, RANGO, SEMI)).toBe(true)
    expect(out.z).toBe(12)
  })
})

describe('resolución del vecino más cercano (espacio personal)', () => {
  it('no mira equipos: un compañero pegado gana a un enemigo lejano', () => {
    const targets = createMatchTargets('tdm', 4)
    targets.positions[0] = vec3(0, 0, 0) // self, equipo 0
    targets.positions[2] = vec3(1, 0, 0) // equipo 0 (compañero) -- pegado
    targets.positions[1] = vec3(30, 0, 0) // equipo 1
    targets.positions[3] = vec3(10, 0, 0) // equipo 1

    const out = vec3()
    // resolveNearestEnemy ignoraría al compañero; éste NO: un cuerpo encima
    // estorba aunque sea del mismo bando (es la captura que motivó la tarea).
    const d = resolveNearestNeighbour(targets, 0, out)
    expect(out).toEqual({ x: 1, y: 0, z: 0 })
    expect(d).toBeCloseTo(1)
  })

  it('ignora al propio bot y a los muertos', () => {
    const targets = createMatchTargets('ffa', 3)
    targets.positions[0] = vec3(0, 0, 0)
    targets.positions[1] = vec3(2, 0, 0)
    targets.positions[2] = vec3(9, 0, 0)
    targets.alive[1] = false // el más cercano está muerto: un cadáver no estorba

    const out = vec3()
    const d = resolveNearestNeighbour(targets, 0, out)
    expect(out).toEqual({ x: 9, y: 0, z: 0 })
    expect(d).toBeCloseTo(9)
  })

  it('solo en el mapa: Infinity, para que el término de separación se apague', () => {
    const targets = createMatchTargets('ffa', 3)
    targets.positions[0] = vec3(0, 0, 0)
    targets.alive[1] = false
    targets.alive[2] = false

    expect(resolveNearestNeighbour(targets, 0, vec3())).toBe(Infinity)
  })

  it('sólo XZ: alguien justo encima en Y sigue siendo el vecino más cercano', () => {
    const targets = createMatchTargets('ffa', 3)
    targets.positions[0] = vec3(0, 0, 0)
    targets.positions[1] = vec3(0, 20, 0) // mismo XZ, 20m más arriba
    targets.positions[2] = vec3(5, 0, 0)

    const out = vec3()
    expect(resolveNearestNeighbour(targets, 0, out)).toBeCloseTo(0)
    expect(out.y).toBe(20)
  })
})
