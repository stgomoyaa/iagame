/**
 * Carga de un mapa importado de Source: el `<mapa>.json` con la colisión y
 * el `<mapa>.glb` con la malla texturizada, los dos producidos offline por
 * `scripts/bsp-convert.ts` + `scripts/map-textures.ts`.
 *
 * Éste es el único archivo de la carga de mapas que habla con three (ver
 * architecture.test.ts): hace falta GLTFLoader para el GLB y hay que
 * recorrer BufferGeometry reales para hornear los triángulos del BVH de
 * hitscan. Toda la matemática -- brushes, escala, validación de spawns --
 * vive en map/source-map.ts, que es puro y se testea sin navegador. Mismo
 * criterio que map/mesh.ts.
 *
 * Es asíncrono, y por eso se lo llama ANTES de createGame() (desde
 * ui/GameCanvas.tsx) en vez de adentro: el motor se arma una sola vez con
 * el mapa ya en mano, sin un estado intermedio de "partida corriendo sobre
 * un mapa vacío" que después habría que reemplazar en caliente.
 */

import { LinearFilter, Mesh, MeshBasicMaterial, Object3D, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { MapaExterno } from '@/game/map/registry'
import { esMapaFuenteJson, mapDefDesdeJson } from '@/game/map/source-map'
import type { MapDef } from '@/game/map/types'

export interface MapaExternoCargado {
  def: MapDef
  /** Raíz de la malla visual, lista para agregar a la escena del renderer. */
  objeto: Object3D
}

/**
 * Triángulos del objeto en espacio de MUNDO, no indexados: 9 floats por
 * triángulo. Es lo que quiere three-mesh-bvh y lo que necesita el hitscan.
 *
 * Se aplica `matrixWorld` explícitamente en vez de asumir la identidad: el
 * GLB trae la malla colgada de un nodo, y si mañana ese nodo llevara una
 * transformación, los disparos pegarían en un lugar y la pared se vería en
 * otro -- el clásico "existe, está testeado y no sirve".
 */
export function hornearTriangulos(raiz: Object3D): Float32Array {
  raiz.updateMatrixWorld(true)

  const partes: Float32Array[] = []
  let total = 0

  raiz.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    const geo = obj.geometry
    const pos = geo.getAttribute('position')
    if (pos === undefined) return
    const index = geo.getIndex()
    const cuenta = index !== null ? index.count : pos.count
    const salida = new Float32Array(cuenta * 3)

    const m = obj.matrixWorld.elements
    for (let i = 0; i < cuenta; i++) {
      const v = index !== null ? index.getX(i) : i
      const x = pos.getX(v)
      const y = pos.getY(v)
      const z = pos.getZ(v)
      // Multiplicación por matriz 4x4 a mano: evita crear un Vector3 por
      // vértice (son ~50k en nuketown) sólo para leerlo de vuelta.
      salida[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]
      salida[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
      salida[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
    }

    partes.push(salida)
    total += salida.length
  })

  if (partes.length === 1) return partes[0]
  const out = new Float32Array(total)
  let offset = 0
  for (const p of partes) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/**
 * Compensación del factor que three mete en el camino del lightmap.
 *
 * `MeshBasicMaterial` calcula, literalmente (ver meshbasic.glsl.js):
 *
 *     indirectDiffuse = lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI
 *     outgoingLight   = indirectDiffuse * diffuseColor.rgb
 *
 * `RECIPROCAL_PI` es 1/π ≈ 0.318, y está ahí porque para un material PBR el
 * lightmap se interpreta como irradiancia y hay que dividir por π al pasarla
 * a radiancia. Nuestro atlas NO es irradiancia: son las muestras ya
 * horneadas de Source, que queremos multiplicar tal cual contra el albedo.
 * Sin compensar, el mapa entero sale 3.14 veces más oscuro -- que es
 * justamente el "multiplicador global de oscurecimiento" que no sirve.
 * Poniendo la intensidad en π el producto queda exactamente `albedo *
 * lightmap`.
 */
const INTENSIDAD_LIGHTMAP = Math.PI

/**
 * Engancha el atlas de lightmap a todos los materiales de la malla.
 *
 * Tres detalles que si se saltean dan un resultado que PARECE funcionar:
 *
 * 1. `channel = 1`: sin esto three muestrea el lightmap con las UV del
 *    albedo (el default de `Texture.channel` es 0), que en un mapa de Source
 *    repiten decenas de veces por pared. El resultado es el atlas entero
 *    tileado sobre cada muro en vez de la luz en su lugar.
 * 2. `flipY = false`: `TextureLoader` da vuelta la imagen por defecto,
 *    mientras que las UV del glTF (y las que calcula bsp-convert.ts) miden V
 *    desde ARRIBA. Con el flip puesto, cada cara muestrea la fila espejada
 *    del atlas: sale iluminado, coherente, y de otro lado del mapa.
 * 3. Sin mipmaps: el atlas junta caras que no son vecinas en el mundo, y el
 *    borde de 1 texel que deja bsp-convert.ts sólo protege el nivel 0. Un
 *    mip nivel 2 ya mezcla la luz de una cara con la de otra cualquiera.
 *    Los luxels de Source son grandes en pantalla (uno cada ~30 cm), así que
 *    apagar los mips no introduce aliasing visible.
 */
export function aplicarLightmap(raiz: Object3D, textura: Texture): number {
  textura.channel = 1
  textura.flipY = false
  textura.colorSpace = SRGBColorSpace
  textura.generateMipmaps = false
  textura.minFilter = LinearFilter
  textura.magFilter = LinearFilter
  textura.needsUpdate = true

  let materiales = 0
  const yaHechos = new Set<MeshBasicMaterial>()

  raiz.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    const lista = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const mat of lista) {
      if (!(mat instanceof MeshBasicMaterial)) continue
      if (yaHechos.has(mat)) continue
      yaHechos.add(mat)
      mat.lightMap = textura
      mat.lightMapIntensity = INTENSIDAD_LIGHTMAP
      mat.needsUpdate = true
      materiales++
    }
  })

  return materiales
}

/**
 * Baja los dos archivos del mapa y arma su `MapDef`. Tira con un mensaje
 * legible si algo no está o no tiene la forma esperada: el llamador
 * (ui/GameCanvas.tsx) cae al mapa por defecto en vez de dejar una pantalla
 * negra, y el mensaje dice cuál de los dos pasos manuales de
 * `docs/WORKSHOP.md` falta correr.
 */
export async function cargarMapaExterno(mapa: MapaExterno): Promise<MapaExternoCargado> {
  const respuesta = await fetch(mapa.json)
  if (!respuesta.ok) {
    throw new Error(`no se pudo bajar ${mapa.json} (HTTP ${respuesta.status})`)
  }
  const crudo: unknown = await respuesta.json()
  if (!esMapaFuenteJson(crudo)) {
    throw new Error(`${mapa.json} no tiene la forma que produce scripts/bsp-convert.ts`)
  }

  const def = mapDefDesdeJson(crudo, mapa.name)

  const gltf = await new GLTFLoader().loadAsync(mapa.glb)
  const objeto = gltf.scene
  // El mapa no se mueve nunca: sacarlo del recálculo de matrices por frame.
  objeto.matrixAutoUpdate = false
  objeto.updateMatrix()

  // El lightmap es OPCIONAL y su fallo no rompe la carga: si el .png no
  // está (mapa convertido con una versión vieja del script), el mapa se
  // dibuja a albedo pleno, que es como se veía antes. Perder la
  // iluminación es un downgrade visual; perder el mapa es perder la
  // partida.
  if (mapa.lightmap !== undefined) {
    try {
      const textura = await new TextureLoader().loadAsync(mapa.lightmap)
      aplicarLightmap(objeto, textura)
    } catch {
      console.warn(`[${mapa.name}] no se pudo cargar el lightmap ${mapa.lightmap}; se dibuja sin iluminar`)
    }
  }

  def.triangles = hornearTriangulos(objeto)

  return { def, objeto }
}
