/**
 * Aplica el patrón determinista de retroceso (weapons/archetypes.ts) al
 * pitch/yaw de la cámara, más la recuperación hacia el origen al soltar el
 * gatillo (sección 3 del spec de fase 1). Matemática pura: nada de esto
 * depende de Three ni del motor de render.
 *
 * FIX (encontrado jugando): además de recuperar el offset de cámara ya
 * aplicado (pitchOffset/yawOffset), este módulo ahora también recupera
 * `shotIndex` -- la posición dentro del PATRÓN que el próximo disparo va a
 * leer. Antes sólo volvía a 0 al crear el arma o al completar una recarga:
 * vaciar medio cargador, soltar el gatillo diez segundos y volver a
 * disparar seguía dando el retroceso de fin de carga, como si el patrón
 * nunca se hubiera enfriado. Ver el comentario de cabecera de
 * stepRecoilRecovery más abajo para el razonamiento completo.
 */

import type { WeaponArchetype } from '@/game/weapons/archetypes'
import type { RecoilPattern } from '@/game/weapons/recoil-patterns'
import { clampPitch } from '@/game/engine/input'

export interface RecoilState {
  /**
   * Posición actual dentro del patrón (ver recoilOffsetForShot en
   * archetypes.ts). Se resetea a 0 cuando se completa una recarga
   * (resetRecoilPattern) y además DECAE de forma continua hacia 0 mientras
   * el gatillo está suelto (ver stepRecoilRecovery) -- por eso puede quedar
   * en un valor fraccionario, no sólo en los enteros que produce cada
   * disparo. applyRecoilShot interpola entre las dos entradas de patrón más
   * cercanas para ese caso (ver interpolatedRecoilOffset).
   */
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

// Scratch preasignado a nivel de módulo para interpolatedRecoilOffset: cero
// asignaciones por disparo (mismo patrón que scratchSpreadSample en
// combat/combat.ts).
const scratchOffset: [number, number] = [0, 0]

/**
 * Offset de retroceso para un shotIndex FRACCIONARIO. A diferencia de
 * recoilOffsetForShot (weapons/archetypes.ts), que sólo tiene sentido para
 * índices enteros (un disparo real siempre cae en uno), acá el índice puede
 * caer en cualquier punto entre dos entradas del patrón porque viene de la
 * recuperación continua (ver stepRecoilRecovery): tras una pausa parcial,
 * `state.shotIndex` puede ser, por ejemplo, 13.7.
 *
 * Decisión: INTERPOLAR linealmente entre las dos entradas adyacentes, no
 * redondear ni truncar.
 * - Truncar (floor) infravalora siempre: 13.9 (casi 14) daría el offset del
 *   disparo 13, un salto perceptible hacia atrás en cuanto se dispara el 14
 *   real un instante después.
 * - Redondear (round) da un escalón exacto en el punto medio (13.5) en vez
 *   de una curva -- sigue siendo un "cantil" en miniatura, la mitad de
 *   grande que el reset por umbral que este fix busca evitar.
 * - Interpolar es lo único que hace que la recuperación se sienta continua,
 *   coherente con la premisa central del fix (decaimiento continuo, nunca
 *   un salto).
 *
 * `clamped` cubre el caso `shotIndex < 0`, que no debería darse (stepRecoilRecovery
 * clampea al aplicar la recuperación) pero así la función es segura por si
 * algún llamador futuro pasa un valor crudo. Escribe en `out` en vez de
 * devolver un array nuevo: cero asignaciones por disparo.
 */
function interpolatedRecoilOffset(
  pattern: RecoilPattern,
  shotIndex: number,
  out: [number, number],
): void {
  const clamped = Math.max(0, shotIndex)
  const lowerWhole = Math.floor(clamped)
  const fraction = clamped - lowerWhole
  const lower = pattern[lowerWhole % pattern.length]
  const upper = pattern[(lowerWhole + 1) % pattern.length]
  out[0] = lower[0] + (upper[0] - lower[0]) * fraction
  out[1] = lower[1] + (upper[1] - lower[1]) * fraction
}

/**
 * Aplica el impulso de un disparo: salta (no interpola respecto del disparo
 * ANTERIOR) al valor ACUMULADO del patrón para el shotIndex actual --
 * recoilOffsetForShot/interpolatedRecoilOffset ya dan la posición objetivo
 * de la cámara para ese índice, no un delta a integrar (ver el comentario
 * de RecoilSpec.pattern en archetypes.ts: "y" es la subida vertical
 * acumulada). La interpolación que sí ocurre acá es DENTRO del patrón,
 * entre dos entradas adyacentes, cuando shotIndex quedó fraccionario por la
 * recuperación (ver interpolatedRecoilOffset). Avanza shotIndex en +1 para
 * el próximo disparo, preservando la parte fraccionaria: un disparo que cae
 * a mitad de recuperación (13.7) no "redondea" antes de avanzar, sigue
 * siendo 14.7 -- la recuperación parcial de antes del disparo se respeta
 * también después.
 *
 * `pattern` es un parámetro y no se lee del arquetipo porque el patrón es POR
 * ARMA, no por arquetipo: varias armas comparten arquetipo (el AK-47 y la M4A4
 * son las dos `ar-1`) y justamente lo que las distingue al dispararlas es su
 * dibujo de retroceso (ver weapons/recoil-patterns.ts). Por defecto cae al del
 * arquetipo, que es lo que corresponde a las armas sin patrón propio — las 40
 * CC0 y las de cadencia demasiado baja para acumular una forma.
 */
export function applyRecoilShot(
  state: RecoilState,
  archetype: WeaponArchetype,
  pattern: RecoilPattern = archetype.recoil.pattern,
): void {
  interpolatedRecoilOffset(pattern, state.shotIndex, scratchOffset)
  // y = subida del cañón. Un arma real levanta el cañón al disparar, así
  // que la cámara tiene que mirar más ARRIBA con cada disparo. En la
  // convención de pitch de engine/input.ts (mover el mouse hacia abajo
  // resta del pitch), "mirar arriba" es pitch positivo — por eso "y" entra
  // con signo positivo acá, sin invertir.
  state.pitchOffset = scratchOffset[1]
  state.yawOffset = scratchOffset[0]
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
 * Tasa de recuperación de `shotIndex`, en "disparos" por segundo. Se DERIVA
 * de `magazine / indexRecoveryTime` en vez de guardarse como un campo
 * aparte del arquetipo: así, si algún día se rebalancea el tamaño de un
 * cargador, la tasa sigue siendo coherente con el nuevo valor sin tocar
 * nada más (ver el comentario de RecoilSpec.indexRecoveryTime en
 * weapons/archetypes.ts, que también documenta la banda física de
 * referencia por arquetipo).
 */
export function indexRecoveryRate(archetype: WeaponArchetype): number {
  return archetype.magazine / archetype.recoil.indexRecoveryTime
}

/**
 * Recuperación: sólo corre mientras el gatillo NO está sostenido. Mientras
 * se sostiene, el patrón determinista (applyRecoilShot) ya es la única
 * fuente de la posición de la cámara — dejar que la recuperación compita
 * contra el patrón en simultáneo distorsionaría la curva ya calibrada de
 * cada arquetipo (sección 3 del spec: "los patrones ya están calibrados a
 * magnitudes físicas"). Por el mismo motivo, `shotIndex` (la posición
 * dentro del patrón, no el offset de cámara) usa exactamente el mismo gate
 * `firing`: si decayera incluso mientras se dispara, con una tasa de
 * recuperación deliberadamente MÁS RÁPIDA que la cadencia de disparo (ver
 * indexRecoveryRate más arriba y su test de propiedad en recoil.test.ts),
 * el índice nunca podría subir durante un spray sostenido -- la
 * recuperación le ganaría a la acumulación en cada frame y el patrón jamás
 * llegaría a su plateau.
 *
 * BUG que esto corrige (encontrado jugando, no en Vitest): `shotIndex`
 * nunca decaía con el tiempo, sólo se reseteaba a 0 al crear el arma o al
 * completar una recarga. Vaciar buena parte de un cargador, soltar el
 * gatillo diez segundos y volver a disparar seguía dando el retroceso de
 * FIN de carga en el primer tiro -- el patrón quedaba "caliente" para
 * siempre hasta la próxima recarga.
 *
 * Diseño elegido -- decaimiento CONTINUO, nunca un reset por umbral -- y
 * por qué:
 * - Es lo que hacen Source y CS de verdad: el índice de retroceso decae de
 *   forma continua, gobernado por un `recovery_time` por arma de más o
 *   menos 0.3-0.4s.
 * - Un umbral fijo crea un cantil explotable: spray completo a los 0.99s,
 *   cero a los 1.01s. Se aprende a cronometrar el borde exacto y se siente
 *   arbitrario, no físico.
 * - El decaimiento preserva la disciplina de ráfagas cortas como una
 *   habilidad real: disparar tres, soltar un instante y disparar tres más
 *   tiene que acumular PARCIALMENTE -- eso es justo lo que un buen jugador
 *   administra. Un reset binario elimina esa habilidad por completo.
 * - Toques espaciados nunca acumulan, que es exactamente la razón por la
 *   que tirar de a uno es preciso.
 *
 * `shotIndex` nunca es negativo (Math.max(0, ...), igual que approachZero
 * para pitch/yaw pero sin necesidad de manejar signo: el índice sólo crece
 * hacia arriba al disparar).
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
  state.shotIndex = Math.max(0, state.shotIndex - indexRecoveryRate(archetype) * dt)
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
