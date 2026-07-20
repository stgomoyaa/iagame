/**
 * Engancha las texturas extraídas de un .bsp al GLB del mismo mapa.
 *
 *   node scripts/map-textures.ts <mapa.glb> <dir_texturas> [salida.glb]
 *
 * Es el eslabón que faltaba entre los dos scripts que ya existían:
 * `bsp-convert.ts` deja un GLB con una primitiva por material y el NOMBRE
 * del material preservado pero sin imagen, y `extract-textures.ts` deja los
 * PNG + un `index.json` que mapea nombre de material -> archivo. Acá se
 * cruzan por ese nombre.
 *
 * Por qué offline y no en el navegador: mismo criterio que el resto del
 * pipeline (ver la cabecera de bsp-convert.ts). Un solo GLB autocontenido se
 * baja de una y no obliga al juego a resolver 30 fetch de PNG más un índice
 * antes de poder dibujar el primer frame.
 *
 * Dos decisiones que no son obvias:
 *
 * 1. Los materiales quedan marcados UNLIT (KHR_materials_unlit). La escena
 *    del juego no tiene ninguna luz -- el mapa se dibuja con
 *    MeshBasicMaterial (ver engine/renderer.ts) -- así que un material PBR
 *    normal saldría NEGRO. GLTFLoader mapea KHR_materials_unlit a
 *    MeshBasicMaterial, que es exactamente lo que el motor ya usa.
 *
 * 2. Las primitivas con material `TOOLS/*` se descartan. bsp-convert.ts ya
 *    filtra las caras de herramienta por bit SURF_ y por nombre, pero
 *    `toolsskybox` y `toolsblack` se le escapan (no llevan SURF_NODRAW y no
 *    contienen ninguno de los substrings que busca). La cáscara de
 *    toolsskybox es una caja que envuelve el mapa entero: dejarla puesta
 *    equivale a jugar dentro de un cajón cerrado, sin ver el cielo ni
 *    entender la silueta del mapa desde adentro.
 *
 * Los materiales sin entrada en el índice (en nuketown son 13: apuntan a
 * assets de CS:GO que el mapa no empaqueta) se quedan con su color plano.
 * Que se vean grises es aceptable; que revienten la carga, no.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Document, NodeIO, type Material, type Texture } from '@gltf-transform/core'
import { KHRMaterialsUnlit } from '@gltf-transform/extensions'

/** Prefijo de los materiales de herramienta de Hammer, ver cabecera. */
const PREFIJO_HERRAMIENTA = 'TOOLS/'

/**
 * Busca un material en el índice tolerando las dos formas en que los dos
 * scripts pueden no coincidir exactamente:
 *
 * - Mayúsculas: `extract-textures.ts` normaliza las claves a mayúsculas y el
 *   nombre del GLB viene tal cual lo escribió el compilador del mapa.
 * - Barra inicial: nuketown trae el material del pasto como
 *   "/NUKETOWN_GRASS01" (así está en la tabla de strings del .bsp) mientras
 *   el índice lo lista como "NUKETOWN_GRASS01". Es UN material, pero es el
 *   suelo entero del mapa: sin este caso, la superficie más grande de
 *   nuketown se ve como un plano gris.
 */
function buscarEnIndice(indice: Record<string, string>, nombre: string): string | undefined {
  const arriba = nombre.toUpperCase()
  return indice[nombre] ?? indice[arriba] ?? indice[arriba.replace(/^\/+/, '')]
}

export interface ReporteTexturas {
  materiales: number
  conTextura: number
  sinTextura: string[]
  primitivasDescartadas: number
  /** Archivos PNG distintos embebidos (varios materiales pueden compartir uno). */
  imagenes: number
}

/**
 * Aplica el índice de texturas sobre `doc`, en memoria. `leerPng` se
 * inyecta en vez de leer del filesystem acá adentro para que el test pueda
 * ejercitar el cruce nombre -> imagen sin escribir archivos.
 */
export function aplicarTexturas(
  doc: Document,
  indice: Record<string, string>,
  leerPng: (archivo: string) => Uint8Array,
): ReporteTexturas {
  const unlit = doc.createExtension(KHRMaterialsUnlit).setRequired(false)
  const unlitProp = unlit.createUnlit()

  const root = doc.getRoot()
  const reporte: ReporteTexturas = {
    materiales: 0,
    conTextura: 0,
    sinTextura: [],
    primitivasDescartadas: 0,
    imagenes: 0,
  }

  // Una Texture por ARCHIVO, no por material: en nuketown varios materiales
  // comparten el mismo .vtf subyacente y duplicar el PNG dentro del GLB
  // sería megabytes de más por nada.
  const texturasPorArchivo = new Map<string, Texture>()

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material: Material | null = prim.getMaterial()
      const nombre = material?.getName() ?? ''
      if (nombre.toUpperCase().startsWith(PREFIJO_HERRAMIENTA)) {
        mesh.removePrimitive(prim)
        prim.dispose()
        // Sólo se descarta el material si esa era su última primitiva: en
        // este GLB la relación es 1 a 1, pero destruir un material que otra
        // primitiva sigue usando dejaría el archivo corrupto en silencio.
        if (material !== null && material.listParents().every((p) => p === doc.getRoot())) {
          material.dispose()
        }
        reporte.primitivasDescartadas++
      }
    }
  }

  for (const material of root.listMaterials()) {
    reporte.materiales++
    // Todo material del mapa va unlit, tenga textura o no: sin luces en la
    // escena, uno PBR se ve negro y el mapa entero queda ilegible.
    material.setExtension('KHR_materials_unlit', unlitProp)

    const nombre = material.getName()
    const archivo = buscarEnIndice(indice, nombre)
    if (archivo === undefined) {
      reporte.sinTextura.push(nombre)
      continue
    }

    let textura = texturasPorArchivo.get(archivo)
    if (textura === undefined) {
      textura = doc
        .createTexture(archivo)
        .setImage(leerPng(archivo))
        .setMimeType('image/png')
      texturasPorArchivo.set(archivo, textura)
      reporte.imagenes++
    }

    material.setBaseColorTexture(textura)
    // El color plano gris que dejó bsp-convert.ts multiplica la textura: sin
    // esto todo el mapa saldría un 40% más oscuro de lo que corresponde.
    material.setBaseColorFactor([1, 1, 1, 1])

    // Las UV de Source son la proyección cruda de textureVecs: se van muy
    // afuera de [0,1] (una pared de 8 m con una textura de 128 px repite
    // decenas de veces). REPEAT es el default de glTF, pero se declara
    // explícito porque de él depende que el mapa no se vea como una única
    // franja de píxeles estirada.
    const info = material.getBaseColorTextureInfo()
    if (info !== null) {
      info.setWrapS(10497) // REPEAT
      info.setWrapT(10497) // REPEAT
    }

    reporte.conTextura++
  }

  return reporte
}

async function main(): Promise<void> {
  const [rutaGlb, dirTexturas, rutaSalidaArg] = process.argv.slice(2)
  if (!rutaGlb || !dirTexturas) {
    console.error('uso: node scripts/map-textures.ts <mapa.glb> <dir_texturas> [salida.glb]')
    process.exit(2)
  }
  if (!existsSync(rutaGlb)) {
    console.error(`no existe: ${rutaGlb}`)
    process.exit(2)
  }
  const rutaIndice = join(dirTexturas, 'index.json')
  if (!existsSync(rutaIndice)) {
    console.error(`no existe: ${rutaIndice} (¿corriste scripts/extract-textures.ts?)`)
    process.exit(2)
  }

  const rutaSalida = rutaSalidaArg ?? rutaGlb.replace(/\.glb$/, '-tex.glb')
  const indice = JSON.parse(readFileSync(rutaIndice, 'utf8')) as Record<string, string>

  const io = new NodeIO().registerExtensions([KHRMaterialsUnlit])
  const doc = await io.read(rutaGlb)

  const reporte = aplicarTexturas(doc, indice, (archivo) =>
    new Uint8Array(readFileSync(join(dirTexturas, archivo))),
  )

  const glb = await io.writeBinary(doc)
  writeFileSync(rutaSalida, glb)

  console.log(`materiales:              ${reporte.materiales}`)
  console.log(`con textura:             ${reporte.conTextura}`)
  console.log(`imágenes embebidas:      ${reporte.imagenes}`)
  console.log(`primitivas descartadas:  ${reporte.primitivasDescartadas} (materiales TOOLS/*)`)
  console.log(`sin textura:             ${reporte.sinTextura.length}`)
  for (const n of reporte.sinTextura) console.log(`  - ${n}`)
  console.log('')
  console.log(`escrito: ${rutaSalida} (${(glb.byteLength / 1e6).toFixed(2)} MB)`)
}

if (process.argv[1]?.endsWith('map-textures.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
