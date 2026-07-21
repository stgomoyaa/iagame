'use client'

/**
 * Banco de pruebas VISUAL del viewmodel en PRIMERA PERSONA. NO es parte del
 * juego: es la pantalla contra la que se verifican los brazos injertados, la
 * pose de cadera/mira y la velocidad del draw del cuchillo.
 *
 * A diferencia de optics-harness (arma sola, cámara libre), acá se reproduce
 * EXACTAMENTE lo que ve el jugador: se usa el `createViewmodelRenderer` real,
 * se injertan los brazos igual que en partida, y la pose se escribe con el
 * MISMO criterio que game.ts (`weapon.position = (hip.x, hip.y, -hip.z)`,
 * `weapon.rotation = (hip.rx, hip.ry, hip.rz)`). Así la captura juzga el mismo
 * código que corre en el juego, no una aproximación.
 *
 * Se maneja desde afuera por `window.__vmHarness` (CDP). Sortea las trampas de
 * AGENTS.md: se navega a `localhost` (no `127.0.0.1`) y no se toca pointer lock.
 */

import { useEffect, useRef } from 'react'
import { Color, PerspectiveCamera, WebGLRenderer } from 'three'
import { createViewmodelRenderer } from '@/game/weapons/viewmodel/renderer'
import { getWeaponVisual, loadLocalWeapons } from '@/game/weapons/registry'

interface MostrarOpts {
  /** Mostrar la pose de MIRA (adsOffset) en vez de la de cadera (hipOffset). */
  ads?: boolean
}

declare global {
  interface Window {
    __vmHarness?: {
      /** Equipa un arma y la muestra en pose de cadera (o mira, con opts.ads). */
      mostrar: (slug: string, opts?: MostrarOpts) => void
      /** Dispara el clip 'draw' con la duración dada (<=0 = velocidad nativa). */
      playDraw: (seconds: number) => boolean
      /** Slug efectivamente adjunto ahora mismo, o null. */
      attached: () => string | null
      /** Último error de carga, o null. */
      error: () => string | null
      /** hipOffset/adsOffset actuales, para loguear los números. */
      poseInfo: (slug: string) => unknown
    }
  }
}

export default function ViewmodelHarnessPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // autoClear=false como el renderer compartido del juego (engine/renderer.ts):
    // el viewmodel limpia SOLO profundidad y dibuja encima, así que el color de
    // fondo lo limpiamos nosotros cada frame.
    const renderer = new WebGLRenderer({ canvas, antialias: true })
    renderer.autoClear = false
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    // Cámara de "mundo": el viewmodel copia SÓLO su rotación (mira hacia -Z con
    // rotación identidad). Su FOV no importa: el viewmodel usa el suyo (70°).
    const worldCamera = new PerspectiveCamera(90, 1, 0.1, 100)

    const vm = createViewmodelRenderer(renderer)

    // Fondo gris azulado tipo arena: hace visibles tanto el arma oscura como
    // los brazos de piel/guante.
    const fondo = new Color(0x2a2d3a)

    let slugPedido: string | null = null
    let usarAds = false

    const resize = (): void => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      renderer.setSize(w, h, false)
      worldCamera.aspect = w / h
      worldCamera.updateProjectionMatrix()
      vm.resize(w, h)
    }

    let listo = false
    void loadLocalWeapons().then(() => {
      listo = true
    })

    let raf = 0
    let last = performance.now()
    const animar = (): void => {
      raf = requestAnimationFrame(animar)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      // Aplica la pose real (cadera o mira) al pivote animado, igual que game.ts.
      const attached = vm.attachedSlug
      if (attached !== null) {
        const visual = getWeaponVisual(attached)
        const p = usarAds ? visual.adsOffset : visual.hipOffset
        vm.weapon.position.set(p.x, p.y, -p.z)
        vm.weapon.rotation.set(p.rx, p.ry, p.rz)
      }

      vm.advanceAnimation(dt)

      renderer.setClearColor(fondo, 1)
      renderer.clear(true, true, false)
      vm.render(worldCamera, now / 1000)
    }

    resize()
    window.addEventListener('resize', resize)
    animar()

    window.__vmHarness = {
      mostrar(slug: string, opts?: MostrarOpts): void {
        if (!listo) return
        slugPedido = slug
        usarAds = opts?.ads === true
        vm.setWeaponSlug(slug)
      },
      playDraw(seconds: number): boolean {
        return vm.playClip('draw', seconds)
      },
      attached: () => vm.attachedSlug,
      error: () => vm.lastLoadError,
      poseInfo(slug: string): unknown {
        void slugPedido
        const v = getWeaponVisual(slug)
        return { hipOffset: v.hipOffset, adsOffset: v.adsOffset, scaleAdjust: v.scaleAdjust }
      },
    }

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      delete window.__vmHarness
      vm.dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <main style={{ margin: 0, background: '#2a2d3a', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100vw', height: '100vh' }} />
    </main>
  )
}
