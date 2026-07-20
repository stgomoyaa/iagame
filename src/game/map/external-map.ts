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

import { Mesh, Object3D } from 'three'
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

  def.triangles = hornearTriangulos(objeto)

  return { def, objeto }
}
