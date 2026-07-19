import { describe, expect, it } from 'vitest'
import { createBotSquad, createBotWorld, stepAllBotsMotor, stepBotCombat, stepBotThink } from '@/game/bots/bot'
import { buildNavGrid } from '@/game/bots/navgrid'
import { BOTS } from '@/game/bots/tuning'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import { raycastMap } from '@/game/combat/hitscan'
import { ARENA } from '@/game/map/arena'
import { TICK_DT } from '@/game/engine/constants'
import type { Hitbox } from '@/game/combat/hitboxes'
import { vec3 } from '@/game/math/vec3'

const ARCHETYPE = ARCHETYPES['ar-1']

describe('presupuesto de asignaciones de bots', () => {
  it('stepAllBotsMotor (apuntado + steering + stepPlayer, el camino de cada tick de simulación) no hace crecer el heap sostenidamente', () => {
    // Ver movement/allocations.test.ts para el patrón base y por qué falla
    // fuerte sin --expose-gc en vez de degradar en silencio.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    const squad = createBotSquad(ARENA.spawns, 10, 0.5, ARCHETYPE)

    // Un think inicial por bot para que cada uno arranque con un camino real
    // asignado en la caché (bots/pathfinding.ts) -- steady state realista,
    // no el caso trivial de "nunca pidió un camino todavía". stepAllBotsMotor
    // en sí NUNCA llama a stepBotThink ni toca la caché de caminos: sólo
    // sigue el camino que ya tiene.
    world.targetEye.x = 5
    world.targetEye.y = 1.6
    world.targetEye.z = 5
    for (const bot of squad) stepBotThink(bot, world, 1 / BOTS.aiTickHz)

    // Calentar: JIT y asentar substeps del pathing inicial (mantle, arribo
    // al primer waypoint, etc.) antes de medir.
    for (let i = 0; i < 5000; i++) stepAllBotsMotor(squad, world, TICK_DT)

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    const TICKS = 60_000
    for (let i = 0; i < TICKS; i++) stepAllBotsMotor(squad, world, TICK_DT)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // 10 bots x 60k ticks = 600k llamadas a stepBotMotor: mismo orden de
    // magnitud que movement/allocations.test.ts (300k ticks de un solo
    // jugador). Mismo umbral (4.5MB) por el mismo motivo -- ver el
    // comentario de ese archivo sobre cómo se calibró.
    expect(crecimientoMB).toBeLessThan(4.5)
  })

  it('stepBotCombat (el mismo stepCombat que el jugador) no hace crecer el heap sostenidamente', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const squad = createBotSquad(ARENA.spawns, 10, 1, ARCHETYPE)
    const playerHitboxes: Hitbox[] = [
      { center: vec3(0, 1.6, -20), radius: 0.4, part: 'torso', owner: -1 },
    ]

    for (const bot of squad) bot.combatInput.triggerHeld = true

    function dispararTodos(): number {
      let shots = 0
      for (const bot of squad) {
        if (bot.combat.fireControl.ammo <= 0) bot.combat.fireControl.ammo = ARCHETYPE.magazine
        shots += stepBotCombat(bot, playerHitboxes, TICK_DT)
      }
      return shots
    }

    for (let i = 0; i < 2000; i++) dispararTodos()

    // Mismo patrón de dos gc() que combat/allocations.test.ts: el hitscan
    // real (three-mesh-bvh) asigna objetos transitorios de intersección de
    // vida corta -- gc() de los dos lados filtra ese ruido sin ocultar una
    // fuga real (ver el comentario de ese archivo).
    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    let shotsTotal = 0
    for (let i = 0; i < 8000; i++) shotsTotal += dispararTodos()
    expect(shotsTotal).toBeGreaterThan(2000)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    expect(crecimientoMB).toBeLessThan(1)
  })
})
