/**
 * Convierte un .bsp de Source al formato propio de este FPS: colisión en
 * JSON liviano + malla visual en GLB.
 *
 *   node scripts/bsp-convert.ts <mapa.bsp> <dir_salida>
 *
 * Por qué offline: un .bsp de un mapa real pesa decenas de MB (nuketown
 * pesa 47). Parsearlo en el navegador en cada carga sería absurdo. Mismo
 * criterio que `scripts/convert-weapons.ts`: se convierte una vez en el
 * escritorio y el juego carga un formato liviano.
 *
 * Produce dos archivos en `dir_salida`, `<nombre>.json` y `<nombre>.glb`:
 *
 * - El JSON trae metadata + colisión: sólo brushes con CONTENTS_SOLID (agua,
 *   triggers y humo no frenan al jugador), sin lados bevel (ver
 *   `scripts/lib/bsp.ts`), con normales hacia afuera (interior =
 *   `dot(n,p) <= d`, la convención que espera la colisión cápsula-contra-
 *   convexo), y los spawns (`info_player_*`) del lump de entidades.
 * - El GLB trae la malla visible, una primitiva por material (el nombre de
 *   material viaja pero no la textura: eso es una tarea posterior), armada
 *   desde LUMP_FACES vía LUMP_SURFEDGES -> LUMP_EDGES -> LUMP_VERTEXES.
 *   Caras de herramienta (nodraw/trigger/skip/hint/clip) se descartan: son
 *   invisibles en el juego y sólo suman triángulos.
 *
 * Todo en metros y en ejes de three.js, no en unidades ni ejes de Source. La
 * conversión de unidades y de ejes vive en un sólo lugar
 * (`scripts/lib/bsp.ts`) y se aplica igual a brushes, spawns y vértices de
 * malla: si el mesh y la colisión quedaran en ejes distintos, el mapa se
 * vería bien y sería injugable, que es el peor fallo posible acá.
 *
 * Displacements (LUMP_DISPINFO) quedan fuera de alcance: sus caras se
 * descartan de la malla y el conteo se reporta por consola, nada más.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { weld } from '@gltf-transform/functions'

import {
  type Lump,
  LUMP_DISPINFO,
  LUMP_EDGES,
  LUMP_ENTITIES,
  LUMP_FACES,
  LUMP_PLANES,
  LUMP_SURFEDGES,
  LUMP_TEXDATA,
  LUMP_TEXDATA_STRING_DATA,
  LUMP_TEXDATA_STRING_TABLE,
  LUMP_TEXINFO,
  LUMP_VERTEXES,
  METROS_POR_UNIDAD,
  TAM_DISPINFO,
  TAM_EDGE,
  TAM_FACE,
  TAM_SURFEDGE,
  TAM_TEXDATA,
  TAM_TEXINFO,
  TAM_VERTEX,
  bboxDelBrush,
  bboxSourceAThreeMetros,
  leerBrushesDeColision,
  leerLumps,
  leerPlanos,
  planoSourceAThreeMetros,
  puntoSourceAThreeMetros,
  yawSourceAThree,
} from './lib/bsp.ts'
import {
  type Caja,
  cajaJugableDesdeMalla,
  cajaValida,
  cajaVacia,
  cajasSeTocan,
  esDelSkybox3D,
  expandirCaja,
  murosDeCierre,
  planosDeCaja,
  planosDeRecorte,
  recortarCaja,
} from './lib/caja-jugable.ts'
import { type Atlas, construirAtlas, uvBlanco, uvLightmap } from './lib/lightmap.ts'
import { encodePng } from './lib/png-writer.ts'

// Bits de SURF_ relevantes de LUMP_TEXINFO (texinfo_t.flags). El resto del
// bitfield (SURF_LIGHT, SURF_SKY, etc.) no importa para decidir si una cara
// se descarta.
const SURF_TRIGGER = 0x40
const SURF_NODRAW = 0x80
const SURF_HINT = 0x100
const SURF_SKIP = 0x200
const SURF_DESCARTABLE = SURF_NODRAW | SURF_TRIGGER | SURF_HINT | SURF_SKIP

/** Substrings de nombre de material que también implican descartar la cara,
 *  además (o en vez) del bit SURF_ correspondiente: las texturas de
 *  herramienta de Hammer viven bajo `TOOLS/TOOLS*` y esto es lo que el brief
 *  pide explícitamente ("nodraw, trigger, skip, hint y clip"). CLIP no tiene
 *  bit SURF_ propio -- los brushes clip normalmente ni generan cara -- así
 *  que este chequeo por nombre es la única red para ese caso. */
const MATERIALES_DESCARTABLES = ['nodraw', 'trigger', 'skip', 'hint', 'clip']

/**
 * Prefijo de TODOS los materiales de herramienta de Hammer.
 *
 * Los cinco substrings de arriba no los cubren a todos: `toolsskybox` y
 * `toolsblack` no llevan SURF_NODRAW y no contienen ninguno de esos textos,
 * así que se colaban a la malla. `map-textures.ts` los venía filtrando por
 * este mismo prefijo un paso más adelante, y por eso el GLB final se veía
 * bien -- pero el filtro estaba en el lugar equivocado, y esta tarea lo
 * demostró: la caja jugable se deriva de la malla que se construye ACÁ, y
 * con la cáscara de `toolsskybox` adentro medía 137 m de profundidad en vez
 * de los 76 que mide el mapa. Filtrar acá deja a los dos consumidores de la
 * malla -- el GLB y la caja jugable -- mirando lo mismo. El filtro de
 * map-textures.ts queda como red de seguridad, no como el que decide.
 */
const PREFIJO_HERRAMIENTA = 'tools/'

export interface BrushColision {
  /** Planos del brush, aplanados: [nx,ny,nz,d, nx,ny,nz,d, ...]. Normal hacia
   *  afuera; interior del brush es `dot(n,p) <= d`. */
  planes: number[]
  min: [number, number, number]
  max: [number, number, number]
}

export interface MapaColision {
  nombre: string
  /** Metros por unidad de Source: 1 unidad = 0.75 pulgadas = 0.01905 m.
   *
   *  Es informativo: **ya está aplicado** a `bounds`, `spawns` y los planos de
   *  los brushes, que salen todos en metros. Está acá para que el consumidor
   *  pueda verificar la escala, no para que la aplique otra vez.
   *
   *  Se llamaba `unidadesPorMetro`, que decía exactamente lo contrario de lo
   *  que contiene. Se renombró antes de que existiera ningún consumidor,
   *  porque un nombre invertido en un factor de escala termina en alguien
   *  dividiendo donde correspondía multiplicar. */
  metrosPorUnidad: number
  bounds: { min: [number, number, number]; max: [number, number, number] }
  spawns: Array<[number, number, number]>
  /** Yaw de cada spawn, en radianes del motor, paralelo a `spawns`. */
  spawnYaws: number[]
  brushes: BrushColision[]
}

export interface ReporteConversion {
  brushesSolidos: number
  spawns: number
  triangulos: number
  materiales: number
  displacements: number
  /**
   * Separación de la geometría de colisión contra la caja jugable (ver
   * `scripts/lib/caja-jugable.ts`). Se reporta entero y no sólo el total
   * porque los tres números responden preguntas distintas: `descartados`
   * mide cuánta geometría no era del mapa, `recortados` cuánta estaba a
   * caballo del borde, y `cierre` confirma que el recinto quedó sellado.
   */
  jugable: {
    /** Caja usada, en metros y ejes del motor. `null` si el mapa no tiene
     *  malla visible y no se pudo derivar (no se filtra nada). */
    caja: Caja | null
    /** Brushes que quedaron enteros adentro. */
    dentro: number
    /** Brushes descartados por no tocar la caja. */
    descartados: number
    /** De los descartados, cuántos son de la maqueta del skybox 3D. */
    enSkybox3D: number
    /** Brushes que sobrevivieron pero con planos de recorte agregados. */
    recortados: number
    /** Muros de cierre emitidos. */
    cierre: number
    /** Caras de malla descartadas por ser de la maqueta del skybox 3D. */
    carasSkybox3D: number
  }
  /** null si el mapa no trae muestras horneadas en LUMP_LIGHTING. */
  lightmap: { lado: number; caras: number; exposicion: number; ocupacion: number } | null
}

/**
 * Bloques `{ "clave" "valor" ... }` de LUMP_ENTITIES. Los bloques de entidad
 * de Source nunca anidan llaves (son siempre pares clave/valor planos), así
 * que partir por el primer `}` que cierra cada `{` es seguro; el único borde
 * no cubierto es un VALOR que contenga un `}` literal (p.ej. un texto de
 * `message`), que no aparece en las claves que nos interesan acá
 * (`classname`, `origin`).
 */
function leerEntidades(texto: string): Array<Record<string, string>> {
  const entidades: Array<Record<string, string>> = []
  const bloqueRe = /\{([^}]*)\}/g
  let bloque: RegExpExecArray | null
  while ((bloque = bloqueRe.exec(texto)) !== null) {
    const kv: Record<string, string> = {}
    const parRe = /"([^"]*)"\s*"([^"]*)"/g
    let par: RegExpExecArray | null
    while ((par = parRe.exec(bloque[1])) !== null) kv[par[1]] = par[2]
    entidades.push(kv)
  }
  return entidades
}

/**
 * Spawns del mapa: origin + yaw de toda entidad `info_player_*`, en metros y
 * radianes de three.js.
 *
 * El yaw sale de `angles` ("pitch yaw roll"), del que sólo se usa el yaw:
 * pitch y roll en un `info_player_*` son basura del editor -- el jugador
 * aparece parado y mirando al horizonte, no cabeceado ni inclinado.
 *
 * Un spawn sin `angles` (o con uno ilegible) cae en 0, que en la convención
 * de Source es "mirando a +X". No se lo descarta: perder un punto de
 * aparición por no saber hacia dónde mirar sería cambiar un defecto chico
 * por uno grande.
 */
function leerSpawns(
  buf: Buffer,
  lump: Lump,
): { origenes: Array<[number, number, number]>; yaws: number[] } {
  const texto = buf.toString('utf8', lump.offset, lump.offset + lump.largo)
  const origenes: Array<[number, number, number]> = []
  const yaws: number[] = []

  for (const ent of leerEntidades(texto)) {
    if (!ent.classname?.startsWith('info_player_')) continue
    if (!ent.origin) continue

    const partes = ent.origin.trim().split(/\s+/).map(Number)
    if (partes.length !== 3 || partes.some((n) => !Number.isFinite(n))) continue

    origenes.push(puntoSourceAThreeMetros(partes as [number, number, number]))

    const angulos = ent.angles?.trim().split(/\s+/).map(Number)
    const yawSource = angulos !== undefined && angulos.length === 3 && Number.isFinite(angulos[1])
      ? angulos[1]
      : 0
    yaws.push(yawSourceAThree(yawSource))
  }

  return { origenes, yaws }
}

/**
 * Origen de la entidad `sky_camera`, en metros y ejes del motor, o `null` si
 * el mapa no la trae.
 *
 * Es la marca oficial de Source de dónde está la maqueta del skybox 3D, y
 * viaja en el .bsp: no hay que adivinarla ni deducirla de nombres de modelo
 * (ver `scripts/lib/caja-jugable.ts`). Un mapa sin `sky_camera` no tiene
 * skybox 3D que separar, y devolver `null` hace que nada se filtre por ese
 * criterio -- que es lo correcto, no un caso degradado.
 */
export function leerSkyCamera(texto: string): [number, number, number] | null {
  for (const ent of leerEntidades(texto)) {
    if (ent.classname !== 'sky_camera') continue
    if (!ent.origin) continue
    const partes = ent.origin.trim().split(/\s+/).map(Number)
    if (partes.length !== 3 || partes.some((n) => !Number.isFinite(n))) continue
    return puntoSourceAThreeMetros(partes as [number, number, number])
  }
  return null
}

/** Caja de los `info_player_*` en metros y ejes del motor. Referencia de
 *  "dónde se juega" para el criterio de Voronoi contra `sky_camera`. */
export function cajaDeSpawns(origenes: ReadonlyArray<[number, number, number]>): Caja {
  const caja = cajaVacia()
  for (const o of origenes) expandirCaja(caja, o)
  return caja
}

function leerVertices(buf: Buffer, lump: Lump): Array<[number, number, number]> {
  const n = Math.floor(lump.largo / TAM_VERTEX)
  const vs: Array<[number, number, number]> = new Array(n)
  for (let i = 0; i < n; i++) {
    const o = lump.offset + i * TAM_VERTEX
    vs[i] = [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)]
  }
  return vs
}

function leerEdges(buf: Buffer, lump: Lump): Array<[number, number]> {
  const n = Math.floor(lump.largo / TAM_EDGE)
  const es: Array<[number, number]> = new Array(n)
  for (let i = 0; i < n; i++) {
    const o = lump.offset + i * TAM_EDGE
    es[i] = [buf.readUInt16LE(o), buf.readUInt16LE(o + 2)]
  }
  return es
}

function leerSurfedges(buf: Buffer, lump: Lump): Int32Array {
  const n = Math.floor(lump.largo / TAM_SURFEDGE)
  const out = new Int32Array(n)
  for (let i = 0; i < n; i++) out[i] = buf.readInt32LE(lump.offset + i * TAM_SURFEDGE)
  return out
}

interface FaceCruda {
  firstedge: number
  numedges: number
  texinfo: number
  dispinfo: number
}

/** dface_t (56 bytes): sólo se leen los campos que hacen falta para la malla. */
function leerFaces(buf: Buffer, lump: Lump): FaceCruda[] {
  const n = Math.floor(lump.largo / TAM_FACE)
  const out: FaceCruda[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const o = lump.offset + i * TAM_FACE
    out[i] = {
      firstedge: buf.readInt32LE(o + 4),
      numedges: buf.readInt16LE(o + 8),
      texinfo: buf.readInt16LE(o + 10),
      dispinfo: buf.readInt16LE(o + 12), // -1 si la cara no es de displacement
    }
  }
  return out
}

interface TexInfoCrudo {
  vecS: [number, number, number, number]
  vecT: [number, number, number, number]
  flags: number
  texdata: number
}

/** texinfo_t (72 bytes): vectores de UV (s/t, xyz + offset) + flags + índice de texdata. */
function leerTexInfos(buf: Buffer, lump: Lump): TexInfoCrudo[] {
  const n = Math.floor(lump.largo / TAM_TEXINFO)
  const out: TexInfoCrudo[] = new Array(n)
  const leerVec4 = (o: number): [number, number, number, number] => [
    buf.readFloatLE(o),
    buf.readFloatLE(o + 4),
    buf.readFloatLE(o + 8),
    buf.readFloatLE(o + 12),
  ]
  for (let i = 0; i < n; i++) {
    const o = lump.offset + i * TAM_TEXINFO
    out[i] = {
      vecS: leerVec4(o),
      vecT: leerVec4(o + 16),
      flags: buf.readInt32LE(o + 64),
      texdata: buf.readInt32LE(o + 68),
    }
  }
  return out
}

interface TexDataCrudo {
  nameStringTableID: number
  width: number
  height: number
}

/** dtexdata_t (32 bytes): sólo interesan el índice de nombre y el tamaño de textura (para UV). */
function leerTexDatas(buf: Buffer, lump: Lump): TexDataCrudo[] {
  const n = Math.floor(lump.largo / TAM_TEXDATA)
  const out: TexDataCrudo[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const o = lump.offset + i * TAM_TEXDATA
    out[i] = {
      nameStringTableID: buf.readInt32LE(o + 12),
      width: buf.readInt32LE(o + 16),
      height: buf.readInt32LE(o + 20),
    }
  }
  return out
}

/** LUMP_TEXDATA_STRING_TABLE (offsets int32) + LUMP_TEXDATA_STRING_DATA (bytes, null-terminated). */
function leerNombresMateriales(buf: Buffer, lumpTabla: Lump, lumpDatos: Lump): string[] {
  const n = Math.floor(lumpTabla.largo / 4)
  const nombres: string[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const relativo = buf.readInt32LE(lumpTabla.offset + i * 4)
    const abs = lumpDatos.offset + relativo
    const fin = buf.indexOf(0, abs)
    nombres[i] = buf.toString('ascii', abs, fin === -1 ? abs : fin)
  }
  return nombres
}

export function esCaraDescartable(flags: number, nombreMaterial: string): boolean {
  if ((flags & SURF_DESCARTABLE) !== 0) return true
  const n = nombreMaterial.toLowerCase()
  if (n.startsWith(PREFIJO_HERRAMIENTA)) return true
  return MATERIALES_DESCARTABLES.some((m) => n.includes(m))
}

interface PrimitivaAcumulada {
  posiciones: number[]
  uvs: number[]
  /** Segundo juego de UV: dónde muestrear el atlas de lightmap. */
  uvsLightmap: number[]
  indices: number[]
}

/**
 * Reconstruye la malla visible desde LUMP_FACES, agrupada en una primitiva
 * por material. Devuelve también los conteos que el reporte de consola
 * necesita (triángulos totales, displacements encontrados).
 */
function construirMalla(
  buf: Buffer,
  lumps: Lump[],
  atlas: Atlas | null,
  skyCamera: [number, number, number] | null,
  cajaSpawns: Caja,
): {
  porMaterial: Map<string, PrimitivaAcumulada>
  triangulos: number
  displacements: number
  carasSinLightmap: number
  /** Caja de lo que efectivamente se dibuja, en metros y ejes del motor. */
  cajaMalla: Caja
  carasSkybox3D: number
} {
  const vertices = leerVertices(buf, lumps[LUMP_VERTEXES])
  const edges = leerEdges(buf, lumps[LUMP_EDGES])
  const surfedges = leerSurfedges(buf, lumps[LUMP_SURFEDGES])
  const faces = leerFaces(buf, lumps[LUMP_FACES])
  const texinfos = leerTexInfos(buf, lumps[LUMP_TEXINFO])
  const texdatas = leerTexDatas(buf, lumps[LUMP_TEXDATA])
  const nombresMateriales = leerNombresMateriales(
    buf,
    lumps[LUMP_TEXDATA_STRING_TABLE],
    lumps[LUMP_TEXDATA_STRING_DATA],
  )
  const displacements = Math.floor(lumps[LUMP_DISPINFO].largo / TAM_DISPINFO)

  // Índice de cara -> posición en la lista del atlas. El atlas sólo incluye
  // las caras que TIENEN lightmap (en nuketown 5034 de 5400), así que no se
  // puede indexar por número de cara directamente.
  const enAtlas = new Map<number, number>()
  if (atlas !== null) {
    for (let i = 0; i < atlas.caras.length; i++) enAtlas.set(atlas.caras[i].cara, i)
  }

  const porMaterial = new Map<string, PrimitivaAcumulada>()
  let triangulos = 0
  let carasSinLightmap = 0
  const cajaMalla = cajaVacia()
  let carasSkybox3D = 0
  // Scratch del centroide de cara: se reusa entre caras para no asignar un
  // array por cada una de las 5400 caras del mapa.
  const centroide: [number, number, number] = [0, 0, 0]

  for (let indiceCara = 0; indiceCara < faces.length; indiceCara++) {
    const face = faces[indiceCara]
    // Fuera de alcance: las caras de displacement son sólo el quad base, no
    // el terreno esculpido real (eso vive en LUMP_DISPVERTS, que no se lee
    // acá). Incluir el quad se vería peor que no incluir nada, así que se
    // descartan enteras.
    if (face.dispinfo !== -1) continue
    if (face.numedges < 3) continue // degenerada
    if (face.texinfo < 0 || face.texinfo >= texinfos.length) continue

    const texinfo = texinfos[face.texinfo]
    const texdata =
      texinfo.texdata >= 0 && texinfo.texdata < texdatas.length ? texdatas[texinfo.texdata] : undefined
    const nombreMaterial = texdata ? (nombresMateriales[texdata.nameStringTableID] ?? '(sin nombre)') : '(sin texdata)'

    if (esCaraDescartable(texinfo.flags, nombreMaterial)) continue

    // Loop ordenado de vértices de la cara: cada surfedge es un índice de
    // edge con signo. Positivo = edge en el orden v0->v1, negativo = v1->v0.
    // Ese signo es lo que le da a la cara un orden consistente (necesario
    // para triangular en abanico y para que el winding salga bien).
    const loop: Array<[number, number, number]> = new Array(face.numedges)
    for (let e = 0; e < face.numedges; e++) {
      const se = surfedges[face.firstedge + e]
      const edge = edges[Math.abs(se)]
      const idxVertice = se >= 0 ? edge[0] : edge[1]
      loop[e] = vertices[idxVertice]
    }

    // La maqueta del skybox 3D se descarta ANTES de medirle la caja a la
    // malla: si aportara caras dibujables, contaminaría la caja jugable que
    // se deriva de acá y el filtro de colisión se volvería inútil (ver
    // scripts/lib/caja-jugable.ts). Se decide por el centroide de la cara y
    // no por un vértice suelto: un vértice puede caer del lado equivocado
    // en una cara que cruza la frontera de Voronoi, el centroide no.
    centroide[0] = 0
    centroide[1] = 0
    centroide[2] = 0
    for (const v of loop) {
      const p = puntoSourceAThreeMetros(v)
      centroide[0] += p[0] / loop.length
      centroide[1] += p[1] / loop.length
      centroide[2] += p[2] / loop.length
    }
    if (esDelSkybox3D(centroide, skyCamera, cajaSpawns)) {
      carasSkybox3D++
      continue
    }

    let acumulado = porMaterial.get(nombreMaterial)
    if (!acumulado) {
      acumulado = { posiciones: [], uvs: [], uvsLightmap: [], indices: [] }
      porMaterial.set(nombreMaterial, acumulado)
    }

    const anchoTex = texdata && texdata.width > 0 ? texdata.width : 1
    const altoTex = texdata && texdata.height > 0 ? texdata.height : 1
    const base = acumulado.posiciones.length / 3

    const idxAtlas = enAtlas.get(indiceCara)
    if (idxAtlas === undefined) carasSinLightmap++

    for (const v of loop) {
      const p = puntoSourceAThreeMetros(v)
      acumulado.posiciones.push(p[0], p[1], p[2])
      expandirCaja(cajaMalla, p)

      // UV de Source: proyección del vértice (en unidades de Source, sin
      // convertir) sobre los vectores de textureVecs, dividida por el
      // tamaño de la textura en texeles. No hay flip de V acá: las texturas
      // se enganchan en una tarea posterior, que es quien puede verificarlo
      // contra una imagen real.
      const s = v[0] * texinfo.vecS[0] + v[1] * texinfo.vecS[1] + v[2] * texinfo.vecS[2] + texinfo.vecS[3]
      const t = v[0] * texinfo.vecT[0] + v[1] * texinfo.vecT[1] + v[2] * texinfo.vecT[2] + texinfo.vecT[3]
      acumulado.uvs.push(s / anchoTex, t / altoTex)

      // Las caras sin lightmap van al texel BLANCO reservado del atlas: son
      // 216 caras visibles de nuketown a las que vrad no les horneó nada, y
      // multiplicar su albedo por blanco las deja como estaban en vez de
      // apagarlas (ver `Atlas.blanco`).
      if (atlas !== null && idxAtlas !== undefined) {
        const [lu, lv] = uvLightmap(v, atlas.caras[idxAtlas], atlas.rects[idxAtlas], atlas.ancho)
        acumulado.uvsLightmap.push(lu, lv)
      } else if (atlas !== null) {
        const [lu, lv] = uvBlanco(atlas)
        acumulado.uvsLightmap.push(lu, lv)
      } else {
        acumulado.uvsLightmap.push(0, 0)
      }
    }

    // Las caras de Source son siempre convexas: un abanico desde el primer
    // vértice triangula cualquier polígono sin más trabajo.
    //
    // El abanico va en orden INVERSO (k+1 antes que k). La rotación de ejes
    // (ejesSourceAThree) es pura, determinante +1, así que no da vuelta
    // nada -- el que estaba al revés era el punto de partida: el loop que
    // arma LUMP_SURFEDGES recorre la cara en el sentido contrario al que
    // glTF y three consideran "cara de frente" (CCW vista desde afuera).
    // Con el orden directo el mapa se dibujaba dado vuelta: parado sobre el
    // piso no se veía el piso (su única cara miraba hacia abajo) y desde
    // afuera de una casa se le veían las paredes interiores. Verificado
    // mirando la pantalla, que es la única forma de ver esto.
    for (let k = 1; k < loop.length - 1; k++) {
      acumulado.indices.push(base, base + k + 1, base + k)
      triangulos++
    }
  }

  return { porMaterial, triangulos, displacements, carasSinLightmap, cajaMalla, carasSkybox3D }
}

async function construirGlb(porMaterial: Map<string, PrimitivaAcumulada>): Promise<Document> {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const mesh = doc.createMesh()
  const node = doc.createNode().setMesh(mesh)
  const scene = doc.createScene().addChild(node)
  doc.getRoot().setDefaultScene(scene)

  for (const [nombreMaterial, acumulado] of porMaterial) {
    if (acumulado.indices.length === 0) continue

    // Sin textura: el nombre de material es lo único que viaja en esta
    // tarea. Color plano gris medio para que la malla sea inspeccionable
    // (no negra) antes de que el paso de texturas la reemplace.
    const material = doc.createMaterial(nombreMaterial).setBaseColorFactor([0.6, 0.6, 0.6, 1])

    const posAccessor = doc
      .createAccessor(undefined, buffer)
      .setType('VEC3')
      .setArray(new Float32Array(acumulado.posiciones))
    const uvAccessor = doc.createAccessor(undefined, buffer).setType('VEC2').setArray(new Float32Array(acumulado.uvs))
    // TEXCOORD_1 = UV de lightmap. three lo expone como `geometry.uv1`, que
    // es el canal que MeshBasicMaterial lee para `lightMap` cuando se le
    // pone `texture.channel = 1` (ver map/external-map.ts). Va como
    // atributo aparte y no reusando TEXCOORD_0 porque las dos
    // parametrizaciones no tienen nada que ver: el albedo repite decenas de
    // veces sobre una pared y el lightmap la cubre exactamente una vez.
    const uvLmAccessor = doc
      .createAccessor(undefined, buffer)
      .setType('VEC2')
      .setArray(new Float32Array(acumulado.uvsLightmap))
    const idxAccessor = doc
      .createAccessor(undefined, buffer)
      .setType('SCALAR')
      .setArray(new Uint32Array(acumulado.indices))

    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', posAccessor)
      .setAttribute('TEXCOORD_0', uvAccessor)
      .setAttribute('TEXCOORD_1', uvLmAccessor)
      .setIndices(idxAccessor)
      .setMaterial(material)
    mesh.addPrimitive(prim)
  }

  // Cada cara aportó sus propios vértices sin compartir con las vecinas
  // (más simple de construir); weld() los fusiona por posición/UV idénticos
  // para no dejar un GLB innecesariamente pesado.
  await doc.transform(weld())

  return doc
}

/**
 * Conversión completa, pura en memoria (no toca disco): útil para testear
 * con un .bsp sintético sin pasar por el filesystem.
 */
export async function convertir(
  buf: Buffer,
  nombre: string,
): Promise<{
  colision: MapaColision
  doc: Document
  reporte: ReporteConversion
  /** PNG del atlas de lightmap, o null si el mapa no trae LUMP_LIGHTING. */
  lightmapPng: Buffer | null
}> {
  const { lumps } = leerLumps(buf)
  const { nx, ny, nz, dist } = leerPlanos(buf, lumps[LUMP_PLANES])

  const { origenes: spawns, yaws: spawnYaws } = leerSpawns(buf, lumps[LUMP_ENTITIES])
  if (spawns.length === 0) {
    console.error(`[${nombre}] ADVERTENCIA: no se encontró ningún info_player_*. Este mapa no es jugable.`)
  }

  // La MALLA va primero, al revés de como estaba: la caja jugable contra la
  // que se filtra la colisión sale de la malla visible (ver
  // scripts/lib/caja-jugable.ts), así que hay que tenerla antes de mirar un
  // solo brush.
  const skyCamera = leerSkyCamera(
    buf.toString('utf8', lumps[LUMP_ENTITIES].offset, lumps[LUMP_ENTITIES].offset + lumps[LUMP_ENTITIES].largo),
  )
  const cajaSpawns = cajaDeSpawns(spawns)

  const atlas = construirAtlas(buf, lumps)
  const { porMaterial, triangulos, displacements, carasSinLightmap, cajaMalla, carasSkybox3D } = construirMalla(
    buf,
    lumps,
    atlas,
    skyCamera,
    cajaSpawns,
  )

  // Sin malla visible no hay de dónde derivar la caja, y filtrar contra una
  // caja inventada sería peor que no filtrar: se deja el mapa tal cual y se
  // avisa. Un .bsp sin una sola cara dibujable no es un caso normal.
  const cajaJugable = cajaValida(cajaMalla) ? cajaJugableDesdeMalla(cajaMalla) : null
  if (cajaJugable === null) {
    console.error(
      `[${nombre}] ADVERTENCIA: el mapa no tiene malla visible, no se puede derivar la caja jugable. La colisión va SIN filtrar.`,
    )
  }

  const brushesSolidos = leerBrushesDeColision(buf, lumps)
  const brushes: BrushColision[] = []
  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity]
  const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let dentro = 0
  let descartados = 0
  let enSkybox3D = 0
  let recortados = 0

  for (const planos of brushesSolidos) {
    const bboxSource = bboxDelBrush(planos, nx, ny, nz, dist)
    if (bboxSource === null) {
      console.error(`[${nombre}] brush sólido sin vértices resolubles, se lo descarta`)
      continue
    }

    const planes: number[] = []
    for (const p of planos) {
      const { normal, d } = planoSourceAThreeMetros([nx[p], ny[p], nz[p]], dist[p])
      planes.push(normal[0], normal[1], normal[2], d)
    }

    const { min, max } = bboxSourceAThreeMetros(bboxSource.min, bboxSource.max)
    let caja: Caja = { min, max }

    if (cajaJugable !== null) {
      const centro: [number, number, number] = [
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2,
      ]
      // El brush que no toca la caja jugable no aporta nada al mapa: o es
      // la maqueta del skybox 3D, o es cáscara exterior. Se cuentan aparte
      // para que el reporte diga CUÁL de las dos cosas era.
      if (!cajasSeTocan(caja, cajaJugable)) {
        descartados++
        if (esDelSkybox3D(centro, skyCamera, cajaSpawns)) enSkybox3D++
        continue
      }
      // El que la toca pero se sale por algún lado se recorta agregándole
      // los semiespacios de la caja. Recortar un convexo con un semiespacio
      // da otro convexo: no hay que recalcular nada más que la bbox.
      const nuevos = planosDeRecorte(caja, cajaJugable)
      if (nuevos.length > 0) {
        planes.push(...nuevos)
        caja = recortarCaja(caja, cajaJugable)
        recortados++
      } else {
        dentro++
      }
    } else {
      dentro++
    }

    brushes.push({ planes, min: caja.min, max: caja.max })

    for (let eje = 0; eje < 3; eje++) {
      if (caja.min[eje] < boundsMin[eje]) boundsMin[eje] = caja.min[eje]
      if (caja.max[eje] > boundsMax[eje]) boundsMax[eje] = caja.max[eje]
    }
  }

  // Cierre del recinto. Recortar la colisión saca el piso invisible pero
  // TAMBIÉN saca los muros de la cáscara del mapa, que estaban afuera: sin
  // esto el jugador deja de caminar sobre la nada para pasar a caerse de
  // ella. Ver ESPESOR_CIERRE_M.
  let cierre = 0
  if (cajaJugable !== null) {
    for (const muro of murosDeCierre(cajaJugable)) {
      brushes.push({ planes: planosDeCaja(muro), min: muro.min, max: muro.max })
      cierre++
      for (let eje = 0; eje < 3; eje++) {
        if (muro.min[eje] < boundsMin[eje]) boundsMin[eje] = muro.min[eje]
        if (muro.max[eje] > boundsMax[eje]) boundsMax[eje] = muro.max[eje]
      }
    }
  }

  if (displacements > 0) {
    console.log(`[${nombre}] ${displacements} displacement(s): fuera de alcance, no se generó terreno para ellos`)
  }
  if (carasSinLightmap > 0) {
    console.log(
      `[${nombre}] ${carasSinLightmap} cara(s) visibles sin lightmap: van al texel blanco (se dibujan a albedo pleno)`,
    )
  }

  const doc = await construirGlb(porMaterial)

  const colision: MapaColision = {
    nombre,
    metrosPorUnidad: METROS_POR_UNIDAD,
    bounds:
      brushes.length === 0
        ? { min: [0, 0, 0], max: [0, 0, 0] }
        : { min: boundsMin, max: boundsMax },
    spawns,
    spawnYaws,
    brushes,
  }

  const reporte: ReporteConversion = {
    brushesSolidos: brushes.length,
    spawns: spawns.length,
    triangulos,
    materiales: [...porMaterial.values()].filter((p) => p.indices.length > 0).length,
    displacements,
    jugable: { caja: cajaJugable, dentro, descartados, enSkybox3D, recortados, cierre, carasSkybox3D },
    lightmap:
      atlas === null
        ? null
        : {
            lado: atlas.ancho,
            caras: atlas.caras.length,
            exposicion: atlas.exposicion,
            ocupacion: atlas.ocupacion,
          },
  }

  const lightmapPng = atlas === null ? null : encodePng(atlas.ancho, atlas.alto, atlas.rgba)

  return { colision, doc, reporte, lightmapPng }
}

async function main(): Promise<void> {
  const [rutaBsp, dirSalida] = process.argv.slice(2)
  if (!rutaBsp || !dirSalida) {
    console.error('uso: node scripts/bsp-convert.ts <mapa.bsp> <dir_salida>')
    process.exit(2)
  }
  if (!existsSync(rutaBsp)) {
    console.error(`no existe: ${rutaBsp}`)
    process.exit(2)
  }

  const nombre = basename(rutaBsp, extname(rutaBsp))
  const buf = readFileSync(rutaBsp)
  const { colision, doc, reporte, lightmapPng } = await convertir(buf, nombre)

  mkdirSync(dirSalida, { recursive: true })
  const rutaJson = join(dirSalida, `${nombre}.json`)
  const rutaGlb = join(dirSalida, `${nombre}.glb`)
  const rutaLightmap = join(dirSalida, `${nombre}-lightmap.png`)

  writeFileSync(rutaJson, `${JSON.stringify(colision)}\n`)
  const io = new NodeIO()
  await io.write(rutaGlb, doc)
  if (lightmapPng !== null) writeFileSync(rutaLightmap, lightmapPng)

  console.log(`brushes de colisión: ${reporte.brushesSolidos}`)
  console.log(`spawns:              ${reporte.spawns}`)
  console.log(`triángulos:          ${reporte.triangulos}`)
  console.log(`materiales:          ${reporte.materiales}`)
  console.log(`displacements:       ${reporte.displacements}`)
  const j = reporte.jugable
  if (j.caja === null) {
    console.log('caja jugable:        (no derivable: el mapa no tiene malla visible)')
  } else {
    const tam = [0, 1, 2].map((e) => (j.caja!.max[e] - j.caja!.min[e]).toFixed(1)).join(' x ')
    console.log(`caja jugable:        ${tam} m`)
    console.log(`  brushes dentro:    ${j.dentro}`)
    console.log(`  recortados:        ${j.recortados}`)
    console.log(`  descartados:       ${j.descartados} (${j.enSkybox3D} de la maqueta del skybox 3D)`)
    console.log(`  muros de cierre:   ${j.cierre}`)
    console.log(`  caras de malla descartadas por skybox 3D: ${j.carasSkybox3D}`)
  }
  if (reporte.lightmap !== null) {
    const lm = reporte.lightmap
    console.log(
      `lightmap:            atlas ${lm.lado}x${lm.lado}, ${lm.caras} caras, ` +
        `exposición /${lm.exposicion.toFixed(2)}, ocupación ${(lm.ocupacion * 100).toFixed(1)}%`,
    )
  } else {
    console.log('lightmap:            (el mapa no trae LUMP_LIGHTING)')
  }
  console.log('')
  console.log(`escrito: ${rutaJson}`)
  console.log(`escrito: ${rutaGlb}`)
  if (lightmapPng !== null) console.log(`escrito: ${rutaLightmap} (${(lightmapPng.byteLength / 1e6).toFixed(2)} MB)`)
}

if (process.argv[1]?.endsWith('bsp-convert.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
