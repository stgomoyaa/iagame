import { afterEach, describe, expect, it, vi } from 'vitest'
import { BufferGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three'
import type { WebGLRenderer } from 'three'
import { getWeaponVisual } from '@/game/weapons/registry'
import { createViewmodelRenderer } from '@/game/weapons/viewmodel/renderer'

// vi.mock se hoistea sobre los imports, pero el factory corre en un scope
// aparte: loadAsyncMock tiene que declararse con vi.hoisted para no caer en
// una referencia a una const que todavía no existe (TDZ) cuando el mock se
// evalúa.
const { loadAsyncMock } = vi.hoisted(() => ({ loadAsyncMock: vi.fn() }))

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  // Tiene que ser 'function', no arrow: vi.fn() sólo puede invocarse con
  // `new` (ver `new GLTFLoader()` en renderer.ts) si su implementación es
  // constructible.
  GLTFLoader: vi.fn(function GLTFLoaderMock(this: { loadAsync: typeof loadAsyncMock }) {
    this.loadAsync = loadAsyncMock
  }),
}))

function fakeSharedRenderer(): WebGLRenderer {
  return { clearDepth: vi.fn(), render: vi.fn() } as unknown as WebGLRenderer
}

function fakeGltf(): { scene: Group } {
  const scene = new Group()
  scene.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()))
  return { scene }
}

/** Deja correr las reacciones de promesas encadenadas dentro de load()
 *  (then/catch sobre loadAsync). Un tick de macrotask alcanza: no hay más
 *  de dos niveles de encadenamiento por carga. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

const SLUG_A = 'assaultrifle-1'
const SLUG_B = 'pistol-1'

describe('viewmodel renderer: un load fallido no debe dejar un estado incoherente', () => {
  afterEach(() => {
    loadAsyncMock.mockReset()
    // WEAPON_REGISTRY es un singleton mutable (el panel de tuning lo
    // escribe en vivo): deshace las mutaciones de prueba para no
    // contaminar otros tests del mismo archivo.
    for (const slug of [SLUG_A, SLUG_B]) {
      const visual = getWeaponVisual(slug)
      visual.rotationOffset.rx = 0
      visual.rotationOffset.ry = 0
      visual.rotationOffset.rz = 0
      visual.scaleAdjust = 1
    }
  })

  it('un load fallido no mueve attachedSlug ni deja que render() le aplique la corrección de la arma nueva al modelo viejo', async () => {
    // Corrección visual distinta por arma, como dejaría un tuneador real
    // con el panel de weapons/viewmodel/tuning-panel.ts: si render()
    // aplicara la de SLUG_B al mesh de SLUG_A, esto lo delata.
    getWeaponVisual(SLUG_A).rotationOffset.rx = 0.5
    getWeaponVisual(SLUG_B).scaleAdjust = 3

    const renderer = createViewmodelRenderer(fakeSharedRenderer())
    const worldCamera = new PerspectiveCamera()

    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()
    expect(renderer.attachedSlug).toBe(SLUG_A)
    expect(renderer.lastLoadError).toBeNull()

    loadAsyncMock.mockRejectedValueOnce(new Error('404'))
    renderer.setWeaponSlug(SLUG_B)
    await flush()

    // El modelo que se ve sigue siendo el de SLUG_A: el 404 de SLUG_B no lo
    // reemplazó por nada (no hay mesh de SLUG_B), así que no debe moverse.
    expect(renderer.attachedSlug).toBe(SLUG_A)
    expect(renderer.lastLoadError).not.toBeNull()

    renderer.render(worldCamera)
    const modelRoot = renderer.weapon.children[0] as Group
    // Si el bug estuviera de vuelta, esto leería el scaleAdjust=3 de
    // SLUG_B (el pedido fallido) en vez del 1 de SLUG_A (el que se ve).
    expect(modelRoot.rotation.x).toBeCloseTo(0.5, 6)
    expect(modelRoot.scale.x).toBeCloseTo(1, 6)
  })

  it('reintentar el slug que acaba de fallar vuelve a pedir el GLB, no lo descarta por deduplicación', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())

    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()

    loadAsyncMock.mockRejectedValueOnce(new Error('network'))
    renderer.setWeaponSlug(SLUG_B)
    await flush()
    expect(loadAsyncMock).toHaveBeenCalledTimes(2)

    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_B)
    await flush()

    expect(loadAsyncMock).toHaveBeenCalledTimes(3)
    expect(renderer.attachedSlug).toBe(SLUG_B)
    expect(renderer.lastLoadError).toBeNull()
  })

  it('un load exitoso posterior limpia el aviso de error del intento anterior', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())

    loadAsyncMock.mockRejectedValueOnce(new Error('404'))
    renderer.setWeaponSlug(SLUG_A)
    await flush()
    expect(renderer.attachedSlug).toBeNull()
    expect(renderer.lastLoadError).not.toBeNull()

    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()

    expect(renderer.attachedSlug).toBe(SLUG_A)
    expect(renderer.lastLoadError).toBeNull()
  })

  it('un GLB sin ninguna malla cuenta como load fallido, igual que un 404', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())

    // Escena vacía: isolateSingleMesh no encuentra ningún Mesh adentro.
    loadAsyncMock.mockResolvedValueOnce({ scene: new Group() })
    renderer.setWeaponSlug(SLUG_A)
    await flush()

    expect(renderer.attachedSlug).toBeNull()
    expect(renderer.lastLoadError).not.toBeNull()
  })
})
