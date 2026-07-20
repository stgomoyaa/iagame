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
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SkinnedMesh,
  type WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createSkinHandle, type SkinHandle } from '@/game/skins/material'
import type { Skin } from '@/game/skins/generator'
import { getWeaponVisual, weaponAssetUrl } from '@/game/weapons/registry'

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
  /**
   * Pivote del cargador, hermano del modelo dentro de `weapon`. game.ts le
   * escribe la pose que devuelve `magazinePose()` (weapons/viewmodel/reload.ts)
   * para que el cargador salga, caiga y vuelva a entrar durante la recarga.
   *
   * Es hermano del modelo y no hijo por una razón concreta: el nodo del modelo
   * lleva la corrección de orientación de cada arma (`rotationOffset`), así
   * que un offset aplicado ahí adentro saldría rotado por esa corrección — el
   * "abajo" del cargador apuntaría a un lado distinto en cada arma. Colgando
   * de `weapon`, sus ejes son los mismos que los de la pose que calcula el
   * rig, y "abajo" es abajo en las 79.
   *
   * Siempre existe, tenga el arma cargador o no: game.ts escribe la pose sin
   * preguntar y `magVisible` decide si se dibuja. Un arma sin cargador
   * simplemente tiene el pivote vacío.
   */
  readonly magPivot: Object3D
  /** True si el arma adjunta trae cargador como malla aparte. Las que no,
   *  recargan sólo con la coreografía procedural del cuerpo. */
  readonly hasMagazine: boolean

  /**
   * True si el arma adjunta es un viewmodel de Source: trae esqueleto, brazos
   * y las secuencias originales del juego, y las reproduce en vez de correr la
   * coreografía procedural de recarga.
   *
   * Lo decide lo que hay ADENTRO del GLB (¿tiene skin?, ¿tiene clips?), no lo
   * que dice el índice. Los dos coinciden, pero que el renderer mire el
   * archivo que efectivamente cargó lo hace inmune a un índice desactualizado:
   * el modo en que se anima un arma no puede desincronizarse del modelo que se
   * está dibujando.
   */
  readonly animated: boolean

  /**
   * Arranca un clip importado (`reload`, `draw`, `idle`, `fire`), estirándolo
   * o comprimiéndolo para que dure exactamente `seconds`. Devuelve false si el
   * arma no es animada o no tiene ese clip, para que el llamador sepa que le
   * toca la coreografía procedural.
   *
   * Por qué se ajusta la duración en vez de reproducir a velocidad nativa: el
   * `reloadTime` de cada arma es una estadística de JUEGO que ya está
   * balanceada y de la que dependen el HUD, el audio y la ventana en la que el
   * jugador está indefenso. Reproducir a velocidad nativa desincronizaría la
   * animación del estado real. Como las duraciones nativas de CS y las
   * nuestras salen casi iguales (el AK recarga en 2,43 s en los dos), el
   * factor de velocidad ronda 1 y no se nota — pero cuando no lo sea, manda el
   * juego.
   */
  playClip(name: string, seconds: number): boolean

  /**
   * Avanza el mezclador de animación. Se llama una vez por frame ANTES de
   * render(), con el mismo dt que el resto del rig.
   *
   * Es una llamada aparte y no parte de render() porque el orden importa: el
   * mezclador escribe las rotaciones de los HUESOS, y las capas procedurales
   * (sway, bob, ADS, kick) escriben el transform del GRUPO PADRE. Son dos
   * espacios distintos y por eso no se pisan — que es justo el problema que sí
   * existe cuando una corrección procedural se aplica sobre el mismo hueso que
   * el mezclador está escribiendo. Mantenerlos como dos pasos explícitos deja
   * esa separación a la vista en lugar de escondida adentro de render().
   */
  advanceAnimation(dt: number): void
  /** Cambia el modelo mostrado. Sin efecto si `slug` ya es el actual.
   *  Cachea por slug: volver a una arma ya cargada no vuelve a pedir el GLB. */
  setWeaponSlug(slug: string): void
  /**
   * Slug efectivamente adjunto a modelRoot ahora mismo, o null si todavía
   * no se adjuntó ninguno (carga en curso o fallida). Distinto del slug
   * *pedido* por el último setWeaponSlug: si ese pedido está en vuelo o
   * falló, éste sigue apuntando al último modelo realmente en pantalla.
   * game.ts lo usa para decidir a qué arma animar (rig, pose) — nunca al
   * slug pedido, para no volver a caer en el bug de este archivo (ver
   * comentario de requestedSlug/attachedSlug más abajo).
   */
  readonly attachedSlug: string | null

  /**
   * Skin equipada, o null para el aspecto de fábrica del GLB. Se aplica al
   * cambiar de arma o de skin, nunca por frame: el trabajo por frame es
   * escribir un uniform de tiempo (ver `render`), y eso es una asignación de
   * número (sección 2 del spec: cero asignaciones por frame).
   *
   * Se guarda acá y no en el handle de la malla porque una malla puede no
   * estar cargada todavía cuando el jugador equipa la skin: al adjuntarse,
   * `attach` se la aplica.
   */
  setSkin(skin: Skin | null): void

  /**
   * Segunda pasada de render: copia la orientación de la cámara del mundo,
   * limpia sólo profundidad y dibuja encima. No devuelve estadísticas para
   * no asignar un objeto por frame: `renderer.info.render` ya queda
   * disponible en el WebGLRenderer compartido después de esta llamada, y
   * es responsabilidad del llamador (game.ts) leerlo y sumarlo al del
   * mundo antes de que la próxima pasada lo resetee.
   */
  render(worldCamera: PerspectiveCamera, timeSeconds?: number): void
  resize(width: number, height: number): void
  dispose(): void
  /**
   * Mensaje del último load fallido (404, red caída, GLB sin malla), o
   * null si no hay ninguno pendiente de mostrar. game.ts lo lee cada frame
   * y lo refleja en un aviso en pantalla — sin esto, un load fallido queda
   * silencioso salvo por el console.error. No es un stream de eventos a
   * propósito: un solo valor "último error" alcanza para este caso de uso
   * y evita sumar un sistema de suscripción sólo para esto.
   */
  readonly lastLoadError: string | null
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
 * Nombre del nodo del cargador en los GLB de armas de Source. Lo escribe
 * `scripts/blender/mdl-to-glb.py` y lo preserva `convert-source-weapons.ts`
 * (join con `keepNamed`). 35 de las 39 armas de Source lo traen; las 40 CC0
 * y los revólveres/escopetas de bombeo no.
 */
const MAG_NODE_NAME = 'weapon_mag'

/**
 * Nombre del cuerpo del arma en los viewmodels de Source (`v_`), que llegan
 * como DOS mallas skinneadas: el arma y los brazos.
 *
 * La distinción importa por el camuflaje: `skins/material.ts` parcha el shader
 * del material de la malla a la que se lo enganche, así que engancharlo a los
 * brazos pintaría los guantes con el camo del arma. El handle se crea sólo
 * para esta malla; los brazos se quedan con su aspecto.
 */
const BODY_NODE_NAME = 'weapon_body'

/**
 * Rotación base de los viewmodels de Source, en radianes sobre Y.
 *
 * Los `v_` salen de Blender con el cañón sobre +X (la convención de Source:
 * +X adelante, +Z arriba, que el exportador de glTF deja como +X adelante,
 * +Y arriba). La cámara del viewmodel mira hacia -Z como cualquier cámara de
 * Three, así que hay que llevar ese +X a -Z: un cuarto de vuelta sobre Y.
 *
 * Va acá y no horneada en la geometría por una razón dura: la malla está
 * SKINNEADA. Mover los vértices sin mover también las matrices de bind
 * inversas del esqueleto deja malla y huesos en espacios distintos, y el arma
 * se deforma en cuanto empieza a animar. Rotar el NODO PADRE mueve las dos
 * cosas juntas y no toca el skin. Ver el punto 1 del encabezado de
 * `scripts/convert-source-viewmodels.ts`.
 *
 * Se compone con el `rotationOffset` del arma (que sigue siendo el ajuste
 * fino del panel de tuning, y arranca en cero), no lo reemplaza.
 */
const SOURCE_VIEWMODEL_YAW = Math.PI / 2

/** Segundos de mezcla al cambiar de clip. Corto a propósito: es para que el
 *  salto entre reposo y recarga no sea un corte seco, no para suavizar la
 *  animación en sí, que ya viene animada. */
const CLIP_BLEND = 0.06

/**
 * Un viewmodel de Source ya cargado: la escena entera del GLB (mallas +
 * esqueleto), su mezclador y las acciones por nombre canónico.
 *
 * Se guarda la escena COMPLETA y no las mallas aisladas, al revés que en el
 * camino estático: el esqueleto es parte de la jerarquía y aislarlo sería
 * exactamente el error que rompe el skinning.
 */
interface AnimatedModel {
  scene: Object3D
  mixer: AnimationMixer
  actions: Map<string, AnimationAction>
  /** Duración nativa de cada clip, para poder ajustar la velocidad. */
  durations: Map<string, number>
  /** Malla del arma (no los brazos): es a la que se le engancha el camo. */
  body: Mesh | null
  /** Acción sonando ahora, para poder fundir hacia la siguiente. */
  current: AnimationAction | null
}

/**
 * Aísla la única malla del GLB en un Object3D con transform identidad,
 * descartando el transform que trae su nodo.
 *
 * Las 14 armas actuales ya salen limpias de scripts/convert-weapons.ts
 * (clearNodeTransform, sección 6.3 del spec): el nodo llega en identidad y
 * este reseteo es un no-op para ellas. Se mantiene igual, a propósito, como
 * defensa: si un pack futuro se convierte con una versión vieja del script,
 * o llega ya convertido desde otro lado, y trae el mismo artefacto de
 * FBX2glTF (escala de nodo separada de los vértices), el arma no debe
 * terminar 100 veces más grande de lo esperado con la cámara del viewmodel
 * literalmente adentro de la malla — el caso real que motivó este código
 * antes de que se corrigiera en el pipeline. Aislar acá, en el borde de
 * carga, además deja al resto del renderer trabajar sobre un único Object3D
 * con transform identidad sin depender de cuántos niveles de jerarquía trae
 * cada GLB.
 */
function resetTransform(mesh: Mesh): void {
  mesh.position.set(0, 0, 0)
  mesh.quaternion.identity()
  mesh.scale.set(1, 1, 1)
  mesh.updateMatrix()
}

/**
 * Las dos piezas que puede traer un GLB de arma. `mag` es null en las 40 CC0
 * (modelos de una sola pieza) y en las armas de Source sin cargador extraíble
 * — revólver y las tres escopetas de bombeo.
 */
interface WeaponParts {
  body: Mesh
  mag: Mesh | null
}

/**
 * Separa el cuerpo del cargador. El cargador se reconoce por el nombre de
 * nodo que le puso el pipeline (`weapon_mag`); el cuerpo es la primera malla
 * que no sea ésa.
 *
 * Se busca por NOMBRE y no por orden ni por cantidad de mallas a propósito:
 * "la segunda malla es el cargador" sería cierto hoy y falso el día que un
 * modelo traiga tres piezas, y fallaría en silencio animando el guardamonte
 * como si fuera un cargador. Un nombre que no está da `mag = null`, que es el
 * camino degradado explícito.
 */
function isolateParts(root: Object3D): WeaponParts | null {
  let body: Mesh | null = null
  let mag: Mesh | null = null

  root.traverse((child) => {
    if (!(child instanceof Mesh)) return
    if (child.name === MAG_NODE_NAME) {
      if (mag === null) mag = child
    } else if (body === null) {
      body = child
    }
  })

  if (body === null) return null

  const foundBody: Mesh = body
  resetTransform(foundBody)
  const foundMag: Mesh | null = mag
  if (foundMag !== null) resetTransform(foundMag)

  return { body: foundBody, mag: foundMag }
}

/**
 * Arma el modelo animado a partir de la escena del GLB, o devuelve null si el
 * GLB no es un viewmodel de Source.
 *
 * Las dos condiciones son necesarias y ninguna alcanza sola: un GLB con
 * esqueleto pero sin clips no tiene nada que reproducir, y uno con clips pero
 * sin skin tendría animación que no mueve ninguna malla. Exigir las dos es lo
 * que hace que un archivo a medio convertir caiga al camino estático (que
 * funciona) en vez de dibujarse quieto y en pose de reposo.
 */
function buildAnimatedModel(scene: Object3D, clips: AnimationClip[] | undefined): AnimatedModel | null {
  // `clips` puede no venir: un GLB sin animaciones deja `gltf.animations` en
  // un array vacío, pero un loader que no sea GLTFLoader —o un doble de test—
  // puede directamente no traer el campo. Sin este guard, leerle `.length`
  // tira TypeError adentro del `.then`, la promesa cae al `.catch` y el arma
  // se reporta como "no se pudo cargar" aunque el GLB esté perfecto. Es
  // exactamente el modo de falla que este archivo ya documenta para
  // requestedSlug/attachedSlug, así que no puede volver a entrar por otra
  // puerta.
  if (!clips || clips.length === 0) return null

  let skinned = false
  let body: Mesh | null = null
  scene.traverse((child) => {
    if (child instanceof SkinnedMesh) skinned = true
    if (child instanceof Mesh && child.name === BODY_NODE_NAME) body = child
    if (child instanceof Mesh) ensureVertexColors(child)
  })
  if (!skinned) return null

  const mixer = new AnimationMixer(scene)
  const actions = new Map<string, AnimationAction>()
  const durations = new Map<string, number>()
  for (const clip of clips) {
    actions.set(clip.name, mixer.clipAction(clip))
    durations.set(clip.name, clip.duration)
  }

  return { scene, mixer, actions, durations, body, current: null }
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

  // magPivot: lo anima el rig (ver el comentario en la interfaz de por qué
  // cuelga de `weapon` y no de modelRoot).
  // magOrient: replica el transform de modelRoot para que el cargador quede
  // orientado y escalado como el cuerpo. Con magPivot en identidad, el
  // cargador cae exactamente donde caería si fuera hijo de modelRoot — o sea,
  // en su asiento del arma. Sin esta capa intermedia habría que elegir entre
  // un cargador bien orientado o un "abajo" que signifique lo mismo en todas
  // las armas, y hacen falta las dos cosas.
  const magPivot = new Group()
  weapon.add(magPivot)
  const magOrient = new Group()
  magPivot.add(magOrient)

  const loader = new GLTFLoader()
  const cache = new Map<string, Mesh>()
  // Cargadores por slug. Una entrada faltante significa "esta arma no tiene
  // cargador separado", que es distinto de "todavía no cargó": eso lo dice
  // `cache`, que es la que siempre tiene entrada para un arma ya cargada.
  const magCache = new Map<string, Mesh>()
  // Viewmodels de Source ya cargados. Una entrada acá y una en `cache` son
  // MUTUAMENTE EXCLUYENTES: un slug es de una familia o de la otra, nunca de
  // las dos. `attach` consulta ésta primero.
  const animCache = new Map<string, AnimatedModel>()
  // Un handle de skin por malla cacheada, creado una sola vez al cargar el
  // GLB: es ahí donde se parcha el shader (skins/material.ts). Volver a un
  // arma ya cargada no recompila nada, sólo vuelve a escribir uniforms.
  const skinHandles = new Map<string, SkinHandle>()
  // El cargador es una malla con su propio material, así que necesita su
  // propio handle: sin esto, equipar una skin pintaría el cuerpo y dejaría el
  // cargador con el aspecto de fábrica, que es de las cosas más visibles que
  // podrían pasar (el cargador está justo en el medio del encuadre).
  const magSkinHandles = new Map<string, SkinHandle>()
  let currentSkin: Skin | null = null
  // requestedSlug: la última arma pedida por setWeaponSlug, gane o pierda su
  // carga. attachedSlug: la última arma efectivamente puesta en modelRoot —
  // render() lee ÉSTA para elegir rotationOffset/scaleAdjust, nunca
  // requestedSlug. Antes había un solo campo (currentSlug) que se movía de
  // inmediato en setWeaponSlug: un load fallido (404, red caída, GLB sin
  // malla) lo dejaba apuntando a un arma sin modelo adjunto mientras el
  // mesh viejo seguía en pantalla, y render() le aplicaba la corrección
  // visual de la arma NUEVA al modelo VIEJO. Separando los dos campos, un
  // load fallido nunca mueve attachedSlug: el modelo viejo se sigue viendo
  // con su propia corrección, coherente, y requestedSlug vuelve a
  // attachedSlug para que un reintento del mismo slug no se descarte por
  // deduplicación (ver setWeaponSlug).
  let requestedSlug: string | null = null
  let attachedSlug: string | null = null
  // Token de carga: si el panel cambia de arma antes de que termine un
  // fetch anterior, la respuesta vieja (éxito o falla) no debe pisar la
  // selección nueva.
  let loadToken = 0
  let lastLoadError: string | null = null

  /**
   * Adjunta un viewmodel de Source. Camino separado del estático a propósito:
   * acá NO se aísla ninguna malla ni se resetea ningún transform, porque el
   * esqueleto vive en esa misma jerarquía y desarmarla rompe el skinning.
   */
  function attachAnimated(slug: string, model: AnimatedModel): void {
    modelRoot.clear()
    modelRoot.add(model.scene)
    // El pivote procedural del cargador se vacía y se deja quieto: en un
    // viewmodel de Source el cargador es un HUESO adentro de la malla del
    // arma, y lo mueve la animación importada. Dejar además el cargador
    // procedural del arma anterior colgando sería un segundo cargador
    // flotando al lado del primero.
    magOrient.clear()

    attachedSlug = slug
    lastLoadError = null
    skinHandles.get(slug)?.setSkin(currentSkin)

    // Reposo: el `idle` de CS es una pose de dos frames, no un ciclo, y es la
    // que deja el arma sostenida como corresponde. Sin esto el arma se dibuja
    // en pose de BIND —el esqueleto sin animar— que en un viewmodel de Source
    // es una pose de referencia con los brazos abiertos, no la de sostener.
    playOn(model, 'idle', 0, true)
  }

  /**
   * Arranca `name` sobre `model`, fundiendo desde lo que estuviera sonando.
   *
   * `seconds <= 0` significa "a velocidad nativa". `loop` distingue el reposo
   * (que se repite indefinidamente) de un gesto que pasa una vez y devuelve la
   * mano al reposo.
   */
  function playOn(model: AnimatedModel, name: string, seconds: number, loop: boolean): boolean {
    const action = model.actions.get(name)
    if (!action) return false

    const nativa = model.durations.get(name) ?? 0
    // timeScale > 1 acelera. Un clip de duración nativa 0 (el `idle` de un
    // solo frame) no se puede reescalar y se deja en 1: dividir daría
    // Infinity y el mezclador se comería la pose.
    action.timeScale = seconds > 0 && nativa > 0 ? nativa / seconds : 1

    action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1)
    // clampWhenFinished deja el último frame congelado en vez de volver de
    // golpe a la pose de bind cuando el clip termina. El retorno al reposo lo
    // hace el fundido de la próxima llamada a playOn, no el mezclador.
    action.clampWhenFinished = !loop

    if (model.current && model.current !== action) {
      model.current.fadeOut(CLIP_BLEND)
      action.reset().setEffectiveWeight(1).fadeIn(CLIP_BLEND).play()
    } else {
      action.reset().setEffectiveWeight(1).play()
    }
    model.current = action
    return true
  }

  function attach(slug: string, mesh: Mesh): void {
    modelRoot.clear()
    modelRoot.add(mesh)

    // El pivote se vacía siempre, tenga cargador el arma nueva o no: si no,
    // cambiar de un AK a un revólver dejaría el cargador del AK flotando al
    // lado del revólver.
    magOrient.clear()
    const mag = magCache.get(slug)
    if (mag) {
      magOrient.add(mag)
      magSkinHandles.get(slug)?.setSkin(currentSkin)
    }

    attachedSlug = slug
    lastLoadError = null
    skinHandles.get(slug)?.setSkin(currentSkin)
  }

  function failLoad(slug: string, message: string, err?: unknown): void {
    if (err === undefined) console.error(message)
    else console.error(message, err)
    lastLoadError = message
    // Deshace el pedido: sin esto requestedSlug queda apuntando a `slug`
    // (sin malla adjunta) y render() le aplicaría su rotationOffset /
    // scaleAdjust al modelo de attachedSlug, que es el que en realidad
    // sigue en pantalla.
    requestedSlug = attachedSlug
  }

  function load(slug: string): void {
    const token = ++loadToken
    loader
      .loadAsync(weaponAssetUrl(slug))
      .then((gltf) => {
        if (token !== loadToken) return

        // Los viewmodels de Source se detectan por lo que traen adentro, no
        // por lo que dice el índice (ver `animated` en la interfaz). Si no son
        // uno, sigue el camino estático de siempre sin enterarse de nada.
        const animated = buildAnimatedModel(gltf.scene, gltf.animations)
        if (animated) {
          if (animated.body) {
            const handle = createSkinHandle(animated.body)
            if (handle) skinHandles.set(slug, handle)
          }
          animCache.set(slug, animated)
          if (requestedSlug === slug) attachAnimated(slug, animated)
          return
        }

        const parts = isolateParts(gltf.scene)
        if (!parts) {
          if (requestedSlug === slug) {
            failLoad(slug, `viewmodel: "${slug}.glb" no tiene ninguna malla`)
          }
          return
        }
        ensureVertexColors(parts.body)
        const handle = createSkinHandle(parts.body)
        if (handle) skinHandles.set(slug, handle)
        cache.set(slug, parts.body)

        if (parts.mag) {
          ensureVertexColors(parts.mag)
          const magHandle = createSkinHandle(parts.mag)
          if (magHandle) magSkinHandles.set(slug, magHandle)
          magCache.set(slug, parts.mag)
        }

        if (requestedSlug === slug) attach(slug, parts.body)
      })
      .catch((err: unknown) => {
        if (token !== loadToken) return
        if (requestedSlug === slug) failLoad(slug, `viewmodel: no se pudo cargar "${slug}"`, err)
      })
  }

  return {
    weapon,
    magPivot,

    setWeaponSlug(slug: string): void {
      if (slug === requestedSlug) return
      requestedSlug = slug
      const animated = animCache.get(slug)
      if (animated) {
        attachAnimated(slug, animated)
        return
      }
      const cached = cache.get(slug)
      if (cached) attach(slug, cached)
      else load(slug)
    },

    playClip(name: string, seconds: number): boolean {
      if (attachedSlug === null) return false
      const model = animCache.get(attachedSlug)
      if (!model) return false
      // Todo lo que no sea el reposo pasa una vez y vuelve: una recarga que se
      // repitiera en bucle sería peor que no tener animación.
      return playOn(model, name, seconds, name === 'idle')
    },

    advanceAnimation(dt: number): void {
      if (attachedSlug === null) return
      const model = animCache.get(attachedSlug)
      if (!model) return
      model.mixer.update(dt)
      // Cuando el gesto de una vez termina, la mano vuelve al reposo. Se
      // detecta por el tiempo del propio clip y no con el evento 'finished'
      // del mezclador a propósito: el listener obligaría a registrar y
      // desregistrar una función por arma equipada, y este chequeo es una
      // comparación de números que no asigna nada.
      const current = model.current
      if (current && current.loop === LoopOnce && !current.isRunning()) {
        playOn(model, 'idle', 0, true)
      }
    },

    setSkin(skin: Skin | null): void {
      currentSkin = skin
      if (attachedSlug) skinHandles.get(attachedSlug)?.setSkin(skin)
    },

    render(worldCamera: PerspectiveCamera, timeSeconds = 0): void {
      camera.rotation.copy(worldCamera.rotation)

      if (attachedSlug) {
        // Único trabajo por frame de todo el sistema de skins: escribir un
        // número en un uniform ya existente.
        skinHandles.get(attachedSlug)?.setTime(timeSeconds)
        magSkinHandles.get(attachedSlug)?.setTime(timeSeconds)
        const visual = getWeaponVisual(attachedSlug)
        // La rotación base de los `v_` se SUMA al ajuste fino del arma en vez
        // de reemplazarlo: `rotationOffset` sigue siendo lo que mueve el panel
        // de tuning, y arranca en cero, así que sin tocar nada el arma queda
        // exactamente en la orientación que le da la constante.
        const yaw = animCache.has(attachedSlug) ? SOURCE_VIEWMODEL_YAW : 0
        modelRoot.rotation.set(
          visual.rotationOffset.rx,
          visual.rotationOffset.ry + yaw,
          visual.rotationOffset.rz,
        )
        modelRoot.scale.setScalar(visual.scaleAdjust)
        // magOrient copia a modelRoot: los dos tienen que moverse juntos o el
        // cargador se despega del arma en cuanto el panel de tuning toque
        // rotationOffset o scaleAdjust.
        magOrient.rotation.copy(modelRoot.rotation)
        magOrient.scale.copy(modelRoot.scale)
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
      for (const mesh of magCache.values()) disposeModel(mesh)
      for (const model of animCache.values()) {
        model.mixer.stopAllAction()
        model.mixer.uncacheRoot(model.scene)
        model.scene.traverse((child) => {
          if (child instanceof Mesh) disposeModel(child)
        })
      }
      cache.clear()
      magCache.clear()
      animCache.clear()
      skinHandles.clear()
      magSkinHandles.clear()
    },

    get attachedSlug(): string | null {
      return attachedSlug
    },

    get animated(): boolean {
      return attachedSlug !== null && animCache.has(attachedSlug)
    },

    /**
     * Falso en los viewmodels de Source aunque el arma tenga cargador: acá el
     * cargador es un HUESO que mueve la animación importada, no una malla que
     * mueva el pivote procedural. Devolver true haría que game.ts anime un
     * cargador que no existe como objeto, encima del que sí se está moviendo.
     */
    get hasMagazine(): boolean {
      return (
        attachedSlug !== null && magCache.has(attachedSlug) && !animCache.has(attachedSlug)
      )
    },

    get lastLoadError(): string | null {
      return lastLoadError
    },
  }
}
