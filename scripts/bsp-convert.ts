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
  leerBrushesSolidos,
  leerLumps,
  leerPlanos,
  planoSourceAThreeMetros,
  puntoSourceAThreeMetros,
} from './lib/bsp.ts'

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
  brushes: BrushColision[]
}

export interface ReporteConversion {
  brushesSolidos: number
  spawns: number
  triangulos: number
  materiales: number
  displacements: number
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

/** Spawns del mapa: origin de toda entidad `info_player_*`, en metros de three.js. */
function leerSpawns(buf: Buffer, lump: Lump): Array<[number, number, number]> {
  const texto = buf.toString('utf8', lump.offset, lump.offset + lump.largo)
  const spawns: Array<[number, number, number]> = []

  for (const ent of leerEntidades(texto)) {
    if (!ent.classname?.startsWith('info_player_')) continue
    if (!ent.origin) continue

    const partes = ent.origin.trim().split(/\s+/).map(Number)
    if (partes.length !== 3 || partes.some((n) => !Number.isFinite(n))) continue

    spawns.push(puntoSourceAThreeMetros(partes as [number, number, number]))
  }

  return spawns
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

function esCaraDescartable(flags: number, nombreMaterial: string): boolean {
  if ((flags & SURF_DESCARTABLE) !== 0) return true
  const n = nombreMaterial.toLowerCase()
  return MATERIALES_DESCARTABLES.some((m) => n.includes(m))
}

interface PrimitivaAcumulada {
  posiciones: number[]
  uvs: number[]
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
): { porMaterial: Map<string, PrimitivaAcumulada>; triangulos: number; displacements: number } {
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

  const porMaterial = new Map<string, PrimitivaAcumulada>()
  let triangulos = 0

  for (const face of faces) {
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

    let acumulado = porMaterial.get(nombreMaterial)
    if (!acumulado) {
      acumulado = { posiciones: [], uvs: [], indices: [] }
      porMaterial.set(nombreMaterial, acumulado)
    }

    const anchoTex = texdata && texdata.width > 0 ? texdata.width : 1
    const altoTex = texdata && texdata.height > 0 ? texdata.height : 1
    const base = acumulado.posiciones.length / 3

    for (const v of loop) {
      const p = puntoSourceAThreeMetros(v)
      acumulado.posiciones.push(p[0], p[1], p[2])

      // UV de Source: proyección del vértice (en unidades de Source, sin
      // convertir) sobre los vectores de textureVecs, dividida por el
      // tamaño de la textura en texeles. No hay flip de V acá: las texturas
      // se enganchan en una tarea posterior, que es quien puede verificarlo
      // contra una imagen real.
      const s = v[0] * texinfo.vecS[0] + v[1] * texinfo.vecS[1] + v[2] * texinfo.vecS[2] + texinfo.vecS[3]
      const t = v[0] * texinfo.vecT[0] + v[1] * texinfo.vecT[1] + v[2] * texinfo.vecT[2] + texinfo.vecT[3]
      acumulado.uvs.push(s / anchoTex, t / altoTex)
    }

    // Las caras de Source son siempre convexas: un abanico desde el primer
    // vértice triangula cualquier polígono sin más trabajo. La rotación de
    // ejes que se aplicó arriba (ejesSourceAThree) es una rotación pura
    // (determinante +1, no una reflexión), así que preserva el sentido del
    // winding: no hace falta invertir el orden de los índices acá.
    for (let k = 1; k < loop.length - 1; k++) {
      acumulado.indices.push(base, base + k, base + k + 1)
      triangulos++
    }
  }

  return { porMaterial, triangulos, displacements }
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
    const idxAccessor = doc
      .createAccessor(undefined, buffer)
      .setType('SCALAR')
      .setArray(new Uint32Array(acumulado.indices))

    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', posAccessor)
      .setAttribute('TEXCOORD_0', uvAccessor)
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
): Promise<{ colision: MapaColision; doc: Document; reporte: ReporteConversion }> {
  const { lumps } = leerLumps(buf)
  const { nx, ny, nz, dist } = leerPlanos(buf, lumps[LUMP_PLANES])

  const spawns = leerSpawns(buf, lumps[LUMP_ENTITIES])
  if (spawns.length === 0) {
    console.error(`[${nombre}] ADVERTENCIA: no se encontró ningún info_player_*. Este mapa no es jugable.`)
  }

  const brushesSolidos = leerBrushesSolidos(buf, lumps)
  const brushes: BrushColision[] = []
  const boundsMin: [number, number, number] = [Infinity, Infinity, Infinity]
  const boundsMax: [number, number, number] = [-Infinity, -Infinity, -Infinity]

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
    brushes.push({ planes, min, max })

    for (let eje = 0; eje < 3; eje++) {
      if (min[eje] < boundsMin[eje]) boundsMin[eje] = min[eje]
      if (max[eje] > boundsMax[eje]) boundsMax[eje] = max[eje]
    }
  }

  const { porMaterial, triangulos, displacements } = construirMalla(buf, lumps)
  if (displacements > 0) {
    console.log(`[${nombre}] ${displacements} displacement(s): fuera de alcance, no se generó terreno para ellos`)
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
    brushes,
  }

  const reporte: ReporteConversion = {
    brushesSolidos: brushes.length,
    spawns: spawns.length,
    triangulos,
    materiales: [...porMaterial.values()].filter((p) => p.indices.length > 0).length,
    displacements,
  }

  return { colision, doc, reporte }
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
  const { colision, doc, reporte } = await convertir(buf, nombre)

  mkdirSync(dirSalida, { recursive: true })
  const rutaJson = join(dirSalida, `${nombre}.json`)
  const rutaGlb = join(dirSalida, `${nombre}.glb`)

  writeFileSync(rutaJson, `${JSON.stringify(colision)}\n`)
  const io = new NodeIO()
  await io.write(rutaGlb, doc)

  console.log(`brushes sólidos:  ${reporte.brushesSolidos}`)
  console.log(`spawns:           ${reporte.spawns}`)
  console.log(`triángulos:       ${reporte.triangulos}`)
  console.log(`materiales:       ${reporte.materiales}`)
  console.log(`displacements:    ${reporte.displacements}`)
  console.log('')
  console.log(`escrito: ${rutaJson}`)
  console.log(`escrito: ${rutaGlb}`)
}

if (process.argv[1]?.endsWith('bsp-convert.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
