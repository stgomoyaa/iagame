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
    // en V8). Para superar el umbral de 0.5MB con un margen holgado (3x o
    // más): beats >= 3 * umbral_bytes / 8 = 3 * 0.5 * 1_048_576 / 8 =
    // 196_608. 200_000 redondea hacia arriba y deja ~3.05x de margen (1.53MB
    // de fuga esperada contra el umbral).
    //
    // Este guard corría 1_800_000 beats contra un umbral de 4.5MB: misma
    // relación 3x, nueve veces más caro (ver movement/allocations.test.ts
    // para por qué el umbral alto era el problema).
    for (let i = 0; i < 200_000; i++) beat(i)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Mismo umbral que bots/allocations.test.ts (misma escala de ticks).
    // Ruido medido acá (200k beats, 6 corridas, Node v26.3.1): 0.034 a
    // 0.048MB -- el más alto de los nueve guards, porque cada beat toca el
    // killfeed (entradas que nacen y vencen). 0.5MB deja >10x de margen,
    // exactamente la misma relación que engine/profiler.test.ts. Fuga
    // inyectada en stepMatch() (match/match.ts): 1.98MB, 4.0x el umbral.
    expect(crecimientoMB).toBeLessThan(0.5)
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
    // 3 * umbral_bytes / 8 = 3 * 0.5 * 1_048_576 / 8 = 196_608 para que una
    // fuga de un number por llamada (~8 bytes) supere el umbral de 0.5MB con
    // ~3x de margen. 200_000 redondea hacia arriba y deja ~3.05x (1.53MB de
    // fuga esperada contra el umbral).
    //
    // Este guard ya corrió 200_000 iteraciones antes, y se subió a 400_000
    // justamente porque contra un umbral de 1MB daban un margen de sólo
    // ~1.5x. Bajando el umbral a 0.5MB las 200_000 vuelven a alcanzar, esta
    // vez con el 3x completo: era el umbral el que estaba mal calibrado.
    for (let i = 0; i < 200_000; i++) resolveNearestEnemy(targets, i % 9, out)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    // Ruido medido (6 corridas, Node v26.3.1): -0.030 a -0.001MB. Fuga
    // inyectada en resolveNearestEnemy() (match/targeting.ts): 1.89MB.
    expect(crecimientoMB).toBeLessThan(0.5)
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
    // de 0.5MB, margen 3x o más -> iteraciones >= 196_608. Las 100_000 que
    // este guard tuvo originalmente daban sólo 0.76MB contra un umbral de
    // 1MB -- ni lo cruzaban. Con el umbral en 0.5MB, 200_000 dan 1.53MB:
    // 3.05x de margen.
    for (let i = 0; i < 200_000; i++) pickFarthestSpawn(ARENA.spawns, scratch, fill(i))

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    // Ruido medido (6 corridas, Node v26.3.1): 0.004 a 0.007MB. Fuga
    // inyectada en pickFarthestSpawn() (match/respawn.ts): 1.95MB.
    expect(crecimientoMB).toBeLessThan(0.5)
  })
})
