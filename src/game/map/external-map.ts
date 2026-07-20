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

import {
  Color,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Material,
  type Texture,
} from 'three'
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

/** Una instancia de prop tal como la escribe scripts/bsp-props.ts. */
export interface InstanciaPropJson {
  modelo: number
  pos: [number, number, number]
  quat: [number, number, number, number]
  /** Tinte de luz horneada, LINEAL. Ausente = sin tintar (albedo pleno). */
  luz?: [number, number, number]
}

export interface PropsMapaJson {
  modelos: string[]
  instancias: InstanciaPropJson[]
}

export function esPropsMapaJson(v: unknown): v is PropsMapaJson {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.modelos) || !o.modelos.every((m: unknown) => typeof m === 'string')) return false
  if (!Array.isArray(o.instancias)) return false
  return o.instancias.every((i: unknown) => {
    if (typeof i !== 'object' || i === null) return false
    const x = i as Record<string, unknown>
    const num = (a: unknown, n: number): boolean =>
      Array.isArray(a) && a.length === n && a.every((k) => typeof k === 'number' && Number.isFinite(k))
    // El índice de modelo se valida contra el largo real de `modelos`: uno
    // fuera de rango dejaría props apilados en el modelo equivocado, que se
    // ve como un mapa "casi bien" y es imposible de atribuir después.
    return (
      typeof x.modelo === 'number' &&
      Number.isInteger(x.modelo) &&
      x.modelo >= 0 &&
      x.modelo < (o.modelos as string[]).length &&
      num(x.pos, 3) &&
      num(x.quat, 4) &&
      // `luz` es opcional, pero si viene tiene que ser un RGB válido: un
      // array de otro largo o con un NaN adentro pintaría el prop de negro
      // sin que nada falle, que es el tipo de error que sólo se descubre
      // mirando el mapa.
      (x.luz === undefined || num(x.luz, 3))
    )
  })
}

/**
 * Material de prop -> `MeshBasicMaterial`.
 *
 * Los GLB que produce el pipeline de modelos traen materiales PBR
 * (`MeshStandardMaterial`), y la escena del juego NO TIENE NINGUNA LUZ: el
 * mapa se dibuja unlit a propósito (ver la cabecera de
 * scripts/map-textures.ts). Un material PBR sin luces sale NEGRO, así que
 * sin esta conversión los 50 props aparecen como siluetas negras -- que es
 * exactamente lo que se vio la primera vez que se los cargó.
 *
 * Se conserva la textura y el recorte alfa: las cercas y el alambre de
 * púas son planos con alpha test, y perderlo los convierte en paredes
 * opacas rectangulares.
 */
function aBasico(mat: Material): Material {
  if (mat instanceof MeshBasicMaterial) return mat
  const origen = mat as Material & {
    map?: Texture | null
    color?: { getHex(): number }
    alphaTest?: number
    transparent?: boolean
    side?: number
  }
  const basico = new MeshBasicMaterial({
    map: origen.map ?? null,
    alphaTest: origen.alphaTest ?? 0,
    transparent: origen.transparent ?? false,
    side: origen.side,
  })
  if (origen.color !== undefined) basico.color.setHex(origen.color.getHex())
  basico.name = mat.name
  return basico
}

/**
 * Arma los props del mapa como `InstancedMesh`, uno por cada malla de cada
 * modelo.
 *
 * POR QUÉ INSTANCIADO: sin esto, cada prop es su propio draw call. En
 * nuketown son 50 props sobre 35 modelos, así que instanciar no es la
 * diferencia entre 50 y 1 -- la mayoría de los modelos aparece una sola vez
 * y el ahorro real es chico. Se hace igual porque el costo es el mismo
 * código y porque los que SÍ repiten son los que más pesan (8 domelights, 6
 * persianas): sin instanciar, esos 14 props solos serían 14 draws en vez de 2.
 *
 * Los props van colgados del MISMO Object3D que la malla del mapa, no
 * agregados a la escena por su cuenta: así el renderer no necesita saber que
 * existen (y este archivo no tiene que tocar engine/renderer.ts).
 *
 * LA LUZ HORNEADA DE CADA INSTANCIA (`tintar`)
 * --------------------------------------------
 * Cada instancia trae su propio color de `bsp-props.ts` y se aplica con
 * `setColorAt`, o sea como el atributo instanciado `instanceColor`: NO
 * rompe el instanciado ni agrega un draw call, sólo 3 floats por instancia
 * (600 bytes para las 50 de nuketown). Sin esto los props se dibujan a
 * albedo pleno y una cerca queda más brillante que la pared lightmapeada
 * que tiene al lado.
 *
 * Un detalle de three que hay que saber para creerle a esto: alcanza con
 * setear `instanceColor`, sin tocar `material.vertexColors` ni agregarle un
 * atributo `color` a la geometría. El prefijo del fragment shader define
 * `USE_COLOR` cuando hay `instancingColor` (WebGLProgram.js: `vertexColors
 * || instancingColor`), mientras que el del vertex shader lo define sólo
 * por `vertexColors` y trata el instanciado aparte. Prender
 * `vertexColors` "por las dudas" sería peor: define el atributo `color` en
 * el vertex shader, la geometría de los props no lo tiene, y
 * `MeshBasicMaterial` no declara `defaultAttributeValues` (sólo lo hace
 * ShaderMaterial) -- así que el atributo quedaría en el (0,0,0) por
 * defecto de WebGL y los props saldrían NEGROS.
 */
export function construirProps(
  gltfPorModelo: ReadonlyArray<Object3D>,
  props: PropsMapaJson,
  tintar: boolean,
): Object3D {
  const raiz = new Object3D()
  raiz.matrixAutoUpdate = false

  // Instancias agrupadas por modelo, para saber de antemano cuántas hay de
  // cada uno: InstancedMesh necesita el count al construirse.
  const porModelo = new Map<number, InstanciaPropJson[]>()
  for (const inst of props.instancias) {
    const lista = porModelo.get(inst.modelo)
    if (lista === undefined) porModelo.set(inst.modelo, [inst])
    else lista.push(inst)
  }

  const m = new Matrix4()
  const p = new Vector3()
  const q = new Quaternion()
  const uno = new Vector3(1, 1, 1)
  const local = new Matrix4()
  const c = new Color()

  for (const [idxModelo, instancias] of porModelo) {
    const modelo = gltfPorModelo[idxModelo]
    if (modelo === undefined) continue
    modelo.updateMatrixWorld(true)

    modelo.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      const original = obj.material as Material | Material[]
      const material = Array.isArray(original) ? original.map(aBasico) : aBasico(original)
      const inst = new InstancedMesh(obj.geometry, material, instancias.length)
      // La malla puede colgar de un nodo con transformación propia dentro
      // del GLB; hay que componerla con la del prop o el modelo aparece
      // desplazado respecto de su origen.
      local.copy(obj.matrixWorld)

      for (let i = 0; i < instancias.length; i++) {
        const it = instancias[i]
        p.set(it.pos[0], it.pos[1], it.pos[2])
        q.set(it.quat[0], it.quat[1], it.quat[2], it.quat[3])
        m.compose(p, q, uno)
        m.multiply(local)
        inst.setMatrixAt(i, m)
        if (tintar && it.luz !== undefined) {
          // `setRGB` sin espacio de color explícito escribe en el espacio de
          // trabajo, que es LINEAL -- que es justo como viene el tinte de
          // bsp-props.ts. Pasarlo por `setHex`/`setStyle` lo interpretaría
          // como sRGB y lo aclararía de más.
          c.setRGB(it.luz[0], it.luz[1], it.luz[2])
          inst.setColorAt(i, c)
        }
      }
      inst.instanceMatrix.needsUpdate = true
      if (inst.instanceColor !== null) inst.instanceColor.needsUpdate = true
      // Los props no se mueven: fuera del recálculo de matrices por frame.
      inst.matrixAutoUpdate = false
      inst.updateMatrix()
      raiz.add(inst)
    })
  }

  raiz.updateMatrixWorld(true)
  return raiz
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
  // Si el lightmap no se engancha, los props tampoco se tintan: las dos
  // cosas son la MISMA iluminación horneada, y encender sólo una deja el
  // mapa incoherente (paredes a albedo pleno con props en penumbra es tan
  // raro como lo contrario, que es lo que había antes).
  let lightmapAplicado = false
  if (mapa.lightmap !== undefined) {
    try {
      const textura = await new TextureLoader().loadAsync(mapa.lightmap)
      aplicarLightmap(objeto, textura)
      lightmapAplicado = true
    } catch {
      console.warn(`[${mapa.name}] no se pudo cargar el lightmap ${mapa.lightmap}; se dibuja sin iluminar`)
    }
  }

  // Props estáticos (muebles, autos, cercas). Opcionales por el mismo
  // criterio que el lightmap: sin ellos el mapa es más pelado pero jugable.
  //
  // Se cuelgan del objeto del mapa DESPUÉS de hornear los triángulos del
  // BVH a propósito: `hornearTriangulos` alimenta el hitscan, y un
  // InstancedMesh no expone sus instancias como triángulos de mundo (todas
  // comparten una geometría y se diferencian por matriz). Metidos antes,
  // las 50 instancias entrarían al BVH apiladas en el origen del modelo y
  // las balas pegarían contra props fantasma en el medio del mapa. Que los
  // props no frenen balas es una limitación conocida; que las frenen donde
  // no están sería un bug.
  def.triangles = hornearTriangulos(objeto)

  if (mapa.props !== undefined && mapa.propsDir !== undefined) {
    try {
      const respuestaProps = await fetch(mapa.props)
      if (respuestaProps.ok) {
        const crudoProps: unknown = await respuestaProps.json()
        if (esPropsMapaJson(crudoProps)) {
          const loader = new GLTFLoader()
          const modelos = await Promise.all(
            crudoProps.modelos.map(async (m) => (await loader.loadAsync(`${mapa.propsDir}/${m}`)).scene),
          )
          objeto.add(construirProps(modelos, crudoProps, lightmapAplicado))
        } else {
          console.warn(`[${mapa.name}] ${mapa.props} no tiene la forma que produce scripts/bsp-props.ts`)
        }
      }
    } catch (err) {
      console.warn(`[${mapa.name}] no se pudieron cargar los props:`, err)
    }
  }

  return { def, objeto }
}
