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
import { VIEWMODEL } from '@/game/weapons/viewmodel/tuning'

function transform(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0): VmTransform {
  return { px, py, pz, rx, ry, rz }
}

// adsTime y reloadTime elegidos como múltiplos exactos de TICK_DT (1/128, una
// fracción binaria) para que la acumulación de fp sea exacta y los tests
// puedan comparar con toBe en vez de tolerancias.
const WEAPON: WeaponVisual = {
  hip: transform(0, 0, 0, 0, 0, 0),
  ads: transform(0.01, -0.05, 0.08, 0.02, 0, 0.01),
  adsTime: 0.25, // 32 ticks
  drawTime: 0.25, // 32 ticks
  reloadTime: 1.0, // 128 ticks
  kickMagnitude: 1.0,
}

const QUIETO: ViewmodelInput = {
  speed: 0,
  grounded: true,
  ads: false,
  mouseDeltaX: 0,
  mouseDeltaY: 0,
}

describe('determinismo de composición', () => {
  it('la misma secuencia de entradas produce la misma transformación, bit a bit', () => {
    const secuencia: ViewmodelInput[] = [
      { speed: 3, grounded: true, ads: false, mouseDeltaX: 0.01, mouseDeltaY: -0.02 },
      { speed: 6, grounded: true, ads: true, mouseDeltaX: 0.02, mouseDeltaY: 0 },
      { speed: 8, grounded: false, ads: true, mouseDeltaX: -0.01, mouseDeltaY: 0.03 },
      { speed: 2, grounded: true, ads: false, mouseDeltaX: 0, mouseDeltaY: 0 },
    ]

    function correr(): VmTransform {
      const state = createViewmodelState()
      const out = transform()
      fire(state, WEAPON)
      for (let i = 0; i < 40; i++) {
        const input = secuencia[i % secuencia.length]
        if (i === 10) startReload(state, WEAPON)
        if (i === 25) startDraw(state, WEAPON)
        if (i === 15) fire(state, WEAPON)
        stepViewmodel(state, input, WEAPON, out, TICK_DT)
      }
      return { ...out }
    }

    const a = correr()
    const b = correr()

    expect(a.px).toBe(b.px)
    expect(a.py).toBe(b.py)
    expect(a.pz).toBe(b.pz)
    expect(a.rx).toBe(b.rx)
    expect(a.ry).toBe(b.ry)
    expect(a.rz).toBe(b.rz)
  })

  it('respeta el orden de composición especificado: base, bob, sway, kick, reload, draw', () => {
    // Finding 3: verifica que las capas se componen en el orden del spec.
    // Captura un escenario con varias capas activas y registra los valores
    // numéricos resultantes. Estos valores *codifican* el orden especificado
    // (base, bob, sway, kick, reload, draw). Cualquier reordenamiento produce
    // valores diferentes (con probabilidad abrumadora, dado que la suma de
    // capas con dinámica compleja es extremadamente sensible al orden).
    //
    // Escenario: bob activo (velocidad en suelo), sway activa (mouse input),
    // kick activo (acaba de disparar), reload en progreso, ads=false (amplitud
    // plena de bob). Sin draw.

    const state = createViewmodelState()
    const out = transform()

    fire(state, WEAPON)
    for (let i = 0; i < 8; i++) {
      const input: ViewmodelInput = {
        speed: i < 4 ? 5 : 0,      // bob: velocidad primeros 4 ticks
        grounded: true,
        ads: false,                // amplitud plena de bob
        mouseDeltaX: 0.02,         // sway constante
        mouseDeltaY: -0.01,
      }
      if (i === 2) startReload(state, WEAPON) // reload: tick 2-7
      stepViewmodel(state, input, WEAPON, out, TICK_DT)
    }

    // Valores capturados de la implementación actual. El escenario mezcla
    // base (ads=false, no contribution), bob (speed), sway (mouse), kick (fire),
    // reload (frac 0.16->1.28), draw (off).
    // Si se reordena cualquier capa, estos números cambiarán.
    // Recapturados tras el fix de sway (dt-normalización + swayScale
    // reescalado, ver tuning.ts): sólo cambia la contribución del canal de
    // sway, el orden de composición de las capas sigue siendo el mismo.
    //
    // Recapturados de nuevo al agregar la coreografía de recarga
    // (viewmodel/reload.ts), que suma tres ejes a la capa (px hacia el centro,
    // ry de yaw, rz de roll) y recalibra la caída. Sólo pz quedó idéntico, que
    // es lo esperable: es el único canal que la recarga no toca en esta
    // fracción (la manija de carga entra recién en 0,72).
    //
    // En este escenario la recarga va por frac ~0,047: dentro de la fase A, o
    // sea antes de las ventanas de yank (0,25), slap (0,55) y manija (0,72),
    // que valen exactamente 0 acá. Este test NO cubre esos tres golpes ni el
    // cargador: de eso se encarga reload.test.ts.
    const expectedPx = -0.0034342860912572994
    const expectedPy = -0.0007671908118108085
    const expectedPz = 0.0029860033280968675
    const expectedRx = 0.008968119608128652
    const expectedRy = 0.00791015625
    const expectedRz = 0.02464506015481535

    expect(out.px).toBe(expectedPx)
    expect(out.py).toBe(expectedPy)
    expect(out.pz).toBe(expectedPz)
    expect(out.rx).toBe(expectedRx)
    expect(out.ry).toBe(expectedRy)
    expect(out.rz).toBe(expectedRz)
  })
})

describe('ADS', () => {
  it('adsT alcanza exactamente 1.0 al cumplirse adsTime, y nunca lo pasa', () => {
    const state = createViewmodelState()
    const out = transform()
    const input: ViewmodelInput = { ...QUIETO, ads: true }

    for (let i = 0; i < 32; i++) {
      stepViewmodel(state, input, WEAPON, out, TICK_DT)
      expect(state.adsT).toBeLessThanOrEqual(1)
    }

    expect(state.adsT).toBe(1)
    expect(out.px).toBeCloseTo(WEAPON.ads.px, 12)
    expect(out.py).toBeCloseTo(WEAPON.ads.py, 12)
    expect(out.pz).toBeCloseTo(WEAPON.ads.pz, 12)
    expect(out.rz).toBeCloseTo(WEAPON.ads.rz, 12)

    // Un tick más sosteniendo ADS: no se pasa de 1.
    stepViewmodel(state, input, WEAPON, out, TICK_DT)
    expect(state.adsT).toBe(1)
  })

  it('vuelve exacto a hip al soltar ADS', () => {
    const state = createViewmodelState()
    const out = transform()
    const entrando: ViewmodelInput = { ...QUIETO, ads: true }
    const saliendo: ViewmodelInput = { ...QUIETO, ads: false }

    for (let i = 0; i < 32; i++) stepViewmodel(state, entrando, WEAPON, out, TICK_DT)
    expect(state.adsT).toBe(1)

    for (let i = 0; i < 32; i++) {
      stepViewmodel(state, saliendo, WEAPON, out, TICK_DT)
      expect(state.adsT).toBeGreaterThanOrEqual(0)
    }

    expect(state.adsT).toBe(0)
    expect(out.px).toBe(WEAPON.hip.px)
    expect(out.py).toBe(WEAPON.hip.py)
    expect(out.pz).toBe(WEAPON.hip.pz)
    expect(out.rx).toBe(WEAPON.hip.rx)
    expect(out.ry).toBe(WEAPON.hip.ry)
    expect(out.rz).toBe(WEAPON.hip.rz)
  })
})

describe('timing de eventos de recarga', () => {
  it('magOut y magIn se emiten una sola vez cada uno, en las fracciones especificadas', () => {
    const state = createViewmodelState()
    const out = transform()
    startReload(state, WEAPON)

    let transicionesMagOut = 0
    let transicionesMagIn = 0
    let prevMagOut = false
    let prevMagIn = false
    let tickMagOut = -1
    let tickMagIn = -1

    for (let i = 0; i < 128; i++) {
      stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)
      if (state.emittedMagOut && !prevMagOut) {
        transicionesMagOut++
        tickMagOut = i
      }
      if (state.emittedMagIn && !prevMagIn) {
        transicionesMagIn++
        tickMagIn = i
      }
      prevMagOut = state.emittedMagOut
      prevMagIn = state.emittedMagIn
    }

    expect(transicionesMagOut).toBe(1)
    expect(transicionesMagIn).toBe(1)

    // magOut cruza en 0.25 * 1.0s = tick 32 exacto (0.25 es múltiplo de
    // TICK_DT). magIn cruza en 0.55, que NO es múltiplo de TICK_DT: el
    // cruce cae en el primer tick que iguala o supera la fracción, hasta
    // TICK_DT de margen por encima del valor exacto, nunca por debajo.
    const fraccionMagOut = (tickMagOut + 1) * TICK_DT
    const fraccionMagIn = (tickMagIn + 1) * TICK_DT
    expect(fraccionMagOut).toBeCloseTo(0.25, 6)
    expect(fraccionMagIn).toBeGreaterThanOrEqual(0.55)
    expect(fraccionMagIn).toBeLessThan(0.55 + TICK_DT)

    // Se mantienen emitidos, no se "desemiten" al seguir corriendo.
    for (let i = 0; i < 10; i++) stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)
    expect(state.emittedMagOut).toBe(true)
    expect(state.emittedMagIn).toBe(true)
  })

  it('si un único dt cruza ambas fracciones magOut y magIn, ambos se emiten en ese mismo tick', () => {
    // Finding 1: asegura que los dos checks independientes (if, no else if)
    // funcionen bajo stalls de tab o muy bajo framerate.
    const state = createViewmodelState()
    const out = transform()
    startReload(state, WEAPON)

    // Un dt lo bastante grande para cruzar tanto 0.25 como 0.55 de reloadTime.
    // reloadTime es 1.0, así que dt > 0.55 cruza ambas en un solo paso.
    const bigDt = 0.6

    // Antes del paso: nada emitido.
    expect(state.emittedMagOut).toBe(false)
    expect(state.emittedMagIn).toBe(false)

    // Un solo paso de 0.6s.
    stepViewmodel(state, QUIETO, WEAPON, out, bigDt)

    // Después: ambos eventos se emitieron.
    expect(state.emittedMagOut).toBe(true)
    expect(state.emittedMagIn).toBe(true)
    expect(state.reloadT).toBe(bigDt)

    // Un paso más no vuelve a emitir: los flags se quedan en true.
    stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)
    expect(state.emittedMagOut).toBe(true)
    expect(state.emittedMagIn).toBe(true)
  })

  it('una nueva recarga resetea los flags y los eventos se emiten de nuevo', () => {
    const state = createViewmodelState()
    const out = transform()
    startReload(state, WEAPON)
    for (let i = 0; i < 128; i++) stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)
    expect(state.emittedMagOut).toBe(true)
    expect(state.emittedMagIn).toBe(true)

    startReload(state, WEAPON)
    expect(state.emittedMagOut).toBe(false)
    expect(state.emittedMagIn).toBe(false)

    let transiciones = 0
    let prev = false
    for (let i = 0; i < 128; i++) {
      stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)
      if (state.emittedMagOut && !prev) transiciones++
      prev = state.emittedMagOut
    }
    expect(transiciones).toBe(1)
  })

  it('la pose de descenso de recarga termina exacta en 0, sin overshoot negativo', () => {
    // Finding 2: unclamped easing input puede causar reloadShape negativo
    // si un dt grande salta frac > 1.0 (stall de tab más un reloadTime corto).
    // Esto causaría un overshoot negativo en py: reloadShape < 0, thus out.py < 0.
    //
    // Aísla el reload con entrada neutral: sin bob (speed=0), sin sway
    // (mouseDelta=0), sin ads, sin fire, sin draw.
    const state = createViewmodelState()
    const out = transform()
    const quietoTotal: ViewmodelInput = {
      speed: 0,
      grounded: false, // garantiza groundedBlend = 0, sin bob contribution
      ads: false,
      mouseDeltaX: 0,
      mouseDeltaY: 0,
    }
    const pyBase = WEAPON.hip.py

    startReload(state, WEAPON)

    // Un dt suficientemente grande para saltar por encima de 1.0 en la fase C.
    // reloadTime = 1.0. Fase C empieza en frac = 0.55.
    // Si reloadT salta a 1.1 (frac = 1.1), entonces:
    // c = (1.1 - 0.55) / (1 - 0.55) = 0.55 / 0.45 ≈ 1.222 > 1.
    // Sin clamp: easeInOutCubic(1.222) ≈ 1.014, reloadShape = 1 - 1.014 = -0.014 < 0.
    // Con clamp: c se clampea a 1.0, easeInOutCubic(1.0) = 1, reloadShape = 0.
    const dtOversized = 1.1 // salta directamente a frac = 1.1

    stepViewmodel(state, quietoTotal, WEAPON, out, dtOversized)
    expect(state.reloading).toBe(false) // frac >= 1, se detiene
    expect(state.reloadT).toBe(dtOversized)

    // LA GARANTÍA: reload offset debe estar exactamente en 0 (base), nunca negativo.
    // Sin clamp, out.py < 0 (overshoot negativo). Con clamp, out.py === 0.
    expect(out.py).toBe(pyBase)
  })
})

describe('independencia del framerate', () => {
  it('la misma duración total en pasos de 1/120 y de 1/240 converge al mismo estado, a velocidad física de mouse constante', () => {
    // Hallazgo de QA (Defecto 3): la versión anterior de este test tenía
    // `mouseDeltaX: 0.02` constante POR TICK en ambas corridas. Como la
    // corrida a 240Hz da el doble de ticks que la de 120Hz en la misma
    // duración, recibía el doble de recorrido FÍSICO de mouse total. El
    // defecto de sway atado al framerate (Defecto 1: el target no se
    // normaliza por dt) quedaba enmascarado porque el input desbalanceado
    // compensaba en la dirección contraria.
    //
    // Corregido: se fija una VELOCIDAD física de mouse (píxeles/segundo, no
    // píxeles/tick) y el delta de cada tick se deriva de esa velocidad y el
    // dt de ESE tick (mouseDelta = velocidad * dt). Así el recorrido físico
    // total es idéntico en ambas corridas sin importar cuántos ticks tome.
    // Magnitud realista (cientos de px/s), no las centésimas que usaba el
    // resto de este archivo.
    const dtA = 1 / 120
    const dtB = 1 / 240
    const duracion = 0.5

    const mouseVelX = 800 // px/s: tracking típico, ver SENSITIVITY en game.ts
    const mouseVelY = -500 // px/s

    function correr(dt: number): VmTransform {
      const state = createViewmodelState()
      const out = transform()
      fire(state, WEAPON)
      const input: ViewmodelInput = {
        speed: 5,
        grounded: true,
        ads: true,
        mouseDeltaX: mouseVelX * dt,
        mouseDeltaY: mouseVelY * dt,
      }
      for (let t = 0; t < duracion - 1e-9; t += dt) {
        stepViewmodel(state, input, WEAPON, out, dt)
      }
      return { ...out }
    }

    const outA = correr(dtA)
    const outB = correr(dtB)

    // Medido empíricamente tras el fix (dt-normalización del sway target +
    // swayScale reescalado, ver rig.ts capa 3 y tuning.ts): el error máximo
    // entre 1/120 y 1/240 en este escenario (base+bob+sway+kick a ADS
    // sostenido) quedó en el orden de las milésimas de metro, mismo orden
    // que el error preexistente de kick/bob a esta escala de dt. La
    // tolerancia queda con margen sobre lo medido.
    const tolerancia = 0.01
    expect(Math.abs(outA.px - outB.px)).toBeLessThan(tolerancia)
    expect(Math.abs(outA.py - outB.py)).toBeLessThan(tolerancia)
    expect(Math.abs(outA.pz - outB.pz)).toBeLessThan(tolerancia)
    expect(Math.abs(outA.rx - outB.rx)).toBeLessThan(tolerancia)
    expect(Math.abs(outA.ry - outB.ry)).toBeLessThan(tolerancia)
    expect(Math.abs(outA.rz - outB.rz)).toBeLessThan(tolerancia)
  })
})

describe('sway: velocidad de mouse, no delta acumulado por frame', () => {
  // hip == ads (todo cero): aísla el sway del resto de las capas, mismo
  // patrón que armaBob más abajo.
  const armaSway: WeaponVisual = {
    hip: transform(0, 0, 0, 0, 0, 0),
    ads: transform(0, 0, 0, 0, 0, 0),
    adsTime: 0.25,
    drawTime: 0.25,
    reloadTime: 1.0,
    kickMagnitude: 1.0,
  }

  /** Corre a velocidad física de mouse constante y devuelve el pico de
   *  |out.px| alcanzado. speed=0 y ads=false aíslan el sway de bob/base. */
  function picoSwayPx(mouseVelX: number, dt: number, duracionS: number): number {
    const state = createViewmodelState()
    const out = transform()
    const input: ViewmodelInput = {
      speed: 0,
      grounded: true,
      ads: false,
      mouseDeltaX: mouseVelX * dt,
      mouseDeltaY: 0,
    }
    let pico = 0
    for (let t = 0; t < duracionS - 1e-9; t += dt) {
      stepViewmodel(state, input, armaSway, out, dt)
      pico = Math.max(pico, Math.abs(out.px))
    }
    return pico
  }

  it('Defecto 1: a velocidad física de mouse constante, el sway a 120fps y a 240fps coincide', () => {
    // Magnitud deliberadamente chica (1 y 10 px/s), replicando la medición
    // exacta del QA. No son las "cientos de px/s" realistas a propósito:
    // a magnitud realista, el código VIEJO satura el clamp en swayMax en
    // ambos framerates por igual (Defecto 2), y esa saturación enmascara el
    // Defecto 1 (el ratio da ~1 aunque el sway siga atado al framerate).
    // Aislar el defecto de framerate requiere quedar fuera del rango donde
    // el clamp viejo satura.
    const duracion = 2

    for (const mouseVelX of [1, 10]) {
      const pico120 = picoSwayPx(mouseVelX, 1 / 120, duracion)
      const pico240 = picoSwayPx(mouseVelX, 1 / 240, duracion)
      const ratio = pico120 / pico240

      // Código viejo: ratio ~1.98 (240fps da la mitad de sway que 120fps a
      // la misma velocidad física de mouse). Framerate-independiente: ~1.
      expect(ratio).toBeGreaterThan(0.9)
      expect(ratio).toBeLessThan(1.1)
    }
  })

  it('Defecto 2: a magnitudes reales de mouse (100-2000 px/s) el sway responde proporcional, no pegado al clamp', () => {
    const duracion = 2
    const dt = TICK_DT

    const picoBajo = picoSwayPx(100, dt, duracion)
    const picoMedio = picoSwayPx(800, dt, duracion)
    const picoAlto = picoSwayPx(2000, dt, duracion)

    // Proporcional: más velocidad de mouse, más sway. Con swayScale/swayMax
    // viejos (0.6 / 0.05) los tres saturan al mismo valor exacto de
    // swayMax y esta desigualdad estricta falla.
    expect(picoBajo).toBeGreaterThan(0)
    expect(picoBajo).toBeLessThan(picoMedio)
    expect(picoMedio).toBeLessThan(picoAlto)

    // El valor medio del rango típico no puede estar pegado al clamp: tiene
    // que quedar en el medio de su rango operativo, no ser una señal de
    // tres estados (+max, 0, -max). Ver derivación de swayScale en
    // tuning.ts.
    expect(picoMedio).toBeLessThan(VIEWMODEL.swayMax * 0.95)
    expect(picoMedio).toBeGreaterThan(VIEWMODEL.swayMax * 0.05)
  })

  it('el clamp sigue existiendo, pero sólo para flicks genuinamente extremos por encima del rango típico', () => {
    // El resorte es subamortiguado (persigue un target clampeado duro), así
    // que el pico real puede pasarse un poco del clamp antes de asentarse
    // ahí: no es un clamp de posición, es un clamp del TARGET. Se permite
    // un margen de overshoot chico en vez de una igualdad exacta.
    const picoFlick = picoSwayPx(6000, TICK_DT, 2)
    expect(picoFlick).toBeGreaterThan(VIEWMODEL.swayMax * 0.95)
    expect(picoFlick).toBeLessThan(VIEWMODEL.swayMax * 1.1)
  })
})

describe('bob', () => {
  // hip == ads a propósito: aísla la contribución del bob del resto de las
  // capas (base no aporta nada propio, sway y draw no se activan).
  const armaBob: WeaponVisual = {
    hip: transform(0, 0, 0, 0, 0, 0),
    ads: transform(0, 0, 0, 0, 0, 0),
    adsTime: 0.25,
    drawTime: 0.25,
    reloadTime: 1.0,
    kickMagnitude: 1.0,
  }

  it('la fase del bob no se resetea al detenerse', () => {
    const state = createViewmodelState()
    const out = transform()
    const moviendo: ViewmodelInput = {
      speed: 8,
      grounded: true,
      ads: false,
      mouseDeltaX: 0,
      mouseDeltaY: 0,
    }
    for (let i = 0; i < 20; i++) stepViewmodel(state, moviendo, armaBob, out, TICK_DT)
    const faseAlParar = state.bobPhase
    expect(faseAlParar).toBeGreaterThan(0)

    const quieto: ViewmodelInput = { ...QUIETO }
    for (let i = 0; i < 20; i++) stepViewmodel(state, quieto, armaBob, out, TICK_DT)

    // Con velocidad 0 la fase no avanza (speed * dt * BOB_FREQ = 0), pero
    // tampoco retrocede ni se resetea a 0.
    expect(state.bobPhase).toBe(faseAlParar)

    for (let i = 0; i < 5; i++) stepViewmodel(state, moviendo, armaBob, out, TICK_DT)
    // Al retomar el movimiento, la fase sigue desde donde quedó: nunca bajó
    // a un valor menor que faseAlParar.
    expect(state.bobPhase).toBeGreaterThan(faseAlParar)
  })

  it('el bob se desvanece en el aire, con una constante de tiempo, no de golpe', () => {
    const state = createViewmodelState()
    const out = transform()
    const enSuelo: ViewmodelInput = {
      speed: 8,
      grounded: true,
      ads: false,
      mouseDeltaX: 0,
      mouseDeltaY: 0,
    }
    // Corre en el suelo hasta que el bob esté a amplitud plena.
    for (let i = 0; i < 150; i++) stepViewmodel(state, enSuelo, armaBob, out, TICK_DT)
    expect(state.groundedBlend).toBeGreaterThan(0.99)

    const enAire: ViewmodelInput = { ...enSuelo, grounded: false }

    // Un solo tick en el aire: el bob no se corta en seco, sigue casi a
    // amplitud plena (groundedBlend decae exponencialmente, no a un salto).
    stepViewmodel(state, enAire, armaBob, out, TICK_DT)
    expect(state.groundedBlend).toBeGreaterThan(0.9)

    // Tras suficientes constantes de tiempo en el aire, se desvanece del todo.
    for (let i = 0; i < 200; i++) stepViewmodel(state, enAire, armaBob, out, TICK_DT)
    expect(state.groundedBlend).toBeLessThan(1e-4)
    expect(Math.abs(out.px)).toBeLessThan(1e-4)
    expect(Math.abs(out.py)).toBeLessThan(1e-4)
  })

  it('el bob se desvanece en ADS completo', () => {
    const state = createViewmodelState()
    const out = transform()
    const enAds: ViewmodelInput = {
      speed: 8,
      grounded: true,
      ads: true,
      mouseDeltaX: 0,
      mouseDeltaY: 0,
    }
    for (let i = 0; i < 40; i++) stepViewmodel(state, enAds, armaBob, out, TICK_DT)
    expect(state.adsT).toBe(1)
    expect(Math.abs(out.px)).toBeLessThan(1e-9)
    expect(Math.abs(out.py)).toBeLessThan(1e-9)
  })

  it('el bob es visible caminando en el suelo, sin ADS', () => {
    const state = createViewmodelState()
    const out = transform()
    const moviendo: ViewmodelInput = {
      speed: 8,
      grounded: true,
      ads: false,
      mouseDeltaX: 0,
      mouseDeltaY: 0,
    }
    let maxAbsPx = 0
    for (let i = 0; i < 60; i++) {
      stepViewmodel(state, moviendo, armaBob, out, TICK_DT)
      maxAbsPx = Math.max(maxAbsPx, Math.abs(out.px))
    }
    expect(maxAbsPx).toBeGreaterThan(0.001)
  })
})

describe('spam de recarga (Defecto 1: input sostenido, no de flanco)', () => {
  it('llamar startReload en cada frame mientras ya recarga no reinicia el temporizador: avanza y emite ambos eventos', () => {
    // engine/input.ts modela TODAS las teclas como estado sostenido (p.ej.
    // player.jump = keys.has('Space')), no de flanco. El día que R se cablee
    // igual que el resto, mantenerla apretada llama startReload() en cada
    // frame. Hoy el único llamador es un botón de debug edge-triggered, así
    // que este defecto está latente, no activo; el fix tiene que sostenerse
    // sin importar quién llame.
    const state = createViewmodelState()
    const out = transform()

    // reloadTime = 1.0s = 128 ticks. 100 ticks < 128 a propósito: cruza de
    // sobra ambas fracciones (magOut a 0.25 = tick 32, magIn a 0.55 = tick
    // ~71) sin llegar a completar el ciclo, así que no hay una segunda
    // recarga natural (legítima) de por medio que complique la aserción.
    for (let i = 0; i < 100; i++) {
      startReload(state, WEAPON)
      stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)
    }

    expect(state.emittedMagOut).toBe(true)
    expect(state.emittedMagIn).toBe(true)
    expect(state.reloading).toBe(true)
    // La garantía central: reloadT avanzó de verdad, no quedó congelado en
    // el primer tick (el síntoma exacto del deadlock: reloadT ~= TICK_DT
    // para siempre porque cada frame lo resetea a 0 antes de sumar dt).
    expect(state.reloadT).toBeGreaterThan(50 * TICK_DT)
  })
})

describe('cambio de arma cancela recarga en curso (Defecto 2)', () => {
  it('startDraw cancela una recarga en curso: no completa ni emite sus eventos después', () => {
    const state = createViewmodelState()
    const out = transform()

    startReload(state, WEAPON)
    for (let i = 0; i < 20; i++) stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)

    // Todavía en curso: reloadTime=1.0s=128 ticks, van 20.
    expect(state.reloading).toBe(true)

    startDraw(state, WEAPON)
    expect(state.reloading).toBe(false)
    expect(state.emittedMagOut).toBe(false)
    expect(state.emittedMagIn).toBe(false)

    // Sin la cancelación, reloadT seguiría acumulando y ambos eventos
    // terminarían emitiéndose igual (memoria fantasma del arma anterior).
    for (let i = 0; i < 200; i++) stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)
    expect(state.emittedMagOut).toBe(false)
    expect(state.emittedMagIn).toBe(false)
    expect(state.reloading).toBe(false)
  })
})

describe('robustez ante dt hostil (Defecto 3)', () => {
  it('un único frame con dt=NaN no corrompe el estado permanentemente: se recupera con frames sanos', () => {
    const state = createViewmodelState()
    const out = transform()

    // Estado no trivial antes del frame hostil: ads a mitad de camino,
    // sway con velocidad, kick en curso, recarga arrancada.
    fire(state, WEAPON)
    startReload(state, WEAPON)
    const activo: ViewmodelInput = {
      speed: 5, grounded: true, ads: true, mouseDeltaX: 0.02, mouseDeltaY: -0.01,
    }
    for (let i = 0; i < 5; i++) stepViewmodel(state, activo, WEAPON, out, TICK_DT)

    // Frame hostil: un dt=NaN, como el que produciría un frameDt corrupto
    // llegando sin filtrar hasta stepViewmodel.
    stepViewmodel(state, QUIETO, WEAPON, out, NaN)

    // 200 frames sanos después: todo el estado transitorio y el output
    // tienen que seguir siendo números finitos, no arrastrar el NaN.
    for (let i = 0; i < 200; i++) stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)

    expect(Number.isFinite(out.px)).toBe(true)
    expect(Number.isFinite(out.py)).toBe(true)
    expect(Number.isFinite(out.pz)).toBe(true)
    expect(Number.isFinite(out.rx)).toBe(true)
    expect(Number.isFinite(out.ry)).toBe(true)
    expect(Number.isFinite(out.rz)).toBe(true)
    expect(Number.isFinite(state.adsT)).toBe(true)
    expect(Number.isFinite(state.bobPhase)).toBe(true)
    expect(Number.isFinite(state.swayX)).toBe(true)
    expect(Number.isFinite(state.swayVelX)).toBe(true)
    expect(Number.isFinite(state.swayY)).toBe(true)
    expect(Number.isFinite(state.swayVelY)).toBe(true)
    expect(Number.isFinite(state.kickPz)).toBe(true)
    expect(Number.isFinite(state.kickPy)).toBe(true)
    expect(Number.isFinite(state.kickRz)).toBe(true)
  })
})

describe('disparo', () => {
  it('el roll del culatazo alterna de signo entre disparos', () => {
    const state = createViewmodelState()
    const out = transform()
    const signos: number[] = []

    for (let disparo = 0; disparo < 4; disparo++) {
      const antes = state.kickVelRz
      fire(state, WEAPON)
      signos.push(Math.sign(state.kickVelRz - antes))
      // Dejar decaer del todo entre disparos para que el signo del próximo
      // impulso no quede enmascarado por el resto del anterior.
      for (let i = 0; i < 200; i++) stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)
    }

    expect(signos[0]).not.toBe(0)
    expect(signos[0]).toBe(-signos[1])
    expect(signos[1]).toBe(-signos[2])
    expect(signos[2]).toBe(-signos[3])
  })

  it('disparar aplica un impulso de culatazo que decae con el tiempo', () => {
    const state = createViewmodelState()
    const out = transform()
    fire(state, WEAPON)
    stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)
    const pzInmediato = out.pz

    for (let i = 0; i < 200; i++) stepViewmodel(state, QUIETO, WEAPON, out, TICK_DT)
    expect(Math.abs(out.pz)).toBeLessThan(Math.abs(pzInmediato))
    expect(Math.abs(out.pz)).toBeLessThan(1e-4)
  })
})
