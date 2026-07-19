import { describe, expect, it } from 'vitest'
import {
  createBotSquad,
  createBotState,
  createBotWorld,
  damageBot,
  registerGunshot,
  stepAllBotsMotor,
  stepAllBotsThink,
  stepBotCombat,
  stepBotMotor,
  stepBotThink,
  type BotWorld,
} from '@/game/bots/bot'
import { buildNavGrid } from '@/game/bots/navgrid'
import { lookAt, type YawPitch } from '@/game/bots/aim'
import { BOTS } from '@/game/bots/tuning'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import { buildMapBvh, raycastAgainstBvh, raycastMap } from '@/game/combat/hitscan'
import { ARENA } from '@/game/map/arena'
import { lengthHorizontal, vec3 } from '@/game/math/vec3'
import { MOVEMENT } from '@/game/movement/tuning'
import { TICK_DT } from '@/game/engine/constants'
import type { Box, MapDef } from '@/game/map/types'
import type { Hitbox } from '@/game/combat/hitboxes'

const ARCHETYPE = ARCHETYPES['ar-1']

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box {
  return { min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) }
}

// ---------------------------------------------------------------------------
// Mundo sintético con una pared real (BVH real, mismo camino que producción)
// para las pruebas de percepción/FSM/apuntado, independiente de la
// geometría exacta de la arena real.
// ---------------------------------------------------------------------------

function makeWalledWorld(): { world: BotWorld; map: MapDef } {
  const floor = box(-30, -1, -30, 30, 0, 30)
  const wall = box(-1, 0, -30, 1, 3, 0) // pared en x=[-1,1], desde z=-30 hasta z=0
  const map: MapDef = {
    name: 'test-wall',
    boxes: [floor, wall],
    spawns: [vec3(-10, 0.1, -5), vec3(10, 0.1, -5)],
    bounds: box(-30, 0, -30, 30, 4, 30),
  }
  const bvh = buildMapBvh(map.boxes)
  const raycast = (
    origin: Parameters<typeof raycastAgainstBvh>[1],
    dir: Parameters<typeof raycastAgainstBvh>[2],
    maxDistance: number,
    out: Parameters<typeof raycastAgainstBvh>[4],
  ) => raycastAgainstBvh(bvh, origin, dir, maxDistance, out)
  const grid = buildNavGrid(map, 1, 1.8)
  const world = createBotWorld(map.boxes, raycast, grid)
  return { world, map }
}

describe('percepción integrada al bot: no reacciona a lo que no puede ver ni oír', () => {
  it('no adquiere al objetivo detrás de la pared, aunque esté dentro del cono', () => {
    const { world } = makeWalledWorld()
    const bot = createBotState(vec3(-10, 0, -5), 0, ARCHETYPE, 1)
    bot.aimMotor.yaw = -Math.PI / 2 // mirando hacia +X, hacia el objetivo
    world.targetEye.x = 10
    world.targetEye.y = 1.6
    world.targetEye.z = -5 // mismo z que el bot: la línea directa cruza la pared en x=[-1,1]

    for (let i = 0; i < 30; i++) stepBotThink(bot, world, 1 / BOTS.aiTickHz)

    expect(bot.fsm.current).not.toBe('engage')
  })

  it('sí adquiere al objetivo con línea de vista clara y dentro del cono', () => {
    const { world } = makeWalledWorld()
    const bot = createBotState(vec3(-10, 0, 5), 0, ARCHETYPE, 1) // z=5: por delante de la pared (que termina en z=0)
    bot.aimMotor.yaw = -Math.PI / 2
    world.targetEye.x = -2
    world.targetEye.y = 1.6
    world.targetEye.z = 5

    stepBotThink(bot, world, 1 / BOTS.aiTickHz)

    expect(bot.fsm.current).toBe('engage')
  })

  it('no adquiere al objetivo fuera del cono aunque la línea de vista esté clara', () => {
    const { world } = makeWalledWorld()
    const bot = createBotState(vec3(-10, 0, 5), 0, ARCHETYPE, 1)
    bot.aimMotor.yaw = Math.PI / 2 // mirando hacia -X: el objetivo (a -2, detrás relativo) queda fuera
    world.targetEye.x = -2
    world.targetEye.y = 1.6
    world.targetEye.z = 5

    stepBotThink(bot, world, 1 / BOTS.aiTickHz)

    expect(bot.fsm.current).not.toBe('engage')
  })

  it('un disparo dentro del radio de audición alerta (Idle -> Rotar) sin línea de vista', () => {
    const { world } = makeWalledWorld()
    const bot = createBotState(vec3(-10, 0, -5), 0, ARCHETYPE, 1)
    expect(bot.fsm.current).toBe('idle')

    registerGunshot(world.shots, vec3(-10, 0, -15), 1.0) // a 10m, dentro de hearingRadiusM=30
    world.simTimeS = 1.0
    stepBotThink(bot, world, 1 / BOTS.aiTickHz)

    expect(bot.fsm.current).toBe('rotate')
  })

  it('un disparo fuera del radio de audición NO alerta', () => {
    const { world } = makeWalledWorld()
    const bot = createBotState(vec3(-10, 0, -5), 0, ARCHETYPE, 1)

    registerGunshot(world.shots, vec3(-10, 0, -1000), 1.0) // muy lejos
    stepBotThink(bot, world, 1 / BOTS.aiTickHz)

    expect(bot.fsm.current).toBe('idle')
  })
})

describe('apuntado integrado: converge, nunca snapea, y el cono de error cierra con la dificultad', () => {
  it('el yaw del bot se acerca al objetivo a lo largo de varios ticks, nunca de un salto', () => {
    const { world } = makeWalledWorld()
    const bot = createBotState(vec3(-10, 0, 5), 1, ARCHETYPE, 1) // dificultad más alta: reacciona más rápido igual
    world.targetEye.x = -2
    world.targetEye.y = 1.6
    world.targetEye.z = 5
    const look: YawPitch = { yaw: 0, pitch: 0 }
    lookAt(-10, bot.player.position.y + bot.player.eyeHeight, 5, world.targetEye.x, world.targetEye.y, world.targetEye.z, look)
    // Adentro del cono (55°) pero lejos del objetivo real (30°): tiene que
    // verlo (para entrar en Enfrentar) Y tener que girar de verdad para
    // apuntarle -- no puede arrancar ya mirándolo directo, si no la
    // convergencia no se puede observar.
    bot.aimMotor.yaw = look.yaw - (30 * Math.PI) / 180

    stepBotThink(bot, world, 1 / BOTS.aiTickHz)
    expect(bot.fsm.current).toBe('engage')

    const yaws: number[] = [bot.aimMotor.yaw]
    for (let i = 0; i < 50; i++) {
      stepBotMotor(bot, world, TICK_DT)
      yaws.push(bot.aimMotor.yaw)
    }

    // Nunca un salto mayor al máximo permitido por tick.
    const maxStepRad = (BOTS.aimMaxAngularSpeedDegPerSec * Math.PI) / 180 * TICK_DT
    for (let i = 1; i < yaws.length; i++) {
      let delta = yaws[i] - yaws[i - 1]
      while (delta > Math.PI) delta -= Math.PI * 2
      while (delta < -Math.PI) delta += Math.PI * 2
      expect(Math.abs(delta)).toBeLessThanOrEqual(maxStepRad + 1e-6)
    }

    // Y con dificultad más alta (reacción rápida), a esta altura ya avanzó
    // de forma perceptible hacia el objetivo real -- no se quedó pegado en
    // el yaw inicial.
    expect(Math.abs(yaws[yaws.length - 1] - yaws[0])).toBeGreaterThan(0.05)
  })

  it('con dificultad más baja, el error de apuntado inicial puede ser mayor que con dificultad alta', () => {
    // No es una comparación de una sola muestra (el offset es aleatorio) --
    // es una comparación del TECHO posible: el cono de error de Hierro
    // (6°) es casi 9x el de Radiante (0.7°), así que en una corrida larga
    // el error medio observado tiene que ser bien mayor.
    function errorPromedio(difficultyRank: number, seedBase: number): number {
      const { world } = makeWalledWorld()
      let total = 0
      const N = 200
      for (let i = 0; i < N; i++) {
        const bot = createBotState(vec3(-10, 0, 5), difficultyRank, ARCHETYPE, seedBase + i)
        world.targetEye.x = -2
        world.targetEye.y = 1.6
        world.targetEye.z = 5
        const look: YawPitch = { yaw: 0, pitch: 0 }
        lookAt(-10, bot.player.position.y + bot.player.eyeHeight, 5, world.targetEye.x, world.targetEye.y, world.targetEye.z, look)
        bot.aimMotor.yaw = look.yaw // mirando justo al objetivo: el cono ve, y el error medido es 100% el cono de dificultad
        stepBotThink(bot, world, 1 / BOTS.aiTickHz) // t=0 desde la adquisición: cono completo
        const errRad = Math.hypot(bot.aimTargetYaw - look.yaw, bot.aimTargetPitch - look.pitch)
        total += errRad
      }
      return total / N
    }

    const errorHierro = errorPromedio(0, 1000)
    const errorRadiante = errorPromedio(1, 5000)
    expect(errorHierro).toBeGreaterThan(errorRadiante)
  })
})

describe('combate integrado: el bot dispara por el mismo camino que el jugador', () => {
  it('Enfrentar con línea de vista clara dispara (consume munición del arquetipo real)', () => {
    const { world } = makeWalledWorld()
    const bot = createBotState(vec3(-10, 0, 5), 1, ARCHETYPE, 1)
    world.targetEye.x = -9
    world.targetEye.y = 1.6
    world.targetEye.z = 5
    const look: YawPitch = { yaw: 0, pitch: 0 }
    lookAt(-10, bot.player.position.y + bot.player.eyeHeight, 5, world.targetEye.x, world.targetEye.y, world.targetEye.z, look)
    bot.aimMotor.yaw = look.yaw

    stepBotThink(bot, world, 1 / BOTS.aiTickHz)
    expect(bot.fsm.current).toBe('engage')
    expect(bot.combatInput.triggerHeld).toBe(true)

    const ammoInicial = bot.combat.fireControl.ammo
    const playerHitboxes: Hitbox[] = []
    let shotsTotal = 0
    for (let i = 0; i < 200; i++) {
      stepBotMotor(bot, world, TICK_DT)
      shotsTotal += stepBotCombat(bot, playerHitboxes, TICK_DT)
    }
    expect(shotsTotal).toBeGreaterThan(0)
    expect(bot.combat.fireControl.ammo).toBeLessThan(ammoInicial)
  })

  it('un bot muerto no dispara, sin importar el estado de percepción', () => {
    const { world } = makeWalledWorld()
    const bot = createBotState(vec3(-10, 0, 5), 1, ARCHETYPE, 1)
    world.targetEye.x = -9
    world.targetEye.y = 1.6
    world.targetEye.z = 5
    stepBotThink(bot, world, 1 / BOTS.aiTickHz)
    damageBot(bot, 10000)
    expect(bot.health.alive).toBe(false)

    const shots = stepBotCombat(bot, [], TICK_DT)
    expect(shots).toBe(0)
  })
})

describe('respawn de bots', () => {
  it('un bot muerto revive con vida llena en su spawn tras respawnDelayS', () => {
    const { world } = makeWalledWorld()
    const spawn = vec3(-10, 0, 5)
    const bot = createBotState(spawn, 0, ARCHETYPE, 1)
    damageBot(bot, 10000)
    expect(bot.health.alive).toBe(false)

    const ticks = Math.ceil(BOTS.respawnDelayS / TICK_DT) + 5
    for (let i = 0; i < ticks; i++) stepBotMotor(bot, world, TICK_DT)

    expect(bot.health.alive).toBe(true)
    expect(bot.health.health).toBe(bot.health.maxHealth)
    expect(bot.player.position.x).toBeCloseTo(spawn.x, 6)
    expect(bot.player.position.z).toBeCloseTo(spawn.z, 6)
    expect(bot.fsm.current).toBe('idle')
  })
})

describe('escalonado del tick de IA entre bots', () => {
  it('bots de un mismo squad no piensan todos en el mismo tick de física', () => {
    const squad = createBotSquad([vec3(-10, 0, -5), vec3(10, 0, -5)], 6, 0.5, ARCHETYPE)

    // Cuenta, tick a tick, cuántos bots cruzan su umbral de pensar en el
    // MISMO tick de física. Si el escalonado funciona, nunca deberían ser
    // todos (6) a la vez.
    let algunTickTodosJuntos = false
    for (let i = 0; i < 400; i++) {
      let pensaronEsteTick = 0
      for (const bot of squad) {
        const antes = bot.aiAccumulator
        bot.aiAccumulator += TICK_DT
        if (bot.aiAccumulator >= 1 / BOTS.aiTickHz) pensaronEsteTick++
        bot.aiAccumulator = antes // no consumir de verdad, sólo contar
      }
      if (pensaronEsteTick === squad.length) algunTickTodosJuntos = true
    }
    expect(algunTickTodosJuntos).toBe(false)
  })
})

describe('invariantes de movimiento de bots bajo fuzz (mismas reglas físicas que el jugador)', () => {
  it('la velocidad horizontal y la posición se mantienen acotadas con un objetivo moviéndose al azar por la arena real', () => {
    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    const squad = createBotSquad(ARENA.spawns, 4, 0.5, ARCHETYPE)

    function mulberry32(seed: number): () => number {
      let a = seed | 0
      return function (): number {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }
    const rand = mulberry32(20260719)

    const speedCeiling = MOVEMENT.bhopSoftCap * 1.5
    const TICKS = 4000

    for (let tick = 0; tick < TICKS; tick++) {
      world.simTimeS += TICK_DT
      // El "jugador" teletransporta cada tanto a un punto al azar de la
      // arena -- fuerza a los bots a atravesar Idle/Rotar/Enfrentar/
      // Reposicionar según lo que puedan o no percibir desde ahí.
      if (tick % 90 === 0) {
        world.targetEye.x = (rand() - 0.5) * 58
        world.targetEye.y = 1.6
        world.targetEye.z = (rand() - 0.5) * 58
      }
      // Daño aleatorio ocasional para ejercitar Retirarse y el respawn.
      if (tick % 250 === 0) {
        const bot = squad[Math.floor(rand() * squad.length)]
        damageBot(bot, rand() * 90)
      }

      stepAllBotsThink(squad, world, TICK_DT)
      stepAllBotsMotor(squad, world, TICK_DT)

      for (const bot of squad) {
        const speed = lengthHorizontal(bot.player.velocity)
        expect(speed, `tick ${tick} bot ${bot.id}: velocidad ${speed}`).toBeLessThan(speedCeiling)

        expect(bot.player.position.x, `tick ${tick} bot ${bot.id} x`).toBeGreaterThan(ARENA.bounds.min.x)
        expect(bot.player.position.x, `tick ${tick} bot ${bot.id} x`).toBeLessThan(ARENA.bounds.max.x)
        expect(bot.player.position.y, `tick ${tick} bot ${bot.id} y`).toBeGreaterThan(ARENA.bounds.min.y)
        expect(bot.player.position.y, `tick ${tick} bot ${bot.id} y`).toBeLessThan(ARENA.bounds.max.y)
        expect(bot.player.position.z, `tick ${tick} bot ${bot.id} z`).toBeGreaterThan(ARENA.bounds.min.z)
        expect(bot.player.position.z, `tick ${tick} bot ${bot.id} z`).toBeLessThan(ARENA.bounds.max.z)

        expect(bot.health.health).toBeGreaterThanOrEqual(0)
        expect(bot.health.health).toBeLessThanOrEqual(bot.health.maxHealth)

        const validStates = ['idle', 'rotate', 'engage', 'reposition', 'retreat']
        expect(validStates).toContain(bot.fsm.current)
      }
    }
  })
})
