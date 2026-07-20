/**
 * Medición de teselado: ¿este PNG repite sin costura?
 *
 * POR QUÉ EXISTE, Y POR QUÉ ES UN NÚMERO Y NO UNA MIRADA
 *
 * La vía de camuflaje por textura (src/game/skins/texturas.ts) repite el
 * patrón sobre el arma. Si el patrón no cierra consigo mismo, aparece una
 * LÍNEA RECTA cruzando el arma en cada repetición, y esa línea no se puede
 * arreglar con paleta, con emisión ni con animación: es geometría del dibujo.
 * Un camuflaje con costura está muerto, y no hay ajuste que lo salve.
 *
 * El problema real: los generadores de imágenes NO producen texturas seamless
 * de forma confiable, por más que se lo pidas en el prompt. Y una tesela con
 * costura se ve perfecta mirando el cuadrado suelto — la costura sólo aparece
 * al repetirla. O sea que "se ve bien" es exactamente el juicio que no sirve
 * acá. Hace falta un número, medido, antes de gastar tiempo en integrar un
 * patrón que va a fallar.
 *
 *
 * LA MÉTRICA, Y POR QUÉ ES UNA RAZÓN Y NO UNA DIFERENCIA
 *
 * Lo obvio sería medir cuánto difiere la columna izquierda de la derecha. No
 * alcanza: esa diferencia depende del CONTRASTE del patrón. Un damasco de
 * blanco a negro y una nube gris suave con la misma costura relativa dan
 * números incomparables, y cualquier umbral fijo aprueba a uno y rechaza al
 * otro sin que la costura tenga nada que ver.
 *
 * Lo que sí se compara es la costura contra el propio patrón:
 *
 *     razón = (salto en el borde) / (salto típico entre columnas contiguas)
 *
 * El denominador es cuánto cambia el dibujo de una columna a la siguiente
 * PUERTAS ADENTRO. Al repetir la tesela, la columna del borde derecho queda
 * pegada a la del borde izquierdo: si ese salto se parece a cualquier otro
 * salto interno, el ojo no encuentra dónde termina una copia y empieza la
 * otra, y la razón da ~1. Si el salto del borde es cinco veces el típico, hay
 * una línea, y la razón da ~5. La razón es adimensional: no le importa el
 * contraste ni el brillo del patrón, sólo si el borde se distingue del resto.
 *
 * Un caso que parece un agujero y no lo es: el ruido blanco puro da razón ~1
 * aunque el recorte sea arbitrario. Está bien que apruebe — el ruido blanco
 * TESELA de verdad, porque no tiene estructura que se corte. La métrica mide
 * discontinuidad visible, que es exactamente lo que arruina un camuflaje, y
 * no "el archivo fue diseñado para teselar".
 *
 *
 * EL UMBRAL SALE DE MEDIR, NO DE ELEGIR
 *
 * `UMBRAL_RAZON` está calibrado contra dos controles que viven en
 * teselado.test.ts: el mismo campo de ruido renderizado con envoltura
 * periódica (tesela por construcción) y RECORTADO fuera de su periodo (no
 * tesela, con idéntico contraste y estadística). El recorte es el control
 * correcto justamente porque sólo cambia la propiedad que se mide y ninguna
 * otra.
 */

/** Imagen en escala de grises, un byte por píxel. */
export interface Gris {
  readonly ancho: number
  readonly alto: number
  /** 0..255, fila por fila. */
  readonly px: Uint8Array
}

/**
 * Umbral de decisión sobre la razón de costura.
 *
 * Medido (ver teselado.test.ts y la salida de scripts/verificar-teselado.ts):
 * los patrones que teselan por construcción caen en 0.9..1.2, y el mismo
 * patrón recortado fuera de su periodo salta por encima de 3. El 1.8 es el
 * medio de una franja vacía de casi el doble a cada lado, así que no es un
 * número al filo: hay lugar para que un patrón teselable con algo de ruido de
 * compresión JPEG siga pasando, y para que uno con costura real siga
 * fallando.
 */
export const UMBRAL_RAZON = 1.8

/**
 * Croma máximo tolerado para considerar que un PNG es "escala de grises".
 *
 * No es cero por el redondeo de la compresión: un PNG que pasó por un
 * conversor puede quedar con un canal a 128 y otro a 129. Un tinte real de un
 * generador que ignoró la instrucción da bastante más que esto.
 *
 * Se mide porque ya pasó en este proyecto: un generador devolvió un damero
 * gris IMITANDO transparencia en vez de tenerla. Lo que un generador dice que
 * hizo y lo que hizo son cosas distintas, y la única forma de saberlo es
 * medir el archivo.
 */
export const UMBRAL_CROMA = 6

export interface MedidaTeselado {
  ancho: number
  alto: number
  /** Salto medio en el borde izquierdo/derecho, en niveles 0..255. */
  costuraH: number
  /** Salto medio en el borde superior/inferior, en niveles 0..255. */
  costuraV: number
  /** Salto medio entre columnas contiguas del interior. El denominador. */
  interiorH: number
  /** Salto medio entre filas contiguas del interior. El denominador. */
  interiorV: number
  razonH: number
  razonV: number
  /** La peor de las dos: una sola costura ya arruina el camuflaje. */
  razon: number
  /** Croma máximo encontrado (0 = gris perfecto). */
  croma: number
  /** Nivel mínimo y máximo: un patrón sin rango no da contraste sobre el arma. */
  minimo: number
  maximo: number
  /** Desviación estándar del nivel. Mide cuánto dibujo hay realmente. */
  desviacion: number
  tesela: boolean
  esGris: boolean
}

/** Piso del denominador: evita dividir por cero en una imagen plana. */
const PISO_INTERIOR = 0.35

function media(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/**
 * Convierte RGBA a gris y de paso mide el croma.
 *
 * El gris sale del promedio de los tres canales y NO de la luminancia
 * ponderada: si el archivo es realmente gris los dos coinciden, y si no lo es
 * el promedio plano no le da ventaja a ningún canal, que es lo que se quiere
 * cuando se está justamente auditando si el archivo cumplió.
 */
export function aGris(ancho: number, alto: number, rgba: Uint8Array): {
  gris: Gris
  croma: number
} {
  const px = new Uint8Array(ancho * alto)
  let croma = 0
  for (let i = 0; i < ancho * alto; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (max - min > croma) croma = max - min
    px[i] = Math.round((r + g + b) / 3)
  }
  return { gris: { ancho, alto, px }, croma }
}

/** Salto medio entre la columna `a` y la columna `b`. */
function saltoColumnas(img: Gris, a: number, b: number): number {
  let suma = 0
  for (let y = 0; y < img.alto; y++) {
    suma += Math.abs(img.px[y * img.ancho + a] - img.px[y * img.ancho + b])
  }
  return suma / img.alto
}

/** Salto medio entre la fila `a` y la fila `b`. */
function saltoFilas(img: Gris, a: number, b: number): number {
  let suma = 0
  for (let x = 0; x < img.ancho; x++) {
    suma += Math.abs(img.px[a * img.ancho + x] - img.px[b * img.ancho + x])
  }
  return suma / img.ancho
}

/**
 * Mide el teselado de una imagen ya en gris.
 *
 * `croma` entra como parámetro en vez de recalcularse porque se pierde al
 * pasar a gris: lo mide `aGris`, que es quien todavía ve los tres canales.
 */
export function medirTeselado(img: Gris, croma: number): MedidaTeselado {
  const { ancho, alto, px } = img

  // Los bordes, que es donde se pega la tesela consigo misma al repetirse.
  const costuraH = saltoColumnas(img, ancho - 1, 0)
  const costuraV = saltoFilas(img, alto - 1, 0)

  // El interior, que es la vara con la que se comparan. Se saltean los
  // propios bordes: si el patrón tiene un marco o un viñeteo, ese defecto
  // inflaría el denominador y taparía la costura que se está buscando.
  const saltosH: number[] = []
  for (let x = 1; x < ancho - 1; x++) saltosH.push(saltoColumnas(img, x, x - 1))
  const saltosV: number[] = []
  for (let y = 1; y < alto - 1; y++) saltosV.push(saltoFilas(img, y, y - 1))

  const interiorH = Math.max(media(saltosH), PISO_INTERIOR)
  const interiorV = Math.max(media(saltosV), PISO_INTERIOR)

  const razonH = costuraH / interiorH
  const razonV = costuraV / interiorV

  let minimo = 255
  let maximo = 0
  let suma = 0
  for (const v of px) {
    if (v < minimo) minimo = v
    if (v > maximo) maximo = v
    suma += v
  }
  const promedio = suma / px.length
  let acum = 0
  for (const v of px) acum += (v - promedio) * (v - promedio)
  const desviacion = Math.sqrt(acum / px.length)

  const razon = Math.max(razonH, razonV)

  return {
    ancho,
    alto,
    costuraH,
    costuraV,
    interiorH,
    interiorV,
    razonH,
    razonV,
    razon,
    croma,
    minimo,
    maximo,
    desviacion,
    tesela: razon <= UMBRAL_RAZON,
    esGris: croma <= UMBRAL_CROMA,
  }
}

/** Atajo para RGBA crudo. */
export function medirRgba(ancho: number, alto: number, rgba: Uint8Array): MedidaTeselado {
  const { gris, croma } = aGris(ancho, alto, rgba)
  return medirTeselado(gris, croma)
}
