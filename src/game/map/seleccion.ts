/**
 * De dónde sale el mapa de esta partida. Es lo ÚNICO de map/ que toca
 * `window`: la resolución en sí (qué gana sobre qué) sigue viviendo en
 * map/registry.ts como matemática pura y testeable.
 *
 * Existe como archivo aparte porque ahora hay dos lectores de la misma
 * decisión y no pueden discrepar: ui/GameCanvas.tsx la necesita ANTES de
 * armar el juego (para saber si tiene que bajar un mapa importado, que es
 * asíncrono) y game.ts la necesita después (para los mapas escritos en
 * código, que no requieren ninguna carga). Si cada uno leyera la query y el
 * localStorage por su cuenta, bastaría un `?map=` mal parseado en un lado
 * para que el jugador caminara sobre la colisión de un mapa y viera otro.
 */

import { MAP_STORAGE_KEY, findMapaExterno, type MapaExterno } from '@/game/map/registry'

export interface FuentesDeMapa {
  /** `?map=` de la URL. */
  fromQuery: string | null
  /** Lo último elegido en el panel de tuning (tecla M). */
  fromStorage: string | null
}

export function fuentesDeMapa(): FuentesDeMapa {
  const fromQuery = new URLSearchParams(window.location.search).get('map')
  let fromStorage: string | null = null
  try {
    fromStorage = window.localStorage.getItem(MAP_STORAGE_KEY)
  } catch {
    // localStorage puede tirar en modo privado o con cookies bloqueadas.
    // Un mapa recordado no vale una pantalla en blanco.
    fromStorage = null
  }
  return { fromQuery, fromStorage }
}

/**
 * Mapa importado que hay que bajar, o null si la partida va con uno de los
 * escritos en código.
 *
 * La URL manda por completo: si trae `?map=arena`, lo guardado en
 * localStorage ni se mira. Es la misma prioridad que aplica `resolveMap`
 * para los mapas de código -- y la razón por la que el panel de tuning
 * borra el `?map=` de la URL antes de recargar.
 */
export function mapaExternoSeleccionado(): MapaExterno | null {
  const { fromQuery, fromStorage } = fuentesDeMapa()
  if (fromQuery !== null) return findMapaExterno(fromQuery)
  return findMapaExterno(fromStorage)
}
