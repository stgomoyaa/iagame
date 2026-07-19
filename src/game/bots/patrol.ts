/**
 * Red de patrulla: los destinos que un bot sin contacto elige para CRUZAR el
 * mapa en vez de quedarse quieto (sección 8 del spec, estado Idle).
 *
 * El problema real que resuelve, medido jugando una partida TDM completa de
 * 6 minutos: Idle no movía al bot, sólo giraba la mira en el lugar. Un bot
 * que perdía contacto se congelaba donde estaba y esperaba a que alguien
 * entrara en su cono. En FFA la densidad de enemigos por bot es el doble y
 * el contacto ocurre igual por accidente; en TDM (mitad de enemigos, los
 * compañeros no cuentan) la cadena de contacto se corta y la partida muere:
 * 1 kill total y 7 de 8 bots en Idle simultáneo el resto de la partida.
 *
 * Por qué una red de nodos horneada del navgrid y no un rumbo al azar:
 *
 * - Un paseo aleatorio no garantiza encuentro: dos caminantes al azar en una
 *   arena de 60x60 pueden no cruzarse nunca dentro de una partida. La
 *   patrulla necesita SESGO, no ruido.
 * - Los nodos salen del propio navgrid (una retícula gruesa de celdas
 *   caminables), no de una lista escrita a mano por mapa: cualquier mapa
 *   futuro hereda la patrulla sin tocar este archivo.
 * - La elección prefiere nodos LEJOS del bot (`patrolMinTravelM`) y con
 *   sesgo hacia el CENTRO del mapa (`patrolCenterBias`). Ese par es lo que
 *   produce contacto de verdad: en una arena con carriles separados, todo
 *   viaje largo de un lado al otro tiene que pasar por la banda central --
 *   los caminos de A* de dos bots que patrullan lados opuestos se cruzan
 *   ahí, no por suerte sino por geometría. El sesgo al centro además hace
 *   que el punto más disputado del mapa sea el más visitado, que es donde un
 *   jugador espera encontrar pelea.
 * - El jitter determinista por bot (`patrolJitterM`) evita que los ocho bots
 *   elijan literalmente el mismo nodo y marchen en fila india. No es
 *   aleatoriedad de partida: es un hash de (id del bot, nodo), así que la
 *   misma partida se reproduce igual, y NO toca el RNG del apuntado
 *   (bots/aim.ts) -- mezclar los dos cambiaría la secuencia de error de
 *   puntería, que es una de las tres perillas de dificultad.
 *
 * Nada de esto usa información que el bot no podría tener: es la forma del
 * mapa, que un jugador también conoce después de dos partidas. Las
 * posiciones vivas de los enemigos NO entran acá.
 */

import {
  cellCenterX,
  cellCenterZ,
  cellCol,
  cellRow,
  nearestWalkableCellIndex,
  type NavGrid,
} from '@/game/bots/navgrid'
import { BOTS } from '@/game/bots/tuning'

export interface PatrolGraph {
  /** Cantidad real de nodos (los arrays tienen capacidad >= count). */
  readonly count: number
  readonly x: Float32Array
  readonly z: Float32Array
  /** Índice de celda del navgrid de cada nodo -- lo que come requestPathTo. */
  readonly cell: Int32Array
  /** Centro caminable del mapa: referencia del sesgo de "zona disputada". */
  readonly centerX: number
  readonly centerZ: number
}

const EMPTY_GRAPH: PatrolGraph = {
  count: 0,
  x: new Float32Array(0),
  z: new Float32Array(0),
  cell: new Int32Array(0),
  centerX: 0,
  centerZ: 0,
}

/**
 * Hornea la red de patrulla de `grid`: una retícula de puntos cada
 * `spacingM` metros, cada uno llevado a la celda caminable más cercana y sin
 * repetir celdas. Se llama UNA vez por mapa (bots/bot.ts createBotWorld),
 * nunca en el camino de frame ni en el tick de IA.
 */
export function buildPatrolGraph(grid: NavGrid, spacingM: number = BOTS.patrolNodeSpacingM): PatrolGraph {
  const stride = Math.max(1, Math.round(spacingM / grid.cellSize))
  const capacity = Math.ceil(grid.cols / stride) * Math.ceil(grid.rows / stride)
  if (capacity === 0) return EMPTY_GRAPH

  const x = new Float32Array(capacity)
  const z = new Float32Array(capacity)
  const cell = new Int32Array(capacity)
  let count = 0

  // Media retícula de desfase (stride/2): así los nodos caen en el MEDIO de
  // cada bloque de celdas y no pegados al borde del mapa, donde casi siempre
  // hay muro y nearestWalkableCellIndex tendría que rescatarlos hacia
  // adentro colapsando varios al mismo lugar.
  const offset = Math.floor(stride / 2)

  for (let row = offset; row < grid.rows; row += stride) {
    for (let col = offset; col < grid.cols; col += stride) {
      const wx = cellCenterX(grid, col)
      const wz = cellCenterZ(grid, row)
      const idx = nearestWalkableCellIndex(grid, wx, wz)
      if (idx < 0) continue

      let repeated = false
      for (let i = 0; i < count; i++) {
        if (cell[i] === idx) {
          repeated = true
          break
        }
      }
      if (repeated) continue

      cell[count] = idx
      x[count] = cellCenterX(grid, cellCol(grid, idx))
      z[count] = cellCenterZ(grid, cellRow(grid, idx))
      count++
    }
  }

  const centerCol = Math.floor(grid.cols / 2)
  const centerRow = Math.floor(grid.rows / 2)
  const centerIdx = nearestWalkableCellIndex(
    grid,
    cellCenterX(grid, centerCol),
    cellCenterZ(grid, centerRow),
  )
  const centerX = centerIdx >= 0 ? cellCenterX(grid, cellCol(grid, centerIdx)) : cellCenterX(grid, centerCol)
  const centerZ = centerIdx >= 0 ? cellCenterZ(grid, cellRow(grid, centerIdx)) : cellCenterZ(grid, centerRow)

  return { count, x, z, cell, centerX, centerZ }
}

/**
 * Jitter determinista en [0,1) a partir de (seed, nodo). Hash entero simple
 * (mismo espíritu que cualquier hash de ruido de juego): sin estado, sin
 * asignaciones, reproducible entre partidas y sin tocar el RNG del apuntado.
 */
function hash01(seed: number, node: number): number {
  let h = (seed * 0x27d4eb2d) ^ (node * 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 0x100000000
}

/**
 * Elige el próximo nodo de patrulla para un bot parado en (fromX, fromZ).
 * Devuelve el índice de nodo dentro de `graph`, o -1 si la red está vacía.
 *
 * Puntaje (mayor gana):
 *   distancia al bot  -  patrolCenterBias * distancia al centro  +  jitter
 *
 * `excludeNode` (el nodo que se acaba de visitar o que falló) queda fuera
 * para que la patrulla nunca rebote entre dos puntos ni se atasque pidiendo
 * el mismo destino imposible. Los nodos a menos de `patrolMinTravelM` del
 * bot también quedan fuera: un destino a tres metros no es patrullar, y
 * dejaría al bot vibrando en su rincón, que es exactamente el
 * comportamiento que esta tarea viene a matar. Si TODOS quedan excluidos
 * por cercanía (mapas chicos), se relaja el mínimo antes que devolver -1.
 */
export function pickPatrolNode(
  graph: PatrolGraph,
  fromX: number,
  fromZ: number,
  excludeNode: number,
  seed: number,
): number {
  if (graph.count === 0) return -1

  let best = -1
  let bestScore = -Infinity
  let fallback = -1
  let fallbackScore = -Infinity

  for (let i = 0; i < graph.count; i++) {
    if (i === excludeNode) continue

    const dx = graph.x[i] - fromX
    const dz = graph.z[i] - fromZ
    const dist = Math.hypot(dx, dz)

    const cdx = graph.x[i] - graph.centerX
    const cdz = graph.z[i] - graph.centerZ
    const distToCenter = Math.hypot(cdx, cdz)

    // La distancia SATURA en patrolPreferredTravelM. Sin saturar, "lo más
    // lejos posible" domina cualquier otro término (en una arena de 60x60 la
    // diferencia de distancia entre dos candidatos llega a 40m, contra 15m
    // de sesgo al centro) y la patrulla degenera en un péndulo entre las dos
    // esquinas opuestas: siempre el mismo viaje, siempre por el mismo
    // diagonal. Saturada, todo lo que esté "suficientemente lejos" empata en
    // este término y quienes deciden son el sesgo al centro y el jitter --
    // que es justo lo que queremos que decida.
    const travel = Math.min(dist, BOTS.patrolPreferredTravelM)
    const score =
      travel -
      BOTS.patrolCenterBias * distToCenter +
      hash01(seed, i) * BOTS.patrolJitterM

    if (score > fallbackScore) {
      fallbackScore = score
      fallback = i
    }
    if (dist < BOTS.patrolMinTravelM) continue
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }

  return best >= 0 ? best : fallback
}

/** Índice del nodo de patrulla más cercano a (x,z), o -1 si la red está
 *  vacía. Sirve para marcar "acabo de estar acá" cuando un bot entra en
 *  Idle en un punto cualquiera del mapa (no necesariamente sobre un nodo) y
 *  no queremos que su primer destino sea el pedazo de suelo que ya pisa. */
export function nearestPatrolNode(graph: PatrolGraph, x: number, z: number): number {
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < graph.count; i++) {
    const d = Math.hypot(graph.x[i] - x, graph.z[i] - z)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}
