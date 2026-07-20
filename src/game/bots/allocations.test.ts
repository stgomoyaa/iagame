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

/**
 * Presupuesto de reloj para los dos guards de heap de este archivo, explícito
 * en vez del timeout de 5s por defecto de vitest.
 *
 * Por qué existe (medido, no supuesto). Estos guards afirman algo sobre
 * ASIGNACIONES, no sobre velocidad, y ese criterio NO depende de la carga de
 * la máquina: con 12 procesos quemando CPU sobre 10 núcleos, 26 corridas de
 * la suite completa produjeron CERO fallos del umbral de MB y 100% de fallos
 * por "Test timed out in 5000ms". El ruido del heap medido bajo carga se
 * mantuvo en centésimas de MB contra un umbral de 0.5MB.
 *
 * O sea: lo único que la carga rompía era el reloj, y el reloj acá no mide
 * nada que nos importe. El timeout de 5s no era un presupuesto elegido para
 * este test -- era el default, y quedaba a 2.3x del costo real (2145ms), así
 * que cualquier máquina ocupada lo cruzaba. La flakiness era eso, y sólo eso.
 *
 * Derivación del número: el guard más caro mide ~800ms ya reducido (ver el
 * comentario del escuadrón más abajo). 30s tolera ~37x de degradación, muy
 * por encima del ~3x que llegamos a medir con la máquina saturada al doble de
 * sus núcleos. Sigue siendo un techo real: si algún día uno de estos guards
 * tarda 30s, es que alguien multiplicó el costo del motor por 37 y queremos
 * enterarnos, no esperar callados.
 *
 * Lo que este número NO hace: aflojar la detección. El umbral de MB y la
 * cantidad de ticks quedan intactos; una fuga de 8 bytes por tick sigue
 * midiendo ~1.9MB contra el umbral de 0.5MB (verificado inyectando la fuga
 * en stepAllBotsMotor y confirmando que el guard falla).
 */
const PRESUPUESTO_RELOJ_MS = 30_000

describe('presupuesto de asignaciones de bots', () => {
  it('stepAllBotsMotor (apuntado + steering + stepPlayer, el camino de cada tick de simulación) no hace crecer el heap sostenidamente', () => {
    // Ver movement/allocations.test.ts para el patrón base y por qué falla
    // fuerte sin --expose-gc en vez de degradar en silencio.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    // Este guard era el más caro de la suite: 1.8M ticks x 10 bots con IA
    // real medían ~15s. Con el umbral bajado a 0.5MB (ver la derivación
    // junto a TICKS) alcanzan 200_000 ticks para el mismo margen de
    // detección. El presupuesto de reloj es explícito, no el default: ver
    // PRESUPUESTO_RELOJ_MS arriba.

    // El escuadrón es de 4 y no de 10 por TIEMPO, sin tocar la detección.
    // Medido (Node v26.3.1, M1 Pro, 3 repeticiones por celda):
    //
    //   bots=10 200k ticks -> 1684ms  ruido -0.038MB  fuga inyectada 1.928MB
    //   bots=4  200k ticks ->  668ms  ruido -0.017MB  fuga inyectada 1.948MB
    //
    // La fuga inyectada (un number retenido por TICK) se mide IGUAL con 4
    // que con 10 bots -- es exactamente lo que predice la derivación de
    // abajo, que cuenta bytes por iteración del loop de este test y nunca
    // por bot. El tamaño del escuadrón no entra en el cálculo del umbral.
    // De paso el ruido baja y se vuelve estable (-0.017/-0.018 en todas las
    // repeticiones, contra -0.038..+0.012 con 10): menos bots es menos
    // churn de asignaciones, así que la MEDICIÓN del heap queda mejor, no
    // peor.
    //
    // Por qué importaba el tiempo: con 10 bots el test medía 2145ms contra
    // el timeout de 5s por defecto, apenas 2.3x de margen. Con la máquina
    // ocupada (medido: 12 procesos quemando CPU en 10 núcleos) se pasaba de
    // 5s y fallaba por TIEMPO -- nunca por el umbral de MB, que bajo esa
    // misma carga no falló ni una vez en 10 corridas. El criterio de este
    // guard no depende de la carga; su reloj sí. Con 4 bots mide ~800ms.
    //
    // Bajar el costo era necesario pero no suficiente: con 24 procesos de
    // carga sobre 10 núcleos, 4 bots contra el default de 5s todavía fallaba
    // 2 de 6 corridas (siempre por timeout, nunca por MB). Por eso además
    // hay un presupuesto de reloj explícito -- las dos cosas, no una.
    //
    // Ojo: reducir el escuadrón NO recorta caminos de código acá. El
    // término de espacio personal (BOTS.personalSpaceM en bots/bot.ts) se
    // activa con `world.neighbourDistM`, que lo escribe match/squad.ts, no
    // stepAllBotsMotor: en este test queda en Infinity y esas ramas están
    // apagadas con 4 bots y con 10 por igual.
    const grid = buildNavGrid(ARENA, 1, 1.8)
    const world = createBotWorld(ARENA.boxes, raycastMap, grid)
    const squad = createBotSquad(ARENA.spawns, 4, 0.5, ARCHETYPE)

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
    // 0.5MB con un margen holgado (3x o más): TICKS >= 3 * umbral_bytes / 8
    // = 3 * 0.5 * 1_048_576 / 8 = 196_608. 200_000 redondea hacia arriba y
    // deja ~3.05x de margen (1.53MB de fuga esperada contra el umbral).
    //
    // Este guard corría 1_800_000 ticks contra un umbral de 4.5MB: la misma
    // relación 3x, nueve veces más caro. El umbral era el exagerado, no las
    // iteraciones (ver movement/allocations.test.ts para la medición que lo
    // muestra).
    const TICKS = 200_000
    for (let i = 0; i < TICKS; i++) stepAllBotsMotor(squad, world, TICK_DT)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Ruido medido con el escuadrón de 4 (200k ticks, gc() de los dos lados,
    // 3 repeticiones, Node v26.3.1): -0.017 a -0.018MB, siempre negativo y
    // más estable que con 10 bots. Fuga inyectada para verificar que este
    // guard PUEDE fallar (push de un number por tick en stepAllBotsMotor(),
    // bots/bot.ts): 1.89MB, 3.8x por encima del umbral -- el mismo poder de
    // detección que tenía con 10 bots (1.86MB).
    expect(crecimientoMB).toBeLessThan(0.5)
  }, PRESUPUESTO_RELOJ_MS)

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

    // Misma derivación que combat/allocations.test.ts (mismo umbral de
    // 0.5MB): iteraciones >= 3 * 0.5 * 1_048_576 / 8 = 196_608 para que una
    // fuga de un number por llamada de dispararTodos() (~8 bytes) supere el
    // umbral con ~3x de margen -- lectura conservadora sobre el CONTADOR del
    // loop de este test, no sobre el total de llamadas a stepBotCombat (10
    // bots x iteración): igual que en stepAllBotsMotor de arriba, no asume
    // que el bug toca a los 10 bots. 200_000 deja ~3.05x de margen (1.53MB
    // de fuga esperada contra el umbral).
    let shotsTotal = 0
    for (let i = 0; i < 200_000; i++) shotsTotal += dispararTodos()
    expect(shotsTotal).toBeGreaterThan(2000)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Ruido medido (200k iteraciones, 6 corridas, Node v26.3.1): 0.002 a
    // 0.009MB. 0.5MB deja >50x de margen. Fuga inyectada en stepBotCombat()
    // (bots/bot.ts): 22.22MB -- mucho más que los 1.53MB del cálculo porque
    // esa función corre 10 veces por iteración (una por bot). El cálculo de
    // 3x es el piso conservador, no la predicción.
    expect(crecimientoMB).toBeLessThan(0.5)
  }, PRESUPUESTO_RELOJ_MS)
})
