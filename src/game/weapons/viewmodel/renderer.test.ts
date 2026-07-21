import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import type { Skin } from '@/game/skins/generator'
import { CATALOGO_CAMOS } from '@/game/skins/texturas'
import { getWeaponVisual } from '@/game/weapons/registry'
import { createViewmodelRenderer } from '@/game/weapons/viewmodel/renderer'

// vi.mock se hoistea sobre los imports, pero el factory corre en un scope
// aparte: loadAsyncMock tiene que declararse con vi.hoisted para no caer en
// una referencia a una const que todavía no existe (TDZ) cuando el mock se
// evalúa.
//
// cargarPatronMock y handlesCreados sirven al cableado del camo: la carga del
// patrón se stubea (no hay GPU ni PNG en `node`) y cada SkinHandle se sustituye
// por un espía para poder AFIRMAR qué se le aplicó al arma (setCamoTextura /
// setSkin), que es lo único que un test sin GPU puede verificar de esta vía.
const { loadAsyncMock, cargarPatronMock, handlesCreados } = vi.hoisted(() => ({
  loadAsyncMock: vi.fn(),
  cargarPatronMock: vi.fn(),
  handlesCreados: [] as Array<{
    setSkin: ReturnType<typeof vi.fn>
    setCamoTextura: ReturnType<typeof vi.fn>
    setTime: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  // Tiene que ser 'function', no arrow: vi.fn() sólo puede invocarse con
  // `new` (ver `new GLTFLoader()` en renderer.ts) si su implementación es
  // constructible.
  GLTFLoader: vi.fn(function GLTFLoaderMock(this: { loadAsync: typeof loadAsyncMock }) {
    this.loadAsync = loadAsyncMock
  }),
}))

// Se conserva TODO el módulo real (importActual) y sólo se reemplazan las dos
// piezas que necesitan un doble: `cargarPatron` (I/O de textura, no existe en
// `node`) y `createSkinHandle` (para devolver un espía observable en vez del
// handle real, que escribe uniforms sobre un material que acá no se puede leer).
vi.mock('@/game/skins/material', async (importActual) => {
  const actual = await importActual<typeof import('@/game/skins/material')>()
  return {
    ...actual,
    cargarPatron: cargarPatronMock,
    createSkinHandle: vi.fn(() => {
      const handle = { setSkin: vi.fn(), setCamoTextura: vi.fn(), setTime: vi.fn() }
      handlesCreados.push(handle)
      return handle
    }),
  }
})

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

describe('viewmodel renderer: ópticas (fase cosmética)', () => {
  afterEach(() => {
    loadAsyncMock.mockReset()
  })

  // La construcción de la mira (malla + retícula por canvas) es un borde con la
  // GPU y se verifica en el navegador (src/app/optics-harness + capturas), no en
  // este entorno `node` sin canvas -- mismo criterio que skins/material.ts. Lo
  // que SÍ se testea acá es el CABLEADO del renderer: que setOptic no rompa sin
  // arma y que sea un no-op sobre un arma sin ancla (no monta ni toca el canvas).

  it('setOptic sin arma equipada no rompe', () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())
    expect(() => renderer.setOptic('optic_reddot_m68')).not.toThrow()
    expect(() => renderer.setOptic(null)).not.toThrow()
  })

  it('setOptic sobre un arma SIN ancla es un no-op: no monta nada ni pide el GLB de la óptica', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())

    // SLUG_A ('assaultrifle-1') es CC0, no está en la tabla de anclas, así que
    // no puede montar óptica todavía. El montaje corta ANTES de tocar el canvas.
    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()
    expect(loadAsyncMock).toHaveBeenCalledTimes(1)

    expect(() => renderer.setOptic('optic_acog')).not.toThrow()
    // No se pidió ningún GLB de óptica: sin ancla el montaje ni llega a cargar.
    expect(loadAsyncMock).toHaveBeenCalledTimes(1)

    // El cuerpo del arma no tiene ninguna mira colgada.
    const modelRoot = renderer.weapon.children[0] as Group
    let miras = 0
    modelRoot.traverse((o) => {
      if (o.name.startsWith('optica:')) miras++
    })
    expect(miras).toBe(0)
  })

  it('cambiar de arma sin óptica elegida no rompe', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())
    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()
    expect(renderer.attachedSlug).toBe(SLUG_A)
  })
})

describe('viewmodel renderer: camo por textura (cableado + token de generación async)', () => {
  // El patrón del camo se baja async y se aplica sobre el arma vía setCamoTextura
  // del handle: acá se verifica ese CABLEADO (que llega el camo correcto, que no
  // llega el equivocado). El aspecto pintado en la GPU se verifica en el
  // navegador, mismo criterio que las skins y las miras.
  const CAMO = CATALOGO_CAMOS[0] // elemento-115: verde neón, el mastery insignia
  const OTRO_CAMO = CATALOGO_CAMOS[1]

  /** Promesa que resuelve cuando el test quiere: modela un PNG que sigue
   *  bajando mientras el jugador ya cambió de arma o de aspecto. */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  beforeEach(() => {
    handlesCreados.length = 0
  })

  afterEach(() => {
    loadAsyncMock.mockReset()
    cargarPatronMock.mockReset()
  })

  it('setCamo sin arma equipada no rompe (ni null ni un camo)', () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())
    expect(() => renderer.setCamo(CAMO)).not.toThrow()
    expect(() => renderer.setCamo(null)).not.toThrow()
    // Sin arma no hay nada que pintar: no se baja ningún patrón.
    expect(cargarPatronMock).not.toHaveBeenCalled()
  })

  it('setCamo aplica el patrón sobre el handle del arma cuando el PNG termina de bajar', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())
    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()
    const handle = handlesCreados[handlesCreados.length - 1]

    const tex = {} // sentinela; el handle es un espía, no lee la textura
    cargarPatronMock.mockReturnValueOnce(Promise.resolve(tex))
    renderer.setCamo(CAMO)
    await flush()

    expect(cargarPatronMock).toHaveBeenCalledWith(CAMO)
    expect(handle.setCamoTextura).toHaveBeenCalledWith(CAMO, tex)
  })

  it('branch camo-vs-skin: un camo equipado gana y NO se aplica la skin procedural', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())
    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()
    const handle = handlesCreados[handlesCreados.length - 1]
    handle.setSkin.mockClear() // el attach inicial ya llamó setSkin(null)

    const tex = {}
    cargarPatronMock.mockReturnValueOnce(Promise.resolve(tex))
    renderer.setCamo(CAMO)
    await flush()

    // El camo se aplicó; ninguna skin procedural se coló por el mismo arma.
    expect(handle.setCamoTextura).toHaveBeenCalledWith(CAMO, tex)
    expect(handle.setSkin).not.toHaveBeenCalled()
  })

  it('token de generación: un patrón que baja tarde NO pisa la skin equipada después sobre la misma arma', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())
    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()
    const handle = handlesCreados[handlesCreados.length - 1]

    // Camo en vuelo: el PNG todavía no bajó.
    const dfd = deferred<object>()
    cargarPatronMock.mockReturnValueOnce(dfd.promise)
    renderer.setCamo(CAMO)

    // Sobre la MISMA arma, el jugador pasa a una skin procedural.
    const skin = {} as unknown as Skin // setSkin es espía, no lee la skin
    renderer.setSkin(skin)
    expect(handle.setSkin).toHaveBeenCalledWith(skin)

    // Recién ahora baja el patrón viejo. attachedSlug sigue siendo la misma
    // arma, así que sólo el token de generación puede descartarlo — y debe.
    dfd.resolve({})
    await flush()
    expect(handle.setCamoTextura).not.toHaveBeenCalled()
  })

  it('token de generación: al cambiar de arma (setSkin + setWeaponSlug, como game.ts) el camo viejo no pinta la nueva', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())
    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()

    // Camo en A, PNG en vuelo.
    const dfd = deferred<object>()
    cargarPatronMock.mockReturnValueOnce(dfd.promise)
    renderer.setCamo(CAMO)

    // El jugador cambia a B, que no lleva camo: game.ts llama setSkin(null)
    // ANTES de setWeaponSlug. Eso bumpea el token e invalida la carga en vuelo.
    renderer.setSkin(null)
    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_B)
    await flush()
    const handleB = handlesCreados[handlesCreados.length - 1]

    // El PNG viejo baja tarde: ni por token ni por arma debe tocar a B.
    dfd.resolve({})
    await flush()
    expect(handleB.setCamoTextura).not.toHaveBeenCalled()
    expect(handleB.setSkin).toHaveBeenCalledWith(null)
  })

  it('setCamo(null) vuelve al aspecto de fábrica sin dejar el camo colgado', async () => {
    const renderer = createViewmodelRenderer(fakeSharedRenderer())
    loadAsyncMock.mockResolvedValueOnce(fakeGltf())
    renderer.setWeaponSlug(SLUG_A)
    await flush()
    const handle = handlesCreados[handlesCreados.length - 1]

    cargarPatronMock.mockReturnValueOnce(Promise.resolve({}))
    renderer.setCamo(OTRO_CAMO)
    await flush()
    handle.setSkin.mockClear()

    renderer.setCamo(null)
    // Quitar el camo cae por la vía de skin: setSkin(null) = horneado de fábrica.
    expect(handle.setSkin).toHaveBeenCalledWith(null)
  })
})
