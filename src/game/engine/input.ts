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
  attach(canvas: HTMLCanvasElement): void
  detach(): void
}

export function createInputSystem(getSensitivity: () => number): InputSystem {
  const player: PlayerInput = {
    forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false,
  }

  let pitch = 0
  let locked = false
  let canvas: HTMLCanvasElement | null = null

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
  }

  function onPointerLockChange(): void {
    locked = document.pointerLockElement === canvas
    if (!locked) {
      keys.clear()
      updateAxes()
    }
  }

  function onClick(): void {
    canvas?.requestPointerLock()
  }

  function onBlur(): void {
    keys.clear()
    updateAxes()
  }

  function teardown(): void {
    canvas?.removeEventListener('click', onClick)
    document.removeEventListener('pointerlockchange', onPointerLockChange)
    document.removeEventListener('mousemove', onMouseMove)
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

    attach(target: HTMLCanvasElement): void {
      if (canvas) teardown()
      canvas = target
      target.addEventListener('click', onClick)
      document.addEventListener('pointerlockchange', onPointerLockChange)
      document.addEventListener('mousemove', onMouseMove)
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
