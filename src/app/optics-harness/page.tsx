'use client'

/**
 * Banco de pruebas VISUAL del sistema de ópticas (fase cosmética de
 * accesorios). NO es parte del juego: es la pantalla contra la que se sacan las
 * capturas del entregable (un arma de COD con una óptica montada en el riel y
 * su punto rojo visible).
 *
 * Usa el MISMO `montarOptica` (attachments/mount.ts) que el renderer del juego,
 * así que lo que se ve acá es exactamente la malla + retícula que se vería
 * equipada. La diferencia con el viewmodel real es que acá NO se injertan
 * brazos: el arma se muestra sola, para que se vea sin estorbo si la mira está
 * bien asentada sobre el riel.
 *
 * Se maneja desde afuera por `window.__opticsHarness`, que el script de
 * capturas (scripts/capturar-opticas.mjs) llama por CDP: elige arma + óptica y
 * puede pasar overrides de ancla/lente para AFINAR a ojo sin recompilar.
 *
 * Sortea las dos trampas del proyecto (AGENTS.md): se navega a `localhost` (no
 * `127.0.0.1`) y no se toca pointer lock.
 */

import { useEffect, useRef } from 'react'
import {
  ACESFilmicToneMapping,
  Group,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { instalarRigDeLuz } from '@/game/weapons/viewmodel/lighting'
import {
  anclaDe,
  opticaDef,
  type AnclaOptica,
  type OpticaId,
} from '@/game/weapons/attachments/optics-catalog'
import {
  desmontarFuenteOptica,
  desmontarOptica,
  montarOptica,
} from '@/game/weapons/attachments/mount'

/** Overrides opcionales para afinar el ancla/lente en vivo desde el script. */
interface Overrides {
  pos?: [number, number, number]
  rot?: [number, number, number]
  escala?: number
  lente?: [number, number, number]
  /** Oculta el arma para ver la óptica sola (debug de escala). */
  soloOptica?: boolean
  /** Pose de cámara: dónde se para y hacia dónde mira (espacio del arma). */
  camPos?: [number, number, number]
  camTarget?: [number, number, number]
  /** Ángulo fijo del pivote (rad). Sin esto queda en el perfil de referencia. */
  giro?: number
}

declare global {
  interface Window {
    __opticsHarness?: {
      mostrar: (weaponSlug: string, opticId: OpticaId, ov?: Overrides) => Promise<void>
      drawCalls: () => number
      error: () => string | null
      listo: () => boolean
    }
  }
}

const URL_ASSET = (slug: string): string => `/assets/weapons-local/${slug}.glb`

export default function OpticsHarnessPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearAlpha(0)
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 2.5

    const scene = new Scene()
    const camera = new PerspectiveCamera(35, 1, 0.01, 100)
    // Vista 3/4 trasera-alta por defecto: se para atrás y a un lado del arma
    // (lado del tirador, +Z) y mira hacia adelante-abajo. Es el único ángulo
    // que muestra a la vez la mira ASENTADA sobre el riel y el punto rojo, que
    // apunta al tirador (+Z). Un perfil puro dejaría la retícula de canto.
    camera.position.set(0.28, 0.26, 0.34)
    camera.lookAt(0, 0.07, -0.02)
    scene.add(camera)

    const rig = instalarRigDeLuz(scene, camera, renderer)

    // Pivote del arma: se hace girar lento para ver la óptica desde varios
    // ángulos y confirmar que está asentada, no flotando.
    const pivote = new Group()
    scene.add(pivote)

    const loader = new GLTFLoader()
    // Caché de escenas fuente de óptica por id: se clonan por montaje (la
    // geometría se comparte) y se liberan una sola vez al desmontar la página.
    const opticaFuentes = new Map<string, Group>()
    let opticaMontada: Group | null = null
    let armaScene: Group | null = null
    let drawCalls = 0
    let lastError: string | null = null
    let cargando = false

    // Arrow (no declaración): definida DESPUÉS del guard `if (!canvas) return`,
    // conserva el estrechamiento a no-null que una función hoisteada perdería.
    const resize = (): void => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    const animar = (): void => {
      raf = requestAnimationFrame(animar)
      // Sin rotación automática: para la captura del entregable el pose tiene
      // que ser REPRODUCIBLE. El ángulo se fija por escena (`giro`), no oscila.
      renderer.info.reset()
      renderer.render(scene, camera)
      drawCalls = renderer.info.render.calls
    }
    animar()

    async function mostrar(weaponSlug: string, opticId: OpticaId, ov?: Overrides): Promise<void> {
      if (cargando) return
      cargando = true
      lastError = null
      try {
        // Limpia lo anterior.
        pivote.clear()
        if (opticaMontada) {
          desmontarOptica(opticaMontada)
          opticaMontada = null
        }

        const def = opticaDef(opticId)
        const anclaBase = anclaDe(weaponSlug)
        if (!anclaBase && !ov?.pos) {
          throw new Error(`sin ancla para ${weaponSlug} (pasá overrides.pos para probar)`)
        }
        const ancla: AnclaOptica = {
          pos: ov?.pos ?? anclaBase!.pos,
          rot: ov?.rot ?? anclaBase?.rot ?? [0, Math.PI / 2, 0],
          escala: ov?.escala ?? anclaBase?.escala ?? 1,
        }
        const defFinal = ov?.lente ? { ...def, lente: ov.lente } : def

        // Pose de cámara / pivote por escena.
        pivote.rotation.y = ov?.giro ?? 0
        if (ov?.camPos) camera.position.set(ov.camPos[0], ov.camPos[1], ov.camPos[2])
        const tgt = ov?.camTarget ?? [0, 0.07, -0.02]
        camera.lookAt(tgt[0], tgt[1], tgt[2])

        let fuente = opticaFuentes.get(def.glbSlug)
        const armaGltf = await loader.loadAsync(URL_ASSET(weaponSlug))
        if (!fuente) {
          const opticaGltf = await loader.loadAsync(URL_ASSET(def.glbSlug))
          fuente = opticaGltf.scene as unknown as Group
          opticaFuentes.set(def.glbSlug, fuente)
        }

        armaScene = armaGltf.scene as unknown as Group
        if (!ov?.soloOptica) pivote.add(armaScene)

        opticaMontada = montarOptica({
          opticaScene: cloneSkinned(fuente),
          def: defFinal,
          ancla,
        })
        // La óptica se cuelga del pivote en el MISMO espacio que el arma (nodos
        // de COD en identidad), o sea en el espacio normalizado sobre el que se
        // midió el ancla. Es la misma relación que el renderer arma colgándola
        // del cuerpo del arma.
        pivote.add(opticaMontada)
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      } finally {
        cargando = false
      }
    }

    window.__opticsHarness = {
      mostrar,
      drawCalls: () => drawCalls,
      error: () => lastError,
      listo: () => !cargando && (armaScene !== null || opticaMontada !== null),
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      delete window.__opticsHarness
      if (opticaMontada) desmontarOptica(opticaMontada)
      for (const fuente of opticaFuentes.values()) desmontarFuenteOptica(fuente)
      opticaFuentes.clear()
      rig.dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <main style={{ margin: 0, background: '#0b0d12', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100vw', height: '100vh' }} />
    </main>
  )
}
