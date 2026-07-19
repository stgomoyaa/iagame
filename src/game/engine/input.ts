import type { PlayerInput } from '@/game/movement/state'

export const PITCH_LIMIT = Math.PI / 2 - 0.01

export function clampPitch(pitch: number): number {
  if (pitch > PITCH_LIMIT) return PITCH_LIMIT
  if (pitch < -PITCH_LIMIT) return -PITCH_LIMIT
  return pitch
}

export function applyYaw(yaw: number, movementX: number, sensitivity: number): number {
  return yaw - movementX * sensitivity
}

export function applyPitch(pitch: number, movementY: number, sensitivity: number): number {
  return clampPitch(pitch - movementY * sensitivity)
}

export interface InputSystem {
  readonly player: PlayerInput
  pitch: number
  readonly locked: boolean
  /** Delta de mouse acumulado desde el último clearMouseDelta(), sin consumir.
   *  Sólo avanza con el puntero bloqueado, igual que yaw/pitch. Lo consume el
   *  viewmodel para el sway (rig.ts, capa 3): se expone crudo en vez de ya
   *  aplicado a yaw/pitch para que el rig pueda usarlo con su propia escala. */
  readonly mouseDeltaX: number
  readonly mouseDeltaY: number
  /** Click izquierdo sostenido (fase 1, sección 4 del spec: disparo). Estado
   *  sostenido, no flanco — igual que el resto de este input system (ver el
   *  comentario de cabecera del archivo): combat/fire-control.ts es quien
   *  detecta flancos para semi/ráfaga. */
  readonly fireHeld: boolean
  /** Click derecho sostenido (ADS). */
  readonly adsHeld: boolean
  /** Tecla R sostenida (recarga). Sostenida a propósito: rig.ts ya hace de
   *  startReload() un no-op mientras hay una recarga en curso, precisamente
   *  para que llamarlo en cada frame con R sostenida no la deje en deadlock. */
  readonly reloadHeld: boolean
  attach(canvas: HTMLCanvasElement): void
  detach(): void
  /** Resetea el delta acumulado a 0. Se llama una vez por frame, después de leerlo. */
  clearMouseDelta(): void
}

export function createInputSystem(getSensitivity: () => number): InputSystem {
  const player: PlayerInput = {
    forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false,
  }

  let pitch = 0
  let locked = false
  let canvas: HTMLCanvasElement | null = null
  let mouseDeltaX = 0
  let mouseDeltaY = 0
  let fireHeld = false
  let adsHeld = false

  const keys = new Set<string>()

  function updateAxes(): void {
    player.forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
    player.right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
    player.jump = keys.has('Space')
    player.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight')
    player.crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC')
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') e.preventDefault()
    keys.add(e.code)
    updateAxes()
  }

  function onKeyUp(e: KeyboardEvent): void {
    keys.delete(e.code)
    updateAxes()
  }

  function onMouseMove(e: MouseEvent): void {
    if (!locked) return
    player.yaw = applyYaw(player.yaw, e.movementX, getSensitivity())
    pitch = applyPitch(pitch, e.movementY, getSensitivity())
    mouseDeltaX += e.movementX
    mouseDeltaY += e.movementY
  }

  // Disparo (botón izquierdo) y ADS (botón derecho): gateado por `locked`,
  // igual que onMouseMove — sin puntero bloqueado no hay partida en curso
  // todavía (el primer click sólo pide el lock, ver onClick). onContextMenu
  // evita que el click derecho abra el menú contextual del navegador en vez
  // de apuntar.
  function onMouseDown(e: MouseEvent): void {
    if (!locked) return
    if (e.button === 0) fireHeld = true
    else if (e.button === 2) adsHeld = true
  }

  function onMouseUp(e: MouseEvent): void {
    if (e.button === 0) fireHeld = false
    else if (e.button === 2) adsHeld = false
  }

  function onContextMenu(e: MouseEvent): void {
    if (locked) e.preventDefault()
  }

  function onPointerLockChange(): void {
    locked = document.pointerLockElement === canvas
    if (!locked) {
      keys.clear()
      updateAxes()
      fireHeld = false
      adsHeld = false
    }
  }

  function onClick(): void {
    canvas?.requestPointerLock()
  }

  function onBlur(): void {
    keys.clear()
    updateAxes()
    fireHeld = false
    adsHeld = false
  }

  function teardown(): void {
    canvas?.removeEventListener('click', onClick)
    document.removeEventListener('pointerlockchange', onPointerLockChange)
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mousedown', onMouseDown)
    document.removeEventListener('mouseup', onMouseUp)
    document.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    canvas = null
    keys.clear()
  }

  return {
    player,
    get pitch() { return pitch },
    set pitch(v: number) { pitch = clampPitch(v) },
    get locked() { return locked },
    get mouseDeltaX() { return mouseDeltaX },
    get mouseDeltaY() { return mouseDeltaY },
    get fireHeld() { return fireHeld },
    get adsHeld() { return adsHeld },
    get reloadHeld() { return keys.has('KeyR') },

    clearMouseDelta(): void {
      mouseDeltaX = 0
      mouseDeltaY = 0
    },

    attach(target: HTMLCanvasElement): void {
      if (canvas) teardown()
      canvas = target
      target.addEventListener('click', onClick)
      document.addEventListener('pointerlockchange', onPointerLockChange)
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mousedown', onMouseDown)
      document.addEventListener('mouseup', onMouseUp)
      document.addEventListener('contextmenu', onContextMenu)
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      window.addEventListener('blur', onBlur)
    },

    detach(): void {
      teardown()
      updateAxes()
    },
  }
}
