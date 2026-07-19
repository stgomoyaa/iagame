/**
 * Malla visual de las dianas (sección 6 del spec de fase 1): dos esferas
 * por diana (torso + cabeza), coloreadas según si está viva y si acaba de
 * recibir un impacto. Uno de los cuatro archivos de src/game autorizados a
 * importar three (ver architecture.test.ts), junto con engine/renderer.ts,
 * map/mesh.ts y weapons/viewmodel/renderer.ts -- mismo motivo que ese
 * último: la lógica de las dianas (targets/targets.ts) es matemática pura,
 * y éste es el único punto de contacto con la escena real.
 *
 * Geometría y materiales se crean una sola vez en createTargetsRenderer();
 * sync() (llamada una vez por frame desde game.ts) sólo muta posiciones y
 * colores de objetos ya existentes -- cero asignaciones en el camino de
 * frame, mismo criterio que el resto del motor.
 */

import { Color, Group, Mesh, MeshBasicMaterial, type Scene, SphereGeometry } from 'three'
import { targetHitFlash, type TargetsState } from '@/game/targets/targets'
import { TARGETS } from '@/game/targets/tuning'

const TORSO_COLOR = new Color(0x4a7fb0)
const HEAD_COLOR = new Color(0x35597a)
const FLASH_COLOR = new Color(0xff3b3b)

export interface TargetsRenderer {
  /** Sincroniza posición, visibilidad y color de cada malla con el estado
   *  real (targets/targets.ts). Llamar una vez por frame, después de
   *  stepTargets(). */
  sync(state: TargetsState): void
  dispose(): void
}

export function createTargetsRenderer(scene: Scene, state: TargetsState): TargetsRenderer {
  const group = new Group()
  const torsoGeometry = new SphereGeometry(TARGETS.torsoRadius, 12, 8)
  const headGeometry = new SphereGeometry(TARGETS.headRadius, 10, 8)

  const torsoMeshes: Mesh[] = []
  const headMeshes: Mesh[] = []
  const torsoMaterials: MeshBasicMaterial[] = []
  const headMaterials: MeshBasicMaterial[] = []

  for (let i = 0; i < state.targets.length; i++) {
    const torsoMat = new MeshBasicMaterial({ color: TORSO_COLOR })
    const headMat = new MeshBasicMaterial({ color: HEAD_COLOR })
    torsoMaterials.push(torsoMat)
    headMaterials.push(headMat)

    const torsoMesh = new Mesh(torsoGeometry, torsoMat)
    const headMesh = new Mesh(headGeometry, headMat)
    group.add(torsoMesh)
    group.add(headMesh)
    torsoMeshes.push(torsoMesh)
    headMeshes.push(headMesh)
  }

  scene.add(group)

  return {
    sync(s: TargetsState): void {
      for (let i = 0; i < s.targets.length; i++) {
        const target = s.targets[i]
        const torsoHitbox = s.hitboxes[i * 2]
        const headHitbox = s.hitboxes[i * 2 + 1]

        const torsoMesh = torsoMeshes[i]
        const headMesh = headMeshes[i]
        torsoMesh.position.set(torsoHitbox.center.x, torsoHitbox.center.y, torsoHitbox.center.z)
        headMesh.position.set(headHitbox.center.x, headHitbox.center.y, headHitbox.center.z)
        torsoMesh.visible = target.alive
        headMesh.visible = target.alive

        const flash = targetHitFlash(target)
        torsoMaterials[i].color.copy(TORSO_COLOR).lerp(FLASH_COLOR, flash)
        headMaterials[i].color.copy(HEAD_COLOR).lerp(FLASH_COLOR, flash)
      }
    },

    dispose(): void {
      torsoGeometry.dispose()
      headGeometry.dispose()
      for (const m of torsoMaterials) m.dispose()
      for (const m of headMaterials) m.dispose()
      scene.remove(group)
    },
  }
}
