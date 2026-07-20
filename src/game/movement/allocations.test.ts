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

    // gc() ANTES y DESPUÉS del tramo medido: es lo que hace que este guard
    // mida una fuga y no el humor del recolector.
    //
    // Antes se llamaba gc() sólo antes, con este argumento: si hubiera un
    // objeto transitorio por tick (creado y descartado, nunca acumulado),
    // barrer justo antes de medir lo eliminaría del heap y el guard nunca
    // podría verlo. El argumento suena bien pero no se sostiene contra la
    // medición: la lectura SIN gc() final no depende de cuántos ticks
    // corriste, depende de en qué punto de su ciclo quedó el GC de V8.
    // Medido a 200_000 ticks de código limpio (6 corridas, Node v26.3.1,
    // --expose-gc) daba 7.65-7.71MB -- por encima incluso del umbral de
    // 4.5MB que este guard tenía. O sea: el guard viejo pasaba a 1.8M ticks
    // por dónde caía el ciclo del GC, no por margen. Con gc() de los dos
    // lados, el mismo tramo mide -0.002 a 0.003MB (mismas 6 corridas): tres
    // órdenes de magnitud menos ruido.
    //
    // Lo que se pierde es la detección de basura transitoria por tick; lo
    // que se gana es un guard que puede fallar por la razón correcta. Con
    // 7.7MB de ruido, esa detección era teórica: nada por debajo de ~8MB de
    // basura por tramo se distinguía del fondo.
    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    // Derivación (mismo estilo que movement/tuning.ts): el guard tiene que
    // detectar una fuga tan chica como UN number retenido por tick (~8 bytes
    // en V8 -- un `push` a un array a nivel de módulo, el tipo de fuga MÁS
    // fácil de introducir sin querer). Para que esa fuga supere el umbral
    // con un margen holgado (3x o más, no un empate a filo de cuchillo con
    // el ruido): ticks >= 3 * umbral_bytes / 8 = 3 * 0.5 * 1_048_576 / 8 =
    // 196_608. 200_000 redondea hacia arriba y deja ~3.05x de margen
    // (200_000 * 8B = 1.53MB de fuga esperada contra un umbral de 0.5MB).
    //
    // Este guard corrió 1_800_000 ticks: la misma relación 3x, pero contra
    // un umbral de 4.5MB. El umbral era el problema, no las iteraciones --
    // 4.5MB estaba calibrado contra el ruido SIN gc() final. Bajando el
    // umbral a 0.5MB (el mismo que usa engine/profiler.test.ts) se consigue
    // el mismo margen de detección con 9 veces menos iteraciones.
    for (let i = 0; i < 200_000; i++) {
      input.yaw += 0.01
      stepPlayer(s, input, ARENA.boxes, TICK_DT)
    }

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Ruido medido con esta metodología (200k ticks, gc() de los dos lados,
    // 6 corridas, Node v26.3.1): -0.002 a 0.003MB. 0.5MB deja >150x de
    // margen sobre el techo de ruido. Fuga inyectada para verificar que
    // este guard PUEDE fallar (un array a nivel de módulo que hace push de
    // un number por tick en stepPlayer(), movement/step.ts): 1.80MB, 3.6x
    // por encima del umbral -- por encima de los 1.53MB teóricos porque el
    // array crece duplicando capacidad, no justo a medida.
    expect(crecimientoMB).toBeLessThan(0.5)
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

    for (let i = 0; i < 200_000; i++) {
      input.yaw += 0.01
      stepPlayer(s, input, ARENA.boxes, TICK_DT, convexes)
    }

    global.gc?.()
    const crecimientoMB = (process.memoryUsage().heapUsed - antes) / 1024 / 1024
    // Mismo umbral y misma metodología que el caso de sólo cajas de arriba
    // (200k ticks, gc() de los dos lados): el punto es detectar bytes POR
    // TICK acumulándose, no medir un número absoluto. Ruido medido en 6
    // corridas: -0.661MB constante -- el heap TERMINA más chico que como
    // arrancó, porque el mundo sintético de 1500 convexos deja basura de
    // construcción que el gc() del final barre. Un ruido negativo no puede
    // hacer saltar un `toBeLessThan`, así que no compite con el umbral.
    // Con la fuga inyectada en stepPlayer() este guard midió 1.80MB.
    expect(crecimientoMB).toBeLessThan(0.5)
  })
})
