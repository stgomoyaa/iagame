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

    // Este guard es el más caro de la suite: 1.8M ticks x 10 bots con IA
    // real (steering + stepPlayer + resincronización de hitboxes) miden
    // ~15s (Node v26.3.1, ver el informe de cierre de la tarea "guards de
    // asignaciones"), por encima del timeout por defecto de vitest (5s).
    // No es un test colgado -- es el costo real de la escala de iteraciones
    // que hace falta para que este guard detecte una fuga de 8 bytes/tick
    // con margen (ver la derivación más abajo, junto al TICKS).

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

    // Derivación (mismo estilo que movement/tuning.ts): el guard tiene que
    // detectar una fuga tan chica como UN number retenido por TICK (~8 bytes
    // en V8) -- no por bot: `TICKS` es el contador del loop de este test,
    // así que "una fuga de 8 bytes por iteración" se mide contra ÉL, no
    // contra TICKS * squadSize. Es la lectura conservadora: no asume nada
    // sobre CUÁNTOS bots toca el bug (podría ser un bug que sólo corre una
    // vez por tick, fuera del loop por-bot). Para superar el umbral de
    // 4.5MB con un margen holgado (3x o más): TICKS >= 3 * umbral_bytes / 8
    // = 3 * 4.5 * 1_048_576 / 8 = 1_769_472. A los 60_000 ticks anteriores,
    // una fuga de 8 bytes/tick daba sólo 0.46MB -- ni cerca de cruzar el
    // umbral. 1_800_000 redondea hacia arriba y deja ~3.05x de margen
    // (13.73MB de fuga esperada contra el umbral). Confirmado a mano: con
    // un array a nivel de módulo que hace push de un number por tick en
    // stepAllBotsMotor() (bots/bot.ts), este guard con 1_800_000 ticks pasó
    // de verde a rojo -- ver el informe de cierre de la tarea para el
    // crecimiento medido exacto.
    const TICKS = 1_800_000
    for (let i = 0; i < TICKS; i++) stepAllBotsMotor(squad, world, TICK_DT)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    expect(crecimientoMB).toBeLessThan(4.5)
  }, 30_000)

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

    // Misma derivación que combat/allocations.test.ts (mismo umbral de 1MB):
    // iteraciones >= 3 * 1_048_576 / 8 = 393_216 para que una fuga de un
    // number por llamada de dispararTodos() (~8 bytes) supere el umbral con
    // ~3x de margen -- lectura conservadora sobre el CONTADOR del loop de
    // este test, no sobre el total de llamadas a stepBotCombat (10 bots x
    // iteración): igual que en stepAllBotsMotor de arriba, no asume que el
    // bug toca a los 10 bots. 400_000 deja ~3.05x de margen (3.05MB de fuga
    // esperada contra el umbral de 1MB). Confirmado a mano: con un array a
    // nivel de módulo que hace push de un number por llamada en
    // stepBotCombat() (bots/bot.ts), este guard con 400_000 iteraciones pasó
    // de verde a rojo -- ver el informe de cierre de la tarea para el
    // crecimiento medido exacto.
    let shotsTotal = 0
    for (let i = 0; i < 400_000; i++) shotsTotal += dispararTodos()
    expect(shotsTotal).toBeGreaterThan(2000)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    expect(crecimientoMB).toBeLessThan(1)
  })
})
