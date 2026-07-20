import { describe, expect, it } from 'vitest'
import {
  createViewmodelState,
  fire,
  reloadFraction,
  startDraw,
  startReload,
  stepViewmodel,
  type ViewmodelInput,
} from '@/game/weapons/viewmodel/rig'
import { createMagTransform, magazinePose } from '@/game/weapons/viewmodel/reload'
import type { VmTransform, WeaponVisual } from '@/game/weapons/viewmodel/types'
import { TICK_DT } from '@/game/engine/constants'

const WEAPON: WeaponVisual = {
  hip: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
  ads: { px: 0.01, py: -0.05, pz: 0.08, rx: 0.02, ry: 0, rz: 0.01 },
  adsTime: 0.25,
  drawTime: 0.25,
  reloadTime: 1.0,
  kickMagnitude: 1.0,
}

const input: ViewmodelInput = {
  speed: 5,
  grounded: true,
  ads: true,
  mouseDeltaX: 0.01,
  mouseDeltaY: 0.01,
  clipDriven: false,
}
const out: VmTransform = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }

describe('presupuesto de asignaciones del viewmodel', () => {
  it('stepViewmodel no hace crecer el heap de forma sostenida', () => {
    // Ver movement/allocations.test.ts para la justificación completa del
    // patrón: sin --expose-gc esto sería un no-op silencioso, así que falla
    // fuerte en vez de degradar en silencio.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const state = createViewmodelState()
    const mag = createMagTransform()

    // Calentar: JIT y asentar el estado inicial, incluyendo un ciclo de
    // disparo/recarga/draw para que las ramas de cada capa se ejerciten.
    for (let i = 0; i < 20_000; i++) {
      input.mouseDeltaX = Math.sin(i * 0.01) * 0.02
      input.ads = i % 200 < 100
      if (i % 500 === 0) fire(state, WEAPON)
      if (i % 3000 === 0) startReload(state, WEAPON)
      if (i % 4000 === 0) startDraw(state, WEAPON)
      stepViewmodel(state, input, WEAPON, out, TICK_DT)
      // magazinePose corre una vez por frame en game.ts, al lado de
      // stepViewmodel, así que entra al mismo presupuesto. Se ejercita acá
      // dentro del mismo bucle y no en un test aparte para que una fuga en
      // cualquiera de los dos la detecte el mismo guard.
      magazinePose(reloadFraction(state), mag)
    }

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    // Derivación (mismo estilo que movement/tuning.ts): el guard tiene que
    // detectar una fuga tan chica como UN number retenido por tick (~8 bytes
    // en V8). Para superar el umbral de 0.5MB con un margen holgado (3x o
    // más): ticks >= 3 * umbral_bytes / 8 = 3 * 0.5 * 1_048_576 / 8 =
    // 196_608. 200_000 redondea hacia arriba y deja ~3.05x de margen (1.53MB
    // de fuga esperada contra el umbral).
    //
    // Este guard corría 1_800_000 ticks contra un umbral de 4.5MB: misma
    // relación 3x, nueve veces más caro (ver movement/allocations.test.ts
    // para la medición que muestra que el umbral era el exagerado).
    for (let i = 0; i < 200_000; i++) {
      input.mouseDeltaX = Math.sin(i * 0.01) * 0.02
      input.ads = i % 200 < 100
      if (i % 500 === 0) fire(state, WEAPON)
      if (i % 3000 === 0) startReload(state, WEAPON)
      if (i % 4000 === 0) startDraw(state, WEAPON)
      stepViewmodel(state, input, WEAPON, out, TICK_DT)
      // magazinePose corre una vez por frame en game.ts, al lado de
      // stepViewmodel, así que entra al mismo presupuesto. Se ejercita acá
      // dentro del mismo bucle y no en un test aparte para que una fuga en
      // cualquiera de los dos la detecte el mismo guard.
      magazinePose(reloadFraction(state), mag)
    }

    // gc() también DESPUÉS del tramo medido, igual que
    // movement/allocations.test.ts (ver ahí el porqué completo): sin él, la
    // lectura de este guard a 200k ticks de código limpio variaba entre
    // 0.686 y 1.192MB según dónde cayera el ciclo del GC -- ruido, no
    // señal. Con gc() de los dos lados mide -0.004 a -0.001MB.
    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Mismo umbral que movement/allocations.test.ts, calibrado con la misma
    // metodología (--expose-gc, Node v26.3.1): el ruido de heap del runtime
    // queda muy por debajo de una fuga real de un number por tick. Fuga
    // inyectada en stepViewmodel() (weapons/viewmodel/rig.ts) para
    // verificar que este guard PUEDE fallar: 1.80MB, 3.6x el umbral.
    expect(crecimientoMB).toBeLessThan(0.5)
  })
})
