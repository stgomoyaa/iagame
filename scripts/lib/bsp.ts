/**
 * Lectura de bajo nivel de archivos .bsp de Source: cabecera, directorio de
 * 64 lumps, y las estructuras que comparten `bsp-analyze.ts` (estadística de
 * cuánta colisión entra en cápsula-contra-AABB) y `bsp-convert.ts`
 * (conversión completa a colisión + malla).
 *
 * Todo lo de acá vive en un sólo lugar a propósito: los índices de lump y el
 * tamaño de cada struct binario son números mágicos que Valve documenta una
 * vez; tenerlos duplicados en dos scripts es la forma más fácil de que se
 * desincronicen silenciosamente (uno se actualiza, el otro no, y el bug sólo
 * aparece leyendo un mapa real).
 */

/**
 * 1 unidad de Source = 0.75 pulgadas. Misma constante que usa el pipeline de
 * modelos (`scripts/lib/geometry.ts`). Se aplica UNA vez, acá, a todo punto o
 * distancia que sale de un .bsp.
 */
export const METROS_POR_UNIDAD = 0.01905

// Índices del directorio de 64 lumps (formato VBSP). Sólo se listan los que
// efectivamente lee algún script de este repo; el resto del directorio se
// ignora sin problema, ya que cada entrada es independiente de las demás.
export const LUMP_ENTITIES = 0
export const LUMP_PLANES = 1
export const LUMP_TEXDATA = 2
export const LUMP_VERTEXES = 3
export const LUMP_TEXINFO = 6
export const LUMP_FACES = 7
export const LUMP_EDGES = 12
export const LUMP_SURFEDGES = 13
export const LUMP_BRUSHES = 18
export const LUMP_BRUSHSIDES = 19
export const LUMP_DISPINFO = 26
export const LUMP_PAKFILE = 40
export const LUMP_TEXDATA_STRING_DATA = 43
export const LUMP_TEXDATA_STRING_TABLE = 44

// Tamaño en bytes de cada registro, para las versiones "estándar" del formato
// (Source clásico / GMod; no la variante extendida de CS:GO). Verificado a
// mano contra los dos mapas de prueba: los cuatro lumps de vértices/aristas
// dan resto 0 exacto contra estos tamaños.
export const TAM_PLANE = 20 // vec3 normal + float dist + int type
export const TAM_BRUSH = 12 // int firstside + int numsides + int contents
export const TAM_BRUSHSIDE = 8 // u16 planenum + i16 texinfo + i16 dispinfo + i16 bevel
export const TAM_DISPINFO = 176
export const TAM_VERTEX = 12 // vec3
export const TAM_EDGE = 4 // u16 v0 + u16 v1
export const TAM_SURFEDGE = 4 // int32
export const TAM_FACE = 56 // dface_t
export const TAM_TEXINFO = 72 // texinfo_t
export const TAM_TEXDATA = 32 // dtexdata_t

export const CONTENTS_SOLID = 0x1

/** Tolerancia para considerar que una componente de una normal es 0 o ±1. */
export const EPS = 1e-4

export interface Lump {
  offset: number
  largo: number
}

/** Cabecera (4 bytes de magic "VBSP" + versión) y directorio de 64 lumps. */
export function leerLumps(buf: Buffer): { version: number; lumps: Lump[] } {
  if (buf.toString('ascii', 0, 4) !== 'VBSP') throw new Error('no es un .bsp de Source (falta VBSP)')
  const version = buf.readInt32LE(4)
  const lumps: Lump[] = []
  for (let i = 0; i < 64; i++) {
    const base = 8 + i * 16
    lumps.push({ offset: buf.readInt32LE(base), largo: buf.readInt32LE(base + 4) })
  }
  return { version, lumps }
}

export interface Planos {
  nx: Float32Array
  ny: Float32Array
  nz: Float32Array
  dist: Float32Array
}

/** Lee LUMP_PLANES completo: normal + distancia de cada plano del mapa. */
export function leerPlanos(buf: Buffer, lump: Lump): Planos {
  const n = Math.floor(lump.largo / TAM_PLANE)
  const nx = new Float32Array(n)
  const ny = new Float32Array(n)
  const nz = new Float32Array(n)
  const dist = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const o = lump.offset + i * TAM_PLANE
    nx[i] = buf.readFloatLE(o)
    ny[i] = buf.readFloatLE(o + 4)
    nz[i] = buf.readFloatLE(o + 8)
    dist[i] = buf.readFloatLE(o + 12)
  }
  return { nx, ny, nz, dist }
}

/**
 * Brushes con CONTENTS_SOLID, cada uno como la lista de índices de plano de
 * sus lados reales (sin bevel). Agua, triggers, humo y el resto de contents
 * no sólidos quedan afuera acá mismo: ni la estadística de bsp-analyze.ts ni
 * la colisión de bsp-convert.ts los necesitan, y filtrarlos en un sólo lugar
 * evita que las dos lecturas terminen aplicando el criterio distinto.
 *
 * Los lados "bevel" son planos que agrega vbsp para que la colisión física
 * de Source no se enganche en aristas; no son caras reales del brush y
 * contarlos rompería tanto el conteo de planos esperado (una caja da más de
 * 6) como, en bsp-analyze.ts, la detección de si el brush es una caja.
 */
/** Material de herramienta de los volúmenes de trigger de Hammer. */
const MATERIAL_TRIGGER = 'TOOLS/TOOLSTRIGGER'

/**
 * Nombre de material de cada BRUSHSIDE, indexado por índice de lado.
 *
 * Se arma acá y no en el llamador porque `leerBrushesSolidos` necesita
 * distinguir un brush de verdad de un volumen de trigger, y esa distinción
 * NO está en `contents` (ver `esVolumenDeTrigger`). Recorre tres lumps
 * (texinfo -> texdata -> tabla de strings) una sola vez por archivo.
 */
function materialPorLado(buf: Buffer, lumps: Lump[]): string[] {
  const lSides = lumps[LUMP_BRUSHSIDES]
  const lTexinfo = lumps[LUMP_TEXINFO]
  const lTexdata = lumps[LUMP_TEXDATA]
  const lTabla = lumps[LUMP_TEXDATA_STRING_TABLE]
  const lDatos = lumps[LUMP_TEXDATA_STRING_DATA]

  const numTexinfo = Math.floor(lTexinfo.largo / TAM_TEXINFO)
  const numTexdata = Math.floor(lTexdata.largo / TAM_TEXDATA)
  const numNombres = Math.floor(lTabla.largo / 4)

  // Cache por texinfo: varios miles de lados comparten un puñado de
  // materiales, y resolver el string una vez por lado sería releer la tabla
  // de strings decenas de miles de veces.
  const porTexinfo: string[] = new Array<string>(numTexinfo).fill('')
  for (let i = 0; i < numTexinfo; i++) {
    const td = buf.readInt32LE(lTexinfo.offset + i * TAM_TEXINFO + 68)
    if (td < 0 || td >= numTexdata) continue
    const nameId = buf.readInt32LE(lTexdata.offset + td * TAM_TEXDATA + 12)
    if (nameId < 0 || nameId >= numNombres) continue
    const abs = lDatos.offset + buf.readInt32LE(lTabla.offset + nameId * 4)
    const fin = buf.indexOf(0, abs)
    porTexinfo[i] = buf.toString('ascii', abs, fin === -1 ? abs : fin)
  }

  const numLados = Math.floor(lSides.largo / TAM_BRUSHSIDE)
  const out: string[] = new Array<string>(numLados).fill('')
  for (let s = 0; s < numLados; s++) {
    const ti = buf.readInt16LE(lSides.offset + s * TAM_BRUSHSIDE + 2)
    if (ti >= 0 && ti < numTexinfo) out[s] = porTexinfo[ti]
  }
  return out
}

/**
 * ¿Este brush es en realidad un volumen de trigger?
 *
 * Hace falta preguntarlo por MATERIAL y no por `contents` porque vbsp deja
 * los brushes de las entidades trigger con `contents = CONTENTS_SOLID`: lo
 * que los hace atravesables en el juego es la entidad a la que pertenecen,
 * no el brush. Sin este filtro, dm_nuketown mete 25 cajones invisibles y
 * macizos en el mapa -- entre ellos uno de 8x15x2.4 m que tapa una casa
 * entera y deja adentro los 16 spawns de ese lado. Se detectó porque los 32
 * spawns del mapa daban "dentro de geometría sólida"; ningún test lo veía
 * porque la geometría cargaba perfecto, sólo que era mentira.
 *
 * Se exige que TODOS los lados sean trigger: un brush sólido de verdad
 * nunca tiene una cara con esa textura, y así una cara suelta mal texturada
 * no borra un muro real.
 */
function esVolumenDeTrigger(nombreDeLado: string[], primerLado: number, numLados: number): boolean {
  if (numLados === 0) return false
  for (let s = 0; s < numLados; s++) {
    if (nombreDeLado[primerLado + s]?.toUpperCase() !== MATERIAL_TRIGGER) return false
  }
  return true
}

export function leerBrushesSolidos(buf: Buffer, lumps: Lump[]): number[][] {
  const lBrushes = lumps[LUMP_BRUSHES]
  const lSides = lumps[LUMP_BRUSHSIDES]
  const numBrushes = Math.floor(lBrushes.largo / TAM_BRUSH)
  const nombreDeLado = materialPorLado(buf, lumps)

  const resultado: number[][] = []
  for (let b = 0; b < numBrushes; b++) {
    const o = lBrushes.offset + b * TAM_BRUSH
    const primerLado = buf.readInt32LE(o)
    const numLados = buf.readInt32LE(o + 4)
    const contents = buf.readInt32LE(o + 8)
    if ((contents & CONTENTS_SOLID) === 0) continue
    if (esVolumenDeTrigger(nombreDeLado, primerLado, numLados)) continue

    const planos: number[] = []
    for (let s = 0; s < numLados; s++) {
      const so = lSides.offset + (primerLado + s) * TAM_BRUSHSIDE
      const bevel = buf.readInt16LE(so + 6)
      if (bevel !== 0) continue
      planos.push(buf.readUInt16LE(so))
    }
    resultado.push(planos)
  }
  return resultado
}

/** True si la normal apunta exactamente sobre un eje. */
export function esNormalAlineada(x: number, y: number, z: number): boolean {
  const ejes = [x, y, z]
  let unos = 0
  let ceros = 0
  for (const v of ejes) {
    const a = Math.abs(v)
    if (a < EPS) ceros++
    else if (Math.abs(a - 1) < EPS) unos++
  }
  return unos === 1 && ceros === 2
}

/** Punto de cruce de tres planos, o null si son (casi) paralelos. */
function cruzarTresPlanos(
  a: number,
  b: number,
  c: number,
  nx: Float32Array,
  ny: Float32Array,
  nz: Float32Array,
  dist: Float32Array,
): [number, number, number] | null {
  // Regla de Cramer sobre la matriz de normales.
  const det =
    nx[a] * (ny[b] * nz[c] - nz[b] * ny[c]) -
    ny[a] * (nx[b] * nz[c] - nz[b] * nx[c]) +
    nz[a] * (nx[b] * ny[c] - ny[b] * nx[c])

  if (Math.abs(det) < 1e-6) return null

  const x =
    dist[a] * (ny[b] * nz[c] - nz[b] * ny[c]) -
    ny[a] * (dist[b] * nz[c] - nz[b] * dist[c]) +
    nz[a] * (dist[b] * ny[c] - ny[b] * dist[c])
  const y =
    nx[a] * (dist[b] * nz[c] - nz[b] * dist[c]) -
    dist[a] * (nx[b] * nz[c] - nz[b] * nx[c]) +
    nz[a] * (nx[b] * dist[c] - dist[b] * nx[c])
  const z =
    nx[a] * (ny[b] * dist[c] - dist[b] * ny[c]) -
    ny[a] * (nx[b] * dist[c] - dist[b] * nx[c]) +
    dist[a] * (nx[b] * ny[c] - ny[b] * nx[c])

  return [x / det, y / det, z / det]
}

/**
 * Vértices reales de un brush: cruces de ternas de planos que caen dentro de
 * todos los demás lados. Es el único lugar donde se resuelve el poliedro a
 * partir de sus planos; `extension()` y `bboxDelBrush()` son dos proyecciones
 * distintas de este mismo cálculo (una da tamaño, la otra da esquinas), así
 * que ninguna de las dos vuelve a implementar el cruce de planos por su
 * cuenta.
 *
 * Un brush tiene entre 4 y ~20 planos, así que probar todas las ternas es
 * barato y no hace falta traer un solver de poliedros.
 */
export function verticesDelBrush(
  planos: number[],
  nx: Float32Array,
  ny: Float32Array,
  nz: Float32Array,
  dist: Float32Array,
): Array<[number, number, number]> {
  const vertices: Array<[number, number, number]> = []

  for (let i = 0; i < planos.length; i++) {
    for (let j = i + 1; j < planos.length; j++) {
      for (let k = j + 1; k < planos.length; k++) {
        const v = cruzarTresPlanos(planos[i], planos[j], planos[k], nx, ny, nz, dist)
        if (v === null) continue

        // Tres planos siempre se cruzan en algún lado, pero ese cruce sólo es
        // vértice del cuerpo si cae dentro (o justo sobre) el resto de los
        // lados del brush.
        let adentro = true
        for (const p of planos) {
          if (nx[p] * v[0] + ny[p] * v[1] + nz[p] * v[2] > dist[p] + 0.01) {
            adentro = false
            break
          }
        }
        if (adentro) vertices.push(v)
      }
    }
  }

  return vertices
}

/**
 * Extensión (ancho, alto, largo) de la caja envolvente del brush, en
 * unidades de Source. `null` si el brush no tiene vértices resolubles (menos
 * de 4 planos, o degenerado).
 */
export function extension(
  planos: number[],
  nx: Float32Array,
  ny: Float32Array,
  nz: Float32Array,
  dist: Float32Array,
): [number, number, number] | null {
  const vertices = verticesDelBrush(planos, nx, ny, nz, dist)
  if (vertices.length === 0) return null

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const v of vertices) {
    for (let eje = 0; eje < 3; eje++) {
      if (v[eje] < min[eje]) min[eje] = v[eje]
      if (v[eje] > max[eje]) max[eje] = v[eje]
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
}

export interface Bbox {
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * Caja envolvente real del brush (esquinas, no sólo tamaño), en unidades de
 * Source. A diferencia de `extension()`, esto es lo que necesita
 * bsp-convert.ts para escribir `min`/`max` en el JSON de colisión.
 */
export function bboxDelBrush(
  planos: number[],
  nx: Float32Array,
  ny: Float32Array,
  nz: Float32Array,
  dist: Float32Array,
): Bbox | null {
  const vertices = verticesDelBrush(planos, nx, ny, nz, dist)
  if (vertices.length === 0) return null

  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const v of vertices) {
    for (let eje = 0; eje < 3; eje++) {
      if (v[eje] < min[eje]) min[eje] = v[eje]
      if (v[eje] > max[eje]) max[eje] = v[eje]
    }
  }
  return { min, max }
}

/**
 * Reordena ejes de Source (Z-up) a three.js (Y-up): `(x,y,z) -> (x,z,-y)`.
 * Sin escalar: sirve tal cual para normales (que no llevan unidades) y como
 * paso intermedio para puntos, que además hay que escalar a metros.
 *
 * Es el ÚNICO lugar donde se define esta permutación de ejes. bsp-convert.ts
 * la aplica a spawns, vértices de brush y vértices de malla llamando siempre
 * a esta función (directo o vía `puntoSourceAThreeMetros`): si el mesh y la
 * colisión llegaran a usar dos copias de esta fórmula que se desincronizan,
 * el mapa se ve bien y es injugable, que es el peor fallo posible acá.
 *
 * Es una rotación pura (matriz de determinante +1, sin reflexión ni
 * traslación): por eso normales y puntos comparten la misma fórmula, y por
 * eso la distancia `d` de un plano sólo se escala al convertir unidades a
 * metros, nunca se reordena por eje (ver `planoSourceAThreeMetros`).
 */
export function ejesSourceAThree(v: readonly [number, number, number]): [number, number, number] {
  return [v[0], v[2], -v[1]]
}

/**
 * Yaw de Source (el segundo número de `angles`, en GRADOS) al yaw del motor
 * (radianes, el que va a `camera.rotation.y` con orden YXZ).
 *
 * Las dos convenciones no coinciden en nada: en Source yaw=0 mira a +X y el
 * ángulo crece hacia +Y; en three, con la cámara rotando sobre Y, yaw=0 mira
 * a -Z y el ángulo crece hacia... el otro lado. Componiendo la permutación
 * de ejes de `ejesSourceAThree` (+Y de Source es -Z de three) con la
 * dirección que produce `camera.rotation.y`, el resultado se reduce a un
 * signo y un cuarto de vuelta:
 *
 *     adelante_source = ( cos θ, sin θ, 0 )        (en ejes de Source)
 *     adelante_three  = ( cos θ, 0, -sin θ )       (tras ejesSourceAThree)
 *     adelante_three  = ( -sin ψ, 0, -cos ψ )      (lo que da rotation.y = ψ)
 *     => sin ψ = -cos θ, cos ψ = sin θ  =>  ψ = θ - π/2
 *
 * Se verifica en bsp.test.ts contra las CUATRO direcciones cardinales, no
 * sólo contra las dos que aparecen en nuketown (θ=0 y θ=180). Los mapas de
 * Source enfrentan a los dos bandos a lo largo de un eje, así que sus dos
 * valores están a 180° -- y `-θ - π/2` (el signo equivocado) da el mismo
 * resultado que `θ - π/2` para esos dos, porque difieren en 2θ, que para
 * θ=0 y θ=180 es 0 o una vuelta entera. O sea: la conversión con el signo
 * dado vuelta pasa cualquier prueba hecha SÓLO con nuketown y falla en
 * cuanto un mapa tenga un spawn en diagonal. Por eso los casos de 90 y 270
 * de ese test no son decoración.
 */
export function yawSourceAThree(grados: number): number {
  return (grados * Math.PI) / 180 - Math.PI / 2
}

/** `ejesSourceAThree` + conversión de unidades de Source a metros. */
export function puntoSourceAThreeMetros(v: readonly [number, number, number]): [number, number, number] {
  const [x, y, z] = ejesSourceAThree(v)
  return [x * METROS_POR_UNIDAD, y * METROS_POR_UNIDAD, z * METROS_POR_UNIDAD]
}

export interface PlanoTransformado {
  normal: [number, number, number]
  d: number
}

/**
 * Plano de colisión (`dot(n,p) <= d`, normal hacia afuera) de unidades de
 * Source a metros de three.js. La normal rota de eje igual que un punto; `d`
 * sólo se escala, porque es un escalar (la distancia del plano al origen a
 * lo largo de la normal) y la rotación no lo toca — sólo cambiaría si
 * hubiera además una traslación, y acá no la hay.
 */
export function planoSourceAThreeMetros(normal: readonly [number, number, number], d: number): PlanoTransformado {
  return { normal: ejesSourceAThree(normal), d: d * METROS_POR_UNIDAD }
}

/**
 * Caja envolvente de Source (unidades) a three.js (metros). No alcanza con
 * reordenar los componentes de `min`/`max` tal cual: el eje Z de three.js es
 * `-Y` de Source, así que el mínimo y el máximo de ESE eje se cruzan. Por eso
 * se transforman las dos esquinas primero y recién después se recalcula
 * min/max componente a componente, en vez de asumir qué esquina quedó dónde.
 */
export function bboxSourceAThreeMetros(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
): Bbox {
  const a = puntoSourceAThreeMetros(min)
  const b = puntoSourceAThreeMetros(max)
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  }
}
