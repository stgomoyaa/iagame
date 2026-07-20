/**
 * Catálogo VISUAL de medallas y prestigios. **No es un sistema de juego y no
 * debe convertirse en uno.**
 *
 *
 * POR QUÉ ESTO VIVE EN `ui/` Y NO EN `game/progression/`
 *
 * Los sistemas reales de medallas y prestigio se están construyendo aparte,
 * en `game/progression/`. Esta pantalla no los implementa: sólo necesita
 * saber **cómo se llaman las 15 medallas y los 10 prestigios** para poder
 * dibujarlos en silueta apagada, que es el estado vacío honesto mientras el
 * sistema no exista.
 *
 * Por eso acá hay nombres, descripciones, glifos y colores, y NADA más:
 *
 * - **No hay condiciones de disparo.** Cuándo se gana una medalla lo decide
 *   el sistema real, no la capa de presentación.
 * - **No hay contadores.** Ni un cero de relleno, ni un "0/15" inventado. Un
 *   contador implica que alguien lo está llevando, y hoy nadie lo lleva.
 * - **No hay persistencia.** Nada de esto se guarda ni se lee del guardado.
 *
 * Si alguna vez aparece acá una función que decide si una medalla se ganó,
 * está en el archivo equivocado.
 *
 *
 * CÓMO SE CONECTA CON EL SISTEMA REAL (punto de enganche)
 *
 * Ver `ui/Medallas.tsx` y `ui/Prestigio.tsx`: cada uno documenta arriba la
 * forma de datos exacta que espera recibir. En resumen, las pantallas
 * necesitan una función que, dado el guardado, devuelva:
 *
 *   medallas:  ReadonlyMap<string, number>   // clave -> veces conseguida
 *   prestigio: { nivel: number } | null      // null = todavía no entró
 *
 * Las claves de medalla son las de `MEDALLAS_VISUALES` de abajo. Mientras esa
 * función no exista, las pantallas muestran el estado vacío.
 */

/** Lo que la UI necesita para dibujar una medalla. Presentación pura. */
export interface MedallaVisual {
  /** Identificador estable. El sistema real debería usar estas mismas
   *  claves para que conectar sea cambiar de dónde salen los conteos. */
  readonly key: string
  readonly nombre: string
  /** Condición, redactada para el jugador. Es texto de diseño: describe qué
   *  haría ganarla, no la evalúa nadie. */
  readonly desc: string
  /** Glifo de respaldo mientras no exista `medalla-<key>.png`. */
  readonly glyph: string
  readonly color: string
}

/** Las 15 medallas del diseño, en el orden del diseño. */
export const MEDALLAS_VISUALES: readonly MedallaVisual[] = [
  { key: 'firstblood', nombre: 'PRIMERA SANGRE', desc: 'Consigue la primera baja de la partida.', glyph: '✦', color: '#ff5d6c' },
  { key: 'headhunter', nombre: 'HEADHUNTER', desc: '10 headshots en una sola partida.', glyph: '◎', color: '#46f08a' },
  { key: 'clutch', nombre: 'CLUTCH', desc: 'Gana un enfrentamiento 1vX en desventaja.', glyph: '◆', color: '#a06bff' },
  { key: 'triple', nombre: 'TRIPLE', desc: '3 bajas en menos de 5 segundos.', glyph: '▲', color: '#ffce4d' },
  { key: 'racha', nombre: 'RACHA', desc: 'Racha de 5 bajas sin morir.', glyph: '⚡', color: '#4fe3cf' },
  { key: 'racha10', nombre: 'IMPARABLE', desc: 'Racha de 10 bajas sin morir.', glyph: '⚡', color: '#7bb0ff' },
  { key: 'melee', nombre: 'CUERPO A CUERPO', desc: 'Baja con arma cuerpo a cuerpo.', glyph: '✕', color: '#c9ced6' },
  { key: 'longshot', nombre: 'LONG SHOT', desc: 'Baja a larga distancia con sniper.', glyph: '⊹', color: '#7bb0ff' },
  { key: 'collateral', nombre: 'COLATERAL', desc: '2 bajas con una sola bala.', glyph: '⇥', color: '#a06bff' },
  { key: 'flawless', nombre: 'INTACTO', desc: 'Termina la partida sin morir.', glyph: '❖', color: '#fff2c4' },
  { key: 'mvp', nombre: 'MVP', desc: 'Mejor puntaje de la partida.', glyph: '★', color: '#ffce4d' },
  { key: 'sharpshooter', nombre: 'PUNTERÍA', desc: 'Cierra la partida con HS% sobre 40.', glyph: '◈', color: '#46f08a' },
  { key: 'comeback', nombre: 'REMONTADA', desc: 'Gana tras ir perdiendo por 10 o más.', glyph: '↺', color: '#ff9a3c' },
  { key: 'demolition', nombre: 'DEMOLICIÓN', desc: 'Daño total sobre 4000 en una partida.', glyph: '◼', color: '#ff5d6c' },
  { key: 'survivor', nombre: 'SUPERVIVIENTE', desc: 'Termina con vida bajo 10 tras un clutch.', glyph: '✚', color: '#3fe07e' },
]

export interface PrestigioVisual {
  /** 1..10. */
  readonly level: number
  readonly roman: string
  readonly color: string
  /** Qué desbloquearía. Todas las recompensas son cosméticas por diseño. */
  readonly reward: string
}

const ROMANOS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'] as const

/** Los 10 prestigios propuestos, de I a X. */
export const PRESTIGIOS_VISUALES: readonly PrestigioVisual[] = [
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
].map((p, i) => ({ ...p, level: i + 1, roman: ROMANOS[i] }))
