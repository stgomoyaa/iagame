import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  convexesDesdeJson,
  esMapaFuenteJson,
  mapDefDesdeJson,
  spawnsUtilizables,
  type MapaFuenteJson,
} from '@/game/map/source-map'
import { PLAYER_CAPSULE } from '@/game/physics/capsule'
import { resolveMove, type MoveResult } from '@/game/physics/capsule'
import { vec3 } from '@/game/math/vec3'

/** Seis planos (nx,ny,nz,d) de una caja alineada a ejes, normales hacia afuera. */
function planosDeCaja(
  min: [number, number, number],
  max: [number, number, number],
): number[] {
  return [
    -1, 0, 0, -min[0],
    1, 0, 0, max[0],
    0, -1, 0, -min[1],
    0, 1, 0, max[1],
    0, 0, -1, -min[2],
    0, 0, 1, max[2],
  ]
}

function jsonDePrueba(over: Partial<MapaFuenteJson> = {}): MapaFuenteJson {
  return {
    nombre: 'prueba',
    metrosPorUnidad: 0.01905,
    bounds: { min: [-10, -1, -10], max: [10, 5, 10] },
    spawns: [[0, 0, 0]],
    brushes: [{ planes: planosDeCaja([-10, -1, -10], [10, 0, 10]), min: [-10, -1, -10], max: [10, 0, 10] }],
    ...over,
  }
}

describe('esMapaFuenteJson', () => {
  it('acepta la forma que produce bsp-convert.ts', () => {
    expect(esMapaFuenteJson(jsonDePrueba())).toBe(true)
  })

  it('rechaza un HTML de 404 servido como si fuera el mapa', () => {
    expect(esMapaFuenteJson('<!doctype html>')).toBe(false)
    expect(esMapaFuenteJson(null)).toBe(false)
    expect(esMapaFuenteJson({ nombre: 'x' })).toBe(false)
  })

  it('rechaza brushes con un número de planos que no es múltiplo de 4', () => {
    // 4 floats por plano: un largo de 5 significa que el archivo está roto o
    // viene de otra versión del conversor.
    const roto = jsonDePrueba({ brushes: [{ planes: [0, 1, 0, 2, 7], min: [0, 0, 0], max: [1, 1, 1] }] })
    expect(esMapaFuenteJson(roto)).toBe(false)
  })
})

describe('escala: el mapa cargado mide lo que dice el JSON', () => {
  it('las dimensiones salen en metros, sin reaplicar metrosPorUnidad', () => {
    // El fallo más probable de toda esta integración es multiplicar (o
    // dividir) otra vez por 0.01905: el mapa quedaría 52 veces más chico o
    // más grande y seguiría cargando sin un solo error. Estos números son
    // los del JSON tal cual.
    const def = mapDefDesdeJson(jsonDePrueba(), 'prueba')
    expect(def.bounds.max.x - def.bounds.min.x).toBeCloseTo(20, 10)
    expect(def.bounds.max.y - def.bounds.min.y).toBeCloseTo(6, 10)
    expect(def.bounds.max.z - def.bounds.min.z).toBeCloseTo(20, 10)

    const piso = def.convexes?.[0]
    expect(piso).toBeDefined()
    expect(piso!.max.x - piso!.min.x).toBeCloseTo(20, 10)
    // El brush guarda el plano crudo del JSON, sin escalar: el plano
    // superior del piso está en y=0.
    expect(piso!.planes[3 * 4 + 3]).toBeCloseTo(0, 10)
  })

  it('un brush sin planos no entra a la colisión', () => {
    const def = mapDefDesdeJson(
      jsonDePrueba({ brushes: [{ planes: [], min: [0, 0, 0], max: [1, 1, 1] }] }),
      'prueba',
    )
    expect(def.convexes).toHaveLength(0)
  })
})

describe('validación de spawns', () => {
  // Cubo sólido de 4m de lado centrado en el origen: cualquier cosa adentro
  // está enterrada de verdad, no rozando una cara.
  const cubo = jsonDePrueba({
    brushes: [{ planes: planosDeCaja([-2, -2, -2], [2, 2, 2]), min: [-2, -2, -2], max: [2, 2, 2] }],
  })

  it('descarta un spawn que cae dentro de un brush', () => {
    const convexes = convexesDesdeJson(cubo)
    const utiles = spawnsUtilizables([[0, 0, 0]], convexes)
    expect(utiles).toHaveLength(0)
  })

  it('conserva un spawn al aire libre', () => {
    const convexes = convexesDesdeJson(cubo)
    const utiles = spawnsUtilizables([[10, 0, 10]], convexes)
    expect(utiles).toHaveLength(1)
    expect(utiles[0].x).toBe(10)
  })

  it('rescata subiéndolo un spawn apenas hundido, en vez de tirarlo', () => {
    // Techo del cubo en y=2; los pies 3 cm adentro. Subirlo unos
    // centímetros lo deja parado sobre el cubo -- tirarlo sería perder un
    // spawn perfectamente bueno.
    const convexes = convexesDesdeJson(cubo)
    const utiles = spawnsUtilizables([[0, 1.97, 0]], convexes)
    expect(utiles).toHaveLength(1)
    expect(utiles[0].y).toBeGreaterThan(2)
  })

  it('si NINGÚN spawn sobrevive, el mapa igual trae los crudos', () => {
    // Una lista vacía sería `spawns[0]` undefined en game.ts: pantalla
    // negra. Un jugador atascado se destraba respawneando.
    const def = mapDefDesdeJson(jsonDePrueba({ ...cubo, spawns: [[0, 0, 0]] }), 'prueba')
    expect(def.spawns).toHaveLength(1)
  })
})

describe('la colisión convexa realmente frena', () => {
  it('una cápsula empujada contra un muro convexo no lo atraviesa', () => {
    // Guard contra el modo de fallo silencioso: los brushes se cargan bien
    // pero nadie se los pasa a resolveMove, y el jugador camina a través del
    // mapa entero sin que ningún test se entere.
    const muro = mapDefDesdeJson(
      jsonDePrueba({
        brushes: [{ planes: planosDeCaja([1, -1, -5], [2, 3, 5]), min: [1, -1, -5], max: [2, 3, 5] }],
        spawns: [[0, 0, 0]],
      }),
      'muro',
    )
    const pos = vec3(0, 0, 0)
    const out: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }
    for (let i = 0; i < 40; i++) {
      resolveMove(pos, vec3(0.25, 0, 0), PLAYER_CAPSULE, muro.boxes, muro.convexes!, out)
    }
    // La cara del muro está en x=1 y la cápsula tiene radio 0.4.
    expect(pos.x).toBeLessThan(1 - PLAYER_CAPSULE.radius + 1e-3)
    expect(out.hitWall).toBe(true)
  })
})

/**
 * Contra el mapa real. Los archivos derivan del Steam Workshop y no viven en
 * el repo (ver docs/WORKSHOP.md): si no están, el test se saltea de forma
 * VISIBLE. `disponible` se evalúa al definir el test, antes de que el cuerpo
 * pueda tragarse un error y pasar en falso.
 */
describe('dm_nuketown real', () => {
  const RUTA = '/Users/santiago/dev/iagame/workshop-assets/maps-convertidos/dm_nuketown.json'
  const disponible = existsSync(RUTA)

  ;(disponible ? it : it.skip)('carga con escala creíble y ningún spawn enterrado', () => {
    const crudo: unknown = JSON.parse(readFileSync(RUTA, 'utf8'))
    expect(esMapaFuenteJson(crudo)).toBe(true)
    if (!esMapaFuenteJson(crudo)) return

    const def = mapDefDesdeJson(crudo, 'nuketown')

    // Escala: un mapa de FPS jugable mide decenas de metros. Al 2% serían
    // 4 m (más chico que el propio jugador) y a 52x, 10 km. El rango es
    // ancho a propósito: lo que atrapa es el error de factor, no un 10%.
    const ancho = def.bounds.max.x - def.bounds.min.x
    const alto = def.bounds.max.y - def.bounds.min.y
    expect(ancho).toBeGreaterThan(30)
    expect(ancho).toBeLessThan(1000)
    expect(alto).toBeGreaterThan(3)
    expect(alto).toBeLessThan(200)

    expect(def.convexes!.length).toBeGreaterThan(1000)

    // Los 32 spawns del mapa tienen que quedar utilizables. Cuando los
    // volúmenes de trigger se colaban como sólidos (ver esVolumenDeTrigger
    // en scripts/lib/bsp.ts) daban 0 de 32: este número es el detector de
    // esa clase de bug, no una cifra decorativa.
    expect(spawnsUtilizables(crudo.spawns, def.convexes!)).toHaveLength(crudo.spawns.length)
  })
})
