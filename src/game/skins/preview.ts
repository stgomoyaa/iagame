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
  ACESFilmicToneMapping,
  type BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
// El MISMO clone que usa el renderer del viewmodel para las ópticas: una copia
// por montaje que REUSA geometría y material de la escena fuente cacheada (no
// duplica la malla en la GPU). Sirve tanto para grafos con esqueleto como para
// las ópticas, que son estáticas.
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
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
// Ópticas: el catálogo (anclaje, url del GLB) es dato puro; `mount.ts` es el
// borde con la GPU que arma la malla montada y la retícula. La vitrina usa
// EXACTAMENTE la misma `montarOptica` que el renderer del juego y el banco de
// pruebas, así que la mira se ve acá igual que equipada — la promesa de la
// cabecera de este archivo.
import {
  anclaDe,
  opticAssetUrl,
  type OpticaDef,
  type OpticaId,
} from '@/game/weapons/attachments/optics-catalog'
import {
  desmontarFuenteOptica,
  desmontarOptica,
  montarOptica,
} from '@/game/weapons/attachments/mount'

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
  /**
   * Óptica (mira) montada sobre el arma (attachments/optics-catalog.ts), o
   * null/ausente para los hierros. Es INDEPENDIENTE de `skin`/`camo`: se monta
   * sobre el arma tenga o no aspecto, porque es un accesorio físico y no una
   * capa de pintura. El GLB se baja bajo demanda y se cuelga del cuerpo del arma
   * cuando termina de bajar; si el arma no tiene ancla (no soporta ópticas), no
   * se monta nada (honesto: mejor sin mira que con una flotando).
   */
  optic?: OpticaDef | null
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
  /** Óptica montada sobre el cuerpo del arma de este slot, o null. Se guarda
   *  para poder desmontarla (soltar su retícula) al recambiar el atril. */
  optic: Group | null
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
  // EL MISMO tonemapping que el renderer del juego (engine/renderer.ts:
  // ACESFilmic, exposición 2.5). Sin esto la vitrina usa NoToneMapping y MIENTE:
  // los emisivos que en partida ruedan suave hacia el blanco acá recortan duro,
  // así que un camo calibrado en la vitrina saldría distinto equipado. Con ACES
  // el fondo negro se queda negro y las crestas neón ruedan a núcleos casi
  // blancos —exactamente el look de los mastery camos de las referencias—, y lo
  // que se ve acá es lo que se ve en partida (la promesa de la cabecera).
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 2.5

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
  // Escenas fuente de óptica por id: se bajan una vez, se clonan por montaje
  // (la geometría y el material se comparten entre clones, igual que en el
  // renderer) y se liberan una sola vez en `dispose`. Mismo caché que
  // `geometries`, pero para las miras.
  const opticSources: Map<OpticaId, Object3D> = new Map()
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
      // La óptica cuelga del cuerpo del arma: desmontarla suelta su retícula
      // (geometría, material y textura de canvas frescos por montaje). El cuerpo
      // de la mira NO se toca acá: es un clon que comparte recursos con la fuente
      // cacheada, que se libera una sola vez en `dispose`.
      if (slot.optic) desmontarOptica(slot.optic)
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

    slots.splice(index, 0, { group, mesh, handle, optic: null })
    layout()
    // La óptica se monta DESPUÉS del splice para que el slot ya esté en `slots`
    // cuando el montaje (aun por el camino cacheado, síncrono) lo busca por su
    // mesh. Es independiente del aspecto: se cuelga tenga o no camo/skin.
    montarOpticaEnMesh(item, mesh, token)
  }

  /**
   * Monta la óptica de un item sobre el CUERPO (mesh) de su arma, colgándola
   * como hija: así hereda el perfil y el vaivén del arma, y el ancla —definida
   * en el espacio local normalizado del arma— cae sobre el riel igual que en
   * partida. El GLB de la mira se baja bajo demanda y se cachea por id.
   *
   * No hace nada si el item no trae óptica o si el arma no tiene ancla (no
   * soporta ópticas): en ese caso el arma se muestra con los hierros, que es lo
   * honesto. Una carga que resuelve tarde sólo monta si el atril sigue siendo el
   * mismo (token) y el slot sigue vivo, igual que el camino del camo.
   */
  function montarOpticaEnMesh(item: PreviewItem, mesh: Mesh, token: number): void {
    const optic = item.optic
    if (!optic) return
    const ancla = anclaDe(item.slug)
    if (!ancla) return

    const colgar = (fuente: Object3D): void => {
      if (token !== generation) return
      const slot = slots.find((s) => s.mesh === mesh)
      if (!slot) return
      // Remontaje idempotente: si por lo que sea ya había una mira en este slot,
      // se suelta antes de colgar la nueva (no debería pasar en el flujo normal,
      // pero deja el invariante "un slot, una óptica" garantizado).
      if (slot.optic) desmontarOptica(slot.optic)
      const grupo = montarOptica({ opticaScene: cloneSkinned(fuente), def: optic, ancla })
      mesh.add(grupo)
      slot.optic = grupo
    }

    const cached = opticSources.get(optic.id)
    if (cached) {
      colgar(cached)
      return
    }
    loader
      .loadAsync(opticAssetUrl(optic.id))
      .then((gltf) => {
        opticSources.set(optic.id, gltf.scene)
        colgar(gltf.scene)
      })
      .catch(() => {
        lastError = `no se pudo cargar la óptica "${optic.id}"`
      })
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
      // Las escenas fuente de óptica se liberan una sola vez acá (el par de
      // `desmontarOptica`, que a propósito deja intacto el cuerpo compartido).
      for (const fuente of opticSources.values()) desmontarFuenteOptica(fuente)
      opticSources.clear()
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
