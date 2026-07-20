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
  Group,
  LoopOnce,
  LoopRepeat,
  type Object3D,
  type Scene,
  type SkinnedMesh,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { BotState } from '@/game/bots/bot'
import { createCharacterMaterial } from '@/game/bots/character-material'
import { BOTS } from '@/game/bots/tuning'

const RUTA_ASSETS = '/assets/characters'
const PERSONAJES = ['swat', 'suit', 'punk', 'worker'] as const

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
      const plantilla = personajes[i % personajes.length].scene
      const raiz = cloneSkeleton(plantilla) as Group
      raiz.scale.setScalar(BOTS.modelScale)

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
      visuales.push({ raiz, mixer, acciones, actual: null, acumuladoS: 0, muerto: false })
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
        // Sólo yaw. El pitch del apuntado no rota el cuerpo: un bot mirando
        // al piso inclinaría el modelo entero y se vería caído.
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
