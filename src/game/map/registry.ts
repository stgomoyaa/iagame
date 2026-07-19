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

/** Clave de localStorage que usa el panel de debug para recordar el mapa
 *  elegido entre recargas. */
export const MAP_STORAGE_KEY = 'iagame.map'

export function mapNames(): string[] {
  return MAPS.map((m) => m.name)
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
