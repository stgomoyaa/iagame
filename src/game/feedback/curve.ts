/**
 * Puñado de funciones puras compartidas por varios módulos de feedback
 * (clamp/lerp/ángulos). Un solo archivo chico en vez de repetirlas cinco
 * veces: a diferencia de un `clamp01` que aparece una sola vez en un
 * módulo (rig.ts), acá las usan hitmarkers.ts, damage-numbers.ts, shake.ts,
 * vignette.ts y health-vfx.ts por igual.
 */

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Acerca `value` a 0 a razón de `ratePerSecond`, sin cruzar el cero (mismo
 *  patrón que approachZero en combat/recoil.ts, duplicado acá para no crear
 *  una dependencia cruzada entre feedback/ y combat/ por una función de
 *  tres líneas). */
export function approachZero(value: number, ratePerSecond: number, dt: number): number {
  const step = ratePerSecond * dt
  if (value > 0) return Math.max(0, value - step)
  if (value < 0) return Math.min(0, value + step)
  return 0
}

/** Normaliza un ángulo a (-PI, PI]. */
export function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2)
  if (a > Math.PI) a -= Math.PI * 2
  if (a <= -Math.PI) a += Math.PI * 2
  return a
}
