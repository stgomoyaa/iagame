/**
 * Ruido y helpers de color para teselas **periódicas por construcción**.
 *
 * El requisito duro del sistema de skins es que una tesela se repita sin
 * costura, porque se aplica sobre 79 modelos con UV completamente distintos:
 * no hay forma de "acomodar" la tesela por arma. Hay dos maneras de llegar a
 * eso y sólo una es confiable:
 *
 *   - **A posteriori**: generar ruido cualquiera y despues arreglar el borde
 *     (offset + clonar, blend cruzado). Deja un fantasma visible en la
 *     diagonal y arruina el detalle justo en la costura. Es lo que hace la
 *     mayoria de los "seamless maker".
 *   - **Por construcción**: que la función *sea* periódica, así f(u+1) = f(u)
 *     exactamente, y el borde no exista como caso especial.
 *
 * Acá se hace lo segundo. El truco es que la retícula del ruido de valor se
 * indexa con `pmod(celda, periodo)`: la celda -1 y la celda P-1 son el mismo
 * hash, así que los dos bordes del mosaico leen literalmente los mismos
 * valores. No hay error residual que medir; es igualdad de bits.
 *
 * La condición que hay que respetar al usarlo: **el periodo tiene que ser
 * entero en todas las octavas**. Por eso fbm arranca de un número entero de
 * celdas y duplica (2, 4, 8...): si alguien pasa 3.5 celdas, `pmod` deja de
 * alinear con el borde del mosaico y vuelve la costura sin avisar.
 */

/** Módulo que devuelve siempre positivo (el `%` de JS conserva el signo). */
export function pmod(a: number, n: number): number {
  return ((a % n) + n) % n
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Quintica de Perlin: derivada segunda continua, así el fbm no muestra la retícula. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * Hash entero -> [0,1). Determinista y sin estado: la tesela se regenera
 * idéntica en cualquier máquina, que es la misma garantía que ya pide
 * generator.ts para las skins.
 */
export function hashCell(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Ruido de valor bilineal periódico. `period` es el número de celdas que
 * entran en el mosaico completo; se asume que `x`/`y` ya vienen escalados a
 * esa retícula (o sea x = u * period).
 *
 * `periodY` existe para el caso de las tramas **inclinadas**, donde los dos
 * ejes no llevan la misma cantidad de celdas. Ojo con ese caso: si el
 * argumento x depende de v (una veta diagonal, tipo `(u + v*0.25)*220`), no
 * alcanza con que cada eje sea periódico por separado — el corrimiento que
 * mete v sobre el eje x tiene que ser múltiplo de `period`, o el borde de
 * arriba lee celdas distintas que el de abajo. Es exactamente el error que
 * tuvo la veta del damasco.
 */
export function noise2p(
  x: number,
  y: number,
  period: number,
  seed: number,
  periodY: number = period,
): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = fade(x - xi)
  const v = fade(y - yi)

  const x0 = pmod(xi, period)
  const x1 = pmod(xi + 1, period)
  const y0 = pmod(yi, periodY)
  const y1 = pmod(yi + 1, periodY)

  const a = hashCell(x0, y0, seed)
  const b = hashCell(x1, y0, seed)
  const c = hashCell(x0, y1, seed)
  const d = hashCell(x1, y1, seed)

  return lerp(lerp(a, b, u), lerp(c, d, u), v)
}

/**
 * fBm periódico sobre coordenadas normalizadas u,v en [0,1).
 *
 * `cells` es entero y cada octava duplica: el periodo sigue siendo entero
 * octava a octava, que es la condición para que el mosaico cierre (ver
 * cabecera). `gain` 0.5 es el estándar de fBm; bajarlo aplana, subirlo
 * granula.
 */
export function fbmP(
  u: number,
  v: number,
  cells: number,
  octaves: number,
  seed: number,
  gain = 0.5,
): number {
  let amp = 1
  let sum = 0
  let norm = 0
  let f = cells
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2p(u * f, v * f, f, seed + i * 1013)
    norm += amp
    amp *= gain
    f *= 2
  }
  return sum / norm
}

/**
 * fBm "ridged": pliega el ruido sobre 0.5 para que los máximos queden como
 * crestas afiladas en vez de lomas suaves. Es lo que convierte una mancha en
 * una veta, y es la base tanto del damasco como de la filigrana.
 */
export function ridgedP(
  u: number,
  v: number,
  cells: number,
  octaves: number,
  seed: number,
  gain = 0.5,
): number {
  let amp = 1
  let sum = 0
  let norm = 0
  let f = cells
  for (let i = 0; i < octaves; i++) {
    const n = noise2p(u * f, v * f, f, seed + i * 1013)
    sum += amp * (1 - Math.abs(2 * n - 1))
    norm += amp
    amp *= gain
    f *= 2
  }
  return sum / norm
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/** HSV -> RGB en 0..1. Se usa para el barrido de tono del arcoíris. */
export function hsv(h: number, s: number, v: number): Rgb {
  const hh = pmod(h, 1) * 6
  const i = Math.floor(hh)
  const f = hh - i
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  switch (i % 6) {
    case 0:
      return { r: v, g: t, b: p }
    case 1:
      return { r: q, g: v, b: p }
    case 2:
      return { r: p, g: v, b: t }
    case 3:
      return { r: p, g: q, b: v }
    case 4:
      return { r: t, g: p, b: v }
    default:
      return { r: v, g: p, b: q }
  }
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) }
}

export function scaleRgb(a: Rgb, k: number): Rgb {
  return { r: a.r * k, g: a.g * k, b: a.b * k }
}

/** `#rrggbb` -> Rgb lineal-ish en 0..1 (se queda en sRGB, es una tesela de autor). */
export function hex(code: string): Rgb {
  const n = Number.parseInt(code.replace('#', ''), 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

/**
 * Lienzo RGBA con escritura **envolvente**: escribir en x = -3 escribe en
 * x = ancho-3. Es la otra mitad de la teselabilidad, la que necesitan los
 * patrones hechos de sellos (las hojas): un sello que cae sobre el borde se
 * pinta partido en el lado opuesto, así que al repetir el mosaico la hoja se
 * reconstruye entera y cruzando la costura. Es lo que evita el "marco" de
 * hojas cortadas que delata una tesela de sellos mal hecha.
 */
export class WrapCanvas {
  readonly size: number
  readonly data: Uint8ClampedArray

  constructor(size: number) {
    this.size = size
    this.data = new Uint8ClampedArray(size * size * 4)
  }

  index(x: number, y: number): number {
    return (pmod(y, this.size) * this.size + pmod(x, this.size)) * 4
  }

  set(x: number, y: number, c: Rgb, alpha = 1): void {
    const i = this.index(x, y)
    const d = this.data
    if (alpha >= 1) {
      d[i] = c.r * 255
      d[i + 1] = c.g * 255
      d[i + 2] = c.b * 255
      d[i + 3] = 255
      return
    }
    d[i] = lerp(d[i], c.r * 255, alpha)
    d[i + 1] = lerp(d[i + 1], c.g * 255, alpha)
    d[i + 2] = lerp(d[i + 2], c.b * 255, alpha)
    d[i + 3] = 255
  }

  toRgba(): Uint8Array {
    return new Uint8Array(this.data.buffer.slice(0))
  }
}
