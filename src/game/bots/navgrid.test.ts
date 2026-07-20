import { describe, expect, it } from 'vitest'
import {
  buildMainComponentMask,
  buildNavGrid,
  cellCenterX,
  cellCenterZ,
  cellCol,
  cellIndex,
  cellRow,
  cellsConnected,
  nearestWalkableCellIndex,
  worldToCellIndex,
} from '@/game/bots/navgrid'
import type { Box, MapDef } from '@/game/map/types'
import { vec3 } from '@/game/math/vec3'
import { ARENA } from '@/game/map/arena'

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box {
  return { min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) }
}

function mapOf(boxes: Box[], bounds: Box): MapDef {
  return { name: 'test', boxes, spawns: [], bounds }
}

const CAPSULE_H = 1.8

describe('bake del navgrid: piso plano', () => {
  const floor = box(-5, -1, -5, 5, 0, 5)
  const map = mapOf([floor], box(-5, 0, -5, 5, 3, 5))
  const grid = buildNavGrid(map, 1, CAPSULE_H)

  it('toda celda del piso es caminable a altura 0', () => {
    for (let i = 0; i < grid.walkable.length; i++) {
      expect(grid.walkable[i], `celda ${i}`).toBe(1)
      expect(grid.heights[i], `celda ${i}`).toBeCloseTo(0, 6)
    }
  })

  it('cellCenterX/Z + worldToCellIndex son inversas consistentes', () => {
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const idx = cellIndex(grid, col, row)
        const x = cellCenterX(grid, col)
        const z = cellCenterZ(grid, row)
        expect(worldToCellIndex(grid, x, z)).toBe(idx)
        expect(cellCol(grid, idx)).toBe(col)
        expect(cellRow(grid, idx)).toBe(row)
      }
    }
  })

  it('worldToCellIndex da -1 fuera de los límites del grid', () => {
    expect(worldToCellIndex(grid, 1000, 0)).toBe(-1)
    expect(worldToCellIndex(grid, 0, -1000)).toBe(-1)
  })

  it('todas las celdas vecinas del piso están conectadas entre sí (sin desnivel)', () => {
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols - 1; col++) {
        const a = cellIndex(grid, col, row)
        const b = cellIndex(grid, col + 1, row)
        expect(cellsConnected(grid, a, b)).toBe(true)
      }
    }
  })
})

describe('bake del navgrid: escalón bajo (mantleable) vs. muro alto', () => {
  const floor = box(-10, -1, -10, 10, 0, 10)

  it('un escalón de altura <= mantleMaxHeight queda conectado al piso', () => {
    const step = box(0, 0, -10, 10, 1.0, 10) // 1.0m, bajo MANTLE_H=1.2
    const map = mapOf([floor, step], box(-10, 0, -10, 10, 4, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)

    const floorCell = worldToCellIndex(grid, -0.5, 0)
    const stepCell = worldToCellIndex(grid, 0.5, 0)
    expect(grid.heights[floorCell]).toBeCloseTo(0, 6)
    expect(grid.heights[stepCell]).toBeCloseTo(1.0, 6)
    expect(cellsConnected(grid, floorCell, stepCell)).toBe(true)
  })

  it('un muro de altura > mantleMaxHeight NO queda conectado al piso', () => {
    const wall = box(0, 0, -10, 10, 3.0, 10)
    const map = mapOf([floor, wall], box(-10, 0, -10, 10, 5, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)

    const floorCell = worldToCellIndex(grid, -0.5, 0)
    const wallTopCell = worldToCellIndex(grid, 0.5, 0)
    expect(grid.heights[wallTopCell]).toBeCloseTo(3.0, 6)
    expect(cellsConnected(grid, floorCell, wallTopCell)).toBe(false)
  })

  it('cellsConnected es simétrica', () => {
    const step = box(0, 0, -10, 10, 1.0, 10)
    const map = mapOf([floor, step], box(-10, 0, -10, 10, 4, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const a = worldToCellIndex(grid, -0.5, 0)
    const b = worldToCellIndex(grid, 0.5, 0)
    expect(cellsConnected(grid, a, b)).toBe(cellsConnected(grid, b, a))
  })

  it('una celda no caminable nunca está conectada a nada', () => {
    const map = mapOf([floor], box(-10, 0, -10, 10, 4, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    // Fuerza una celda "agujero" marcándola no caminable a mano, para
    // probar la garantía sin depender de que exista un hueco real en boxes.
    const idx = worldToCellIndex(grid, 0, 0)
    ;(grid.walkable as Uint8Array)[idx] = 0
    const neighbor = worldToCellIndex(grid, 1, 0)
    expect(cellsConnected(grid, idx, neighbor)).toBe(false)
  })
})

describe('bake del navgrid: cobertura sin espacio para pararse (techo bajo)', () => {
  it('una caja flotante que no deja espacio de cápsula bloquea el piso debajo, pero su propio techo puede ser caminable', () => {
    const floor = box(-10, -1, -10, 10, 0, 10)
    // Vuela entre 1.0 y 1.3: deja sólo 1.0m de espacio libre sobre el piso,
    // menos que CAPSULE_H=1.8 -- el piso ahí deja de servir para pararse.
    const overhang = box(-2, 1.0, -2, 2, 1.3, 2)
    const map = mapOf([floor, overhang], box(-10, 0, -10, 10, 5, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)

    const underOverhang = worldToCellIndex(grid, 0, 0)
    // No es el piso (0): la única superficie con espacio real es el techo
    // del overhang, a 1.3m.
    expect(grid.heights[underOverhang]).toBeCloseTo(1.3, 6)
    expect(grid.walkable[underOverhang]).toBe(1)

    const openFloor = worldToCellIndex(grid, 8, 0)
    expect(grid.heights[openFloor]).toBeCloseTo(0, 6)
  })
})

describe('nearestWalkableCellIndex', () => {
  it('devuelve la misma celda si el punto ya cae en una caminable', () => {
    const map = mapOf([box(-5, -1, -5, 5, 0, 5)], box(-5, 0, -5, 5, 3, 5))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    const exact = worldToCellIndex(grid, 0, 0)
    expect(nearestWalkableCellIndex(grid, 0, 0)).toBe(exact)
  })

  it('busca hacia afuera cuando el punto exacto no es caminable', () => {
    const floor = box(-10, -1, -10, 10, 0, 10)
    const wall = box(-1, 0, -10, 1, 3, 10) // franja no caminable en X en [-1,1]
    const map = mapOf([floor, wall], box(-10, 0, -10, 10, 4, 10))
    const grid = buildNavGrid(map, 1, CAPSULE_H)

    const found = nearestWalkableCellIndex(grid, 0, 0, 4)
    expect(found).toBeGreaterThanOrEqual(0)
    expect(grid.walkable[found]).toBe(1)
  })

  it('devuelve -1 si no hay ninguna celda caminable dentro del radio', () => {
    // El piso arranca recién en x=8: ninguna caja cubre la columna (0,0) ni
    // sus vecinas dentro de 2 celdas -- a diferencia de un muro alto (cuyo
    // TECHO sigue siendo una superficie caminable, sólo que desconectada),
    // acá no hay ninguna superficie candidata en absoluto.
    const floor = box(8, -1, -20, 20, 0, 20)
    const map = mapOf([floor], box(-20, 0, -20, 20, 4, 20))
    const grid = buildNavGrid(map, 1, CAPSULE_H)
    expect(nearestWalkableCellIndex(grid, 0, 0, 2)).toBe(-1)
  })
})

describe('navgrid real de la arena del juego', () => {
  const grid = buildNavGrid(ARENA, 1, CAPSULE_H)

  it('todos los spawns caen en una celda caminable', () => {
    for (const spawn of ARENA.spawns) {
      const idx = nearestWalkableCellIndex(grid, spawn.x, spawn.z, 3)
      expect(idx, `spawn (${spawn.x},${spawn.z})`).toBeGreaterThanOrEqual(0)
    }
  })

  it('la mayoría del piso de la arena es caminable (no todo bloqueado por error de bake)', () => {
    let walkableCount = 0
    for (let i = 0; i < grid.walkable.length; i++) walkableCount += grid.walkable[i]
    expect(walkableCount).toBeGreaterThan(grid.walkable.length * 0.5)
  })
})

describe('máscara del componente conexo principal', () => {
  // Piso de 20x20 con una columna de 3m en el medio: el techo de la columna
  // es una superficie caminable perfectamente plana a la que no se puede
  // subir (3m contra 1.2m de mantle). Es exactamente la forma del techo de
  // un muro o de una cobertura alta en un mapa real.
  const floor = box(-10, -1, -10, 10, 0, 10)
  const columna = box(-1, 0, -1, 1, 3, 1)
  const map = mapOf([floor, columna], box(-10, 0, -10, 10, 6, 10))
  const grid = buildNavGrid(map, 1, CAPSULE_H)

  it('marca el piso y deja afuera el techo inalcanzable', () => {
    const mask = buildMainComponentMask(grid)

    const enElPiso = worldToCellIndex(grid, -8, -8)
    expect(grid.walkable[enElPiso]).toBe(1)
    expect(mask[enElPiso]).toBe(1)

    const enLaColumna = worldToCellIndex(grid, 0.5, 0.5)
    expect(grid.walkable[enLaColumna], 'el techo de la columna sí es caminable').toBe(1)
    expect(grid.heights[enLaColumna]).toBe(3)
    expect(mask[enLaColumna], 'pero no forma parte del componente alcanzable').toBe(0)
  })

  it('nearestWalkableCellIndex con máscara no devuelve una celda del techo', () => {
    const mask = buildMainComponentMask(grid)

    const sinMascara = nearestWalkableCellIndex(grid, 0.5, 0.5)
    expect(grid.heights[sinMascara]).toBe(3)

    const conMascara = nearestWalkableCellIndex(grid, 0.5, 0.5, 4, mask)
    expect(conMascara).toBeGreaterThanOrEqual(0)
    expect(grid.heights[conMascara]).toBe(0)
  })

  /**
   * Este caso es el que rompió nuketown al darles colisión a los props.
   *
   * Mientras "el pedazo más grande" y "el pedazo donde se juega" fueron el
   * mismo, elegir por tamaño funcionó de casualidad -- en nuketown ganaba
   * por 2% (4945 celdas contra 4830). Al volverse sólidas las cercas, el
   * área jugable se partió y una zona de servicio fuera del mapa pasó a ser
   * la más grande: la máscara devolvía un pedazo sin un solo spawn y los
   * bots patrullaban ahí.
   *
   * Un test que sólo mirara "la máscara marca un componente conexo" pasa
   * con las dos versiones. Éste mira que sea EL DE LOS SPAWNS.
   */
  it('elige el componente de los spawns aunque NO sea el más grande', () => {
    // Dos plataformas separadas por un pozo: una grande sin spawns, una
    // chica con todos los spawns.
    const grande = box(-10, -1, -10, 10, 0, 10)
    const chica = box(14, -1, -3, 20, 0, 3)
    const mapa: MapDef = {
      name: 'test',
      boxes: [grande, chica],
      spawns: [vec3(17, 0, 0), vec3(18, 0, 1)],
      bounds: box(-10, 0, -10, 21, 6, 10),
    }
    const g = buildNavGrid(mapa, 1, CAPSULE_H)
    const mask = buildMainComponentMask(g)

    const enChica = worldToCellIndex(g, 17, 0)
    const enGrande = worldToCellIndex(g, -8, -8)
    expect(g.walkable[enChica], 'la plataforma chica es caminable').toBe(1)
    expect(g.walkable[enGrande], 'la grande también').toBe(1)

    // Contar para dejar dicho que la "equivocada" es de verdad la más grande.
    let celdasChica = 0
    let celdasGrande = 0
    for (let i = 0; i < mask.length; i++) {
      if (g.walkable[i] === 0) continue
      if (cellCol(g, i) >= 24) celdasChica++
      else celdasGrande++
    }
    expect(celdasGrande).toBeGreaterThan(celdasChica)

    expect(mask[enChica], 'la máscara tiene que ser la de los spawns').toBe(1)
    expect(mask[enGrande], 'y no la del pedazo más grande sin spawns').toBe(0)
  })

  it('sin spawns caminables cae al criterio de tamaño de siempre', () => {
    // Los mapas escritos en código y los de test arman MapDef con
    // `spawns: []`; ahí el ancla no existe y tiene que seguir ganando el
    // más grande, o se rompen los tres mapas de código.
    const grande = box(-10, -1, -10, 10, 0, 10)
    const chica = box(14, -1, -3, 20, 0, 3)
    const g = buildNavGrid(mapOf([grande, chica], box(-10, 0, -10, 21, 6, 10)), 1, CAPSULE_H)
    const mask = buildMainComponentMask(g)
    expect(mask[worldToCellIndex(g, -8, -8)]).toBe(1)
    expect(mask[worldToCellIndex(g, 17, 0)]).toBe(0)
  })

  it('un mapa de un solo nivel queda entero dentro de la máscara', () => {
    const plano = mapOf([floor], box(-10, 0, -10, 10, 6, 10))
    const gridPlano = buildNavGrid(plano, 1, CAPSULE_H)
    const mask = buildMainComponentMask(gridPlano)
    for (let i = 0; i < gridPlano.walkable.length; i++) {
      expect(mask[i]).toBe(gridPlano.walkable[i])
    }
  })
})
