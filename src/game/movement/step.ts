import { TICK_DT } from '@/game/engine/constants'
import { sanitizeDt } from '@/game/engine/dt'
import type { Box } from '@/game/map/types'
import { copy, vec3, type Vec3 } from '@/game/math/vec3'
import { accelerate, applyFriction } from '@/game/movement/accelerate'
import { applySoftCap, shouldSkipFriction } from '@/game/movement/bhop'
import { tryMantle } from '@/game/movement/mantle'
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
    crouchWasPressed: false,
    sliding: false,
    slideTime: 0,
    timeSinceSlideEnded: Infinity,
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
  const base = input.crouch ? MOVEMENT.crouchSpeed : input.sprint ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed
  return input.adsSpeedScale === undefined ? base : base * input.adsSpeedScale
}

export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  boxes: Box[],
  dt: number = TICK_DT,
): void {
  // resolveMove (physics/capsule.ts) ya guarda `position` contra un delta no
  // finito, pero eso corre al final del tick: velocity se integra ANTES
  // (accelerate, gravedad) con este mismo dt, sin protección. Un dt=NaN deja
  // velocity en (NaN,NaN,NaN) para siempre (nada más adelante lo saca de
  // ahí); un dt=Infinity manda velocity.y a -Infinity; ninguno de los dos se
  // recupera con ticks normales después. Ver engine/dt.ts.
  dt = sanitizeDt(dt)

  copy(state.prevPosition, state.position)

  // Temporizadores de input
  if (input.jump && !state.jumpWasPressed) state.timeSinceJumpPressed = 0
  else state.timeSinceJumpPressed += dt
  state.jumpWasPressed = input.jump

  computeWishDir(scratchWishDir, input)
  const wishSpeed = targetSpeed(input)

  // Transiciones de slide
  const velHorizontal = Math.hypot(state.velocity.x, state.velocity.z)
  state.timeSinceSlideEnded += dt

  if (state.sliding) {
    state.slideTime += dt
    const expiro = state.slideTime >= MOVEMENT.slideDuration
    const muyLento = velHorizontal < MOVEMENT.walkSpeed * MOVEMENT.slideEndSpeedScale
    if (expiro || muyLento || !input.crouch) {
      state.sliding = false
      state.slideTime = 0
      state.timeSinceSlideEnded = 0
    }
  } else if (
    input.crouch &&
    !state.crouchWasPressed &&
    state.grounded &&
    velHorizontal >= MOVEMENT.slideMinSpeed &&
    state.timeSinceSlideEnded >= MOVEMENT.slideCooldown
  ) {
    state.sliding = true
    state.slideTime = 0
    // Clamp en el punto de aplicación, no una multiplicación ciega: sin esto
    // re-presionar agachar cada ~150ms reaplica el boost sobre una velocidad
    // ya boosteada (compuesto sin límite). El cooldown de arriba ya evita el
    // re-presionado rápido, pero este clamp es la segunda capa: cualquier
    // otra fuente futura de velocidad en el suelo entra al slide con el
    // mismo techo, en vez de heredar el agujero de que applySoftCap sólo
    // corre en la rama aérea.
    const objetivo = Math.min(velHorizontal * MOVEMENT.slideBoost, MOVEMENT.slideMaxSpeed)
    const k = objetivo / velHorizontal
    state.velocity.x *= k
    state.velocity.z *= k
  }

  if (state.grounded) {
    if (state.sliding) {
      // Fricción reducida y sin aceleración: deslizando no se acelera.
      applyFriction(state.velocity, MOVEMENT.slideFriction, MOVEMENT.stopSpeed, dt)
    } else {
      if (!shouldSkipFriction(state, input)) {
        applyFriction(state.velocity, MOVEMENT.groundFriction, MOVEMENT.stopSpeed, dt)
      }
      accelerate(state.velocity, scratchWishDir, wishSpeed, MOVEMENT.groundAccel, dt)
    }
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
    // El slide-cancel no toca la velocidad horizontal: encadenar es el punto.
    // Pero sí cuenta como el fin del slide para el cooldown: sin esto, un
    // slide-cancel encadenado (agachar, saltar de inmediato, aterrizar,
    // agachar de nuevo) reaplica el boost sin pedirle nada al mouse.
    if (state.sliding) state.timeSinceSlideEnded = 0
    state.sliding = false
    state.slideTime = 0
  }

  state.velocity.y -= MOVEMENT.gravity * dt

  scratchDelta.x = state.velocity.x * dt
  scratchDelta.y = state.velocity.y * dt
  scratchDelta.z = state.velocity.z * dt

  resolveMove(state.position, scratchDelta, PLAYER_CAPSULE, boxes, scratchResult)

  // Mantle: sólo si chocamos una pared en el aire yendo hacia ella.
  if (!scratchResult.hitGround && scratchResult.hitWall) {
    if (tryMantle(state.position, state.velocity, scratchWishDir, boxes)) {
      if (state.velocity.y < 0) state.velocity.y = 0
    }
  }

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

  // Acercamiento exponencial framerate-independiente, no un salto ni un
  // paso fijo por tick: `factor` siempre cae en (0, 1) sea cual sea dt, así
  // que esto converge sin pasarse de largo del objetivo (no hay overshoot
  // posible) y a los mismos ~120ms de sensación sin importar el framerate.
  const eyeHeightTarget =
    input.crouch || state.sliding ? MOVEMENT.crouchEyeHeight : MOVEMENT.eyeHeight
  const factor = 1 - Math.exp(-dt / MOVEMENT.eyeHeightLerpTime)
  state.eyeHeight += (eyeHeightTarget - state.eyeHeight) * factor

  state.crouchWasPressed = input.crouch
}
