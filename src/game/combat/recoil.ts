/**
 * Aplica el patrón determinista de retroceso (weapons/archetypes.ts) al
 * pitch/yaw de la cámara, más la recuperación hacia el origen al soltar el
 * gatillo (sección 3 del spec de fase 1). Matemática pura: nada de esto
 * depende de Three ni del motor de render.
 */

import { recoilOffsetForShot, type WeaponArchetype } from '@/game/weapons/archetypes'
import { clampPitch } from '@/game/engine/input'

export interface RecoilState {
  /** Disparo actual dentro del patrón (ver recoilOffsetForShot en
   *  archetypes.ts). Se resetea a 0 cuando se completa una recarga. */
  shotIndex: number
  /**
   * Desvío de pitch inyectado por el retroceso, radianes. Se SUMA al pitch
   * del jugador (nunca se escribe directo sobre el pitch de engine/input.ts),
   * así que el mouse sigue siendo la única fuente de verdad de hacia dónde
   * "apunta" el jugador antes de que el arma la empuje.
   */
  pitchOffset: number
  /** Igual que pitchOffset, pero horizontal. El yaw no tiene tope en este
   *  juego, así que no hace falta clampear esta componente. */
  yawOffset: number
}

export function createRecoilState(): RecoilState {
  return { shotIndex: 0, pitchOffset: 0, yawOffset: 0 }
}

/** Vuelve al reposo completo: cambio de arma. Resetea también el offset ya
 *  aplicado (a diferencia de resetRecoilPattern): un arma nueva no hereda
 *  ningún desvío de cámara de la anterior. */
export function resetRecoil(state: RecoilState): void {
  state.shotIndex = 0
  state.pitchOffset = 0
  state.yawOffset = 0
}

/**
 * Sólo reinicia el índice del patrón, sin tocar el offset ya aplicado (que
 * sigue recuperándose con su propia física vía stepRecoilRecovery). Se usa
 * al completarse una recarga (ver fire-control.ts: syncReloadState): un
 * cargador nuevo tiene que volver a arrancar el patrón desde el disparo 0,
 * pero la cámara no "salta" de vuelta a cero sólo porque el cargador se
 * rellenó — sigue donde estaba y decae normal.
 */
export function resetRecoilPattern(state: RecoilState): void {
  state.shotIndex = 0
}

/**
 * Aplica el impulso de un disparo: salta (no interpola) al valor
 * ACUMULADO del patrón para este índice — recoilOffsetForShot ya da la
 * posición objetivo de la cámara para ese disparo, no un delta a integrar
 * (ver el comentario de RecoilSpec.pattern en archetypes.ts: "y" es la
 * subida vertical acumulada). Avanza shotIndex para el próximo disparo.
 */
export function applyRecoilShot(state: RecoilState, archetype: WeaponArchetype): void {
  const [x, y] = recoilOffsetForShot(archetype, state.shotIndex)
  // y = subida del cañón. Un arma real levanta el cañón al disparar, así
  // que la cámara tiene que mirar más ARRIBA con cada disparo. En la
  // convención de pitch de engine/input.ts (mover el mouse hacia abajo
  // resta del pitch), "mirar arriba" es pitch positivo — por eso "y" entra
  // con signo positivo acá, sin invertir.
  state.pitchOffset = y
  state.yawOffset = x
  state.shotIndex++
}

/** Acerca `value` a 0 a razón de `ratePerSecond`, sin cruzar el cero: "sin
 *  pasarse" es una propiedad de la función, no algo a verificar aparte cada
 *  vez que se usa. */
function approachZero(value: number, ratePerSecond: number, dt: number): number {
  const step = ratePerSecond * dt
  if (value > 0) return Math.max(0, value - step)
  if (value < 0) return Math.min(0, value + step)
  return 0
}

/**
 * Recuperación: sólo corre mientras el gatillo NO está sostenido. Mientras
 * se sostiene, el patrón determinista (applyRecoilShot) ya es la única
 * fuente de la posición de la cámara — dejar que la recuperación compita
 * contra el patrón en simultáneo distorsionaría la curva ya calibrada de
 * cada arquetipo (sección 3 del spec: "los patrones ya están calibrados a
 * magnitudes físicas").
 */
export function stepRecoilRecovery(
  state: RecoilState,
  archetype: WeaponArchetype,
  firing: boolean,
  dt: number,
): void {
  if (firing) return
  state.pitchOffset = approachZero(state.pitchOffset, archetype.recoil.recovery, dt)
  state.yawOffset = approachZero(state.yawOffset, archetype.recoil.recovery, dt)
}

/**
 * Combina el pitch del jugador (mouse) con el offset de retroceso y
 * clampea la suma a PITCH_LIMIT. Es la única función que un llamador
 * necesita para el pitch final de cámara, así el clamp nunca se olvida en
 * un call site nuevo (sección 3 del spec: "una suma de retroceso más
 * movimiento del jugador puede llegar al tope aunque el patrón solo no").
 */
export function applyRecoilToPitch(playerPitch: number, state: RecoilState): number {
  return clampPitch(playerPitch + state.pitchOffset)
}

/** Yaw final de cámara: sin clamp, el yaw no tiene tope en este juego. */
export function applyRecoilToYaw(playerYaw: number, state: RecoilState): number {
  return playerYaw + state.yawOffset
}
