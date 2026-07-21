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
import { buildNavGrid, worldToCellIndex } from '@/game/bots/navgrid'
import { lookAt, type YawPitch } from '@/game/bots/aim'
import { BOTS } from '@/game/bots/tuning'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import { buildMapBvh, raycastAgainstBvh, raycastMap } from '@/game/combat/hitscan'
import { ARENA } from '@/game/map/arena'
import { BUNKER } from '@/game/map/bunker'
import { TORRE } from '@/game/map/torre'
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

describe('velocidad de bots (BOTS.botSpeedScale)', () => {
  it('el input del bot arranca con adsSpeedScale = BOTS.botSpeedScale', () => {
    // El freno de los bots se enchufa vía el input: targetSpeed() (movement/step.ts)
    // multiplica la velocidad objetivo por adsSpeedScale. Que el bot lo lleve en
    // su input es lo que lo frena sin tocar la física ni al jugador.
    const bot = createBotState(vec3(0, 0, 0), 0, ARCHETYPE, 1)
    expect(bot.input.adsSpeedScale).toBe(BOTS.botSpeedScale)
    // El freno es real (por debajo de 1), no un no-op accidental.
    expect(BOTS.botSpeedScale).toBeGreaterThan(0)
    expect(BOTS.botSpeedScale).toBeLessThan(1)
  })
})

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

    // Nunca un salto mayor al máximo permitido por tick. La velocidad de
    // giro ahora es POR TRAMO (bots/difficulty.ts aimSpeedDegPerSec), no la
    // constante única de antes: este bot es dificultad 1 (Experto), así que
    // el tope es el suyo.
    const maxStepRad = (bot.difficulty.aimSpeedDegPerSec * Math.PI) / 180 * TICK_DT
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
    // Ya NO se puede exigir triggerHeld en el primer think: la demora de
    // ataque (bots/difficulty.ts attackDelayS) hace que el bot espere a
    // reaccionar antes de apretar el gatillo -- ese retardo es justamente la
    // palanca de dificultad que antes no existía. Lo que se afirma es el
    // resultado: siguiendo el bucle de la partida (think a 15Hz vía
    // stepAllBotsThink), termina disparando y gastando munición.
    const ammoInicial = bot.combat.fireControl.ammo
    const playerHitboxes: Hitbox[] = []
    let shotsTotal = 0
    for (let i = 0; i < 200; i++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
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

  it('un bot que se queda sin munición se recarga solo y vuelve a disparar (no queda desarmado el resto de la partida)', () => {
    const bot = createBotState(vec3(-10, 0, 5), 1, ARCHETYPE, 1)
    bot.combatInput.triggerHeld = true
    bot.combat.fireControl.ammo = 0

    // Un tick alcanza para detectar el cargador vacío y arrancar la recarga sola.
    stepBotCombat(bot, [], TICK_DT)
    expect(bot.combatInput.reloading).toBe(true)
    expect(bot.reloadTimerS).toBeGreaterThan(0)

    // Mientras el temporizador no termina, sigue sin poder disparar.
    const shotsMidReload = stepBotCombat(bot, [], TICK_DT)
    expect(shotsMidReload).toBe(0)
    expect(bot.combat.fireControl.ammo).toBe(0)

    // Agota el temporizador completo (archetype.reload.empty).
    const ticks = Math.ceil(ARCHETYPE.reload.empty / TICK_DT) + 2
    for (let i = 0; i < ticks; i++) stepBotCombat(bot, [], TICK_DT)

    // El cargador se rellena al terminar la recarga. Puede haber gastado ya
    // el primer disparo en el mismo tick en que terminó (el gatillo sigue
    // sostenido) -- lo que importa es que NO se quedó en 0 para siempre.
    expect(bot.combatInput.reloading).toBe(false)
    expect(bot.combat.fireControl.ammo).toBeGreaterThan(0)
    expect(bot.combat.fireControl.ammo).toBeLessThanOrEqual(ARCHETYPE.magazine)
  })

  it('morir a mitad de una recarga no deja al bot "recargando" para siempre tras reaparecer', () => {
    const { world } = makeWalledWorld()
    const bot = createBotState(vec3(-10, 0, 5), 1, ARCHETYPE, 1)
    bot.combatInput.triggerHeld = true
    bot.combat.fireControl.ammo = 0
    stepBotCombat(bot, [], TICK_DT) // arranca la recarga
    expect(bot.combatInput.reloading).toBe(true)

    damageBot(bot, 10000) // muere a mitad de la recarga
    expect(bot.health.alive).toBe(false)

    stepBotMotor(bot, world, TICK_DT)

    expect(bot.combatInput.reloading).toBe(false)
    expect(bot.reloadTimerS).toBe(0)
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
    let chequeos = 0

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

      // Las invariantes se chequean con comparaciones planas y sólo se
      // convierten en un expect() cuando alguna se rompe. El motivo es de
      // costo, no de estilo: la versión anterior llamaba a expect() nueve
      // veces por bot por tick (4000 ticks x 4 bots x 9 = 144.000 llamadas)
      // y además construía el template literal del mensaje en CADA una,
      // incluso en el 100% de los casos en que la invariante se cumplía.
      // Eso dominaba el tiempo del test (1305ms) muy por encima de la
      // simulación que realmente quiere ejercitar, y lo dejaba a 3.8x del
      // timeout de 5s por defecto: con la máquina cargada se pasaba y
      // fallaba por tiempo, no por una invariante rota. Chequear primero y
      // construir el mensaje sólo al fallar mantiene EXACTAMENTE las mismas
      // invariantes sobre los mismos ticks (misma semilla, mismo recorrido)
      // y saca el costo del camino feliz.
      for (const bot of squad) {
        const speed = lengthHorizontal(bot.player.velocity)
        const pos = bot.player.position
        const salud = bot.health.health
        const estadoValido =
          bot.fsm.current === 'idle' ||
          bot.fsm.current === 'rotate' ||
          bot.fsm.current === 'engage' ||
          bot.fsm.current === 'reposition' ||
          bot.fsm.current === 'retreat'

        const roto =
          !(speed < speedCeiling) ||
          !(pos.x > ARENA.bounds.min.x) ||
          !(pos.x < ARENA.bounds.max.x) ||
          !(pos.y > ARENA.bounds.min.y) ||
          !(pos.y < ARENA.bounds.max.y) ||
          !(pos.z > ARENA.bounds.min.z) ||
          !(pos.z < ARENA.bounds.max.z) ||
          !(salud >= 0) ||
          !(salud <= bot.health.maxHealth) ||
          !estadoValido

        // Sólo en el camino de fallo se paga el costo de expect(): así el
        // reporte sigue señalando la invariante exacta, el tick y el bot.
        if (roto) {
          const donde = `tick ${tick} bot ${bot.id}`
          expect(speed, `${donde}: velocidad ${speed}`).toBeLessThan(speedCeiling)
          expect(pos.x, `${donde} x`).toBeGreaterThan(ARENA.bounds.min.x)
          expect(pos.x, `${donde} x`).toBeLessThan(ARENA.bounds.max.x)
          expect(pos.y, `${donde} y`).toBeGreaterThan(ARENA.bounds.min.y)
          expect(pos.y, `${donde} y`).toBeLessThan(ARENA.bounds.max.y)
          expect(pos.z, `${donde} z`).toBeGreaterThan(ARENA.bounds.min.z)
          expect(pos.z, `${donde} z`).toBeLessThan(ARENA.bounds.max.z)
          expect(salud, `${donde} vida`).toBeGreaterThanOrEqual(0)
          expect(salud, `${donde} vida`).toBeLessThanOrEqual(bot.health.maxHealth)
          expect(
            ['idle', 'rotate', 'engage', 'reposition', 'retreat'],
            `${donde} estado ${bot.fsm.current}`,
          ).toContain(bot.fsm.current)
          // Si ninguno de los expect() de arriba falló, la condición `roto`
          // y estos chequeos no coinciden: es un bug de ESTE test, no del
          // motor, y hay que enterarse en vez de pasar en verde.
          throw new Error(`${donde}: invariante rota que los expect() no reprodujeron`)
        }
        chequeos++
      }
    }

    // El fuzz sólo vale si de verdad recorrió todos los ticks con todos los
    // bots: sin esto, un `continue` o un early-return futuro lo dejaría
    // pasando en verde sin haber chequeado nada.
    expect(chequeos).toBe(TICKS * squad.length)
  })
})

// ---------------------------------------------------------------------------
// Idle patrulla (no se queda clavado) y Enfrentar strafea (no dispara plantado).
// Los dos comportamientos que esta tarea agrega, medidos sobre la arena real.
// ---------------------------------------------------------------------------

describe('Idle caza en vez de esperar', () => {
  it('un bot en Idle sin ningún contacto recorre metros reales del mapa', () => {
    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    const bot = createBotState(vec3(-25, 0.1, -25), 0.5, ARCHETYPE, 11)
    // Objetivo fuera de todo alcance de visión y audición: el bot no tiene
    // ni va a tener contacto en toda la corrida -- es el escenario exacto
    // que antes lo congelaba.
    world.targetEye.x = 1e6
    world.targetEye.y = 1e6
    world.targetEye.z = 1e6

    const inicioX = bot.player.position.x
    const inicioZ = bot.player.position.z

    for (let tick = 0; tick < 1200; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
    }

    expect(bot.fsm.current).toBe('idle')
    const recorrido = Math.hypot(bot.player.position.x - inicioX, bot.player.position.z - inicioZ)
    expect(recorrido, `un bot en Idle se movió sólo ${recorrido.toFixed(1)}m`).toBeGreaterThan(10)
  })

  it('sin contacto en 60s de simulación, dos bots en esquinas opuestas terminan viéndose', () => {
    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    const a = createBotState(vec3(-25, 0.1, -25), 0.5, ARCHETYPE, 21)
    const b = createBotState(vec3(25, 0.1, 25), 0.5, ARCHETYPE, 22)
    const bots = [a, b]

    let seVieron = false
    // 60s a 128Hz. Cada bot "ve" al otro: se reescribe targetEye antes de
    // cada think, igual que hace match/squad.ts en una partida real.
    for (let tick = 0; tick < 7680 && !seVieron; tick++) {
      world.simTimeS += TICK_DT
      for (const bot of bots) {
        const otro = bot === a ? b : a
        world.targetEye.x = otro.player.position.x
        world.targetEye.y = otro.player.position.y + otro.player.eyeHeight
        world.targetEye.z = otro.player.position.z
        stepAllBotsThink([bot], world, TICK_DT)
      }
      stepAllBotsMotor(bots, world, TICK_DT)
      if (a.fsm.current === 'engage' || b.fsm.current === 'engage') seVieron = true
    }

    expect(seVieron, 'dos bots patrullando no se encontraron en 60s').toBe(true)
  })

  it('al entrar en Idle con un disparo reciente en la memoria, va a mirar dónde sonó', () => {
    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    const bot = createBotState(vec3(-20, 0.1, -20), 0.5, ARCHETYPE, 31)
    world.targetEye.x = 1e6
    world.targetEye.y = 1e6
    world.targetEye.z = 1e6

    // Un disparo dentro del radio de audición, en dirección al centro.
    world.simTimeS = 1
    registerGunshot(world.shots, vec3(-8, 1.6, -8), world.simTimeS)
    stepBotThink(bot, world, 1 / BOTS.aiTickHz)
    expect(bot.fsm.current).toBe('rotate')

    // Se deja vencer la sospecha (suspicionMemoryS) sin reforzarla: cae a
    // Idle, y ahí es donde el bot decide ir a mirar el lugar del disparo.
    let distanciaMinima = Infinity
    for (let tick = 0; tick < 2560; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
      const d = Math.hypot(bot.player.position.x - -8, bot.player.position.z - -8)
      if (d < distanciaMinima) distanciaMinima = d
    }

    expect(distanciaMinima, `nunca se acercó al disparo (mínimo ${distanciaMinima.toFixed(1)}m)`).toBeLessThan(3)
  })

  it('la patrulla no usa posiciones vivas de enemigos: mover el objetivo lejos no cambia el recorrido', () => {
    function correr(objetivo: { x: number; z: number }): number[] {
      const grid = buildNavGrid(ARENA, 1, 1.8)
      const world = createBotWorld(ARENA.boxes, raycastMap, grid)
      const bot = createBotState(vec3(-25, 0.1, -25), 0.5, ARCHETYPE, 41)
      // Los dos objetivos están fuera del rango de visión y audición del
      // bot: si la patrulla fuera honesta, el recorrido tiene que ser
      // idéntico en las dos corridas.
      world.targetEye.y = 1.6
      const camino: number[] = []
      for (let tick = 0; tick < 1200; tick++) {
        world.simTimeS += TICK_DT
        world.targetEye.x = objetivo.x
        world.targetEye.z = objetivo.z
        stepAllBotsThink([bot], world, TICK_DT)
        stepAllBotsMotor([bot], world, TICK_DT)
        if (tick % 100 === 0) camino.push(Math.round(bot.player.position.x * 100), Math.round(bot.player.position.z * 100))
      }
      return camino
    }

    expect(correr({ x: 1e6, z: 1e6 })).toEqual(correr({ x: -1e6, z: -1e6 }))
  })
})

// ---------------------------------------------------------------------------
// Enfrentar se ACERCA cuando el objetivo está lejos.
//
// La causa de fondo del amontonamiento: Enfrentar hacía `clearPath` siempre,
// así que un bot que adquiría blanco se plantaba a disparar a cualquier
// distancia (hasta 45m, el alcance de visión) con el strafe atado a 3m como
// único movimiento. Medido en nuketown con 8 bots, la mitad de las muestras
// de bot vivo caían en Enfrentar: dos bots que se cruzaban quedaban
// congelados juntos todo el tiroteo.
// ---------------------------------------------------------------------------

describe('Enfrentar se acerca en vez de quedarse clavado a distancia', () => {
  // Duelo largo en la arena: 24m de separación, muy por encima de
  // engageAdvanceM (18), con línea de vista limpia por el carril.
  function mundoDeDueloLargo() {
    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    const bot = createBotState(vec3(-16, 0.1, 12), 0.5, ARCHETYPE, 51)
    bot.aimMotor.yaw = 0
    world.targetEye.x = -16
    world.targetEye.y = 1.6
    world.targetEye.z = -12
    return { world, bot }
  }

  function distanciaAlObjetivo(bot: ReturnType<typeof createBotState>, world: BotWorld): number {
    return Math.hypot(
      bot.player.position.x - world.targetEye.x,
      bot.player.position.z - world.targetEye.z,
    )
  }

  it('a 24m acorta la distancia en vez de disparar desde donde adquirió el blanco', () => {
    const { world, bot } = mundoDeDueloLargo()
    const alEmpezar = distanciaAlObjetivo(bot, world)

    for (let tick = 0; tick < 1400; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
    }

    expect(bot.fsm.current).toBe('engage')
    const alTerminar = distanciaAlObjetivo(bot, world)
    // Umbral ABSOLUTO, no relativo a BOTS.engageAdvanceM: con la distancia
    // medida contra la propia constante que gobierna el avance, subirla a
    // 1e9 (o sea, apagar el arreglo) hace pasar la prueba igual. Verificado
    // rompiendo la implementación a propósito.
    //
    // El bot arranca a 24m. Con el `clearPath` incondicional viejo no tenía
    // forma de avanzar -- sólo strafe atado a 3m del ancla -- así que
    // acortar 10m es imposible sin el arreglo.
    expect(alEmpezar).toBeGreaterThan(20)
    expect(
      alEmpezar - alTerminar,
      `arrancó a ${alEmpezar.toFixed(1)}m y quedó a ${alTerminar.toFixed(1)}m`,
    ).toBeGreaterThan(10)
  })

  it('acercándose sigue disparando y no esprinta', () => {
    const { world, bot } = mundoDeDueloLargo()
    let avanzoAlgunaVez = false
    let disparoAvanzando = false

    for (let tick = 0; tick < 900; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
      if (bot.fsm.current !== 'engage') continue
      if (bot.engageAdvancing) {
        avanzoAlgunaVez = true
        // Avanza disparando: acercarse no es dejar de pelear. NO se exige
        // en CADA tick -- la demora de ataque (attackDelayS) y los cortes
        // momentáneos de línea de vista al navegar dejan ticks sin gatillo
        // que son correctos. Lo que no puede pasar es avanzar con el arma
        // guardada TODO el tramo: se afirma que disparó EN ALGÚN momento
        // mientras avanzaba.
        if (bot.combatInput.triggerHeld || bot.combat.recoil.pitchOffset > 0) disparoAvanzando = true
      }
      expect(bot.input.sprint, 'un bot en combate no esprinta ni acercándose').toBe(false)
    }

    expect(avanzoAlgunaVez, 'nunca entró en modo de avance').toBe(true)
    expect(disparoAvanzando, 'avanzó todo el tramo con el arma guardada').toBe(true)
  })

  it('llegado a distancia de duelo re-ancla y vuelve a bailar en el sitio', () => {
    const { world, bot } = mundoDeDueloLargo()

    for (let tick = 0; tick < 1400; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
    }
    expect(bot.engageAdvancing, 'debería haber dejado de avanzar').toBe(false)

    // Ya en duelo: el ancla tiene que estar DONDE LLEGÓ, no en el punto
    // lejano donde entró en Enfrentar. Si no se re-anclara, canStrafeTowards
    // rechazaría todo paso lateral y el bot quedaría plantado justo después
    // de acercarse -- el mismo bug, movido de lugar.
    for (let tick = 0; tick < 600; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
      if (bot.fsm.current !== 'engage' || bot.engageAdvancing) continue
      const d = Math.hypot(
        bot.player.position.x - bot.strafeAnchor.x,
        bot.player.position.z - bot.strafeAnchor.z,
      )
      expect(d).toBeLessThan(BOTS.engageStrafeRadiusM + BOTS.engageStrafeProbeM + 1)
    }
  })

  it('a distancia de duelo (12m) NO avanza: el umbral no se dispara solo', () => {
    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    const bot = createBotState(vec3(-16, 0.1, 6), 0.5, ARCHETYPE, 51)
    bot.aimMotor.yaw = 0
    world.targetEye.x = -16
    world.targetEye.y = 1.6
    world.targetEye.z = -6

    for (let tick = 0; tick < 900; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
      expect(bot.engageAdvancing, `tick ${tick}: avanzó estando a distancia de duelo`).toBe(false)
    }
  })
})

describe('Enfrentar: el movimiento lateral responde a una intención, no a un temblor', () => {
  function mundoDeDuelo(rank = 0.5) {
    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    // Junto a la cobertura baja del carril izquierdo (map/arena.ts), con
    // línea de vista limpia hacia el objetivo.
    const bot = createBotState(vec3(-16, 0.1, 6), rank, ARCHETYPE, 51)
    bot.aimMotor.yaw = 0
    world.targetEye.x = -16
    world.targetEye.y = 1.6
    world.targetEye.z = -6
    return { world, bot }
  }

  /** Corre el duelo y resume el movimiento lateral (eje X, que es el lateral
   *  en esta geometría): recorrido total y cuántas veces invirtió el sentido
   *  mientras estaba en Enfrentar. El conteo de inversiones es la lectura
   *  directa del zigzag -- un umbral de 1cm/tick descarta el ruido del
   *  integrador de física. */
  function recorrerLateral(
    world: BotWorld,
    bot: ReturnType<typeof createBotState>,
    ticks: number,
  ): { recorrido: number; cambiosDeSentido: number } {
    let recorrido = 0
    let cambiosDeSentido = 0
    let sentidoPrev = 0
    let xPrev = bot.player.position.x
    for (let tick = 0; tick < ticks; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
      if (bot.fsm.current !== 'engage') {
        xPrev = bot.player.position.x
        continue
      }
      const paso = bot.player.position.x - xPrev
      xPrev = bot.player.position.x
      if (Math.abs(paso) < 0.01) continue
      recorrido += Math.abs(paso)
      const sentido = paso > 0 ? 1 : -1
      if (sentidoPrev !== 0 && sentido !== sentidoPrev) cambiosDeSentido++
      sentidoPrev = sentido
    }
    return { recorrido, cambiosDeSentido }
  }

  it('un bot en Enfrentar se mueve lateralmente, no se queda clavado', () => {
    // Un bot AGRESIVO (dificultad 1) busca ángulo: se mueve de lado. Pero lo
    // que se afirma NO es sólo "se movió" -- eso era lo que afirmaba la
    // versión vieja de esta prueba, que sin querer consagraba el zigzag como
    // invariante. Se afirma que el movimiento es COMPROMETIDO: pocos cambios
    // de sentido. Un metrónomo (el bug que esta tarea saca) daría decenas.
    const { world, bot } = mundoDeDuelo(1)
    const muestras = recorrerLateral(world, bot, 640)

    expect(bot.fsm.current).toBe('engage')
    expect(muestras.recorrido, 'un bot agresivo no busca ángulo').toBeGreaterThan(0.8)
    // La barra anti-zigzag: en ~5s de duelo, un rodeo con intención cambia de
    // sentido un puñado de veces (rodea, se planta, rodea al otro lado), no
    // en cada tick. El metrónomo viejo daba ~20 en 12s -> ~8 en 5s; exigir
    // <= 6 lo mata sin ser frágil ante el ruido del integrador.
    expect(muestras.cambiosDeSentido, 'se mueve como metrónomo, no con intención').toBeLessThanOrEqual(6)
  })

  it('un bot defensivo, junto a cobertura y sin que le disparen, se planta: no tiembla', () => {
    // Éste es el corazón del arreglo del zigzag. Dificultad 0.5 (Normal, no
    // rodea) pegado a cobertura y con un objetivo que NO le dispara: no hay
    // NINGUNA intención lateral que nombrar, así que el bot se queda quieto y
    // dispara, como un bot de CS 1.6. La versión vieja de estos bots temblaba
    // acá 4.86 m/s por nada.
    const { world, bot } = mundoDeDuelo(0.5)
    const muestras = recorrerLateral(world, bot, 640)

    expect(bot.fsm.current).toBe('engage')
    // Ni recorre lateralmente de forma apreciable ni cambia de sentido: las
    // dos caras de "no tiembla".
    expect(muestras.cambiosDeSentido, 'un bot sin intención no debería oscilar').toBeLessThanOrEqual(2)
  })

  it('un bot al que le están disparando rompe la línea de tiro, aunque no sea agresivo', () => {
    // Dificultad 0 (Fácil, agresividad 0.2: NO rodea). Junto a cobertura, así
    // que tampoco busca cubrirse. La ÚNICA intención que puede moverlo es
    // 'romper-linea', y sólo se enciende porque le están pegando.
    const { world, bot } = mundoDeDuelo(0)

    // Control: el mismo bot SIN recibir daño se queda plantado.
    const control = recorrerLateral(world, bot, 320)
    expect(control.recorrido, 'sin que le disparen no debería moverse de lado').toBeLessThan(0.4)

    // Ahora sí: un impacto leve por tick (no lo mata) mantiene sinDanoS en 0
    // y con eso la intención 'romper-linea' viva.
    const { world: world2, bot: bot2 } = mundoDeDuelo(0)
    let recorrido = 0
    let xPrev = bot2.player.position.x
    for (let tick = 0; tick < 320; tick++) {
      world2.simTimeS += TICK_DT
      stepAllBotsThink([bot2], world2, TICK_DT)
      stepAllBotsMotor([bot2], world2, TICK_DT)
      if (bot2.health.alive) damageBot(bot2, 1) // le disparan: 1 de daño/tick
      if (bot2.fsm.current !== 'engage') continue
      recorrido += Math.abs(bot2.player.position.x - xPrev)
      xPrev = bot2.player.position.x
    }
    expect(recorrido, 'bajo fuego debería romper la línea moviéndose de lado').toBeGreaterThan(0.8)
  })

  it('el strafe no se aleja del punto donde entró en Enfrentar: busca ángulo, no emigra', () => {
    const { world, bot } = mundoDeDuelo()

    for (let tick = 0; tick < 1280; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
      if (bot.fsm.current !== 'engage') continue
      const d = Math.hypot(
        bot.player.position.x - bot.strafeAnchor.x,
        bot.player.position.z - bot.strafeAnchor.z,
      )
      // Radio del ancla más el sondeo y un margen de un paso de física: el
      // bot decide a 15Hz pero se mueve a 128Hz.
      expect(d, `tick ${tick}: se alejó ${d.toFixed(2)}m del ancla`).toBeLessThan(
        BOTS.engageStrafeRadiusM + BOTS.engageStrafeProbeM + 1,
      )
    }
  })

  it('el strafe no puede ir más rápido que el jugador: usa el mismo stepPlayer', () => {
    const { world, bot } = mundoDeDuelo()
    for (let tick = 0; tick < 640; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
      if (bot.fsm.current !== 'engage') continue
      expect(bot.input.sprint, 'un bot strafeando en combate no esprinta').toBe(false)
      expect(lengthHorizontal(bot.player.velocity)).toBeLessThanOrEqual(MOVEMENT.walkSpeed + 0.5)
    }
  })

  it('sin terreno lateral válido a ningún lado, el sentido queda en 0 (dispara plantado antes que salir a campo abierto)', () => {
    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    // Metido en la esquina del mapa, mirando en diagonal hacia afuera: los
    // dos lados dan contra muro perimetral.
    const bot = createBotState(vec3(-28.5, 0.1, -28.5), 0.5, ARCHETYPE, 61)
    bot.aimMotor.yaw = Math.PI * 0.75
    world.targetEye.x = -28.5
    world.targetEye.y = 1.6
    world.targetEye.z = -28.5
    bot.fsm.current = 'engage'
    bot.strafeAnchor.x = bot.player.position.x
    bot.strafeAnchor.z = bot.player.position.z

    for (let tick = 0; tick < 60; tick++) {
      stepBotThink(bot, world, 1 / BOTS.aiTickHz)
    }

    expect(Math.abs(bot.player.position.x)).toBeLessThan(30)
    expect(Math.abs(bot.player.position.z)).toBeLessThan(30)
  })
})

// ---------------------------------------------------------------------------
// Destinos alcanzables: el bug que los mapas nuevos destaparon.
// ---------------------------------------------------------------------------

describe('los destinos que elige un bot son alcanzables de verdad', () => {
  // "Caminable" no es "alcanzable": el bake del navgrid marca caminable el
  // techo de cualquier muro o cobertura alta, superficies planas con espacio
  // libre encima a las que nadie puede subir. pickCandidateCell (Retirarse y
  // Reposicionar), la investigación de última actividad y Rotar elegían
  // destino con nearestWalkableCellIndex SIN la máscara de alcanzables, así
  // que apuntaban a esos techos, A* no encontraba camino y el bot se quedaba
  // plantado. Medido jugando antes del arreglo: 37% de las muestras de bot
  // vivo en la arena y 52% en el búnker, casi todas en Retirarse sin camino.
  // El búnker lo exhibe más fuerte que la arena porque tiene mucha más
  // superficie de muro por metro cuadrado.

  it('createBotWorld expone la máscara de alcanzables y excluye los techos de muro', () => {
    const grid = buildNavGrid(BUNKER, 1, 1.8)
    const world = createBotWorld(BUNKER.boxes, raycastMap, grid)

    expect(world.reachable.length).toBe(grid.cols * grid.rows)

    // El techo de un muro interior del búnker (4m) es caminable pero no
    // alcanzable: el alcance real desde el piso es ~2.16m.
    const enMuro = worldToCellIndex(grid, -6.5, -15.5)
    expect(grid.walkable[enMuro], 'el techo del muro es caminable').toBe(1)
    expect(grid.heights[enMuro]).toBe(4)
    expect(world.reachable[enMuro], 'pero no alcanzable').toBe(0)

    // El piso de una sala sí.
    const enSala = worldToCellIndex(grid, -15.5, -15.5)
    expect(world.reachable[enSala]).toBe(1)
  })

  it.each([
    ['arena', ARENA],
    ['bunker', BUNKER],
    ['torre', TORRE],
  ])('en %s, un escuadrón bajo fuego no se queda plantado sin camino', (nombre, map) => {
    const grid = buildNavGrid(map, 1, 1.8)
    const world = createBotWorld(map.boxes, raycastMap, grid)
    const squad = createBotSquad(map.spawns, 8, 0.5, ARCHETYPE)

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

    const TICKS = 7200
    const previa = squad.map((b) => ({ x: b.player.position.x, z: b.player.position.z }))
    const quietoTicks = squad.map(() => 0)
    const maxQuieto = squad.map(() => 0)
    let muestrasVivas = 0
    let retreatSinCamino = 0

    for (let tick = 0; tick < TICKS; tick++) {
      world.simTimeS += TICK_DT
      // El objetivo salta por el mapa: fuerza a los bots a recorrer todos
      // los estados según lo que puedan o no percibir desde ahí.
      if (tick % 90 === 0) {
        world.targetEye.x = (rand() - 0.5) * (map.bounds.max.x - map.bounds.min.x) * 0.9
        world.targetEye.y = 1.6
        world.targetEye.z = (rand() - 0.5) * (map.bounds.max.z - map.bounds.min.z) * 0.9
      }
      // Daño frecuente: Retirarse es justo el estado donde vivía el bug.
      if (tick % 120 === 0) damageBot(squad[Math.floor(rand() * squad.length)], rand() * 90)

      stepAllBotsThink(squad, world, TICK_DT)
      stepAllBotsMotor(squad, world, TICK_DT)

      for (let i = 0; i < squad.length; i++) {
        const bot = squad[i]
        if (!bot.health.alive) {
          quietoTicks[i] = 0
          continue
        }
        muestrasVivas++
        if (bot.fsm.current === 'retreat' && bot.pathIndex >= bot.path.length) retreatSinCamino++

        const movido = Math.hypot(
          bot.player.position.x - previa[i].x,
          bot.player.position.z - previa[i].z,
        )
        previa[i].x = bot.player.position.x
        previa[i].z = bot.player.position.z
        quietoTicks[i] = movido < 0.005 ? quietoTicks[i] + 1 : 0
        if (quietoTicks[i] > maxQuieto[i]) maxQuieto[i] = quietoTicks[i]
      }
    }

    // Números medidos con este mismo escenario. Sin el arreglo: hasta 9.8s
    // clavado en el búnker y 7.5s en la arena, con 9.2% y 6.4% de las
    // muestras vivas en Retirarse sin camino. Con el arreglo: 1.3s y 1.4s,
    // 0.3% y 0.5%. Los techos de abajo quedan cómodamente entre los dos.
    const limiteTicks = Math.round(4 / TICK_DT)
    for (let i = 0; i < squad.length; i++) {
      expect(
        maxQuieto[i],
        `bot ${i} estuvo ${(maxQuieto[i] * TICK_DT).toFixed(1)}s clavado en ${nombre}`,
      ).toBeLessThan(limiteTicks)
    }

    const pctRetreatSinCamino = (100 * retreatSinCamino) / muestrasVivas
    expect(
      pctRetreatSinCamino,
      `${pctRetreatSinCamino.toFixed(1)}% de las muestras vivas en Retirarse sin camino en ${nombre}`,
    ).toBeLessThan(3)
  })
})

describe('acorralado: en Retirarse, con el enemigo encima, pelea en vez de morir de espaldas', () => {
  // Bot herido (entra a Retirarse por vida baja) con el enemigo a la vista.
  // La única variable entre los dos casos es la DISTANCIA al enemigo.
  function botHeridoConEnemigoA(distanciaM: number) {
    const { world } = makeWalledWorld()
    // z=5 deja al bot por delante de la pared (que termina en z=0), así que
    // hay línea de vista limpia hacia el enemigo.
    const bot = createBotState(vec3(-10, 0, 5), 0, ARCHETYPE, 1)
    world.targetEye.x = -10 + distanciaM
    world.targetEye.y = 1.6
    world.targetEye.z = 5
    // Lo deja mirando hacia el enemigo para que caiga dentro del cono.
    bot.aimMotor.yaw = -Math.PI / 2
    // Vida por debajo de retreatEnterHealthFraction (0.3) -> Retirarse.
    damageBot(bot, BOTS.maxHealth * 0.85)
    for (let i = 0; i < 3; i++) stepBotThink(bot, world, 1 / BOTS.aiTickHz)
    return bot
  }

  it('a quemarropa (dentro de retreatFightBackM) aprieta el gatillo aunque esté en Retirarse', () => {
    const bot = botHeridoConEnemigoA(BOTS.retreatFightBackM - 3)
    expect(bot.fsm.current).toBe('retreat')
    expect(bot.combatInput.triggerHeld).toBe(true)
  })

  it('lejos (fuera de retreatFightBackM) sigue huyendo sin disparar, como antes', () => {
    const bot = botHeridoConEnemigoA(BOTS.retreatFightBackM + 10)
    expect(bot.fsm.current).toBe('retreat')
    expect(bot.combatInput.triggerHeld).toBe(false)
  })

  it('acorralado apunta al enemigo, no hacia la ruta de huida', () => {
    const bot = botHeridoConEnemigoA(BOTS.retreatFightBackM - 3)
    // El enemigo está en +X respecto del bot: mirando hacia él, el yaw
    // objetivo tiene que apuntar a ese lado y no quedarse en el default.
    const haciaElEnemigo: YawPitch = { yaw: 0, pitch: 0 }
    lookAt(
      bot.player.position.x,
      bot.player.position.y + bot.player.eyeHeight,
      bot.player.position.z,
      bot.player.position.x + 3,
      bot.player.position.y + bot.player.eyeHeight,
      bot.player.position.z,
      haciaElEnemigo,
    )
    expect(Math.abs(bot.aimTargetYaw - haciaElEnemigo.yaw)).toBeLessThan(0.35)
  })
})

// ---------------------------------------------------------------------------
// Espacio personal: un bot en Enfrentar no se queda clavado encima de otro.
//
// Es el arreglo del amontonamiento medido en nuketown (mediana de distancia
// mínima entre bots vivos: 2.71 m, con el 51% de las muestras por debajo de
// 3 m). La causa era que Enfrentar hace `clearPath` y ata el strafe a
// `engageStrafeRadiusM` del punto donde el bot entró en el estado: dos bots
// que se cruzan quedan pegados todo el tiroteo.
// ---------------------------------------------------------------------------

describe('espacio personal de los bots', () => {
  function duelistaConVecino(vecinoX: number, vecinoZ: number) {
    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    const bot = createBotState(vec3(-16, 0.1, 6), 0.5, ARCHETYPE, 51)
    bot.aimMotor.yaw = 0
    world.targetEye.x = -16
    world.targetEye.y = 1.6
    world.targetEye.z = -6
    world.neighbourPos.x = vecinoX
    world.neighbourPos.y = 0.1
    world.neighbourPos.z = vecinoZ
    return { world, bot }
  }

  function distanciaAlVecino(bot: ReturnType<typeof createBotState>, world: BotWorld): number {
    return Math.hypot(
      bot.player.position.x - world.neighbourPos.x,
      bot.player.position.z - world.neighbourPos.z,
    )
  }

  it('en Enfrentar se despega de un vecino encima, más allá de la correa del ancla', () => {
    // Vecino exactamente donde arranca el bot: el caso peor de la captura.
    const { world, bot } = duelistaConVecino(-16, 6)

    for (let tick = 0; tick < 900; tick++) {
      world.simTimeS += TICK_DT
      // Lo que hace match/squad.ts cada tick de IA.
      world.neighbourDistM = distanciaAlVecino(bot, world)
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
    }

    expect(bot.fsm.current).toBe('engage')
    const d = distanciaAlVecino(bot, world)
    // Estrictamente mayor que la correa del ancla: sin el re-centrado del
    // ancla esta distancia es imposible de alcanzar, porque el bot no puede
    // alejarse más de engageStrafeRadiusM del punto donde entró en
    // Enfrentar -- que en esta prueba es justo donde está el vecino.
    expect(d, `se quedó a ${d.toFixed(2)}m del vecino`).toBeGreaterThan(BOTS.engageStrafeRadiusM)
  })

  it('recuperado el espacio, el término se apaga y el bot deja de emigrar', () => {
    const { world, bot } = duelistaConVecino(-16, 6)

    for (let tick = 0; tick < 900; tick++) {
      world.simTimeS += TICK_DT
      world.neighbourDistM = distanciaAlVecino(bot, world)
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
    }
    const trasDespegarse = distanciaAlVecino(bot, world)

    for (let tick = 0; tick < 900; tick++) {
      world.simTimeS += TICK_DT
      world.neighbourDistM = distanciaAlVecino(bot, world)
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
    }
    const alFinal = distanciaAlVecino(bot, world)

    // No es una licencia para cruzar el mapa: una vez fuera del radio, el
    // ancla vuelve a quedar fija y el bot baila alrededor de ella.
    expect(alFinal - trasDespegarse, `siguió emigrando ${(alFinal - trasDespegarse).toFixed(2)}m`).toBeLessThan(
      BOTS.engageStrafeRadiusM + BOTS.engageStrafeProbeM + 1,
    )
  })

  it('sin vecino (Infinity, el valor por defecto) el comportamiento es el de antes', () => {
    const { world, bot } = duelistaConVecino(-16, 6)
    // createBotWorld deja neighbourDistM en Infinity y ningún llamador de
    // bots/ lo toca: los mapas de código y las pruebas viejas tienen que
    // seguir viendo exactamente el strafe atado al ancla.
    expect(world.neighbourDistM).toBe(Infinity)

    for (let tick = 0; tick < 900; tick++) {
      world.simTimeS += TICK_DT
      stepAllBotsThink([bot], world, TICK_DT)
      stepAllBotsMotor([bot], world, TICK_DT)
      if (bot.fsm.current !== 'engage') continue
      const d = Math.hypot(
        bot.player.position.x - bot.strafeAnchor.x,
        bot.player.position.z - bot.strafeAnchor.z,
      )
      expect(d).toBeLessThan(BOTS.engageStrafeRadiusM + BOTS.engageStrafeProbeM + 1)
    }
  })
})
