/**
 * Cono de dispersión aleatorio (sección 3 del spec de fase 1): crece con
 * fuego sostenido, se cierra al soltar el gatillo. Va ENCIMA del patrón
 * determinista de retroceso (combat/recoil.ts) — el patrón mueve la cámara
 * de forma aprendible y repetible; la dispersión perturba apenas la
 * trayectoria de CADA bala individual, con su propia fuente de
 * aleatoriedad (mulberry32, la misma familia que generateRecoilPattern en
 * weapons/archetypes.ts) para no depender de Math.random() en el camino de
 * disparo.
 */

import type { SpreadCurve } from '@/game/weapons/archetypes'

/**
 * Velocidad (m/s) a la que la penalización de dispersión por movimiento
 * (SpreadCurve.movementPenalty) satura. Es la walkSpeed del jugador
 * (movement/tuning.ts: 5.0): moverse a paso normal ya paga la penalización
 * completa; correr/bhopear no penaliza MÁS (ya está al tope). Se declara acá
 * como constante y no se importa de movement/ para no atar el sistema de
 * combate (matemática pura) a la capa de movimiento — es el mismo criterio de
 * desacople que ya usa el resto de combat/. Si walkSpeed cambiara, este número
 * se ajusta a mano (y hay un test que lo ancla).
 */
export const MOVEMENT_SPREAD_REFERENCE_SPEED = 5

export interface SpreadState {
  /** Radio actual del cono, radianes. Arranca en spreadCurve.base. */
  radius: number
  /** Estado del PRNG (mulberry32), avanza en cada muestra. */
  rngState: number
}

export function createSpreadState(curve: SpreadCurve, seed: number): SpreadState {
  return { radius: curve.base, rngState: seed }
}

/** Vuelve al reposo (cargador nuevo / cambio de arma). */
export function resetSpread(state: SpreadState, curve: SpreadCurve): void {
  state.radius = curve.base
}

/** Crece el cono en growthPerShot, sin pasar de max. Se llama una vez por disparo. */
export function growSpread(state: SpreadState, curve: SpreadCurve): void {
  state.radius = Math.min(curve.max, state.radius + curve.growthPerShot)
}

/** Cierra el cono hacia `base` a razón de recoverySpeed, sin pasarse por
 *  debajo. Corre todos los frames en que NO se está disparando. */
export function stepSpreadRecovery(
  state: SpreadState,
  curve: SpreadCurve,
  firing: boolean,
  dt: number,
): void {
  if (firing) return
  if (state.radius <= curve.base) return
  state.radius = Math.max(curve.base, state.radius - curve.recoverySpeed * dt)
}

/**
 * mulberry32, adaptado a estado mutable en vez de closure (comparar con
 * generateRecoilPattern en weapons/archetypes.ts, que sí puede usar un
 * closure porque corre una sola vez al definir el arquetipo). Esto corre en
 * el camino de disparo: no puede asignar un closure nuevo por llamada, así
 * que muta `state.rngState` in place y devuelve un float en [0, 1).
 */
export function nextRandom(state: SpreadState): number {
  let a = state.rngState
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  state.rngState = a
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/**
 * Radianes de dispersión que suma moverse a `moveSpeed` m/s (el eje táctico
 * CS/COD). Rampa lineal desde 0 en reposo hasta `curve.movementPenalty` a la
 * velocidad de referencia, y ahí satura. Es un TÉRMINO TRANSITORIO: depende de
 * la velocidad de ESTE frame, así que se suma en el momento de muestrear (no
 * se acumula en state.radius, que es el crecimiento por fuego sostenido, otra
 * cosa). El estilo (CS grande, COD chico) ya está horneado en
 * curve.movementPenalty vía EFFECTIVE_ARCHETYPES.
 */
export function movementSpread(curve: SpreadCurve, moveSpeed: number): number {
  if (moveSpeed <= 0) return 0
  const t = Math.min(1, moveSpeed / MOVEMENT_SPREAD_REFERENCE_SPEED)
  return curve.movementPenalty * t
}

/** Offset angular de una muestra de dispersión. Preasignado por el llamador. */
export interface SpreadSample {
  dPitch: number
  dYaw: number
}

/**
 * Muestrea un offset uniforme dentro del disco de radio `state.radius +
 * extraRadius` (ángulo uniforme + radio con sqrt para densidad de área
 * uniforme, no concentrada en el centro) y lo escribe en `out` (preasignado).
 * Aproxima el cono como un disco plano en espacio de ángulos: válido para los
 * radios de este arsenal (0.0005-0.05 rad en reposo/sostenido; con la
 * penalización de movimiento de CS puede llegar a ~0.055 rad, ~3°, donde la
 * aproximación plana sigue siendo indistinguible de la esférica).
 *
 * `extraRadius` (por defecto 0) es la dispersión transitoria por movimiento
 * (ver movementSpread): se suma al radio del cono en el momento de muestrear,
 * no se acumula en el estado. Por defecto 0 deja el comportamiento parado
 * idéntico al de antes de existir el eje táctico.
 */
export function sampleSpread(state: SpreadState, out: SpreadSample, extraRadius = 0): void {
  const radius = state.radius + extraRadius
  const angle = nextRandom(state) * Math.PI * 2
  const r = radius * Math.sqrt(nextRandom(state))
  out.dPitch = Math.sin(angle) * r
  out.dYaw = Math.cos(angle) * r
}
