/**
 * Aumenta el índice local con la profundidad (Z) de la línea de puntería:
 * `sightRearZ` (alza) y `sightFrontZ` (punto de mira delantero). El pipeline
 * (`convert-source-weapons.ts`) ya las MIDE dentro de `detectSightLine` —son
 * `SightLine.rearZ` / `.frontZ`— pero hasta ahora no las guardaba. `seed.ts`
 * las necesita para el ADS: sin ellas el arma queda a distancia fija del ojo
 * (0,55 m para todo el pack de COD, medido con la caja simétrica normalizada),
 * y como la caja es simétrica ese número no dice DÓNDE está el alza. Con el
 * alza a una distancia fija del ojo el sight picture queda como en Call of Duty.
 *
 * Por qué un patch en vez de re-correr la conversión entera: los `.glb` ya
 * convertidos SON el documento normalizado sobre el que el pipeline midió
 * (`collectPositions` lee las posiciones crudas, sin transform de nodo, y los
 * nodos de COD son identidad). Correr `detectSightLine` sobre ellos da EXACTO
 * el mismo número que daría re-convertir, sin tocar los binarios ni depender de
 * que `workshop-assets/` esté completo. El chequeo de abajo lo confirma arma
 * por arma: si `sightHeight` recalculado no coincide con el guardado, aborta.
 *
 * La fuente de verdad (`convert-source-weapons.ts`) también emite ya estos dos
 * campos, así que una reconversión futura los mantiene; este script sólo pone
 * al día el índice vigente sin reconvertir.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NodeIO, type Document } from '@gltf-transform/core'
import { KHRMaterialsUnlit } from '@gltf-transform/extensions'
import { detectSightLine, type SightType } from './lib/sight.ts'

const LOCAL_DIR = join(process.cwd(), 'public/assets/weapons-local')
const INDEX_PATH = join(LOCAL_DIR, 'index.json')

interface Entry {
  slug: string
  name: string
  sightHeight?: number
  sightType?: SightType
  sightRearZ?: number
  sightFrontZ?: number
  [k: string]: unknown
}

function collectPositions(doc: Document): Float32Array {
  const chunks: Float32Array[] = []
  let total = 0
  for (const mesh of doc.getRoot().listMeshes()) {
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
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

async function main(): Promise<void> {
  const io = new NodeIO().registerExtensions([KHRMaterialsUnlit])
  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as Entry[]

  let patched = 0
  let skipped = 0
  const mismatches: string[] = []

  for (const entry of index) {
    // Sólo el pack de COD: son las armas de mundo (`c_`) que usan el heurístico
    // de `seed.ts`. Las de CS son viewmodels (pose neutra + tuning a mano) y no
    // pasan por esta rama, así que medir su GLB con brazos daría ruido inútil.
    if (!/\(COD\)/.test(entry.name)) { skipped++; continue }
    if (entry.sightType === undefined) { skipped++; continue }

    const glbPath = join(LOCAL_DIR, `${entry.slug}.glb`)
    let doc: Document
    try {
      doc = await io.read(glbPath)
    } catch {
      mismatches.push(`${entry.slug}: no se pudo leer ${glbPath}`)
      continue
    }
    const positions = collectPositions(doc)
    const sight = detectSightLine(positions, entry.sightType)

    // Guard: el `height` recalculado tiene que coincidir con el guardado, o el
    // patch está midiendo otra cosa (otra escala, otro espacio) y no vale.
    if (entry.sightHeight !== undefined) {
      const diff = Math.abs(sight.height - entry.sightHeight)
      if (diff > 1e-3) {
        mismatches.push(`${entry.slug}: sightHeight recalc ${sight.height.toFixed(5)} != guardado ${entry.sightHeight} (diff ${diff.toFixed(5)})`)
        continue
      }
    }

    entry.sightRearZ = Number(sight.rearZ.toFixed(5))
    entry.sightFrontZ = Number(sight.frontZ.toFixed(5))
    patched++
  }

  if (mismatches.length > 0) {
    console.error('DISCREPANCIAS (no se escribió nada):')
    for (const m of mismatches) console.error('  ' + m)
    process.exit(1)
  }

  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 1) + '\n')
  console.log(`índice actualizado: ${patched} armas COD con sightRearZ/sightFrontZ, ${skipped} salteadas (no COD)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
