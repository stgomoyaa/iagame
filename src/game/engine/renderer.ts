import { Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { ARENA } from '@/game/map/arena'
import { buildArenaGeometry } from '@/game/map/mesh'

export interface GameRenderer {
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer
  render(): void
  resize(width: number, height: number): void
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
  const camera = new PerspectiveCamera(90, 1, 0.1, 200)

  const geometry = buildArenaGeometry(ARENA)
  const material = new MeshBasicMaterial({ vertexColors: true })
  const arena = new Mesh(geometry, material)
  // La arena nunca se mueve: saltear el recálculo de matrices por frame.
  arena.matrixAutoUpdate = false
  arena.updateMatrix()
  scene.add(arena)

  return {
    camera,
    renderer,
    render(): void {
      renderer.clear()
      renderer.render(scene, camera)
    },
    resize(width: number, height: number): void {
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
