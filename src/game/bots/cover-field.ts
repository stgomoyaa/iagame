/**
 * Campo de distancia a cobertura para mapas IMPORTADOS de Source.
 *
 * El problema que resuelve
 * ------------------------
 * `bots/cover.ts nearestCoverDistanceXZ` recorre `MapDef.boxes`. En un mapa
 * importado esa lista va VACÍA (la geometría son brushes convexos), así que
 * devuelve Infinity para cualquier punto. Y el modo de falla no es "el bot no
 * encuentra cobertura" sino algo peor: la condición del strafe evalúa
 * `Infinity <= Infinity + holgura`, que es SIEMPRE verdadera. El chequeo que
 * debería frenar al bot antes de salir a campo abierto no frena nada. En
 * nuketown los bots no ignoran la cobertura: no la ven, y el freno está
 * soldado en "pasa".
 *
 * Por qué NO alcanza "distancia a celda no caminable"
 * ---------------------------------------------------
 * La propuesta obvia (y la que veníamos arrastrando) es hornear la distancia
 * a la celda no caminable más cercana del navgrid. MEDIDO sobre nuketown, en
 * los 32 spawns del mapa -- que es donde los bots de verdad están:
 *
 *   distancia a celda no caminable   p25=2.00  p50=2.83  p75=4.00  max=5.00
 *   este campo (sonda de geometría)  p25=3.06  p50=4.31  p75=6.27  max=11.00
 *
 * La aproximación por navegabilidad SATURA: da como mucho 5 m en todo el
 * mapa, porque "no caminable" incluye el borde de cualquier escalón, el
 * hueco entre dos props y el anillo de celdas que el bake marca inservibles
 * sólo porque la cápsula (radio 40 cm) roza algo. Nada de eso te tapa de un
 * disparo. Un campo que vale 2-5 m en todas partes es casi una constante, y
 * un gradiente casi constante no puede guiar a nadie hacia ningún lado.
 *
 * Qué mide este campo en cambio
 * ------------------------------
 * "Cobertura" = hay geometría SÓLIDA a la altura del torso de quien mira.
 * Se sondea el mapa real (los mismos brushes con los que choca el jugador) a
 * `alturaSondaM` sobre el SUELO LOCAL, y se hornea la distancia a la sonda
 * sólida más cercana. Un borde de escalón de 35 cm no es cobertura porque a
 * 90 cm sobre ese suelo hay aire; una casa, un muro o un cajón de 1,2 m sí,
 * porque a 90 cm hay ladrillo. Es la diferencia entre "acá no puedo caminar"
 * y "acá no me pueden pegar un tiro", que es la que importa.
 *
 * El suelo de referencia es el de QUIEN MIRA, no el del obstáculo: la
 * cobertura tapa la línea hacia MI torso. Se propaga por BFS desde las
 * celdas jugables del navgrid, así que el interior de un muro hereda la
 * altura del piso que tiene al lado.
 *
 * Costo
 * -----
 * Se hornea UNA VEZ por mapa (~50 ms de sondeo + dos pasadas de chamfer
 * sobre la lattice en nuketown). En frame no asigna nada: `coverDistanceAt`
 * son dos divisiones y una lectura de Float32Array.
 */

import type { Box, Convex } from '@/game/map/types'
import { buildConvexGrid, queryConvexGrid, type ConvexGrid } from '@/game/physics/convex-grid'
import { cellCenterX, cellCenterZ, type NavGrid } from '@/game/bots/navgrid'
import { BOTS } from '@/game/bots/tuning'

export interface CoverField {
  /** Lado de la lattice, metros. Más fina que la del navgrid a propósito:
   *  con 1 m se pierden los muros delgados, porque la sonda cae en el centro
   *  de la celda y el centro de una celda pegada a un muro suele estar del
   *  lado del aire. */
  readonly paso: number
  readonly minX: number
  readonly minZ: number
  readonly cols: number
  readonly rows: number
  /** Distancia en METROS a la sonda sólida más cercana, indexada
   *  row*cols+col. Nunca Infinity: si el mapa no tuviera ni una sonda sólida
   *  el campo no se hornea (buildCoverField devuelve null). */
  readonly dist: Float32Array
}

/** Costo diagonal del chamfer. Con (1, √2) el error contra la distancia
 *  euclídea real queda por debajo del 4%, de sobra para un gradiente que
 *  sólo se usa para comparar dos candidatos de strafe. */
const DIAGONAL = Math.SQRT2

/** ¿Hay geometría sólida en este punto? Mismo criterio que la colisión: el
 *  interior de un brush es donde dot(n, p) <= d para TODOS sus planos. */
function puntoSolido(
  convexes: readonly Convex[],
  grilla: ConvexGrid,
  buf: Convex[],
  boxes: readonly Box[],
  x: number,
  y: number,
  z: number,
): boolean {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (x >= b.min.x && x <= b.max.x && y >= b.min.y && y <= b.max.y && z >= b.min.z && z <= b.max.z) {
      return true
    }
  }

  const n = queryConvexGrid(grilla, convexes, x, x, z, z, buf)
  for (let i = 0; i < n; i++) {
    const c = buf[i]
    // Descarte por caja envolvente antes de mirar los planos: un brush de
    // nuketown tiene 6-20 planos y la lattice son cientos de miles de sondas.
    if (x < c.min.x || x > c.max.x || y < c.min.y || y > c.max.y || z < c.min.z || z > c.max.z) continue
    let dentro = true
    for (let p = 0; p < c.count; p++) {
      const o = p * 4
      if (c.planes[o] * x + c.planes[o + 1] * y + c.planes[o + 2] * z > c.planes[o + 3]) {
        dentro = false
        break
      }
    }
    if (dentro) return true
  }
  return false
}

/**
 * ¿La lista de cajas ya ofrece cobertura utilizable? Es la condición exacta
 * que hace ciego a `nearestCoverDistanceXZ`: si alguna caja califica por
 * altura, ese camino ya responde bien y este campo NO se hornea.
 *
 * Es lo que garantiza POR CONSTRUCCIÓN que los tres mapas escritos en código
 * (arena, torre, búnker) no cambien ni un número: ahí siempre hay cajas que
 * califican, así que nunca llegan a tener campo.
 */
function hayCoberturaEnCajas(boxes: readonly Box[], minHeightM: number): boolean {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (b.max.y - Math.max(b.min.y, 0) >= minHeightM) return true
  }
  return false
}

/**
 * Hornea el campo, o devuelve null si este mapa no lo necesita (ver
 * `hayCoberturaEnCajas`) o si no hay con qué construirlo.
 *
 * `jugable` es la máscara del componente alcanzable (navgrid
 * buildMainComponentMask): el suelo de referencia se siembra SÓLO desde ahí.
 * Importa mucho -- el bake del navgrid marca caminable bastante superficie
 * fuera de la zona jugable (en nuketown, un plano enorme 12 m por debajo del
 * mapa), y sembrar desde ahí metería alturas de referencia que no
 * corresponden a ningún lugar donde alguien pelea.
 */
export function buildCoverField(
  boxes: readonly Box[],
  convexes: readonly Convex[],
  grid: NavGrid,
  jugable: Uint8Array,
): CoverField | null {
  if (hayCoberturaEnCajas(boxes, BOTS.coverMinHeightM)) return null
  if (convexes.length === 0 && boxes.length === 0) return null

  const paso = BOTS.coverFieldCellSizeM
  const cols = Math.max(1, Math.ceil((grid.cols * grid.cellSize) / paso))
  const rows = Math.max(1, Math.ceil((grid.rows * grid.cellSize) / paso))
  const total = cols * rows

  // --- Suelo de referencia, por BFS multi-fuente desde las celdas jugables.
  const suelo = new Float32Array(total).fill(NaN)
  const cola = new Int32Array(total)
  let cabeza = 0
  let fin = 0

  const celdasNav = grid.cols * grid.rows
  for (let i = 0; i < celdasNav; i++) {
    if (!jugable[i]) continue
    const x = cellCenterX(grid, i % grid.cols)
    const z = cellCenterZ(grid, Math.floor(i / grid.cols))
    const c = Math.min(cols - 1, Math.max(0, Math.round((x - grid.minX) / paso)))
    const r = Math.min(rows - 1, Math.max(0, Math.round((z - grid.minZ) / paso)))
    const j = r * cols + c
    if (Number.isNaN(suelo[j])) {
      suelo[j] = grid.heights[i]
      cola[fin++] = j
    }
  }
  if (fin === 0) return null

  while (cabeza < fin) {
    const j = cola[cabeza++]
    const jc = j % cols
    const jr = (j / cols) | 0
    for (let d = 0; d < 4; d++) {
      const nc = jc + (d === 0 ? 1 : d === 1 ? -1 : 0)
      const nr = jr + (d === 2 ? 1 : d === 3 ? -1 : 0)
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
      const k = nr * cols + nc
      if (!Number.isNaN(suelo[k])) continue
      suelo[k] = suelo[j]
      cola[fin++] = k
    }
  }

  // --- Sonda de solidez a la altura del torso sobre ese suelo.
  const grilla = buildConvexGrid(convexes)
  const buf: Convex[] = []
  const dist = new Float32Array(total)
  const INFINITO = 1e9
  let solidas = 0

  for (let r = 0; r < rows; r++) {
    const z = grid.minZ + (r + 0.5) * paso
    for (let c = 0; c < cols; c++) {
      const j = r * cols + c
      const g = suelo[j]
      if (Number.isNaN(g)) {
        dist[j] = INFINITO
        continue
      }
      const x = grid.minX + (c + 0.5) * paso
      if (puntoSolido(convexes, grilla, buf, boxes, x, g + BOTS.coverProbeHeightM, z)) {
        dist[j] = 0
        solidas++
      } else {
        dist[j] = INFINITO
      }
    }
  }

  // Un mapa sin una sola sonda sólida no tiene cobertura que ofrecer. Mejor
  // no hornear que devolver un campo constante que mentiría con cara seria.
  if (solidas === 0) return null

  // --- Transformada de distancia de chamfer, dos pasadas.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const j = r * cols + c
      let d = dist[j]
      if (d === 0) continue
      if (c > 0) d = Math.min(d, dist[j - 1] + 1)
      if (r > 0) d = Math.min(d, dist[j - cols] + 1)
      if (c > 0 && r > 0) d = Math.min(d, dist[j - cols - 1] + DIAGONAL)
      if (c < cols - 1 && r > 0) d = Math.min(d, dist[j - cols + 1] + DIAGONAL)
      dist[j] = d
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const j = r * cols + c
      let d = dist[j]
      if (d === 0) continue
      if (c < cols - 1) d = Math.min(d, dist[j + 1] + 1)
      if (r < rows - 1) d = Math.min(d, dist[j + cols] + 1)
      if (c < cols - 1 && r < rows - 1) d = Math.min(d, dist[j + cols + 1] + DIAGONAL)
      if (c > 0 && r < rows - 1) d = Math.min(d, dist[j + cols - 1] + DIAGONAL)
      dist[j] = d
    }
  }

  for (let j = 0; j < total; j++) dist[j] *= paso

  return { paso, minX: grid.minX, minZ: grid.minZ, cols, rows, dist }
}

/**
 * Distancia (metros) a la cobertura más cercana desde (x,z). O(1) y sin
 * asignar nada: corre en el tick de IA.
 *
 * Fuera de la lattice se devuelve el valor del BORDE, no Infinity. Es
 * deliberado: Infinity es exactamente el veneno que hacía inerte el chequeo
 * del strafe (`Infinity <= Infinity + holgura` siempre pasa), y un bot que
 * se salió del área horneada no es un bot que esté a salvo.
 */
export function coverDistanceAt(field: CoverField, x: number, z: number): number {
  const c = Math.min(field.cols - 1, Math.max(0, Math.floor((x - field.minX) / field.paso)))
  const r = Math.min(field.rows - 1, Math.max(0, Math.floor((z - field.minZ) / field.paso)))
  return field.dist[r * field.cols + c]
}
