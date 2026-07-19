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
  mixedDifficultyRanks: [0.5],
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

    for (let i = 0; i < 60_000; i++) beat(i)

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

    for (let i = 0; i < 200_000; i++) resolveNearestEnemy(targets, i % 9, out)

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

    for (let i = 0; i < 100_000; i++) pickFarthestSpawn(ARENA.spawns, scratch, fill(i))

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })
})
