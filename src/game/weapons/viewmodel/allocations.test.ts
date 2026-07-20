import { describe, expect, it } from 'vitest'
import {
  createViewmodelState,
  fire,
  startDraw,
  startReload,
  stepViewmodel,
  type ViewmodelInput,
} from '@/game/weapons/viewmodel/rig'
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
}
const out: VmTransform = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }

describe('presupuesto de asignaciones del viewmodel', () => {
  it('stepViewmodel no hace crecer el heap de forma sostenida', () => {
    // Ver movement/allocations.test.ts para la justificación completa del
    // patrón: sin --expose-gc esto sería un no-op silencioso, así que falla
    // fuerte en vez de degradar en silencio.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const state = createViewmodelState()

    // Calentar: JIT y asentar el estado inicial, incluyendo un ciclo de
    // disparo/recarga/draw para que las ramas de cada capa se ejerciten.
    for (let i = 0; i < 20_000; i++) {
      input.mouseDeltaX = Math.sin(i * 0.01) * 0.02
      input.ads = i % 200 < 100
      if (i % 500 === 0) fire(state, WEAPON)
      if (i % 3000 === 0) startReload(state, WEAPON)
      if (i % 4000 === 0) startDraw(state, WEAPON)
      stepViewmodel(state, input, WEAPON, out, TICK_DT)
    }

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    // Derivación (mismo estilo que movement/tuning.ts): el guard tiene que
    // detectar una fuga tan chica como UN number retenido por tick (~8 bytes
    // en V8), no sólo el objeto {x,y,z} con el que se calibró originalmente
    // el umbral de 4.5MB. Para superarlo con un margen holgado (3x o más):
    // ticks >= 3 * umbral_bytes / 8 = 3 * 4.5 * 1_048_576 / 8 = 1_769_472.
    // A los 300_000 ticks anteriores, una fuga de 8 bytes/tick daba sólo
    // 2.4MB -- por DEBAJO del umbral de 4.5MB, ni lo cruzaba. 1_800_000
    // redondea hacia arriba y deja ~3.05x de margen (13.73MB de fuga
    // esperada contra el umbral). Confirmado a mano: con un array a nivel de
    // módulo que hace push de un number por tick en stepViewmodel()
    // (weapons/viewmodel/rig.ts), este guard con 1_800_000 ticks pasó de
    // verde a rojo -- ver el informe de cierre de la tarea para el
    // crecimiento medido exacto.
    for (let i = 0; i < 1_800_000; i++) {
      input.mouseDeltaX = Math.sin(i * 0.01) * 0.02
      input.ads = i % 200 < 100
      if (i % 500 === 0) fire(state, WEAPON)
      if (i % 3000 === 0) startReload(state, WEAPON)
      if (i % 4000 === 0) startDraw(state, WEAPON)
      stepViewmodel(state, input, WEAPON, out, TICK_DT)
    }

    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Mismo umbral que movement/allocations.test.ts, calibrado con la misma
    // metodología (--expose-gc, Node v26.3.1): el ruido de heap del runtime
    // queda muy por debajo de una fuga real de un objeto por tick.
    expect(crecimientoMB).toBeLessThan(4.5)
  })
})
