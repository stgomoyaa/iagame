/**
 * Adapta el `WeaponVisual` de catálogo (`registry.ts`, con `hipOffset` /
 * `adsOffset` en forma {x,y,z,rx,ry,rz} y `rotationOffset` aparte) al
 * `WeaponVisual` que consume el rig (`viewmodel/types.ts`, con `hip`/`ads`
 * en forma `VmTransform` {px,py,pz,rx,ry,rz}).
 *
 * Existen dos formas porque cumplen roles distintos: la de catálogo es la
 * que edita el panel de tuning (sección 6.4 del spec) y la que se
 * serializa a weapons_tuning.json; la del rig es la que stepViewmodel()
 * necesita para componer capas, sin saber nada de slugs ni de catálogos
 * (rig.ts es matemática pura, ver sección 6.1).
 *
 * `rotationOffset` no entra acá: es la corrección estática de orientación
 * del modelo crudo (ver el comentario de registry.ts), previa a cualquier
 * pose de hip/ads, y se aplica sobre el nodo del modelo en
 * viewmodel/renderer.ts, no sobre el pivote animado que anima el rig.
 */

import type { WeaponVisual as CatalogWeaponVisual } from '@/game/weapons/registry'
import type { WeaponVisual as RigWeaponVisual } from '@/game/weapons/viewmodel/types'

/** Arma en blanco para el rig, preasignada una vez al arrancar el juego. */
export function createRigWeapon(): RigWeaponVisual {
  return {
    hip: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    ads: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    adsTime: 0.2,
    drawTime: 0.2,
    reloadTime: 1,
    kickMagnitude: 1,
  }
}

/**
 * Muta `target` con los valores actuales de `source`. No crea objetos: se
 * llama una vez por frame desde game.ts para que los sliders del panel
 * (que mutan `WEAPON_REGISTRY` directamente) se reflejen de inmediato en el
 * rig sin romper el presupuesto de cero asignaciones del loop.
 */
export function syncRigWeapon(target: RigWeaponVisual, source: CatalogWeaponVisual): void {
  target.hip.px = source.hipOffset.x
  target.hip.py = source.hipOffset.y
  target.hip.pz = source.hipOffset.z
  target.hip.rx = source.hipOffset.rx
  target.hip.ry = source.hipOffset.ry
  target.hip.rz = source.hipOffset.rz

  target.ads.px = source.adsOffset.x
  target.ads.py = source.adsOffset.y
  target.ads.pz = source.adsOffset.z
  target.ads.rx = source.adsOffset.rx
  target.ads.ry = source.adsOffset.ry
  target.ads.rz = source.adsOffset.rz

  target.adsTime = source.adsTime
  target.drawTime = source.drawTime
  target.reloadTime = source.reloadTime
  target.kickMagnitude = source.kickMagnitude
}
