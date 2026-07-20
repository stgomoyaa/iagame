/**
 * Navgrid horneado desde la definición del mapa (sección 8 del spec: "Navgrid
 * horneado desde la definición del mapa"). Matemática pura sobre la MISMA
 * geometría que ya usa la colisión (map/types.ts) -- nada de esto conoce
 * Three ni el BVH de combate. Se hornea UNA vez por mapa (game.ts lo llama al
 * crear la partida), nunca en el camino de frame: por eso puede permitirse
 * recorrer todos los sólidos por celda sin que le importe al presupuesto de
 * 2.5 ms.
 *
 * Hay DOS horneados, según con qué esté hecho el mapa:
 *
 * - **Cajas AABB** (`MapDef.boxes`): los tres mapas escritos en código. Por
 *   columna se busca la superficie caminable más alta -- el techo de una caja
 *   que cubre esa columna -- con espacio libre encima para pararse. "Piso" es
 *   trivial acá: las caras horizontales de una AABB son las únicas
 *   candidatas.
 * - **Brushes convexos** (`MapDef.convexes`): los mapas importados de Source.
 *   Un brush no tiene "cara de arriba" por definición, así que la columna se
 *   recorta contra sus semiespacios y se mira la NORMAL del plano que la
 *   corta por arriba. Ahí es donde hace falta un umbral de pendiente, y ese
 *   umbral no vive acá: vive en physics/capsule.ts (`esNormalPisable`), que
 *   es el mismo predicado con el que la colisión decide si un empuje es piso
 *   o pared. Una rampa que la física deja subir es exactamente una rampa que
 *   este bake marca caminable, por construcción y no por coincidencia.
 *
 * CONECTIVIDAD. Las aristas del grafo se hornean acá (`links`) en vez de
 * decidirse en el camino caliente de A*, por dos razones: la buena es que
 * decidirlas bien exige mirar el terreno ENTRE dos celdas (ver
 * `aristaValida` más abajo), que es carísimo por expansión de nodo; la
 * importante es que así hay un solo lugar donde se responde "¿se puede ir de
 * acá a allá?", y ese lugar tiene delante la geometría real del mapa.
 */

import type { Box, Convex, MapDef } from '@/game/map/types'
import { MAX_ESCALON, PLAYER_CAPSULE, esNormalPisable } from '@/game/physics/capsule'
import { buildConvexGrid, queryConvexGrid, type ConvexGrid } from '@/game/physics/convex-grid'
import { MOVEMENT } from '@/game/movement/tuning'
import { BOTS } from '@/game/bots/tuning'

export interface NavGrid {
  readonly cellSize: number
  readonly minX: number
  readonly minZ: number
  readonly cols: number
  readonly rows: number
  /** Altura (Y) de la superficie caminable de cada celda, indexado
   *  row*cols+col. NaN si la celda no es caminable. */
  readonly heights: Float32Array
  /** 1 si la celda tiene una superficie caminable, 0 si no. Uint8Array
   *  separado de heights (en vez de leer isNaN) porque isNaN en el camino
   *  caliente de A* es más lento que un byte. */
  readonly walkable: Uint8Array
  /**
   * Aristas del grafo, horneadas: el bit `n` de la celda `i` está en 1 si `i`
   * está conectada con su vecino `NEIGHBOR_OFFSETS[n]`. Un byte por celda, y
   * la respuesta en el camino caliente de A* es un AND -- más barato que las
   * dos lecturas de Float32Array y la resta que hacía antes, y además puede
   * codificar criterios que en frame serían impagables.
   *
   * Simétrico por construcción: el bake escribe siempre los dos sentidos.
   */
  readonly links: Uint8Array
  /**
   * Desnivel máximo, en metros, que stepPlayer() puede vencer EN ESTE MAPA.
   * Informativo (el grafo ya está horneado en `links`), pero explícito
   * porque no es el mismo número en todos los mapas -- ver
   * `alturaFranqueable`.
   */
  readonly maxStepHeight: number
}

/**
 * Margen de pendiente del navgrid sobre el umbral de la física, en unidades
 * de la componente Y de la normal.
 *
 * nuketown tiene 118 planos EXACTAMENTE a 45 grados (los techos a dos aguas
 * de las casas), justo sobre el empate `ny == hypot(nx,nz)` que separa piso
 * de pared, donde el redondeo de punto flotante decide el resultado. Para la
 * física un empate no cuesta nada: resuelve un contacto para un lado o para
 * el otro y sigue. Para el navgrid, un techo horneado como caminable es un
 * destino de patrulla al que nadie puede subir.
 *
 * Honestidad sobre cuánto rinde: MEDIDO sobre nuketown, poner este margen en
 * cero no cambia un solo número del bake (mismas 14.074 celdas caminables,
 * mismas 106.460 aristas). No sorprende: los techos pierden mucho antes, al
 * elegirse la superficie más BAJA de cada columna, así que el empate ni
 * siquiera se llega a jugar. O sea que esto NO es el arreglo de ningún bug
 * observado -- es una desigualdad estricta puesta del lado seguro, para que
 * el navgrid nunca resuelva un empate de forma más permisiva que la física.
 * 1e-3 en `ny` son 0,06 grados: no toca ninguna rampa real (la más empinada
 * que un mapa de Source construye para caminar anda por los 30-40 grados).
 */
const MARGEN_PENDIENTE = 1e-3

/**
 * Tolerancia de solapamiento vertical. Mismo orden que el SKIN de la
 * colisión: dos brushes que comparten una cara (lo normal cuando un mapa se
 * arma pegando cajas) no tienen que taparse mutuamente el espacio libre.
 */
const EPS = 1e-4

// ---------------------------------------------------------------------------
// Vecindario
// ---------------------------------------------------------------------------

/** Vecinos en 8 direcciones, como deltas (dCol, dRow). Índices pares
 *  (0,2,4,6) son los cuatro cardinales; los impares son las diagonales. El
 *  opuesto de `n` es `(n + 4) % 8`, propiedad de la que depende el bake de
 *  `links` para escribir los dos sentidos de cada arista. Se expone como
 *  constante módulo para que A* (pathfinding.ts) no reasigne este array en
 *  cada expansión de nodo. */
export const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

/** Índice dentro de NEIGHBOR_OFFSETS de un delta (dCol,dRow) de vecindario, o
 *  -1 si no es uno de los ocho vecinos. Tabla y no búsqueda lineal: se llama
 *  desde cellsConnected. Indexada por (dRow+1)*3 + (dCol+1). */
const OFFSET_POR_DELTA = new Int8Array([5, 6, 7, 4, -1, 0, 3, 2, 1])

// ---------------------------------------------------------------------------
// Bake: cajas AABB (los tres mapas escritos en código)
// ---------------------------------------------------------------------------

/** ¿Hay una caja distinta de la que da la superficie que ocupe el volumen
 *  entre `top` y `top + capsuleHeight` en esta columna? Si la hay, esta
 *  superficie no sirve para pararse -- no hay espacio para la cápsula. */
function isClearAbove(
  boxes: Box[],
  x: number,
  z: number,
  top: number,
  capsuleHeight: number,
): boolean {
  const ceiling = top + capsuleHeight
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (x <= b.min.x || x >= b.max.x) continue
    if (z <= b.min.z || z >= b.max.z) continue
    // La propia caja que da la superficie tiene b.max.y === top, así que
    // b.max.y > top + epsilon es falso para ella -- se excluye sola, sin
    // necesidad de compararla por identidad.
    if (b.min.y < ceiling - EPS && b.max.y > top + EPS) return false
  }
  return true
}

/** Superficie caminable más alta en la columna (x,z), o null si no hay
 *  ninguna con espacio libre para la cápsula. */
function surfaceHeight(boxes: Box[], x: number, z: number, capsuleHeight: number): number | null {
  let best: number | null = null
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (x <= b.min.x || x >= b.max.x) continue
    if (z <= b.min.z || z >= b.max.z) continue
    const top = b.max.y
    if (best !== null && top <= best) continue
    if (isClearAbove(boxes, x, z, top, capsuleHeight)) best = top
  }
  return best
}

// ---------------------------------------------------------------------------
// Bake: brushes convexos (mapas importados de Source)
// ---------------------------------------------------------------------------

/**
 * Recorta la recta vertical que pasa por (x,z) contra los semiespacios de un
 * brush. Un cuerpo convexo es la intersección de `dot(n,p) <= d`; sobre la
 * recta p(t) = (x, t, z) cada plano se vuelve `ny*t <= d - nx*x - nz*z`, o
 * sea una cota superior (ny > 0), una inferior (ny < 0), o un simple
 * "adentro/afuera" (ny == 0, plano vertical). El resultado es el intervalo
 * [lo, hi] de alturas que la columna pasa por dentro del brush, y la normal
 * del plano que la corta por ARRIBA -- que es la cara sobre la que se
 * pisaría.
 *
 * Devuelve false si la columna no atraviesa el brush.
 */
interface IntervaloColumna {
  lo: number
  hi: number
  /** ¿La cara que corta por arriba es piso, según el mismo predicado que usa
   *  la colisión? */
  pisable: boolean
}

function recortarColumna(
  convex: Convex,
  x: number,
  z: number,
  out: IntervaloColumna,
  radio = 0,
): boolean {
  // Descarte con la caja envolvente antes de tocar los planos: es el mismo
  // primer paso que hace overlapAndResolveConvex.
  if (x < convex.min.x - radio || x > convex.max.x + radio) return false
  if (z < convex.min.z - radio || z > convex.max.z + radio) return false

  const planes = convex.planes
  const count = convex.count
  let lo = -Infinity
  let hi = Infinity
  let topNx = 0
  let topNy = 0
  let topNz = 0

  for (let i = 0; i < count; i++) {
    const base = i * 4
    const nx = planes[base]
    const ny = planes[base + 1]
    const nz = planes[base + 2]
    // `radio` infla el cuerpo por su normal, que es exactamente la
    // aproximación que ya usa la colisión (`penetracion = d + r - minSeg` en
    // physics/capsule.ts): el eje de la cápsula adentro del cuerpo inflado es
    // lo mismo que la cápsula tocando el cuerpo original. Con radio 0 esto es
    // el recorte geométrico puro, que es lo que quiere el campo de alturas.
    const c = planes[base + 3] + radio - nx * x - nz * z

    if (ny > EPS) {
      const t = c / ny
      if (t < hi) {
        hi = t
        topNx = nx
        topNy = ny
        topNz = nz
      }
    } else if (ny < -EPS) {
      const t = c / ny
      if (t > lo) lo = t
    } else if (c < -EPS) {
      // Plano vertical que deja la columna entera afuera.
      return false
    }
  }

  if (!(hi > lo)) return false
  out.lo = lo
  out.hi = hi
  out.pisable = esNormalPisable(topNx, topNy, topNz, MARGEN_PENDIENTE)
  return true
}

/**
 * Campo de alturas de un mapa de brushes: para cada columna muestreada, la
 * superficie PISABLE más alta con espacio libre para la cápsula por encima.
 *
 * El criterio de "espacio libre" es el mismo que en el bake de cajas, pero
 * calculado sin O(n^2): se busca, entre los intervalos que la columna cruza,
 * el más alto que sea pisable y que no tenga otro intervalo tapándolo dentro
 * de `capsuleHeight`.
 */
interface CampoAlturas {
  readonly cols: number
  readonly rows: number
  /** Altura de la superficie pisable de cada sub-columna, NaN si no hay. */
  readonly h: Float32Array
  /** 1 si la sub-columna tiene superficie pisable con espacio para la cápsula. */
  readonly w: Uint8Array
}

/**
 * Buffers de la columna en curso. Se asignan una vez por bake (que es caro
 * pero corre una sola vez por mapa) en vez de por columna: con 326k columnas
 * en nuketown, un array por columna es basura suficiente para que el GC
 * domine el tiempo de carga.
 */
interface BuffersColumna {
  readonly cercanos: Convex[]
  readonly lo: Float64Array
  readonly hi: Float64Array
  readonly pisable: Uint8Array
  readonly intervalo: IntervaloColumna
  /** Cantidad de intervalos válidos escritos por el último `clipColumna`. */
  n: number
}

function crearBuffers(cantidadConvexos: number): BuffersColumna {
  return {
    cercanos: [],
    lo: new Float64Array(cantidadConvexos),
    hi: new Float64Array(cantidadConvexos),
    pisable: new Uint8Array(cantidadConvexos),
    intervalo: { lo: 0, hi: 0, pisable: false },
    n: 0,
  }
}

/** Recorta la columna (x,z) contra todos los brushes cercanos y deja los
 *  intervalos en `buf`. */
function clipColumna(
  convexes: Convex[],
  grilla: ConvexGrid,
  x: number,
  z: number,
  buf: BuffersColumna,
): void {
  const cerca = queryConvexGrid(grilla, convexes, x, x, z, z, buf.cercanos)
  let n = 0
  for (let i = 0; i < cerca; i++) {
    if (!recortarColumna(buf.cercanos[i], x, z, buf.intervalo)) continue
    buf.lo[n] = buf.intervalo.lo
    buf.hi[n] = buf.intervalo.hi
    buf.pisable[n] = buf.intervalo.pisable ? 1 : 0
    n++
  }
  buf.n = n
}

/**
 * ¿Hay sólido metido en el CUERPO de una cápsula cuyos pies están a `piso`,
 * con su eje en (x,z)?
 *
 * "El cuerpo" empieza un escalón por encima del piso, no en el piso: todo lo
 * que sobresalga menos que MAX_ESCALON es terreno que se camina -- el cordón
 * de la vereda, el umbral, el peldaño --, no un obstáculo. Por encima de eso
 * y hasta la coronilla, cualquier sólido es algo contra lo que la cápsula se
 * frena.
 *
 * El cuerpo se prueba inflando los brushes por el radio de la cápsula
 * (`recortarColumna` con `radio`) en vez de sondear puntos alrededor del eje.
 * No es un refinamiento: es la diferencia entre ver las paredes y no verlas.
 * Los muros de un mapa de Source son FINOS -- de los 539 brushes altos de
 * nuketown, 464 miden menos de 33 cm de espesor y el más fino mide 1.9 cm (una
 * unidad de Source) --, así que cualquier sondeo por muestras se los pierde
 * entre dos puntos y hornea como caminable el interior de una pared. Inflar
 * el cuerpo, en cambio, es exactamente lo que hace la colisión real
 * (physics/capsule.ts resuelve `d + r - minSeg`), y por lo tanto no puede
 * discrepar con ella por construcción.
 */
function cuerpoChoca(
  convexes: Convex[],
  grilla: ConvexGrid,
  buf: BuffersColumna,
  x: number,
  z: number,
  piso: number,
  capsuleHeight: number,
  radio: number,
): boolean {
  const desde = piso + MAX_ESCALON
  const hasta = piso + capsuleHeight
  const cerca = queryConvexGrid(grilla, convexes, x - radio, x + radio, z - radio, z + radio, buf.cercanos)
  for (let i = 0; i < cerca; i++) {
    if (!recortarColumna(buf.cercanos[i], x, z, buf.intervalo, radio)) continue
    // El inflado es esférico: mueve TODOS los planos por su normal, también
    // el de arriba y el de abajo. Para saber si el cuerpo choca lo que
    // importa es el alcance horizontal (que el inflado da bien) pero la
    // altura REAL del cuerpo, no la inflada -- si no, el propio piso sobre el
    // que uno está parado sobresale `radio` por encima de los pies y se
    // reporta como obstáculo. Descontar `radio` devuelve la cara original
    // exactamente para las caras horizontales, que son las que deciden si
    // algo es un escalón (y son casi toda la geometría de un mapa: los muros
    // y los cajones están alineados a los ejes). En una cara inclinada la
    // resta subestima un poco la altura, o sea falla del lado de dejar pasar
    // -- que es el lado correcto para una rampa, cuyo trabajo es dejar pasar.
    if (buf.intervalo.hi - radio > desde + EPS && buf.intervalo.lo + radio < hasta - EPS) return true
  }
  return false
}

function hornearCampoAlturas(
  convexes: Convex[],
  grilla: ConvexGrid,
  buf: BuffersColumna,
  cols: number,
  rows: number,
  minX: number,
  minZ: number,
  paso: number,
  capsuleHeight: number,
): CampoAlturas {
  const campo: CampoAlturas = {
    cols,
    rows,
    h: new Float32Array(cols * rows),
    w: new Uint8Array(cols * rows),
  }
  const { lo, hi, pisable } = buf

  for (let row = 0; row < rows; row++) {
    const z = minZ + (row + 0.5) * paso
    for (let col = 0; col < cols; col++) {
      const x = minX + (col + 0.5) * paso
      clipColumna(convexes, grilla, x, z, buf)
      const n = buf.n

      // La superficie más BAJA que sea pisable y tenga la cápsula libre por
      // encima. Ojo con esto: el bake de cajas se queda con la más ALTA, y la
      // diferencia no es un descuido sino la forma de los mapas.
      //
      // Los tres mapas escritos en código son a cielo abierto: la superficie
      // más alta de una columna es el techo de la caja que uno pisa, y no hay
      // nada por encima. Un mapa de Source es un volumen CERRADO -- el mundo
      // entero vive adentro de una cáscara de cielo, y esa cáscara tiene una
      // losa de techo plana, horizontal y con espacio infinito por encima que
      // cubre el mapa de punta a punta. Con el criterio de "la más alta", esa
      // losa gana en toda columna que toca y el navgrid de nuketown salía
      // siendo el TECHO DEL MUNDO: 9727 celdas conectadas a 19.96 m de altura,
      // 21 m por encima de donde están los 32 spawns. Los bots habrían
      // patrullado el cielorraso.
      //
      // Es la misma familia de bug que ya costó caro acá (el techo de los
      // muros marcado como caminable), pero llevada al extremo, y la máscara
      // de componente conexo no la salva: el techo del mundo es el componente
      // MÁS GRANDE, así que la máscara lo elegía a él y descartaba la calle.
      //
      // Costo conocido y aceptado: en una casa de dos pisos los bots se
      // quedan con la planta baja. Una grilla de una sola capa guarda UNA
      // altura por columna; elegir la capa donde están los spawns es lo único
      // que deja el mapa jugable. Un navgrid multicapa es otra tarea.
      let mejor = Infinity
      for (let i = 0; i < n; i++) {
        if (pisable[i] === 0) continue
        const top = hi[i]
        if (top >= mejor) continue
        const techo = top + capsuleHeight
        let libre = true
        for (let j = 0; j < n; j++) {
          if (hi[j] > top + EPS && lo[j] < techo - EPS) {
            libre = false
            break
          }
        }
        if (libre) mejor = top
      }

      const idx = row * cols + col
      if (mejor === Infinity) {
        campo.h[idx] = NaN
        campo.w[idx] = 0
      } else {
        campo.h[idx] = mejor
        campo.w[idx] = 1
      }
    }
  }

  return campo
}

// ---------------------------------------------------------------------------
// Conectividad
// ---------------------------------------------------------------------------

/**
 * Desnivel máximo, en metros, que stepPlayer() puede vencer entre dos celdas
 * vecinas EN ESTE MAPA. No es una constante global, y la diferencia importa:
 *
 * - **Mapas de cajas**: `MOVEMENT.mantleMaxHeight` (1.2 m). El mantle
 *   (movement/mantle.ts) sube repisas de hasta esa altura... pero SÓLO mira
 *   `boxes`: `tryMantle(position, velocity, wishDir, boxes)`. En un mapa de
 *   cajas eso cubre toda la geometría, así que el número es honesto y es el
 *   que estos mapas vienen usando.
 * - **Mapas de brushes convexos**: `MAX_ESCALON` (0.35 m). Acá el mantle NO
 *   existe: `boxes` va vacío (map/source-map.ts), así que `tryMantle` no
 *   encuentra nada contra qué engancharse y siempre falla. Lo único que sube
 *   un bot caminando es el escalón que resuelve la colisión convexa
 *   (physics/capsule.ts), y ése mide MAX_ESCALON.
 *
 * Prometer 1.2 m en un mapa de Source sería exactamente el defecto que este
 * proyecto ya pagó tres veces: el navgrid ofreciendo un camino que la física
 * no ejecuta, y el bot moliendo contra la geometría hasta que cambie de
 * estado. Un mapa mixto se lleva el criterio conservador por el mismo
 * motivo -- sus brushes no se mantlean.
 */
function alturaFranqueable(map: MapDef): number {
  const tieneConvexos = map.convexes !== undefined && map.convexes.length > 0
  return tieneConvexos ? MAX_ESCALON : MOVEMENT.mantleMaxHeight
}

/**
 * ¿Se puede ir caminando del centro de una celda al de su vecina?
 *
 * Se recorre el segmento sobre la retícula FINA de alturas, y en cada muestra
 * se hacen las dos preguntas que hay que hacer, que son distintas y ninguna
 * alcanza sola:
 *
 * 1. **El piso.** Que haya suelo, y que entre una muestra y la siguiente no
 *    haya un salto mayor que un escalón. Mirar sólo la diferencia de altura
 *    entre las dos PUNTAS -- que es lo que hacía el criterio viejo -- no
 *    distingue una escalera de un cajón: la escalera de Source sube 0.5 m por
 *    metro (más que MAX_ESCALON) y la física la sube perfecto porque ninguna
 *    contrahuella pasa de 0.15 m; un cajón de 1 m sube lo mismo y no se sube.
 *    Desde las puntas los dos casos son idénticos; desde el perfil, no.
 * 2. **El cuerpo.** Que la cápsula quepa (`cuerpoChoca`). Un tabique fino no
 *    cambia la altura del piso de ningún lado -- el suelo sigue estando igual
 *    a los dos lados de una pared --, así que el perfil no lo ve, y sin esta
 *    segunda pregunta el navgrid conecta alegremente dos celdas separadas por
 *    un muro.
 *
 * Las dos usan la altura REAL de cada muestra, la que horneó el campo fino, y
 * no una interpolación entre las puntas. La diferencia no es cosmética: con
 * la altura interpolada, el borde de una meseta al final de una rampa de 40
 * grados quedaba 0.05 m por encima del escalón contra un piso que la recta
 * subestimaba, y la rampa entera se horneaba desconectada -- los bots se
 * privaban de subir por donde el jugador sube caminando.
 *
 * DOS espaciados, los dos despejados y no elegidos:
 *
 * - Para el piso: sobre la superficie más empinada que el bake acepta (45
 *   grados, `esNormalPisable`), un tramo de largo `s` sube `s * tan(45°) = s`.
 *   Para que una rampa legítima nunca se confunda con un escalón hace falta
 *   `s <= MAX_ESCALON`. De ahí sale `submuestreo`.
 *
 *   Consecuencia de esa misma cuenta, que conviene saber antes de tocar
 *   ninguno de los dos: el escalón entre muestras y el umbral de pendiente
 *   son EL MISMO criterio dicho dos veces -- uno sobre normales de caras,
 *   otro sobre alturas muestreadas --, porque el submuestreo se eligió justo
 *   para que coincidieran. Por eso se tapan mutuamente: si se rompe uno solo,
 *   el otro sigue rechazando lo mismo y ningún test se entera (verificado
 *   rompiéndolos). Recién sacando los dos a la vez el banco de pruebas falla.
 * - Para el cuerpo: `cuerpoChoca` no mide el obstáculo sino el obstáculo
 *   INFLADO por el radio de la cápsula, así que lo detecta desde 0.4 m de
 *   distancia. Con muestras a `s <= 0.35 m` la cobertura del segmento es
 *   continua y no se puede colar ningún muro entre dos muestras, por fino que
 *   sea -- que es justo lo que sí pasaba muestreando columnas desnudas: de
 *   los 539 brushes altos de nuketown, 464 miden menos de 33 cm.
 */
function aristaValida(
  ctx: ContextoBrushes,
  campo: CampoAlturas,
  subColA: number,
  subRowA: number,
  subColB: number,
  subRowB: number,
  pasos: number,
): boolean {
  let prev = NaN
  for (let k = 0; k <= pasos; k++) {
    // Interpolación entera sobre la retícula fina: recorre la fila, la
    // columna o la diagonal sin saltearse ninguna sub-celda.
    const col = subColA + Math.round(((subColB - subColA) * k) / pasos)
    const row = subRowA + Math.round(((subRowB - subRowA) * k) / pasos)
    const idx = row * campo.cols + col
    if (campo.w[idx] === 0) return false

    const h = campo.h[idx]
    if (k > 0 && Math.abs(h - prev) > MAX_ESCALON) return false
    prev = h

    if (
      cuerpoChoca(
        ctx.convexes,
        ctx.grilla,
        ctx.buf,
        ctx.minX + (col + 0.5) * ctx.pasoFino,
        ctx.minZ + (row + 0.5) * ctx.pasoFino,
        h,
        ctx.capsuleHeight,
        ctx.radio,
      )
    ) {
      return false
    }
  }
  return true
}

function bakeLinksCajas(
  heights: Float32Array,
  walkable: Uint8Array,
  cols: number,
  rows: number,
  maxStep: number,
): Uint8Array {
  const links = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      if (walkable[idx] === 0) continue
      for (let n = 0; n < NEIGHBOR_OFFSETS.length; n++) {
        const c = col + NEIGHBOR_OFFSETS[n][0]
        const r = row + NEIGHBOR_OFFSETS[n][1]
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue
        const vecino = r * cols + c
        if (walkable[vecino] === 0) continue
        if (Math.abs(heights[idx] - heights[vecino]) > maxStep) continue
        links[idx] |= 1 << n
      }
    }
  }
  return links
}

interface ContextoBrushes {
  readonly convexes: Convex[]
  readonly grilla: ConvexGrid
  readonly buf: BuffersColumna
  readonly capsuleHeight: number
  readonly radio: number
  readonly minX: number
  readonly minZ: number
  /** Lado de la sub-celda del campo fino de alturas, metros. */
  readonly pasoFino: number
}

/** `aristaValida` en coordenadas de CELDA: traduce los dos centros a la
 *  retícula fina y elige cuántas muestras hacen falta. El paso entre muestras
 *  se mantiene por debajo del de una arista cardinal aunque la arista sea
 *  diagonal (un 41% más larga), para que el criterio no se afloje según la
 *  dirección. */
function aristaValidaEntreCeldas(
  ctx: ContextoBrushes,
  campo: CampoAlturas,
  sub: number,
  colA: number,
  rowA: number,
  colB: number,
  rowB: number,
): boolean {
  const centro = (sub - 1) >> 1
  const pasos = Math.ceil(sub * Math.hypot(colB - colA, rowB - rowA))
  return aristaValida(
    ctx,
    campo,
    colA * sub + centro,
    rowA * sub + centro,
    colB * sub + centro,
    rowB * sub + centro,
    pasos,
  )
}

function bakeLinksConvexos(
  ctx: ContextoBrushes,
  campo: CampoAlturas,
  walkable: Uint8Array,
  cols: number,
  rows: number,
  sub: number,
): Uint8Array {
  const links = new Uint8Array(cols * rows)

  // Cardinales primero: son los únicos que se calculan mirando el terreno.
  // Se escriben los dos sentidos de una, así que la simetría no depende de
  // que el predicado sea simétrico.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      if (walkable[idx] === 0) continue
      // Sólo Este (n=0) y Sur (n=2): el resto son los mismos pares vistos
      // desde la otra punta.
      for (let n = 0; n < 4; n += 2) {
        const c = col + NEIGHBOR_OFFSETS[n][0]
        const r = row + NEIGHBOR_OFFSETS[n][1]
        if (c >= cols || r >= rows) continue
        const vecino = r * cols + c
        if (walkable[vecino] === 0) continue
        if (!aristaValidaEntreCeldas(ctx, campo, sub, col, row, c, r)) continue
        links[idx] |= 1 << n
        links[vecino] |= 1 << ((n + 4) % 8)
      }
    }
  }

  // Diagonales: sólo si el bloque de 2x2 está enteramente conectado por
  // cardinales. No es una aproximación barata, es más estricto a propósito --
  // una diagonal que "pasa" por la esquina de dos paredes es un camino que la
  // física no deja recorrer (la cápsula mide 0.8 m de diámetro y la esquina
  // no tiene ancho), y en un mapa importado, lleno de marcos de puerta y
  // esquinas de casa, esa diagonal aparece por todos lados. En los mapas de
  // cajas no se aplica: sus carriles son anchos, nunca hizo falta, y cambiar
  // el criterio ahí movería la navegación de tres mapas que ya están
  // calibrados.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col
      if (walkable[idx] === 0) continue
      for (let n = 1; n < 8; n += 2) {
        const dCol = NEIGHBOR_OFFSETS[n][0]
        const dRow = NEIGHBOR_OFFSETS[n][1]
        const c = col + dCol
        const r = row + dRow
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue

        const horizontal = row * cols + c
        const vertical = r * cols + col
        const diagonal = r * cols + c

        const bitH = dCol > 0 ? 0 : 4
        const bitV = dRow > 0 ? 2 : 6
        // Los cuatro lados del cuadrado: ida por arriba e ida por abajo.
        if ((links[idx] & (1 << bitH)) === 0) continue
        if ((links[idx] & (1 << bitV)) === 0) continue
        if ((links[horizontal] & (1 << bitV)) === 0) continue
        if ((links[vertical] & (1 << bitH)) === 0) continue
        if (walkable[diagonal] === 0) continue
        // Y además la diagonal en sí: un tabique tendido justo sobre ella
        // deja los cuatro lados del cuadrado libres y el atajo cortado.
        if (!aristaValidaEntreCeldas(ctx, campo, sub, col, row, c, r)) continue

        links[idx] |= 1 << n
      }
    }
  }

  return links
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

/**
 * Submuestreo del campo de alturas en un mapa de brushes: cuántas muestras
 * por celda de navegación. Se despeja, no se elige (ver `aristaValida`):
 * el paso de muestreo tiene que ser <= MAX_ESCALON para que la rampa más
 * empinada que el bake acepta (45 grados) no se confunda con un escalón. Con
 * `cellSize` = 1 m y MAX_ESCALON = 0.35 m da 3.
 *
 * Se fuerza IMPAR para que el centro de la celda de navegación caiga
 * exactamente sobre el centro de una sub-celda -- si no, la altura de la
 * celda y la del perfil que la conecta saldrían de puntos distintos, y el
 * grafo podría prometer un tramo que arranca en otra altura de la que dice.
 */
function submuestreo(cellSize: number): number {
  const n = Math.max(1, Math.ceil(cellSize / MAX_ESCALON))
  return n % 2 === 0 ? n + 1 : n
}

/**
 * Hornea el navgrid de `map`. `cellSize` y `capsuleHeight` son parámetros
 * (no constantes leídas directo adentro) para que los tests puedan hornear
 * grids sintéticos chicos sin depender de BOTS ni de PLAYER_CAPSULE.
 */
export function buildNavGrid(
  map: MapDef,
  cellSize: number = BOTS.navCellSize,
  capsuleHeight: number = PLAYER_CAPSULE.height,
): NavGrid {
  const { bounds, boxes } = map
  const convexes = map.convexes ?? []
  const minX = bounds.min.x
  const minZ = bounds.min.z
  const cols = Math.max(1, Math.floor((bounds.max.x - minX) / cellSize))
  const rows = Math.max(1, Math.floor((bounds.max.z - minZ) / cellSize))
  const heights = new Float32Array(cols * rows)
  const walkable = new Uint8Array(cols * rows)
  const maxStepHeight = alturaFranqueable(map)

  if (convexes.length === 0) {
    for (let row = 0; row < rows; row++) {
      const z = minZ + (row + 0.5) * cellSize
      for (let col = 0; col < cols; col++) {
        const x = minX + (col + 0.5) * cellSize
        const h = surfaceHeight(boxes, x, z, capsuleHeight)
        const idx = row * cols + col
        if (h === null) {
          heights[idx] = NaN
          walkable[idx] = 0
        } else {
          heights[idx] = h
          walkable[idx] = 1
        }
      }
    }
    const links = bakeLinksCajas(heights, walkable, cols, rows, maxStepHeight)
    return { cellSize, minX, minZ, cols, rows, heights, walkable, links, maxStepHeight }
  }

  const sub = submuestreo(cellSize)
  const grilla = buildConvexGrid(convexes)
  const buf = crearBuffers(convexes.length)
  const campo = hornearCampoAlturas(
    convexes,
    grilla,
    buf,
    cols * sub,
    rows * sub,
    minX,
    minZ,
    cellSize / sub,
    capsuleHeight,
  )

  const ctx: ContextoBrushes = {
    convexes,
    grilla,
    buf,
    capsuleHeight,
    radio: PLAYER_CAPSULE.radius,
    minX,
    minZ,
    pasoFino: cellSize / sub,
  }

  const centro = (sub - 1) >> 1
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const subIdx = (row * sub + centro) * campo.cols + (col * sub + centro)
      const idx = row * cols + col
      heights[idx] = campo.h[subIdx]
      walkable[idx] = campo.w[subIdx]
      if (walkable[idx] === 0) continue

      // Segunda pasada, con el ANCHO de la cápsula. El campo de alturas mide
      // el mundo con una recta vertical; el bot es un cilindro de 80 cm. Una
      // celda cuyo centro tiene piso pero que está a 30 cm de una pared no es
      // un lugar donde alguien pueda pararse: la colisión lo empuja afuera y
      // el camino que pasaba por ahí no se puede seguir.
      if (
        cuerpoChoca(
          convexes,
          grilla,
          buf,
          minX + (col + 0.5) * cellSize,
          minZ + (row + 0.5) * cellSize,
          heights[idx],
          capsuleHeight,
          ctx.radio,
        )
      ) {
        heights[idx] = NaN
        walkable[idx] = 0
      }
    }
  }

  const links = bakeLinksConvexos(ctx, campo, walkable, cols, rows, sub)
  return { cellSize, minX, minZ, cols, rows, heights, walkable, links, maxStepHeight }
}

export function cellIndex(grid: NavGrid, col: number, row: number): number {
  return row * grid.cols + col
}

export function cellCol(grid: NavGrid, index: number): number {
  return index % grid.cols
}

export function cellRow(grid: NavGrid, index: number): number {
  return Math.floor(index / grid.cols)
}

export function cellCenterX(grid: NavGrid, col: number): number {
  return grid.minX + (col + 0.5) * grid.cellSize
}

export function cellCenterZ(grid: NavGrid, row: number): number {
  return grid.minZ + (row + 0.5) * grid.cellSize
}

/** Índice de celda bajo (x,z), o -1 si cae fuera del grid. Sin asignaciones:
 *  a diferencia de un worldToCell que devolviera {col,row}, esto es lo que
 *  usa el camino caliente de pathfinding (bots/pathfinding.ts). */
export function worldToCellIndex(grid: NavGrid, x: number, z: number): number {
  const col = Math.floor((x - grid.minX) / grid.cellSize)
  const row = Math.floor((z - grid.minZ) / grid.cellSize)
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return -1
  return row * grid.cols + col
}

/**
 * Igual que worldToCellIndex, pero si la celda exacta no es caminable busca
 * en espiral (hasta `maxRadius` celdas) la caminable más cercana. Hace falta
 * porque el punto de origen/destino real (posición del bot, del jugador) casi
 * nunca cae justo en el centro de una celda, y puede caer un pelo afuera del
 * polígono que el bake consideró caminable (ej. parado sobre el borde de una
 * repisa). Devuelve -1 si no encuentra ninguna dentro del radio.
 *
 * `mask` (opcional) restringe la búsqueda a un subconjunto de celdas -- lo
 * usa la red de patrulla con la máscara de buildMainComponentMask para no
 * plantar destinos arriba de un muro.
 */
export function nearestWalkableCellIndex(
  grid: NavGrid,
  x: number,
  z: number,
  maxRadius: number = 4,
  mask?: Uint8Array,
): number {
  const col0 = Math.floor((x - grid.minX) / grid.cellSize)
  const row0 = Math.floor((z - grid.minZ) / grid.cellSize)

  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dRow = -radius; dRow <= radius; dRow++) {
      const row = row0 + dRow
      if (row < 0 || row >= grid.rows) continue
      // Sólo el borde del anillo de este radio: los interiores ya se
      // visitaron en una vuelta anterior.
      const onEdgeRow = Math.abs(dRow) === radius
      for (let dCol = -radius; dCol <= radius; dCol++) {
        if (!onEdgeRow && Math.abs(dCol) !== radius) continue
        const col = col0 + dCol
        if (col < 0 || col >= grid.cols) continue
        const idx = row * grid.cols + col
        if (!grid.walkable[idx]) continue
        if (mask !== undefined && !mask[idx]) continue
        return idx
      }
    }
  }
  return -1
}

/** ¿La celda `index` está conectada con su vecino `n` (índice dentro de
 *  NEIGHBOR_OFFSETS)? Ésta es la consulta del camino caliente de A*, que ya
 *  itera por `n`: un AND contra el byte horneado.
 *
 *  Vuelve a mirar `walkable` aunque el bake ya garantice que ninguna arista
 *  sale de una celda no caminable: es una garantía barata (una lectura de
 *  byte) que sobrevive a que alguien marque celdas a mano después del bake,
 *  y "una celda no caminable no está conectada a nada" es de esas cosas que
 *  conviene que sean ciertas por definición y no por disciplina. */
export function cellLinkedTo(grid: NavGrid, index: number, n: number): boolean {
  return grid.walkable[index] !== 0 && (grid.links[index] & (1 << n)) !== 0
}

/**
 * ¿Están conectadas dos celdas? Lee la arista horneada (ver `NavGrid.links`):
 * el criterio real -- pendiente, escalones, perfil del terreno entre las dos
 * -- se resolvió en el bake, con la geometría del mapa delante. Devuelve
 * false si `indexB` no es uno de los ocho vecinos de `indexA`: "conectadas"
 * significa "hay una arista del grafo", no "existe algún camino".
 */
export function cellsConnected(grid: NavGrid, indexA: number, indexB: number): boolean {
  const colA = indexA % grid.cols
  const colB = indexB % grid.cols
  const dCol = colB - colA
  const dRow = (indexB - colB) / grid.cols - (indexA - colA) / grid.cols
  if (dCol < -1 || dCol > 1 || dRow < -1 || dRow > 1) return false
  const n = OFFSET_POR_DELTA[(dRow + 1) * 3 + (dCol + 1)]
  if (n < 0) return false
  return grid.walkable[indexB] !== 0 && cellLinkedTo(grid, indexA, n)
}

/**
 * Máscara del componente conexo MÁS GRANDE del grid: 1 en las celdas que se
 * alcanzan caminando desde cualquier otra celda del mismo componente, 0 en el
 * resto.
 *
 * Existe porque "caminable" y "alcanzable" no son lo mismo, y confundirlas
 * produce navegación degenerada. El bake marca caminable cualquier columna
 * con superficie pisable y espacio libre arriba -- eso incluye el TECHO de
 * los muros perimetrales y el de la cobertura alta, que son superficies
 * planas perfectamente paradas a las que nadie puede subir. En la arena eso
 * nunca molestó porque la retícula de patrulla (cada 10m) no caía encima de
 * ninguna por casualidad; en el mapa "torre" cayeron dos nodos sobre
 * cobertura bloqueante de 2.2m, y un bot que elige un destino imposible
 * quema una petición de camino por ciclo hasta que le toca otro nodo. En un
 * mapa importado deja de ser una curiosidad: nuketown es todo techos.
 *
 * Corre UNA vez por mapa (bake de la red de patrulla), nunca en frame: es un
 * flood fill sobre todo el grid usando las MISMAS aristas horneadas que
 * después recorre A*, así que la máscara no puede desincronizarse del
 * criterio real de conectividad.
 */
export function buildMainComponentMask(grid: NavGrid): Uint8Array {
  const total = grid.cols * grid.rows
  const componente = new Int32Array(total).fill(-1)
  const pila = new Int32Array(total)
  const mejor = { id: -1, tam: 0 }
  let idComponente = 0

  for (let inicio = 0; inicio < total; inicio++) {
    if (!grid.walkable[inicio] || componente[inicio] >= 0) continue

    let tope = 0
    pila[tope++] = inicio
    componente[inicio] = idComponente
    let tam = 0

    while (tope > 0) {
      const idx = pila[--tope]
      tam++
      const col = idx % grid.cols
      const row = (idx - col) / grid.cols
      for (let n = 0; n < NEIGHBOR_OFFSETS.length; n++) {
        const c = col + NEIGHBOR_OFFSETS[n][0]
        const r = row + NEIGHBOR_OFFSETS[n][1]
        if (c < 0 || c >= grid.cols || r < 0 || r >= grid.rows) continue
        const vecino = r * grid.cols + c
        if (componente[vecino] >= 0) continue
        if (!cellLinkedTo(grid, idx, n)) continue
        componente[vecino] = idComponente
        pila[tope++] = vecino
      }
    }

    if (tam > mejor.tam) {
      mejor.tam = tam
      mejor.id = idComponente
    }
    idComponente++
  }

  const mask = new Uint8Array(total)
  if (mejor.id < 0) return mask
  for (let i = 0; i < total; i++) {
    if (componente[i] === mejor.id) mask[i] = 1
  }
  return mask
}
