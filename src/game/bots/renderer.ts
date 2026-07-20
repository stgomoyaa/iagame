/**
 * Malla visual de los bots: personajes rigged de Quaternius (Ultimate
 * Modular Men, CC0) animados con los clips del mismo pack, en vez de las
 * cápsulas de relleno de la fase 2.
 *
 * Uno de los archivos de src/game autorizados a importar three (ver
 * architecture.test.ts), junto con engine/renderer.ts, map/mesh.ts,
 * weapons/viewmodel/renderer.ts, combat/hitscan.ts, targets/renderer.ts y
 * bots/character-material.ts -- la lógica de bots (bots/bot.ts) es
 * matemática pura y esto es el único punto de contacto con la escena.
 *
 * LA ANIMACIÓN NO MANDA. La simulación es autoritativa: acá sólo se LEE el
 * estado que el cerebro ya calculó (bots/fsm.ts + la velocidad real que
 * stepPlayer dejó en player.velocity) y se elige un clip. Ningún clip mueve
 * al bot, decide cuándo dispara ni cuándo muere; se usa el GLB sin root
 * motion (no el _RM del pack) justamente por eso.
 *
 * Presupuesto. Un AnimationMixer por bot es el costo de CPU más alto de la
 * escena, y estaba marcado como el riesgo principal desde el spec. Tres
 * mitigaciones, en orden de impacto:
 *
 *   1. Esqueleto de 24 huesos, no 62: el pipeline poda los dedos
 *      (scripts/convert-characters.ts). Menos huesos = menos matrices por
 *      frame Y menos pistas por clip, que es lo que realmente cuesta en el
 *      mixer.
 *   2. Los clips se cargan UNA vez y se comparten entre los bots
 *      (AnimationClip es inmutable; lo que es por-bot es el mixer).
 *   3. Los mixers lejanos se actualizan a menor frecuencia (ver
 *      DISTANCIA_THROTTLE_M): a 22 m nadie ve que una pierna interpola a 15
 *      Hz en vez de a 120, pero el ahorro es proporcional a los bots que
 *      están lejos, que en una arena de 60x60 son casi siempre la mayoría.
 *
 * Cero asignaciones por frame: todo (mallas, mixers, acciones, materiales)
 * se crea al cargar; sync() sólo muta objetos que ya existen.
 */

import {
  AnimationMixer,
  type AnimationAction,
  type AnimationClip,
  Bone,
  Group,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  type Object3D,
  type Scene,
  type SkinnedMesh,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { BotState } from '@/game/bots/bot'
import { createCharacterMaterial } from '@/game/bots/character-material'
import { BOTS } from '@/game/bots/tuning'

const RUTA_ASSETS = '/assets/characters'
const PERSONAJES = ['swat', 'suit', 'punk', 'worker'] as const

/**
 * Nombres candidatos del hueso de columna (torso medio/bajo) y de pecho
 * (torso alto), en orden de preferencia. Verificado con
 * @gltf-transform/core sobre los cuatro GLB (swat/suit/punk/worker, ver
 * scripts/convert-characters.ts): los cuatro comparten exactamente el mismo
 * esqueleto de 24 huesos y usan 'Torso'/'Chest'. La lista con más de un
 * candidato es la red de seguridad para el día que se agregue un personaje
 * con otro esqueleto (Mixamo, por ejemplo, nombra 'Spine'/'Spine1'/'Spine2').
 * Si ninguno matchea, resolverHueso() revienta la carga: un fallback
 * silencioso acá se ve EXACTAMENTE igual al bug que esta tarea vino a
 * arreglar (torso que no sigue el apuntado), así que no hay margen para
 * degradar callado.
 */
const HUESO_COLUMNA_CANDIDATOS = ['Torso', 'Spine1', 'Spine'] as const
const HUESO_PECHO_CANDIDATOS = ['Chest', 'Spine2', 'UpperChest'] as const

/**
 * Tope (asimétrico -- ver por qué abajo) y reparto de la inclinación de
 * torso que sigue al pitch del apuntado (aplicarInclinacionTorso). Medido
 * en vivo contra el pipeline REAL, no calculado aparte:
 *
 * El primer intento derivó el tope con un script de forward-kinematics
 * aislado sobre la pose de BIND (Root->Body->Hips->Abdomen->Torso->Chest->
 * Neck->Head, @gltf-transform/core + three.Object3D) y daba ~28° antes de
 * que la cabeza dibujada saliera de su hitbox (BOTS.headOffsetY=1.66,
 * headRadius=0.16, hitbox FIJA que no seguía el doblez). Ese número
 * resultó ESTAR MAL: la pose de BIND no es la pose real. Idle_Gun (el clip
 * que corre mientras el bot está quieto apuntando -- justo cuando esto
 * importa) ya trae a Torso/Chest con una inclinación hacia adelante propia
 * de la postura "listo para disparar", así que la pose de la que arranca
 * el doblez NO es la vertical de bind. Midiendo de verdad (bots/renderer.ts
 * corriendo en el navegador, boneWorldPos sobre el hueso Head real, pitch
 * fijo por varios frames para que se asiente) el resultado es asimétrico:
 *
 *   pitch (grados)   desplazamiento lateral de Head   vs headRadius=0.16
 *   0 (sin doblez)    0.089 m  (YA una fracción del radio -- Idle_Gun
 *                               solo, nada de esto es por el fix)
 *   -6  (abajo)       0.138 m
 *   -7  (abajo)       0.147 m
 *   -8  (abajo)       0.157 m
 *   -10 (abajo)       0.173 m  -- primer punto medido que YA excede headRadius
 *   +10 (arriba)      0.025 m  (arriba primero CANCELA la inclinación
 *                               propia de Idle_Gun antes de abrirse de nuevo)
 *   +24 (arriba)      0.121 m
 *   +40 (arriba)      0.123 m  (satura -- geometría de arco, no crece más)
 *
 * "Abajo" (mirar hacia el piso) SUMA sobre la inclinación que Idle_Gun ya
 * trae; "arriba" primero la cancela. Por eso el tope no puede ser un solo
 * número: 24° hacia abajo da 0.28 m de separación real (78% más que el
 * radio de la hitbox, una regresión real -- el jugador le dispararía a una
 * cabeza que ya no está ahí), pero 24° hacia arriba deja 0.121 m, cómodo
 * bajo el radio.
 *
 * INCLINACION_TORSO_MAX_ABAJO_RAD = 6°: por debajo del cruce medido
 * (~8.4°, interpolando la tabla de arriba) con margen para el vaivén
 * propio de Gun_Shoot (que también mueve Torso/Chest un poco solo).
 * INCLINACION_TORSO_MAX_ARRIBA_RAD = 24°: se queda igual que el primer
 * intento -- no porque el cálculo original fuera correcto (no lo era), sino
 * porque la medición real confirma que 24° hacia arriba SÍ es seguro, y es
 * además un tope razonable de plausibilidad de silueta (un arqueo de
 * espalda más allá de eso empieza a leerse raro aunque la hitbox lo tolere).
 *
 * El reparto 60/40 (columna/pecho) imita que la zona lumbar/media de la
 * espalda es la más móvil al flexionar; el pecho, encajonado por las
 * costillas, aporta menos por sí solo -- el mismo criterio que separa
 * "doblar desde la cintura" de "doblar desde el pecho" en un cuerpo real.
 */
const INCLINACION_TORSO_MAX_ARRIBA_RAD = MathUtils.degToRad(24)
const INCLINACION_TORSO_MAX_ABAJO_RAD = MathUtils.degToRad(6)
const REPARTO_COLUMNA = 0.6

/** Eje local sobre el que se inclinan los proxies de columna/pecho (ver
 *  insertarProxyRotacion). Constante de módulo reusada en vez de crear un
 *  Vector3 nuevo cada vez que aplicarInclinacionTorso llama
 *  setFromAxisAngle -- cero asignaciones por frame. */
const EJE_X = new Vector3(1, 0, 0)

/** Clips que el renderer sabe pedir. Los nombres son los del GLB. */
type NombreClip = 'Idle_Gun' | 'Run' | 'Walk' | 'Death' | 'Gun_Shoot'

/** Umbrales de velocidad horizontal (m/s) para elegir entre quieto, caminar
 *  y correr. Salen de la velocidad real que produce stepPlayer, no de un
 *  tanteo visual. */
const VELOCIDAD_CAMINA = 0.35
const VELOCIDAD_CORRE = 3.2

/** Metros a partir de los cuales el mixer de un bot baja a MIXER_HZ_LEJOS. */
const DISTANCIA_THROTTLE_M = 22
const MIXER_HZ_LEJOS = 15

/** Segundos de mezcla entre clips. Corto: un bot que arranca a correr tiene
 *  que verse corriendo ya, no medio segundo después. */
const FUNDIDO_S = 0.12

interface BotVisual {
  raiz: Group
  mixer: AnimationMixer
  acciones: Map<NombreClip, AnimationAction>
  actual: NombreClip | null
  /** Acumulador del throttle por distancia. */
  acumuladoS: number
  muerto: boolean
  /** Proxies de rotación insertados sobre columna y pecho -- ver
   *  insertarProxyRotacion() y el comentario de aplicarInclinacionTorso()
   *  sobre por qué esto NO son Torso/Chest directamente. Resueltos una vez
   *  al cargar, no en sync(): cada bot tiene su propio clon del esqueleto. */
  columnaProxy: Bone
  pechoProxy: Bone
}

/**
 * Busca en `raiz` (ya clonada para este bot) el primer hueso cuyo nombre
 * matchea alguno de `candidatos`, en orden. Revienta con un mensaje
 * explícito si ninguno aparece -- ver el comentario de
 * HUESO_COLUMNA_CANDIDATOS sobre por qué esto no puede degradar en
 * silencio.
 */
function resolverHueso(
  raiz: Object3D,
  candidatos: readonly string[],
  rol: string,
  personaje: string,
): Object3D {
  for (const nombre of candidatos) {
    const hueso = raiz.getObjectByName(nombre)
    if (hueso !== undefined) return hueso
  }
  throw new Error(
    `bots/renderer: no encontré el hueso de ${rol} en ${personaje}.glb ` +
      `(probé: ${candidatos.join(', ')}). El pitch del apuntado no tiene ` +
      `dónde aplicarse -- revisar el esqueleto del GLB.`,
  )
}

/**
 * Inserta un Bone "proxy" de transform IDENTIDAD entre `hueso` y su padre
 * actual, y devuelve el proxy. `hueso` pasa a ser hijo del proxy en vez de
 * su padre original; como el proxy arranca en identidad, la pose visible no
 * cambia ni un milímetro en el momento de insertarlo.
 *
 * Por qué hace falta (ver aplicarInclinacionTorso): AnimationMixer.update()
 * NO reescribe un hueso animado cada frame -- three.js compara el valor
 * recién interpolado contra el de dos frames atrás (PropertyMixer.apply(),
 * node_modules/three/src/animation/PropertyMixer.js) y sólo llama
 * binding.setValue() si CAMBIÓ. El track de Torso en Idle_Gun es constante
 * (2 keyframes idénticos, es la pose de pie quieto): a partir del segundo
 * frame el mixer deja de tocarlo del todo, así que rotar Torso directamente
 * cada frame (aunque sea "una vez por cada mixer.update() real") compone
 * sobre la rotación que UNO MISMO le dejó el frame anterior -- no sobre la
 * pose de la animación -- y el torso se dobla sin límite en segundos. Medido
 * en el navegador: Torso.rotation.x crecía monótono frame a frame con el
 * pitch fijo (0.47, 0.74, 0.99, 1.23... rad) mientras Chest (cuyo track SÍ
 * varía un poco en Idle_Gun) se mantenía estable.
 *
 * El proxy resuelve esto por construcción, no por disciplina de llamado: no
 * aparece en ningún track del GLB (se crea acá, no existe en el archivo),
 * así que el mixer JAMÁS lo toca. Cada frame se puede ASIGNAR (no componer)
 * su rotación desde cero con el pitch actual, sin depender de si el mixer
 * escribió algo o no. El skinning sigue viendo a Torso/Chest por referencia
 * (matrixWorld) sin tocar skeleton.bones ni los índices de skinning: un
 * padre intermedio los mueve igual.
 */
function insertarProxyRotacion(hueso: Object3D, personaje: string, rol: string): Bone {
  const padre = hueso.parent
  if (padre === null) {
    throw new Error(
      `bots/renderer: el hueso de ${rol} en ${personaje}.glb no tiene padre -- ` +
        `no se puede insertar el proxy de rotación del pitch de apuntado.`,
    )
  }
  const proxy = new Bone()
  padre.add(proxy)
  proxy.add(hueso)
  return proxy
}

export interface BotsRenderer {
  /** Sincroniza posición, orientación, animación y visibilidad de cada bot
   *  con su estado real. Llamar una vez por frame, después de
   *  stepAllBotsMotor(). `camaraX/Z` es desde dónde se mide la distancia
   *  para el throttle de mixers. */
  sync(bots: readonly BotState[], dt: number, camaraX: number, camaraZ: number): void
  /** ¿Ya cargaron los modelos? Antes de esto sync() no dibuja nada. */
  readonly listo: boolean
  dispose(): void
}

/**
 * Elige el clip que corresponde al estado que la simulación ya calculó.
 * Función pura de (vida, velocidad, disparando) -> clip: no tiene memoria
 * propia ni puede contradecir a la FSM.
 *
 * `Idle_Gun` y no `Idle` para todo lo quieto: el bot siempre está armado, y
 * un bot en Rotar o Idle con el arma baja se lee como que no te vio aunque
 * te esté apuntando.
 */
export function clipPara(vivo: boolean, velocidad: number, disparando: boolean): NombreClip {
  if (!vivo) return 'Death'
  if (velocidad >= VELOCIDAD_CORRE) return 'Run'
  if (velocidad >= VELOCIDAD_CAMINA) return 'Walk'
  return disparando ? 'Gun_Shoot' : 'Idle_Gun'
}

export function createBotsRenderer(
  scene: Scene,
  bots: readonly BotState[],
  botTeams: readonly number[],
): BotsRenderer {
  const grupo = new Group()
  scene.add(grupo)

  const visuales: BotVisual[] = []
  const materiales = new Map<number, ReturnType<typeof createCharacterMaterial>>()
  let listo = false

  const loader = new GLTFLoader()

  function materialDe(team: number): ReturnType<typeof createCharacterMaterial> {
    let m = materiales.get(team)
    if (m === undefined) {
      m = createCharacterMaterial(team)
      materiales.set(team, m)
    }
    return m
  }

  async function cargar(): Promise<void> {
    const [animGltf, ...personajes] = await Promise.all([
      loader.loadAsync(`${RUTA_ASSETS}/animations.glb`),
      ...PERSONAJES.map((p) => loader.loadAsync(`${RUTA_ASSETS}/${p}.glb`)),
    ])

    // Clips compartidos por TODOS los bots: los cuatro personajes usan los
    // mismos nombres de hueso, así que un solo juego de clips los mueve a
    // todos. AnimationClip no guarda estado de reproducción (eso vive en la
    // AnimationAction, que sí es por bot), por eso se puede compartir.
    const clips = new Map<NombreClip, AnimationClip>()
    for (const clip of animGltf.animations) clips.set(clip.name as NombreClip, clip)

    for (let i = 0; i < bots.length; i++) {
      const nombrePersonaje = PERSONAJES[i % PERSONAJES.length]
      const plantilla = personajes[i % personajes.length].scene
      const raiz = cloneSkeleton(plantilla) as Group
      raiz.scale.setScalar(BOTS.modelScale)

      // Se resuelven UNA vez acá, sobre el clon de ESTE bot -- cada bot
      // tiene su propio esqueleto (cloneSkeleton), así que no se pueden
      // compartir referencias entre bots como sí se comparten los clips.
      // Los proxies se insertan ANTES de que el mixer exista (más abajo):
      // no hay ninguna pose animada todavía que puedan pisar.
      const columna = resolverHueso(raiz, HUESO_COLUMNA_CANDIDATOS, 'columna', nombrePersonaje)
      const pecho = resolverHueso(raiz, HUESO_PECHO_CANDIDATOS, 'pecho', nombrePersonaje)
      const columnaProxy = insertarProxyRotacion(columna, nombrePersonaje, 'columna')
      const pechoProxy = insertarProxyRotacion(pecho, nombrePersonaje, 'pecho')

      const material = materialDe(botTeams[i] ?? 0)
      raiz.traverse((obj: Object3D) => {
        const malla = obj as SkinnedMesh
        if (malla.isSkinnedMesh === true) {
          malla.material = material
          // El personaje ya está en su sitio por el transform del grupo; sin
          // esto three lo saltea del render cuando el bounding sphere del
          // bind pose queda fuera del frustum aunque el bot no lo esté.
          malla.frustumCulled = false
        }
      })

      const mixer = new AnimationMixer(raiz)
      const acciones = new Map<NombreClip, AnimationAction>()
      for (const [nombre, clip] of clips) {
        const accion = mixer.clipAction(clip)
        if (nombre === 'Death' || nombre === 'Gun_Shoot') {
          accion.setLoop(LoopOnce, 1)
          accion.clampWhenFinished = true
        } else {
          accion.setLoop(LoopRepeat, Infinity)
        }
        acciones.set(nombre, accion)
      }

      grupo.add(raiz)
      visuales.push({
        raiz,
        mixer,
        acciones,
        actual: null,
        acumuladoS: 0,
        muerto: false,
        columnaProxy,
        pechoProxy,
      })
    }

    listo = true
  }

  void cargar()

  function reproducir(v: BotVisual, nombre: NombreClip): void {
    if (v.actual === nombre) return
    const siguiente = v.acciones.get(nombre)
    if (siguiente === undefined) return
    const anterior = v.actual !== null ? v.acciones.get(v.actual) : undefined

    siguiente.reset()
    siguiente.enabled = true
    siguiente.setEffectiveWeight(1)
    if (anterior !== undefined) siguiente.crossFadeFrom(anterior, FUNDIDO_S, false)
    siguiente.play()
    v.actual = nombre
  }

  /**
   * Inclina columna y pecho para que el torso siga el pitch del apuntado --
   * sin esto, un bot que dispara desde arriba (o desde abajo) apunta con la
   * cabeza horizontal y el arma paralela al piso, la señal más clara de que
   * es un bot y no un jugador. La raíz (v.raiz.rotation.y, más abajo en
   * sync()) se queda en sólo-yaw a propósito: rotarla inclinaría también
   * las piernas, que tienen que seguir verticales con los pies en el piso.
   *
   * Se ASIGNA (setFromAxisAngle) la rotación del proxy en vez de componerla
   * -- a diferencia de rotar Torso/Chest directamente, acá no hace falta
   * "sumar sobre la pose de la animación" porque el proxy NO TIENE pose de
   * animación: el mixer nunca lo toca (ver insertarProxyRotacion). Asignar
   * desde cero cada vez es, de hecho, lo que evita que se componga solo --
   * cada llamada parte de identidad, nunca del resultado de la llamada
   * anterior. Por eso también se puede llamar TODOS los frames sin
   * importar si el mixer de este bot actualizó o está throttleado (ver
   * sync() más abajo): no hay invariante de "una sola vez por update" que
   * mantener.
   *
   * Eje y signo, verificados en el navegador con boneWorldPos() sobre el
   * hueso Head real (no a ojo ni con un script aislado -- un primer intento
   * con forward-kinematics sobre la pose de BIND predijo el signo
   * CONTRARIO al que resultó ser correcto una vez medido contra la pose
   * ANIMADA real; ver la tabla de INCLINACION_TORSO_MAX_ARRIBA_RAD): con
   * v.raiz.rotation.y en 0 (personaje mirando -Z en mundo), rotar el proxy
   * -X sobre EJE_X sube la cabeza (arquea atrás/arriba); +X la baja
   * (encorva adelante/abajo). pitch > 0 es "mirando arriba" (aim.ts lookAt:
   * atan2(dy, horizontal), dy>0 si el objetivo está más alto que el ojo),
   * así que el ángulo aplicado es -pitch (acotado).
   *
   * El acotado es ASIMÉTRICO -- ver la tabla de arriba sobre por qué "abajo"
   * y "arriba" no tienen el mismo margen antes de separar la cabeza
   * dibujada de su hitbox.
   *
   * Pendiente de medir, no de arreglar acá: el margen de
   * INCLINACION_TORSO_MAX_ABAJO_RAD (6°) sobre el cruce medido (~8.4°) da
   * lugar para el vaivén propio de Gun_Shoot, pero no se midió el PEOR CASO
   * exacto (pico de recoil de Gun_Shoot + apuntado al tope hacia abajo, a
   * través del proxy) -- requeriría leer la pose post-mixer antes de
   * decidir el ángulo, no sólo acotarlo. Con el margen medido (0.16 - 0.138
   * a 6° = 0.022 m, un 14% del radio) es improbable que el vaivén de
   * Gun_Shoot lo agote entero, pero "improbable" no es "medido".
   */
  function aplicarInclinacionTorso(v: BotVisual, pitch: number): void {
    const acotado = Math.max(
      -INCLINACION_TORSO_MAX_ABAJO_RAD,
      Math.min(INCLINACION_TORSO_MAX_ARRIBA_RAD, pitch),
    )
    const angulo = -acotado
    v.columnaProxy.quaternion.setFromAxisAngle(EJE_X, angulo * REPARTO_COLUMNA)
    v.pechoProxy.quaternion.setFromAxisAngle(EJE_X, angulo * (1 - REPARTO_COLUMNA))
  }

  return {
    get listo(): boolean {
      return listo
    },

    sync(current: readonly BotState[], dt: number, camaraX: number, camaraZ: number): void {
      if (!listo) return
      const n = Math.min(current.length, visuales.length)

      for (let i = 0; i < n; i++) {
        const bot = current[i]
        const v = visuales[i]
        const vivo = bot.health.alive

        // Un bot muerto sigue VISIBLE mientras dura su clip de muerte: si
        // desapareciera al llegar a 0 de vida, el jugador no tendría cómo
        // saber que le acertó -- el cuerpo cayendo es la única confirmación
        // a distancia. La hitbox ya está en radio 0 desde syncBotHitboxes(),
        // así que un cadáver visible no se puede volver a impactar.
        v.raiz.visible = true

        const p = bot.player.position
        v.raiz.position.set(p.x, p.y, p.z)
        // Sólo yaw acá. El pitch del apuntado NO rota la raíz: rotarla
        // entera inclinaría también las piernas y el bot quedaría flotando
        // inclinado como una tabla en vez de doblado desde la cintura. El
        // pitch se aplica más abajo, a nivel de hueso (columna/pecho, ver
        // aplicarInclinacionTorso), después de que el mixer actualice.
        // +PI porque el personaje del pack mira a +Z y el yaw del juego
        // toma -Z como frente (misma convención que la cámara).
        v.raiz.rotation.y = bot.aimMotor.yaw + Math.PI

        const vel = bot.player.velocity
        // Velocidad HORIZONTAL: la vertical (caer, saltar) no debe disparar
        // la animación de correr.
        const velocidad = Math.sqrt(vel.x * vel.x + vel.z * vel.z)
        const clip = clipPara(vivo, velocidad, bot.combatInput.triggerHeld)

        // Al revivir hay que rearmar el clip de muerte, que quedó clampeado
        // en su último frame.
        if (v.muerto && vivo) {
          const death = v.acciones.get('Death')
          if (death !== undefined) death.stop()
          v.actual = null
        }
        v.muerto = !vivo

        reproducir(v, clip)

        // Throttle por distancia: los bots lejos actualizan su mixer a
        // MIXER_HZ_LEJOS acumulando dt, no cada frame. El dt acumulado se
        // entrega entero, así que la animación avanza a la velocidad
        // correcta -- baja la RESOLUCIÓN temporal, no el tiempo.
        const dx = p.x - camaraX
        const dz = p.z - camaraZ
        const lejos = dx * dx + dz * dz > DISTANCIA_THROTTLE_M * DISTANCIA_THROTTLE_M
        if (lejos) {
          v.acumuladoS += dt
          if (v.acumuladoS >= 1 / MIXER_HZ_LEJOS) {
            v.mixer.update(v.acumuladoS)
            v.acumuladoS = 0
          }
        } else {
          if (v.acumuladoS > 0) {
            v.mixer.update(v.acumuladoS)
            v.acumuladoS = 0
          }
          v.mixer.update(dt)
        }

        // Independiente del throttle de arriba: el proxy de inclinación no
        // tiene pose de animación que preservar (ver aplicarInclinacionTorso),
        // así que seguir el pitch no necesita sincronizarse con cuándo
        // corrió el mixer.
        if (vivo) aplicarInclinacionTorso(v, bot.aimMotor.pitch)
      }

      for (let i = n; i < visuales.length; i++) visuales[i].raiz.visible = false
    },

    dispose(): void {
      for (const v of visuales) {
        v.mixer.stopAllAction()
        v.raiz.traverse((obj: Object3D) => {
          const malla = obj as SkinnedMesh
          if (malla.isSkinnedMesh === true) malla.geometry.dispose()
        })
      }
      for (const m of materiales.values()) m.dispose()
      scene.remove(grupo)
    },
  }
}
