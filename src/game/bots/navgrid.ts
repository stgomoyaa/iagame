/**
 * Navgrid horneado desde la definición del mapa (sección 8 del spec: "Navgrid
 * horneado desde la definición del mapa"). Matemática pura sobre las mismas
 * cajas que ya usa la colisión (map/types.ts, Box) -- nada de esto conoce
 * Three ni el BVH de combate. Se hornea UNA vez por mapa (bots/bot.ts la
 * cachea a nivel de módulo), nunca en el camino de frame: por eso puede
 * costar recorrer todas las cajas por celda sin que le importe al
 * presupuesto de 2.5ms.
 *
 * Bake por columna: para cada celda (x,z) se busca la superficie caminable
 * más alta (el techo de una caja que cubre esa columna) que tenga espacio
 * libre por encima para pararse (altura de cápsula). Dos celdas vecinas
 * quedan conectadas si ambas son caminables y la diferencia de altura entre
 * sus superficies entra dentro de lo que stepPlayer() ya puede subir solo
 * (mantle, movement/tuning.ts MOVEMENT.mantleMaxHeight) -- así el grafo de
 * navegación nunca promete un camino que la física real no pueda seguir.
 */

import type { Box, MapDef } from '@/game/map/types'
import { PLAYER_CAPSULE } from '@/game/physics/capsule'
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
}

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
    if (b.min.y < ceiling - 1e-4 && b.max.y > top + 1e-4) return false
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
  const minX = bounds.min.x
  const minZ = bounds.min.z
  const cols = Math.max(1, Math.floor((bounds.max.x - minX) / cellSize))
  const rows = Math.max(1, Math.floor((bounds.max.z - minZ) / cellSize))
  const heights = new Float32Array(cols * rows)
  const walkable = new Uint8Array(cols * rows)

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

  return { cellSize, minX, minZ, cols, rows, heights, walkable }
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

/**
 * ¿Están conectadas dos celdas (walkable, y su diferencia de altura entra en
 * lo que stepPlayer() puede subir solo)? `mantleMaxHeight` es un parámetro
 * (no leído directo de MOVEMENT) por la misma razón que cellSize en
 * buildNavGrid: los tests arman grids sintéticos con su propio techo de
 * altura sin importar movement/tuning.
 */
export function cellsConnected(
  grid: NavGrid,
  indexA: number,
  indexB: number,
  mantleMaxHeight: number = MOVEMENT.mantleMaxHeight,
): boolean {
  if (!grid.walkable[indexA] || !grid.walkable[indexB]) return false
  const dh = Math.abs(grid.heights[indexA] - grid.heights[indexB])
  return dh <= mantleMaxHeight
}

/** Vecinos en 8 direcciones, como deltas (dCol, dRow). Índices pares
 *  (0,2,4,6) son los cuatro cardinales; los impares son las diagonales. Se
 *  expone como constante módulo para que A* (pathfinding.ts) no reasigne
 *  este array en cada expansión de nodo. */
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

/**
 * Máscara del componente conexo MÁS GRANDE del grid: 1 en las celdas que se
 * alcanzan caminando y mantleando desde cualquier otra celda del mismo
 * componente, 0 en el resto.
 *
 * Existe porque "caminable" y "alcanzable" no son lo mismo, y confundirlas
 * produce navegación degenerada. El bake marca caminable cualquier columna
 * con superficie y espacio libre arriba -- eso incluye el TECHO de los muros
 * perimetrales y el de la cobertura alta, que son superficies planas
 * perfectamente paradas a las que nadie puede subir. En la arena eso nunca
 * molestó porque la retícula de patrulla (cada 10m) no caía encima de
 * ninguna por casualidad; en el mapa "torre" cayeron dos nodos sobre
 * cobertura bloqueante de 2.2m, y un bot que elige un destino imposible
 * quema una petición de camino por ciclo hasta que le toca otro nodo.
 *
 * Corre UNA vez por mapa (bake de la red de patrulla), nunca en frame: es un
 * flood fill sobre todo el grid usando el mismo cellsConnected que después
 * usa A*, así que la máscara no puede desincronizarse del criterio real de
 * conectividad.
 */
export function buildMainComponentMask(
  grid: NavGrid,
  mantleMaxHeight: number = MOVEMENT.mantleMaxHeight,
): Uint8Array {
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
        if (!cellsConnected(grid, idx, vecino, mantleMaxHeight)) continue
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
