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
import {
  Box3,
  Color,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import { createViewmodelRenderer } from '@/game/weapons/viewmodel/renderer'
import { getWeaponVisual, loadLocalWeapons, muzzleOffsetForSlug } from '@/game/weapons/registry'

interface MostrarOpts {
  /** Mostrar la pose de MIRA (adsOffset) en vez de la de cadera (hipOffset). */
  ads?: boolean
  /** Dibujar un marcador (esfera) en la boca calculada, para verificar de dónde
   *  nace el fogonazo sin depender del VFX real (que sólo se ve al disparar). */
  marcarBoca?: boolean
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
      /** Estado del marcador de boca, para depurar la verificación. */
      debugBoca: () => unknown
      /** Mide la boca por geometría, mueve el marcador ahí y devuelve los puntos. */
      medirBoca: () => unknown
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

    // Marcador de boca: esfera magenta que se coloca en el MISMO punto donde
    // feedback/vfx-renderer.ts nace el fogonazo, replicando su `recalcularBoca`.
    // Cuelga de `vm.weapon` (igual que el fulgor real) para verificar la
    // posición sin disparar. No toca vfx-renderer: sólo reproduce su cálculo.
    const marcador = new Mesh(
      new SphereGeometry(0.012, 16, 12),
      new MeshBasicMaterial({ color: 0xff00ff, depthTest: false }),
    )
    marcador.renderOrder = 999
    marcador.visible = false
    vm.weapon.add(marcador)

    const inversaArma = new Matrix4()
    const matrizAux = new Matrix4()
    const matrizBoca = new Matrix4()
    const cajaLocal = new Box3()
    const cajaAux = new Box3()
    const puntoBoca = new Vector3()

    function calcularBoca(weapon: Object3D, slug: string | null): void {
      weapon.updateWorldMatrix(true, true)
      inversaArma.copy(weapon.matrixWorld).invert()
      cajaLocal.makeEmpty()
      matrizBoca.identity()
      let hayMalla = false
      weapon.traverse((o) => {
        const m = o as Mesh
        if (m === marcador || !m.isMesh || !m.geometry) return
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
        const bb = m.geometry.boundingBox
        if (!bb) return
        cajaAux.copy(bb)
        matrizAux.multiplyMatrices(inversaArma, m.matrixWorld)
        cajaAux.applyMatrix4(matrizAux)
        cajaLocal.union(cajaAux)
        if (!hayMalla || m.name === 'weapon_body') {
          matrizBoca.copy(matrizAux)
          hayMalla = true
        }
      })
      if (cajaLocal.isEmpty()) {
        puntoBoca.set(0, 0, -0.35)
        return
      }
      const boca = slug !== null ? muzzleOffsetForSlug(slug) : null
      if (boca !== null) {
        puntoBoca.set(boca.x, boca.y, boca.z).applyMatrix4(matrizBoca)
        return
      }
      cajaLocal.getCenter(puntoBoca)
      puntoBoca.z = cajaLocal.min.z
    }

    // Mide la boca por GEOMETRÍA (mismo algoritmo que scripts/lib/geometry.ts
    // muzzleFromGeometry): centroide X/Y de la rebanada más adelantada en -Z del
    // CUERPO del arma (weapon_body), con Z en el frente. Sobre el cuerpo SOLO
    // —no los brazos— para que en las de CS una mano adelantada no corra el
    // centroide. Devuelve el punto en el espacio LOCAL de la malla del cuerpo,
    // que es donde vive la boca medida del pack de COD en el índice.
    function medirBocaGeometria(mesh: Mesh): { x: number; y: number; z: number } | null {
      const attr = mesh.geometry.getAttribute('position')
      if (!attr) return null
      const p = attr.array as ArrayLike<number>
      let minZ = Infinity
      let maxZ = -Infinity
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (let i = 0; i < p.length; i += 3) {
        if (p[i] < minX) minX = p[i]
        if (p[i] > maxX) maxX = p[i]
        if (p[i + 1] < minY) minY = p[i + 1]
        if (p[i + 1] > maxY) maxY = p[i + 1]
        if (p[i + 2] < minZ) minZ = p[i + 2]
        if (p[i + 2] > maxZ) maxZ = p[i + 2]
      }
      const spanZ = maxZ - minZ
      const banda = minZ + Math.max(spanZ * 0.05, 0.02)
      let sx = 0
      let sy = 0
      let n = 0
      for (let i = 0; i < p.length; i += 3) {
        if (p[i + 2] > banda) continue
        sx += p[i]
        sy += p[i + 1]
        n++
      }
      if (n === 0) return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: minZ }
      return { x: sx / n, y: sy / n, z: minZ }
    }

    /** Malla del cuerpo del arma (weapon_body en CS; única en CC0), NO los
     *  brazos ni el marcador. */
    function mallaCuerpo(weapon: Object3D): Mesh | null {
      let cuerpo: Mesh | null = null
      weapon.traverse((o) => {
        const m = o as Mesh
        if (m === marcador || !m.isMesh || !m.geometry) return
        if (m.name === 'weapon_arms') return
        if (m.name === 'weapon_body') cuerpo = m
        else if (!cuerpo) cuerpo = m
      })
      return cuerpo
    }

    let slugPedido: string | null = null
    let usarAds = false
    let marcarBoca = false
    // Punto de boca forzado (medido por geometría), para verificar la posición
    // propuesta sin escribirla todavía en el índice. null = usar el cálculo del
    // renderer real (índice o heurístico de caja).
    const bocaMedida = new Vector3()
    let usarBocaMedida = false

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

      if (marcarBoca && attached !== null) {
        if (usarBocaMedida) marcador.position.copy(bocaMedida)
        else {
          calcularBoca(vm.weapon, attached)
          marcador.position.copy(puntoBoca)
        }
        marcador.visible = true
      } else {
        marcador.visible = false
      }

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
        marcarBoca = opts?.marcarBoca === true
        // Se resetea el override de boca medida: si no, el arma nueva heredaría
        // el punto medido de la anterior (bug de verificación, no del juego).
        usarBocaMedida = false
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
      debugBoca(): unknown {
        return {
          marcarBoca,
          visible: marcador.visible,
          pos: { x: marcador.position.x, y: marcador.position.y, z: marcador.position.z },
          muzzle: vm.attachedSlug ? muzzleOffsetForSlug(vm.attachedSlug) : null,
        }
      },
      /**
       * Mide la boca por geometría del cuerpo, mueve el marcador ahí y devuelve
       * el punto LOCAL (para escribir al índice) más el heurístico de caja para
       * comparar. Enciende marcarBoca+usarBocaMedida para verlo.
       */
      medirBoca(): unknown {
        const cuerpo = mallaCuerpo(vm.weapon)
        if (!cuerpo) return null
        const local = medirBocaGeometria(cuerpo)
        if (!local) return null
        vm.weapon.updateWorldMatrix(true, true)
        inversaArma.copy(vm.weapon.matrixWorld).invert()
        matrizAux.multiplyMatrices(inversaArma, cuerpo.matrixWorld)
        bocaMedida.set(local.x, local.y, local.z).applyMatrix4(matrizAux)
        usarBocaMedida = true
        marcarBoca = true
        // Heurístico de caja actual, para el log comparativo.
        calcularBoca(vm.weapon, vm.attachedSlug)
        return {
          slug: vm.attachedSlug,
          local,
          cajaHeuristica: { x: puntoBoca.x, y: puntoBoca.y, z: puntoBoca.z },
          medidaEnEspacioArma: { x: bocaMedida.x, y: bocaMedida.y, z: bocaMedida.z },
        }
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
