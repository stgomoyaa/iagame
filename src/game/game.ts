import { sanitizeDt } from '@/game/engine/dt'
import { createFixedLoop } from '@/game/engine/fixed-loop'
import { createGpuTimer } from '@/game/engine/gpu-timer'
import { createInputSystem } from '@/game/engine/input'
import { createRenderer } from '@/game/engine/renderer'
import { createStatsTracker, runBenchmark } from '@/game/engine/stats'
import type { FrameStats } from '@/game/engine/stats'
import { createTuningPanel } from '@/game/engine/tuning-panel'
import { ARENA } from '@/game/map/arena'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import { getWeaponVisual, weaponIndex } from '@/game/weapons/registry'
import { createRigWeapon, syncRigWeapon } from '@/game/weapons/viewmodel/adapt'
import { createViewmodelRenderer } from '@/game/weapons/viewmodel/renderer'
import {
  createViewmodelState,
  fire as fireViewmodel,
  startDraw,
  startReload,
  stepViewmodel,
  type ViewmodelInput,
} from '@/game/weapons/viewmodel/rig'
import type { VmTransform } from '@/game/weapons/viewmodel/types'
import {
  createWeaponTuningPanel,
  debugModeEnabled,
  loadWeaponTuningOverrides,
} from '@/game/weapons/viewmodel/tuning-panel'

export interface Game {
  start(): void
  stop(): void
  /**
   * Costo en CPU de encolar `passes` llamadas a render(), sin esperar a que
   * la GPU termine de dibujar. Es una cota inferior del costo real de
   * frame, no una medida de capacidad o margen disponible.
   */
  benchmark(passes?: number): number
  readonly stats: FrameStats
}

const SENSITIVITY = 0.0022

export function createGame(canvas: HTMLCanvasElement): Game {
  const gfx = createRenderer(canvas)
  const viewmodel = createViewmodelRenderer(gfx.renderer)
  const stats = createStatsTracker()
  const gpuTimer = createGpuTimer(gfx.gl)
  const tuning = createTuningPanel()
  const input = createInputSystem(() => SENSITIVITY)
  const loop = createFixedLoop()
  const player = createPlayerState(ARENA.spawns[0])

  // Estado del viewmodel: todo preasignado una sola vez acá. El frame loop
  // sólo muta estos objetos, nunca crea uno nuevo (presupuesto de cero
  // asignaciones, sección 2 del spec).
  const vmState = createViewmodelState()
  const vmInput: ViewmodelInput = {
    speed: 0, grounded: false, ads: false, mouseDeltaX: 0, mouseDeltaY: 0,
  }
  const vmOut: VmTransform = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }
  const rigWeapon = createRigWeapon()

  const firstSlug = weaponIndex()[0]?.slug ?? null
  let currentSlug = firstSlug
  if (currentSlug) viewmodel.setWeaponSlug(currentSlug)

  // El botón derecho del panel de tuning sostiene ADS como acción de prueba
  // (sección 6.4 del spec); fuera de debug queda siempre en false, porque
  // todavía no existe un sistema de combate real que lo accione.
  let debugAdsHeld = false

  const weaponTuning = debugModeEnabled()
    ? createWeaponTuningPanel({
        initialSlug: currentSlug ?? '',
        onSelectWeapon(slug: string): void {
          currentSlug = slug
          viewmodel.setWeaponSlug(slug)
          startDraw(vmState, rigWeapon)
        },
        onFire(): void {
          fireViewmodel(vmState, rigWeapon)
        },
        onReload(): void {
          startReload(vmState, rigWeapon)
        },
        setAds(held: boolean): void {
          debugAdsHeld = held
        },
      })
    : null

  let running = false
  let lastTime = 0
  let rafId = 0

  // Aviso en pantalla del último load de arma fallido (ver
  // ViewmodelRenderer.lastLoadError, weapons/viewmodel/renderer.ts): sin
  // esto, un 404 o un GLB corrupto sólo deja rastro en la consola. Se
  // actualiza sólo cuando el mensaje cambia, no crea ni toca el DOM cada
  // frame si no hay nada nuevo que mostrar.
  let weaponErrorBanner: HTMLDivElement | null = null
  let shownLoadError: string | null = null

  function updateWeaponErrorBanner(): void {
    const message = viewmodel.lastLoadError
    if (message === shownLoadError) return
    shownLoadError = message

    if (message === null) {
      weaponErrorBanner?.remove()
      weaponErrorBanner = null
      return
    }

    if (!weaponErrorBanner && canvas.parentElement) {
      weaponErrorBanner = document.createElement('div')
      weaponErrorBanner.style.cssText =
        'position:absolute;bottom:8px;left:8px;z-index:25;max-width:60vw;' +
        'font:12px ui-monospace,monospace;color:#ffb4b4;' +
        'background:rgba(40,0,0,.85);padding:8px 10px;border-radius:4px'
      canvas.parentElement.appendChild(weaponErrorBanner)
    }
    if (weaponErrorBanner) weaponErrorBanner.textContent = message
  }

  function onResize(): void {
    gfx.resize(canvas.clientWidth, canvas.clientHeight)
    viewmodel.resize(canvas.clientWidth, canvas.clientHeight)
  }

  function frame(now: number): void {
    if (!running) return
    rafId = requestAnimationFrame(frame)
    stats.beginFrame()

    const frameDt = lastTime === 0 ? 0 : (now - lastTime) / 1000
    lastTime = now

    const ticks = loop.advance(frameDt)
    for (let i = 0; i < ticks; i++) {
      stepPlayer(player, input.player, ARENA.boxes)
    }

    // Interpolar la posición de la cámara entre el tick anterior y el actual.
    const a = loop.alpha
    gfx.camera.position.x = player.prevPosition.x + (player.position.x - player.prevPosition.x) * a
    gfx.camera.position.y =
      player.prevPosition.y + (player.position.y - player.prevPosition.y) * a + player.eyeHeight
    gfx.camera.position.z = player.prevPosition.z + (player.position.z - player.prevPosition.z) * a

    gfx.camera.rotation.set(input.pitch, input.player.yaw, 0, 'YXZ')

    // El timer de GPU bracketea desde acá (antes del clear + render del
    // mundo) hasta después de la pasada del viewmodel, más abajo: esas dos
    // pasadas y sus dos clears son exactamente lo que la auditoría de
    // performance midió como "costo de GPU de un rAF completo".
    gpuTimer.beginFrame()

    gfx.renderer.info.reset()
    gfx.render()
    // El WebGLRenderer resetea renderer.info en cada llamada a render()
    // (autoReset): hay que leer las cuentas del mundo acá, antes de que la
    // pasada del viewmodel las pise, para poder sumarlas después.
    const worldCalls = gfx.renderer.info.render.calls
    const worldTriangles = gfx.renderer.info.render.triangles

    // El delta de mouse crudo de este frame se consume acá pase lo que
    // pase con el viewmodel (ver abajo): acumularlo sin límite mientras no
    // hay ningún modelo adjunto todavía produciría un salto de sway al
    // adjuntar el primero.
    const mouseDeltaX = input.mouseDeltaX
    const mouseDeltaY = input.mouseDeltaY
    input.clearMouseDelta()

    // Viewmodel: un paso de rig por frame de render (no por tick fijo), como
    // el resto de la capa visual. Se anima con `attachedSlug` (el modelo
    // efectivamente en pantalla), no con el slug pedido por el jugador o el
    // panel de tuning: si el último load pedido falló o sigue en vuelo,
    // attachedSlug sigue apuntando al último modelo real, así que la pose
    // (hip/ads/kick) nunca corre por delante del modelo que se ve (ver
    // weapons/viewmodel/renderer.ts).
    const shownSlug = viewmodel.attachedSlug
    if (shownSlug) {
      syncRigWeapon(rigWeapon, getWeaponVisual(shownSlug))
      vmInput.speed = Math.hypot(player.velocity.x, player.velocity.z)
      vmInput.grounded = player.grounded
      vmInput.ads = debugAdsHeld
      vmInput.mouseDeltaX = mouseDeltaX
      vmInput.mouseDeltaY = mouseDeltaY

      const vmDt = sanitizeDt(frameDt)
      stepViewmodel(vmState, vmInput, rigWeapon, vmOut, vmDt)

      // El pz del rig usa "+ hacia el jugador" (ver seed.ts); la cámara del
      // viewmodel mira hacia -Z como cualquier cámara de Three, así que el
      // eje que queda "delante" de ella es el negativo. x e y ya coinciden
      // con la convención de Three (derecha positiva, arriba positivo) y no
      // se tocan.
      viewmodel.weapon.position.set(vmOut.px, vmOut.py, -vmOut.pz)
      viewmodel.weapon.rotation.set(vmOut.rx, vmOut.ry, vmOut.rz)
      viewmodel.render(gfx.camera)
      gpuTimer.endFrame()

      stats.endFrame(
        worldCalls + gfx.renderer.info.render.calls,
        worldTriangles + gfx.renderer.info.render.triangles,
        gpuTimer.stats.gpuMs,
        gpuTimer.stats.peakMs,
      )
    } else {
      gpuTimer.endFrame()
      stats.endFrame(worldCalls, worldTriangles, gpuTimer.stats.gpuMs, gpuTimer.stats.peakMs)
    }

    updateWeaponErrorBanner()
  }

  return {
    start(): void {
      if (running) return
      running = true
      lastTime = 0
      input.attach(canvas)
      if (canvas.parentElement) {
        stats.mount(canvas.parentElement)
        tuning.mount(canvas.parentElement)
        weaponTuning?.mount(canvas.parentElement)
      }
      loadWeaponTuningOverrides().catch(() => {})
      window.addEventListener('resize', onResize)
      onResize()
      rafId = requestAnimationFrame(frame)
    },
    stop(): void {
      running = false
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      input.detach()
      stats.unmount()
      tuning.unmount()
      weaponTuning?.unmount()
      weaponErrorBanner?.remove()
      weaponErrorBanner = null
      shownLoadError = null
      viewmodel.dispose()
      gfx.dispose()
    },
    benchmark(passes = 500): number {
      return runBenchmark(() => gfx.render(), passes)
    },
    get stats() {
      return stats.stats
    },
  }
}
