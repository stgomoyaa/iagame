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

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 100_000; i++) {
      input.yaw += 0.01
      stepPlayer(s, input, ARENA.boxes, TICK_DT)
    }

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Un solo objeto por tick serían decenas de MB en 100k ticks.
    // 4MB de margen absorbe el ruido del GC sin dejar pasar una fuga real.
    expect(crecimientoMB).toBeLessThan(4)
  })
})
