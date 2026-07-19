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
 *   3. Detecta el eje del cañón y hacia dónde apunta la boca.
 *   4. Rota para dejar la boca hacia -Z y el arma con +Y arriba.
 *   5. Escala uniformemente al largo objetivo en metros.
 *   6. Centra en el origen.
 *   7. Reduce los materiales a unlit: el spec prohíbe el costo de PBR.
 *   8. Limpia con dedup y prune.
 *
 * Falla por archivo sin cortar el lote, e imprime una tabla al final.
 * Es idempotente: salta lo ya convertido salvo que se pase --force.
 *
 * LIMITACIÓN CONOCIDA: la detección de la boca es una heurística sobre la
 * distribución de masa. Acierta en la mayoría de las siluetas y falla en las
 * atípicas (escopetas, revólveres, cualquier cosa con bípode). Por eso el
 * índice registra `muzzleConfidence` y el panel de tuning necesita sliders de
 * rotación, no sólo de posición.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { dedup, flatten, join as joinMeshes, prune, transformMesh, unlit, weld } from '@gltf-transform/functions'
import { boundsOf, buildNormalizeMatrix, detectMuzzle, displayName, slugify } from './lib/geometry'

/** Bajo esta confianza, la orientación se marca para revisión manual. */
const MUZZLE_CONFIDENCE_THRESHOLD = 0.15

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

  const positions = collectPositions(doc)
  if (positions.length === 0) throw new Error('el modelo no tiene vértices')

  const { axis, sign, confidence } = detectMuzzle(positions)
  const matrix = buildNormalizeMatrix(positions, axis, sign)

  for (const mesh of doc.getRoot().listMeshes()) {
    transformMesh(mesh, matrix)
  }

  // Sin PBR: el presupuesto de frame no lo permite y las skins se aplican
  // en runtime como override de material.
  await doc.transform(unlit(), prune())

  const finalPositions = collectPositions(doc)
  const b = boundsOf(finalPositions)

  await io.write(outPath, doc)

  const name = basename(fbxPath, extname(fbxPath))
  return {
    slug: slugify(name),
    name: displayName(name),
    triangles: countTriangles(doc),
    bounds: {
      min: [b.min[0], b.min[1], b.min[2]],
      max: [b.max[0], b.max[1], b.max[2]],
    },
    muzzleConfidence: Number(confidence.toFixed(3)),
    needsManualReview: confidence < MUZZLE_CONFIDENCE_THRESHOLD,
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

  const io = new NodeIO()
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
    for (const e of review) console.log(`  ${e.slug}  (confianza ${e.muzzleConfidence})`)
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
