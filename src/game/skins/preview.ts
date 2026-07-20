/**
 * Vista previa de armas para la armería (fase 3, sección 7 del spec).
 *
 * Es un renderer propio y chico, aparte del del juego: la armería es una
 * pantalla de menú, no corre dentro del presupuesto de 2.5ms del motor, y no
 * comparte canvas con la partida. Lo que sí comparte es lo que importa: el
 * mismo `createSkinHandle` (skins/material.ts) sobre el mismo GLB, así que
 * lo que se ve acá es exactamente lo que se ve equipado.
 *
 * Cada arma sigue siendo una llamada de dibujo. `drawCalls` expone la cuenta
 * real de la última pasada para poder verificarlo desde afuera (dos armas en
 * el atril con skins aplicadas tienen que dar 2, no 4).
 *
 * Uno de los archivos autorizados a importar three (ver architecture.test.ts):
 * es el borde contra la escena, igual que material.ts.
 */

import {
  type BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Skin } from '@/game/skins/generator'
import {
  cargarPatron,
  createSkinHandle,
  type SkinHandle,
  type SkinnableMaterial,
} from '@/game/skins/material'
import type { CamoTextura } from '@/game/skins/texturas'
import { instalarRigDeLuz } from '@/game/weapons/viewmodel/lighting'
import { weaponAssetUrl } from '@/game/weapons/registry'

export interface PreviewItem {
  slug: string
  skin: Skin | null
  /**
   * Camuflaje por textura (skins/texturas.ts). Si viene, gana sobre `skin`: el
   * patrón se carga bajo demanda y se aplica cuando termina de bajar. Es lo que
   * permite comparar en la misma vitrina un camo por textura contra uno
   * procedural.
   */
  camo?: CamoTextura | null
}

export interface SkinPreview {
  /** Reemplaza las armas del atril. Descarta las anteriores. */
  setWeapons(items: readonly PreviewItem[]): void
  resize(width: number, height: number): void
  start(): void
  stop(): void
  dispose(): void
  /** Llamadas de dibujo de la última pasada. Una por arma en el atril. */
  readonly drawCalls: number
  readonly lastError: string | null
}

const CAMERA_FOV = 32
/** Separación vertical entre armas del atril, en metros. */
const SPACING = 0.34
/**
 * El arma oscila alrededor de su perfil en vez de girar entera. Girando 360°
 * pasa la mitad del tiempo de canto, donde no se ve ni la silueta ni la
 * skin; oscilando queda siempre legible y el movimiento igual muestra cómo
 * el brillo especular corre por el arma, que es la mitad de la gracia de una
 * skin con metalness alto.
 */
const SWAY_AMPLITUDE = 0.55
const SWAY_SPEED = 0.45

interface Slot {
  group: Group
  mesh: Mesh
  handle: SkinHandle | null
}

/**
 * Geometría Y material de origen por slug, compartidos entre instancias.
 *
 * El material que se guarda acá es el que trae el GLB, SIN parchar, y cada
 * instancia del atril usa un `.clone()` suyo. La distinción importa: cada arma
 * necesita su propio juego de uniforms de skin, y clonar un material YA
 * parchado copiaría la función `onBeforeCompile` apuntando a los uniforms del
 * original, con lo que las dos armas del atril compartirían skin. Clonar el
 * material virgen y parchar el clon no tiene ese problema.
 *
 * Antes acá se fabricaba un `MeshBasicMaterial({ vertexColors: true })` nuevo y
 * se tiraba el del GLB. Eso funcionaba mientras TODAS las armas vinieran con
 * color por vértice horneado, que dejó de ser cierto: las 69 de COD van por el
 * camino PBR (ver `convert-source-weapons.ts`), traen textura y normales y NO
 * traen `COLOR_0`. Pedirle color por vértice a una malla que no lo tiene las
 * dejaba **negras** en la armería. Usar el material del propio GLB es además
 * lo que el encabezado de este archivo ya prometía: que la vitrina muestre
 * exactamente lo mismo que se ve equipado.
 */
interface FuenteArma {
  geometry: BufferGeometry
  material: SkinnableMaterial
}
type GeometryCache = Map<string, FuenteArma>

/**
 * La malla del ARMA dentro del GLB, no la primera que aparezca.
 *
 * `traverse` devuelve las mallas en orden de escena, y en los viewmodels `v_`
 * de CS la primera es `weapon_arms`: la vitrina venía mostrando los brazos con
 * guante en vez del arma en esas 39. El pipeline nombra el cuerpo del arma
 * `weapon_body` (contrato con `scripts/blender/mdl-to-glb.py`), así que se lo
 * busca por nombre y sólo se cae a "la primera malla" cuando no hay ninguna
 * con ese nombre — que es el caso de las 40 CC0, modelos de una pieza sin
 * nombres de parte.
 */
const NODO_CUERPO = 'weapon_body'

/**
 * El material de la malla, si es uno solo y de un tipo que `createSkinHandle`
 * sepa parchar.
 *
 * Un array acá significaría una malla con varias primitivas de materiales
 * distintos, que el pipeline no produce para el cuerpo del arma (lo colapsa a
 * uno). Se contempla igual para no romper en silencio si algún día cambia:
 * devolver `null` deja el mensaje en `lastError`, que es visible, en vez de
 * pintar el arma de negro, que es lo que hacía el camino anterior.
 */
function materialUnico(mesh: Mesh): SkinnableMaterial | null {
  const m = mesh.material
  if (Array.isArray(m)) return null
  return m instanceof MeshBasicMaterial || m instanceof MeshStandardMaterial ? m : null
}

function weaponMesh(root: { traverse(cb: (o: unknown) => void): void }): Mesh | null {
  let primera: Mesh | null = null
  let cuerpo: Mesh | null = null
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return
    if (primera === null) primera = child
    if (cuerpo === null && child.name === NODO_CUERPO) cuerpo = child
  })
  return cuerpo ?? primera
}

export function createSkinPreview(canvas: HTMLCanvasElement): SkinPreview {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearAlpha(0)

  const scene = new Scene()
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.05, 20)
  camera.position.set(0, 0, 1.65)
  // La cámara entra a la escena porque de ella cuelgan las luces: una luz
  // fuera del grafo de la escena no ilumina nada.
  scene.add(camera)
  // El MISMO rig de luz del viewmodel, no uno propio. Las armas de COD usan
  // `MeshStandardMaterial`, que sin luces se dibuja NEGRO — o sea que la
  // vitrina necesita iluminación sí o sí desde que existe el camino PBR. Y si
  // hay que elegir una, la del viewmodel es la que hace verdadera la promesa
  // del encabezado: que el arma se vea acá igual que equipada.
  const rigDeLuz = instalarRigDeLuz(scene, camera, renderer)

  const loader = new GLTFLoader()
  const geometries: GeometryCache = new Map()
  const slots: Slot[] = []

  let running = false
  let rafId = 0
  let drawCalls = 0
  let lastError: string | null = null
  // Token de generación: una carga que resuelve después de que el jugador ya
  // cambió de arma no debe agregar su malla a un atril que ya no es el suyo.
  let generation = 0

  function clearSlots(): void {
    for (const slot of slots) {
      scene.remove(slot.group)
      const material = slot.mesh.material
      if (!Array.isArray(material)) material.dispose()
    }
    slots.length = 0
  }

  function layout(): void {
    const total = slots.length
    const alto = (total - 1) * SPACING
    for (let i = 0; i < total; i++) {
      slots[i].group.position.set(0, alto / 2 - i * SPACING, 0)
    }
  }

  function addWeapon(fuente: FuenteArma, item: PreviewItem, index: number, token: number): void {
    // Clon del material virgen del GLB: ver el comentario de `GeometryCache`.
    const mesh = new Mesh(fuente.geometry, fuente.material.clone())
    // Los GLB salen del pipeline con el cañón hacia -Z (sección 6.3): un
    // cuarto de vuelta los pone de perfil, que es como se mira un arma en
    // una vitrina.
    mesh.rotation.set(0, Math.PI / 2, 0)

    const group = new Group()
    group.add(mesh)
    scene.add(group)

    const handle = createSkinHandle(mesh)
    if (item.camo) {
      // El patrón se baja bajo demanda. Hasta que llega, el arma se ve con su
      // horneado crudo (setCamoTextura con null); cuando llega, se aplica sólo
      // si el atril sigue siendo el mismo (token) y este slot no se descartó.
      const camo = item.camo
      cargarPatron(camo)
        .then((tex) => {
          if (token !== generation) return
          const vivo = slots.find((s) => s.mesh === mesh)
          vivo?.handle?.setCamoTextura(camo, tex)
        })
        .catch(() => {
          lastError = `no se pudo cargar el patrón "${camo.patron}" de "${camo.id}"`
        })
    } else {
      handle?.setSkin(item.skin)
    }

    slots.splice(index, 0, { group, mesh, handle })
    layout()
  }

  function loadInto(item: PreviewItem, index: number, token: number): void {
    const cached = geometries.get(item.slug)
    if (cached) {
      addWeapon(cached, item, index, token)
      return
    }
    loader
      .loadAsync(weaponAssetUrl(item.slug))
      .then((gltf) => {
        if (token !== generation) return
        const mesh = weaponMesh(gltf.scene)
        if (!mesh) {
          lastError = `"${item.slug}.glb" no tiene ninguna malla`
          return
        }
        const material = materialUnico(mesh)
        if (!material) {
          lastError = `"${item.slug}.glb" no trae un material que la vitrina sepa pintar`
          return
        }
        const fuente: FuenteArma = { geometry: mesh.geometry, material }
        geometries.set(item.slug, fuente)
        addWeapon(fuente, item, Math.min(index, slots.length), token)
        lastError = null
      })
      .catch(() => {
        if (token !== generation) return
        lastError = `no se pudo cargar "${item.slug}"`
      })
  }

  function frame(now: number): void {
    if (!running) return
    rafId = requestAnimationFrame(frame)

    const t = now / 1000
    for (const slot of slots) {
      slot.group.rotation.y = Math.sin(t * SWAY_SPEED) * SWAY_AMPLITUDE
      slot.handle?.setTime(t)
    }

    renderer.info.reset()
    renderer.render(scene, camera)
    drawCalls = renderer.info.render.calls
  }

  return {
    setWeapons(items: readonly PreviewItem[]): void {
      generation++
      clearSlots()
      items.forEach((item, i) => loadInto(item, i, generation))
    },

    resize(width: number, height: number): void {
      if (width <= 0 || height <= 0) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },

    start(): void {
      if (running) return
      running = true
      rafId = requestAnimationFrame(frame)
    },

    stop(): void {
      running = false
      cancelAnimationFrame(rafId)
    },

    dispose(): void {
      running = false
      cancelAnimationFrame(rafId)
      clearSlots()
      for (const fuente of geometries.values()) {
        fuente.geometry.dispose()
        fuente.material.dispose()
      }
      geometries.clear()
      rigDeLuz.dispose()
      renderer.dispose()
    },

    get drawCalls(): number {
      return drawCalls
    },

    get lastError(): string | null {
      return lastError
    },
  }
}
