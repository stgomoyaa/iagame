/**
 * Modo práctica: de dónde sale la decisión de poblar la arena con dianas.
 *
 * Las dianas (targets/) se construyeron en la fase 1, cuando todavía no
 * existían los bots. Al llegar la fase 2 quedaron apareciendo DURANTE la
 * partida: esferas azules sin silueta humanoide mezcladas con los bots, que
 * ensucian la lectura de a qué se le puede disparar. Un objetivo que se ve
 * distinto a todo lo demás y no cuenta para el puntaje es ruido visual en
 * medio de un tiroteo, no una ayuda.
 *
 * La decisión vive acá, en un archivo aparte y sin dependencias, por el
 * mismo motivo que map/seleccion.ts: es lo ÚNICO de targets/ que toca
 * `window`, y hay dos lectores de la misma respuesta dentro de game.ts (si
 * se crean las dianas y cuántos bots poblar). Si cada uno leyera la query
 * por su cuenta, un `?practica=` mal parseado en un lado dejaría una
 * partida con dianas Y bots, que es justo el estado que esto viene a
 * eliminar.
 *
 * CÓMO SE ENTRA: `?practica=1` en la URL (mismo patrón que `?debug=1` y
 * `?bots=N`). Sin ese parámetro no hay una sola diana en pantalla, en
 * ningún mapa. Documentado también en README.md.
 */

/** Valores de `?practica=` que cuentan como "sí". Cualquier otra cosa
 *  (incluido `?practica=0`) deja el modo partida normal: ante una URL
 *  ambigua, la respuesta segura es la partida sin dianas. */
const VALORES_AFIRMATIVOS = ['1', 'true', 'si', 'sí']

export function esModoPractica(): boolean {
  const raw = new URLSearchParams(window.location.search).get('practica')
  if (raw === null) return false
  return VALORES_AFIRMATIVOS.includes(raw.toLowerCase())
}
