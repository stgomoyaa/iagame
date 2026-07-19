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
})

describe('independencia del framerate', () => {
  it('la misma duración total en pasos de 1/120 y de 1/240 converge al mismo estado', () => {
    const dtA = 1 / 120
    const dtB = 1 / 240
    const duracion = 0.5

    const input: ViewmodelInput = {
      speed: 5,
      grounded: true,
      ads: true,
      mouseDeltaX: 0.02,
      mouseDeltaY: -0.015,
    }

    const stateA = createViewmodelState()
    const outA = transform()
    fire(stateA, WEAPON)
    for (let t = 0; t < duracion - 1e-9; t += dtA) {
      stepViewmodel(stateA, input, WEAPON, outA, dtA)
    }

    const stateB = createViewmodelState()
    const outB = transform()
    fire(stateB, WEAPON)
    for (let t = 0; t < duracion - 1e-9; t += dtB) {
      stepViewmodel(stateB, input, WEAPON, outB, dtB)
    }

    // Medido empíricamente: el error máximo entre 1/120 y 1/240 en este
    // escenario (resortes de sway y kick, groundedBlend, adsT) fue de
    // ~4.7e-5. La tolerancia queda con margen de sobra sin ser tan floja
    // que deje pasar una regresión real a Euler por tick fijo.
    const tolerancia = 0.001
    expect(Math.abs(outA.px - outB.px)).toBeLessThan(tolerancia)
    expect(Math.abs(outA.py - outB.py)).toBeLessThan(tolerancia)
    expect(Math.abs(outA.pz - outB.pz)).toBeLessThan(tolerancia)
    expect(Math.abs(outA.rx - outB.rx)).toBeLessThan(tolerancia)
    expect(Math.abs(outA.ry - outB.ry)).toBeLessThan(tolerancia)
    expect(Math.abs(outA.rz - outB.rz)).toBeLessThan(tolerancia)
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
