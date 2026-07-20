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
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Skin } from '@/game/skins/generator'
import { createSkinHandle, type SkinHandle } from '@/game/skins/material'
import { weaponAssetUrl } from '@/game/weapons/registry'

export interface PreviewItem {
  slug: string
  skin: Skin | null
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
 * Geometría por slug, compartida entre instancias. Se comparte la geometría
 * y NO el material: cada arma del atril necesita su propio juego de uniforms
 * de skin, y clonar un material ya parchado copiaría la función
 * `onBeforeCompile` apuntando a los uniforms del original (las dos armas
 * quedarían con la misma skin). Por eso cada instancia estrena material.
 */
type GeometryCache = Map<string, BufferGeometry>

function firstMesh(root: { traverse(cb: (o: unknown) => void): void }): Mesh | null {
  let found: Mesh | null = null
  root.traverse((child) => {
    if (found === null && child instanceof Mesh) found = child
  })
  return found
}

export function createSkinPreview(canvas: HTMLCanvasElement): SkinPreview {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearAlpha(0)

  const scene = new Scene()
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.05, 20)
  camera.position.set(0, 0, 1.65)

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

  function addWeapon(geometry: BufferGeometry, item: PreviewItem, index: number): void {
    const material = new MeshBasicMaterial({ vertexColors: true })
    const mesh = new Mesh(geometry, material)
    // Los GLB salen del pipeline con el cañón hacia -Z (sección 6.3): un
    // cuarto de vuelta los pone de perfil, que es como se mira un arma en
    // una vitrina.
    mesh.rotation.set(0, Math.PI / 2, 0)

    const group = new Group()
    group.add(mesh)
    scene.add(group)

    const handle = createSkinHandle(mesh)
    handle?.setSkin(item.skin)

    slots.splice(index, 0, { group, mesh, handle })
    layout()
  }

  function loadInto(item: PreviewItem, index: number, token: number): void {
    const cached = geometries.get(item.slug)
    if (cached) {
      addWeapon(cached, item, index)
      return
    }
    loader
      .loadAsync(weaponAssetUrl(item.slug))
      .then((gltf) => {
        if (token !== generation) return
        const mesh = firstMesh(gltf.scene)
        if (!mesh) {
          lastError = `"${item.slug}.glb" no tiene ninguna malla`
          return
        }
        geometries.set(item.slug, mesh.geometry)
        addWeapon(mesh.geometry, item, Math.min(index, slots.length))
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
      for (const geometry of geometries.values()) geometry.dispose()
      geometries.clear()
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
