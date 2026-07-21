/**
 * Aumenta el índice CC0 committeado (`public/assets/weapons/index.json`) con la
 * boca de cañón medida (`muzzleX/Y/Z`), de la misma forma que `patch-sight-z.ts`
 * lo hace para el pack de COD en el índice local.
 *
 * Por qué: `feedback/vfx-renderer.ts` nace el fogonazo, cuando el índice no trae
 * boca medida, en el CENTRO de la caja envolvente. En un modelo de mundo el
 * ánima NO vive en el centro vertical —cargador y empuñadura cuelgan hacia abajo
 * y bajan el centro—, así que el fogonazo salía ~5-11 cm por DEBAJO de la boca
 * real. Las 40 CC0 son modelos de mundo normalizados con el cañón sobre -Z
 * (igual que los `c_` de COD), así que `muzzleFromGeometry` —el centroide de la
 * rebanada más adelantada— cae sobre el eje del ánima y arregla la altura.
 *
 * Sólo CC0. Las de CS son viewmodels con brazos modelados: una mano adelantada
 * cae en la rebanada del frente y corre el centroide, así que ahí `vfx-renderer`
 * se queda con el heurístico de caja a propósito (misma decisión que
 * `patch-sight-z.ts` documenta al saltear las de CS).
 *
 * Por qué un patch y no re-correr la conversión: los `.glb` ya convertidos SON
 * el documento normalizado sobre el que se mide; `convert-weapons.ts` también
 * emite ya `muzzleX/Y/Z`, así que una reconversión futura los mantiene y este
 * script sólo pone al día el índice vigente. El guard de abajo aborta si el
 * `.glb` no coincide con la caja guardada (otra escala/otro modelo).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NodeIO, type Document } from '@gltf-transform/core'
import { KHRMaterialsUnlit } from '@gltf-transform/extensions'
import { muzzleFromGeometry } from './lib/geometry.ts'

const DIR = join(process.cwd(), 'public/assets/weapons')
const INDEX_PATH = join(DIR, 'index.json')

interface Entry {
  slug: string
  bounds: { min: [number, number, number]; max: [number, number, number] }
  muzzleX?: number
  muzzleY?: number
  muzzleZ?: number
  [k: string]: unknown
}

function collectPositions(doc: Document): Float32Array {
  const chunks: Float32Array[] = []
  let total = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const arr = prim.getAttribute('POSITION')?.getArray()
      if (!arr) continue
      const f32 = arr instanceof Float32Array ? arr : Float32Array.from(arr)
      chunks.push(f32)
      total += f32.length
    }
  }
  const out = new Float32Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

async function main(): Promise<void> {
  const io = new NodeIO().registerExtensions([KHRMaterialsUnlit])
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as Entry[]

  let patched = 0
  const mismatches: string[] = []

  for (const entry of index) {
    const glbPath = join(DIR, `${entry.slug}.glb`)
    let doc: Document
    try {
      doc = await io.read(glbPath)
    } catch {
      mismatches.push(`${entry.slug}: no se pudo leer ${glbPath}`)
      continue
    }
    const positions = collectPositions(doc)
    if (positions.length === 0) {
      mismatches.push(`${entry.slug}: el GLB no tiene vértices`)
      continue
    }

    // Guard: la boca medida (z = frente) tiene que coincidir con el min.z de la
    // caja guardada. Si no, el `.glb` no es el mismo modelo normalizado que
    // produjo el índice y el patch estaría midiendo otra cosa.
    const muzzle = muzzleFromGeometry(positions)
    const diffZ = Math.abs(muzzle.z - entry.bounds.min[2])
    if (diffZ > 1e-3) {
      mismatches.push(`${entry.slug}: muzzleZ ${muzzle.z.toFixed(5)} != bounds.min.z ${entry.bounds.min[2]} (diff ${diffZ.toFixed(5)})`)
      continue
    }

    entry.muzzleX = Number(muzzle.x.toFixed(5))
    entry.muzzleY = Number(muzzle.y.toFixed(5))
    entry.muzzleZ = Number(muzzle.z.toFixed(5))
    patched++
  }

  if (mismatches.length > 0) {
    console.error('DISCREPANCIAS (no se escribió nada):')
    for (const m of mismatches) console.error('  ' + m)
    process.exit(1)
  }

  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n')
  console.log(`índice CC0 actualizado: ${patched} armas con muzzleX/Y/Z`)
}

main().catch((e) => { console.error(e); process.exit(1) })
