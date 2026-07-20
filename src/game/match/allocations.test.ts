import { describe, expect, it } from 'vitest'
import { createMatchState, recordDamage, recordKill, stepMatch } from '@/game/match/match'
import { createMatchTargets, resolveNearestEnemy } from '@/game/match/targeting'
import { pickFarthestSpawn } from '@/game/match/respawn'
import { ARENA } from '@/game/map/arena'
import { vec3 } from '@/game/math/vec3'
import type { MatchTuning } from '@/game/match/tuning'

const TUNING: MatchTuning = {
  defaultMode: 'tdm',
  botCount: 8,
  difficultyMode: 'uniform',
  uniformDifficultyRank: 0.5,
  mixedDifficultySpread: 0.15,
  respawnDelayS: 3,
  respawnInvulnerabilityS: 1.5,
  scoreLimitFfa: 1_000_000,
  scoreLimitTdm: 1_000_000,
  timeLimitS: 100_000,
  killfeedMaxEntries: 5,
  killfeedEntryLifetimeS: 6,
}

describe('presupuesto de asignaciones de match/', () => {
  it('stepMatch + recordKill + recordDamage sostenidos no hacen crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const state = createMatchState('tdm', 9, TUNING)

    function beat(i: number): void {
      if (i % 7 === 0) recordKill(state, (i % 8) + 1, 0, 'ar-1', i % 3 === 0)
      recordDamage(state, i % 9, 12.5)
      stepMatch(state, 0.01, TUNING)
    }

    for (let i = 0; i < 2000; i++) beat(i)

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    // Derivación (mismo estilo que movement/tuning.ts): el guard tiene que
    // detectar una fuga tan chica como UN number retenido por beat (~8 bytes
    // en V8), no sólo el objeto {x,y,z} con el que se calibró originalmente
    // el umbral de 4.5MB. Para superarlo con un margen holgado (3x o más):
    // beats >= 3 * umbral_bytes / 8 = 3 * 4.5 * 1_048_576 / 8 = 1_769_472.
    // A los 60_000 beats anteriores, una fuga de 8 bytes/beat daba sólo
    // 0.46MB, muy por debajo del umbral -- ni cerca de cruzarlo. 1_800_000
    // redondea hacia arriba y deja ~3.05x de margen (13.73MB de fuga
    // esperada contra el umbral). Confirmado a mano: con un array a nivel de
    // módulo que hace push de un number por llamada en stepMatch()
    // (match/match.ts), este guard con 1_800_000 beats pasó de verde a rojo
    // -- ver el informe de cierre de la tarea para el crecimiento medido
    // exacto.
    for (let i = 0; i < 1_800_000; i++) beat(i)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Mismo umbral que bots/allocations.test.ts (misma escala de ticks).
    expect(crecimientoMB).toBeLessThan(4.5)
  })

  it('resolveNearestEnemy sostenido (el camino de pensamiento de bots) no hace crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const targets = createMatchTargets('ffa', 9)
    for (let i = 0; i < 9; i++) {
      targets.positions[i].x = i * 3
      targets.positions[i].z = (i % 2 === 0 ? 1 : -1) * i
    }
    const out = vec3()

    for (let i = 0; i < 5000; i++) resolveNearestEnemy(targets, i % 9, out)

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    // Derivación (mismo estilo que movement/tuning.ts): iteraciones >=
    // 3 * umbral_bytes / 8 = 3 * 1_048_576 / 8 = 393_216 para que una fuga de
    // un number por llamada (~8 bytes) supere el umbral de 1MB con ~3x de
    // margen. Las 200_000 anteriores ya daban 1.6MB (cruzaban el umbral,
    // pero con sólo ~1.5x de margen -- un filo de cuchillo, no el "3x o más"
    // pedido). 400_000 deja ~3.05x de margen (3.05MB de fuga esperada contra
    // el umbral de 1MB). Confirmado a mano: con un array a nivel de módulo
    // que hace push de un number por llamada en resolveNearestEnemy()
    // (match/targeting.ts), este guard con 400_000 iteraciones pasó de verde
    // a rojo -- ver el informe de cierre de la tarea para el crecimiento
    // medido exacto.
    for (let i = 0; i < 400_000; i++) resolveNearestEnemy(targets, i % 9, out)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })

  it('pickFarthestSpawn contra un buffer scratch preasignado no hace crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const scratch = [vec3(), vec3(), vec3(), vec3(), vec3(), vec3(), vec3(), vec3()]
    function fill(seed: number): number {
      const count = 1 + (seed % scratch.length)
      for (let i = 0; i < count; i++) {
        scratch[i].x = ((seed * 7 + i * 13) % 60) - 30
        scratch[i].z = ((seed * 11 + i * 17) % 60) - 30
      }
      return count
    }

    for (let i = 0; i < 2000; i++) pickFarthestSpawn(ARENA.spawns, scratch, fill(i))

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    // Misma derivación que el test de resolveNearestEnemy de arriba: umbral
    // de 1MB, margen 3x o más -> iteraciones >= 393_216. Las 100_000
    // anteriores daban sólo 0.76MB, por debajo del umbral -- ni lo cruzaban.
    // 400_000 deja ~3.05x de margen. Confirmado a mano: con un array a nivel
    // de módulo que hace push de un number por llamada en pickFarthestSpawn()
    // (match/respawn.ts), este guard con 400_000 iteraciones pasó de verde a
    // rojo -- ver el informe de cierre de la tarea para el crecimiento
    // medido exacto.
    for (let i = 0; i < 400_000; i++) pickFarthestSpawn(ARENA.spawns, scratch, fill(i))

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })
})
