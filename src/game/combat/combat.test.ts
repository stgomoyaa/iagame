import { describe, expect, it } from 'vitest'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import { PITCH_LIMIT } from '@/game/engine/input'
import { vec3 } from '@/game/math/vec3'
import { createShotResult } from '@/game/combat/shot'
import {
  cameraPitch,
  cameraYaw,
  createCombatState,
  resetCombatState,
  stepCombat,
  type CombatInput,
} from '@/game/combat/combat'

const DT = 1 / 2000

function baseInput(triggerHeld: boolean): CombatInput {
  return { triggerHeld, reloading: false, origin: vec3(0, 10, 0), pitch: 0, yaw: 0 }
}

describe('stepCombat: orquesta cadencia + retroceso + dispersión + hitscan', () => {
  const ar1 = ARCHETYPES['ar-1']

  it('sostener el gatillo dispara, gasta munición y hace crecer el retroceso y la dispersión', () => {
    const state = createCombatState(ar1)
    const out = createShotResult()
    const input = baseInput(true)

    let totalShots = 0
    for (let i = 0; i < 5000; i++) totalShots += stepCombat(state, ar1, input, [], DT, out)

    expect(totalShots).toBeGreaterThan(0)
    expect(state.fireControl.ammo).toBeLessThan(ar1.magazine)
    expect(state.recoil.pitchOffset).toBeGreaterThan(0)
    expect(state.spread.radius).toBeGreaterThan(ar1.recoil.spread.base)
  })

  it('el retroceso aplicado nunca supera PITCH_LIMIT, ni siquiera con un pitch de jugador ya extremo', () => {
    const state = createCombatState(ar1)
    const out = createShotResult()
    const input = baseInput(true)
    input.pitch = PITCH_LIMIT

    for (let i = 0; i < 5000; i++) {
      stepCombat(state, ar1, input, [], DT, out)
      const pitch = cameraPitch(state, input.pitch)
      expect(pitch).toBeLessThanOrEqual(PITCH_LIMIT)
      expect(pitch).toBeGreaterThanOrEqual(-PITCH_LIMIT)
    }
  })

  it('soltar el gatillo detiene el disparo y arranca la recuperación', () => {
    const state = createCombatState(ar1)
    const out = createShotResult()

    for (let i = 0; i < 2000; i++) stepCombat(state, ar1, baseInput(true), [], DT, out)
    const pitchTrasDisparar = state.recoil.pitchOffset
    expect(pitchTrasDisparar).toBeGreaterThan(0)

    let shotsSoltando = 0
    for (let i = 0; i < 20000; i++) shotsSoltando += stepCombat(state, ar1, baseInput(false), [], DT, out)

    expect(shotsSoltando).toBe(0)
    expect(state.recoil.pitchOffset).toBeLessThan(pitchTrasDisparar)
  })

  it('determinismo: dos estados frescos con la misma secuencia de input dan el mismo retroceso', () => {
    const run = (): number => {
      const state = createCombatState(ar1)
      const out = createShotResult()
      for (let i = 0; i < 3000; i++) stepCombat(state, ar1, baseInput(i % 3 !== 0), [], DT, out)
      return state.recoil.pitchOffset
    }
    expect(run()).toBe(run())
  })

  it('resuelve daño real cuando hay una hitbox en el camino', () => {
    const state = createCombatState(ar1)
    const out = createShotResult()
    const hitboxes = [
      { center: vec3(0, 10, -ar1.damage.optimalRange), radius: 5, part: 'torso' as const, owner: 1 },
    ]
    const input = baseInput(true)

    let hitAlguno = false
    for (let i = 0; i < 3000 && !hitAlguno; i++) {
      stepCombat(state, ar1, input, hitboxes, DT, out)
      if (out.hit && out.part !== 'none') hitAlguno = true
    }
    expect(hitAlguno).toBe(true)
    expect(out.damage).toBeGreaterThan(0)
  })

  it('bloquea el disparo mientras reloading es true', () => {
    const state = createCombatState(ar1)
    const out = createShotResult()
    const input = baseInput(true)
    input.reloading = true

    let shots = 0
    for (let i = 0; i < 2000; i++) shots += stepCombat(state, ar1, input, [], DT, out)
    expect(shots).toBe(0)
  })

  it('un reload completo rellena la munición y reinicia el índice del patrón de retroceso', () => {
    const state = createCombatState(ar1)
    const out = createShotResult()

    for (let i = 0; i < 2000; i++) stepCombat(state, ar1, baseInput(true), [], DT, out)
    expect(state.fireControl.ammo).toBeLessThan(ar1.magazine)
    expect(state.recoil.shotIndex).toBeGreaterThan(0)

    const reloadingInput = baseInput(false)
    reloadingInput.reloading = true
    stepCombat(state, ar1, reloadingInput, [], DT, out) // arranca

    const doneInput = baseInput(false)
    doneInput.reloading = false
    stepCombat(state, ar1, doneInput, [], DT, out) // termina (flanco true -> false)

    expect(state.fireControl.ammo).toBe(ar1.magazine)
    expect(state.recoil.shotIndex).toBe(0)
  })
})

describe('cameraPitch/cameraYaw', () => {
  it('en reposo (sin disparar) devuelven el pitch/yaw del jugador sin cambios', () => {
    const ar1 = ARCHETYPES['ar-1']
    const state = createCombatState(ar1)
    expect(cameraPitch(state, 0.3)).toBeCloseTo(0.3, 12)
    expect(cameraYaw(state, -0.7)).toBeCloseTo(-0.7, 12)
  })
})

describe('resetCombatState', () => {
  it('reinicia munición, retroceso y dispersión al equipar un arma', () => {
    const ar1 = ARCHETYPES['ar-1']
    const state = createCombatState(ar1)
    const out = createShotResult()
    for (let i = 0; i < 2000; i++) stepCombat(state, ar1, baseInput(true), [], DT, out)

    resetCombatState(state, ar1)
    expect(state.fireControl.ammo).toBe(ar1.magazine)
    expect(state.recoil.pitchOffset).toBe(0)
    expect(state.recoil.shotIndex).toBe(0)
    expect(state.spread.radius).toBe(ar1.recoil.spread.base)
  })
})
