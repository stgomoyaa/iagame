import { describe, expect, it } from 'vitest'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput } from '@/game/movement/state'
import { ARENA } from '@/game/map/arena'
import { TICK_DT } from '@/game/engine/constants'
import { vec3 } from '@/game/math/vec3'
import type { Convex } from '@/game/map/types'

const input: PlayerInput = {
  forward: 1, right: 1, yaw: 0.4, jump: true, sprint: true, crouch: false,
}

/**
 * Mundo con la MISMA forma que nuketown en lo único que le importa a este
 * test: miles de brushes convexos repartidos por un mapa grande, más una
 * losa enorme de suelo (la que la grilla espacial manda a su lista de
 * "siempre"). No hace falta el mapa real -- los archivos derivan del Steam
 * Workshop y no viven en el repo (docs/WORKSHOP.md), y un guard de
 * asignaciones que se saltea cuando falta un archivo no es un guard.
 */
function mundoConvexoSintetico(n: number): Convex[] {
  const cubo = (
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  ): Convex => ({
    planes: new Float32Array([
      -1, 0, 0, -x0, 1, 0, 0, x1,
      0, -1, 0, -y0, 0, 1, 0, y1,
      0, 0, -1, -z0, 0, 0, 1, z1,
    ]),
    count: 6,
    min: vec3(x0, y0, z0),
    max: vec3(x1, y1, z1),
  })

  const out: Convex[] = [cubo(-100, -1, -100, 100, 0, 100)]
  // Congruencial lineal: determinista, para que el umbral de heap no
  // dependa de qué mundo tocó esta corrida.
  let s = 987654321
  const r = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  for (let i = 0; i < n; i++) {
    const x = -95 + r() * 190
    const z = -95 + r() * 190
    out.push(cubo(x, 0, z, x + 0.4 + r() * 3, 0.3 + r() * 3, z + 0.4 + r() * 3))
  }
  return out
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

    // Derivación (mismo estilo que movement/tuning.ts): el guard tiene que
    // detectar una fuga tan chica como UN number retenido por tick (~8 bytes
    // en V8 -- un `push` a un array a nivel de módulo, el tipo de fuga MÁS
    // fácil de introducir sin querer, y más chica que el objeto {x,y,z} con
    // el que se calibró el umbral de 4.5MB originalmente -- ver el informe
    // de cierre de la tarea "guards de asignaciones"). Para que esa fuga
    // supere el umbral con un margen holgado (3x o más, no un empate a filo
    // de cuchillo con el ruido de GC): ticks >= 3 * umbral_bytes / 8 =
    // 3 * 4.5 * 1_048_576 / 8 = 1_769_472. Antes este guard corría 300_000
    // ticks -- suficiente para el umbral ORIGINAL (calibrado contra fugas de
    // objeto, ~24-64 bytes cada una) pero insuficiente para un number: a
    // 300_000 ticks, una fuga de 8 bytes/tick da sólo 2.4MB, por DEBAJO del
    // umbral de 4.5MB -- ni siquiera lo cruza, el guard no vería nada.
    // 1_800_000 redondea hacia arriba y deja ~3.05x de margen (1_800_000 * 8B
    // = 13.73MB de fuga esperada contra un umbral de 4.5MB). Confirmado a
    // mano: con un array a nivel de módulo que hace push de un number por
    // tick en stepPlayer() (movement/step.ts), este guard con 1_800_000
    // ticks pasó de verde a rojo -- ver el informe de cierre para el
    // crecimiento medido exacto.
    for (let i = 0; i < 1_800_000; i++) {
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

  it('con un mapa importado (miles de brushes convexos) tampoco crece', () => {
    // El camino convexo es OTRO camino: broadphase con grilla espacial
    // (physics/convex-grid.ts) más el array de resultados que se reusa entre
    // ticks. Cualquiera de esas dos piezas escrita a la ligera -- un
    // `.filter()`, un `Set` para deduplicar, un array nuevo por consulta --
    // asigna por tick y no lo ve ningún otro test, porque los tres mapas
    // escritos en código no tienen un solo convexo.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const convexes = mundoConvexoSintetico(1500)
    const s = createPlayerState(vec3(0, 1, 0))

    for (let i = 0; i < 20_000; i++) {
      input.yaw += 0.01
      stepPlayer(s, input, ARENA.boxes, TICK_DT, convexes)
    }

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 300_000; i++) {
      input.yaw += 0.01
      stepPlayer(s, input, ARENA.boxes, TICK_DT, convexes)
    }

    const crecimientoMB = (process.memoryUsage().heapUsed - antes) / 1024 / 1024
    // Mismo umbral y misma metodología que el caso de sólo cajas de arriba:
    // el punto es detectar bytes POR TICK acumulándose, no medir un número
    // absoluto.
    expect(crecimientoMB).toBeLessThan(4.5)
  })
})
