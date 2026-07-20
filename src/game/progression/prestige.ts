/**
 * Catálogo de prestigios. **El sistema de prestigio no existe**, y este
 * archivo es deliberadamente un catálogo y no un sistema.
 *
 *
 * POR QUÉ ESTE SÍ SE QUEDÓ SIN IMPLEMENTAR (Y LAS MEDALLAS NO)
 *
 * Las medallas se pudieron construir a medias porque una medalla es aditiva:
 * suma un contador y no le saca nada al jugador. El prestigio es lo
 * contrario. Entrar en prestigio, según el diseño, **reinicia tu nivel a 1 y
 * te vuelve a bloquear las armas**. Eso toca:
 *
 * - `unlocks.ts`, que decide qué armas están disponibles a partir del nivel.
 * - `loadout.ts`, que renormaliza el loadout cuando cambian los desbloqueos:
 *   un prestigio le arranca de las manos el arma equipada al jugador.
 * - `store.ts`, que hoy deriva el nivel de la XP con `levelForXp(xp)`. Con
 *   prestigio, el nivel deja de ser una función de la XP y pasa a ser
 *   `f(xp, prestigio)`, o hay que resetear la XP y perder el total histórico.
 *
 * Ninguna de esas tres es una decisión de UI y ninguna está especificada:
 * cuál de las dos formas toma el nivel es exactamente el tipo de cosa que
 * define cómo se siente el juego a las 40 horas. Implementarla acá sería
 * inventar el diseño, no portarlo. Persistir un campo `prestigio` que nada
 * escribe sería peor: un cero que parece un dato.
 *
 * Así que la pantalla muestra **la escalera propuesta como catálogo** (los
 * 10 niveles y sus recompensas son especificación del dueño, no relleno) y
 * mide el único dato verdadero que hay: cuánto le falta al jugador para
 * llegar al nivel donde el prestigio se habilitaría. Ese número sale de
 * `levelForXp` sobre su XP real.
 */

import { nivelMaximoDeDesbloqueo } from '@/game/progression/unlocks'

export interface PrestigeDef {
  /** 1..10. */
  readonly level: number
  readonly roman: string
  readonly color: string
  /** Qué desbloquea. Todas las recompensas son cosméticas por diseño: el
   *  prestigio no puede comprar ventaja de jugabilidad. */
  readonly reward: string
}

const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'] as const

const RECOMPENSAS: readonly { color: string; reward: string }[] = [
  { color: '#c07f43', reward: 'Insignia de Prestigio I y color de callsign en bronce.' },
  { color: '#d7935a', reward: 'Charm de arma exclusivo del nivel, visible en el loadout.' },
  { color: '#c9ced6', reward: 'Banner de perfil animado para la tarjeta de jugador.' },
  { color: '#e0e6ee', reward: 'Marco propio para tu tarjeta de fin de partida.' },
  { color: '#ffce4d', reward: 'Efecto de eliminación (kill effect) al confirmar una baja.' },
  { color: '#ffd95e', reward: 'Insignia de Prestigio VI y spray de perfil.' },
  { color: '#4fe3cf', reward: 'Título de jugador visible en killfeed y marcador.' },
  { color: '#7bb0ff', reward: 'Skin universal aplicable a cualquier arquetipo.' },
  { color: '#a06bff', reward: 'Tracer (rastro de bala) de color para todo el loadout.' },
  { color: '#fff2c4', reward: 'Insignia Maestro animada y efecto galaxia permanente en el perfil.' },
]

/** Los 10 prestigios propuestos, de I a X. */
export const PRESTIGIOS: readonly PrestigeDef[] = RECOMPENSAS.map((p, i) => ({
  ...p,
  level: i + 1,
  roman: ROMANOS[i],
}))

/**
 * Nivel de cuenta al que el prestigio se habilitaría. No es una constante
 * escrita a mano: sale del último desbloqueo real del catálogo de armas, que
 * es lo que el diseño llama "nivel 25". Si el pack crece y la última arma se
 * corre a nivel 27, este número la sigue sola en vez de quedar mintiendo.
 */
export function nivelParaPrestigio(): number {
  return nivelMaximoDeDesbloqueo()
}

/** ¿El jugador llegó al techo de nivel? Único dato real de esta pantalla. */
export function puedeEntrarEnPrestigio(nivelCuenta: number): boolean {
  return nivelCuenta >= nivelParaPrestigio()
}
