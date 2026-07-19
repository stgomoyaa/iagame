import { MAX_FRAME_DT } from '@/game/engine/constants'
import { createFixedLoop } from '@/game/engine/fixed-loop'
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

    gfx.renderer.info.reset()
    gfx.render()
    // El WebGLRenderer resetea renderer.info en cada llamada a render()
    // (autoReset): hay que leer las cuentas del mundo acá, antes de que la
    // pasada del viewmodel las pise, para poder sumarlas después.
    const worldCalls = gfx.renderer.info.render.calls
    const worldTriangles = gfx.renderer.info.render.triangles

    // Viewmodel: un paso de rig por frame de render (no por tick fijo), como
    // el resto de la capa visual. El sway necesita el delta de mouse crudo
    // de este frame, que sólo tiene sentido a granularidad de frame.
    if (currentSlug) {
      syncRigWeapon(rigWeapon, getWeaponVisual(currentSlug))
      vmInput.speed = Math.hypot(player.velocity.x, player.velocity.z)
      vmInput.grounded = player.grounded
      vmInput.ads = debugAdsHeld
      vmInput.mouseDeltaX = input.mouseDeltaX
      vmInput.mouseDeltaY = input.mouseDeltaY
      input.clearMouseDelta()

      const vmDt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT)
      stepViewmodel(vmState, vmInput, rigWeapon, vmOut, vmDt)

      // El pz del rig usa "+ hacia el jugador" (ver seed.ts); la cámara del
      // viewmodel mira hacia -Z como cualquier cámara de Three, así que el
      // eje que queda "delante" de ella es el negativo. x e y ya coinciden
      // con la convención de Three (derecha positiva, arriba positivo) y no
      // se tocan.
      viewmodel.weapon.position.set(vmOut.px, vmOut.py, -vmOut.pz)
      viewmodel.weapon.rotation.set(vmOut.rx, vmOut.ry, vmOut.rz)
      viewmodel.render(gfx.camera)

      stats.endFrame(
        worldCalls + gfx.renderer.info.render.calls,
        worldTriangles + gfx.renderer.info.render.triangles,
      )
    } else {
      stats.endFrame(worldCalls, worldTriangles)
    }
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
