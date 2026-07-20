import { describe, expect, it } from 'vitest'
import { ARCHETYPES, type ArchetypeId } from '@/game/weapons/archetypes'
import {
  createViewmodelState,
  easeInOutCubic,
  stepViewmodel,
  type ViewmodelInput,
} from '@/game/weapons/viewmodel/rig'
import type { VmTransform, WeaponVisual } from '@/game/weapons/viewmodel/types'
import { adsFov, adsSensitivityMultiplier, adsSpeedMultiplier } from '@/game/combat/ads'

const BASE_FOV = 90

describe('adsFov/adsSensitivityMultiplier/adsSpeedMultiplier: los tres objetivos exactos', () => {
  it('en reposo (easedT=0) da los valores base, sin ningún efecto de ADS', () => {
    const ads = ARCHETYPES['ar-1'].ads
    expect(adsFov(BASE_FOV, ads, 0)).toBe(BASE_FOV)
    expect(adsSensitivityMultiplier(ads, 0)).toBe(1)
    expect(adsSpeedMultiplier(ads, 0)).toBe(1)
  })

  it('a ADS completo (easedT=1) da exactamente fovScale/sensScale/speedScale', () => {
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      const ads = ARCHETYPES[id].ads
      expect(adsFov(BASE_FOV, ads, 1), id).toBeCloseTo(BASE_FOV * ads.fovScale, 12)
      expect(adsSensitivityMultiplier(ads, 1), id).toBeCloseTo(ads.sensScale, 12)
      expect(adsSpeedMultiplier(ads, 1), id).toBeCloseTo(ads.speedScale, 12)
    }
  })

  it('interpola monótonamente entre los dos extremos (sin overshoot) para un arma que reduce FOV/sens/velocidad', () => {
    const ads = ARCHETYPES['ar-1'].ads // fovScale/sensScale/speedScale < 1
    let prevFov = adsFov(BASE_FOV, ads, 0)
    let prevSens = adsSensitivityMultiplier(ads, 0)
    let prevSpeed = adsSpeedMultiplier(ads, 0)
    for (let i = 1; i <= 20; i++) {
      const t = i / 20
      const fov = adsFov(BASE_FOV, ads, t)
      const sens = adsSensitivityMultiplier(ads, t)
      const speed = adsSpeedMultiplier(ads, t)
      expect(fov).toBeLessThanOrEqual(prevFov)
      expect(sens).toBeLessThanOrEqual(prevSens)
      expect(speed).toBeLessThanOrEqual(prevSpeed)
      prevFov = fov
      prevSens = sens
      prevSpeed = speed
    }
  })
})

describe('integración con el ramp real de adsT (weapons/viewmodel/rig.ts)', () => {
  const WEAPON: WeaponVisual = {
    hip: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    ads: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    adsTime: ARCHETYPES['ar-1'].ads.time,
    drawTime: 0.2,
    reloadTime: 1,
    kickMagnitude: 1,
  }

  function input(ads: boolean): ViewmodelInput {
    return { speed: 0, grounded: true, ads, mouseDeltaX: 0, mouseDeltaY: 0 , clipDriven: false}
  }

  it('alcanza exactamente sus tres objetivos al cumplirse adsTime', () => {
    const state = createViewmodelState()
    const out: VmTransform = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }
    const dt = WEAPON.adsTime / 50
    for (let i = 0; i < 50; i++) stepViewmodel(state, input(true), WEAPON, out, dt)

    expect(state.adsT).toBeCloseTo(1, 9)
    const eased = easeInOutCubic(state.adsT)
    const ads = ARCHETYPES['ar-1'].ads
    expect(adsFov(BASE_FOV, ads, eased)).toBeCloseTo(BASE_FOV * ads.fovScale, 6)
    expect(adsSensitivityMultiplier(ads, eased)).toBeCloseTo(ads.sensScale, 6)
    expect(adsSpeedMultiplier(ads, eased)).toBeCloseTo(ads.speedScale, 6)
  })

  it('vuelve exactamente a los valores base al soltar (adsT vuelve a 0)', () => {
    const state = createViewmodelState()
    const out: VmTransform = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }
    const dt = WEAPON.adsTime / 50

    for (let i = 0; i < 50; i++) stepViewmodel(state, input(true), WEAPON, out, dt)
    expect(state.adsT).toBeCloseTo(1, 9)

    for (let i = 0; i < 50; i++) stepViewmodel(state, input(false), WEAPON, out, dt)
    expect(state.adsT).toBe(0)

    const eased = easeInOutCubic(state.adsT)
    const ads = ARCHETYPES['ar-1'].ads
    expect(adsFov(BASE_FOV, ads, eased)).toBe(BASE_FOV)
    expect(adsSensitivityMultiplier(ads, eased)).toBe(1)
    expect(adsSpeedMultiplier(ads, eased)).toBe(1)
  })
})
