import { describe, expect, it } from 'vitest'
import { invulnerabilityExpiresAt, isInvulnerable, pickFarthestSpawn } from '@/game/match/respawn'
import { vec3 } from '@/game/math/vec3'

describe('selección de spawn', () => {
  it('elige el spawn cuya distancia MÍNIMA a cualquier enemigo es la más grande (maximin, no promedio)', () => {
    // Spawn A=(0,0,0): un enemigo a 3m y otro a 60m -> promedio 31.5, mínimo 3.
    // Spawn B=(20,0,0): mismos dos enemigos a 17m y 40m -> promedio 28.5, mínimo 17.
    // Por PROMEDIO, A (31.5) gana a B (28.5) -- pero A tiene un enemigo
    // encima (3m). El criterio correcto (maximin) tiene que elegir B, cuyo
    // peor caso (17m) es mucho más seguro que el peor caso de A (3m).
    const spawns = [vec3(0, 0, 0), vec3(20, 0, 0)]
    const enemies = [vec3(3, 0, 0), vec3(60, 0, 0)]
    expect(pickFarthestSpawn(spawns, enemies)).toBe(1)
  })

  it('sin enemigos vivos, devuelve el primer spawn de forma determinista', () => {
    const spawns = [vec3(-25, 0, -25), vec3(25, 0, 25), vec3(0, 0, -27)]
    expect(pickFarthestSpawn(spawns, [])).toBe(0)
  })

  it('con un solo enemigo, elige el spawn más lejano de ese enemigo', () => {
    const spawns = [vec3(-25, 0, -25), vec3(25, 0, 25), vec3(0, 0, -27)]
    const enemies = [vec3(-24, 0, -24)] // pegado al spawn 0
    expect(pickFarthestSpawn(spawns, enemies)).toBe(1)
  })

  it('enemyCount limita cuántas entradas del buffer de enemyPositions se consideran (buffer scratch más grande de lo necesario)', () => {
    const spawns = [vec3(0, 0, 0), vec3(20, 0, 0)]
    // buffer[0] es el único enemigo "real" esta vez; buffer[1] es basura de
    // una llamada anterior que quedó en el scratch (mismo patrón que
    // game.ts: un buffer de tamaño máximo, sólo las primeras `enemyCount`
    // entradas son vigentes). Si enemyCount se ignorara, el resultado
    // cambiaría entre las dos llamadas -- acá se arma a propósito para que
    // cambie de verdad si el parámetro no se respeta.
    const buffer = [vec3(25, 0, 0), vec3(1, 0, 0)]
    expect(pickFarthestSpawn(spawns, buffer, 1)).toBe(0) // sólo cuenta (25,0,0): spawn 0 (dist 25) gana a spawn 1 (dist 5)
    expect(pickFarthestSpawn(spawns, buffer, 2)).toBe(1) // con la basura sumada, spawn 1 (min 5) gana a spawn 0 (min 1)
  })

  it('un spawn equidistante a varios enemigos gana si el resto tiene un enemigo más cerca todavía', () => {
    const spawns = [vec3(0, 0, 0), vec3(10, 0, 0), vec3(-10, 0, 0)]
    const enemies = [vec3(10, 0, 0), vec3(-10, 0, 0)] // pegados a los spawns 1 y 2
    // Spawn 0 (el centro) queda a 10m de ambos: mejor mínimo que los otros
    // dos, que tienen un enemigo literalmente encima (distancia 0).
    expect(pickFarthestSpawn(spawns, enemies)).toBe(0)
  })
})

describe('ventana de invulnerabilidad', () => {
  it('invulnerabilityExpiresAt suma la duración al reloj de partida', () => {
    expect(invulnerabilityExpiresAt(10, 1.5)).toBeCloseTo(11.5)
  })

  it('invulnerabilityExpiresAt nunca da un vencimiento anterior al reloj actual (duración negativa se clampea a 0)', () => {
    expect(invulnerabilityExpiresAt(10, -5)).toBe(10)
  })

  it('isInvulnerable es true estrictamente antes del vencimiento', () => {
    const expiresAt = invulnerabilityExpiresAt(10, 1.5)
    expect(isInvulnerable(expiresAt, 10)).toBe(true)
    expect(isInvulnerable(expiresAt, 11)).toBe(true)
  })

  it('isInvulnerable es false en el instante exacto del vencimiento y después', () => {
    const expiresAt = invulnerabilityExpiresAt(10, 1.5)
    expect(isInvulnerable(expiresAt, 11.5)).toBe(false)
    expect(isInvulnerable(expiresAt, 20)).toBe(false)
  })
})
