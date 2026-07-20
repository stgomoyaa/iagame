/**
 * Atlas de lightmap de un .bsp de Source: junta las muestras horneadas de
 * LUMP_LIGHTING (una grilla chica por cara) en UNA textura, y devuelve dónde
 * quedó cada cara para que `bsp-convert.ts` pueda escribir el segundo juego
 * de UV.
 *
 * POR QUÉ ATLAS Y NO COLOR POR VÉRTICE
 * ------------------------------------
 * Las dos opciones se midieron sobre dm_nuketown antes de elegir, porque la
 * barata (hornear a color por vértice) sólo sirve si las caras son chicas o
 * la luz varía poco dentro de cada una. Ninguna de las dos cosas pasa:
 *
 *   - 5034 caras con lightmap, 202331 luxels, **40 luxels por cara** contra
 *     **5.17 vértices por cara**. O sea que el promedio de las caras trae 8
 *     veces más información de luz que vértices donde guardarla.
 *   - Las caras que dominan lo que se ve son peores: las más grandes son de
 *     ~89 m² con **4 vértices y 1089 luxels** (33x33). Hornear eso a
 *     vértices deja el piso y las paredes grandes con UN valor por esquina,
 *     interpolado en degradé: exactamente el manchón que había que evitar.
 *   - Ponderando por área, el **75% del mapa** (6753 m² de 9015) está en
 *     caras donde la luz varía fuerte (coeficiente de variación > 0.25) Y
 *     hay muchos más luxels que vértices. Ese 75% es el que el color por
 *     vértice aplasta.
 *
 * Con esos números el atlas no es "lo que hace Source, así que copiémoslo":
 * es la única de las dos que conserva la sombra proyectada, que es
 * justamente lo que hace que el mapa deje de leerse como maqueta.
 *
 * El costo de construirlo es chico porque las caras son chicas: la más
 * grande es 33x33 luxels, así que todo entra en un atlas de pocos MB (ver
 * `construirAtlas`).
 */

import {
  type Lump,
  LUMP_FACES,
  LUMP_LIGHTING,
  LUMP_TEXINFO,
  TAM_FACE,
  TAM_TEXINFO,
} from './bsp.ts'

/** Margen en texeles alrededor de cada cara dentro del atlas. */
const PADDING = 1

export interface RectAtlas {
  x: number
  y: number
  w: number
  h: number
}

export interface CaraLightmap {
  /** Índice de la cara en LUMP_FACES. */
  cara: number
  /** Offset en bytes dentro de LUMP_LIGHTING de la primera muestra. */
  lightofs: number
  /** Grilla de muestras: (LightmapTextureSizeInLuxels + 1). */
  w: number
  h: number
  /** LightmapTextureMinsInLuxels, para pasar de posición a luxel. */
  minU: number
  minV: number
  /** lightmapVecs[0] y [1] de su texinfo (xyz + offset). */
  vecU: [number, number, number, number]
  vecV: [number, number, number, number]
}

/**
 * Metadata de lightmap de cada cara que TIENE lightmap. Las caras con
 * `lightofs < 0` (366 en nuketown: cielo y herramientas) no entran: no
 * tienen muestras y pedirles UV de lightmap no significa nada.
 */
export function leerCarasConLightmap(buf: Buffer, lumps: Lump[]): CaraLightmap[] {
  const lF = lumps[LUMP_FACES]
  const lTI = lumps[LUMP_TEXINFO]
  const nF = Math.floor(lF.largo / TAM_FACE)
  const nTI = Math.floor(lTI.largo / TAM_TEXINFO)
  const out: CaraLightmap[] = []

  for (let f = 0; f < nF; f++) {
    const o = lF.offset + f * TAM_FACE
    const lightofs = buf.readInt32LE(o + 20)
    if (lightofs < 0) continue
    const ti = buf.readInt16LE(o + 10)
    if (ti < 0 || ti >= nTI) continue

    // dface_t: mins en +28/+32, size en +36/+40. El tamaño guardado es el
    // ÚLTIMO índice, no la cantidad: la grilla de muestras es size+1.
    const minU = buf.readInt32LE(o + 28)
    const minV = buf.readInt32LE(o + 32)
    const w = buf.readInt32LE(o + 36) + 1
    const h = buf.readInt32LE(o + 40) + 1
    if (w <= 0 || h <= 0) continue

    // texinfo_t: textureVecs en 0..31, lightmapVecs en 32..63. Son vectores
    // DISTINTOS de los de textura (la escala del lightmap es típicamente
    // 1/16 de la del albedo); usar textureVecs acá da un atlas que parece
    // correcto y está muestreado en el lugar equivocado.
    const oti = lTI.offset + ti * TAM_TEXINFO
    const vec4 = (base: number): [number, number, number, number] => [
      buf.readFloatLE(base),
      buf.readFloatLE(base + 4),
      buf.readFloatLE(base + 8),
      buf.readFloatLE(base + 12),
    ]

    out.push({
      cara: f,
      lightofs,
      w,
      h,
      minU,
      minV,
      vecU: vec4(oti + 32),
      vecV: vec4(oti + 48),
    })
  }

  return out
}

/**
 * Muestra ColorRGBExp32 -> color lineal (sin normalizar). El exponente es
 * con SIGNO: leerlo como byte sin signo manda todo lo oscuro (exp negativo)
 * a valores gigantes y el mapa sale blanco.
 */
export function decodificarMuestra(buf: Buffer, offset: number): [number, number, number] {
  const e = Math.pow(2, buf.readInt8(offset + 3))
  return [buf.readUInt8(offset) * e, buf.readUInt8(offset + 1) * e, buf.readUInt8(offset + 2) * e]
}

/**
 * Empaquetado por estantes: se ordenan las caras por alto y se van llenando
 * filas. Es O(n log n) y deja poco hueco cuando los rectángulos son chicos y
 * parecidos, que es exactamente este caso (la cara más grande es 33x33).
 * Un empaquetador más sofisticado no cambiaría el tamaño del atlas lo
 * suficiente como para justificarlo.
 *
 * Devuelve null si no entra en `lado x lado`.
 */
export function empacar(
  tamanos: ReadonlyArray<{ w: number; h: number }>,
  lado: number,
): RectAtlas[] | null {
  const orden = tamanos.map((t, i) => i).sort((a, b) => tamanos[b].h - tamanos[a].h)
  const rects: RectAtlas[] = new Array(tamanos.length)

  let x = 0
  let y = 0
  let altoFila = 0

  for (const i of orden) {
    const w = tamanos[i].w + PADDING * 2
    const h = tamanos[i].h + PADDING * 2
    if (w > lado || h > lado) return null

    if (x + w > lado) {
      // Fila llena: bajar a la siguiente.
      y += altoFila
      x = 0
      altoFila = 0
    }
    if (y + h > lado) return null

    rects[i] = { x: x + PADDING, y: y + PADDING, w: tamanos[i].w, h: tamanos[i].h }
    x += w
    if (h > altoFila) altoFila = h
  }

  return rects
}

export interface Atlas {
  ancho: number
  alto: number
  /** RGBA8888, listo para `encodePng`. */
  rgba: Uint8Array
  /** Paralelo a la lista de `leerCarasConLightmap`. */
  rects: RectAtlas[]
  caras: CaraLightmap[]
  /**
   * Texel BLANCO reservado, para las caras visibles que no tienen lightmap.
   *
   * En nuketown son 216 caras: existen, se dibujan, y `lightofs` les da -1.
   * Mandarlas a un UV cualquiera (el (0,0) del atlas, por ejemplo) las deja
   * multiplicadas por lo que haya caído ahí -- que es negro o la luz de una
   * pared ajena -- y salen apagadas en medio del mapa. Con un texel blanco
   * reservado, multiplicar por él es la identidad y esas caras quedan a
   * albedo pleno, que es exactamente lo que hacía el importador antes de
   * que existiera el lightmap.
   */
  blanco: RectAtlas
  /** Divisor de exposición aplicado (ver `construirAtlas`). */
  exposicion: number
  /** Fracción del atlas efectivamente ocupada por muestras. */
  ocupacion: number
}

/**
 * Codificación sRGB estándar (IEC 61966-2-1). El atlas se guarda GAMMA-
 * CODIFICADO y no lineal porque son 8 bits por canal: en lineal, la mitad
 * inferior del rango (que acá es el 25% de las muestras, todo lo que está
 * en sombra) se cuantiza a un puñado de valores y las sombras salen en
 * bandas. three lo devuelve a lineal al muestrear, siempre que la textura
 * se marque `SRGBColorSpace` (lo hace map/external-map.ts).
 */
function aSrgb(lineal: number): number {
  const c = Math.min(1, Math.max(0, lineal))
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

/**
 * Percentil de luminancia que se mapea a blanco.
 *
 * Las muestras de Source NO están normalizadas a [0,1]: en nuketown la
 * luminancia lineal llega a 2.69 y el 35% de las muestras pasa de 1.0.
 * Recortar en 1.0 quemaría todo el exterior a blanco plano y borraría
 * justamente el degradé del sol. Se divide por un percentil en vez de por
 * una constante fija porque una constante afinada mirando nuketown deja
 * negro cualquier mapa más oscuro.
 *
 * POR QUÉ p90 Y NO UN PERCENTIL MÁS ALTO: la primera versión usaba p99.5 y
 * ROMPIÓ gm_lasertag_arena. Ese mapa tiene la luz apretada alrededor de 0.5
 * (p50=0.478, p75=0.580, p90=0.670) más una cola finita de neones que llega
 * a 2.86. El p99.5 cae en esa cola, así que dividía TODO por 2.86 y dejaba
 * la arena entera al 45% -- con su albedo ya oscuro, negra e injugable. El
 * p90 sigue el plateau de superficies bien iluminadas en vez de la cola:
 *
 *   nuketown  p90=2.387 vs p99.5=2.594  -> la mediana pasa de 0.48 a 0.50
 *                                          (o sea, no cambia nada)
 *   lasertag  p90=0.670 vs p99.5=2.859  -> el divisor cae al piso de 1.0 y
 *                                          la mediana pasa de 0.45 a 0.72
 *
 * El precio es que el 10% más brillante se recorta a blanco. En nuketown
 * ese 10% ya estaba en 0.96-1.0 con el p99.5, así que no se pierde degradé
 * visible: se verificó mirando las dos capturas.
 */
const PERCENTIL_BLANCO = 0.9

/**
 * Divisor de exposición del mapa. Nunca es menor que 1: normalizar HACIA
 * ARRIBA un mapa tenue lo dejaría más brillante que el original, que es
 * inventar luz que el autor no puso.
 */
function calcularExposicion(luminancias: Float64Array): number {
  const orden = Float64Array.from(luminancias).sort()
  const p = orden[Math.min(orden.length - 1, Math.floor(PERCENTIL_BLANCO * orden.length))]
  return Math.max(1, p)
}

/**
 * Atlas completo. Elige el lado potencia de dos más chico donde entre todo:
 * los 202331 luxels de nuketown más el padding entran en 1024x1024 (4 MB en
 * GPU como RGBA8, ~1 MB comprimido en el .png), que contra el presupuesto de
 * 2.5 ms/frame es ruido -- una textura más que se muestrea una vez por
 * píxel, sin geometría ni draw calls extra.
 */
export function construirAtlas(buf: Buffer, lumps: Lump[]): Atlas | null {
  const caras = leerCarasConLightmap(buf, lumps)
  if (caras.length === 0) return null

  // El 1x1 del principio es el texel blanco reservado (ver Atlas.blanco): se
  // empaqueta junto con las caras para que el packer le dé un lugar propio
  // con su padding, en vez de pisar una esquina que otra cara podría usar.
  const aEmpacar = [{ w: 1, h: 1 }, ...caras.map((c) => ({ w: c.w, h: c.h }))]

  let empacados: RectAtlas[] | null = null
  let lado = 0
  for (const candidato of [256, 512, 1024, 2048, 4096, 8192]) {
    empacados = empacar(aEmpacar, candidato)
    if (empacados !== null) {
      lado = candidato
      break
    }
  }
  if (empacados === null) return null

  const blanco = empacados[0]
  const rects = empacados.slice(1)

  const lLight = lumps[LUMP_LIGHTING]

  // Primera pasada: decodificar a lineal y juntar luminancias para la
  // exposición. Se decodifica una sola vez y se guarda, en vez de leer el
  // lump dos veces.
  const totalMuestras = caras.reduce((a, c) => a + c.w * c.h, 0)
  const lineal = new Float32Array(totalMuestras * 3)
  const luminancias = new Float64Array(totalMuestras)
  let k = 0

  for (const c of caras) {
    // Se leen sólo las primeras w*h muestras. En las caras con
    // SURF_BUMPLIGHT (917 en nuketown) siguen otras tres grillas
    // direccionales para normal mapping, que no usamos: el primer bloque ya
    // es el lightmap promedio. Saltearlas no requiere hacer nada porque
    // cada cara trae su `lightofs` absoluto.
    for (let i = 0; i < c.w * c.h; i++) {
      const off = lLight.offset + c.lightofs + i * 4
      const [r, g, b] = decodificarMuestra(buf, off)
      lineal[k * 3] = r / 255
      lineal[k * 3 + 1] = g / 255
      lineal[k * 3 + 2] = b / 255
      luminancias[k] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      k++
    }
  }

  const exposicion = calcularExposicion(luminancias)

  const rgba = new Uint8Array(lado * lado * 4)
  const escribir = (x: number, y: number, idx: number): void => {
    const d = (y * lado + x) * 4
    rgba[d] = Math.round(255 * aSrgb(lineal[idx * 3] / exposicion))
    rgba[d + 1] = Math.round(255 * aSrgb(lineal[idx * 3 + 1] / exposicion))
    rgba[d + 2] = Math.round(255 * aSrgb(lineal[idx * 3 + 2] / exposicion))
    rgba[d + 3] = 255
  }

  let base = 0
  for (let ci = 0; ci < caras.length; ci++) {
    const c = caras[ci]
    const r = rects[ci]
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        escribir(r.x + x, r.y + y, base + y * c.w + x)
      }
    }
    // Borde de 1 texel replicando el píxel de la orilla. Sin esto, el
    // filtrado bilineal en los bordes de cada cara mezcla con el vecino que
    // le tocó al lado en el atlas -- que es otra pared del mapa -- y
    // aparecen costuras de color ajeno en cada arista.
    for (let y = 0; y < c.h; y++) {
      escribir(r.x - 1, r.y + y, base + y * c.w)
      escribir(r.x + c.w, r.y + y, base + y * c.w + (c.w - 1))
    }
    for (let x = 0; x < c.w; x++) {
      escribir(r.x + x, r.y - 1, base + x)
      escribir(r.x + x, r.y + c.h, base + (c.h - 1) * c.w + x)
    }
    escribir(r.x - 1, r.y - 1, base)
    escribir(r.x + c.w, r.y - 1, base + (c.w - 1))
    escribir(r.x - 1, r.y + c.h, base + (c.h - 1) * c.w)
    escribir(r.x + c.w, r.y + c.h, base + (c.h - 1) * c.w + (c.w - 1))

    base += c.w * c.h
  }

  // Texel blanco + su borde: 3x3 de blanco puro alrededor de `blanco`, para
  // que ni el filtrado bilineal ni un mip nivel 1 puedan traer nada distinto
  // de blanco a esa muestra.
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const d = ((blanco.y + y) * lado + (blanco.x + x)) * 4
      rgba[d] = 255
      rgba[d + 1] = 255
      rgba[d + 2] = 255
      rgba[d + 3] = 255
    }
  }

  const ocupacion = caras.reduce((a, c) => a + c.w * c.h, 0) / (lado * lado)

  return { ancho: lado, alto: lado, rgba, rects, caras, blanco, exposicion, ocupacion }
}

/** UV del texel blanco reservado, para las caras sin lightmap. */
export function uvBlanco(atlas: Atlas): [number, number] {
  return [(atlas.blanco.x + 0.5) / atlas.ancho, (atlas.blanco.y + 0.5) / atlas.alto]
}

/**
 * UV de lightmap de un vértice, en [0,1] sobre el atlas.
 *
 * `v` va en unidades de Source SIN convertir: los `lightmapVecs` están
 * expresados en ese espacio, igual que los `textureVecs` del albedo.
 *
 * El `+0.5` es lo que alinea el centro del texel con la muestra. La muestra
 * de índice `i` vive en el texel `i` del atlas, cuyo centro está en `i+0.5`:
 * sin ese medio texel todo el lightmap queda corrido media muestra hacia
 * arriba y a la izquierda, que en las caras chicas (6x6 luxels es el
 * promedio) es un corrimiento del 8% de la cara.
 */
export function uvLightmap(
  v: readonly [number, number, number],
  cara: CaraLightmap,
  rect: RectAtlas,
  ladoAtlas: number,
): [number, number] {
  const lu = v[0] * cara.vecU[0] + v[1] * cara.vecU[1] + v[2] * cara.vecU[2] + cara.vecU[3] - cara.minU
  const lv = v[0] * cara.vecV[0] + v[1] * cara.vecV[1] + v[2] * cara.vecV[2] + cara.vecV[3] - cara.minV

  // Clamp al rango real de la grilla: un vértice puede caer una fracción de
  // luxel afuera por redondeo del compilador, y sin el clamp ese vértice
  // muestrearía el borde replicado (o peor, la cara vecina del atlas).
  const cu = Math.min(cara.w - 1, Math.max(0, lu))
  const cv = Math.min(cara.h - 1, Math.max(0, lv))

  return [(rect.x + cu + 0.5) / ladoAtlas, (rect.y + cv + 0.5) / ladoAtlas]
}
