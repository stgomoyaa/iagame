/**
 * Descarte espacial (broadphase) para la colisión contra brushes convexos.
 *
 * Por qué existe, con el número medido: la arena tiene ~30 cajas y nuketown
 * 1467 brushes. `resolveMove` los recorría TODOS, dos pasadas por substep,
 * por cada entidad que se mueve (jugador + 8 bots), 128 veces por segundo.
 * Medido en el navegador con nuketown cargado: 3.58 ms de CPU por frame
 * contra 1.50 ms en la arena, o sea 2 ms por encima del presupuesto de 2.5.
 *
 * La solución es una grilla uniforme en XZ (no en Y: los mapas son anchos y
 * bajos, y el test de caja envolvente por brush ya descarta en vertical).
 * Cada celda guarda los índices de los brushes que la tocan, aplanados en
 * dos Int32Array estilo CSR -- sin un array por celda, que serían miles de
 * objetos.
 *
 * Los brushes ENORMES (el suelo del mapa, la cáscara del cielo) no entran a
 * la grilla: uno solo de ellos tocaría miles de celdas y engordaría el
 * índice más de lo que ahorra. Van a una lista aparte que se revisa siempre,
 * que en nuketown son unas pocas decenas de brushes.
 */

import type { Convex } from '@/game/map/types'

/** Lado de celda en metros. 4 m es ~2 anchos de cápsula: chico como para
 *  que una consulta toque pocas celdas, grande como para que un brush
 *  típico de pared o mueble no se registre en decenas. */
const LADO_CELDA = 4

/** Un brush que toque más celdas que esto va a la lista de "siempre". */
const MAX_CELDAS_POR_BRUSH = 48

export interface ConvexGrid {
  readonly cellSize: number
  readonly minX: number
  readonly minZ: number
  readonly cols: number
  readonly rows: number
  /** CSR: los índices de la celda i son items[offset[i] .. offset[i+1]). */
  readonly offset: Int32Array
  readonly items: Int32Array
  /** Brushes demasiado grandes para indexar, siempre en juego. */
  readonly siempre: Int32Array
  /** Marca de visitado por brush, para deduplicar sin asignar (ver query). */
  readonly visitado: Int32Array
}

function celdaX(grid: { minX: number; cellSize: number; cols: number }, x: number): number {
  const c = Math.floor((x - grid.minX) / grid.cellSize)
  return c < 0 ? 0 : c >= grid.cols ? grid.cols - 1 : c
}

function celdaZ(grid: { minZ: number; cellSize: number; rows: number }, z: number): number {
  const c = Math.floor((z - grid.minZ) / grid.cellSize)
  return c < 0 ? 0 : c >= grid.rows ? grid.rows - 1 : c
}

/**
 * Hornea la grilla. Se corre UNA vez por mapa, al cargarlo -- nunca en el
 * camino de frame. Dos pasadas sobre los brushes: la primera cuenta cuántos
 * caen en cada celda, la segunda los escribe. Es lo que permite el
 * empaquetado CSR sin arrays intermedios.
 */
export function buildConvexGrid(convexes: readonly Convex[], cellSize = LADO_CELDA): ConvexGrid {
  if (convexes.length === 0) {
    return {
      cellSize, minX: 0, minZ: 0, cols: 1, rows: 1,
      offset: new Int32Array(2), items: new Int32Array(0),
      siempre: new Int32Array(0), visitado: new Int32Array(0),
    }
  }

  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const c of convexes) {
    if (c.min.x < minX) minX = c.min.x
    if (c.min.z < minZ) minZ = c.min.z
    if (c.max.x > maxX) maxX = c.max.x
    if (c.max.z > maxZ) maxZ = c.max.z
  }

  const cols = Math.max(1, Math.ceil((maxX - minX) / cellSize))
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize))
  const dims = { cellSize, minX, minZ, cols, rows }

  const grandes: number[] = []
  const conteo = new Int32Array(cols * rows + 1)

  for (let i = 0; i < convexes.length; i++) {
    const c = convexes[i]
    const x0 = celdaX(dims, c.min.x)
    const x1 = celdaX(dims, c.max.x)
    const z0 = celdaZ(dims, c.min.z)
    const z1 = celdaZ(dims, c.max.z)
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > MAX_CELDAS_POR_BRUSH) {
      grandes.push(i)
      continue
    }
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) conteo[z * cols + x]++
    }
  }

  const offset = new Int32Array(cols * rows + 1)
  let acumulado = 0
  for (let i = 0; i < cols * rows; i++) {
    offset[i] = acumulado
    acumulado += conteo[i]
  }
  offset[cols * rows] = acumulado

  const items = new Int32Array(acumulado)
  const cursor = new Int32Array(cols * rows)
  for (let i = 0; i < convexes.length; i++) {
    const c = convexes[i]
    const x0 = celdaX(dims, c.min.x)
    const x1 = celdaX(dims, c.max.x)
    const z0 = celdaZ(dims, c.min.z)
    const z1 = celdaZ(dims, c.max.z)
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > MAX_CELDAS_POR_BRUSH) continue
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const celda = z * cols + x
        items[offset[celda] + cursor[celda]] = i
        cursor[celda]++
      }
    }
  }

  return {
    cellSize, minX, minZ, cols, rows,
    offset, items,
    siempre: Int32Array.from(grandes),
    visitado: new Int32Array(convexes.length),
  }
}

/**
 * Sello de consulta. Crece en cada `queryConvexGrid` y se guarda en
 * `visitado[i]`: así deduplicar un brush que toca varias celdas no necesita
 * ni un Set ni limpiar el array entre consultas. Empieza en 1 porque
 * `visitado` arranca lleno de ceros.
 */
let sello = 0

/**
 * Escribe en `out` los brushes cuya caja envolvente se solapa con el
 * rectángulo XZ pedido y devuelve CUÁNTOS escribió. El array del llamador se
 * reusa y NUNCA se achica: se sobreescriben las primeras `n` posiciones y el
 * resto queda como basura que nadie lee.
 *
 * Por qué un contador en vez de `out.length = 0` + push, que se lee mucho
 * mejor: medido con el guard de asignaciones (movement/allocations.test.ts),
 * vaciar el array cada tick hacía crecer el heap 6 MB en 300k ticks -- V8
 * recorta el backing store al poner length en 0 y lo vuelve a pedir al
 * primer push. Con el contador, el array crece una vez durante el
 * calentamiento y después no se toca nunca más.
 *
 * Deduplica: un brush que toca cuatro celdas tiene que entrar UNA vez. Si
 * entrara repetido, `resolveMove` resolvería la misma penetración varias
 * veces en la misma pasada y lo empujaría el doble o el cuádruple.
 */
export function queryConvexGrid(
  grid: ConvexGrid,
  convexes: readonly Convex[],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  out: Convex[],
): number {
  let n = 0
  sello++

  for (let k = 0; k < grid.siempre.length; k++) {
    const i = grid.siempre[k]
    grid.visitado[i] = sello
    out[n] = convexes[i]
    n++
  }

  const x0 = celdaX(grid, minX)
  const x1 = celdaX(grid, maxX)
  const z0 = celdaZ(grid, minZ)
  const z1 = celdaZ(grid, maxZ)

  for (let z = z0; z <= z1; z++) {
    const fila = z * grid.cols
    for (let x = x0; x <= x1; x++) {
      const celda = fila + x
      const fin = grid.offset[celda + 1]
      for (let p = grid.offset[celda]; p < fin; p++) {
        const i = grid.items[p]
        if (grid.visitado[i] === sello) continue
        grid.visitado[i] = sello
        out[n] = convexes[i]
        n++
      }
    }
  }

  return n
}
