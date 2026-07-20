/**
 * A* sobre el navgrid (bots/navgrid.ts), con caché (sección 8 del spec:
 * "Pathfinding A* con caché, ejecutado en el tick de IA a 15Hz, no por
 * frame"). El propio A* corre sobre buffers preasignados UNA vez por grid
 * (createPathfindingContext) y reusados en cada búsqueda -- nunca asigna un
 * array nuevo por búsqueda, sólo avanza un contador de "generación" para
 * saber qué celdas tocó esta vez sin tener que limpiar los buffers enteros
 * (el mismo truco que usa cualquier A* de juego con grids grandes).
 *
 * La caché sí asigna (un array de índices de celda por entrada nueva, más el
 * overhead del Map): a propósito -- corre en el tick de IA a 15Hz por bot,
 * no en el loop de 128Hz de física ni en el de render, así que no compite
 * con el presupuesto de cero asignaciones por frame (ver movement/step.ts,
 * combat/shot.ts). Documentado acá para que quede claro que es una decisión,
 * no un descuido.
 */

import {
  cellCenterX,
  cellCenterZ,
  cellLinkedTo,
  NEIGHBOR_OFFSETS,
  type NavGrid,
} from '@/game/bots/navgrid'

// ---------------------------------------------------------------------------
// Heap binario de mínimos sobre arrays paralelos: cero asignaciones por push/pop.
// ---------------------------------------------------------------------------

interface BinaryHeap {
  index: Int32Array
  priority: Float64Array
  size: number
}

function heapPush(heap: BinaryHeap, cellIndex: number, priority: number): void {
  let i = heap.size++
  heap.index[i] = cellIndex
  heap.priority[i] = priority
  while (i > 0) {
    const parent = (i - 1) >> 1
    if (heap.priority[parent] <= heap.priority[i]) break
    swapHeap(heap, i, parent)
    i = parent
  }
}

function swapHeap(heap: BinaryHeap, a: number, b: number): void {
  const ti = heap.index[a]
  heap.index[a] = heap.index[b]
  heap.index[b] = ti
  const tp = heap.priority[a]
  heap.priority[a] = heap.priority[b]
  heap.priority[b] = tp
}

function heapPop(heap: BinaryHeap): number {
  const top = heap.index[0]
  heap.size--
  heap.index[0] = heap.index[heap.size]
  heap.priority[0] = heap.priority[heap.size]

  let i = 0
  for (;;) {
    const left = i * 2 + 1
    const right = i * 2 + 2
    let smallest = i
    if (left < heap.size && heap.priority[left] < heap.priority[smallest]) smallest = left
    if (right < heap.size && heap.priority[right] < heap.priority[smallest]) smallest = right
    if (smallest === i) break
    swapHeap(heap, i, smallest)
    i = smallest
  }
  return top
}

// ---------------------------------------------------------------------------
// Contexto de A*: todo preasignado una vez por grid.
// ---------------------------------------------------------------------------

export interface PathfindingContext {
  readonly grid: NavGrid
  readonly gScore: Float64Array
  readonly gScoreGen: Int32Array
  readonly closedGen: Int32Array
  readonly cameFrom: Int32Array
  readonly heap: BinaryHeap
  /** Buffer del último camino encontrado, en orden inicio->destino
   *  (celdas). Longitud real en `resultLength`, no en `.length` del array. */
  readonly resultPath: Int32Array
  resultLength: number
  generation: number
}

export function createPathfindingContext(grid: NavGrid): PathfindingContext {
  const cellCount = grid.cols * grid.rows
  return {
    grid,
    gScore: new Float64Array(cellCount),
    gScoreGen: new Int32Array(cellCount),
    closedGen: new Int32Array(cellCount),
    cameFrom: new Int32Array(cellCount),
    heap: {
      index: new Int32Array(cellCount),
      priority: new Float64Array(cellCount),
      size: 0,
    },
    resultPath: new Int32Array(cellCount),
    resultLength: 0,
    generation: 0,
  }
}

function heuristic(grid: NavGrid, a: number, b: number): number {
  const ax = cellCenterX(grid, a % grid.cols)
  const az = cellCenterZ(grid, Math.floor(a / grid.cols))
  const bx = cellCenterX(grid, b % grid.cols)
  const bz = cellCenterZ(grid, Math.floor(b / grid.cols))
  return Math.hypot(ax - bx, az - bz)
}

/**
 * Corre A* de `startIndex` a `goalIndex` sobre `ctx.grid`, escribiendo el
 * camino resultante en `ctx.resultPath`/`ctx.resultLength`. Devuelve `false`
 * sin tocar el resultado anterior si no hay camino o si alguno de los dos
 * extremos no es una celda caminable.
 */
export function findPath(ctx: PathfindingContext, startIndex: number, goalIndex: number): boolean {
  const { grid } = ctx
  if (startIndex < 0 || goalIndex < 0) return false
  if (!grid.walkable[startIndex] || !grid.walkable[goalIndex]) return false

  if (startIndex === goalIndex) {
    ctx.resultPath[0] = startIndex
    ctx.resultLength = 1
    return true
  }

  ctx.generation++
  const gen = ctx.generation
  const heap = ctx.heap
  heap.size = 0

  ctx.gScore[startIndex] = 0
  ctx.gScoreGen[startIndex] = gen
  heapPush(heap, startIndex, heuristic(grid, startIndex, goalIndex))

  const cols = grid.cols
  const rows = grid.rows

  while (heap.size > 0) {
    const current = heapPop(heap)
    if (ctx.closedGen[current] === gen) continue
    ctx.closedGen[current] = gen

    if (current === goalIndex) {
      // Reconstruye el camino caminando cameFrom hacia atrás, luego invierte
      // en el propio buffer preasignado (sin array intermedio).
      let length = 0
      let node = current
      while (node !== startIndex) {
        ctx.resultPath[length++] = node
        node = ctx.cameFrom[node]
      }
      ctx.resultPath[length++] = startIndex

      for (let i = 0, j = length - 1; i < j; i++, j--) {
        const tmp = ctx.resultPath[i]
        ctx.resultPath[i] = ctx.resultPath[j]
        ctx.resultPath[j] = tmp
      }
      ctx.resultLength = length
      return true
    }

    const col = current % cols
    const row = (current - col) / cols
    const currentG = ctx.gScore[current]

    for (let n = 0; n < NEIGHBOR_OFFSETS.length; n++) {
      const [dCol, dRow] = NEIGHBOR_OFFSETS[n]
      const nCol = col + dCol
      const nRow = row + dRow
      if (nCol < 0 || nCol >= cols || nRow < 0 || nRow >= rows) continue

      const neighbor = nRow * cols + nCol
      if (ctx.closedGen[neighbor] === gen) continue
      // cellLinkedTo y no cellsConnected: son la misma respuesta (el mismo
      // byte horneado), pero acá ya tenemos el índice `n` del vecino y no
      // hace falta que la función lo redescubra restando columnas y filas.
      if (!cellLinkedTo(grid, current, n)) continue

      // Costo real (distancia entre centros de celda), no 1/sqrt2 fijo: así
      // un futuro cellSize no uniforme (o un grid no cuadrado) sigue dando
      // costos admisibles sin tener que retocar esta función.
      const stepCost = heuristic(grid, current, neighbor)
      const tentativeG = currentG + stepCost

      const knownGen = ctx.gScoreGen[neighbor]
      if (knownGen !== gen || tentativeG < ctx.gScore[neighbor]) {
        ctx.gScore[neighbor] = tentativeG
        ctx.gScoreGen[neighbor] = gen
        ctx.cameFrom[neighbor] = current
        heapPush(heap, neighbor, tentativeG + heuristic(grid, neighbor, goalIndex))
      }
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Caché de caminos: keyed por (start, goal). Ver el comentario de cabecera
// del archivo sobre por qué acá sí se permite asignar.
// ---------------------------------------------------------------------------

export interface PathCacheEntry {
  readonly found: boolean
  /** Copia estable del camino (no el buffer mutable de PathfindingContext):
   *  ctx.resultPath se pisa en la próxima búsqueda, así que una entrada de
   *  caché no puede apuntar a él directo. */
  readonly path: readonly number[]
}

export interface PathCache {
  readonly entries: Map<string, PathCacheEntry>
  readonly order: string[]
  readonly capacity: number
}

export function createPathCache(capacity = 128): PathCache {
  return { entries: new Map(), order: [], capacity }
}

function cacheKeyFor(startIndex: number, goalIndex: number): string {
  return `${startIndex}:${goalIndex}`
}

/**
 * Busca (o calcula y guarda) el camino de `startIndex` a `goalIndex`.
 * Determinista: la misma clave siempre devuelve el mismo resultado mientras
 * el grid no cambie (el mapa es estático dentro de una partida, así que la
 * entrada nunca se invalida por sí sola -- sólo se desaloja por LRU/FIFO
 * cuando la caché se llena).
 */
export function findPathCached(
  ctx: PathfindingContext,
  cache: PathCache,
  startIndex: number,
  goalIndex: number,
): PathCacheEntry {
  const key = cacheKeyFor(startIndex, goalIndex)
  const cached = cache.entries.get(key)
  if (cached) return cached

  const found = findPath(ctx, startIndex, goalIndex)
  const entry: PathCacheEntry = found
    ? { found: true, path: Array.from(ctx.resultPath.subarray(0, ctx.resultLength)) }
    : { found: false, path: [] }

  if (cache.entries.size >= cache.capacity) {
    const oldest = cache.order.shift()
    if (oldest !== undefined) cache.entries.delete(oldest)
  }
  cache.entries.set(key, entry)
  cache.order.push(key)

  return entry
}

export function clearPathCache(cache: PathCache): void {
  cache.entries.clear()
  cache.order.length = 0
}
