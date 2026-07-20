/**
 * Pipeline de ingesta de las armas del Workshop: GLB texturizado -> GLB
 * normalizado con el mismo contrato que produce `convert-weapons.ts` para el
 * pack CC0.
 *
 *   node scripts/convert-source-weapons.ts <dir_entrada> <dir_salida> [--force]
 *
 * Es el hermano de `convert-weapons.ts` y comparte con él TODA la geometría
 * (`lib/geometry.ts`) y el merge de índice (`lib/merge-index.ts`). Lo que
 * cambia son tres cosas, y cada una tiene su motivo:
 *
 * 1. **La entrada ya es glTF.** Estos modelos vienen de un `.mdl` de Source
 *    ya convertido, así que no hay paso de FBX2glTF. Son modelos de mundo
 *    (`w_`), no viewmodels: traen la malla y nada más, sin esqueleto ni
 *    animaciones, que es exactamente lo que el rig procedural de seis capas
 *    (viewmodel/rig.ts) necesita.
 *
 * 2. **La orientación se DECLARA, no se detecta.** `convert-weapons.ts`
 *    adivina el eje del cañón y el eje "arriba" con heurísticas porque el
 *    pack CC0 son 40 FBX de origen heterogéneo. Acá los 39 modelos salieron
 *    todos del mismo conversor y comparten convención, así que adivinar es
 *    peor que mirar: corridas las tres heurísticas independientes sobre los
 *    42 archivos, la de sección transversal daba boca en +Z en 39, la de
 *    masa de empuñadura en 34 y `detectMuzzle` en 34 — pero los que fallaban
 *    eran modelos DISTINTOS en cada una, que es la firma del ruido de una
 *    heurística y no de una convención mezclada. Con detección automática,
 *    ~8 de 39 armas entraban al juego apuntando para atrás. Declarada, cero.
 *    Ver `RAW_*` más abajo.
 *
 * 3. **El color se hornea desde la TEXTURA, no desde el material.** Los
 *    modelos CC0 no tienen textura: cada material aporta un color plano y
 *    `convert-weapons.ts` hornea ese `baseColorFactor` en `COLOR_0`. Éstos
 *    sí traen textura (57 PNG de 512x512 entre los 42 archivos, ~29 MB en
 *    total). Se los muestrea por vértice y se hornea el resultado en el
 *    MISMO `COLOR_0`, y después se tira la textura. No es una degradación
 *    resignada, es lo que hace que estas armas entren al juego sin tocar
 *    nada más:
 *      - El resto del motor ya asume ese contrato. `skins/material.ts` LEE
 *        `COLOR_0` para separar metal de madera y polímero: sin ese atributo
 *        las skins no tendrían de dónde agarrarse y estas 39 armas serían
 *        las únicas sin skin del arsenal.
 *      - `viewmodel/renderer.ts` aísla las mallas del GLB POR NOMBRE. Un
 *        modelo con 3 materiales llega a Three como 3 mallas y se dibujarían
 *        sólo los vértices de la primera (le pasa a 7 de estos archivos:
 *        visor y cuerpo son materiales distintos). Colapsar a un material
 *        deja 1 primitiva por parte.
 *        Ojo: "por parte", no "en total". Desde que la recarga anima el
 *        cargador, un arma que lo trae sale con DOS nodos (`weapon_body` y
 *        `weapon_mag`) y cuesta 2 draw calls en vez de 1 — medido en el
 *        navegador: 8 draws con un arma CC0, 9 con el AK-47, y de vuelta 8
 *        durante el tramo en que el cargador viejo ya salió y el nuevo no
 *        entró. Las 4 sin cargador extraíble (revólver y las tres escopetas
 *        de bombeo) siguen costando 1, igual que el pack CC0.
 *      - Los .glb pasan de ~700 KB a ~50 KB. Con 79 armas en el catálogo eso
 *        importa: el navegador baja una por arma equipada.
 *    El look resultante —facetado, color plano por vértice— es además el
 *    mismo del arsenal CC0, así que las dos familias no se ven de dos juegos
 *    distintos.
 *
 * Y una cosa que este pipeline hace y el otro no: mide la LÍNEA DE PUNTERÍA
 * (lib/sight.ts) y la guarda en el índice. Es el dato que hace posible un
 * ADS de verdad y el motivo por el que estas armas se trajeron.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { type Document, NodeIO } from '@gltf-transform/core'
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
// Extensión explícita en todos los imports locales: Node en ESM nativo la
// exige (mismo motivo que en convert-weapons.ts). Los imports a src/ son
// relativos y no con el alias `@/` porque ese alias sólo existe para el
// bundler y para vitest, no para Node crudo.
import { boundsOf, buildNormalizeMatrix, WEAPON_CLASS_LENGTHS_M } from './lib/geometry.ts'
import { mergeIndex, type IndexEntry } from './lib/merge-index.ts'
import { decodePng, samplePngRgb, type DecodedPng } from './lib/png-reader.ts'
import { detectSightLine, type SightType } from './lib/sight.ts'
import { ARCHETYPES, type WeaponClass } from '../src/game/weapons/archetypes.ts'
import {
  SOURCE_WEAPONS,
  sourceWeaponDisplayName,
  type SourceWeaponEntry,
} from '../src/game/weapons/source-catalog.ts'

/**
 * Convención de ejes de los modelos crudos, declarada (ver punto 2 del
 * encabezado). `RAW_BARREL_AXIS` es el eje largo, `RAW_BARREL_SIGN` el
 * sentido en el que está la boca sobre ese eje, y `RAW_UP_AXIS` el eje
 * vertical del arma.
 *
 * Cómo se verificó, porque "lo declaré" no es una verificación: las tres
 * mediciones independientes del encabezado convergen en esto, y además las
 * 39 armas se miraron en el navegador después de convertirlas — un arma dada
 * vuelta o acostada de lado es de las cosas más obvias que hay en una
 * captura.
 */
const RAW_BARREL_AXIS = 2
const RAW_BARREL_SIGN = 1
const RAW_UP_AXIS = 1

/**
 * Nombres de las dos partes que produce `scripts/blender/mdl-to-glb.py`. Son
 * el contrato entre los tres eslabones de este pipeline: Blender los escribe,
 * este script los preserva (ver `KEEP_PARTS` abajo) y
 * `viewmodel/renderer.ts` busca el cargador por el nombre exacto.
 */
const NODE_BODY = 'weapon_body'
const NODE_MAG = 'weapon_mag'

/**
 * `join()` fusiona todas las mallas compatibles en una. Es lo que queremos
 * PUERTAS ADENTRO de cada parte —el cuerpo llega con varias primitivas
 * (cuerpo, silenciador, visor) y colapsarlas deja un draw call— pero no ENTRE
 * partes: fusionar el cargador con el cuerpo es exactamente lo que destruía
 * la posibilidad de animar la recarga.
 *
 * `keepNamed` es el matiz justo: no une mallas/nodos CON NOMBRE entre sí, pero
 * sí une las primitivas dentro de cada uno. Como Blender ya nombró las dos
 * partes (`weapon_body` / `weapon_mag`) y nada más tiene nombre, el resultado
 * es 1 primitiva por parte: 2 draw calls en un arma con cargador, 1 en un
 * revólver. Sin `keepNamed` el resultado vuelve a ser 1 sola malla y la
 * recarga vuelve a leerse como el arma agachándose.
 */
const KEEP_PARTS = { keepNamed: true } as const

/**
 * Largo objetivo por clase de arquetipo, en metros. Reusa la tabla de
 * `geometry.ts` (que indexa por palabra del nombre de archivo del pack CC0)
 * traduciendo de clase de arquetipo a esa palabra, en vez de escribir números
 * nuevos: si mañana se recalibra la escala del arsenal, se toca un solo lugar
 * y las dos familias de armas se mueven juntas.
 *
 * `lmg` es la única que no tiene equivalente en esa tabla porque el pack CC0
 * no trae ametralladoras. 1,05 m sale de medir el largo real de la clase
 * (una LMG de cinta ronda 1,0-1,1 m), y queda donde corresponde en el
 * arsenal: más larga que una escopeta (0,95) y más corta que un rifle de
 * francotirador (1,15).
 */
const CLASS_TARGET_LENGTH_M: Record<WeaponClass, number> = {
  pistol: WEAPON_CLASS_LENGTHS_M.pistol,
  smg: WEAPON_CLASS_LENGTHS_M.submachinegun,
  ar: WEAPON_CLASS_LENGTHS_M.assaultrifle,
  shotgun: WEAPON_CLASS_LENGTHS_M.shotgun,
  sniper: WEAPON_CLASS_LENGTHS_M.sniperrifle,
  marksman: WEAPON_CLASS_LENGTHS_M.sniperrifle,
  lmg: 1.05,
}

/**
 * Bajo esta confianza de línea de puntería, el arma se marca para revisión
 * manual. La confianza mide qué tan separados quedaron el elemento delantero
 * y el trasero de la mira (ver `SightLine.confidence`): por debajo de 0,10 la
 * detección encontró un solo pico y no una línea, así que la ALTURA que
 * devuelve puede seguir siendo buena pero no hay dos puntos que la
 * confirmen. Igual que `MUZZLE_CONFIDENCE_THRESHOLD` en convert-weapons.ts,
 * esto no descarta el arma: la señala para mirarla en el panel de tuning.
 */
const SIGHT_CONFIDENCE_THRESHOLD = 0.1

/** Entrada de índice con la metadata extra de procedencia y puntería. */
export interface SourceIndexEntry extends IndexEntry {
  /** Nombre mostrado: el genérico del catálogo, nunca el del archivo. */
  name: string
  /** Altura del eje de puntería en el espacio del modelo. Ver lib/sight.ts. */
  sightHeight: number
  /** Desplazamiento lateral de ese eje. ~0 en un arma sana. */
  sightLateral: number
  sightType: SightType
  sightConfidence: number
  /**
   * El `.glb` conserva el cargador como nodo `weapon_mag` aparte del cuerpo.
   * El renderer no lee este campo —descubre el nodo al cargar el GLB, que es
   * la fuente de verdad— pero el índice lo registra igual para poder contestar
   * "¿cuántas armas pueden animar el cargador?" sin abrir 39 archivos
   * binarios, y para que un arma que PIERDA el cargador en una reconversión
   * futura se note en el diff del índice en vez de en pantalla.
   */
  hasMagazine: boolean
}

/**
 * sRGB -> lineal. La textura de color base de glTF está en sRGB por spec;
 * `COLOR_0` está en espacio LINEAL, igual que el `baseColorFactor` que
 * hornea el pipeline CC0. Copiar los bytes del PNG tal cual —el atajo
 * tentador— deja todas las armas notoriamente lavadas, porque un 0,5 en sRGB
 * es un 0,21 en lineal: más del doble de brillo del que corresponde.
 */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Todas las posiciones del documento ya aplanado. Igual que en convert-weapons.ts. */
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

/**
 * Hornea el color de la textura de cada primitiva en `COLOR_0` por vértice y
 * colapsa todo a un único material blanco. Ver el punto 3 del encabezado.
 *
 * Una primitiva sin textura (o sin UV) cae al `baseColorFactor`, que es
 * exactamente lo que hace el pipeline CC0: el camino degradado es el
 * comportamiento del otro pipeline, no un color inventado.
 */
function bakeTextureToVertexColors(doc: Document): void {
  const root = doc.getRoot()
  const buffer = root.listBuffers()[0]
  const baked = doc.createMaterial('baked').setBaseColorFactor([1, 1, 1, 1])
  // Una textura puede estar compartida por varias primitivas: decodificar el
  // PNG es lo caro de todo esto (medio megabyte de inflate + desfiltrado),
  // así que se cachea por imagen y no por primitiva.
  const decoded = new Map<string, DecodedPng>()

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION')
      if (!position) continue
      const count = position.getCount()
      const colors = new Float32Array(count * 3)

      const material = prim.getMaterial()
      const texture = material?.getBaseColorTexture() ?? null
      const uv = prim.getAttribute('TEXCOORD_0')
      const image = texture?.getImage() ?? null

      if (texture && image && uv) {
        const key = texture.getName() || String(texture.listParents().length)
        let png = decoded.get(key)
        if (!png) {
          png = decodePng(Buffer.from(image))
          decoded.set(key, png)
        }
        for (let i = 0; i < count; i++) {
          const u = uv.getElement(i, [0, 0])
          const c = samplePngRgb(png, u[0], u[1])
          colors[i * 3] = srgbToLinear(c.r)
          colors[i * 3 + 1] = srgbToLinear(c.g)
          colors[i * 3 + 2] = srgbToLinear(c.b)
        }
      } else {
        const factor = material ? material.getBaseColorFactor() : [1, 1, 1, 1]
        for (let i = 0; i < count; i++) {
          colors[i * 3] = factor[0]
          colors[i * 3 + 1] = factor[1]
          colors[i * 3 + 2] = factor[2]
        }
      }

      const accessor = doc.createAccessor(undefined, buffer).setType('VEC3').setArray(colors)
      prim.setAttribute('COLOR_0', accessor)
      // TEXCOORD_0 ya no significa nada una vez horneado el color, y dejarlo
      // impide que prune() descarte las texturas: seguirían viajando en el
      // .glb sin que nada las lea.
      prim.setAttribute('TEXCOORD_0', null)
      prim.setMaterial(baked)
    }
  }
}

async function convertOne(
  io: NodeIO,
  inPath: string,
  outPath: string,
  entry: SourceWeaponEntry,
): Promise<SourceIndexEntry> {
  const doc = await io.read(inPath)

  await doc.transform(flatten(), dedup(), joinMeshes(KEEP_PARTS), weld())
  // El transform del nodo se descarta acá, antes de medir nada: todo lo que
  // sigue razona sobre las posiciones de los vértices, así que un transform
  // colgando del nodo sería una escala fantasma que no aparece en las
  // mediciones pero sí en pantalla. Mismo motivo que en convert-weapons.ts.
  for (const node of doc.getRoot().listNodes()) clearNodeTransform(node)

  bakeTextureToVertexColors(doc)
  // Recién ahora join() puede fusionar: antes cada primitiva tenía su propio
  // material y se quedaban separadas. Sigue con `keepNamed`, si no este
  // segundo pase se comería la separación cuerpo/cargador que el primero
  // preservó — que es justo el error fácil de cometer acá.
  await doc.transform(joinMeshes(KEEP_PARTS))

  const positions = collectPositions(doc)
  if (positions.length === 0) throw new Error('el modelo no tiene vértices')

  const targetLengthM = CLASS_TARGET_LENGTH_M[ARCHETYPES[entry.archetype].class]
  const matrix = buildNormalizeMatrix(
    positions,
    RAW_BARREL_AXIS,
    RAW_BARREL_SIGN,
    RAW_UP_AXIS,
    targetLengthM,
  )
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, matrix)

  await doc.transform(unlit(), prune())

  const finalPositions = collectPositions(doc)
  const b = boundsOf(finalPositions)
  // La línea de puntería se mide DESPUÉS de normalizar: sus números viven en
  // el mismo espacio que `bounds`, que es el que consume seed.ts para armar
  // el adsOffset. Medirla antes daría centímetros de otro sistema de
  // coordenadas y otra escala.
  const sight = detectSightLine(finalPositions, entry.sight)

  // Se mide sobre el documento final, después de prune(): lo que importa no es
  // que Blender haya escrito el nodo, sino que haya SOBREVIVIDO todo el
  // pipeline. Un join() sin `keepNamed` en cualquiera de los dos pases lo
  // fusionaría con el cuerpo y este chequeo es el que lo delataría.
  const hasMagazine = doc
    .getRoot()
    .listNodes()
    .some((n) => n.getName() === NODE_MAG && n.getMesh() !== null)

  // El cuerpo es obligatorio: si se perdió, algo se rompió río arriba y el
  // arma saldría invisible o a medias. Mejor fallar acá que en pantalla.
  const hasBody = doc
    .getRoot()
    .listNodes()
    .some((n) => n.getName() === NODE_BODY && n.getMesh() !== null)
  if (!hasBody) throw new Error(`no quedó ningún nodo "${NODE_BODY}" con malla`)

  await io.write(outPath, doc)

  return {
    slug: entry.slug,
    hasMagazine,
    // Nombre real + etiqueta de juego (`AK-47 (CS)`). El registry lo vuelve a
    // resolver del catálogo al cargar el índice, así que esto es sólo para que
    // un index.json recién generado ya se lea bien; la fuente de verdad del
    // nombre es source-catalog.ts.
    name: sourceWeaponDisplayName(entry),
    triangles: countTriangles(doc),
    bounds: {
      min: [b.min[0], b.min[1], b.min[2]],
      max: [b.max[0], b.max[1], b.max[2]],
    },
    // La orientación es declarada, no detectada: confianza 1 no es un
    // optimismo, es que no hubo ninguna heurística que pudiera fallar.
    muzzleConfidence: 1,
    upAxisConfidence: 1,
    needsManualReview: sight.confidence < SIGHT_CONFIDENCE_THRESHOLD,
    sightHeight: Number(sight.height.toFixed(5)),
    sightLateral: Number(sight.lateral.toFixed(5)),
    sightType: entry.sight,
    sightConfidence: Number(sight.confidence.toFixed(3)),
  }
}

function readExistingIndex(outDir: string): SourceIndexEntry[] {
  const indexPath = join(outDir, 'index.json')
  if (!existsSync(indexPath)) return []
  try {
    const raw: unknown = JSON.parse(readFileSync(indexPath, 'utf8'))
    return Array.isArray(raw) ? (raw as SourceIndexEntry[]) : []
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
    console.error('uso: node scripts/convert-source-weapons.ts <dir_entrada> <dir_salida> [--force]')
    process.exit(2)
  }

  const [inDir, outDir] = positional
  if (!existsSync(inDir)) {
    console.error(`el directorio de entrada no existe: ${inDir}`)
    process.exit(2)
  }
  mkdirSync(outDir, { recursive: true })

  const io = new NodeIO().registerExtensions([KHRMaterialsUnlit])
  const entries: SourceIndexEntry[] = []
  const failures: Array<{ slug: string; error: string }> = []
  let skipped = 0
  let missing = 0

  // Se recorre el CATÁLOGO, no el directorio: un .glb que no está en la
  // tabla no tiene nombre genérico ni arquetipo, así que meterlo al juego
  // significaría mostrarle al jugador el nombre del archivo de origen -que
  // es justo la marca que no puede aparecer- o inventarle estadísticas. Un
  // archivo sin fila se ignora y se cuenta; una fila sin archivo se reporta.
  for (const entry of SOURCE_WEAPONS) {
    const inPath = join(inDir, `${entry.slug}.glb`)
    if (!existsSync(inPath)) {
      console.error(`FALTA  ${entry.slug}.glb no está en ${inDir}`)
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
      const flag = result.needsManualReview ? '  REVISAR MIRA' : ''
      console.log(
        `ok    ${result.slug.padEnd(20)} ${String(result.triangles).padStart(6)} tris  ` +
          `mira ${(result.sightHeight * 100).toFixed(1).padStart(5)} cm (${result.sightType}, ` +
          `conf ${result.sightConfidence.toFixed(2)})  ` +
          `${result.hasMagazine ? 'cargador' : '   --   '}${flag}`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ slug: entry.slug, error: message.split('\n')[0] })
      console.error(`FALLO ${entry.slug}: ${message.split('\n')[0]}`)
    }
  }

  const existingIndex = readExistingIndex(outDir)
  const glbsOnDisk = glbSlugsOnDisk(outDir)
  const merged = mergeIndex(existingIndex, entries, glbsOnDisk) as SourceIndexEntry[]
  if (merged.length > 0) {
    writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(merged, null, 2)}\n`)
  }

  console.log('')
  console.log(`convertidas: ${entries.length}`)
  console.log(`saltadas:    ${skipped}`)
  console.log(`sin archivo: ${missing}`)
  console.log(`fallidas:    ${failures.length}`)
  console.log(`índice:      ${merged.length} entradas (antes ${existingIndex.length})`)
  // Cuántas pueden animar el cargador con geometría. El resto cae a la
  // coreografía procedural sola, que también se ve como una recarga.
  console.log(`con cargador: ${merged.filter((e) => e.hasMagazine).length}/${merged.length}`)

  const review = merged.filter((e) => e.needsManualReview)
  if (review.length > 0) {
    console.log('')
    console.log(`línea de puntería dudosa en ${review.length}, revisar en el panel de tuning:`)
    for (const e of review) console.log(`  ${e.slug}  (confianza ${e.sightConfidence})`)
  }

  if (failures.length > 0) process.exit(1)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
