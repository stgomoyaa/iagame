/**
 * Ingesta de los VIEWMODELS de Source: GLB con esqueleto, brazos y animaciones
 * -> GLB normalizado que el viewmodel del juego puede reproducir.
 *
 *   node scripts/convert-source-viewmodels.ts <dir_entrada> <dir_salida> [--force]
 *
 * Es el hermano de `convert-source-weapons.ts`, que hace lo mismo con los
 * modelos de MUNDO (`w_`). Comparte con él la idea central —hornear el color
 * de la textura en `COLOR_0` y tirar las texturas— y se aparta en tres cosas,
 * todas forzadas por el hecho de que acá la malla está SKINNEADA:
 *
 * 1. **No se normaliza la geometría con una matriz.** El pipeline `w_` mide el
 *    bounding box, arma una matriz de rotación + escala + centrado y la aplica
 *    a los vértices (`transformMesh`). Eso acá sería un bug silencioso: mover
 *    los vértices de una malla skinneada sin mover también las matrices de
 *    bind inversas del skin deja la malla en un espacio y el esqueleto en
 *    otro, y el resultado es un arma que explota en cuanto empieza a animar.
 *
 *    No hace falta, además. El `v_` de Source ya viene POSADO en espacio de
 *    vista: el hueso raíz está en el ojo del jugador y el arma cuelga de él
 *    exactamente donde CS la muestra. Toda la "normalización" que necesita es
 *    una rotación de ejes constante, y esa vive en el runtime
 *    (`VIEWMODEL_ROTATION` en viewmodel/renderer.ts), aplicada al nodo padre
 *    —que sí puede rotarse sin tocar el skin, porque rota esqueleto y malla
 *    juntos.
 *
 * 2. **No se fusionan mallas (`join`).** `join()` de gltf-transform no toca
 *    mallas skinneadas, y forzarlo tampoco sería deseable: cuerpo y brazos
 *    tienen que quedar SEPARADOS para que el camuflaje pinte el arma y no los
 *    guantes (ver `weapon_arms` en blender/vmdl-to-glb.py). Lo que sí se hace
 *    es colapsar los materiales de cada parte a uno solo después de hornear el
 *    color, que es de donde salía la mayor parte del ahorro de draw calls.
 *
 * 3. **Se conservan las animaciones y el skin**, obviamente, y se registran en
 *    el índice: el runtime necesita saber qué clips existen y cuánto duran
 *    para decidir a qué velocidad reproducirlos contra el `reloadTime` que ya
 *    tienen las estadísticas del arma.
 *
 * El resultado se escribe con los MISMOS slugs que produce el pipeline `w_`
 * (`ak47.glb`, `awp.glb`, ...), porque son la misma arma vista de dos maneras.
 * Eso es lo que permite cambiar de una familia de modelos a la otra sin tocar
 * el registry, el catálogo, los arquetipos ni los nombres.
 *
 * IMPORTANTE: contenido del Workshop, local, nunca se publica. Ver
 * `docs/WORKSHOP.md`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { type Document, NodeIO } from '@gltf-transform/core'
import { KHRMaterialsUnlit } from '@gltf-transform/extensions'
import { dedup, prune } from '@gltf-transform/functions'
import { mergeIndex, type IndexEntry } from './lib/merge-index.ts'
import { decodePng } from './lib/png-reader.ts'
import { encodePngRaw, type RawImage, resizeArea, targetSide } from './lib/png-writer.ts'
import { analizarMascaraPhong, construirMetalRough, descartarAlfa } from './lib/source-pbr.ts'
import { detectSightLine, type SightType } from './lib/sight.ts'
import {
  SOURCE_WEAPONS,
  sourceWeaponDisplayName,
  type SourceWeaponEntry,
} from '../src/game/weapons/source-catalog.ts'

/**
 * Nombres de las dos partes, escritos por `blender/vmdl-to-glb.py`. Son el
 * contrato con `viewmodel/renderer.ts`: el camuflaje se le engancha SÓLO al
 * cuerpo, y esa decisión se toma comparando contra esta constante.
 */
const NODE_BODY = 'weapon_body'
const NODE_ARMS = 'weapon_arms'

/** Clips canónicos que puede traer un viewmodel. Los escribe el script de
 *  Blender; acá sólo se leen para el índice. */
export type ViewmodelClip = 'reload' | 'draw' | 'idle' | 'fire'

export interface ViewmodelClipInfo {
  name: ViewmodelClip
  /** Segundos a velocidad nativa. El runtime lo compara con `reloadTime`. */
  duration: number
}

export interface ViewmodelIndexEntry extends IndexEntry {
  name: string
  sightHeight: number
  sightLateral: number
  sightType: SightType
  sightConfidence: number
  /**
   * Marca que este `.glb` es un viewmodel de Source: trae esqueleto, brazos y
   * clips importados, y el runtime tiene que reproducirlos en vez de correr la
   * coreografía procedural de recarga.
   *
   * Es un campo del índice y no una inferencia del GLB por una razón concreta:
   * `seed.ts` calcula las poses de cadera y mira ANTES de que ningún GLB se
   * haya bajado (arma las 79 entradas al cargar el índice), así que necesita
   * saberlo sin abrir el archivo. El renderer, que sí tiene el GLB en la mano,
   * decide por lo que encuentra adentro; los dos coinciden y ninguno depende
   * del otro.
   */
  viewmodel: true
  /** Clips que trae, con su duración nativa. */
  clips: ViewmodelClipInfo[]
  /** Huesos del esqueleto. Métrica de costo, no la usa el runtime. */
  bones: number
  /** Triángulos de los brazos, incluidos en `triangles`. */
  armTriangles: number
}

// La conversión sRGB -> lineal que vivía acá se fue con el horneado a
// `COLOR_0`: ahora la textura viaja como textura y es el propio glTF el que
// declara su espacio de color (`baseColorTexture` es sRGB por especificación),
// así que la conversión la hace el sampler de la GPU y no este script.

/**
 * Posiciones de las primitivas de una malla concreta.
 *
 * A diferencia del pipeline `w_`, que junta TODO el documento, acá interesa
 * por parte: el bounding box que se guarda en el índice y la línea de
 * puntería tienen que medirse sobre el ARMA, no sobre el arma más dos brazos
 * que la envuelven. Con los brazos adentro, el "punto más alto del modelo"
 * —que es como `detectSightLine` encuentra el alza— sería un nudillo.
 */
function positionsOfMesh(doc: Document, meshName: string): Float32Array {
  const chunks: Float32Array[] = []
  let total = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    if (mesh.getName() !== meshName) continue
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      const arr = pos?.getArray()
      if (!arr) continue
      const f32 = arr instanceof Float32Array ? arr : Float32Array.from(arr)
      chunks.push(f32)
      total += f32.length
    }
  }
  const out = new Float32Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

function boundsOfPositions(positions: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  return { min, max }
}

function countTriangles(doc: Document, meshName?: string): number {
  let tris = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    if (meshName !== undefined && mesh.getName() !== meshName) continue
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices()
      const pos = prim.getAttribute('POSITION')
      const count = indices ? indices.getCount() : pos ? pos.getCount() : 0
      tris += Math.floor(count / 3)
    }
  }
  return tris
}

/**
 * Lado máximo de la textura del CUERPO del arma.
 *
 * Los `v_` de CS vienen en 2048x2048. A la distancia a la que se ve un
 * viewmodel —el arma ocupa cerca de un tercio de la pantalla y nunca se
 * acerca más— 1024 no se distingue de 2048, y el archivo pasa de 7.5 MB a
 * poco más de 1 MB. La textura sigue siendo el grueso del GLB, así que este
 * número es el que manda en el tiempo de carga de un arma.
 */
const MAX_LADO_CUERPO = 1024

/**
 * Lado máximo de las texturas de los BRAZOS.
 *
 * La mitad que el cuerpo porque los brazos ocupan menos pantalla, están casi
 * siempre parcialmente fuera de cuadro y —esto es lo que decide— son los
 * MISMOS en las 42 armas: cada byte que pesen se paga 42 veces en disco y una
 * vez por cada cambio de arma en carga.
 */
const MAX_LADO_BRAZOS = 512

/** Rugosidad de un material sin máscara de phong utilizable. */
const RUGOSIDAD_SIN_MASCARA = 0.75

export interface EstadisticasTexturas {
  /** Texturas reescaladas y reescritas. */
  procesadas: number
  /** Materiales que recibieron un mapa metallic-roughness derivado del alfa. */
  conMascara: number
  /** Bytes de imagen después de procesar. */
  bytes: number
}

/**
 * Conserva UVs, normales y texturas, y traduce el material de Source a
 * metallic-roughness de glTF.
 *
 * Es el reemplazo del horneado a `COLOR_0` que hacía este script antes. Aquel
 * horneado nació cuando el presupuesto de 2.5 ms mandaba y se buscaba una sola
 * llamada de dibujo por arma; el costo escondido era que dejaba el arma SIN
 * NORMALES y sin UVs, y sin normales no hay iluminación posible: por más luces
 * que se le pongan a la escena, un material sin normales devuelve color plano.
 * De ahí el "parece Roblox".
 *
 * Lo que hace ahora, por material:
 *
 * 1. Reescala la textura base a `maxLado` y le SACA el alfa.
 * 2. Si ese alfa era una máscara de phong (ver `lib/source-pbr.ts`), la
 *    convierte en un mapa metallic-roughness. Eso es lo que hace que el
 *    cerrojo brille y la culata no.
 * 3. Si no lo era —guantes, piel—, deja factores constantes mate.
 *
 * Lo que NO hace y antes sí: tocar `COLOR_0`, `TEXCOORD_0` ni `NORMAL`. Los
 * tres se conservan tal como vinieron de Blender.
 *
 * Se mantiene un material por PRIMITIVA en vez de colapsar a uno por malla:
 * ahora cada uno lleva su propia textura, así que fusionarlos perdería
 * exactamente la información que este cambio vino a rescatar. El cuerpo del
 * arma sigue siendo una sola primitiva con un solo material, que es lo que
 * `skins/material.ts` necesita para que el camuflaje caiga en el arma y no en
 * los guantes.
 */
function prepararMaterialesPbr(doc: Document): EstadisticasTexturas {
  const root = doc.getRoot()
  const stats: EstadisticasTexturas = { procesadas: 0, conMascara: 0, bytes: 0 }

  // Lado máximo por material, según la malla que lo usa. Se resuelve mirando
  // qué primitiva lo referencia: un material del cuerpo va a 1024 y uno de los
  // brazos a 512.
  const ladoPorMaterial = new Map<string, number>()
  for (const mesh of root.listMeshes()) {
    const lado = mesh.getName() === NODE_ARMS ? MAX_LADO_BRAZOS : MAX_LADO_CUERPO
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial()
      if (material) ladoPorMaterial.set(material.getName(), lado)
    }
  }

  // Una textura puede estar compartida por varios materiales; se reescribe una
  // sola vez.
  const yaProcesadas = new Set<unknown>()

  const procesarImagen = (texture: ReturnType<Document['createTexture']>, lado: number, quitarAlfa: boolean): RawImage | null => {
    const image = texture.getImage()
    if (!image) return null
    const png = decodePng(Buffer.from(image))
    const original: RawImage = {
      width: png.width,
      height: png.height,
      data: png.rgba,
      channels: 4,
    }
    // El lado objetivo se calcula sobre el lado MAYOR y se aplica a los dos
    // ejes por separado, para no deformar texturas que no son cuadradas (la
    // piel de los brazos es 1024x2048).
    const mayor = Math.max(original.width, original.height)
    const destino = targetSide(mayor, lado)
    const factor = destino / mayor
    const escalada = resizeArea(
      original,
      Math.max(1, Math.round(original.width * factor)),
      Math.max(1, Math.round(original.height * factor)),
    )

    if (!yaProcesadas.has(texture)) {
      const final = quitarAlfa ? descartarAlfa(escalada) : escalada
      const bytes = encodePngRaw(final)
      texture.setImage(bytes).setMimeType('image/png')
      yaProcesadas.add(texture)
      stats.procesadas++
      stats.bytes += bytes.length
    }
    return escalada
  }

  for (const material of root.listMaterials()) {
    const lado = ladoPorMaterial.get(material.getName()) ?? MAX_LADO_CUERPO

    const normal = material.getNormalTexture()
    if (normal) procesarImagen(normal, lado, true)

    const base = material.getBaseColorTexture()
    if (!base) {
      material.setMetallicFactor(0).setRoughnessFactor(RUGOSIDAD_SIN_MASCARA)
      continue
    }

    // El análisis de la máscara va sobre la textura YA reescalada: es la que
    // se va a muestrear en el juego, y promediar por área puede achatar
    // máscaras muy finas. Medir sobre la original diría que hay máscara donde
    // después no la hay.
    const escalada = procesarImagen(base, lado, true)
    if (!escalada) {
      material.setMetallicFactor(0).setRoughnessFactor(RUGOSIDAD_SIN_MASCARA)
      continue
    }

    const mascara = analizarMascaraPhong(escalada.data)
    if (!mascara.usable) {
      material.setMetallicFactor(0).setRoughnessFactor(RUGOSIDAD_SIN_MASCARA)
      continue
    }

    // El mapa metallic-roughness va a la MITAD del lado de la base. La
    // rugosidad de un arma es una señal de baja frecuencia —"esta pieza es
    // acero, esta otra es polímero"— y sus bordes coinciden con bordes de
    // geometría que la normal ya define con nitidez. A resolución completa
    // pesaba tanto como el albedo sin aportar nada visible.
    const mrCompleto = construirMetalRough(escalada)
    const mr = resizeArea(
      mrCompleto,
      Math.max(1, mrCompleto.width >> 1),
      Math.max(1, mrCompleto.height >> 1),
    )
    const textura = doc
      .createTexture(`${material.getName()}_mr`)
      .setImage(encodePngRaw(mr))
      .setMimeType('image/png')
    stats.bytes += (textura.getImage()?.byteLength ?? 0)
    // Factores en 1: los valores salen ENTEROS de la textura. glTF multiplica
    // factor por textura, así que un factor en 0 —el default de este material
    // tras venir de Blender— anularía el mapa entero y dejaría el arma mate,
    // que es el bug silencioso de este bloque.
    material
      .setMetallicRoughnessTexture(textura)
      .setMetallicFactor(1)
      .setRoughnessFactor(1)
      .setAlphaMode('OPAQUE')
    stats.conMascara++
  }

  return stats
}

/**
 * Verifica que las mallas conserven lo que la iluminación necesita.
 *
 * Va aparte y corre DESPUÉS de `prune()` a propósito: `prune()` borra
 * atributos que considera sin usar, y un cambio de versión de la librería que
 * decidiera que las normales sobran dejaría las armas planas otra vez sin
 * ningún error. Ese es exactamente el modo de falla que este proyecto ya vivió
 * —el pipeline que tiraba las normales en silencio— y no se vuelve a dejar
 * abierto.
 */
function verificarAtributosPbr(doc: Document): void {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial()
      if (!prim.getAttribute('NORMAL')) {
        throw new Error(`la malla "${mesh.getName()}" quedó sin NORMAL: se vería sin iluminación`)
      }
      if (material?.getBaseColorTexture() && !prim.getAttribute('TEXCOORD_0')) {
        throw new Error(`la malla "${mesh.getName()}" tiene textura pero quedó sin TEXCOORD_0`)
      }
    }
  }
}

/**
 * Borra los nodos que SourceIO deja sueltos y que no aportan nada al runtime.
 *
 * El importador crea un empty por cada "attachment" del modelo (boca de fuego,
 * eyector de casquillos, mira): en Source son puntos de anclaje para efectos,
 * y llegan al glTF como nodos raíz con nombres numéricos (`1`, `2`) que
 * ninguna malla ni ningún skin referencia. Se los deja afuera para que el
 * runtime pueda tratar a la escena del GLB como "el arma y nada más".
 *
 * Se borra sólo lo que NO participa del skin ni tiene malla, así que un nodo
 * que resulte ser un hueso —o el padre de uno— nunca entra acá.
 */
function pruneLooseNodes(doc: Document): number {
  const usados = new Set<string>()
  for (const skin of doc.getRoot().listSkins()) {
    for (const joint of skin.listJoints()) usados.add(joint.getName())
    const raiz = skin.getSkeleton()
    if (raiz) usados.add(raiz.getName())
  }

  let borrados = 0
  for (const scene of doc.getRoot().listScenes()) {
    for (const node of scene.listChildren()) {
      if (node.getMesh() !== null) continue
      if (node.getSkin() !== null) continue
      if (usados.has(node.getName())) continue
      if (node.listChildren().length > 0) continue
      node.dispose()
      borrados++
    }
  }
  return borrados
}

/** Clips presentes en el documento, con su duración real. */
function readClips(doc: Document): ViewmodelClipInfo[] {
  const validos: ViewmodelClip[] = ['reload', 'draw', 'idle', 'fire']
  const clips: ViewmodelClipInfo[] = []
  for (const anim of doc.getRoot().listAnimations()) {
    const nombre = anim.getName() as ViewmodelClip
    if (!validos.includes(nombre)) continue
    let duracion = 0
    for (const sampler of anim.listSamplers()) {
      const input = sampler.getInput()
      if (input) duracion = Math.max(duracion, input.getMax([0])[0])
    }
    clips.push({ name: nombre, duration: Number(duracion.toFixed(4)) })
  }
  return clips
}

async function convertOne(
  io: NodeIO,
  inPath: string,
  outPath: string,
  entry: SourceWeaponEntry,
): Promise<ViewmodelIndexEntry> {
  const doc = await io.read(inPath)

  // dedup() sí es seguro con skins (fusiona accessors/materiales idénticos, no
  // mueve vértices). flatten()/join()/weld()/transformMesh NO se usan: ver el
  // punto 1 del encabezado.
  await doc.transform(dedup())
  pruneLooseNodes(doc)
  prepararMaterialesPbr(doc)
  // Sin `unlit()`: marcar el material como KHR_materials_unlit es justamente
  // lo que le decía al runtime "este arma no se ilumina". Ahora sí se ilumina.
  // `prune()` se conserva —limpia accessors y nodos que quedaron sueltos— y
  // `verificarAtributosPbr` corre después para confirmar que no se llevó
  // puesto nada que haga falta.
  await doc.transform(prune())
  verificarAtributosPbr(doc)

  const bodyPositions = positionsOfMesh(doc, NODE_BODY)
  if (bodyPositions.length === 0) throw new Error(`no hay malla "${NODE_BODY}" con vértices`)

  const clips = readClips(doc)
  if (!clips.some((c) => c.name === 'reload')) {
    throw new Error('el GLB no trae clip de recarga')
  }

  const skin = doc.getRoot().listSkins()[0]
  if (!skin) throw new Error('el GLB no trae skin: la animación no movería la malla')

  const b = boundsOfPositions(bodyPositions)
  // La línea de puntería se mide sobre el CUERPO en pose de reposo. Es el
  // punto de partida para el ADS y hay que re-verificarlo mirando: el `v_`
  // tiene otra geometría y otro punto de vista que el `w_`, así que el número
  // medido acá no es intercambiable con el del otro pipeline.
  const sight = detectSightLine(bodyPositions, entry.sight)

  await io.write(outPath, doc)

  const armTriangles = countTriangles(doc, NODE_ARMS)

  return {
    slug: entry.slug,
    name: sourceWeaponDisplayName(entry),
    triangles: countTriangles(doc),
    armTriangles,
    bones: skin.listJoints().length,
    viewmodel: true,
    clips,
    bounds: {
      min: [b.min[0], b.min[1], b.min[2]],
      max: [b.max[0], b.max[1], b.max[2]],
    },
    muzzleConfidence: 1,
    upAxisConfidence: 1,
    needsManualReview: false,
    sightHeight: Number(sight.height.toFixed(5)),
    sightLateral: Number(sight.lateral.toFixed(5)),
    sightType: entry.sight,
    sightConfidence: Number(sight.confidence.toFixed(3)),
  }
}

function readExistingIndex(outDir: string): ViewmodelIndexEntry[] {
  const indexPath = join(outDir, 'index.json')
  if (!existsSync(indexPath)) return []
  try {
    const raw: unknown = JSON.parse(readFileSync(indexPath, 'utf8'))
    return Array.isArray(raw) ? (raw as ViewmodelIndexEntry[]) : []
  } catch {
    console.error(`no se pudo leer ${indexPath}, se lo trata como vacío`)
    return []
  }
}

function glbSlugsOnDisk(outDir: string): Set<string> {
  return new Set(
    readdirSync(outDir)
      .filter((f) => f.endsWith('.glb'))
      .map((f) => basename(f, '.glb')),
  )
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const positional = args.filter((a) => !a.startsWith('--'))

  if (positional.length < 2) {
    console.error('uso: node scripts/convert-source-viewmodels.ts <dir_entrada> <dir_salida> [--force]')
    process.exit(2)
  }

  const [inDir, outDir] = positional
  if (!existsSync(inDir)) {
    console.error(`el directorio de entrada no existe: ${inDir}`)
    process.exit(2)
  }
  mkdirSync(outDir, { recursive: true })

  const io = new NodeIO().registerExtensions([KHRMaterialsUnlit])
  const entries: ViewmodelIndexEntry[] = []
  const failures: Array<{ slug: string; error: string }> = []
  let skipped = 0
  let missing = 0

  // Se recorre el CATÁLOGO y no el directorio, igual que el pipeline `w_`: un
  // .glb sin fila no tiene nombre genérico ni arquetipo.
  for (const entry of SOURCE_WEAPONS) {
    const inPath = join(inDir, `${entry.slug}.glb`)
    if (!existsSync(inPath)) {
      missing++
      continue
    }

    const outPath = join(outDir, `${entry.slug}.glb`)
    if (!force && existsSync(outPath) && statSync(outPath).mtimeMs >= statSync(inPath).mtimeMs) {
      skipped++
      continue
    }

    try {
      const result = await convertOne(io, inPath, outPath, entry)
      entries.push(result)
      const clips = result.clips.map((c) => `${c.name}:${c.duration}s`).join(' ')
      console.log(
        `ok    ${result.slug.padEnd(18)} ${String(result.triangles).padStart(6)} tris ` +
          `(${result.armTriangles} brazos)  ${result.bones} huesos  ` +
          `${(statSync(outPath).size / 1024).toFixed(0)}KB  ` +
          `mira ${(result.sightHeight * 100).toFixed(1)}cm  ${clips}`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ slug: entry.slug, error: message.split('\n')[0] })
      console.error(`FALLO ${entry.slug}: ${message.split('\n')[0]}`)
    }
  }

  const existingIndex = readExistingIndex(outDir)
  const merged = mergeIndex(existingIndex, entries, glbSlugsOnDisk(outDir)) as ViewmodelIndexEntry[]
  if (merged.length > 0) {
    writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(merged, null, 2)}\n`)
  }

  console.log('')
  console.log(`convertidas: ${entries.length}`)
  console.log(`saltadas:    ${skipped}`)
  console.log(`sin archivo: ${missing}`)
  console.log(`fallidas:    ${failures.length}`)
  console.log(`índice:      ${merged.length} entradas (antes ${existingIndex.length})`)

  if (failures.length > 0) process.exit(1)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
