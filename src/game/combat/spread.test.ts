import { describe, expect, it } from 'vitest'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import {
  createSpreadState,
  growSpread,
  nextRandom,
  resetSpread,
  sampleSpread,
  stepSpreadRecovery,
  type SpreadSample,
} from '@/game/combat/spread'

const CURVE = ARCHETYPES['ar-1'].recoil.spread
const DT = 1 / 128

describe('crecimiento bajo fuego sostenido', () => {
  it('crece monótonamente disparo a disparo, sin superar max', () => {
    const state = createSpreadState(CURVE, 1)
    let anterior = state.radius
    expect(anterior).toBe(CURVE.base)

    for (let i = 0; i < 200; i++) {
      growSpread(state, CURVE)
      expect(state.radius).toBeGreaterThanOrEqual(anterior)
      expect(state.radius).toBeLessThanOrEqual(CURVE.max)
      anterior = state.radius
    }
    // Con 200 disparos y un growthPerShot que ya cubre max varias veces
    // (ver archetypes.ts), tiene que haber tocado el techo.
    expect(state.radius).toBe(CURVE.max)
  })
})

describe('cierre al soltar el gatillo', () => {
  it('decrece monótonamente hacia base tras soltar, sin pasarse por debajo', () => {
    const state = createSpreadState(CURVE, 1)
    for (let i = 0; i < 50; i++) growSpread(state, CURVE)
    expect(state.radius).toBeGreaterThan(CURVE.base)

    let anterior = state.radius
    for (let i = 0; i < 5000; i++) {
      stepSpreadRecovery(state, CURVE, false, DT)
      expect(state.radius).toBeLessThanOrEqual(anterior)
      expect(state.radius).toBeGreaterThanOrEqual(CURVE.base)
      anterior = state.radius
    }
    expect(state.radius).toBe(CURVE.base)
  })

  it('no recupera mientras se sostiene el gatillo', () => {
    const state = createSpreadState(CURVE, 1)
    growSpread(state, CURVE)
    growSpread(state, CURVE)
    const before = state.radius
    for (let i = 0; i < 1000; i++) stepSpreadRecovery(state, CURVE, true, DT)
    expect(state.radius).toBe(before)
  })
})

describe('nextRandom', () => {
  it('determinista: misma seed inicial, misma secuencia', () => {
    const a = { radius: 0, rngState: 777 }
    const b = { radius: 0, rngState: 777 }
    const seqA = [nextRandom(a), nextRandom(a), nextRandom(a)]
    const seqB = [nextRandom(b), nextRandom(b), nextRandom(b)]
    expect(seqA).toEqual(seqB)
  })

  it('da valores en [0, 1)', () => {
    const state = { radius: 0, rngState: 12345 }
    for (let i = 0; i < 1000; i++) {
      const v = nextRandom(state)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('sampleSpread', () => {
  it('la magnitud de la muestra nunca supera el radio actual del cono', () => {
    const state = createSpreadState(CURVE, 99)
    for (let i = 0; i < 20; i++) growSpread(state, CURVE)
    const out: SpreadSample = { dPitch: 0, dYaw: 0 }

    for (let i = 0; i < 500; i++) {
      sampleSpread(state, out)
      const mag = Math.hypot(out.dPitch, out.dYaw)
      expect(mag).toBeLessThanOrEqual(state.radius + 1e-12)
    }
  })

  it('con radio 0 (base 0 hipotético) la muestra siempre es (0,0)', () => {
    const state = { radius: 0, rngState: 5 }
    const out: SpreadSample = { dPitch: 1, dYaw: 1 }
    sampleSpread(state, out)
    // Math.sin/cos(ángulo) * 0 puede dar -0 según el signo del ángulo: -0 y
    // 0 son el mismo valor numérico (Object.is los distingue, toBe() usa
    // Object.is), así que se compara con toBeCloseTo en vez de toBe.
    expect(out.dPitch).toBeCloseTo(0, 12)
    expect(out.dYaw).toBeCloseTo(0, 12)
  })

  it('con extraRadius (dispersión por movimiento) el cono crece hasta radius+extra', () => {
    const state = createSpreadState(CURVE, 99)
    const out: SpreadSample = { dPitch: 0, dYaw: 0 }
    const extra = 0.05 // penalización de movimiento estilo CS

    let maxMag = 0
    for (let i = 0; i < 2000; i++) {
      sampleSpread(state, out, extra)
      const mag = Math.hypot(out.dPitch, out.dYaw)
      // Nunca supera el radio efectivo (base + extra)...
      expect(mag).toBeLessThanOrEqual(state.radius + extra + 1e-12)
      maxMag = Math.max(maxMag, mag)
    }
    // ...y de verdad usa el radio ampliado: con extra tiene que haber muestras
    // por encima del radio base solo (si no, extraRadius no estaría entrando).
    expect(maxMag).toBeGreaterThan(state.radius)
  })
})

describe('resetSpread', () => {
  it('vuelve el radio a base', () => {
    const state = createSpreadState(CURVE, 1)
    growSpread(state, CURVE)
    growSpread(state, CURVE)
    resetSpread(state, CURVE)
    expect(state.radius).toBe(CURVE.base)
  })
})
