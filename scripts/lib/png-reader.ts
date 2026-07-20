/**
 * Decodificador de PNG real (el que produce cualquier herramienta, no sólo
 * `encodePng` de este repo), sin dependencias: node:zlib para inflar y
 * desfiltrado propio para los 5 filtros del spec.
 *
 * Por qué existe además de `decodePngForTest` (png-writer.ts): ese lector
 * sólo entiende filtro 0, que es lo único que `encodePng` escribe. Alcanza
 * para un round-trip contra nuestro propio encoder y nada más. Las texturas
 * que vienen embebidas en los GLB del Workshop las escribió otra
 * herramienta, y usa el filtrado adaptativo normal (elige por fila entre
 * Sub/Up/Average/Paeth según cuál comprime mejor): con `decodePngForTest`
 * lanzan en la primera fila. Este archivo es el que hace falta para leer un
 * PNG de afuera.
 *
 * Alcance deliberado: profundidad de 8 bits y color RGB (tipo 2) o RGBA
 * (tipo 6), sin entrelazado. Es exactamente lo que traen las 57 texturas de
 * los GLB convertidos (verificado leyendo el IHDR de todas). Cualquier otra
 * combinación lanza con el detalle de qué encontró en vez de devolver
 * píxeles corridos: un decodificador que "casi" funciona sobre paleta o
 * 16 bits produce basura silenciosa, que es peor que no leer el archivo.
 */

import { inflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const COLOR_TYPE_RGB = 2
const COLOR_TYPE_RGBA = 6

/** Canales por píxel según el tipo de color del IHDR. */
const CHANNELS_BY_COLOR_TYPE: Record<number, number> = {
  [COLOR_TYPE_RGB]: 3,
  [COLOR_TYPE_RGBA]: 4,
}

export interface DecodedPng {
  readonly width: number
  readonly height: number
  /** Siempre RGBA8888 plano, sin importar si el archivo era RGB o RGBA. */
  readonly rgba: Uint8Array
}

/**
 * Deshace el filtro de una fila, en el lugar.
 *
 * El desfiltrado es secuencial por construcción: cada byte se reconstruye a
 * partir de bytes YA reconstruidos (el de la izquierda, el de arriba, el de
 * arriba a la izquierda), nunca de los filtrados. Por eso `row` se va
 * pisando a medida que avanza y `prev` es la fila anterior ya desfiltrada.
 * Hacerlo sobre la fila filtrada original -el error clásico- da una imagen
 * que se degrada progresivamente hacia abajo en vez de fallar de golpe.
 *
 * `bpp` es la distancia en bytes al píxel de la izquierda (bytes por píxel).
 * Para los primeros `bpp` bytes de la fila no hay píxel izquierdo y vale 0,
 * que es lo que dice el spec, no un caso especial nuestro.
 */
function unfilterRow(filter: number, row: Uint8Array, prev: Uint8Array, bpp: number): void {
  const len = row.length
  switch (filter) {
    case 0: // None
      return
    case 1: // Sub: el byte a la izquierda
      for (let i = bpp; i < len; i++) row[i] = (row[i] + row[i - bpp]) & 0xff
      return
    case 2: // Up: el byte de arriba
      for (let i = 0; i < len; i++) row[i] = (row[i] + prev[i]) & 0xff
      return
    case 3: // Average: promedio (truncado) de izquierda y arriba
      for (let i = 0; i < len; i++) {
        const left = i >= bpp ? row[i - bpp] : 0
        row[i] = (row[i] + ((left + prev[i]) >> 1)) & 0xff
      }
      return
    case 4: // Paeth: el predictor de los tres vecinos
      for (let i = 0; i < len; i++) {
        const a = i >= bpp ? row[i - bpp] : 0 // izquierda
        const b = prev[i] // arriba
        const c = i >= bpp ? prev[i - bpp] : 0 // arriba-izquierda
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        row[i] = (row[i] + pred) & 0xff
      }
      return
    default:
      throw new Error(`decodePng: tipo de filtro ${filter} desconocido (el spec define 0..4)`)
  }
}

/** Decodifica un .png completo a RGBA8888 plano. */
export function decodePng(png: Buffer): DecodedPng {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('decodePng: firma de PNG inválida')
  }

  // Recorrido de chunks. IDAT puede venir partido en varios: el stream de
  // deflate es la concatenación de todos, no cada uno por su cuenta.
  let ihdr: Buffer | null = null
  const idat: Buffer[] = []
  let pos = 8
  while (pos + 8 <= png.length) {
    const length = png.readUInt32BE(pos)
    const type = png.toString('ascii', pos + 4, pos + 8)
    const data = png.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') ihdr = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + length
  }

  if (!ihdr) throw new Error('decodePng: falta el chunk IHDR')
  if (idat.length === 0) throw new Error('decodePng: falta el chunk IDAT')

  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]
  const colorType = ihdr[9]
  const interlace = ihdr[12]

  if (bitDepth !== 8) {
    throw new Error(`decodePng: profundidad ${bitDepth} no soportada (sólo 8 bits)`)
  }
  if (interlace !== 0) {
    throw new Error('decodePng: PNG entrelazado (Adam7) no soportado')
  }
  const channels = CHANNELS_BY_COLOR_TYPE[colorType]
  if (channels === undefined) {
    throw new Error(`decodePng: tipo de color ${colorType} no soportado (sólo 2=RGB y 6=RGBA)`)
  }

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const expected = (stride + 1) * height
  if (raw.length < expected) {
    throw new Error(`decodePng: datos insuficientes (${raw.length} bytes, se esperaban ${expected})`)
  }

  const rgba = new Uint8Array(width * height * 4)
  // Fila anterior desfiltrada. Para la primera fila el spec manda tratarla
  // como todos ceros, así que se arranca con un buffer en cero y se reusa.
  let prev = new Uint8Array(stride)
  let current = new Uint8Array(stride)

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    const filter = raw[rowStart]
    current.set(raw.subarray(rowStart + 1, rowStart + 1 + stride))
    unfilterRow(filter, current, prev, channels)

    const out = y * width * 4
    if (channels === 4) {
      rgba.set(current, out)
    } else {
      // RGB -> RGBA: alfa opaco. No hay canal de transparencia que perder.
      for (let x = 0; x < width; x++) {
        rgba[out + x * 4] = current[x * 3]
        rgba[out + x * 4 + 1] = current[x * 3 + 1]
        rgba[out + x * 4 + 2] = current[x * 3 + 2]
        rgba[out + x * 4 + 3] = 255
      }
    }

    // Swap en vez de copiar: la fila que acabamos de desfiltrar pasa a ser
    // "la de arriba" de la próxima, y el buffer viejo se reusa como destino.
    const tmp = prev
    prev = current
    current = tmp
  }

  return { width, height, rgba }
}

/**
 * Color de la textura en coordenadas UV de glTF, promediado sobre una
 * ventana de `AVERAGE_RADIUS` téxeles alrededor del punto.
 *
 * Devuelve los tres canales en 0..1, en el MISMO espacio en que están los
 * bytes del PNG (sRGB para una textura de color base). Quien llama decide si
 * los convierte; ver el horneado en convert-source-weapons.ts.
 *
 * El promedio no es cosmético: un vértice cae casi siempre sobre una costura
 * del mapa UV (es donde se cortan las islas), y ahí el téxel exacto puede
 * ser el borde negro del atlas o el relleno de la isla vecina. Promediar una
 * ventana chica hace que una costura no decida el color de todo un vértice,
 * que en un modelo de ~3.000 triángulos se ve como una mancha del tamaño de
 * media pieza.
 *
 * La V se invierte: glTF define el origen de UV arriba a la izquierda y las
 * filas del PNG también van de arriba hacia abajo, pero los muestreadores de
 * imagen de glTF interpretan V creciente hacia ABAJO — el mismo convenio del
 * PNG — así que la fila es `v * height` directo. Se deja explícito acá para
 * que no se "corrija" por reflejo: si el horneado sale espejado en vertical,
 * ESTA línea es la sospechosa.
 */
const AVERAGE_RADIUS = 1

export function samplePngRgb(
  png: DecodedPng,
  u: number,
  v: number,
): { r: number; g: number; b: number } {
  const { width, height, rgba } = png
  // Repetición (wrap): las UV de un modelo de Source pueden salirse de
  // [0,1] a propósito para repetir una banda de textura.
  const wrap = (t: number, n: number): number => {
    const i = Math.floor(t * n) % n
    return i < 0 ? i + n : i
  }
  const cx = wrap(u, width)
  const cy = wrap(v, height)

  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let dy = -AVERAGE_RADIUS; dy <= AVERAGE_RADIUS; dy++) {
    for (let dx = -AVERAGE_RADIUS; dx <= AVERAGE_RADIUS; dx++) {
      const x = ((cx + dx) % width + width) % width
      const y = ((cy + dy) % height + height) % height
      const o = (y * width + x) * 4
      r += rgba[o]
      g += rgba[o + 1]
      b += rgba[o + 2]
      n++
    }
  }
  return { r: r / n / 255, g: g / n / 255, b: b / n / 255 }
}
