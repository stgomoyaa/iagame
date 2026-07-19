import type { MatchMode } from '@/game/match/types'

/**
 * Todos los números de la capa de partida en un solo objeto mutable --mismo
 * patrón que movement/tuning.ts, bots/tuning.ts y feedback/tuning.ts-- para
 * que match/tuning-panel.ts pueda tunear el ritmo en vivo sin que nadie
 * tenga que tocar el resto del módulo. Los valores de acá abajo son un
 * punto de partida razonado, no una verdad final: se tunean jugando, igual
 * que movement/tuning.ts -- ver el reporte de la tarea para lo que se
 * ajustó tras jugar una partida real.
 */
export interface MatchTuning {
  /** Modo por defecto cuando no se pide uno explícito por `?mode=`. */
  defaultMode: MatchMode

  /**
   * Cuántos bots poblar. El spec (sección "Fases") proponía 10 sin haberlo
   * jugado contra esta arena en particular (60x60m, tres carriles) --
   * verificado jugando ambos números FFA en esta tarea, mismo mapa: con 8,
   * ~1 kill cada 13s (7 kills en 90s reales); con 10, ~1 kill cada 2s (18
   * kills en 38.8s reales) -- casi 6x más denso. No es un problema de línea
   * de visión saturada (la hipótesis original antes de jugar) sino de ritmo:
   * 10 satura el killfeed y no deja margen entre confirmaciones para que
   * cada una se sienta, 8 da hueco real para reposicionarse y cazar entre
   * kill y kill. 8 queda como el número final.
   */
  botCount: number

  /** 'uniform': todos los bots comparten difficultyRank (uniformDifficultyRank).
   *  'mixed': se reparten cíclicamente entre mixedDifficultyRanks -- una
   *  partida con caza fácil y bots duros mezclados, en vez de un nivel de
   *  desafío parejo de punta a punta. */
  difficultyMode: 'uniform' | 'mixed'
  uniformDifficultyRank: number
  /**
   * Cuánto se abren los bots de 'mixed' a cada lado del rango del jugador,
   * en unidades de la escala 0..1 de bots/difficulty.ts. Reemplaza a la
   * lista de rangos absolutos que usaba la fase 3: desde la fase 4 el
   * centro lo pone el rango del jugador (game.ts resolveDifficultyRanks),
   * así que lo único que hace falta tunear es la apertura.
   *
   * 0.15 sobre 25 rangos son unas 3.5 divisiones a cada lado: se nota la
   * diferencia entre el bot más blando y el más duro de la partida sin que
   * ninguno quede fuera del nivel al que el jugador está jugando.
   */
  mixedDifficultySpread: number

  /** Segundos entre que el JUGADOR muere y reaparece. Sólo gobierna al
   *  jugador -- los bots reusan su propio temporizador ya tuneado en
   *  bots/tuning.ts (BOTS.respawnDelayS), sin pasar por acá (ver el
   *  comentario de cabecera de game.ts sobre esta asimetría deliberada:
   *  tocar bots/health.ts o bots/bot.ts para unificarlo no es necesario --
   *  "reusar, no reconstruir" -- y lo que se siente al jugar es sobre todo
   *  el propio temporizador, no el de los bots). Se mantiene igual al valor
   *  de BOTS.respawnDelayS por default para que no se sientan distintos. */
  respawnDelayS: number
  /** Segundos de invulnerabilidad tras reaparecer -- para todos, jugador y
   *  bots (game.ts es quien aplica el gate de daño en ambos casos). */
  respawnInvulnerabilityS: number

  /** Kills del participante líder para terminar una partida FFA. */
  scoreLimitFfa: number
  /** Kills acumulados de UN equipo para terminar una partida TDM. */
  scoreLimitTdm: number
  /** Duración del reloj de partida, segundos. El spec pide "más o menos seis
   *  minutos o un objetivo de kills" -- lo que se cumpla primero termina la
   *  partida (match.ts: isMatchOver). */
  timeLimitS: number

  /** Cuántas entradas del killfeed pueden estar visibles a la vez -- el
   *  (n+1)-ésima kill recicla la más vieja (mismo RingPool que hitmarkers,
   *  feedback/pool.ts). */
  killfeedMaxEntries: number
  /** Segundos que una entrada del killfeed queda visible antes de apagarse. */
  killfeedEntryLifetimeS: number
}

export const MATCH: MatchTuning = {
  // TDM es el modo que pide el spec (sección "Fases": "Bots, TDM, HUD de
  // combate, killfeed"), así que queda por defecto. Hallazgo honesto de
  // jugar una partida TDM completa de 6 minutos en esta tarea, YA con los
  // tres bugs de combate corregidos (ver bots/tuning.ts recoilDisciplineDeg
  // y bots/bot.ts stepBotCombat): la partida arrancó bien (1 kill a los
  // 17s) y después se quedó completamente muda -- 1 kill total entre el
  // segundo 29 y el segundo 166+ (más de dos minutos sin un solo hit
  // nuevo), con 7 de 8 bots en Idle al mismo tiempo. La causa no es un bug
  // de esta tarea: Idle (bots/fsm.ts) no mueve al bot, sólo rota la mira en
  // el lugar -- un bot que pierde contacto se congela ahí hasta que alguien
  // entra en su cono o dispara dentro de su radio de audición. TDM, con la
  // mitad de enemigos potenciales por bot que FFA (los compañeros de equipo
  // no cuentan), corta esa cadena de contacto mucho más fácil. Es el mismo
  // tipo de límite que la tarea ya documentaba para Enfrentar (bots que no
  // se reposicionan en combate) pero en Idle -- next polish target real,
  // no algo para tocar acá (bots/fsm.ts queda fuera de esta tarea). FFA
  // (`?mode=ffa`), jugado varias veces en esta misma tarea, no mostró este
  // problema -- mayor densidad de enemigos, la acción se sostiene sola.
  defaultMode: 'tdm',

  // Ver el comentario del campo arriba: 8 verificado contra 10 jugando FFA
  // real en esta arena, mismo build -- 8 da el mejor ritmo.
  botCount: 8,

  // 'mixed' por defecto: un puñado de bots claramente más fáciles de leer da
  // parches de respiro entre los duros. Jugado y observado en esta tarea:
  // la distribución de kills entre bots salió despareja de verdad (algunos
  // dominan, otros mueren repetido, un par no llega a pelear nunca) --
  // consistente con dificultad mixta, no con un nivel de desafío parejo.
  difficultyMode: 'mixed',
  uniformDifficultyRank: 0.5,
  mixedDifficultySpread: 0.15,

  respawnDelayS: 3.0,
  // Ni tan corto que morir no cueste nada (spawn-camping trivial) ni tan
  // largo que tape la acción real: alcanza para reposicionarse un paso o
  // dos tras reaparecer sin quedar inmune el tiempo suficiente para
  // presionar una ventaja.
  respawnInvulnerabilityS: 1.5,

  // Recalibrado tras corregir los tres bugs de combate de esta tarea (antes
  // de eso, ni siquiera habría podido medirse: 0 kills en una partida FFA
  // entera). FFA con 8 bots, ya corregido, dio picos de ~1 kill cada 3-6s
  // en las rachas activas (un bot llegó a 10 kills en 60s reales) -- a ese
  // ritmo sostenido un límite de 30 se alcanzaría bastante antes de los 6
  // minutos. Puesto alto a propósito para que el RELOJ siga siendo la
  // salida habitual (partida completa, remontada posible hasta el final) y
  // el límite quede como red de seguridad sólo para un arrase extremo, no
  // como el mecanismo de cierre esperado. TDM, en cambio, mostró rachas
  // mudas largas en la partida jugada en esta tarea (ver el comentario de
  // defaultMode) -- con esa cadencia mucho más floja, scoreLimitTdm casi
  // nunca es la razón real de cierre; el número queda alto por la misma
  // lógica que FFA, no porque haga falta en la práctica.
  scoreLimitFfa: 50,
  scoreLimitTdm: 60,
  timeLimitS: 360,

  killfeedMaxEntries: 5,
  killfeedEntryLifetimeS: 6,
}
