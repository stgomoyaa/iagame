/**
 * Conversión de color del generador de skins. Matemática pura, sin Three:
 * el generador vive en src/game/skins/ y su salida es data (tres floats en
 * 0..1), no un objeto de Three (ver el límite de módulos, sección 3 del
 * spec). El único archivo de skins que toca Three es material.ts, que es el
 * borde.
 *
 * Las paletas se escriben en hex porque es como se piensa un color a mano;
 * el jitter por seed se aplica en HSL porque rotar un tono y correr la
 * luminosidad son operaciones que en RGB no existen. De ahí que hagan falta
 * las dos conversiones.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** "#1f3550" -> {r,g,b} en 0..1. Acepta con o sin `#`. */
export function hexToRgb(hex: string): Rgb {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) throw new Error(`color hex inválido: "${hex}"`)
  const n = Number.parseInt(clean, 16)
  return {
    r: ((n >> 16) & 0xff) / 255,
    g: ((n >> 8) & 0xff) / 255,
    b: (n & 0xff) / 255,
  }
}

/** {r,g,b} en 0..1 -> "#1f3550". Para la UI, que dibuja swatches con CSS. */
export function rgbToHex(c: Rgb): string {
  const part = (v: number): string =>
    Math.round(Math.min(Math.max(v, 0), 1) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`
}

export interface Hsl {
  /** Tono en 0..1 (no en grados). */
  h: number
  s: number
  l: number
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return { h: h / 6, s, l }
}

function hueToChannel(p: number, q: number, tRaw: number): number {
  let t = tRaw
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) return { r: l, g: l, b: l }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: hueToChannel(p, q, h + 1 / 3),
    g: hueToChannel(p, q, h),
    b: hueToChannel(p, q, h - 1 / 3),
  }
}

export function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1)
}

/**
 * Variación por seed sobre un color de paleta: rota el tono y corre
 * saturación y luminosidad dentro de márgenes chicos.
 *
 * Los márgenes son chicos a propósito. El punto de las paletas curadas
 * (palettes.ts) es que ninguna combinación salga fea; un jitter grande
 * devuelve el problema que las paletas resuelven, porque un tono corrido 60°
 * ya no es el color que alguien eligió. Con ±5% de tono, dos skins de la
 * misma familia se distinguen sin que ninguna de las dos se salga del rango
 * que se validó a ojo.
 */
export function jitterColor(base: Rgb, hueShift: number, satScale: number, lightShift: number): Rgb {
  const hsl = rgbToHsl(base)
  return hslToRgb({
    h: (hsl.h + hueShift + 1) % 1,
    s: clamp01(hsl.s * satScale),
    l: clamp01(hsl.l + lightShift),
  })
}

/**
 * Contraste percibido entre dos colores, 0..1, por diferencia de luminancia
 * relativa. Lo usa el test de paletas: una skin cuyo color base y acento se
 * ven iguales no tiene patrón visible, y ése es exactamente el modo de falla
 * que convierte un generador de skins en "cuarenta variantes de gris" (nota
 * de la tarea). No es WCAG: no estamos midiendo legibilidad de texto.
 */
export function luminanceGap(a: Rgb, b: Rgb): number {
  const lum = (c: Rgb): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  return Math.abs(lum(a) - lum(b))
}
