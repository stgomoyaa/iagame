/**
 * Conversor de sensibilidad entre juegos.
 *
 * Todo se apoya en una sola identidad: la distancia física que el mouse
 * recorre para girar 360 grados. Si dos juegos comparten ese número, la
 * memoria muscular se transfiere intacta, sin importar qué escala use cada
 * uno en su menú.
 *
 *   conteos para 360 = 360 / (yaw * sens)
 *   pulgadas         = conteos / dpi
 *   cm/360           = pulgadas * 2.54
 *
 * El módulo es matemática pura: sin React, sin Three, sin DOM. Se testea en
 * milisegundos y la UI lo consume desde afuera.
 */

import type { GameProfile } from '@/game/settings/games'

const CM_PER_INCH = 2.54

/** Distancia física en centímetros para completar un giro de 360 grados. */
export function cmPer360(sens: number, dpi: number, yaw: number): number {
  if (sens <= 0 || dpi <= 0 || yaw <= 0) return Number.POSITIVE_INFINITY
  return (360 / (yaw * sens)) * (CM_PER_INCH / dpi)
}

/** Sensibilidad necesaria para alcanzar un cm/360 dado. Inversa exacta de cmPer360. */
export function sensFromCmPer360(cm: number, dpi: number, yaw: number): number {
  if (cm <= 0 || dpi <= 0 || yaw <= 0) return 0
  return (360 / (yaw * cm)) * (CM_PER_INCH / dpi)
}

/**
 * eDPI: sensibilidad por DPI. Sólo es comparable DENTRO de un mismo juego.
 * Comparar el eDPI de Valorant contra el de CS no significa nada, porque las
 * escalas difieren por un factor de 3.18. Es el error más común al hablar de
 * sensibilidad y por eso la UI muestra el eDPI junto al juego, nunca solo.
 */
export function edpi(sens: number, dpi: number): number {
  return sens * dpi
}

export interface ConversionInput {
  from: GameProfile
  to: GameProfile
  sens: number
  /** DPI de origen. */
  dpi: number
  /**
   * DPI de destino. Distinto sólo si el jugador cambia de mouse o de perfil
   * de DPI al cambiar de juego, que es poco común pero pasa.
   */
  toDpi?: number
}

export interface ConversionResult {
  /** Sensibilidad a escribir en el juego destino. */
  sens: number
  /** Sensibilidad recortada al rango que el juego destino acepta. */
  clamped: number
  /** True si el valor ideal cae fuera de lo que el juego destino permite. */
  outOfRange: boolean
  /** cm/360 resultante, idéntico al de origen salvo que outOfRange sea true. */
  cmPer360: number
  /** cm/360 de origen, para comparar. */
  sourceCmPer360: number
  /** eDPI en el juego destino. */
  edpi: number
}

/**
 * Convierte manteniendo la distancia de 360 grados.
 *
 * Es independiente del FOV a propósito. Existe otro método (monitor distance
 * matching) que sí depende del FOV y ajusta para que un punto a cierto
 * porcentaje del ancho de pantalla quede a la misma distancia de mouse. Sirve
 * sobre todo para conversiones entre distintos niveles de zoom del MISMO
 * juego. Para pasar de un juego a otro, igualar 360 grados es lo que usa la
 * enorme mayoría de los jugadores, y es lo que este conversor hace.
 */
export function convert(input: ConversionInput): ConversionResult {
  const { from, to, sens, dpi } = input
  const toDpi = input.toDpi ?? dpi

  const sourceCm = cmPer360(sens, dpi, from.yaw)
  const ideal = sensFromCmPer360(sourceCm, toDpi, to.yaw)

  const clamped = Math.min(Math.max(ideal, to.range.min), to.range.max)
  const outOfRange = clamped !== ideal

  return {
    sens: ideal,
    clamped,
    outOfRange,
    cmPer360: cmPer360(clamped, toDpi, to.yaw),
    sourceCmPer360: sourceCm,
    edpi: edpi(clamped, toDpi),
  }
}

/**
 * Formatea con los decimales que muestra el juego destino, para que el número
 * se pueda tipear tal cual en su menú sin que el jugador tenga que redondear.
 */
export function formatForGame(sens: number, profile: GameProfile): string {
  return sens.toFixed(profile.decimals)
}
