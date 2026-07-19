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
 * LIMITACIÓN CONOCIDA: tanto la detección de la boca como la del eje
 * "arriba" son heurísticas sobre la geometría (distribución de masa y
 * extensión de la caja envolvente). Aciertan en la mayoría de las siluetas
 * y fallan en las atípicas (escopetas, revólveres, cualquier cosa con
 * bípode, o un arma de sección casi cuadrada). Por eso el índice registra
 * `muzzleConfidence` y `upAxisConfidence`, y el panel de tuning necesita
 * sliders de rotación, no sólo de posición.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { KHRMaterialsUnlit } from '@gltf-transform/extensions'
import { dedup, flatten, join as joinMeshes, prune, transformMesh, unlit, weld } from '@gltf-transform/functions'
// Extensión explícita: Node resuelve ESM nativo y la exige. Vitest resuelve
// sin ella, así que omitirla deja los tests en verde y el script roto.
import {
  boundsOf,
  buildNormalizeMatrix,
  detectMuzzle,
  detectUpAxis,
  displayName,
  slugify,
  targetLengthFor,
} from './lib/geometry.ts'

/** Bajo esta confianza, la orientación del cañón se marca para revisión manual. */
const MUZZLE_CONFIDENCE_THRESHOLD = 0.15

/** Bajo esta confianza, el eje "arriba" elegido se marca para revisión manual. */
const UP_AXIS_CONFIDENCE_THRESHOLD = 0.15

const FBX2GLTF_BIN = resolve(
  'node_modules/.pnpm/fbx2gltf@0.9.7-p1/node_modules/fbx2gltf/bin/Darwin/FBX2glTF',
)

interface IndexEntry {
  slug: string
  name: string
  triangles: number
  /** Caja envolvente tras normalizar, en metros. */
  bounds: { min: [number, number, number]; max: [number, number, number] }
  /**
   * Qué tan clara fue la detección de la boca. Cerca de 0 significa que el
   * arma es casi simétrica y la orientación probablemente esté mal.
   */
  muzzleConfidence: number
  /**
   * Qué tan clara fue la detección del eje "arriba". Cerca de 0 significa
   * que la sección transversal es casi cuadrada y no queda claro cuál lado
   * es el ancho y cuál el alto.
   */
  upAxisConfidence: number
  needsManualReview: boolean
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
): Promise<IndexEntry> {
  const tmpGlb = outPath.replace(/\.glb$/, '.raw.glb')

  execFileSync(FBX2GLTF_BIN, ['--binary', '--input', fbxPath, '--output', tmpGlb], {
    stdio: 'pipe',
  })

  const doc = await io.read(tmpGlb)

  // Aplanar y fusionar: el viewmodel quiere una malla, no una jerarquía.
  await doc.transform(flatten(), dedup(), joinMeshes(), weld())

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

  await io.write(outPath, doc)
  unlinkSync(tmpGlb)

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
      confidence < MUZZLE_CONFIDENCE_THRESHOLD || upAxisConfidence < UP_AXIS_CONFIDENCE_THRESHOLD,
  }
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
  if (!existsSync(FBX2GLTF_BIN)) {
    console.error(`falta el binario de FBX2glTF en ${FBX2GLTF_BIN}`)
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
      const entry = await convertOne(io, fbxPath, outPath)
      entries.push(entry)
      const flag = entry.needsManualReview ? '  REVISAR ORIENTACIÓN' : ''
      console.log(`ok    ${entry.slug.padEnd(28)} ${String(entry.triangles).padStart(6)} tris${flag}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ file, error: message.split('\n')[0] })
      console.error(`FALLO ${file}: ${message.split('\n')[0]}`)
    }
  }

  if (entries.length > 0) {
    entries.sort((a, b) => a.slug.localeCompare(b.slug))
    writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(entries, null, 2)}\n`)
  }

  console.log('')
  console.log(`convertidas: ${entries.length}`)
  console.log(`saltadas:    ${skipped}`)
  console.log(`fallidas:    ${failures.length}`)

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
