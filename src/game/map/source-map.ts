/**
 * Traduce el JSON que produce `scripts/bsp-convert.ts` (un mapa de Source
 * ya convertido offline) al `MapDef` que consume el motor.
 *
 * Matemática y datos puros: no toca la red, ni three, ni el DOM. El fetch y
 * la malla visual viven en map/external-map.ts; acá sólo entra el objeto ya
 * parseado. Así la parte que de verdad puede salir mal -- la escala, los
 * spawns que caen dentro de una pared -- se ejercita en tests sin navegador.
 *
 * ESCALA: el JSON ya viene en METROS y en ejes de three.js. `metrosPorUnidad`
 * viaja sólo como dato informativo (ver el comentario de `MapaColision` en
 * bsp-convert.ts). Multiplicar por él acá dejaría el mapa al 2% de su
 * tamaño; dividir, 52 veces más grande. No se lo aplica en ningún lado de
 * este archivo, a propósito.
 */

import type { Convex, MapDef } from '@/game/map/types'
import { vec3, type Vec3 } from '@/game/math/vec3'
import { PLAYER_CAPSULE, capsuleOverlapsConvex, type Capsule } from '@/game/physics/capsule'

type Triple = [number, number, number]

/** Un brush sólido tal como lo escribe bsp-convert.ts. */
export interface BrushJson {
  /** Planos aplanados (nx, ny, nz, d), normal hacia AFUERA. */
  planes: number[]
  min: Triple
  max: Triple
}

/** El archivo `<mapa>.json` completo. */
export interface MapaFuenteJson {
  nombre: string
  metrosPorUnidad: number
  bounds: { min: Triple; max: Triple }
  spawns: Triple[]
  brushes: BrushJson[]
}

/**
 * Alturas de rescate para un spawn que quedó hundido en el suelo, en
 * metros, en orden. Los spawns de Source están pensados para una cápsula de
 * 32x72 unidades (0.61 x 1.83 m) y la nuestra es MÁS ANCHA (0.8 m de
 * diámetro): varios spawns que en Source quedaban justos contra una pared
 * acá quedan mordiendo el brush. Antes de tirar un spawn a la basura se
 * prueba subirlo un poco -- si arriba hay aire, el jugador cae solo al piso
 * en un par de ticks y nadie nota nada. Un spawn adentro de una pared, en
 * cambio, no se salva subiéndolo 30 cm y se descarta.
 */
const RESCATES_Y = [0, 0.06, 0.15, 0.3] as const

function esTriple(v: unknown): v is Triple {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
}

/**
 * Guard de forma sobre el JSON crudo. Existe porque el archivo llega por
 * fetch: un 404 servido como HTML, un archivo a medio copiar o una versión
 * vieja del conversor tienen que fallar acá con un mensaje, no diez capas
 * más abajo con un `undefined is not iterable` dentro de la colisión.
 */
export function esMapaFuenteJson(v: unknown): v is MapaFuenteJson {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.nombre !== 'string') return false
  if (!Array.isArray(o.spawns) || !o.spawns.every(esTriple)) return false
  if (typeof o.bounds !== 'object' || o.bounds === null) return false
  const b = o.bounds as Record<string, unknown>
  if (!esTriple(b.min) || !esTriple(b.max)) return false
  if (!Array.isArray(o.brushes)) return false
  return o.brushes.every((br: unknown) => {
    if (typeof br !== 'object' || br === null) return false
    const x = br as Record<string, unknown>
    return (
      Array.isArray(x.planes) &&
      x.planes.length % 4 === 0 &&
      x.planes.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)) &&
      esTriple(x.min) &&
      esTriple(x.max)
    )
  })
}

/**
 * Brushes del JSON como cuerpos convexos listos para la colisión. Los
 * planos pasan a Float32Array porque es lo que lee overlapAndResolveConvex
 * en el camino caliente (physics/capsule.ts); el `count` se deriva del
 * largo, nunca se escribe a mano.
 */
export function convexesDesdeJson(json: MapaFuenteJson): Convex[] {
  const out: Convex[] = []
  for (const brush of json.brushes) {
    const count = brush.planes.length / 4
    // Un brush sin planos no encierra nada: incluirlo sería iterar por
    // nada 128 veces por segundo.
    if (count === 0) continue
    out.push({
      planes: new Float32Array(brush.planes),
      count,
      min: vec3(brush.min[0], brush.min[1], brush.min[2]),
      max: vec3(brush.max[0], brush.max[1], brush.max[2]),
    })
  }
  return out
}

/** ¿La cápsula parada acá toca algún brush? */
function chocaAlgo(p: Vec3, convexes: Convex[], capsule: Capsule): boolean {
  for (let i = 0; i < convexes.length; i++) {
    if (capsuleOverlapsConvex(p, capsule, convexes[i])) return true
  }
  return false
}

/**
 * Spawns utilizables: los que dejan a la cápsula libre, subiendo unos
 * centímetros los que quedaron apenas hundidos y tirando los que están
 * adentro de geometría sólida. Un spawn dentro de una pared es un jugador
 * atascado desde el primer frame, y ningún test de carga lo ve.
 */
export function spawnsUtilizables(
  spawnsCrudos: readonly Triple[],
  convexes: Convex[],
  capsule: Capsule = PLAYER_CAPSULE,
): Vec3[] {
  const out: Vec3[] = []
  const sonda = vec3()
  for (const s of spawnsCrudos) {
    for (const dy of RESCATES_Y) {
      sonda.x = s[0]
      sonda.y = s[1] + dy
      sonda.z = s[2]
      if (!chocaAlgo(sonda, convexes, capsule)) {
        out.push(vec3(sonda.x, sonda.y, sonda.z))
        break
      }
    }
  }
  return out
}

/**
 * `MapDef` completo salvo la malla visual (`triangles`, que la agrega
 * map/external-map.ts cuando termina de bajar el GLB).
 *
 * `boxes` va vacío a propósito: la geometría de un mapa de Source son
 * brushes, no cajas, y meterle las bounding boxes de los brushes como si
 * fueran sólidos duplicaría la colisión y llenaría de paredes invisibles
 * cada rampa. Todo lo que hoy recorre `boxes` (mantle, navgrid, cobertura
 * de bots) simplemente no encuentra nada en este mapa; eso es sabido y está
 * fuera del alcance de esta tarea.
 */
export function mapDefDesdeJson(json: MapaFuenteJson, nombre: string): MapDef {
  const convexes = convexesDesdeJson(json)
  const utilizables = spawnsUtilizables(json.spawns, convexes)
  // Si NINGUNO sobrevive, se usan los crudos igual: un jugador que arranca
  // atascado se destraba respawneando, una lista de spawns vacía es un
  // `spawns[0]` undefined y una pantalla negra. Falla del lado de que el
  // mapa siga siendo jugable.
  const spawns = utilizables.length > 0
    ? utilizables
    : json.spawns.map((s) => vec3(s[0], s[1], s[2]))
  return {
    name: nombre,
    boxes: [],
    convexes,
    spawns,
    bounds: {
      min: vec3(json.bounds.min[0], json.bounds.min[1], json.bounds.min[2]),
      max: vec3(json.bounds.max[0], json.bounds.max[1], json.bounds.max[2]),
    },
  }
}
