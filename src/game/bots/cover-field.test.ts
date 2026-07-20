/**
 * Campo de distancia a cobertura (bots/cover-field.ts).
 *
 * Los umbrales de este archivo son ABSOLUTOS y están escritos a mano, nunca
 * derivados de las constantes de BOTS que la implementación usa. Es a
 * propósito: un test que compara contra la misma constante que el código
 * puede mutar pasa igual con el código roto -- ya pasó en esta área. Si
 * mañana alguien mueve `coverProbeHeightM` a 3 m, estos tests tienen que
 * ponerse rojos, no seguirlo.
 */

import { describe, expect, it } from 'vitest'
import { buildCoverField, coverDistanceAt } from '@/game/bots/cover-field'
import { buildMainComponentMask, buildNavGrid } from '@/game/bots/navgrid'
import { ARENA } from '@/game/map/arena'
import { BUNKER } from '@/game/map/bunker'
import { TORRE } from '@/game/map/torre'
import { cajaConvexa, mapaDeBrushes } from '@/game/map/geometria-de-prueba'
import type { MapDef } from '@/game/map/types'

function campoDe(map: MapDef) {
  const grid = buildNavGrid(map)
  return buildCoverField(map.boxes, map.convexes ?? [], grid, buildMainComponentMask(grid))
}

/** Piso de 40x40 centrado en el origen, como brush (no como Box): así el
 *  mapa se parece a uno importado de Source y `boxes` queda vacío. */
function piso(): ReturnType<typeof cajaConvexa> {
  return cajaConvexa(-20, -1, -20, 20, 0, 20)
}

describe('los mapas escritos en código no estrenan campo', () => {
  // Por construcción, no por casualidad: si `boxes` ya ofrece cobertura,
  // `nearestCoverDistanceXZ` responde bien y el campo no se hornea. Es lo
  // que garantiza que arena, torre y búnker no puedan regresionar.
  for (const map of [ARENA, TORRE, BUNKER]) {
    it(`${map.name}: buildCoverField devuelve null`, () => {
      expect(campoDe(map)).toBeNull()
    })
  }
})

describe('un mapa de brushes sí estrena campo', () => {
  it('un muro alto es cobertura: distancia 0 encima y creciente al alejarse', () => {
    // Muro de 3 m de alto cruzando el mapa en z ∈ [-1, 1].
    const map = mapaDeBrushes([piso(), cajaConvexa(-10, 0, -1, 10, 3, 1)], {
      min: [-20, -2, -20],
      max: [20, 10, 20],
    })
    const campo = campoDe(map)
    expect(campo).not.toBeNull()
    if (campo === null) return

    // Sobre el muro: cobertura pegada.
    expect(coverDistanceAt(campo, 0, 0)).toBeLessThan(0.5)
    // A 5 m del borde del muro (que llega a z=1): ~5 m, con holgura de
    // lattice y del chamfer.
    const d5 = coverDistanceAt(campo, 0, 6)
    expect(d5).toBeGreaterThan(4)
    expect(d5).toBeLessThan(6)
    // Y monótono: más lejos es más lejos.
    expect(coverDistanceAt(campo, 0, 12)).toBeGreaterThan(d5 + 4)
  })

  it('un escalón bajo NO es cobertura: no te tapa de un disparo', () => {
    // Éste es EL test que separa este campo de la aproximación por
    // navegabilidad. Un escalón de 35 cm cambia la caminabilidad del mapa
    // pero no tapa a nadie: a la altura del torso ahí hay aire.
    const map = mapaDeBrushes([piso(), cajaConvexa(-10, 0, -1, 10, 0.35, 1)], {
      min: [-20, -2, -20],
      max: [20, 10, 20],
    })
    const campo = campoDe(map)
    // Sin ninguna sonda sólida no se hornea nada: null es la respuesta
    // honesta, y el llamador cae al camino de cajas.
    expect(campo).toBeNull()
  })

  it('con un muro alto y un escalón bajo, sólo el muro cuenta', () => {
    const map = mapaDeBrushes(
      [
        piso(),
        cajaConvexa(-10, 0, -16, 10, 3, -14), // muro alto, lejos
        cajaConvexa(-10, 0, -1, 10, 0.35, 1), // escalón bajo, en el medio
      ],
      { min: [-20, -2, -20], max: [20, 10, 20] },
    )
    const campo = campoDe(map)
    expect(campo).not.toBeNull()
    if (campo === null) return

    // Parado justo sobre el escalón bajo, la cobertura más cercana es el
    // muro de allá lejos (~13 m), no el escalón bajo los pies.
    const d = coverDistanceAt(campo, 0, 0)
    expect(d).toBeGreaterThan(11)
    expect(d).toBeLessThan(15)
  })

  it('mide igual la cobertura que quedó "después" en el barrido', () => {
    // El chamfer son DOS pasadas: la primera propaga desde arriba-izquierda,
    // la segunda desde abajo-derecha. Sin la segunda, un punto cuya única
    // cobertura está en +x/+z queda con una distancia enorme y el bot cree
    // estar en campo abierto teniendo un muro al lado. Los otros tests no lo
    // notaban: todos consultaban puntos con la cobertura hacia -z.
    const map = mapaDeBrushes([piso(), cajaConvexa(-10, 0, 14, 10, 3, 16)], {
      min: [-20, -2, -20],
      max: [20, 10, 20],
    })
    const campo = campoDe(map)
    expect(campo).not.toBeNull()
    if (campo === null) return

    // El muro empieza en z=14; desde z=0 son 14 m, no "muy lejos".
    const d = coverDistanceAt(campo, 0, 0)
    expect(d).toBeGreaterThan(12)
    expect(d).toBeLessThan(16)
  })

  it('fuera de la lattice devuelve un número finito, nunca Infinity', () => {
    // Infinity es exactamente el veneno que hacía inerte el chequeo del
    // strafe (`Infinity <= Infinity + holgura` siempre pasa).
    const map = mapaDeBrushes([piso(), cajaConvexa(-10, 0, -1, 10, 3, 1)], {
      min: [-20, -2, -20],
      max: [20, 10, 20],
    })
    const campo = campoDe(map)
    expect(campo).not.toBeNull()
    if (campo === null) return

    for (const [x, z] of [
      [1e6, 1e6],
      [-1e6, -1e6],
      [0, 1e6],
    ]) {
      const d = coverDistanceAt(campo, x, z)
      expect(Number.isFinite(d)).toBe(true)
    }
  })
})
