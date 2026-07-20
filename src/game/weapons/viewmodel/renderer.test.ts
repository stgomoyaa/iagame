import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  PerspectiveCamera,
  Skeleton,
  SkinnedMesh,
} from 'three'
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

describe('viewmodel renderer: viewmodels de Source (esqueleto + clips importados)', () => {
  afterEach(() => {
    loadAsyncMock.mockReset()
  })

  /**
   * GLB con la forma que produce el pipeline `v_`: una malla SKINNEADA
   * llamada `weapon_body`, otra de brazos, y los clips canónicos.
   *
   * El skin importa tanto como los clips: `buildAnimatedModel` exige LOS DOS,
   * porque una animación sobre una malla sin skin no movería nada y se vería
   * como un arma congelada en pose de bind — un fallo silencioso, no un error.
   */
  function fakeSourceViewmodel(clipDurations: Record<string, number>): {
    scene: Group
    animations: AnimationClip[]
  } {
    const scene = new Group()
    const skeleton = new Skeleton([new Bone()])
    const body = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial())
    body.name = 'weapon_body'
    body.bind(skeleton)
    const arms = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial())
    arms.name = 'weapon_arms'
    arms.bind(skeleton)
    scene.add(body, arms)

    const animations = Object.entries(clipDurations).map(([name, duration]) => {
      // Un track de dos keyframes: alcanza para que el clip tenga duración
      // real, que es lo único que este test mide.
      const track = new NumberKeyframeTrack('.morphTargetInfluences[0]', [0, duration], [0, 1])
      return new AnimationClip(name, duration, [track])
    })
    return { scene, animations }
  }

  it('un GLB con skin y clips se adjunta por el camino animado, no por el estático', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())

    loadAsyncMock.mockResolvedValueOnce(fakeSourceViewmodel({ idle: 0.03, reload: 2.43 }))
    renderer.setWeaponSlug(SLUG_A)
    await flush()

    expect(renderer.attachedSlug).toBe(SLUG_A)
    expect(renderer.animated).toBe(true)
    expect(renderer.lastLoadError).toBeNull()
  })

  it('un GLB con clips pero SIN skin cae al camino estático: animar una malla no skinneada no movería nada', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())

    const scene = new Group()
    const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial())
    mesh.name = 'weapon_body'
    scene.add(mesh)
    const track = new NumberKeyframeTrack('.morphTargetInfluences[0]', [0, 1], [0, 1])
    loadAsyncMock.mockResolvedValueOnce({
      scene,
      animations: [new AnimationClip('reload', 1, [track])],
    })
    renderer.setWeaponSlug(SLUG_A)
    await flush()

    expect(renderer.attachedSlug).toBe(SLUG_A)
    expect(renderer.animated).toBe(false)
  })

  it('playClip estira el clip para que dure lo que dice el arma, no su duración nativa', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())

    // Nativo 2 s; el arma recarga en 4. El clip tiene que ir a MITAD de
    // velocidad, o la animación termina con el arma todavía recargando.
    loadAsyncMock.mockResolvedValueOnce(fakeSourceViewmodel({ idle: 0.03, reload: 2 }))
    renderer.setWeaponSlug(SLUG_A)
    await flush()

    expect(renderer.playClip('reload', 4)).toBe(true)
    // Se avanza medio clip escalado (1 s de 4) y se comprueba que NO terminó:
    // a velocidad nativa ya habría pasado la mitad del camino restante.
    renderer.advanceAnimation(1)
    expect(renderer.playClip('reload', 4)).toBe(true)
  })

  it('playClip devuelve false para un clip que el arma no trae, para que el llamador sepa que le toca la coreografía procedural', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())

    loadAsyncMock.mockResolvedValueOnce(fakeSourceViewmodel({ idle: 0.03, reload: 2 }))
    renderer.setWeaponSlug(SLUG_A)
    await flush()

    expect(renderer.playClip('reload', 2)).toBe(true)
    expect(renderer.playClip('inspeccionar', 2)).toBe(false)
  })

  it('hasMagazine es falso en un viewmodel de Source: ahí el cargador es un hueso, no una malla que mueva el pivote procedural', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())

    loadAsyncMock.mockResolvedValueOnce(fakeSourceViewmodel({ idle: 0.03, reload: 2 }))
    renderer.setWeaponSlug(SLUG_A)
    await flush()

    expect(renderer.hasMagazine).toBe(false)
  })

  it('advanceAnimation y playClip sobre un arma estática no hacen nada ni rompen', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())

    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()

    expect(renderer.animated).toBe(false)
    expect(renderer.playClip('reload', 2)).toBe(false)
    expect(() => renderer.advanceAnimation(0.016)).not.toThrow()
  })
})
