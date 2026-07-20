/**
 * Máquina de estados del menú de pausa y del pointer lock.
 *
 * Está separada del componente de React a propósito. El bug clásico de esta
 * funcionalidad no es de dibujo, es de estados: el menú se cierra, el
 * navegador no devuelve el puntero, y el jugador queda mirando el juego sin
 * poder mover la cámara -- o al revés, el puntero vuelve pero el menú sigue
 * tapando la pantalla y la mira gira sola detrás. Un componente de React no
 * se puede testear en el entorno `node` de este proyecto (vitest sólo
 * levanta `src/**\/*.test.ts`); esta máquina sí, y es donde vive el riesgo.
 *
 * El enemigo concreto: **Chrome bloquea `requestPointerLock()` durante
 * ~1.25 s después de que el usuario salió del lock con Escape.** Como la
 * única forma de abrir este menú ES apretar Escape, la petición de reanudar
 * que sale del click en "Reanudar" cae justo dentro de esa ventana casi
 * siempre. Si el código cerrara el menú al pedir el lock (que es lo obvio y
 * lo que uno escribiría primero), el resultado sería exactamente el bug de
 * arriba. Por eso existe el estado `'reanudando'`: se pidió el lock, todavía
 * no llegó, y la pantalla sigue mostrando ALGO en lo que el jugador puede
 * hacer click.
 *
 * La invariante que sostiene todo esto está testeada en pausa.test.ts:
 * a `'jugando'` -- el único estado sin overlay y con la simulación
 * corriendo -- sólo se entra por `'bloqueo-adquirido'`, o sea por
 * confirmación del navegador de que el puntero está capturado de verdad.
 * Nunca por optimismo.
 */

export type FasePausa =
  /** Todavía no se capturó el puntero ni una vez: pantalla de entrada. */
  | 'arranque'
  /** Puntero capturado, sin overlay, simulación corriendo. */
  | 'jugando'
  /** Menú de pausa abierto, simulación congelada. */
  | 'menu'
  /** Se pidió el puntero y no llegó todavía (enfriamiento de Escape). */
  | 'reanudando'
  /** La partida terminó: manda el resumen, este menú se aparta. */
  | 'final'

export type EventoPausa =
  /** `pointerlockchange` con el canvas capturado. */
  | 'bloqueo-adquirido'
  /** `pointerlockchange` sin el canvas capturado (Escape, alt-tab, blur). */
  | 'bloqueo-perdido'
  /** El jugador pidió volver al juego (botón Reanudar / Entrar / click). */
  | 'reanudar'
  /** El jugador pidió el menú sin tener el puntero (Escape en `reanudando`). */
  | 'menu-pedido'
  /** `matchState.phase === 'ended'`. */
  | 'partida-terminada'

export const FASE_INICIAL: FasePausa = 'arranque'

export function transicion(fase: FasePausa, evento: EventoPausa): FasePausa {
  // El final de partida gana sobre todo lo demás y es absorbente: una vez
  // que el resumen está en pantalla, ni Escape ni un pointerlockchange
  // tardío pueden meter un menú de pausa encima.
  if (evento === 'partida-terminada') return 'final'
  if (fase === 'final') return 'final'

  switch (evento) {
    // Única puerta de entrada a 'jugando', desde cualquier fase. Es la
    // confirmación del navegador, no una suposición nuestra.
    case 'bloqueo-adquirido':
      return 'jugando'

    // Perder el puntero jugando es SIEMPRE una pausa. No se distingue
    // Escape de alt-tab de perder el foco a propósito: en los tres casos el
    // jugador dejó de tener control, y seguir simulando mientras cinco bots
    // le disparan sería un castigo por cambiar de ventana.
    case 'bloqueo-perdido':
      return fase === 'jugando' ? 'menu' : fase

    // Se pide el lock y se ESPERA. La fase no se salta a 'jugando' -- ver
    // la cabecera del archivo.
    case 'reanudar':
      return 'reanudando'

    case 'menu-pedido':
      return 'menu'
  }
}

/** El menú de pausa completo (loadout, ajustes, salir). */
export function mostrarMenu(fase: FasePausa): boolean {
  return fase === 'menu'
}

/** Pantalla de entrada, antes del primer click de la partida. */
export function mostrarInicio(fase: FasePausa): boolean {
  return fase === 'arranque'
}

/**
 * Aviso mínimo de "hacé click para reanudar". Es la red bajo el
 * enfriamiento de Chrome: si `requestPointerLock()` fue rechazado, este
 * cartel es lo que le da al jugador algo que clickear para volver a
 * intentarlo, en vez de dejarlo con el juego congelado y sin explicación.
 */
export function mostrarReanudar(fase: FasePausa): boolean {
  return fase === 'reanudando'
}

/**
 * Si la simulación tiene que estar congelada.
 *
 * `'arranque'` NO congela: el juego ya corría antes de esta funcionalidad
 * mientras el jugador no había clickeado, y congelarlo dejaría la pantalla
 * en negro (nunca se habría dibujado un solo cuadro detrás del overlay de
 * entrada). `'final'` tampoco: el resumen se muestra sobre un mundo vivo.
 */
export function juegoPausado(fase: FasePausa): boolean {
  return fase === 'menu' || fase === 'reanudando'
}

/**
 * Si el overlay tiene que dejar pasar los clicks al canvas.
 *
 * Sólo en `'reanudando'`: ahí el canvas ya tiene su propio listener de
 * `click` que pide el pointer lock (engine/input.ts), así que dejar pasar
 * el click convierte cualquier lugar de la pantalla en el botón de
 * reanudar. En `'menu'` es al revés -- el overlay TIENE que comerse los
 * clicks, o clickear el fondo del menú recapturaría el puntero por atrás y
 * dejaría al jugador jugando a ciegas detrás de su propio menú.
 */
export function overlayTransparenteAlClick(fase: FasePausa): boolean {
  return fase === 'reanudando'
}
