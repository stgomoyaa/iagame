import { describe, expect, it } from 'vitest'
import { WEAPON_REGISTRY, getWeaponVisual } from '@/game/weapons/registry'
import { createRigWeapon, syncRigWeapon } from '@/game/weapons/viewmodel/adapt'

describe('adapt: catálogo -> rig', () => {
  it('copia hipOffset/adsOffset y los escalares sin perder valores', () => {
    const visual = getWeaponVisual('pistol-1')
    const rig = createRigWeapon()

    syncRigWeapon(rig, visual)

    expect(rig.hip.px).toBe(visual.hipOffset.x)
    expect(rig.hip.py).toBe(visual.hipOffset.y)
    expect(rig.hip.pz).toBe(visual.hipOffset.z)
    expect(rig.hip.rx).toBe(visual.hipOffset.rx)
    expect(rig.hip.ry).toBe(visual.hipOffset.ry)
    expect(rig.hip.rz).toBe(visual.hipOffset.rz)

    expect(rig.ads.px).toBe(visual.adsOffset.x)
    expect(rig.ads.py).toBe(visual.adsOffset.y)
    expect(rig.ads.pz).toBe(visual.adsOffset.z)

    expect(rig.adsTime).toBe(visual.adsTime)
    expect(rig.drawTime).toBe(visual.drawTime)
    expect(rig.reloadTime).toBe(visual.reloadTime)
    expect(rig.kickMagnitude).toBe(visual.kickMagnitude)
  })

  it('no asigna un objeto nuevo: muta el mismo target en llamadas sucesivas', () => {
    const rig = createRigWeapon()
    const hipRef = rig.hip
    const adsRef = rig.ads

    syncRigWeapon(rig, getWeaponVisual('pistol-1'))
    syncRigWeapon(rig, getWeaponVisual('assaultrifle-1'))

    expect(rig.hip).toBe(hipRef)
    expect(rig.ads).toBe(adsRef)
    expect(rig.hip.px).toBe(getWeaponVisual('assaultrifle-1').hipOffset.x)
  })

  it('sincroniza cada arma del catálogo sin lanzar', () => {
    const rig = createRigWeapon()
    for (const visual of Object.values(WEAPON_REGISTRY)) {
      expect(() => syncRigWeapon(rig, visual)).not.toThrow()
      expect(Number.isFinite(rig.hip.px)).toBe(true)
      expect(Number.isFinite(rig.ads.pz)).toBe(true)
    }
  })
})
