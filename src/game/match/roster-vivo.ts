/**
 * Agregar y sacar bots CON LA PARTIDA CORRIENDO, operando sobre las mismas
 * estructuras que usa el motor.
 *
 * Vive acá y no adentro de `createGame` por una razón concreta: `createGame`
 * necesita un canvas y una GPU, así que nada de lo que se defina adentro se
 * puede ejercitar en un test. Y el borde que esta tarea tenía que cuidar --
 * que el marcador y las estadísticas sobrevivan a que cambie la cantidad de
 * jugadores a mitad de partida -- es justamente el que hay que poder probar
 * a mano, no mirar en pantalla y suponer. Acá adentro no hay ni three, ni
 * DOM, ni renderer: sólo los arrays que el motor ya tenía.
 *
 * LO QUE NO HACE, Y POR QUÉ IMPORTA
 * No crea bots ni los revive. `agregarBot` deja al bot muerto con el
 * temporizador de respawn ya cumplido y lo empuja al roster activo; quien lo
 * pone en un spawn y le resetea la FSM, el camino y las memorias de
 * percepción es el camino de respawn que game.ts y bots/bot.ts ya tenían.
 * O sea que "entrar a la partida" y "reaparecer" son el mismo código. Un
 * alta propia sería una segunda forma de nacer, y la segunda es la que se
 * olvida de resetear algo y hace que el bot nuevo entre arrastrando el
 * estado del que se fue.
 *
 * La regla de quién entra a qué equipo y a quién se saca no está acá tampoco:
 * está en match/roster.ts, que es matemática sobre ids y no toca estado.
 */

import type { BotState } from '@/game/bots/bot'
import { BOTS } from '@/game/bots/tuning'
import { idDelBotASacar, puedeAgregar } from '@/game/match/roster'
import type { MatchTargets } from '@/game/match/targeting'

export interface RosterVivo {
  /** Todos los slots que el motor reservó al arrancar. Nunca cambia de largo. */
  readonly completo: readonly BotState[]
  /**
   * Los que están en cancha: SIEMPRE un prefijo de `completo` (ver la
   * cabecera de match/roster.ts). Es el array que los bucles de frame de
   * game.ts recorren, y el que `bots/renderer.ts` usa para saber cuántos
   * personajes dibujar.
   */
  readonly activos: BotState[]
  /** Posiciones y vida por id de participante, dimensionado al roster
   *  completo. Un bot estacionado tiene que quedar en `alive = false` o los
   *  demás le seguirían apuntando. */
  readonly targets: MatchTargets
  /** Paralelo a `completo`: si el bot estaba vivo el tick anterior. game.ts
   *  lo usa para detectar el flanco de reaparición. */
  readonly estabaVivo: boolean[]
  /** Ranked: roster cerrado (match/configuracion.ts). */
  readonly editable: boolean
  /**
   * La marca de agua: la mayor cantidad de bots que estuvo en cancha en
   * cualquier momento de la partida.
   *
   * Es lo que hace que EL MARCADOR SOBREVIVA a sacar un bot. Las
   * estadísticas se indexan por id y viven en un array del tamaño del roster
   * completo (game.ts), pero mostrar ese array entero llenaría el marcador
   * de filas fantasma de bots que nunca entraron. Y mostrar sólo los que
   * están en cancha AHORA borraría del marcador a un bot que peleó y se fue,
   * perdiendo historia real de la partida. La marca de agua es el punto
   * medio honesto: se muestran los participantes 0..marcaDeAgua, o sea el
   * jugador más todo bot que ALGUNA VEZ jugó (incluido el que ya salió), y
   * nada más. Como la activación es un prefijo, ese conjunto es exactamente
   * `1 + maxBotsActivos`.
   */
  maxBotsActivos: number
}

/**
 * `activos` se recibe YA CONSTRUIDO y se guarda POR REFERENCIA, no se copia.
 * Es deliberado y es la mitad del diseño: game.ts le pasa el mismo array que
 * recorren sus bucles de frame, así que cuando `agregarBot` le hace push, el
 * motor ve el bot nuevo sin que nadie tenga que avisarle. Copiarlo acá
 * dejaría dos rosters que se irían separando en silencio -- el que la tecla
 * modifica y el que el juego dibuja.
 */
export function crearRosterVivo(
  completo: readonly BotState[],
  activos: BotState[],
  targets: MatchTargets,
  estabaVivo: boolean[],
  editable: boolean,
): RosterVivo {
  const roster: RosterVivo = {
    completo,
    activos,
    targets,
    estabaVivo,
    editable,
    maxBotsActivos: activos.length,
  }
  // Los slots que no arrancan en cancha nacen estacionados. Sin esto
  // quedarían vivos, invisibles e intocables pero APUNTABLES: los bots
  // reales se pasarían la partida mirando fantasmas.
  for (let i = roster.activos.length; i < completo.length; i++) estacionarBot(roster, i)
  return roster
}

/**
 * Saca a un bot de la cancha SIN borrarlo. Queda muerto, intocable y fuera
 * del apuntado de los demás, pero su fila del marcador queda intacta: los
 * kills que hizo antes de salir siguen en `matchState.participants[id]`,
 * porque ese array se indexa por id y nunca se compacta.
 *
 * Radio de hitbox en cero es el MISMO truco con el que este motor ya hacía
 * intocable a un cadáver (syncBotHitboxes en bots/bot.ts) y a un recién
 * reaparecido (la ventana de invulnerabilidad en game.ts): un disparo no
 * puede intersectar una esfera de radio 0. Por eso alcanza con esto y no
 * hace falta reconstruir las listas de hitboxes enemigas por participante --
 * que es justo lo que habría asignado memoria en medio de una partida.
 */
export function estacionarBot(roster: RosterVivo, indice: number): void {
  const bot = roster.completo[indice]
  if (bot === undefined) return
  bot.health.alive = false
  bot.health.health = 0
  bot.health.respawnT = 0
  for (const hitbox of bot.hitboxes) hitbox.radius = 0
  roster.targets.alive[indice + 1] = false
  roster.estabaVivo[indice] = false
}

/**
 * Mete un bot más, en el equipo con menos gente (eso lo garantiza el prefijo,
 * ver match/roster.ts). `false` si no se pudo: roster lleno, partida
 * terminada o ranked.
 */
export function agregarBot(roster: RosterVivo, partidaTerminada: boolean): boolean {
  if (!roster.editable) return false
  if (partidaTerminada) return false
  if (!puedeAgregar(roster.activos.length)) return false

  const indice = roster.activos.length
  const bot = roster.completo[indice]
  bot.health.alive = false
  bot.health.health = 0
  // Respawn ya cumplido: revive en el próximo tick, no dentro de tres
  // segundos. Apretar la tecla y no ver nada aparecer se lee como que no
  // funcionó.
  bot.health.respawnT = BOTS.respawnDelayS
  roster.estabaVivo[indice] = false
  roster.activos.push(bot)
  // Sube la marca de agua si este alta agranda el roster más que nunca. No
  // baja al sacar: un bot que jugó y se fue conserva su fila en el marcador.
  if (roster.activos.length > roster.maxBotsActivos) roster.maxBotsActivos = roster.activos.length
  return true
}

/**
 * Saca al último bot que entró. `false` si ya está en el piso, si la partida
 * terminó o si es ranked.
 *
 * "El último que entró" es la regla que pidió la tarea, y es la única que un
 * jugador puede anticipar sin abrir el marcador: apretar agregar y sacar
 * seguido deja la partida como estaba.
 */
export function quitarBot(roster: RosterVivo, partidaTerminada: boolean): boolean {
  if (!roster.editable) return false
  if (partidaTerminada) return false
  const id = idDelBotASacar(roster.activos.length)
  if (id < 0) return false
  roster.activos.pop()
  estacionarBot(roster, id - 1)
  return true
}
