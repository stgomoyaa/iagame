import type { Box, Convex } from '@/game/map/types'
import type { Vec3 } from '@/game/math/vec3'
import { buildConvexGrid, queryConvexGrid, type ConvexGrid } from '@/game/physics/convex-grid'

export interface Capsule {
  radius: number
  /** Altura total, de los pies a la coronilla. */
  height: number
}

export const PLAYER_CAPSULE: Capsule = { radius: 0.4, height: 1.8 }

export interface MoveResult {
  /**
   * Edge-triggered, no de nivel: es `true` sólo en el tick en que la
   * corrección de penetración contra el suelo efectivamente disparó, no
   * mientras "el jugador está parado en el suelo". No hay ground probe: la
   * única señal de apoyo es esa corrección. Si el llamador deja de integrar
   * gravedad en `delta.y` al aterrizar, ya no hay penetración que corregir
   * tick a tick y `hitGround` vuelve a `false` en silencio aunque el
   * jugador siga quieto sobre el piso. Hay que seguir sumando gravedad a
   * `delta.y` todos los ticks, incluso estando apoyado, o el estado de "en
   * el suelo" queda obsoleto.
   */
  hitGround: boolean
  /** Edge-triggered igual que `hitGround`, pero para la corrección contra techo. */
  hitCeiling: boolean
  hitWall: boolean
}

/** Tolerancia para no re-resolver contactos de apoyo cada tick. */
const SKIN = 1e-4

/**
 * Techo de substeps por llamada. Cubre dos casos degenerados que si no,
 * cuelgan el loop: una cápsula con `radius <= 0` (maxPaso cae a 0 y
 * `distancia / maxPaso` se va a Infinity) y un delta con una magnitud
 * absurda. 64 es muy por encima de lo que cualquier movimiento legítimo
 * necesita a 128Hz (el caso de alta velocidad de los tests, a 40 m/s, sólo
 * pide 2 substeps con el radio del jugador), así que no toca ninguna
 * entrada normal.
 */
const MAX_SUBSTEPS = 64

/**
 * Altura máxima de un escalón que se sube caminando, en metros. Es el mismo
 * número que Source (18 unidades = 0.343 m), a propósito: los mapas
 * importados están construidos dando por sentado exactamente ese valor --
 * cordones de vereda, umbrales y escalones de porche caen justo debajo.
 */
const MAX_ESCALON = 0.35

/**
 * Componente Y mínima de la normal de una cara para considerarla PISABLE.
 * 0.7 es ~45 grados: más empinado que eso ya no es un escalón que se sube
 * sino una pared inclinada que se rodea.
 */
const NORMAL_MINIMA_PISABLE = 0.7

/**
 * Aproximamos la cápsula por su AABB envolvente. Para un mundo de cajas
 * alineadas a los ejes la diferencia visible es nula, y evita el costo de
 * calcular el punto más cercano del segmento capsular por caja.
 */
function overlapAndResolve(
  position: Vec3,
  capsule: Capsule,
  b: Box,
  out: MoveResult,
): void {
  const minX = position.x - capsule.radius
  const maxX = position.x + capsule.radius
  const minY = position.y
  const maxY = position.y + capsule.height
  const minZ = position.z - capsule.radius
  const maxZ = position.z + capsule.radius

  const overlapX = Math.min(maxX, b.max.x) - Math.max(minX, b.min.x)
  if (overlapX <= SKIN) return
  const overlapY = Math.min(maxY, b.max.y) - Math.max(minY, b.min.y)
  if (overlapY <= SKIN) return
  const overlapZ = Math.min(maxZ, b.max.z) - Math.max(minZ, b.min.z)
  if (overlapZ <= SKIN) return

  // Empujar por el eje de menor penetración.
  if (overlapY <= overlapX && overlapY <= overlapZ) {
    const centroY = position.y + capsule.height * 0.5
    const cajaCentroY = (b.min.y + b.max.y) * 0.5
    if (centroY >= cajaCentroY) {
      position.y += overlapY
      out.hitGround = true
    } else {
      position.y -= overlapY
      out.hitCeiling = true
    }
    return
  }

  if (overlapX <= overlapZ) {
    position.x += position.x >= (b.min.x + b.max.x) * 0.5 ? overlapX : -overlapX
  } else {
    position.z += position.z >= (b.min.z + b.max.z) * 0.5 ? overlapZ : -overlapZ
  }
  out.hitWall = true
}

/**
 * Cápsula = segmento AB (los centros de las dos semiesferas) con radio r.
 * Cuerpo convexo = intersección de semiespacios `dot(n, p) <= d`. Para cada
 * plano, el punto del segmento más cerca de "salir" por ese plano es el que
 * minimiza dot(n, p) -- como el segmento es siempre vertical acá (A y B
 * comparten x,z; sólo difieren en y), es lineal proyectar los dos extremos y
 * quedarse con el menor. La penetración por ese plano es `d + r - minSeg`:
 * si es <= 0 el plano separa (no hay contacto posible, el cuerpo entero
 * queda del otro lado); si todas son positivas, el cuerpo está en contacto y
 * se empuja afuera por el plano de MENOR penetración positiva.
 *
 * Por qué esto sube rampas: en una rampa inclinada el plano de menor
 * penetración es el de la rampa (no un piso ni techo imaginario), así que el
 * empuje sale por su normal inclinada y la cápsula resbala hacia arriba en
 * vez de trabarse contra un escalón invisible.
 *
 * Limitación conocida y aceptada: tratar el cuerpo como intersección pura de
 * planos, sin redondear con el radio, sobreestima el volumen sólido cerca de
 * aristas y vértices convexos (la suma de Minkowski real con una esfera
 * tiene esquinas redondeadas; esto las deja en punta). El efecto es un
 * colchón invisible de hasta `r` en aristas convexas -- falla del lado de
 * chocar de más, nunca de atravesar, y es lo que hacen varios motores. No se
 * resuelve el caso exacto de arista/vértice acá.
 */
function overlapAndResolveConvex(
  position: Vec3,
  capsule: Capsule,
  convex: Convex,
  out: MoveResult,
): void {
  const r = capsule.radius

  // Descarte rápido con la caja envolvente, antes de tocar los planos.
  if (position.x - r > convex.max.x || position.x + r < convex.min.x) return
  if (position.y > convex.max.y || position.y + capsule.height < convex.min.y) return
  if (position.z - r > convex.max.z || position.z + r < convex.min.z) return

  const count = convex.count
  if (count === 0) return

  // `position` es el punto de los pies (igual convención que
  // overlapAndResolve). El segmento va de pies+r a pies+height-r. Si el
  // radio es tan grande que no entra un segmento (height < 2r), colapsa a
  // un punto en el centro vertical -- degenera a esfera, no revienta.
  const halfSpan = Math.max(capsule.height * 0.5 - r, 0)
  const centerY = position.y + capsule.height * 0.5
  const ay = centerY - halfSpan
  const by = centerY + halfSpan

  const planes = convex.planes
  let minPenetracion = Infinity
  let nx = 0
  let ny = 0
  let nz = 0

  // Mejor candidato a ESCALÓN: de las caras pisables que están a menos de
  // MAX_ESCALON por encima de los pies, la menos penetrada. Ver abajo.
  let escalonPenetracion = Infinity
  let escalonNx = 0
  let escalonNy = 0
  let escalonNz = 0

  for (let i = 0; i < count; i++) {
    const base = i * 4
    const pnx = planes[base]
    const pny = planes[base + 1]
    const pnz = planes[base + 2]
    const d = planes[base + 3]

    const dotA = pnx * position.x + pny * ay + pnz * position.z
    const dotB = pnx * position.x + pny * by + pnz * position.z
    const minSeg = dotA < dotB ? dotA : dotB
    const penetracion = d + r - minSeg

    // Mismo umbral SKIN que overlapAndResolve: evita re-resolver contactos
    // de apoyo en reposo (penetración de punto flotante ~0) cada tick.
    if (penetracion <= SKIN) return

    if (penetracion < minPenetracion) {
      minPenetracion = penetracion
      nx = pnx
      ny = pny
      nz = pnz
    }

    if (
      pny >= NORMAL_MINIMA_PISABLE &&
      penetracion <= MAX_ESCALON &&
      penetracion < escalonPenetracion
    ) {
      escalonPenetracion = penetracion
      escalonNx = pnx
      escalonNy = pny
      escalonNz = pnz
    }
  }

  // ESCALÓN. Con "empujar por el plano de menor penetración" a secas, un
  // cordón de vereda de 8 cm es un muro infranqueable: caminando a 128 Hz
  // cada tick acumula ~3.5 cm de penetración horizontal, SIEMPRE menos que
  // los 8 cm de la cara de arriba, así que el empuje sale de costado tick
  // tras tick y el jugador nunca sube. Medido en nuketown: al pasar del
  // asfalto a la vereda la posición se clavaba.
  //
  // Entonces: cuando el empuje natural sería de PARED pero el cuerpo tiene
  // una cara pisable a menos de MAX_ESCALON por encima de los pies, se
  // empuja por esa cara y el jugador sube el escalón. Es lo mismo que hace
  // Source, y por eso sus mapas se construyen dándolo por sentado.
  //
  // Un muro de verdad no entra: la penetración de su cara de arriba es su
  // altura entera sobre los pies, muy por encima de MAX_ESCALON
  // (capsule.test.ts lo verifica con un muro de 2 m). Y esto sólo afecta a
  // los cuerpos convexos: los tres mapas escritos en código no tienen
  // ninguno y siguen pasando por overlapAndResolve, que no cambió.
  if (escalonPenetracion < Infinity && Math.abs(ny) <= Math.hypot(nx, nz)) {
    minPenetracion = escalonPenetracion
    nx = escalonNx
    ny = escalonNy
    nz = escalonNz
  }

  position.x += nx * minPenetracion
  position.y += ny * minPenetracion
  position.z += nz * minPenetracion

  // Piso/techo sólo si el empuje es más vertical que horizontal; si no, es
  // pared (incluye rampas empinadas -- qué ángulo es "caminable" lo decide
  // la tarea de integración con el navgrid, no ésta).
  const horizontal = Math.hypot(nx, nz)
  if (Math.abs(ny) > horizontal) {
    if (ny > 0) out.hitGround = true
    else out.hitCeiling = true
  } else {
    out.hitWall = true
  }
}

// Scratch de capsuleOverlapsConvex. A nivel de módulo y no dentro de la
// función para no asignar por llamada: validar los spawns de un mapa
// importado la llama 32 x 1467 veces.
const scratchPos: Vec3 = { x: 0, y: 0, z: 0 }
const scratchOut: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }

/**
 * ¿La cápsula parada en `position` está dentro de `convex`?
 *
 * No reimplementa el test de solapamiento: corre el MISMO
 * overlapAndResolveConvex que usa la colisión real sobre una copia
 * descartable de la posición, y mira si empujó. Un predicado escrito aparte
 * se desincronizaría del resolvedor al primer ajuste de umbrales, y ahí
 * "este spawn es válido" dejaría de significar "acá el jugador no queda
 * trabado", que es la única razón por la que existe esta función.
 *
 * No es para el camino de frame: valida spawns una vez al cargar el mapa.
 */
export function capsuleOverlapsConvex(
  position: Vec3,
  capsule: Capsule,
  convex: Convex,
): boolean {
  scratchPos.x = position.x
  scratchPos.y = position.y
  scratchPos.z = position.z
  scratchOut.hitGround = false
  scratchOut.hitCeiling = false
  scratchOut.hitWall = false
  overlapAndResolveConvex(scratchPos, capsule, convex, scratchOut)
  return scratchOut.hitGround || scratchOut.hitCeiling || scratchOut.hitWall
}

/**
 * Grilla de descarte espacial por lista de convexos, construida la primera
 * vez que esa lista llega a resolveMove.
 *
 * La cache va acá adentro y NO en `MapDef` a propósito: cómo se acelera la
 * consulta es asunto de la física, no del que define un mapa ni de los ~45
 * llamadores de stepPlayer, que no tendrían por qué aprender a pasar un
 * índice espacial. WeakMap y no Map para que un mapa descargado no quede
 * retenido por su grilla.
 *
 * El contrato que esto asume es que una lista de convexos NO se muta después
 * de usarla (los mapas se arman una vez al cargar y no cambian). Una lista
 * mutada seguiría consultando la grilla vieja.
 */
const grillaPorLista = new WeakMap<Convex[], ConvexGrid>()

/** Umbral de brushes a partir del cual conviene la grilla. Por debajo, el
 *  recorrido lineal es más barato que la consulta -- los tests de física y
 *  cualquier mapa chico no pagan nada. */
const MIN_CONVEXOS_PARA_GRILLA = 64

/** Resultado reusado de la consulta de broadphase: se vacía y se vuelve a
 *  llenar en cada llamada, nunca se reasigna (cero asignaciones por tick). */
const convexosCercanos: Convex[] = []

export function resolveMove(
  position: Vec3,
  delta: Vec3,
  capsule: Capsule,
  boxes: Box[],
  convexes: Convex[],
  out: MoveResult,
): void {
  out.hitGround = false
  out.hitCeiling = false
  out.hitWall = false

  const distancia = Math.hypot(delta.x, delta.y, delta.z)
  // Un delta no finito (NaN o Infinity) corrompería position para siempre:
  // nada más adelante la resetea. Mismo bug ya resuelto en fixed-loop.ts
  // (commits 0cfde05, 746fce3); acá se corta antes de tocar la posición,
  // con las flags ya en false por el reset de arriba.
  if (!Number.isFinite(distancia)) return

  const maxPaso = capsule.radius * 0.5
  const substepsCrudos = distancia > maxPaso ? Math.ceil(distancia / maxPaso) : 1
  const substeps = Math.min(Math.max(substepsCrudos, 1), MAX_SUBSTEPS)
  const inv = 1 / substeps

  const stepX = delta.x * inv
  const stepY = delta.y * inv
  const stepZ = delta.z * inv

  // Broadphase: con un mapa importado, mirar los 1467 brushes por substep y
  // por entidad se comía el presupuesto entero de CPU (ver physics/
  // convex-grid.ts). La consulta se hace UNA vez por llamada, con la caja
  // que cubre todo el barrido de este tick -- no por substep: el barrido de
  // un tick a 128 Hz mide centímetros, así que acotarlo más no descarta casi
  // nada y sí costaría una consulta por substep.
  let cercanos = convexes
  let cercanosCount = convexes.length
  if (convexes.length >= MIN_CONVEXOS_PARA_GRILLA) {
    let grilla = grillaPorLista.get(convexes)
    if (grilla === undefined) {
      grilla = buildConvexGrid(convexes)
      grillaPorLista.set(convexes, grilla)
    }
    const r = capsule.radius
    const x0 = position.x - r + (delta.x < 0 ? delta.x : 0)
    const x1 = position.x + r + (delta.x > 0 ? delta.x : 0)
    const z0 = position.z - r + (delta.z < 0 ? delta.z : 0)
    const z1 = position.z + r + (delta.z > 0 ? delta.z : 0)
    cercanosCount = queryConvexGrid(grilla, convexes, x0, x1, z0, z1, convexosCercanos)
    cercanos = convexosCercanos
  }

  for (let s = 0; s < substeps; s++) {
    position.x += stepX
    position.y += stepY
    position.z += stepZ

    // Dos pasadas: la primera resuelve la penetración dominante, la segunda
    // limpia las que aparecen al haber movido la cápsula en la primera. Las
    // cajas van primero por ser la ruta rápida y, hoy, la mayoría del
    // volumen de cualquier mapa (ver brief de la tarea); el orden entre
    // cajas y convexos dentro de una misma pasada no cambia el resultado
    // final, la segunda pasada limpia cualquier penetración cruzada.
    for (let pasada = 0; pasada < 2; pasada++) {
      for (let i = 0; i < boxes.length; i++) {
        overlapAndResolve(position, capsule, boxes[i], out)
      }
      for (let i = 0; i < cercanosCount; i++) {
        overlapAndResolveConvex(position, capsule, cercanos[i], out)
      }
    }
  }
}
