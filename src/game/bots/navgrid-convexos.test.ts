/**
 * Bake del navgrid sobre geometría arbitraria (brushes convexos), que es lo
 * que traen los mapas importados de Source.
 *
 * El test que de verdad importa acá NO está en este archivo sino en
 * bots/coherencia-fisica.test.ts: "toda arista del grafo la puede recorrer
 * stepPlayer de verdad". Éste cubre el contrato del bake -- qué se marca
 * caminable y qué no --, que es la mitad barata del problema.
 */

import { describe, expect, it } from 'vitest'
import {
  buildMainComponentMask,
  buildNavGrid,
  cellCenterX,
  cellCol,
  cellsConnected,
  worldToCellIndex,
} from '@/game/bots/navgrid'
import { ARENA } from '@/game/map/arena'
import { BUNKER } from '@/game/map/bunker'
import { TORRE } from '@/game/map/torre'
import { cajaConvexa, cuna, mapaDeBrushes } from '@/game/map/geometria-de-prueba'

const CAPSULE_H = 1.8

describe('los tres mapas escritos en código no cambian de navgrid', () => {
  // Números anclados. No son "lo que dio cuando lo corrí": se verificaron
  // celda por celda y arista por arista contra la implementación anterior al
  // bake de geometría arbitraria (misma walkable, mismas heights, misma
  // máscara de componente y las mismas 8 aristas por celda). Si alguno se
  // mueve, la navegación de estos tres mapas cambió, y eso hay que decidirlo
  // a propósito -- no descubrirlo jugando.
  const esperado = {
    arena: { cols: 60, rows: 60, caminables: 3600, sumaAlturas: 1902.0, aristas: 25740, alcanzables: 3284 },
    torre: { cols: 48, rows: 48, caminables: 2304, sumaAlturas: 3137.6, aristas: 15956, alcanzables: 2052 },
    bunker: { cols: 40, rows: 40, caminables: 1600, sumaAlturas: 1173.6, aristas: 10120, alcanzables: 1324 },
  }

  for (const map of [ARENA, TORRE, BUNKER]) {
    it(`${map.name}: mismas celdas caminables, mismas alturas y mismas aristas`, () => {
      const grid = buildNavGrid(map)
      let caminables = 0
      let sumaAlturas = 0
      let aristas = 0
      for (let i = 0; i < grid.walkable.length; i++) {
        if (grid.walkable[i] === 0) continue
        caminables++
        sumaAlturas += grid.heights[i]
      }
      for (let i = 0; i < grid.links.length; i++) {
        let bits = grid.links[i]
        while (bits) {
          aristas += bits & 1
          bits >>= 1
        }
      }
      let alcanzables = 0
      const mask = buildMainComponentMask(grid)
      for (let i = 0; i < mask.length; i++) alcanzables += mask[i]

      const e = esperado[map.name as keyof typeof esperado]
      expect({ cols: grid.cols, rows: grid.rows, caminables, aristas, alcanzables }).toEqual({
        cols: e.cols,
        rows: e.rows,
        caminables: e.caminables,
        aristas: e.aristas,
        alcanzables: e.alcanzables,
      })
      expect(sumaAlturas).toBeCloseTo(e.sumaAlturas, 4)
      // Un mapa sin brushes convexos conserva el mantle: su desnivel
      // franqueable sigue siendo el de movement/tuning.ts, no el escalón.
      expect(grid.maxStepHeight).toBeCloseTo(1.2, 6)
    })
  }
})

describe('bake desde brushes convexos', () => {
  it('un mapa con brushes y sin cajas produce un navgrid NO vacío', () => {
    const map = mapaDeBrushes(
      [cajaConvexa(-5, -1, -5, 5, 0, 5)],
      { min: [-5, 0, -5], max: [5, 4, 5] },
    )
    expect(map.boxes).toHaveLength(0)

    const grid = buildNavGrid(map, 1, CAPSULE_H)
    let caminables = 0
    for (let i = 0; i < grid.walkable.length; i++) caminables += grid.walkable[i]

    expect(caminables).toBe(grid.cols * grid.rows)
    for (let i = 0; i < grid.heights.length; i++) expect(grid.heights[i]).toBeCloseTo(0, 4)
  })

  it('el desnivel franqueable de un mapa de brushes es el escalón, no el mantle', () => {
    // No es un detalle de tuning: tryMantle (movement/mantle.ts) sólo mira
    // `boxes`, y un mapa importado no tiene ninguna. Prometer 1.2 m acá sería
    // prometer una subida que la física no ejecuta.
    const map = mapaDeBrushes(
      [cajaConvexa(-5, -1, -5, 5, 0, 5)],
      { min: [-5, 0, -5], max: [5, 4, 5] },
    )
    expect(buildNavGrid(map, 1, CAPSULE_H).maxStepHeight).toBeCloseTo(0.35, 6)
  })

  it('una rampa por debajo del umbral es caminable; una por encima, no', () => {
    // 30 grados y 60 grados, las dos apoyadas en el mismo piso y con el mismo
    // ancho. El umbral (45 grados) sale de physics/capsule.ts esNormalPisable
    // -- el MISMO predicado con el que la colisión decide piso vs pared.
    const piso = cajaConvexa(-2, -1, -2, 20, 0, 10)
    const suave = cuna(2, 8, 0, 4, 0, Math.tan((30 * Math.PI) / 180) * 6)
    const empinada = cuna(12, 15, 5, 9, 0, Math.tan((60 * Math.PI) / 180) * 3)
    const map = mapaDeBrushes([piso, suave, empinada], { min: [-2, 0, -2], max: [20, 8, 10] })
    const grid = buildNavGrid(map, 1, CAPSULE_H)

    const enSuave = worldToCellIndex(grid, 5, 2)
    expect(grid.walkable[enSuave], 'una rampa de 30 grados tiene que ser caminable').toBe(1)
    // La altura horneada tiene que ser la de la RAMPA en ese punto, no la del
    // piso de abajo: se calcula desde el centro real de la celda.
    const xCentro = cellCenterX(grid, cellCol(grid, enSuave))
    expect(grid.heights[enSuave]).toBeCloseTo(Math.tan((30 * Math.PI) / 180) * (xCentro - 2), 2)

    const enEmpinada = worldToCellIndex(grid, 13.5, 7)
    expect(grid.walkable[enEmpinada], 'una rampa de 60 grados es pared, no piso').toBe(0)
  })

  it('el techo del mundo no es piso: un mapa cerrado se hornea sobre su planta baja', () => {
    // La regresión que el bake de "la superficie más alta" produjo en
    // nuketown: un mapa de Source vive dentro de una cáscara de cielo, cuya
    // losa de techo es plana, horizontal y tiene espacio infinito por encima.
    // Con el criterio de "la más alta" el navgrid entero salía siendo el
    // cielorraso, 21 m por encima de todos los spawns.
    const piso = cajaConvexa(-5, -1, -5, 5, 0, 5)
    const techo = cajaConvexa(-5, 6, -5, 5, 7, 5)
    const map = mapaDeBrushes([piso, techo], { min: [-5, 0, -5], max: [5, 8, 5] })
    const grid = buildNavGrid(map, 1, CAPSULE_H)

    for (let i = 0; i < grid.heights.length; i++) {
      expect(grid.walkable[i], `celda ${i}`).toBe(1)
      expect(grid.heights[i], `celda ${i} debería estar en la planta baja`).toBeCloseTo(0, 4)
    }
  })

  it('una repisa de 1 m NO queda conectada al piso en un mapa de brushes', () => {
    // 1 m entra en mantleMaxHeight (1.2), que es lo que un mapa de cajas
    // aceptaría. Acá no hay mantle: sólo el escalón de 0.35.
    const piso = cajaConvexa(-5, -1, -5, 5, 0, 5)
    const repisa = cajaConvexa(0, -1, -5, 5, 1, 5)
    const map = mapaDeBrushes([piso, repisa], { min: [-5, 0, -5], max: [5, 4, 5] })
    const grid = buildNavGrid(map, 1, CAPSULE_H)

    const abajo = worldToCellIndex(grid, -0.5, 0)
    const arriba = worldToCellIndex(grid, 0.5, 0)
    expect(grid.heights[abajo]).toBeCloseTo(0, 4)
    expect(grid.heights[arriba]).toBeCloseTo(1, 4)
    expect(cellsConnected(grid, abajo, arriba)).toBe(false)
  })

  it('una escalera de contrahuellas chicas SÍ queda conectada, aunque suba más que un escalón por metro', () => {
    // El caso que un criterio de "diferencia de altura entre centros de
    // celda" rompe: la escalera sube 0.6 m por metro recorrido (más que
    // MAX_ESCALON) pero ningún peldaño individual pasa de 0.15 m, así que la
    // física la sube caminando. Lo que lo distingue de la repisa de arriba es
    // el PERFIL del terreno, no las puntas.
    const brushes = [cajaConvexa(-5, -1, -5, 0, 0, 5)]
    for (let i = 0; i < 20; i++) {
      const y = (i + 1) * 0.15
      brushes.push(cajaConvexa(i * 0.25, -1, -5, 20, y, 5))
    }
    const map = mapaDeBrushes(brushes, { min: [-5, 0, -5], max: [5, 6, 5] })
    const grid = buildNavGrid(map, 1, CAPSULE_H)

    const pie = worldToCellIndex(grid, -0.5, 0)
    const primerPeldano = worldToCellIndex(grid, 0.5, 0)
    expect(grid.walkable[pie]).toBe(1)
    expect(grid.walkable[primerPeldano]).toBe(1)
    expect(grid.heights[primerPeldano] - grid.heights[pie]).toBeGreaterThan(0.35)
    expect(cellsConnected(grid, pie, primerPeldano)).toBe(true)
  })
})
