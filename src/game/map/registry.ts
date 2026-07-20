/**
 * Los mapas jugables y cómo se elige uno. Matemática y datos puros: el
 * acceso a `window` (query string, localStorage) vive en el llamador
 * (game.ts), acá sólo entra el texto ya leído -- así los tests pueden
 * ejercitar la resolución sin DOM.
 */

import { ARENA } from '@/game/map/arena'
import { BUNKER } from '@/game/map/bunker'
import { TORRE } from '@/game/map/torre'
import type { MapDef } from '@/game/map/types'

export const MAPS: readonly MapDef[] = [ARENA, TORRE, BUNKER]

export const DEFAULT_MAP_NAME = ARENA.name

/**
 * Un mapa que NO está escrito en código sino importado de Source: dos
 * archivos servidos desde /public que hay que bajar antes de poder jugarlo
 * (ver map/external-map.ts).
 */
export interface MapaExterno {
  name: string
  /** Colisión + spawns, salida de scripts/bsp-convert.ts. */
  json: string
  /** Malla visual texturizada, salida de scripts/map-textures.ts. */
  glb: string
}

/**
 * Los archivos NO están en el repo: derivan del Steam Workshop y viven en
 * `workshop-assets/`, que nunca se commitea (ver docs/WORKSHOP.md y
 * scripts/workshop-guard.test.ts). Hay que copiarlos a mano a
 * `public/assets/maps/`, que también está gitignoreado. Si faltan, elegir
 * este mapa cae al mapa por defecto con un error en consola en vez de
 * romper la partida.
 */
export const MAPAS_EXTERNOS: readonly MapaExterno[] = [
  {
    name: 'nuketown',
    json: '/assets/maps/dm_nuketown.json',
    glb: '/assets/maps/dm_nuketown.glb',
  },
  {
    name: 'lasertag',
    json: '/assets/maps/gm_lasertag_arena.json',
    glb: '/assets/maps/gm_lasertag_arena.glb',
  },
]

export function findMapaExterno(name: string | null): MapaExterno | null {
  if (name === null) return null
  for (const m of MAPAS_EXTERNOS) {
    if (m.name === name) return m
  }
  return null
}

/** Clave de localStorage que usa el panel de debug para recordar el mapa
 *  elegido entre recargas. */
export const MAP_STORAGE_KEY = 'iagame.map'

/** Nombres elegibles: los mapas de código Y los importados. Alimenta el
 *  desplegable del panel de tuning (tecla M) y documenta qué acepta `?map=`. */
export function mapNames(): string[] {
  return [...MAPS.map((m) => m.name), ...MAPAS_EXTERNOS.map((m) => m.name)]
}

export function findMap(name: string | null): MapDef | null {
  if (name === null) return null
  for (const m of MAPS) {
    if (m.name === name) return m
  }
  return null
}

/**
 * Mapa activo a partir de las dos fuentes posibles, en orden de prioridad:
 * la URL (`?map=`) gana sobre lo guardado por el panel, y un nombre que no
 * existe cae al mapa por defecto en vez de romper la partida.
 */
export function resolveMap(fromQuery: string | null, fromStorage: string | null): MapDef {
  return findMap(fromQuery) ?? findMap(fromStorage) ?? ARENA
}
