import { describe, expect, it } from 'vitest'
import { createBotWorld } from '@/game/bots/bot'
import { buildNavGrid } from '@/game/bots/navgrid'
import { BOTS } from '@/game/bots/tuning'
import { ARENA } from '@/game/map/arena'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import { createMatchBots, stepMatchBotsThink } from '@/game/match/squad'
import { createMatchTargets } from '@/game/match/targeting'
import type { MapHit } from '@/game/combat/hitscan'
import type { Vec3 } from '@/game/math/vec3'
import { vec3 } from '@/game/math/vec3'

/** Línea de vista siempre despejada: aísla el test de la geometría real de
 *  la arena, para probar sólo la resolución de objetivo (a quién apunta
 *  cada bot), no la percepción en sí (ya cubierta en bots/bot.test.ts). */
function clearRaycast(_origin: Vec3, _dir: Vec3, maxDistance: number, out: MapHit): void {
  out.hit = false
  out.distance = maxDistance
}

describe('match/squad: creación con loadout+dificultad por bot', () => {
  it('asigna arquetipo y dificultad por índice, no un valor compartido', () => {
    const archetypes = [ARCHETYPES['ar-1'], ARCHETYPES['smg-1'], ARCHETYPES['pistol']]
    const ranks = [0.1, 0.5, 0.9]
    const bots = createMatchBots(ARENA.spawns, archetypes, ranks)

    expect(bots).toHaveLength(3)
    expect(bots.map((b) => b.archetype.id)).toEqual(['ar-1', 'smg-1', 'pistol'])
    expect(bots.map((b) => b.difficultyRank)).toEqual([0.1, 0.5, 0.9])
  })

  it('escalona el acumulador de IA entre bots (ningún tick los hace pensar a todos)', () => {
    const archetypes = [ARCHETYPES['ar-1'], ARCHETYPES['ar-1'], ARCHETYPES['ar-1']]
    const ranks = [0.5, 0.5, 0.5]
    const bots = createMatchBots(ARENA.spawns, archetypes, ranks)
    const accumulators = new Set(bots.map((b) => b.aiAccumulator))
    expect(accumulators.size).toBe(3)
  })
})

describe('match/squad: pensar contra el enemigo más cercano', () => {
  it('un bot percibe al enemigo vivo más cercano, no un objetivo fijo', () => {
    const grid = buildNavGrid(ARENA)
    const world = createBotWorld(ARENA.boxes, clearRaycast, grid)
    const spawn = vec3(0, 0, 0)
    const bots = createMatchBots([spawn], [ARCHETYPES['ar-1']], [0.5])
    const bot = bots[0]
    const eyeY = bot.player.position.y + bot.player.eyeHeight

    // ffa: 3 participantes -- 0 = jugador (lejísimos), 1 = este bot (self),
    // 2 = otro enemigo, justo delante del bot (yaw 0 mira hacia -Z) y mucho
    // más cerca que el jugador.
    const targets = createMatchTargets('ffa', 3)
    targets.positions[0] = vec3(0, eyeY, 1000)
    targets.positions[1] = vec3(bot.player.position.x, eyeY, bot.player.position.z)
    targets.positions[2] = vec3(0, eyeY, -10)

    bot.aiAccumulator = 1.0 // fuerza al menos un ciclo de pensamiento (15Hz)
    stepMatchBotsThink(bots, world, targets, 0)

    expect(bot.wasVisible).toBe(true)
    expect(bot.lastKnownTargetPos.x).toBeCloseTo(0)
    expect(bot.lastKnownTargetPos.z).toBeCloseTo(-10)
  })

  it('un bot muerto no piensa ni consume el acumulador contra un objetivo', () => {
    const grid = buildNavGrid(ARENA)
    const world = createBotWorld(ARENA.boxes, clearRaycast, grid)
    const bots = createMatchBots([vec3(0, 0, 0)], [ARCHETYPES['ar-1']], [0.5])
    const bot = bots[0]
    bot.health.alive = false

    const targets = createMatchTargets('ffa', 2)
    targets.positions[0] = vec3(0, 1.6, -10)
    targets.positions[1] = vec3(0, 1.6, 0)

    bot.aiAccumulator = 1.0
    expect(() => stepMatchBotsThink(bots, world, targets, 0)).not.toThrow()
    // stepBotThink() mismo retorna de inmediato si !alive (ver bots/bot.ts):
    // no debería haber quedado "visto" a nadie.
    expect(bot.wasVisible).toBe(false)
  })

  it('respeta el intervalo de BOTS.aiTickHz: con dt chico no piensa todavía', () => {
    const grid = buildNavGrid(ARENA)
    const world = createBotWorld(ARENA.boxes, clearRaycast, grid)
    const bots = createMatchBots([vec3(0, 0, 0)], [ARCHETYPES['ar-1']], [0.5])
    const bot = bots[0]
    bot.aiAccumulator = 0

    const targets = createMatchTargets('ffa', 2)
    targets.positions[0] = vec3(0, 1.6, -10)
    targets.positions[1] = vec3(0, 1.6, 0)

    stepMatchBotsThink(bots, world, targets, 1 / BOTS.aiTickHz / 2)
    expect(bot.wasVisible).toBe(false)
  })
})
