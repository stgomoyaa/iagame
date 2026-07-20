/**
 * Las invariantes que cumple TODO mapa del registry, corridas sobre los tres
 * a la vez. map/arena.test.ts sigue existiendo aparte porque prueba detalles
 * de ESE mapa (el corredor de dianas, las cajas concretas que se movieron
 * para matar un bug); esto de acá es lo que un mapa nuevo tiene que pasar
 * para ser jugable.
 */

import { describe, expect, it } from 'vitest'
import {
  buildMainComponentMask,
  buildNavGrid,
  nearestWalkableCellIndex,
} from '@/game/bots/navgrid'
import { buildPatrolGraph } from '@/game/bots/patrol'
import {
  coberturaParable,
  murosEscalables,
  spawnsDentroDeSolido,
  superficiesInalcanzables,
} from '@/game/map/invariants'
import {
  DEFAULT_MAP_NAME,
  MAPAS_EXTERNOS,
  MAPS,
  findMap,
  findMapaExterno,
  mapNames,
  resolveMap,
} from '@/game/map/registry'
import { ARENA } from '@/game/map/arena'

describe.each(MAPS.map((m) => [m.name, m] as const))('mapa %s', (_nombre, map) => {
  it('toda caja tiene min estrictamente menor que max en los tres ejes', () => {
    for (const b of map.boxes) {
      expect(b.max.x).toBeGreaterThan(b.min.x)
      expect(b.max.y).toBeGreaterThan(b.min.y)
      expect(b.max.z).toBeGreaterThan(b.min.z)
    }
  })

  it('tiene al menos 8 spawns, todos dentro de los límites', () => {
    expect(map.spawns.length).toBeGreaterThanOrEqual(8)
    for (const s of map.spawns) {
      expect(s.x).toBeGreaterThan(map.bounds.min.x)
      expect(s.x).toBeLessThan(map.bounds.max.x)
      expect(s.z).toBeGreaterThan(map.bounds.min.z)
      expect(s.z).toBeLessThan(map.bounds.max.z)
    }
  })

  it('ningún spawn queda dentro de una caja sólida', () => {
    expect(spawnsDentroDeSolido(map)).toEqual([])
  })

  it('el conteo de cajas se mantiene bajo el presupuesto de draw calls', () => {
    // Todo el mapa se fusiona en una geometría (map/mesh.ts): el conteo no
    // cambia los draw calls, pero sí el tamaño del buffer y el costo del
    // bake del navgrid, que recorre todas las cajas por celda.
    expect(map.boxes.length).toBeLessThanOrEqual(200)
  })

  it('toda plataforma es alcanzable por una cadena de escalones desde el piso', () => {
    const inalcanzables = superficiesInalcanzables(map)
    expect(
      inalcanzables.map((b) => `[${b.min.x},${b.min.z}]->[${b.max.x},${b.max.z}] tope ${b.max.y}`),
    ).toEqual([])
  })

  it('ninguna cobertura que bloquea la vista queda parable encadenando saltos', () => {
    const parables = coberturaParable(map)
    expect(parables.map((b) => `[${b.min.x},${b.min.z}]->[${b.max.x},${b.max.z}]`)).toEqual([])
  })

  it('ningún muro declarado es escalable de verdad', () => {
    // Sin esto, declarar `wallHeight` sería la puerta de atrás para que
    // cualquier mapa pase los dos chequeos de arriba: alcanza con poner toda
    // la geometría incómoda a la altura de muro.
    const escalables = murosEscalables(map)
    expect(escalables.map((b) => `[${b.min.x},${b.min.z}] tope ${b.max.y}`)).toEqual([])
  })

  it('todos los spawns caen en el mismo componente conexo del navgrid', () => {
    const grid = buildNavGrid(map)
    const mask = buildMainComponentMask(grid)
    for (let i = 0; i < map.spawns.length; i++) {
      const s = map.spawns[i]
      const idx = nearestWalkableCellIndex(grid, s.x, s.z, 4, mask)
      expect(idx, `spawn ${i} (${s.x}, ${s.z}) no llega al componente principal`).toBeGreaterThanOrEqual(0)
    }
  })

  it('la red de patrulla tiene nodos y todos son alcanzables', () => {
    // El defecto que este test evita es concreto: "caminable" incluye el
    // techo de los muros y de la cobertura alta. Un nodo de patrulla ahí
    // arriba es un destino imposible, y el bot que lo elige quema una
    // petición de camino por ciclo hasta que le toca otro.
    const grid = buildNavGrid(map)
    const mask = buildMainComponentMask(grid)
    const graph = buildPatrolGraph(grid)

    expect(graph.count).toBeGreaterThanOrEqual(8)
    for (let i = 0; i < graph.count; i++) {
      expect(mask[graph.cell[i]], `nodo ${i} en (${graph.x[i]}, ${graph.z[i]}) es inalcanzable`).toBe(1)
    }

    const centro = nearestWalkableCellIndex(grid, graph.centerX, graph.centerZ, 4, mask)
    expect(centro, 'el centro de patrulla es inalcanzable').toBeGreaterThanOrEqual(0)
  })
})

describe('registry de mapas', () => {
  it('hay tres mapas escritos en código, y mapNames() suma los importados sin repetir', () => {
    expect(MAPS.length).toBe(3)
    // mapNames() alimenta el desplegable del panel de tuning: además de los
    // tres de código lista los mapas importados de Source (MAPAS_EXTERNOS).
    // Los nombres tienen que seguir siendo únicos entre las dos fuentes, o
    // elegir uno en el panel cargaría el otro.
    const nombres = mapNames()
    expect(nombres).toHaveLength(MAPS.length + MAPAS_EXTERNOS.length)
    expect(new Set(nombres).size).toBe(nombres.length)
    for (const m of MAPS) expect(findMapaExterno(m.name)).toBeNull()
  })

  it('findMap resuelve por nombre y devuelve null si no existe', () => {
    expect(findMap('arena')).toBe(ARENA)
    expect(findMap('no-existe')).toBeNull()
    expect(findMap(null)).toBeNull()
  })

  it('la URL gana sobre lo guardado, y un nombre inválido cae al mapa por defecto', () => {
    expect(resolveMap('bunker', 'torre').name).toBe('bunker')
    expect(resolveMap(null, 'torre').name).toBe('torre')
    expect(resolveMap('no-existe', 'torre').name).toBe('torre')
    expect(resolveMap(null, null).name).toBe(DEFAULT_MAP_NAME)
    expect(resolveMap('no-existe', 'tampoco').name).toBe(DEFAULT_MAP_NAME)
  })
})
