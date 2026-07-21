/**
 * Pipeline de conversión de armas: FBX -> GLB normalizado.
 *
 *   node scripts/convert-weapons.ts <dir_entrada> <dir_salida> [--force]
 *
 * Los packs CC0 llegan en FBX con escalas, orientaciones y jerarquías
 * arbitrarias. Este script los deja en un estado uniforme que el viewmodel
 * puede consumir sin tratar cada arma como un caso especial.
 *
 * Qué hace por archivo:
 *   1. Convierte FBX a glTF con FBX2glTF.
 *   2. Aplana la jerarquía y fusiona las mallas en una sola.
 *   3. Hornea el color de cada material en vértices (COLOR_0) y colapsa
 *      todos los materiales a uno solo, para volver a fusionar en 1 sólo
 *      primitivo por arma.
 *   4. Detecta el eje del cañón y hacia dónde apunta la boca.
 *   5. Detecta cuál de los dos ejes restantes es "arriba": el pack de
 *      Quaternius viene exportado de Blender (Z-up), así que no se puede
 *      asumir Y como en un motor de juego; se mide cuál eje tiene mayor
 *      extensión en la caja envolvente, porque un arma es más alta que
 *      ancha.
 *   6. Rota para dejar la boca hacia -Z y el eje "arriba" detectado hacia +Y.
 *   7. Escala uniformemente al largo objetivo de la clase del arma (una
 *      pistola no puede terminar del mismo largo que un fusil de asalto).
 *   8. Centra en el origen.
 *   9. Marca el material único como unlit: el spec prohíbe el costo de PBR.
 *   10. Limpia con dedup y prune.
 *
 * Falla por archivo sin cortar el lote, e imprime una tabla al final.
 * Es idempotente: salta lo ya convertido salvo que se pase --force.
 *
 * El índice (`index.json`) se fusiona con el que ya existe en el
 * directorio de salida al final de cada corrida: nunca se reescribe sólo
 * con lo convertido en esta ejecución. Si no fuera así, una corrida
 * incremental (que saltea lo ya convertido) o una parcialmente fallida
 * borraría del índice -y por lo tanto del registry, del panel de tuning y
 * del arma de arranque del juego- las armas que ya estaban convertidas.
 * Una entrada existente cuyo .glb ya no está en el directorio de salida se
 * descarta (huérfana) y se loguea qué se descartó; ver `mergeIndex` en
 * `lib/merge-index.ts` para la política completa.
 *
 * LIMITACIÓN CONOCIDA: tanto la detección de la boca como la del eje
 * "arriba" son heurísticas sobre la geometría (distribución de masa y
 * extensión de la caja envolvente). Aciertan en la mayoría de las siluetas
 * y fallan en las atípicas (escopetas, revólveres, cualquier cosa con
 * bípode, o un arma de sección casi cuadrada). Por eso el índice registra
 * `muzzleConfidence` y `upAxisConfidence`, y el panel de tuning necesita
 * sliders de rotación, no sólo de posición.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { KHRMaterialsUnlit } from '@gltf-transform/extensions'
import {
  clearNodeTransform,
  dedup,
  flatten,
  join as joinMeshes,
  prune,
  transformMesh,
  unlit,
  weld,
} from '@gltf-transform/functions'
// Extensión explícita: Node resuelve ESM nativo y la exige. Vitest resuelve
// sin ella, así que omitirla deja los tests en verde y el script roto.
import {
  boundsOf,
  buildNormalizeMatrix,
  detectMuzzle,
  detectUpAxis,
  displayName,
  muzzleFromGeometry,
  slugify,
  targetLengthFor,
} from './lib/geometry.ts'
import { mergeIndex, type IndexEntry } from './lib/merge-index.ts'

/** Bajo esta confianza, la orientación del cañón se marca para revisión manual. */
const MUZZLE_CONFIDENCE_THRESHOLD = 0.15

/** Bajo esta confianza, el eje "arriba" elegido se marca para revisión manual. */
const UP_AXIS_CONFIDENCE_THRESHOLD = 0.15

/**
 * Directorio de binarios por SO dentro del paquete "fbx2gltf", tal como lo
 * empaqueta ese paquete (no es `process.platform` directo: usa los nombres
 * de `os.type()`, con otra convención de mayúsculas).
 */
const FBX2GLTF_PLATFORM_DIRS: Record<string, string> = {
  darwin: 'Darwin',
  linux: 'Linux',
  win32: 'Windows_NT',
}

/**
 * Resuelve el binario de FBX2glTF por resolución estándar de módulos de
 * Node en vez de una ruta fija a la estructura interna de un gestor de
 * paquetes en particular: una ruta hardcodeada a
 * `.pnpm/fbx2gltf@<versión>/...` se rompe con npm o yarn, con cualquier
 * bump de versión del paquete "fbx2gltf", y en cualquier SO que no sea
 * macOS. `require.resolve` sigue el algoritmo real de resolución de
 * node_modules (funciona igual con pnpm, npm o yarn) para encontrar el
 * `index.js` del paquete, y desde ahí el binario cuelga de una carpeta fija
 * (`bin/<SO>/FBX2glTF`) definida por el propio paquete.
 *
 * Devuelve `undefined` si el paquete no está instalado o el SO no tiene
 * binario empaquetado: quien llama decide cómo fallar (fallo ruidoso, no
 * silencioso).
 */
function resolveFbx2GltfBin(): string | undefined {
  const platformDir = FBX2GLTF_PLATFORM_DIRS[process.platform]
  if (!platformDir) return undefined

  try {
    const require = createRequire(import.meta.url)
    const pkgEntry = require.resolve('fbx2gltf')
    const ext = process.platform === 'win32' ? '.exe' : ''
    return join(dirname(pkgEntry), 'bin', platformDir, `FBX2glTF${ext}`)
  } catch {
    return undefined
  }
}

interface Failure {
  file: string
  error: string
}

/** Todas las posiciones del documento, en espacio de mundo ya aplanado. */
function collectPositions(doc: Document): Float32Array {
  const chunks: Float32Array[] = []
  let total = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const arr = pos.getArray()
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

/**
 * Hornea el baseColorFactor de cada material en un atributo COLOR_0 por
 * vértice y reemplaza todos los materiales por uno solo, blanco y unlit.
 *
 * Las armas no tienen textura: cada material sólo aporta un color plano.
 * join() únicamente fusiona primitivos que comparten material, así que sin
 * esto cada arma queda en N draw calls (uno por material original) en vez
 * de 1. COLOR_0 y baseColorFactor están ambos en espacio lineal, por eso
 * se copian los valores tal cual, sin conversión sRGB.
 */
function bakeVertexColors(doc: Document): void {
  const root = doc.getRoot()
  const buffer = root.listBuffers()[0]
  const baked = doc.createMaterial('baked').setBaseColorFactor([1, 1, 1, 1])

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial()
      const factor = material ? material.getBaseColorFactor() : [1, 1, 1, 1]
      const position = prim.getAttribute('POSITION')
      if (!position) continue

      const count = position.getCount()
      const colors = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        colors[i * 3] = factor[0]
        colors[i * 3 + 1] = factor[1]
        colors[i * 3 + 2] = factor[2]
      }

      const colorAccessor = doc.createAccessor(undefined, buffer).setType('VEC3').setArray(colors)
      prim.setAttribute('COLOR_0', colorAccessor)
      prim.setMaterial(baked)
    }
  }
}

function countTriangles(doc: Document): number {
  let tris = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices()
      const pos = prim.getAttribute('POSITION')
      const count = indices ? indices.getCount() : pos ? pos.getCount() : 0
      tris += Math.floor(count / 3)
    }
  }
  return tris
}

async function convertOne(
  io: NodeIO,
  fbxPath: string,
  outPath: string,
  fbx2gltfBin: string,
): Promise<IndexEntry> {
  const tmpGlb = outPath.replace(/\.glb$/, '.raw.glb')

  // El .raw.glb es un archivo temporal: si cualquier paso de acá para abajo
  // lanza, no puede quedar tirado en el directorio de salida, donde se
  // sirve y eventualmente se commitea. El finally cubre tanto el camino
  // feliz como cualquier falla intermedia.
  try {
    execFileSync(fbx2gltfBin, ['--binary', '--input', fbxPath, '--output', tmpGlb], {
      stdio: 'pipe',
    })

    const doc = await io.read(tmpGlb)

    // Aplanar y fusionar: el viewmodel quiere una malla, no una jerarquía.
    await doc.transform(flatten(), dedup(), joinMeshes(), weld())

    // FBX2glTF deja un transform residual en el nodo (~100x de escala y -90°
    // en X) que flatten() compone hacia abajo pero no hornea en la malla: es
    // el resabio de la conversión de unidades/eje del FBX de origen. Se
    // descarta acá, antes de detectar cañón y eje "arriba", en vez de dejarlo
    // para el final: esas detecciones (más abajo) son autoreferenciales sobre
    // la propia geometría, no asumen ninguna convención de ejes de entrada, así
    // que hornear este transform primero no cambia el resultado normalizado,
    // sólo asegura que el nodo llegue a la escritura final en identidad.
    for (const node of doc.getRoot().listNodes()) clearNodeTransform(node)

    // Hornear el color de cada material en vértices y colapsar a un único
    // material antes de volver a fusionar: recién ahí join() puede juntar
    // primitivos que antes tenían materiales distintos.
    bakeVertexColors(doc)
    await doc.transform(joinMeshes())

    const positions = collectPositions(doc)
    if (positions.length === 0) throw new Error('el modelo no tiene vértices')

    const name = basename(fbxPath, extname(fbxPath))

    const { axis, sign, confidence } = detectMuzzle(positions)
    const { axis: upAxis, confidence: upAxisConfidence } = detectUpAxis(positions, axis)
    const targetLengthM = targetLengthFor(name)
    const matrix = buildNormalizeMatrix(positions, axis, sign, upAxis, targetLengthM)

    for (const mesh of doc.getRoot().listMeshes()) {
      transformMesh(mesh, matrix)
    }

    // Sin PBR: el presupuesto de frame no lo permite y las skins se aplican
    // en runtime como override de material.
    await doc.transform(unlit(), prune())

    const finalPositions = collectPositions(doc)
    const b = boundsOf(finalPositions)
    // Boca de cañón para el fogonazo: el centroide de la rebanada más adelantada
    // (-Z, ya normalizado) cae sobre el eje del ánima, no en el centro de la
    // caja. Sin esto el fogonazo salía por debajo del cañón (ver vfx-renderer).
    const muzzle = muzzleFromGeometry(finalPositions)

    await io.write(outPath, doc)

    return {
      slug: slugify(name),
      name: displayName(name),
      triangles: countTriangles(doc),
      bounds: {
        min: [b.min[0], b.min[1], b.min[2]],
        max: [b.max[0], b.max[1], b.max[2]],
      },
      muzzleConfidence: Number(confidence.toFixed(3)),
      upAxisConfidence: Number(upAxisConfidence.toFixed(3)),
      needsManualReview:
        confidence < MUZZLE_CONFIDENCE_THRESHOLD ||
        upAxisConfidence < UP_AXIS_CONFIDENCE_THRESHOLD,
      muzzleX: Number(muzzle.x.toFixed(5)),
      muzzleY: Number(muzzle.y.toFixed(5)),
      muzzleZ: Number(muzzle.z.toFixed(5)),
    }
  } finally {
    if (existsSync(tmpGlb)) unlinkSync(tmpGlb)
  }
}

/**
 * Lee el index.json existente en el directorio de salida, si lo hay. Un
 * índice ausente (primera corrida en un outDir nuevo) o corrupto se trata
 * como vacío: el merge de todas formas repuebla las entradas correctas a
 * partir de lo que haya en disco y de esta corrida, así que no hace falta
 * abortar por esto.
 */
function readExistingIndex(outDir: string): IndexEntry[] {
  const indexPath = join(outDir, 'index.json')
  if (!existsSync(indexPath)) return []

  try {
    const raw: unknown = JSON.parse(readFileSync(indexPath, 'utf8'))
    return Array.isArray(raw) ? (raw as IndexEntry[]) : []
  } catch {
    console.error(`no se pudo leer ${indexPath}, se lo trata como vacío`)
    return []
  }
}

/** Slugs con un .glb presente en el directorio de salida ahora mismo. */
function glbSlugsOnDisk(outDir: string): Set<string> {
  return new Set(
    readdirSync(outDir)
      .filter((f) => f.endsWith('.glb') && !f.endsWith('.raw.glb'))
      .map((f) => basename(f, '.glb')),
  )
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const positional = args.filter((a) => !a.startsWith('--'))

  if (positional.length < 2) {
    console.error('uso: node scripts/convert-weapons.ts <dir_entrada> <dir_salida> [--force]')
    process.exit(2)
  }

  const [inDir, outDir] = positional
  if (!existsSync(inDir)) {
    console.error(`el directorio de entrada no existe: ${inDir}`)
    process.exit(2)
  }

  const fbx2gltfBin = resolveFbx2GltfBin()
  if (!fbx2gltfBin || !existsSync(fbx2gltfBin)) {
    console.error(
      `falta el binario de FBX2glTF: no se pudo resolver el paquete "fbx2gltf" o no tiene ` +
        `binario empaquetado para ${process.platform}`,
    )
    console.error('correr: pnpm add -D fbx2gltf')
    process.exit(2)
  }
  mkdirSync(outDir, { recursive: true })

  const fbxFiles = readdirSync(inDir)
    .filter((f) => f.toLowerCase().endsWith('.fbx'))
    .sort()

  if (fbxFiles.length === 0) {
    console.error(`no se encontraron archivos .fbx en ${inDir}`)
    process.exit(1)
  }

  // Sin registrar la extensión, NodeIO la descarta en silencio al escribir
  // y el KHR_materials_unlit de unlit() nunca llega al archivo final.
  const io = new NodeIO().registerExtensions([KHRMaterialsUnlit])
  const entries: IndexEntry[] = []
  const failures: Failure[] = []
  let skipped = 0

  for (const file of fbxFiles) {
    const fbxPath = join(inDir, file)
    const slug = slugify(basename(file, extname(file)))
    const outPath = join(outDir, `${slug}.glb`)

    if (!force && existsSync(outPath)) {
      const srcTime = statSync(fbxPath).mtimeMs
      const dstTime = statSync(outPath).mtimeMs
      if (dstTime >= srcTime) {
        skipped++
        continue
      }
    }

    try {
      const entry = await convertOne(io, fbxPath, outPath, fbx2gltfBin)
      entries.push(entry)
      const flag = entry.needsManualReview ? '  REVISAR ORIENTACIÓN' : ''
      console.log(`ok    ${entry.slug.padEnd(28)} ${String(entry.triangles).padStart(6)} tris${flag}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ file, error: message.split('\n')[0] })
      console.error(`FALLO ${file}: ${message.split('\n')[0]}`)
    }
  }

  // El índice se fusiona con lo que ya había en outDir: entries sólo trae lo
  // convertido en esta corrida (nada para lo salteado, nada para lo
  // fallido), así que escribirlo tal cual perdería del índice cualquier
  // arma salteada o cualquier corrida previa. glbsOnDisk decide qué
  // entradas viejas siguen siendo válidas: una entrada cuyo .glb ya no está
  // ahí queda huérfana y se descarta (ver política en lib/merge-index.ts).
  const existingIndex = readExistingIndex(outDir)
  const glbsOnDisk = glbSlugsOnDisk(outDir)
  const droppedSlugs = existingIndex
    .map((e) => e.slug)
    .filter((slug) => !glbsOnDisk.has(slug))
  const mergedIndex = mergeIndex(existingIndex, entries, glbsOnDisk)

  if (mergedIndex.length > 0) {
    writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(mergedIndex, null, 2)}\n`)
  }

  console.log('')
  console.log(`convertidas: ${entries.length}`)
  console.log(`saltadas:    ${skipped}`)
  console.log(`fallidas:    ${failures.length}`)
  console.log(`índice:      ${mergedIndex.length} entradas (antes ${existingIndex.length})`)

  if (droppedSlugs.length > 0) {
    console.log('')
    console.log(`descartadas del índice (.glb ya no existe en ${outDir}): ${droppedSlugs.join(', ')}`)
  }

  const review = entries.filter((e) => e.needsManualReview)
  if (review.length > 0) {
    console.log('')
    console.log(`orientación dudosa en ${review.length}, revisar a mano en el panel de tuning:`)
    for (const e of review) {
      console.log(`  ${e.slug}  (cañón ${e.muzzleConfidence}, arriba ${e.upAxisConfidence})`)
    }
  }

  if (failures.length > 0) {
    console.log('')
    for (const f of failures) console.log(`  ${f.file}: ${f.error}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
