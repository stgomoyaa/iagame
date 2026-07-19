/**
 * Renderer del viewmodel: carga el GLB de un arma (public/assets/weapons,
 * ver index.json) y lo dibuja en una segunda pasada de render, con escena y
 * cámara propias.
 *
 * La técnica evita que el arma atraviese paredes cuando el jugador camina
 * pegado a una. Si el arma viviera parenteada a la cámara del mundo dentro
 * de la misma escena, su geometría (a centímetros de la cámara) competiría
 * por profundidad con la arena, y el near plane del mundo (pensado para
 * geometría a escala de metros, ver engine/renderer.ts) la recortaría
 * contra cualquier pared cercana. Una escena y cámara aparte, con su propio
 * near plane angosto, no tiene ese problema: se dibuja siempre encima,
 * después de limpiar sólo el depth buffer (ver render() más abajo y el
 * autoClear=false de engine/renderer.ts).
 *
 * Éste y engine/renderer.ts (más map/mesh.ts) son los únicos archivos de
 * src/game autorizados a importar three (ver architecture.test.ts).
 */

import {
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  type WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getWeaponVisual } from '@/game/weapons/registry'

/** FOV propio del viewmodel, independiente del de mundo (90° en
 *  engine/renderer.ts): así el ADS puede animar uno sin tocar el otro,
 *  como pide la sección 6.1 del spec. */
const VIEWMODEL_FOV = 70
/** Near plane angosto: el arma vive a centímetros de esta cámara, mucho más
 *  cerca que cualquier geometría del mundo (near 0.1 en engine/renderer.ts). */
const VIEWMODEL_NEAR = 0.01
const VIEWMODEL_FAR = 10

export interface ViewmodelRenderer {
  /**
   * Pivote animado: game.ts escribe su position/rotation cada frame con la
   * salida de stepViewmodel(). Es hijo de la cámara del viewmodel, así que
   * rotar la cámara con la mirada del jugador ya mueve el arma con ella sin
   * cálculo adicional acá.
   */
  readonly weapon: Object3D
  /** Cambia el modelo mostrado. Sin efecto si `slug` ya es el actual.
   *  Cachea por slug: volver a una arma ya cargada no vuelve a pedir el GLB. */
  setWeaponSlug(slug: string): void
  /**
   * Segunda pasada de render: copia la orientación de la cámara del mundo,
   * limpia sólo profundidad y dibuja encima. No devuelve estadísticas para
   * no asignar un objeto por frame: `renderer.info.render` ya queda
   * disponible en el WebGLRenderer compartido después de esta llamada, y
   * es responsabilidad del llamador (game.ts) leerlo y sumarlo al del
   * mundo antes de que la próxima pasada lo resetee.
   */
  render(worldCamera: PerspectiveCamera): void
  resize(width: number, height: number): void
  dispose(): void
}

/**
 * El COLOR_0 horneado por el pipeline de conversión (sección 6.3 del spec)
 * llega como atributo `color` de geometría tras pasar por GLTFLoader.
 * Three ya activa `material.vertexColors` cuando detecta ese atributo
 * (GLTFLoader.assignFinalMaterial en la librería), pero se fuerza acá
 * también, explícito: si esa heurística interna cambia entre versiones o el
 * material no pasa por esa ruta, el arma no debe caer en blanco plano en
 * silencio, que es exactamente el riesgo que este chequeo cubre.
 */
function ensureVertexColors(mesh: Mesh): void {
  const material = mesh.material
  if (!(material instanceof MeshBasicMaterial)) return
  if (mesh.geometry.getAttribute('color') && !material.vertexColors) {
    material.vertexColors = true
    material.needsUpdate = true
  }
}

/**
 * Aísla la única malla del GLB en un Object3D con transform identidad,
 * descartando el transform que trae su nodo.
 *
 * Verificado en runtime (no es un supuesto): el nodo de la malla, tal como
 * lo entrega GLTFLoader, carga una escala ~100x y una rotación de -90° en
 * X que no tienen que ver con la pose del arma. Es un artefacto del lado
 * FBX2glTF del pipeline (sección 6.3 del spec) — probablemente la
 * conversión de unidades/eje del FBX de origen quedó como transform de
 * nodo en vez de hornearse — pero los VÉRTICES ya están normalizados
 * correctamente: aplicar ese transform a la geometría (en vez de
 * descartarlo) vuelve a multiplicar por ~100 un modelo que index.json ya
 * reporta en el tamaño correcto, y dejaba al arma 100 veces más grande de
 * lo esperado, con la cámara del viewmodel literalmente adentro de la
 * malla. Por eso acá se resetea el nodo a identidad en vez de "hornear"
 * nada: los vértices ya están donde tienen que estar.
 *
 * Corregir esto en el pipeline de conversión implicaría reconvertir las 14
 * armas y no hay FBX de origen garantizado en todos los entornos; aislar
 * acá, en el borde de carga, es más barato y deja al resto del renderer
 * trabajar sobre un único Object3D con transform identidad sin depender de
 * cuántos niveles de jerarquía trae cada GLB.
 */
function isolateSingleMesh(root: Object3D): Mesh | null {
  let mesh: Mesh | null = null
  root.traverse((child) => {
    if (mesh === null && child instanceof Mesh) mesh = child
  })
  if (mesh === null) return null

  const found: Mesh = mesh
  found.position.set(0, 0, 0)
  found.quaternion.identity()
  found.scale.set(1, 1, 1)
  found.updateMatrix()
  return found
}

function disposeModel(mesh: Mesh): void {
  mesh.geometry.dispose()
  const material = mesh.material
  if (Array.isArray(material)) material.forEach((m) => m.dispose())
  else material.dispose()
}

export function createViewmodelRenderer(sharedRenderer: WebGLRenderer): ViewmodelRenderer {
  const scene = new Scene()
  const camera = new PerspectiveCamera(VIEWMODEL_FOV, 1, VIEWMODEL_NEAR, VIEWMODEL_FAR)
  scene.add(camera)

  // weapon: pivote que anima el rig cada frame (hip/ads/sway/bob/kick/reload).
  // modelRoot: hijo estático dentro de weapon, sólo para la corrección de
  // orientación del modelo crudo (rotationOffset) y scaleAdjust del panel de
  // tuning: ver el comentario de rotationOffset en registry.ts.
  const weapon = new Group()
  camera.add(weapon)
  const modelRoot = new Group()
  weapon.add(modelRoot)

  const loader = new GLTFLoader()
  const cache = new Map<string, Mesh>()
  let currentSlug: string | null = null
  // Token de carga: si el panel cambia de arma antes de que termine un
  // fetch anterior, la respuesta vieja no debe pisar la selección nueva.
  let loadToken = 0

  function attach(mesh: Mesh): void {
    modelRoot.clear()
    modelRoot.add(mesh)
  }

  function load(slug: string): void {
    const token = ++loadToken
    loader
      .loadAsync(`/assets/weapons/${slug}.glb`)
      .then((gltf) => {
        if (token !== loadToken) return
        const mesh = isolateSingleMesh(gltf.scene)
        if (!mesh) {
          console.error(`viewmodel: "${slug}.glb" no tiene ninguna malla`)
          return
        }
        ensureVertexColors(mesh)
        cache.set(slug, mesh)
        if (currentSlug === slug) attach(mesh)
      })
      .catch((err: unknown) => {
        console.error(`viewmodel: no se pudo cargar "${slug}"`, err)
      })
  }

  return {
    weapon,

    setWeaponSlug(slug: string): void {
      if (slug === currentSlug) return
      currentSlug = slug
      const cached = cache.get(slug)
      if (cached) attach(cached)
      else load(slug)
    },

    render(worldCamera: PerspectiveCamera): void {
      camera.rotation.copy(worldCamera.rotation)

      if (currentSlug) {
        const visual = getWeaponVisual(currentSlug)
        modelRoot.rotation.set(
          visual.rotationOffset.rx,
          visual.rotationOffset.ry,
          visual.rotationOffset.rz,
        )
        modelRoot.scale.setScalar(visual.scaleAdjust)
      }

      sharedRenderer.clearDepth()
      sharedRenderer.render(scene, camera)
    },

    resize(width: number, height: number): void {
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },

    dispose(): void {
      for (const mesh of cache.values()) disposeModel(mesh)
      cache.clear()
    },
  }
}
