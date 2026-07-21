import {
  ACESFilmicToneMapping,
  CubeTextureLoader,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
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

/** FOV VERTICAL de la cámara del mundo en reposo (hip). combat/ads.ts
 *  interpola hacia `archetype.ads.fovScale * WORLD_FOV` durante el ADS
 *  (sección 4 del spec de fase 1) — exportada acá en vez de repetir el número
 *  en game.ts, que no puede importar three para leerlo directo de la cámara.
 *
 *  70 (antes 90). Three interpreta este campo como FOV VERTICAL: 90 vertical a
 *  16:9 son ~121° horizontales, más ancho que cualquier FPS mainstream (CS:GO
 *  ~74 vert / 106 horiz, Valorant/Overwatch ~71 vert). Con 90 los enemigos se
 *  dibujaban 1,3x-1,7x más chicos que en esos juegos a igual distancia —"se ven
 *  chicos, cuesta achuntarles". 70 es el medio del rango sano (68 = ~100 horiz,
 *  74 = equivalente CS:GO); es el número que el dueño afina jugando. NO se toca
 *  el tamaño del bot (BOTS.modelScale queda anclado a las hitboxes). La cámara
 *  del viewmodel es OTRA (weapons/viewmodel/renderer.ts VIEWMODEL_FOV): bajar
 *  este FOV NO agranda el arma. El único acople es que el zoom de ADS/miras usa
 *  este valor como base (0.3 * 70 = 21° apuntando, algo más cerrado que antes). */
export const WORLD_FOV = 70

/**
 * Exposición del tonemapping ACES.
 *
 * LO PRIMERO, PORQUE CAMBIA TODO EL RAZONAMIENTO: **el cielo NO pasa por el
 * tonemapping.** Era la preocupación obvia al empezar (ACES oscurece los
 * medios; con exposición 1.0 el cielo caería de 0.2265 a 0.1039, muy por
 * debajo del piso de 0.22 de docs/SKYBOX.md, y el contraste silueta/cielo de
 * 0.1245 a 0.0895, bajo el 0.12 de diseño). No pasa, y no por suerte:
 * `WebGLBackground.js` (three 0.185, línea 151) decide literalmente
 *
 *   boxMesh.material.toneMapped =
 *     ColorManagement.getTransfer( background.colorSpace ) !== SRGBTransfer;
 *
 * y nuestro cubemap está marcado `SRGBColorSpace` unas líneas más abajo en
 * este mismo archivo. O sea: three apaga el tonemapping del fondo por sí
 * solo. Medido y confirmado -- el cielo de arena da idéntico a cuatro
 * decimales antes y después de esta tarea (mín erosionado 0.2363, media
 * 0.2626). El presupuesto de legibilidad del cielo es INMUNE a esta tarea.
 *
 * ⚠️ Y por eso `cielo.colorSpace = SRGBColorSpace` pasó a ser doblemente
 * load-bearing: si algún día el cielo se cambia por un HDR/lineal (el
 * movimiento "obvio" para mejorar la iluminación), el fondo EMPIEZA a
 * tonemapearse y el piso de 0.22 se rompe en silencio. Hay un test que lo
 * fija (engine/renderer.test.ts).
 *
 * Entonces la exposición no la manda el cielo, la manda el MUNDO: es lo que
 * decide si la geometría iluminada queda más clara o más oscura que como se
 * veía sin luces. 2.5 es el valor que **preserva el brillo medio** mientras
 * el rig agrega rango. Medido sobre el suelo de arena, misma pose, misma
 * ventana de 161k píxeles:
 *
 *   sin luces (antes):  mín 0.1833  media 0.2024  máx 0.3295  -> rango 0.146
 *   con rig + ACES 2.5: mín 0.0278  media 0.2397  máx 0.4640  -> rango 0.436
 *
 * Ese salto de rango -- 3x -- es literalmente "deja de verse plano" escrito
 * como número: antes el mapa entero vivía dentro de una franja de 0.15 de
 * luminancia. La media se mantiene (0.20 -> 0.24), así que el mapa no se
 * oscurece ni se lava globalmente; lo que cambia es que ahora hay claros y
 * oscuros.
 */
const EXPOSICION_TONEMAP = 2.5

/**
 * Intensidades del rig de luces.
 *
 * Sólo afectan a materiales ILUMINADOS. Los mapas importados de Source
 * (map/external-map.ts) y sus props se dibujan con `MeshBasicMaterial`, que
 * no tiene modelo de iluminación: three ni siquiera le pasa las luces. Eso
 * es deliberado y es lo que hace que este rig sea seguro de instalar -- el
 * lightmap horneado de nuketown NO se ilumina dos veces, porque las luces
 * no lo tocan. Ver el comentario de `scene.environment` más abajo.
 *
 * Los tres mapas escritos en código (arena, torre, búnker) sí son
 * `MeshStandardMaterial`: no tienen lightmap que respetar, su geometría ya
 * trae normales (map/mesh.ts las escribe desde BoxGeometry) y son
 * justamente los que se veían más planos.
 */
const INTENSIDAD_SOL = 1.8
/**
 * Hemisférica: rellena la sombra. NO es un número de gusto, es un piso de
 * legibilidad, y salió de medirlo mal la primera vez.
 *
 * Con sol 2.2 / ambiente 1.1 el resultado se veía "cinematográfico" y estaba
 * roto: la pared que no mira al sol medía **0.0087** de luminancia contra
 * 0.2916 del piso iluminado. Un factor de 33. Negro, no oscuro. Los bots
 * igual se leían (son `MeshBasicMaterial`, no los toca el rig, así que
 * conservan su brillo), pero desaparecía el MAPA: esquinas, cajas y
 * coberturas se fundían en una mancha negra. No ver la cobertura es un
 * problema de combate más caro que verse plano.
 *
 * Un material sin luz muestra el albedo tal cual, o sea como si la
 * irradiancia fuera 1.0 en todas las caras -- por eso el mapa se veía plano
 * pero nunca se perdía. Al iluminarlo, cada cara pasa a valer albedo x
 * irradiancia, y la cara que sólo recibe ambiente se va al fondo si el
 * ambiente es bajo. La suma sol+ambiente se mantiene parecida (4.4 antes,
 * 4.4 ahora) pero repartida distinto: menos contraste direccional, piso de
 * sombra habitable.
 */
const INTENSIDAD_AMBIENTE = 2.6
/** Reflejos del entorno sobre los materiales PBR. Bajo a propósito: el
 *  cielo es violeta saturado y a intensidad plena tiñe todo el mapa de
 *  lila. */
const INTENSIDAD_ENTORNO = 0.35

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
  // Un mapa importado de Source trae TODA su luz horneada (lightmap del BSP
  // + tinte por instancia en los props) y se dibuja con `MeshBasicMaterial`,
  // que no tiene modelo de iluminación. O sea: el rig de luces no puede
  // cambiarle un solo píxel. Por eso acá se decide de una vez si este
  // renderer lleva rig o no, en vez de instalarlo siempre "por si acaso".
  //
  // NO es una micro-optimización, es la diferencia entre entrar en
  // presupuesto y no entrar. Medido en nuketown, misma pose, 60 muestras:
  //
  //   sin rig (baseline del repo)      gpu mediana 2.09 ms
  //   con rig + sombras 2048 PCFSoft   gpu mediana 4.06 ms
  //   con rig, sombras apagadas        gpu mediana 0.87 ms
  //
  // Casi 2 ms de sombras sobre una escena donde NADA proyecta sombra (el GLB
  // del mapa y sus props vienen con castShadow en false): es el costo fijo
  // de renderizar y limpiar un depth target de 2048x2048 por frame más el
  // muestreo PCF. Pagar eso para no ver ninguna diferencia es exactamente el
  // tipo de gasto que el presupuesto de 2,5 ms no tolera.
  const usaRig = mallaImportada === null
  // PCFSoft y no el default duro: el borde escalonado de una sombra dura
  // sobre geometría de cajas se lee como un error de render, no como una
  // sombra.
  renderer.shadowMap.enabled = usaRig
  renderer.shadowMap.type = PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // Tonemapping ACES sobre TODAS las pasadas (mundo y viewmodel comparten
  // este WebGLRenderer). Es lo único de esta tarea que cambia píxeles que ya
  // se veían bien, así que la exposición está derivada y no elegida: ver
  // EXPOSICION_TONEMAP.
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = EXPOSICION_TONEMAP
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
      // onLoad: recién acá el cubemap tiene las seis caras y se puede
      // prefiltrar para los reflejos (ver generarEntorno más abajo).
      // Prefiltrarlo antes daría un entorno negro.
      () => generarEntorno(),
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

  // --- entorno para reflejos ---------------------------------------------
  // El MISMO cubemap del cielo, pasado por PMREM (prefiltrado por rugosidad),
  // se usa como `scene.environment`: es la fuente de los reflejos de
  // cualquier material PBR. Sin esto un metal rugoso no tiene nada que
  // reflejar y sale gris plano, que es la mitad de por qué "se ve plástico".
  //
  // Por qué esto NO toca el mapa lightmapeado: three aplica
  // `scene.environment` SÓLO a Standard/Lambert/Phong. En WebGLRenderer.js
  // (v0.185) la línea es literal:
  //
  //   materialProperties.environment = ( material.isMeshStandardMaterial ||
  //     material.isMeshLambertMaterial || material.isMeshPhongMaterial )
  //     ? scene.environment : null;
  //
  // `MeshBasicMaterial` no está en esa lista, así que nuketown y sus props
  // no reciben ni un fotón de acá. Un `envMap` sobre ellos habría que
  // ponerlo a mano en el material, y no se pone.
  //
  // El PMREM se genera UNA vez, cuando las seis caras terminan de bajar: el
  // cubemap recién ahí tiene datos, y prefiltrarlo vacío da un entorno negro.
  // Sólo con rig: prefiltrar el cubemap cuesta un puñado de pasadas de GPU al
  // arrancar y ocupa VRAM, y en un mapa importado no habría un solo material
  // que lo lea.
  const pmrem = usaRig ? new PMREMGenerator(renderer) : null
  let entorno: ReturnType<PMREMGenerator['fromCubemap']> | null = null
  function generarEntorno(): void {
    if (pmrem === null) return
    entorno = pmrem.fromCubemap(cielo)
    scene.environment = entorno.texture
    scene.environmentIntensity = INTENSIDAD_ENTORNO
  }

  // --- luces --------------------------------------------------------------
  // Direccional (sol) + hemisférica (relleno). Se crean una sola vez acá: no
  // hay trabajo de luces por frame, así que los guards de asignaciones no ven
  // nada nuevo.
  //
  // La dirección del sol NO es vertical a propósito: una luz cenital deja
  // las cuatro paredes de una caja con la misma intensidad y el mapa se
  // sigue viendo plano, que es el problema que vinimos a resolver. En
  // diagonal, cada cara agarra un valor distinto y la geometría se lee.
  // Las luces NO se agregan con intensidad 0 cuando no hacen falta: se
  // agregan o no se agregan. Una luz en la escena, aunque esté apagada,
  // entra igual en la lista de luces con la que three compila los shaders y
  // se sube como uniform cada frame.
  if (usaRig) {
    const sol = new DirectionalLight(0xfff2e0, INTENSIDAD_SOL)
    sol.position.set(-0.45, 1, 0.62).normalize().multiplyScalar(60)
    sol.target.position.set(0, 0, 0)
    // Sombras: la caja del shadow camera se ajusta a los límites REALES del
    // mapa. Un valor fijo o bien recorta las sombras de medio mapa (torre es
    // alta) o desperdicia resolución en vacío (arena es chica), y las dos
    // fallas se ven igual de mal: sombras que aparecen y desaparecen al
    // caminar.
    sol.castShadow = true
    const b = map.bounds
    const radio =
      Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) * 0.75 + 4
    sol.shadow.camera.left = -radio
    sol.shadow.camera.right = radio
    sol.shadow.camera.top = radio
    sol.shadow.camera.bottom = -radio
    sol.shadow.camera.near = 1
    sol.shadow.camera.far = 200
    // 1024 y no 2048: en los mapas de código la sombra útil es la de cajas
    // grandes sobre un piso, no la de una reja. Duplicar el lado del atlas
    // cuadruplica los texels que hay que escribir y limpiar por frame, y a
    // esta distancia de cámara no se distingue el borde. Ver la medición de
    // GPU en el comentario de `usaRig`.
    sol.shadow.mapSize.set(1024, 1024)
    // Sesgo negativo chico: sin esto el suelo se auto-sombrea en bandas
    // (shadow acne). El normalBias ataca el mismo artefacto en superficies
    // casi paralelas al rayo de luz, donde el bias plano no alcanza.
    sol.shadow.bias = -0.0005
    sol.shadow.normalBias = 0.02
    scene.add(sol)
    scene.add(sol.target)

    // Hemisférica y no ambiente plana: el cielo tiñe por arriba y el suelo
    // por abajo, así una caja no queda con las seis caras del mismo gris
    // cuando el sol no le pega.
    //
    // El color de suelo NO es casi negro (era 0x2a2a30): una pared vertical
    // tiene normal.y = 0 y la hemisférica le da justo la mezcla mitad cielo /
    // mitad suelo, así que un suelo negro se come la mitad del relleno en
    // exactamente las superficies que más importan para leer el mapa.
    const ambiente = new HemisphereLight(0x8b7bb8, 0x4a4a55, INTENSIDAD_AMBIENTE)
    scene.add(ambiente)
  }

  // Un mapa importado de Source trae su propia malla texturizada
  // (map/external-map.ts) y su `boxes` va vacío: buildArenaGeometry() no
  // dibujaría nada. Los mapas escritos en código siguen por el camino de
  // siempre, sin cambios.
  const geometry = buildArenaGeometry(map)
  // `MeshStandardMaterial` y ya no `MeshBasicMaterial`: éste es el cambio que
  // saca a los tres mapas escritos en código del look plano.
  //
  // Es seguro acá y NO lo sería en nuketown, por dos motivos concretos:
  //  1. Esta geometría ya trae normales (map/mesh.ts las copia de
  //     BoxGeometry), que es lo que un material iluminado necesita y lo que
  //     el GLB de nuketown justamente no tiene.
  //  2. Estos mapas no tienen lightmap: no hay luz horneada que el rig
  //     pueda duplicar. En nuketown sí la hay, y por eso ese camino se queda
  //     en MeshBasicMaterial (ver map/external-map.ts).
  //
  // `roughness` alto y `metalness` en cero: son paredes y pisos de arena de
  // tiro, no metal. Un metalness alto acá los volvería espejos violetas del
  // cielo. Los colores siguen viniendo del atributo de vértice de siempre.
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
  })
  const arena = new Mesh(geometry, material)
  // La arena nunca se mueve: saltear el recálculo de matrices por frame.
  arena.matrixAutoUpdate = false
  arena.updateMatrix()
  // Proyecta Y recibe: sin `receiveShadow` las sombras de las cajas no caen
  // sobre el piso, que es donde más se leen.
  arena.castShadow = true
  arena.receiveShadow = true
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
      // El entorno PMREM es un render target propio (no lo libera
      // cielo.dispose()): sin esto cada renderer que se arme y se tire deja
      // su mipmap prefiltrado colgado en VRAM, mismo motivo que el cubemap.
      entorno?.dispose()
      pmrem?.dispose()
      renderer.dispose()
    },
  }
}
