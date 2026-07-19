import { Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { ARENA } from '@/game/map/arena'
import { buildArenaGeometry } from '@/game/map/mesh'

/** FOV de la cámara del mundo en reposo (hip). combat/ads.ts interpola
 *  hacia `archetype.ads.fovScale * WORLD_FOV` durante el ADS (sección 4 del
 *  spec de fase 1) — exportada acá en vez de repetir el número "90" en
 *  game.ts, que no puede importar three para leerlo directo de la cámara. */
export const WORLD_FOV = 90

export interface GameRenderer {
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer
  /**
   * Contexto WebGL2 crudo, para medir GPU real vía
   * EXT_disjoint_timer_query_webgl2 (ver engine/gpu-timer.ts). Three no
   * expone ningún timestamp de GPU en WebGLRenderer — sólo en su renderer
   * WebGPU, que este proyecto no usa — así que hay que hablarle directo al
   * contexto. Se expone acá (y no en stats.ts o gpu-timer.ts) porque este es
   * uno de los tres únicos archivos de src/game autorizados a importar three
   * (ver architecture.test.ts): WebGL2RenderingContext es un global del DOM,
   * no un tipo de Three, así que exponerlo no rompe ese límite.
   * null si el contexto de este WebGLRenderer no resultó ser WebGL2 (no
   * debería pasar con esta configuración, pero no se fuerza con un cast).
   */
  readonly gl: WebGL2RenderingContext | null
  render(): void
  resize(width: number, height: number): void
  /**
   * FOV de la cámara del mundo, en grados (mismo campo que
   * PerspectiveCamera.fov de Three). game.ts la llama cada frame con el FOV
   * ya interpolado por ADS (combat/ads.ts): no hay guard de "sólo si
   * cambió" a propósito — updateProjectionMatrix() es un puñado de
   * multiplicaciones de matriz, muy por debajo del presupuesto de frame, y
   * un guard manual sólo suma una comparación y una rama sin necesidad.
   */
  setFov(fov: number): void
  dispose(): void
}

export function createRenderer(canvas: HTMLCanvasElement): GameRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    // El buffer de stencil no se usa y cuesta ancho de banda.
    stencil: false,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // autoClear apagado a propósito: el viewmodel (weapons/viewmodel/renderer.ts)
  // dibuja una segunda pasada sobre este mismo WebGLRenderer, después del
  // mundo, limpiando sólo profundidad (renderer.clearDepth()) para que el
  // arma nunca se recorte contra la geometría del mundo. render() de acá
  // abajo compensa con un clear() explícito y completo, así que el
  // comportamiento visual de esta pasada por sí sola no cambia.
  renderer.autoClear = false

  const scene = new Scene()
  const camera = new PerspectiveCamera(WORLD_FOV, 1, 0.1, 200)

  const geometry = buildArenaGeometry(ARENA)
  const material = new MeshBasicMaterial({ vertexColors: true })
  const arena = new Mesh(geometry, material)
  // La arena nunca se mueve: saltear el recálculo de matrices por frame.
  arena.matrixAutoUpdate = false
  arena.updateMatrix()
  scene.add(arena)

  const rawContext = renderer.getContext()
  const gl = rawContext instanceof WebGL2RenderingContext ? rawContext : null

  return {
    camera,
    renderer,
    gl,
    render(): void {
      renderer.clear()
      renderer.render(scene, camera)
    },
    resize(width: number, height: number): void {
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    },
    setFov(fov: number): void {
      camera.fov = fov
      camera.updateProjectionMatrix()
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
