/**
 * Lector de la tabla de BODYPARTS de un `.mdl` de Source (v44-49).
 *
 * Existe por un problema concreto y medido: SourceIO, al importar un `.mdl`,
 * mete en la escena TODAS las variantes de todos los bodygroups a la vez,
 * encimadas. El `c_cod4_ak47.mdl` entra con 8 mallas y 6177 triángulos, pero
 * el arma de verdad son 1589: las otras son un AK táctico entero (un SEGUNDO
 * cuerpo ocupando el mismo espacio), un lanzagranadas GP-25, dos rieles
 * alternativos y dos culatas alternativas. Convertido así, el arma sale con
 * el cuerpo duplicado y un lanzagranadas colgando.
 *
 * Un bodygroup es "elegí UNA de estas piezas". El `.mdl` lo dice en su
 * cabecera; el `.smd` importado no. Por eso hay que leer el binario: la
 * información que separa "pieza del arma" de "variante alternativa" no está
 * en la malla, sólo en la tabla de bodyparts.
 *
 * Sólo se lee la CABECERA (bodyparts y sus modelos). La geometría la sigue
 * sacando SourceIO — acá no se decodifica un solo vértice.
 */

import { readFileSync } from 'node:fs'

/** Un modelo (una opción) dentro de un bodypart. */
export interface MdlModel {
  /** Nombre tal cual está en el `.mdl`: `ak47.smd`, `25chunk/stock_l.smd`. */
  readonly name: string
  /** Vértices. Cero es la opción "ninguna pieza", que es legítima y común. */
  readonly vertexCount: number
}

/** Un bodygroup: el conjunto de opciones mutuamente excluyentes. */
export interface MdlBodypart {
  readonly name: string
  readonly models: readonly MdlModel[]
}

/**
 * Desplazamientos dentro de `studiohdr_t`. Son fijos desde la v44 y hasta la
 * v49 (la que traen estos modelos), y por eso se pueden escribir como
 * constantes en vez de recorrer la estructura: los campos anteriores a
 * `bodypart_count` son todos de tamaño fijo (12 bytes de identificación, 64
 * de nombre, 4 de largo, seis vectores de 12, y después pares
 * count/offset de 4).
 */
const OFF_BODYPART_COUNT = 232
const OFF_BODYPART_OFFSET = 236
/** `mstudiobodyparts_t`: sznameindex, nummodels, base, modelindex. */
const SIZEOF_BODYPART = 16
/** `mstudiomodel_t`: char name[64] + 11 int/float + 2 punteros + 8 int. */
const SIZEOF_MODEL = 148
/** Dentro de `mstudiomodel_t`: nummeshes, meshindex, numvertices. */
const OFF_MODEL_NUMVERTICES = 80

/** Lee una cadena terminada en NUL desde `offset`. */
function readCString(buf: Buffer, offset: number): string {
  const end = buf.indexOf(0, offset)
  return buf.toString('ascii', offset, end === -1 ? buf.length : end)
}

/**
 * Parsea la tabla de bodyparts de un `.mdl` ya leído en memoria.
 *
 * Valida el magic y la versión antes de tocar un offset: un archivo que no es
 * un `.mdl` de Source, o de una versión con otra disposición, daría offsets
 * basura que igual "parsean" y producirían una lista de piezas inventada. Es
 * exactamente el tipo de fallo silencioso que se ve recién en pantalla.
 */
export function parseBodyparts(buf: Buffer): readonly MdlBodypart[] {
  const magic = buf.toString('ascii', 0, 4)
  if (magic !== 'IDST') {
    throw new Error(`no es un .mdl de Source (magic "${magic}", se esperaba "IDST")`)
  }
  const version = buf.readInt32LE(4)
  if (version < 44 || version > 49) {
    throw new Error(`versión de .mdl no soportada: ${version} (se soporta 44-49)`)
  }

  const count = buf.readInt32LE(OFF_BODYPART_COUNT)
  const offset = buf.readInt32LE(OFF_BODYPART_OFFSET)
  const bodyparts: MdlBodypart[] = []

  for (let i = 0; i < count; i++) {
    const base = offset + i * SIZEOF_BODYPART
    const nameIndex = buf.readInt32LE(base)
    const modelCount = buf.readInt32LE(base + 4)
    const modelIndex = buf.readInt32LE(base + 12)

    const models: MdlModel[] = []
    for (let j = 0; j < modelCount; j++) {
      const mo = base + modelIndex + j * SIZEOF_MODEL
      models.push({
        name: readCString(buf, mo),
        vertexCount: buf.readInt32LE(mo + OFF_MODEL_NUMVERTICES),
      })
    }
    // Los offsets de nombre son RELATIVOS al inicio del bodypart, no al
    // archivo. Es el error clásico de este formato.
    bodyparts.push({ name: readCString(buf, base + nameIndex), models })
  }

  return bodyparts
}

export function readBodyparts(mdlPath: string): readonly MdlBodypart[] {
  return parseBodyparts(readFileSync(mdlPath))
}

/**
 * `25chunk/stock_l.smd` -> `stock_l`. Blender nombra el objeto con el nombre
 * del `.smd` sin carpeta, y a veces le agrega `.001` si se repite.
 */
export function meshBaseName(modelName: string): string {
  const withoutDir = modelName.slice(modelName.lastIndexOf('/') + 1)
  return withoutDir.replace(/\.smd$/i, '')
}

/**
 * Una culata es parte del arma, no un accesorio. Se detecta por nombre porque
 * es lo único que hay: los bodyparts de estos modelos se llaman "0", "1",
 * "rail"... (ver `c_cod4_ak47.mdl`, cuyos cinco bodyparts se llaman por su
 * número), así que el nombre del bodypart no dice nada y el de la PIEZA sí.
 */
const STOCK_PATTERN = /(^|[_/])stock([_.]|$)/i

/**
 * Elige qué piezas forman el arma "de fábrica" y devuelve sus nombres de
 * malla.
 *
 * La regla base es **índice 0 de cada bodypart**, que es lo que el autor del
 * modelo dejó como configuración por defecto y da un arma completa en los 103
 * modelos del pack (verificado: ninguno queda sin cuerpo).
 *
 * La excepción son las CULATAS. En 16 de los 103 modelos el índice 0 del
 * bodypart de la culata es la opción "ninguna" — el AK-47 de COD4 es el caso
 * obvio: sale sin culata, que es una silueta visiblemente rota y no una
 * variante estética. Que la opción por defecto sea "ninguna" tiene sentido en
 * ARC9, donde la culata la pone un accesorio que el jugador equipa; acá no hay
 * sistema de accesorios, así que sin esta excepción entrarían 16 armas mochas.
 *
 * El resto de las piezas opcionales (rieles, lanzagranadas, cubiertas, ópticas)
 * se quedan en "ninguna" a propósito: son accesorios de verdad, y montarlos
 * daría un arma que no es la que el jugador eligió por nombre. Un AK con GP-25
 * no es un AK-47.
 */
export function chooseBodygroupModels(bodyparts: readonly MdlBodypart[]): readonly string[] {
  const chosen: string[] = []

  for (const part of bodyparts) {
    if (part.models.length === 0) continue
    let pick = part.models[0]

    // Sólo se rescata la culata cuando el default es "ninguna". Si el índice 0
    // YA trae una pieza, se respeta: elegir otra sería inventar una
    // configuración que el autor no dejó por defecto.
    if (pick.vertexCount === 0) {
      const stock = part.models.find((m) => m.vertexCount > 0 && STOCK_PATTERN.test(m.name))
      if (stock) pick = stock
    }

    // La opción "ninguna" no aporta malla y no tiene nombre que preservar.
    if (pick.vertexCount === 0) continue
    chosen.push(meshBaseName(pick.name))
  }

  return chosen
}
