import type { PlayerInput } from '@/game/movement/state'

export const PITCH_LIMIT = Math.PI / 2 - 0.01

export function clampPitch(pitch: number): number {
  if (pitch > PITCH_LIMIT) return PITCH_LIMIT
  if (pitch < -PITCH_LIMIT) return -PITCH_LIMIT
  return pitch
}

const lookResult = { yaw: 0, pitch: 0 }

export function applyLook(
  yaw: number,
  pitch: number,
  movementX: number,
  movementY: number,
  sensitivity: number,
): { yaw: number; pitch: number } {
  lookResult.yaw = yaw - movementX * sensitivity
  lookResult.pitch = clampPitch(pitch - movementY * sensitivity)
  return lookResult
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
    player.crouch = keys.has('ControlLeft') || keys.has('KeyC')
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
    const r = applyLook(player.yaw, pitch, e.movementX, e.movementY, getSensitivity())
    player.yaw = r.yaw
    pitch = r.pitch
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

  return {
    player,
    get pitch() { return pitch },
    set pitch(v: number) { pitch = clampPitch(v) },
    get locked() { return locked },

    attach(target: HTMLCanvasElement): void {
      canvas = target
      target.addEventListener('click', onClick)
      document.addEventListener('pointerlockchange', onPointerLockChange)
      document.addEventListener('mousemove', onMouseMove)
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
    },

    detach(): void {
      canvas?.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas = null
      keys.clear()
    },
  }
}
