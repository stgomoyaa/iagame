/**
 * Cuántos bots hay en la partida y en qué equipo cae cada uno, cuando ese
 * número puede cambiar A MITAD DE PARTIDA (una tecla agrega, otra saca).
 *
 * LA IDEA CENTRAL: EL ROSTER ACTIVO ES SIEMPRE UN PREFIJO
 *
 * El equipo de un participante NO se guarda en ningún lado: se deriva de la
 * paridad de su id (match/types.ts teamForParticipant). Eso ya era así antes
 * de que los bots pudieran entrar y salir, y cambiarlo habría obligado a
 * tocar el puntaje, el color del personaje, las listas de hitboxes enemigas
 * y el tracker de medallas -- cinco lugares que hoy no pueden discrepar
 * justamente porque leen la misma función.
 *
 * Así que en vez de inventar una tabla de equipos, el roster activo se
 * mantiene como un PREFIJO de ids: 0 (el jugador) más los bots 1..N. Agregar
 * es activar el id N+1; sacar es desactivar el id N. De esa única regla
 * salen gratis las tres cosas que la tarea pedía cuidar:
 *
 *  1. **El bot nuevo entra al equipo con menos gente.** Con ids 0..N
 *     repartidos por paridad, el equipo 0 tiene floor(N/2)+1 y el equipo 1
 *     tiene floor((N+1)/2): el equipo 0 nunca va por detrás, y va uno
 *     adelante exactamente cuando N es par. El id siguiente, N+1, es impar
 *     justo en ese caso -- o sea que cae en el equipo 1, el que estaba
 *     corto. Cuando los equipos ya están parejos, va al 0 y quedan
 *     desparejos por uno, que es lo mejor posible con un número impar de
 *     jugadores. Ver `equipoDelProximoBot` y su test.
 *  2. **Sacar es predecible.** Sale el último que entró (el id más alto),
 *     que es lo que la tarea pide explícitamente y lo único que un jugador
 *     puede anticipar sin mirar el marcador.
 *  3. **Ningún equipo queda en cero.** Con el piso de `MIN_BOTS` = 1 hay
 *     siempre al menos los ids 0 y 1, o sea un jugador en cada equipo.
 *
 * Los nombres tampoco pueden repetirse, y por la misma clase de razón: la
 * etiqueta sale de `BOT_NAMES[id]` (ui/participant-label.ts) y los ids
 * activos son distintos entre sí por construcción. Mientras el roster entero
 * quepa en la lista de nombres no hay forma de que dos bots vivos compartan
 * nombre -- eso es lo que blinda `MAX_PARTICIPANTES <= BOT_NAMES.length` en
 * roster.test.ts, y es la razón de que el tope viva acá y no en un número
 * suelto en game.ts.
 */

import { teamForParticipant, type MatchMode } from '@/game/match/types'

/**
 * Tope duro de participantes de una partida, jugador incluido: 16, o sea
 * 8v8 en TDM.
 *
 * Es un techo de PRESUPUESTO, no de diseño. El motor reserva todo lo que un
 * participante necesita (estadísticas, hitboxes, posiciones, personaje
 * dibujado, mixer de animación) UNA vez al crear la partida, para el roster
 * completo, y agregar un bot sólo enciende un slot que ya existía -- así la
 * tecla no asigna memoria en medio de una partida y el presupuesto de 2.5 ms
 * por frame no depende de cuántas veces se apretó. El costo de ese diseño es
 * que el máximo hay que fijarlo antes de empezar, y 16 es el número que deja
 * jugar bastante más que el preset más grande (6v6) sin reservar personajes
 * que nadie va a usar nunca.
 *
 * OJO: el costo de frame con el roster lleno NO está medido todavía. Ver el
 * informe de la tarea.
 */
export const MAX_PARTICIPANTES = 16

/** Bots mínimos. Uno, no cero: con el jugador solo en el mapa no hay partida,
 *  y en TDM el equipo 1 quedaría vacío (ver la cabecera). */
export const MIN_BOTS = 1

/** Bots máximos, derivado del tope de participantes: el jugador ocupa uno. */
export const MAX_BOTS = MAX_PARTICIPANTES - 1

/**
 * ¿A qué equipo entraría el próximo bot si el roster activo hoy tiene
 * `botsActivos` bots (más el jugador)? Pura -- no cambia nada, sólo dice qué
 * va a pasar, para poder afirmarlo en un test y mostrarlo en la UI.
 */
export function equipoDelProximoBot(mode: MatchMode, botsActivos: number): number {
  return teamForParticipant(mode, botsActivos + 1)
}

/** Cuántos participantes activos tiene `team` con `botsActivos` bots en
 *  cancha. Cuenta al jugador (id 0). */
export function tamanoDeEquipo(mode: MatchMode, botsActivos: number, team: number): number {
  let n = 0
  for (let id = 0; id <= botsActivos; id++) {
    if (teamForParticipant(mode, id) === team) n++
  }
  return n
}

/** ¿Se puede agregar un bot más? */
export function puedeAgregar(botsActivos: number): boolean {
  return botsActivos < MAX_BOTS
}

/** ¿Se puede sacar un bot? Falso en el piso, que es lo que impide dejar un
 *  equipo vacío. */
export function puedeQuitar(botsActivos: number): boolean {
  return botsActivos > MIN_BOTS
}

/**
 * Id del bot que sale: el último que entró, o -1 si no se puede sacar
 * ninguno. Explícito como función (en vez de un `pop()` suelto en game.ts)
 * porque "a quién saca" es una decisión de diseño que la tarea pedía
 * documentar, no un detalle de implementación.
 */
export function idDelBotASacar(botsActivos: number): number {
  return puedeQuitar(botsActivos) ? botsActivos : -1
}

/**
 * Acota un número de bots pedido (por la configuración del menú, por
 * `?bots=` o por lo que sea) al rango que el motor puede sostener. Un valor
 * basura cae al mínimo en vez de romper la partida, mismo criterio que
 * `resolveMap` con un nombre de mapa que no existe.
 */
export function acotarBots(pedido: number): number {
  if (!Number.isFinite(pedido)) return MIN_BOTS
  return Math.max(MIN_BOTS, Math.min(MAX_BOTS, Math.floor(pedido)))
}

/**
 * Igual que `acotarBots` pero admite CERO, para el número con el que
 * ARRANCA la partida.
 *
 * El piso de un bot protege una invariante de partida (que ningún equipo
 * quede vacío en medio del juego), y el modo práctica -- `?practica=1`,
 * plinkear dianas sin nadie disparándote -- no es una partida: arranca a
 * propósito con cero bots. Sacarle esa posibilidad para respetar un piso
 * pensado para otra cosa habría roto un modo que ya existía. El piso sigue
 * valiendo donde importa: `puedeQuitar(0)` es falso, así que desde cero
 * nadie puede bajar más.
 */
export function acotarBotsIniciales(pedido: number): number {
  if (!Number.isFinite(pedido)) return 0
  return Math.max(0, Math.min(MAX_BOTS, Math.floor(pedido)))
}
