import { TICK_DT } from '@/game/engine/constants'
import type { Box } from '@/game/map/types'
import { copy, vec3, type Vec3 } from '@/game/math/vec3'
import { accelerate, applyFriction } from '@/game/movement/accelerate'
import { applySoftCap, shouldSkipFriction } from '@/game/movement/bhop'
import type { PlayerInput, PlayerState } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'
import { PLAYER_CAPSULE, resolveMove, type MoveResult } from '@/game/physics/capsule'

const scratchWishDir: Vec3 = vec3()
const scratchDelta: Vec3 = vec3()
const scratchResult: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }

export function createPlayerState(spawn: Vec3): PlayerState {
  return {
    position: vec3(spawn.x, spawn.y, spawn.z),
    velocity: vec3(),
    prevPosition: vec3(spawn.x, spawn.y, spawn.z),
    grounded: false,
    timeSinceGrounded: Infinity,
    timeSinceLanded: Infinity,
    timeSinceJumpPressed: Infinity,
    jumpWasPressed: false,
    sliding: false,
    slideTime: 0,
    eyeHeight: MOVEMENT.eyeHeight,
  }
}

function computeWishDir(out: Vec3, input: PlayerInput): void {
  const sin = Math.sin(input.yaw)
  const cos = Math.cos(input.yaw)

  // La cámara mira hacia -Z con yaw 0, que es la convención de Three.
  // Adelante = (-sin, 0, -cos). Derecha = (cos, 0, -sin).
  const x = input.right * cos - input.forward * sin
  const z = -input.forward * cos - input.right * sin

  const len = Math.hypot(x, z)
  if (len < 1e-6) {
    out.x = 0
    out.z = 0
  } else {
    out.x = x / len
    out.z = z / len
  }
  out.y = 0
}

function targetSpeed(input: PlayerInput): number {
  if (input.crouch) return MOVEMENT.crouchSpeed
  if (input.sprint) return MOVEMENT.sprintSpeed
  return MOVEMENT.walkSpeed
}

export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  boxes: Box[],
  dt: number = TICK_DT,
): void {
  copy(state.prevPosition, state.position)

  // Temporizadores de input
  if (input.jump && !state.jumpWasPressed) state.timeSinceJumpPressed = 0
  else state.timeSinceJumpPressed += dt
  state.jumpWasPressed = input.jump

  computeWishDir(scratchWishDir, input)
  const wishSpeed = targetSpeed(input)

  if (state.grounded) {
    if (!shouldSkipFriction(state, input)) {
      applyFriction(state.velocity, MOVEMENT.groundFriction, MOVEMENT.stopSpeed, dt)
    }
    accelerate(state.velocity, scratchWishDir, wishSpeed, MOVEMENT.groundAccel, dt)
  } else {
    accelerate(
      state.velocity,
      scratchWishDir,
      MOVEMENT.airWishSpeedCap,
      MOVEMENT.airAccel,
      dt,
    )
    applySoftCap(state.velocity, MOVEMENT.bhopSoftCap, MOVEMENT.bhopSoftCapDecay, dt)
  }

  // Salto, con coyote time y auto-hop.
  //
  // `quiereSaltar` es una disyunción a propósito. Si sólo mirara el buffer,
  // mantener espacio apretado dejaría de saltar a los 120ms: el flanco de
  // subida ocurre una sola vez y timeSinceJumpPressed crece para siempre.
  // Eso mataría el auto-hop, que es la base del bhop. `input.jump` sostenido
  // significa "quiero saltar ahora"; el buffer cubre el caso de apretar y
  // soltar justo antes de aterrizar.
  const puedeSaltar = state.grounded || state.timeSinceGrounded <= MOVEMENT.coyoteTime
  const quiereSaltar = input.jump || state.timeSinceJumpPressed <= MOVEMENT.jumpBufferWindow

  if (puedeSaltar && quiereSaltar) {
    state.velocity.y = MOVEMENT.jumpVelocity
    state.grounded = false
    state.timeSinceGrounded = MOVEMENT.coyoteTime + 1
    state.timeSinceJumpPressed = Infinity
  }

  state.velocity.y -= MOVEMENT.gravity * dt

  scratchDelta.x = state.velocity.x * dt
  scratchDelta.y = state.velocity.y * dt
  scratchDelta.z = state.velocity.z * dt

  resolveMove(state.position, scratchDelta, PLAYER_CAPSULE, boxes, scratchResult)

  const estabaEnSuelo = state.grounded
  state.grounded = scratchResult.hitGround

  if (state.grounded) {
    if (state.velocity.y < 0) state.velocity.y = 0
    state.timeSinceGrounded = 0
    if (!estabaEnSuelo) state.timeSinceLanded = 0
    else state.timeSinceLanded += dt
  } else {
    state.timeSinceGrounded += dt
    state.timeSinceLanded += dt
  }

  if (scratchResult.hitCeiling && state.velocity.y > 0) state.velocity.y = 0

  state.eyeHeight = input.crouch ? MOVEMENT.crouchEyeHeight : MOVEMENT.eyeHeight
}
