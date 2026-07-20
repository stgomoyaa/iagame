/**
 * Mide el tamaño de cada mapa PARA EL MENÚ, cacheando el resultado.
 *
 * La matemática de "qué tan grande es un mapa" vive en
 * match/tamano-mapa.ts (pura, testeable, sin red). Este archivo es sólo el
 * borde con `window`: los mapas escritos en código se miden al instante,
 * pero un mapa importado de Source hay que BAJARLO primero (su colisión es
 * un JSON de cientos de kB), así que su medición es asíncrona. Mismo reparto
 * que map/seleccion.ts, que es lo único de map/ que toca la red.
 *
 * POR QUÉ NO UNA TABLA `{ nuketown: 'grande' }`
 * Porque se desactualiza al siguiente mapa que se importe (ver la cabecera
 * de match/tamano-mapa.ts). Acá el tamaño sale de la geometría del propio
 * mapa, así que un mapa nuevo se mide solo -- el costo es bajar su JSON una
 * vez, que igual hay que bajar para jugarlo.
 *
 * CACHÉ EN MEMORIA
 * Medir nuketown hornea un navgrid de 200x181 celdas: no es gratis. Se hace
 * una vez por carga de página y se guarda en un Map de módulo, así que
 * volver al menú durante la misma sesión es instantáneo. No se persiste en
 * localStorage a propósito: una medición guardada quedaría mintiendo si el
 * mapa se reimporta con otra geometría, y no vale ese riesgo por ahorrar un
 * horneado por sesión.
 */

import { findMap, findMapaExterno, MAPS, MAPAS_EXTERNOS, type MapaExterno } from '@/game/map/registry'
import { esMapaFuenteJson, mapDefDesdeJson } from '@/game/map/source-map'
import { medirMapa, type MedidaMapa } from '@/game/match/tamano-mapa'

const cache = new Map<string, MedidaMapa>()

/**
 * Medida de un mapa de CÓDIGO (arena, torre, bunker). Sincrónica: su
 * geometría ya está en memoria, no hay nada que bajar. `null` si el nombre
 * no es un mapa de código.
 */
export function medirMapaDeCodigo(nombre: string): MedidaMapa | null {
  const cacheada = cache.get(nombre)
  if (cacheada !== undefined) return cacheada
  const def = findMap(nombre)
  if (def === null) return null
  const medida = medirMapa(def)
  cache.set(nombre, medida)
  return medida
}

/**
 * Medida de un mapa IMPORTADO. Baja su JSON de colisión (no el GLB visual de
 * 8 MB, que no hace falta para medir), lo valida y lo mide. Devuelve `null`
 * si el archivo no está o no tiene la forma esperada -- mismo criterio que
 * el resto de map/: un mapa que no se puede medir no rompe el menú, sólo se
 * muestra sin tamaño.
 */
export async function medirMapaExterno(mapa: MapaExterno): Promise<MedidaMapa | null> {
  const cacheada = cache.get(mapa.name)
  if (cacheada !== undefined) return cacheada
  try {
    const respuesta = await fetch(mapa.json)
    if (!respuesta.ok) return null
    const crudo: unknown = await respuesta.json()
    if (!esMapaFuenteJson(crudo)) return null
    const medida = medirMapa(mapDefDesdeJson(crudo, mapa.name))
    cache.set(mapa.name, medida)
    return medida
  } catch {
    // Sin red, o JSON corrupto: el menú se dibuja igual, sólo sin la etiqueta
    // de tamaño de este mapa.
    return null
  }
}

/**
 * Medida de cualquier mapa por nombre, venga de código o importado. La ruta
 * de código es sincrónica por dentro; la envuelve en una promesa para que el
 * llamador tenga UNA sola forma de pedir una medida.
 */
export async function medirPorNombre(nombre: string): Promise<MedidaMapa | null> {
  const deCodigo = medirMapaDeCodigo(nombre)
  if (deCodigo !== null) return deCodigo
  const externo = findMapaExterno(nombre)
  if (externo === null) return null
  return medirMapaExterno(externo)
}

/** Nombres de todos los mapas jugables, código primero (los que se miden sin
 *  red), después los importados. Alimenta el orden en que el menú los lista y
 *  los mide. */
export function nombresDeMapas(): string[] {
  return [...MAPS.map((m) => m.name), ...MAPAS_EXTERNOS.map((m) => m.name)]
}
