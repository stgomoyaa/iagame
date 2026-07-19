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
    // Sin --expose-gc, global.gc es undefined y el `?.()` de abajo se
    // convierte en un no-op silencioso: el test "pasaría" sin haber medido
    // nada, en cualquier corrida que no sea `pnpm test`. Falla fuerte acá
    // en vez de degradar en silencio.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

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
    // podría verlo. Sin ese segundo gc(), la basura de los ticks medidos
    // sigue en el heap al momento de leer "después".
    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    // 300k en vez de 100k: la señal de una fuga real (bytes por tick que se
    // acumulan) escala 3x con el conteo de ticks, pero el ruido de heap del
    // runtime (JIT, GC generacional) no escala igual de rápido. A más
    // ticks, más separación entre "ruido" y "fuga real", y el umbral deja
    // de ser un filo de cuchillo dependiente de la máquina.
    for (let i = 0; i < 300_000; i++) {
      input.yaw += 0.01
      stepPlayer(s, input, ARENA.boxes, TICK_DT)
    }

    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Umbral calibrado empíricamente a 300k ticks (10 corridas con
    // --expose-gc, Node v26.3.1): sin el gc() final, el ruido de heap del
    // runtime por 300k ticks de código limpio se observó en 2.58-2.69MB (10
    // corridas). Un objeto {x,y,z} recreado y descartado cada tick, sin
    // acumularse (fuga inyectada a propósito para calibrar, la misma
    // metodología que dejó el umbral original de 7MB a 100k ticks), se
    // observó en 6.15-6.33MB (10 corridas), separado sin solape del ruido.
    // 4.5MB queda a medio camino de ese hueco: ~1.8MB de margen sobre el
    // techo de ruido observado y ~1.65MB por debajo del piso de la fuga
    // inyectada.
    expect(crecimientoMB).toBeLessThan(4.5)
  })
})
