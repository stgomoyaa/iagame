/**
 * Cadencia y modo de disparo (sección 4 del spec de fase 1: "respetando el
 * fireRate y el fireMode del arquetipo -- auto, semi, burst"). engine/input.ts
 * expone estado sostenido, no flancos (ver su comentario de cabecera): semi
 * y ráfaga necesitan detectar el flanco de apretar el gatillo acá, no en el
 * input system.
 */

import type { WeaponArchetype } from '@/game/weapons/archetypes'

/** Disparos por ráfaga. Fijo: ar-2 es la única arma en modo burst hoy
 *  (sección 6 del spec) y no varía este número, así que no hace falta que
 *  sea un dato del arquetipo todavía. */
const BURST_SHOT_COUNT = 3

export interface FireControlState {
  ammo: number
  /** Segundos desde el último disparo, siempre clampeado a [0, intervalo]:
   *  nunca "banca" cadencia de fuego durante un período ocioso (ver
   *  stepFireControl más abajo). */
  timeSinceLastShot: number
  triggerHeldPrev: boolean
  /** Disparos de ráfaga pendientes de la pulsada de gatillo actual. */
  burstRemaining: number
  /** Flanco de semi-auto pendiente de dispensar. */
  semiPending: boolean
  wasReloading: boolean
}

export function fireInterval(archetype: WeaponArchetype): number {
  return 60 / archetype.fireRate
}

export function createFireControlState(archetype: WeaponArchetype): FireControlState {
  return {
    ammo: archetype.magazine,
    // Arranca "listo para disparar ya": el primer apretón de gatillo no
    // tiene que esperar un intervalo completo antes del primer tiro.
    timeSinceLastShot: fireInterval(archetype),
    triggerHeldPrev: false,
    burstRemaining: 0,
    semiPending: false,
    wasReloading: false,
  }
}

/** Reinicia munición y cadencia (cambio de arma). */
export function resetFireControl(state: FireControlState, archetype: WeaponArchetype): void {
  state.ammo = archetype.magazine
  state.timeSinceLastShot = fireInterval(archetype)
  state.triggerHeldPrev = false
  state.burstRemaining = 0
  state.semiPending = false
  state.wasReloading = false
}

/**
 * Detecta el fin de una recarga (flanco reloading true -> false) y rellena
 * el cargador. Se llama una vez por frame con el `reloading` que expone
 * ViewmodelState (weapons/viewmodel/rig.ts) — este módulo no lleva su
 * propio timer de recarga, reusa el que ya existe ahí en vez de duplicarlo.
 *
 * Devuelve `true` en el frame exacto en que la recarga terminó (cargador
 * recién rellenado): combat.ts lo usa para resetear también el índice del
 * patrón de retroceso (combat/recoil.ts) a 0 — una recarga TÁCTICA (antes
 * de vaciar el cargador) deja shotIndex en cualquier punto intermedio del
 * patrón, y sin este reset el próximo disparo con el cargador de nuevo
 * lleno heredaría el retroceso de la mitad de la carga anterior en vez de
 * arrancar limpio.
 */
export function syncReloadState(
  state: FireControlState,
  archetype: WeaponArchetype,
  reloading: boolean,
): boolean {
  const justCompleted = state.wasReloading && !reloading
  if (justCompleted) {
    state.ammo = archetype.magazine
  }
  if (reloading) {
    // Una recarga interrumpe cualquier ráfaga o semi pendiente: sin esto,
    // un burst en curso se reanudaría solo al terminar de recargar, sin
    // que el jugador haya vuelto a apretar el gatillo.
    state.burstRemaining = 0
    state.semiPending = false
  }
  state.wasReloading = reloading
  return justCompleted
}

/**
 * Avanza la cadencia de disparo un frame y devuelve cuántos disparos
 * corresponde efectuar AHORA (0, 1, o más de 1 si un frame largo tuvo que
 * ponerse al día — acotado en la práctica por MAX_FRAME_DT, ver
 * engine/constants.ts). `triggerHeld` es el estado sostenido del gatillo;
 * `reloading` bloquea el disparo entero.
 */
export function stepFireControl(
  state: FireControlState,
  archetype: WeaponArchetype,
  triggerHeld: boolean,
  reloading: boolean,
  dt: number,
): number {
  const interval = fireInterval(archetype)
  const pressedEdge = triggerHeld && !state.triggerHeldPrev
  state.triggerHeldPrev = triggerHeld

  if (reloading) {
    state.timeSinceLastShot = Math.min(state.timeSinceLastShot + dt, interval)
    return 0
  }

  if (archetype.fireMode === 'burst' && pressedEdge && state.burstRemaining === 0) {
    state.burstRemaining = BURST_SHOT_COUNT
  }
  if (archetype.fireMode === 'semi' && pressedEdge) {
    state.semiPending = true
  }

  state.timeSinceLastShot += dt

  let shots = 0
  for (;;) {
    if (state.timeSinceLastShot < interval) break
    if (state.ammo <= 0) break

    const wantsAuto = archetype.fireMode === 'auto' && triggerHeld
    const wantsBurst = archetype.fireMode === 'burst' && state.burstRemaining > 0
    const wantsSemi = archetype.fireMode === 'semi' && state.semiPending
    if (!wantsAuto && !wantsBurst && !wantsSemi) break

    shots++
    state.ammo--
    state.timeSinceLastShot -= interval
    if (wantsBurst) state.burstRemaining--
    if (wantsSemi) state.semiPending = false
  }

  // Ocioso (nada pendiente de disparar): clampear en vez de dejar crecer
  // timeSinceLastShot sin límite, o una pulsada después de estar mucho
  // tiempo ocioso dispararía una ráfaga "acumulada" de golpe.
  if (state.timeSinceLastShot > interval) state.timeSinceLastShot = interval

  return shots
}
