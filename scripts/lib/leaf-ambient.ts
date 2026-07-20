/**
 * Luz ambiental por hoja del BSP: lo que Source usa para iluminar los
 * `prop_static`, y de donde sale el tinte por instancia de los props.
 *
 * POR QUÉ NO SE MUESTREA EL LIGHTMAP DEBAJO DEL PROP
 * --------------------------------------------------
 * La idea obvia -- tirar un rayo para abajo, ver qué cara del mapa hay
 * abajo del prop y leer su luxel -- da un resultado SISTEMÁTICAMENTE
 * demasiado oscuro, y no por un bug: vrad hornea la sombra de los
 * `prop_static` DENTRO del lightmap. O sea que el piso justo abajo de una
 * cerca tiene la sombra de esa misma cerca. Tintar la cerca con eso la
 * pinta con su propia sombra, y cuanto más grande y más opaco el prop, más
 * oscuro queda: exactamente al revés de lo que se busca. Además deja sin
 * respuesta a los props que no tienen piso debajo (los colgados de una
 * pared, los que flotan sobre una escalera).
 *
 * El `LUMP_LEAF_AMBIENT_LIGHTING` no tiene ese problema porque es otra
 * cosa: vrad lo calcula muestreando la luz que LLEGA a puntos del aire
 * (no a las superficies), guardada como un "cubo ambiental" de 6 colores,
 * uno por dirección de eje. Es luz de volumen, no de superficie, así que
 * no incluye la sombra propia del prop y existe en todos lados donde se
 * pueda parar algo.
 *
 * FORMATO (los dos lumps van de a pares)
 * --------------------------------------
 *   LUMP_LEAF_AMBIENT_INDEX (52): un `dleafambientindex_t` de 4 bytes por
 *   hoja -- cuántas muestras tiene y desde qué índice. Es paralelo a
 *   LUMP_LEAFS.
 *
 *   LUMP_LEAF_AMBIENT_LIGHTING (56): las muestras, 28 bytes cada una --
 *   el cubo (6 x ColorRGBExp32) más x/y/z, que NO son coordenadas de
 *   mundo sino la posición FRACCIONARIA (0..255) de la muestra dentro de
 *   la caja de su hoja. Leerlas como si fueran unidades de Source deja
 *   todas las muestras amontonadas en una esquina del mapa.
 *
 * Verificado en los dos mapas del repo: nuketown 1584 hojas / 4619
 * muestras, lasertag 932 hojas / 4225 muestras, y en los dos el tamaño de
 * los lumps da exacto contra estos tamaños de registro.
 */

import { decodificarMuestra } from './lightmap.ts'
import { type Lump, LUMP_PLANES, leerPlanos } from './bsp.ts'

/** Lump 5: el árbol BSP. */
const LUMP_NODES = 5
/** Lump 10: las hojas del árbol. */
const LUMP_LEAFS = 10
/** Lump 52: índice de muestras ambientales por hoja (LDR). */
const LUMP_LEAF_AMBIENT_INDEX = 52
/** Lump 56: las muestras ambientales LDR (cubo + posición fraccionaria). */
const LUMP_LEAF_AMBIENT_LIGHTING = 56
/** Lump 51 y 55: los mismos dos, en la variante HDR. */
const LUMP_LEAF_AMBIENT_INDEX_HDR = 51
const LUMP_LEAF_AMBIENT_LIGHTING_HDR = 55

const TAM_NODE = 32
/**
 * `dleaf_t` mide 32 bytes en la versión 1 del lump y 56 en la 0 (la vieja
 * traía un cubo ambiental embebido en cada hoja). Se detecta por tamaño en
 * vez de asumir: con el registro equivocado las cajas de las hojas salen
 * corridas y el árbol devuelve la hoja de al lado, que es un error que no
 * se nota hasta que un prop queda con la luz del cuarto vecino.
 */
const TAM_LEAF_V1 = 32
const TAM_LEAF_V0 = 56
const TAM_AMBIENT_INDEX = 4
const TAM_AMBIENT_SAMPLE = 28

export interface AmbienteBsp {
  /** Cantidad de hojas. */
  hojas: number
  /** Cantidad de muestras ambientales. */
  muestras: number
  /**
   * Posición en MUNDO de cada muestra, en unidades de Source (x,y,z
   * consecutivos). Se precalcula porque la posición guardada es
   * fraccionaria respecto de la caja de su hoja, y resolverla una vez
   * por muestra es más barato que hacerlo en cada consulta.
   */
  posiciones: Float32Array
  /** Cubo de cada muestra: 18 floats (6 direcciones x RGB) lineales. */
  cubos: Float32Array
  /** Hoja a la que pertenece cada muestra. */
  hojaDeMuestra: Int32Array
  /** Primera muestra y cantidad, por hoja. */
  primeraMuestra: Int32Array
  cantidadMuestras: Int32Array
  /** Nodos del árbol, para `hojaDePunto`. */
  nodoPlano: Int32Array
  nodoHijo0: Int32Array
  nodoHijo1: Int32Array
  planoNx: Float32Array
  planoNy: Float32Array
  planoNz: Float32Array
  planoDist: Float32Array
}

/**
 * Energía mínima (luminancia del cubo más brillante del mapa) para
 * considerar que un par de lumps ambientales tiene datos de verdad.
 *
 * NO es un umbral estético: es el corte entre "hay datos" y "el lump
 * existe pero está en cero". Los dos mapas del repo muestran por qué hace
 * falta -- cada uno trae SU luz en un par distinto y el otro par relleno
 * de ceros:
 *
 *   nuketown  LDR(52/56) con datos (máx 1.449)  HDR(51/55) todo en cero
 *   lasertag  LDR(52/56) todo en ~0 (máx 0.028) HDR(51/55) con datos
 *
 * Elegir siempre el LDR -- que es lo que uno escribe primero -- deja a
 * lasertag con todos los props en negro, y elegir siempre el HDR deja a
 * nuketown igual. Se elige el par que traiga más energía en vez de mirar
 * la versión del lump porque es el dato que realmente decide.
 */
const ENERGIA_MINIMA = 0.05

/** Un par de lumps ambientales (índice + muestras), LDR o HDR. */
interface ParAmbiental {
  idx: Lump
  amb: Lump
}

/** Luminancia Rec.709, la misma que usa lightmap.ts para la exposición. */
function luminancia(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Energía del par: la luminancia del cubo más brillante. Sirve para
 * distinguir el par que trae la luz del que está relleno de ceros.
 */
function energiaDelPar(buf: Buffer, par: ParAmbiental): number {
  const n = Math.floor(par.amb.largo / TAM_AMBIENT_SAMPLE)
  let max = 0
  for (let m = 0; m < n; m++) {
    const o = par.amb.offset + m * TAM_AMBIENT_SAMPLE
    for (let dir = 0; dir < 6; dir++) {
      const [r, g, b] = decodificarMuestra(buf, o + dir * 4)
      const l = luminancia(r, g, b)
      if (l > max) max = l
    }
  }
  return max
}

/**
 * Lee los dos lumps ambientales más el árbol. Devuelve null si el mapa no
 * los trae (mapas viejos o compilados sin `-staticproplighting`): el
 * llamador cae a dejar los props sin tintar, que es como se veían antes.
 */
export function leerAmbiente(buf: Buffer, lumps: Lump[]): AmbienteBsp | null {
  const lLeafs = lumps[LUMP_LEAFS]
  const lNodes = lumps[LUMP_NODES]
  if (lLeafs.largo === 0) return null

  const candidatos: ParAmbiental[] = [
    { idx: lumps[LUMP_LEAF_AMBIENT_INDEX], amb: lumps[LUMP_LEAF_AMBIENT_LIGHTING] },
    { idx: lumps[LUMP_LEAF_AMBIENT_INDEX_HDR], amb: lumps[LUMP_LEAF_AMBIENT_LIGHTING_HDR] },
  ].filter((c) => c.idx.largo > 0 && c.amb.largo > 0)

  let elegido: ParAmbiental | null = null
  let mejorEnergia = ENERGIA_MINIMA
  for (const c of candidatos) {
    const e = energiaDelPar(buf, c)
    if (e > mejorEnergia) {
      mejorEnergia = e
      elegido = c
    }
  }
  if (elegido === null) return null
  const lIdx = elegido.idx
  const lAmb = elegido.amb

  const nHojas = Math.floor(lIdx.largo / TAM_AMBIENT_INDEX)
  const nMuestras = Math.floor(lAmb.largo / TAM_AMBIENT_SAMPLE)
  if (nHojas === 0 || nMuestras === 0) return null

  // El tamaño de `dleaf_t` se deduce de que el lump tiene que contener
  // exactamente una hoja por entrada del índice ambiental: los dos lumps
  // son paralelos por definición del formato.
  let tamLeaf = 0
  for (const candidato of [TAM_LEAF_V1, TAM_LEAF_V0]) {
    if (lLeafs.largo === nHojas * candidato) tamLeaf = candidato
  }
  if (tamLeaf === 0) return null

  const primeraMuestra = new Int32Array(nHojas)
  const cantidadMuestras = new Int32Array(nHojas)
  for (let h = 0; h < nHojas; h++) {
    const o = lIdx.offset + h * TAM_AMBIENT_INDEX
    cantidadMuestras[h] = buf.readUInt16LE(o)
    primeraMuestra[h] = buf.readUInt16LE(o + 2)
  }

  // Cajas de las hojas: mins/maxs son short en unidades de Source, y están
  // en +8..+18 tanto en la v1 como en la v0 (lo que cambia es lo que viene
  // DESPUÉS del bitfield de area/flags).
  const posiciones = new Float32Array(nMuestras * 3)
  const cubos = new Float32Array(nMuestras * 18)
  const hojaDeMuestra = new Int32Array(nMuestras).fill(-1)

  for (let h = 0; h < nHojas; h++) {
    const cant = cantidadMuestras[h]
    if (cant === 0) continue
    const oL = lLeafs.offset + h * tamLeaf
    const minX = buf.readInt16LE(oL + 8)
    const minY = buf.readInt16LE(oL + 10)
    const minZ = buf.readInt16LE(oL + 12)
    const maxX = buf.readInt16LE(oL + 14)
    const maxY = buf.readInt16LE(oL + 16)
    const maxZ = buf.readInt16LE(oL + 18)

    for (let k = 0; k < cant; k++) {
      const m = primeraMuestra[h] + k
      if (m < 0 || m >= nMuestras) continue
      const oM = lAmb.offset + m * TAM_AMBIENT_SAMPLE
      for (let dir = 0; dir < 6; dir++) {
        // SIN dividir por 255, al revés que en lightmap.ts, y no es un
        // olvido: el cubo ambiental usa el mismo ColorRGBExp32 pero con el
        // exponente corrido (típicamente -7 contra el ~0 del lightmap), así
        // que `byte * 2^exp` ya cae en el mismo rango [0, ~2.7] en el que
        // vive el lightmap DESPUÉS de su división. Dividir acá también deja
        // los props ~200 veces más oscuros que la pared -- que fue
        // exactamente lo que se midió al escribirlo:
        //
        //   nuketown  lightmap p50=0.510 p90=2.387   cubo p50=0.664 p90=1.047
        //
        // Las dos distribuciones se solapan, que es la señal de que están
        // en la misma escala y se pueden dividir por la MISMA exposición.
        const [r, g, b] = decodificarMuestra(buf, oM + dir * 4)
        cubos[m * 18 + dir * 3] = r
        cubos[m * 18 + dir * 3 + 1] = g
        cubos[m * 18 + dir * 3 + 2] = b
      }
      // x/y/z fraccionarios (0..255) dentro de la caja de la hoja.
      const fx = buf.readUInt8(oM + 24) / 255
      const fy = buf.readUInt8(oM + 25) / 255
      const fz = buf.readUInt8(oM + 26) / 255
      posiciones[m * 3] = minX + (maxX - minX) * fx
      posiciones[m * 3 + 1] = minY + (maxY - minY) * fy
      posiciones[m * 3 + 2] = minZ + (maxZ - minZ) * fz
      hojaDeMuestra[m] = h
    }
  }

  const nNodos = Math.floor(lNodes.largo / TAM_NODE)
  const nodoPlano = new Int32Array(nNodos)
  const nodoHijo0 = new Int32Array(nNodos)
  const nodoHijo1 = new Int32Array(nNodos)
  for (let n = 0; n < nNodos; n++) {
    const o = lNodes.offset + n * TAM_NODE
    nodoPlano[n] = buf.readInt32LE(o)
    nodoHijo0[n] = buf.readInt32LE(o + 4)
    nodoHijo1[n] = buf.readInt32LE(o + 8)
  }

  const planos = leerPlanos(buf, lumps[LUMP_PLANES])

  return {
    hojas: nHojas,
    muestras: nMuestras,
    posiciones,
    cubos,
    hojaDeMuestra,
    primeraMuestra,
    cantidadMuestras,
    nodoPlano,
    nodoHijo0,
    nodoHijo1,
    planoNx: planos.nx,
    planoNy: planos.ny,
    planoNz: planos.nz,
    planoDist: planos.dist,
  }
}

/**
 * Hoja que contiene un punto, bajando el árbol BSP desde la raíz. Los
 * hijos negativos son hojas: `hoja = -1 - hijo`, que es la convención de
 * Source (el -1 es porque el hijo 0 tendría que poder distinguirse de "no
 * hay hoja").
 */
export function hojaDePunto(a: AmbienteBsp, x: number, y: number, z: number): number {
  let nodo = 0
  // Cota de seguridad: un árbol corrupto con un ciclo colgaría el script.
  for (let paso = 0; paso < 1024; paso++) {
    if (nodo < 0 || nodo >= a.nodoPlano.length) return -1
    const p = a.nodoPlano[nodo]
    const d = a.planoNx[p] * x + a.planoNy[p] * y + a.planoNz[p] * z - a.planoDist[p]
    const hijo = d >= 0 ? a.nodoHijo0[nodo] : a.nodoHijo1[nodo]
    if (hijo < 0) return -1 - hijo
    nodo = hijo
  }
  return -1
}

/**
 * Radios de sondeo alrededor de un punto que cayó en hoja sólida, en
 * unidades de Source (16 u ≈ 30 cm). Se prueban de menor a mayor y se corta
 * en el primero que encuentre aire con muestras, para quedarse con la luz
 * MÁS CERCANA al prop y no con la primera que aparezca.
 */
const RADIOS_SONDEO = [16, 32, 48, 64, 96, 128] as const

/** De dónde salió la muestra que se usó, para poder reportarlo. */
export type OrigenMuestra = 'hoja' | 'vecindario' | 'lejano'

/**
 * Cubo ambiental en un punto (unidades de Source): los 18 floats de la
 * muestra más apropiada. Devuelve null si el mapa no tiene ninguna.
 *
 * Los tres casos, en orden, y por qué hacen falta los tres:
 *
 * 1. `hoja`: el punto está en aire con muestras. Es el caso normal.
 *
 * 2. `vecindario`: el punto cayó en una hoja SÓLIDA. Pasa con todos los
 *    props montados sobre una superficie -- las persianas clavadas a la
 *    pared y las lámparas de techo de nuketown tienen su origen DENTRO del
 *    brush donde están fijadas. Se sondea a los costados hasta encontrar
 *    aire, con lo que se agarra la luz del lado en el que el prop
 *    realmente está.
 *
 *    Sin este paso el caso 3 se comía a estos props y el resultado era
 *    visible: las persianas quedaban con un tinte de 0.007-0.045 pegadas a
 *    una pared cuyo lightmap va de 0.13 a 0.30, o sea manchas casi negras
 *    sobre una pared iluminada -- porque la muestra "más cercana" del mapa
 *    entero estaba del OTRO lado de la pared, adentro de la casa oscura.
 *
 * 3. `lejano`: ni sondeando aparece aire con muestras. Se usa la muestra
 *    más cercana de todo el mapa, que es una respuesta mala pero acotada:
 *    un prop sin ninguna luz saldría NEGRO, que se nota mucho más.
 */
export function cuboEnPunto(
  a: AmbienteBsp,
  x: number,
  y: number,
  z: number,
  salida: Float32Array,
): OrigenMuestra | null {
  let mejor = -1
  let mejorDist = Infinity

  // La distancia se mide siempre contra el punto ORIGINAL, no contra el
  // punto sondeado: lo que se busca es la luz más cercana al prop.
  const considerar = (m: number): void => {
    const dx = a.posiciones[m * 3] - x
    const dy = a.posiciones[m * 3 + 1] - y
    const dz = a.posiciones[m * 3 + 2] - z
    const d = dx * dx + dy * dy + dz * dz
    if (d < mejorDist) {
      mejorDist = d
      mejor = m
    }
  }

  const considerarHoja = (hoja: number): boolean => {
    if (hoja < 0 || hoja >= a.cantidadMuestras.length || a.cantidadMuestras[hoja] === 0) return false
    const desde = a.primeraMuestra[hoja]
    for (let k = 0; k < a.cantidadMuestras[hoja]; k++) considerar(desde + k)
    return true
  }

  const copiar = (origen: OrigenMuestra): OrigenMuestra | null => {
    if (mejor < 0) return null
    for (let i = 0; i < 18; i++) salida[i] = a.cubos[mejor * 18 + i]
    return origen
  }

  if (considerarHoja(hojaDePunto(a, x, y, z))) return copiar('hoja')

  for (const r of RADIOS_SONDEO) {
    let encontro = false
    for (const [dx, dy, dz] of [
      [r, 0, 0],
      [-r, 0, 0],
      [0, r, 0],
      [0, -r, 0],
      [0, 0, r],
      [0, 0, -r],
    ]) {
      if (considerarHoja(hojaDePunto(a, x + dx, y + dy, z + dz))) encontro = true
    }
    // Se corta en el primer radio que dio resultado: seguir agrandando sólo
    // podría traer luz de más lejos, nunca de más cerca.
    if (encontro) return copiar('vecindario')
  }

  for (let m = 0; m < a.muestras; m++) {
    if (a.hojaDeMuestra[m] < 0) continue
    considerar(m)
  }
  return copiar('lejano')
}

/**
 * Promedio de las 6 direcciones del cubo.
 *
 * Un prop se tinta con UN color, así que hay que colapsar el cubo a uno
 * solo, y el promedio simple es la respuesta correcta para un objeto del
 * que no se sabe hacia dónde miran sus caras: es la luz que recibiría una
 * superficie promediada sobre todas las orientaciones. Ponderar hacia
 * arriba (que sería lo "realista" para un objeto al aire libre) deja los
 * props de interior demasiado brillantes, porque adentro la dirección de
 * arriba suele ser la del techo iluminado.
 */
export function promedioCubo(cubo: Float32Array): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  for (let dir = 0; dir < 6; dir++) {
    r += cubo[dir * 3]
    g += cubo[dir * 3 + 1]
    b += cubo[dir * 3 + 2]
  }
  return [r / 6, g / 6, b / 6]
}
