import { describe, expect, it } from 'vitest'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import { vec3 } from '@/game/math/vec3'
import { createShotResult } from '@/game/combat/shot'
import { createCombatState, stepCombat, type CombatInput } from '@/game/combat/combat'
import { fireInterval } from '@/game/combat/fire-control'
import type { Hitbox } from '@/game/combat/hitboxes'

describe('presupuesto de asignaciones del combate', () => {
  it('stepCombat (fire-control + retroceso + dispersión + hitscan) no retiene nada de un disparo al siguiente', () => {
    // Ver movement/allocations.test.ts para el patrón base: sin --expose-gc
    // esto sería un no-op silencioso, así que falla fuerte en vez de
    // degradar en silencio.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const ar1 = ARCHETYPES['ar-1']
    const state = createCombatState(ar1)
    const out = createShotResult()
    const hitboxes: Hitbox[] = [
      { center: vec3(0, 10, -ar1.damage.optimalRange), radius: 5, part: 'torso', owner: 1 },
    ]
    // dt = el intervalo exacto del arma: cada llamada a stepCombat dispara
    // al menos un tiro (el acumulador de fire-control arranca "listo"), así
    // que cada iteración ejercita hitscan real (mapa + hitboxes), no sólo
    // la rama ociosa.
    const input: CombatInput = {
      triggerHeld: true,
      reloading: false,
      origin: vec3(0, 10, 0),
      pitch: 0,
      yaw: 0,
    }
    const dt = fireInterval(ar1)

    // Rellena munición directo (sin pasar por la secuencia de recarga real,
    // que no es lo que este guard mide) apenas se vacía el cargador: el
    // objetivo es sostener miles de disparos reales, no medir cuántos
    // caben en un cargador de 30.
    function dispararUno(): number {
      if (state.fireControl.ammo <= 0) state.fireControl.ammo = ar1.magazine
      return stepCombat(state, ar1, input, hitboxes, dt, out)
    }

    // Calentar: JIT y asentar el estado inicial.
    for (let i = 0; i < 2000; i++) dispararUno()

    // A diferencia de movement/allocations.test.ts y viewmodel/allocations.test.ts
    // (matemática 100% propia, cero asignaciones ni siquiera transitorias),
    // acá adentro corre MeshBVH.raycastFirst() de three-mesh-bvh
    // (combat/hitscan.ts), que sí asigna objetos transitorios de
    // intersección en cada llamada — no expone una API "escribe en un
    // target preasignado" (ver el comentario de raycastAgainstBvh). Esos
    // objetos son de vida CORTA (viven y mueren dentro de una sola llamada
    // a raycastFirst, nunca se retienen): medido sin gc() final —el patrón
    // que usan los otros dos guards— el crecimiento reportado entre
    // checkpoints saltaba entre 0.7MB y 5.3MB de forma no correlacionada con
    // la cantidad de disparos, puro ruido de cuándo cae el próximo GC menor
    // de V8, no una fuga. Un gc() ANTES y DESPUÉS del tramo medido (en vez
    // de sólo después) elimina ese ruido sin perder sensibilidad a una fuga
    // real: un objeto efectivamente RETENIDO sigue vivo pase lo que pase
    // con el GC, así que gc() de los dos lados no puede ocultarlo.
    // Calibrado (Node v26.3.1, --expose-gc, 8 corridas de 8000 disparos
    // reales cada una sobre el mismo estado, gc() antes y después de cada
    // una): 0.0003-0.02MB, sin tendencia creciente. Una fuga inyectada a
    // propósito (un objeto {x,y,z} retenido por disparo, misma escala,
    // 64000 disparos) dio 6.47MB — casi 3 órdenes de magnitud por encima
    // del ruido real. Remedido con la escala actual (200k disparos, 6
    // corridas, Node v26.3.1): -0.017 a 0.017MB, consistente con aquello.
    // 0.5MB deja ~30x de margen sobre el techo de ruido observado.
    // Fuga inyectada en stepCombat() (combat/combat.ts) para verificar que
    // este guard PUEDE fallar: 1.95MB, 3.9x por encima del umbral.
    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    // Derivación (ver movement/tuning.ts para el mismo estilo de comentario):
    // el guard tiene que detectar una fuga tan chica como UN number retenido
    // por disparo (~8 bytes en V8, el tamaño de un `push` a un array a nivel
    // de módulo -- el tipo de fuga más fácil de introducir sin querer, más
    // chica que el objeto {x,y,z} con el que se calibró originalmente este
    // umbral). Para que esa fuga supere el umbral de 0.5MB con un margen
    // holgado (3x o más, no un empate a filo de cuchillo con el ruido):
    // iteraciones >= 3 * umbral_bytes / 8 = 3 * 0.5 * 1_048_576 / 8 =
    // 196_608. 200_000 redondea hacia arriba y deja ~3.05x de margen
    // (200_000 * 8B = 1.53MB de fuga esperada contra un umbral de 0.5MB).
    const ITERACIONES = 200_000
    let shotsDisparados = 0
    for (let i = 0; i < ITERACIONES; i++) shotsDisparados += dispararUno()
    expect(shotsDisparados).toBeGreaterThan(2000)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    expect(crecimientoMB).toBeLessThan(0.5)
  })
})
