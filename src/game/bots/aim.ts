/**
 * Apuntado de bots (sección 8 del spec): "la mira gira hacia el objetivo con
 * velocidad angular limitada, más un cono de error que se cierra
 * progresivamente durante el tiempo de reacción. Nunca hay snap
 * instantáneo". Dos piezas separadas a propósito:
 *
 * - El MOTOR (stepAimTowards) mueve el yaw/pitch actual hacia un objetivo a
 *   velocidad angular acotada. Corre cada tick de simulación (como el
 *   movimiento), para que el seguimiento se vea fluido en pantalla.
 * - El CEREBRO (currentErrorConeRadius + sampleErrorOffset) decide CUÁL es
 *   el objetivo en un instante dado -- la dirección real más un offset
 *   aleatorio dentro de un cono que arranca en errorConeRad (el número de
 *   dificultad, bots/difficulty.ts) y se cierra a 0 en reactionTimeS. Se
 *   recalcula en el tick de IA a 15Hz (bots/bot.ts), no cada frame: el
 *   motor sigue corriendo fluido entre medio hacia el último objetivo
 *   calculado, no hacia el objetivo instantáneo.
 *
 * Nada de esto conoce PlayerState ni Three: son primitivos de yaw/pitch,
 * mismos radianes y misma convención que combat/shot.ts (computeForward) y
 * movement/step.ts (computeWishDir): yaw 0 mira hacia -Z.
 */

import { clampPitch } from '@/game/engine/input'

export interface AimMotorState {
  yaw: number
  pitch: number
}

export function createAimMotorState(yaw = 0, pitch = 0): AimMotorState {
  return { yaw, pitch }
}

/** Diferencia angular de `from` a `to`, envuelta al representante más corto
 *  en (-PI, PI]. Sin esto, girar de yaw=3.1 a yaw=-3.1 (casi el mismo
 *  ángulo, cruzando el corte de +-PI) tomaría "el camino largo" -- casi una
 *  vuelta completa -- en vez del giro chico que en realidad hace falta. */
function shortestAngleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  else if (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * Gira `state` (in place) hacia (targetYaw, targetPitch) a una velocidad
 * angular acotada por `maxAngularSpeedRad` (radianes/seg, magnitud
 * combinada de yaw+pitch -- no cada eje por separado, así una diagonal no
 * gira más rápido que un giro puro de un solo eje). El pitch resultante
 * queda clampeado a PITCH_LIMIT, igual que la cámara del jugador.
 *
 * Esta es la única función de este archivo que puede acercarse al objetivo:
 * nunca hay un camino alternativo que ponga yaw/pitch directo en el valor
 * pedido -- por diseño, es la garantía de "nunca snap instantáneo" del spec.
 */
export function stepAimTowards(
  state: AimMotorState,
  targetYaw: number,
  targetPitch: number,
  maxAngularSpeedRad: number,
  dt: number,
): void {
  const maxStep = Math.max(0, maxAngularSpeedRad) * Math.max(0, dt)
  const dYaw = shortestAngleDelta(state.yaw, targetYaw)
  const dPitch = clampPitch(targetPitch) - state.pitch
  const magnitude = Math.hypot(dYaw, dPitch)

  if (magnitude <= maxStep || magnitude < 1e-9) {
    state.yaw += dYaw
    state.pitch += dPitch
  } else {
    const scale = maxStep / magnitude
    state.yaw += dYaw * scale
    state.pitch += dPitch * scale
  }

  state.pitch = clampPitch(state.pitch)
}

/** Par yaw/pitch, radianes. Se reusa tanto para ángulos absolutos (lookAt)
 *  como para offsets/deltas (sampleErrorOffset) -- la forma es la misma, el
 *  significado lo da cada llamador. */
export interface YawPitch {
  yaw: number
  pitch: number
}

/** Yaw/pitch para mirar desde (eyeX,eyeY,eyeZ) hacia (targetX,targetY,targetZ),
 *  misma convención de ejes que combat/shot.ts computeForward. Escribe en
 *  `out` (preasignado): cero asignaciones por llamada. */
export function lookAt(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  out: YawPitch,
): void {
  const dx = targetX - eyeX
  const dy = targetY - eyeY
  const dz = targetZ - eyeZ
  const horizontal = Math.hypot(dx, dz)
  out.yaw = Math.atan2(-dx, -dz)
  out.pitch = clampPitch(Math.atan2(dy, horizontal))
}

/**
 * Radio del cono de error en el instante `timeSinceAcquiredS` desde que se
 * adquirió el objetivo actual: `errorConeRad` en t=0, decreciendo LINEAL
 * (monótono, sin rebote) hasta `steadyRad` en t=reactionTimeS, y de ahí en
 * adelante ESTABLE en `steadyRad`.
 *
 * El piso es la corrección central de la tarea de dificultad. Antes esta
 * función bajaba a 0 y se quedaba ahí: pasado el tiempo de reacción, CUALQUIER
 * bot -- Hierro incluido -- apuntaba perfecto mientras siguiera viendo al
 * objetivo. En un tiroteo de 12 s eso deja ~11.7 s de puntería impecable en
 * todos los tramos, y es por lo que la dificultad medía exactamente igual de
 * punta a punta de la tabla (ver bots/difficulty.ts para los números).
 *
 * Counter-Strike no hace converger el error a cero: lo re-siembra
 * (cs_bot_weapon.cpp, `m_aimFocus = MAX(m_aimFocus, fNewMaxFocus)` con
 * `fRadius = RandomFloat(0, m_aimFocus)`), así que un bot flojo tiembla para
 * siempre. `steadyRad` es ese temblor permanente.
 *
 * `reactionTimeS<=0` asienta el cono de inmediato en `steadyRad` en vez de
 * dividir por cero -- caso límite, no debería darse con los tramos reales
 * (0.18 s - 0.5 s).
 */
export function currentErrorConeRadius(
  errorConeRad: number,
  reactionTimeS: number,
  timeSinceAcquiredS: number,
  steadyRad = 0,
): number {
  // El piso nunca puede quedar por encima del cono inicial: si alguien
  // configura steadyRad > errorConeRad, el error CRECERÍA con el tiempo, que
  // es lo contrario de "asentarse". Se toma el menor de los dos.
  const piso = Math.min(steadyRad, errorConeRad)
  if (reactionTimeS <= 0) return piso
  const t = Math.min(1, Math.max(0, timeSinceAcquiredS / reactionTimeS))
  return errorConeRad + (piso - errorConeRad) * t
}

/** Estado del PRNG del cono de error, un mulberry32 por bot -- mismo patrón
 *  que combat/spread.ts (SpreadState.rngState): estado mutable en vez de
 *  closure porque esto corre en un camino que no puede asignar un closure
 *  nuevo por tick. */
export interface AimBrainState {
  rngState: number
}

export function createAimBrainState(seed: number): AimBrainState {
  return { rngState: seed | 0 }
}

function nextRandom(state: AimBrainState): number {
  let a = state.rngState
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  state.rngState = a
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Offset angular de una muestra dentro del disco de radio `radius`
 *  (ángulo uniforme + radio con sqrt para densidad de área uniforme -- mismo
 *  método que combat/spread.ts sampleSpread). Escribe en `out`. */
export function sampleErrorOffset(state: AimBrainState, radius: number, out: YawPitch): void {
  const angle = nextRandom(state) * Math.PI * 2
  const r = radius * Math.sqrt(nextRandom(state))
  out.yaw = Math.cos(angle) * r
  out.pitch = Math.sin(angle) * r
}
