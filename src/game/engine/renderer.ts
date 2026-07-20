import {
  CubeTextureLoader,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { CARAS_SKYBOX, mensajeSkyboxFaltante, RUTA_SKYBOX } from '@/game/engine/skybox'
import { ARENA } from '@/game/map/arena'
import { buildArenaGeometry } from '@/game/map/mesh'
import type { MapDef } from '@/game/map/types'
import type { Vec3 } from '@/game/math/vec3'

/** FOV de la cámara del mundo en reposo (hip). combat/ads.ts interpola
 *  hacia `archetype.ads.fovScale * WORLD_FOV` durante el ADS (sección 4 del
 *  spec de fase 1) — exportada acá en vez de repetir el número "90" en
 *  game.ts, que no puede importar three para leerlo directo de la cámara. */
export const WORLD_FOV = 90

/** Resultado de proyectar un punto del mundo a pantalla. Preasignado por el
 *  llamador (ver GameRenderer.worldToScreen). */
export interface ScreenPoint {
  /** Coordenadas NDC ([-1,1] en cada eje, +Y arriba). */
  x: number
  y: number
  /** false si el punto queda detrás de la cámara (proyectarlo igual daría
   *  una posición de pantalla sin sentido). */
  visible: boolean
}

export interface GameRenderer {
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer
  /** Escena del mundo: expuesta para que módulos con permiso de importar
   *  three (ver architecture.test.ts) puedan agregar objetos propios --
   *  hoy sólo targets/renderer.ts (las dianas de la sección 6 del spec).
   *  La arena se queda dueña de su malla acá adentro, sin cambios. */
  readonly scene: Scene
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
  /**
   * Proyecta `point` (mundo) a coordenadas de pantalla NDC, escribiendo en
   * `out` (preasignado por el llamador -- cero asignaciones por disparo,
   * igual que el resto del camino de combate). Usa matrixWorldInverse +
   * projectionMatrix reales de Three (mismo cálculo que `Vector3.project()`,
   * pero separado en dos pasos para poder leer el Z de espacio de cámara de
   * paso, ver `visible` más abajo) con un `Vector3` scratch propio de este
   * módulo: es la matriz de proyección real de la cámara (FOV, aspect,
   * near/far), no una reimplementación a mano -- por eso vive acá, en el
   * único tipo de archivo de src/game con permiso para hablar con three
   * (ver architecture.test.ts), y no en feedback/ (que arma los números de
   * daño a partir de este NDC pero no sabe nada de cámaras).
   */
  worldToScreen(point: Vec3, out: ScreenPoint): void
  dispose(): void
}

/**
 * `map` es un parámetro y no la arena fija de antes: con tres mapas
 * jugables (map/registry.ts) el renderer no puede tener uno cableado. Sigue
 * fusionando el mapa entero en UNA geometría -- un draw call por mapa,
 * cualquiera sea.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  map: MapDef = ARENA,
  mallaImportada: Object3D | null = null,
): GameRenderer {
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

  // --- cielo -------------------------------------------------------------
  // Se declara ANTES del cargador y no después: CubeTextureLoader engancha
  // un onError POR CADA una de las seis caras, así que un asset ausente
  // dispara seis veces. Sin este candado el aviso sale sextuplicado y se
  // lee como un bug distinto del que es.
  let avisoSkyboxEmitido = false
  function avisarSkyboxFaltante(): void {
    if (avisoSkyboxEmitido) return
    avisoSkyboxEmitido = true
    // `console.error` y no `warn`: esto NO es cosmético. El juego sigue
    // andando con el cielo negro -- exactamente el estado que esta tarea
    // vino a eliminar -- así que tiene que doler en la consola.
    //
    // Se reporta la carpeta y no la URL del evento: el `error` de un
    // <img> es un Event pelado, sin la ruta que falló (esa info se la
    // guarda el navegador para la pestaña de red). Inventar un nombre de
    // archivo concreto a partir de ahí sería adivinar; con la carpeta
    // alcanza, porque o están las seis caras o no está ninguna.
    console.error(mensajeSkyboxFaltante(`${RUTA_SKYBOX}{${CARAS_SKYBOX.join(',')}}`))
  }

  // El MISMO cielo para los cuatro mapas, incluidos los importados de Source
  // (que traen su propia idea de skybox en el BSP y acá se ignora a
  // propósito): es una decisión de dirección de arte, no una limitación.
  //
  // Va sobre `scene.background`, no sobre una malla gigante: así lo dibuja
  // el propio render() de Three con su shader de fondo, a profundidad
  // máxima y sin escribir el z-buffer. No suma un draw call de geometría ni
  // se puede atravesar volando. Y NO hay estado por frame acá: se carga una
  // vez al armar el renderer, así que los guards de asignaciones no ven
  // nada nuevo.
  //
  // Los mapas escritos en código (arena, torre, búnker) no tienen techo:
  // esto se ve por encima de sus paredes, que es lo buscado.
  const cielo = new CubeTextureLoader()
    .setPath(RUTA_SKYBOX)
    .load(
      // Copia mutable porque el tipo de load() pide string[]; el orden real
      // (contrato +X,-X,+Y,-Y,+Z,-Z) lo custodia engine/skybox.ts.
      [...CARAS_SKYBOX],
      undefined,
      undefined,
      avisarSkyboxFaltante,
    )
  // Explícito aunque CubeTextureLoader ya lo ponga por su cuenta en esta
  // versión de three: es la propiedad de la que depende TODO el presupuesto
  // de legibilidad del cielo (docs/SKYBOX.md). Si se tratan estos bytes como
  // luz lineal, la salida los vuelve a codificar a sRGB, el cielo sale
  // lavado muy por encima de la luminancia diseñada y las siluetas dejan de
  // recortarse. Dejarlo escrito hace que un cambio de default en un bump de
  // three no lo apague en silencio.
  cielo.colorSpace = SRGBColorSpace
  scene.background = cielo

  // Un mapa importado de Source trae su propia malla texturizada
  // (map/external-map.ts) y su `boxes` va vacío: buildArenaGeometry() no
  // dibujaría nada. Los mapas escritos en código siguen por el camino de
  // siempre, sin cambios.
  const geometry = buildArenaGeometry(map)
  const material = new MeshBasicMaterial({ vertexColors: true })
  const arena = new Mesh(geometry, material)
  // La arena nunca se mueve: saltear el recálculo de matrices por frame.
  arena.matrixAutoUpdate = false
  arena.updateMatrix()
  if (mallaImportada === null) scene.add(arena)
  else scene.add(mallaImportada)

  const rawContext = renderer.getContext()
  const gl = rawContext instanceof WebGL2RenderingContext ? rawContext : null

  // Scratch preasignado una sola vez: worldToScreen() de acá abajo sólo lo
  // muta, nunca crea un Vector3 nuevo (cero asignaciones por disparo).
  const scratchProject = new Vector3()

  return {
    camera,
    renderer,
    scene,
    gl,
    render(): void {
      renderer.clear()
      renderer.render(scene, camera)
    },
    worldToScreen(point: Vec3, out): void {
      // updateMatrixWorld() explícito: game.ts puede llamar a esto en el
      // mismo frame en que recién movió camera.position/rotation, ANTES de
      // que render() (más abajo en el frame) dispare su propio recálculo
      // interno de matrixWorld/matrixWorldInverse. Sin este llamado acá,
      // la proyección usaría la orientación de cámara del frame ANTERIOR.
      // No asigna nada: Three preasigna matrix/matrixWorld/matrixWorldInverse
      // como propiedades de instancia, esto sólo las muta.
      camera.updateMatrixWorld()
      scratchProject.set(point.x, point.y, point.z)
      scratchProject.applyMatrix4(camera.matrixWorldInverse)
      // Espacio de cámara: adelante es -Z (convención estándar de Three).
      // Un viewZ >= 0 significa que el punto queda detrás -- proyectarlo
      // igual daría una posición de pantalla invertida sin sentido.
      const viewZ = scratchProject.z
      scratchProject.applyMatrix4(camera.projectionMatrix)
      out.x = scratchProject.x
      out.y = scratchProject.y
      out.visible = viewZ < 0
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
      // El cubemap son ~25 MB de VRAM con mips: sin esto, cada renderer que
      // se arme y se tire (cambiar de mapa, HMR en dev) deja los seis
      // niveles colgados hasta que el driver se dé cuenta.
      cielo.dispose()
      renderer.dispose()
    },
  }
}
