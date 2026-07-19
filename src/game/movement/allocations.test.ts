import { describe, expect, it } from 'vitest'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput } from '@/game/movement/state'
import { ARENA } from '@/game/map/arena'
import { TICK_DT } from '@/game/engine/constants'
import { vec3 } from '@/game/math/vec3'

const input: PlayerInput = {
  forward: 1, right: 1, yaw: 0.4, jump: true, sprint: true, crouch: false,
}

describe('presupuesto de asignaciones', () => {
  it('stepPlayer no hace crecer el heap de forma sostenida', () => {
    const s = createPlayerState(vec3(0, 1, 0))

    // Calentar: dejar que el JIT optimice y que se asiente el estado inicial.
    for (let i = 0; i < 20_000; i++) {
      input.yaw += 0.01
      stepPlayer(s, input, ARENA.boxes, TICK_DT)
    }

    // gc() sólo antes de la lectura inicial: establece una base limpia.
    // A propósito NO se llama gc() antes de "después": si hubiera un
    // objeto transitorio por tick (creado y descartado, nunca acumulado),
    // barrer justo antes de medir lo eliminaría del heap y el guard nunca
    // podría verlo. Sin ese segundo gc(), la basura de los 100k ticks
    // medidos sigue en el heap al momento de leer "después".
    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 100_000; i++) {
      input.yaw += 0.01
      stepPlayer(s, input, ARENA.boxes, TICK_DT)
    }

    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Umbral calibrado empíricamente (35 corridas con --expose-gc, Node
    // v26.3.1): sin el gc() final, el propio ruido de heap del runtime
    // (JIT, GC generacional) por 100k ticks de código ya limpio se observó
    // en 6.20-6.75MB (20 corridas). Un objeto {x,y,z} recreado y descartado
    // cada tick, sin acumularse, se observó en 7.41-7.96MB (15 corridas),
    // separado sin solape del ruido. 7MB queda a medio camino de ese hueco:
    // ~0.25MB de margen sobre el techo de ruido observado y ~0.4MB por
    // debajo del piso de la fuga inyectada.
    expect(crecimientoMB).toBeLessThan(7)
  })
})
