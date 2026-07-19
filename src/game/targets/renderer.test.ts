import { Scene } from 'three'
import { describe, expect, it } from 'vitest'
import { createDefaultTargetDefs, createTargets, applyHit, stepTargets } from '@/game/targets/targets'
import { createTargetsRenderer } from '@/game/targets/renderer'

// Igual que map/mesh.test.ts: construir objetos de Three (Scene, Mesh,
// Group, geometrías, materiales) no necesita un contexto WebGL real, sólo
// dibujarlos sí -- así que esto corre en Node sin levantar un navegador.
describe('renderer de dianas', () => {
  it('crea dos mallas por diana (torso + cabeza) y las agrega a la escena', () => {
    const scene = new Scene()
    const state = createTargets(createDefaultTargetDefs())
    createTargetsRenderer(scene, state)

    let meshCount = 0
    scene.traverse((obj) => {
      if ((obj as { isMesh?: boolean }).isMesh) meshCount++
    })
    expect(meshCount).toBe(state.targets.length * 2)
  })

  it('sync() mueve las mallas a la posición actual de las hitboxes', () => {
    const scene = new Scene()
    const state = createTargets(createDefaultTargetDefs())
    const renderer = createTargetsRenderer(scene, state)

    for (let i = 0; i < 100; i++) stepTargets(state, 1 / 60)
    renderer.sync(state)

    const group = scene.children[0]
    const torsoMesh = group.children[0]
    const expectedTorso = state.hitboxes[0].center
    expect(torsoMesh.position.x).toBeCloseTo(expectedTorso.x, 9)
    expect(torsoMesh.position.y).toBeCloseTo(expectedTorso.y, 9)
    expect(torsoMesh.position.z).toBeCloseTo(expectedTorso.z, 9)
  })

  it('una diana rota queda invisible hasta que reaparece', () => {
    const scene = new Scene()
    const state = createTargets(createDefaultTargetDefs())
    const renderer = createTargetsRenderer(scene, state)

    applyHit(state, 0, 99999)
    renderer.sync(state)

    const group = scene.children[0]
    expect(group.children[0].visible).toBe(false)
    expect(group.children[1].visible).toBe(false)
  })

  it('dispose() limpia geometría, materiales y saca el grupo de la escena', () => {
    const scene = new Scene()
    const state = createTargets(createDefaultTargetDefs())
    const renderer = createTargetsRenderer(scene, state)
    expect(scene.children.length).toBe(1)
    renderer.dispose()
    expect(scene.children.length).toBe(0)
  })
})
