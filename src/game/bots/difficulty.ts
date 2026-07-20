/**
 * Dificultad de bots: CUATRO tramos con nombre (Fácil / Normal / Difícil /
 * Experto) donde lo que escala es REACCIÓN, PUNTERÍA y AGRESIVIDAD.
 *
 * Por qué cambió
 * --------------
 * La versión anterior tenía tres números interpolados entre Hierro y
 * Radiante y, MEDIDO con bots/medicion.ts (duelo de 12 s a 16 m, 8 semillas
 * por tramo), no cambiaba absolutamente nada:
 *
 *   rank   precisión                ttff (s)
 *   0.00   0.079 [0.063 .. 0.111]   0.000
 *   0.33   0.079 [0.063 .. 0.109]   0.000
 *   0.66   0.079 [0.063 .. 0.109]   0.000
 *   1.00   0.078 [0.063 .. 0.095]   0.000
 *
 * Hierro y Radiante disparaban igual de bien y en el mismo instante. Dos
 * causas, las dos de diseño y no de calibración:
 *
 * 1. EL CONO SE CERRABA A CERO Y NO VOLVÍA A ABRIRSE. `errorConeRad` decaía
 *    linealmente hasta 0 en `reactionTimeS` (0.12-0.4 s) y ahí se quedaba
 *    mientras el objetivo siguiera visible. En un tiroteo de 12 s eso son
 *    ~11.7 s de puntería PERFECTA en todos los tramos: la dificultad sólo
 *    existía durante la primera fracción de segundo de cada contacto.
 * 2. EL GATILLO NO ESPERABA NADA. `triggerHeld` se ponía en true el mismo
 *    tick en que el bot veía al objetivo, en todos los tramos por igual, así
 *    que el "tiempo hasta el primer disparo" era 0.000 s para un bot de
 *    Hierro y para uno de Radiante.
 *
 * Qué hace Counter-Strike (fuente, no recuerdo)
 * --------------------------------------------
 * `BotProfile.db` de CS:S define por plantilla los campos Skill, Aggression,
 * ReactionTime, AttackDelay, Teamwork, WeaponPreference, Cost, Difficulty,
 * VoicePitch y Skin, con Difficulty en tramos EASY/NORMAL/HARD/EXPERT --
 * o sea que los nombres que teníamos de memoria son los reales. Valores de
 * las plantillas (Skill / Aggression / ReactionTime):
 *
 *   Easy      0 /  20 / 0.5     Normal   50 /  50 / 0.4
 *   Hard     75 /  75 / 0.25    Elite   100 / 100 / 0.2
 *
 * Y, lo más importante, en el código del bot (cs_bot_weapon.cpp) el error de
 * apuntado NO converge a cero: se re-siembra continuamente.
 *
 *   m_aimFocus *= expf(logf(GetAimFocusDecay()) * m_aimFocusInterval);
 *   float fNewMaxFocus = MIN(60.0f, fAngleOffset) * GetAimFocusOffsetScale();
 *   m_aimFocus = MAX(m_aimFocus, fNewMaxFocus);
 *   float fRadius = RandomFloat(0.0f, m_aimFocus);
 *
 * El foco decae, pero cada actualización lo vuelve a levantar en función de
 * cuán desviada está la mira, y el error se re-muestrea SIEMPRE. Además la
 * habilidad degrada la corrección de retroceso de forma permanente:
 *
 *   float fPunchAngleCorrectionFactor = 1.0f + (1.f - fSkill) * .8f * SlowNoise( 6.f );
 *
 * Un bot flojo de CS nunca se convierte en aimbot: sigue temblando. Ese es
 * el mecanismo que acá faltaba, y es lo que `aimSteadyRad` copia.
 *
 * Las cuatro palancas
 * -------------------
 * REACCIÓN    `attackDelayS` (cuánto tarda en apretar el gatillo desde que
 *             te ve) y `reactionTimeS` (cuánto tarda el cono en asentarse).
 * PUNTERÍA    `errorConeRad` (cono al adquirir) y `aimSteadyRad` (el error
 *             RESIDUAL que nunca se cierra), más `aimSpeedDegPerSec`: un bot
 *             fácil también gira la mira más lento.
 * AGRESIVIDAD `aggression`: desde cuán lejos decide acercarse y con cuánta
 *             vida se retira.
 *
 * Nada de esto toca vida, daño ni velocidad de movimiento: un bot fácil no
 * es un bot lento ni de papel, es un bot que reacciona tarde y apunta peor
 * -- que es exactamente la diferencia entre los bots de CS 1.6 en fácil y en
 * difícil.
 */

export interface BotDifficulty {
  /**
   * Segundos entre que el bot VE al objetivo y que aprieta el gatillo. Es el
   * `AttackDelay` de BotProfile.db. Sin esto todos los tramos disparaban en
   * el mismo tick y el "tiempo hasta el primer disparo" no distinguía a un
   * bot fácil de uno experto.
   */
  attackDelayS: number
  /** Segundos que tarda el cono de error en pasar de `errorConeRad` a
   *  `aimSteadyRad` -- ver bots/aim.ts. NO baja a cero: ver aimSteadyRad. */
  reactionTimeS: number
  /** Semiángulo del cono de error al adquirir el objetivo, radianes. */
  errorConeRad: number
  /**
   * Semiángulo del error RESIDUAL, radianes: el piso al que se asienta el
   * cono y por debajo del cual no baja nunca, por mucho que el bot te siga
   * mirando. Es la pieza que hacía inerte a la dificultad -- con piso 0 todo
   * bot terminaba siendo un aimbot perfecto a los 0.4 s de verte.
   *
   * Es el análogo del temblor permanente que en CS produce
   * `(1 - skill) * SlowNoise()` sobre la corrección de retroceso. En
   * Experto es deliberadamente distinto de cero: ni el mejor bot debería
   * clavar el láser, porque un rival que no falla NUNCA no se lee como
   * bueno, se lee como tramposo.
   */
  aimSteadyRad: number
  /**
   * Velocidad angular máxima de la mira, grados/segundo. Antes era una
   * constante única (600) para todos los tramos: un bot de Hierro te encaraba
   * tan rápido como uno de Radiante y sólo apuntaba con más ruido. Girar
   * lento es la mitad de lo que un jugador percibe como "reacciona lento".
   */
  aimSpeedDegPerSec: number
  /**
   * 0..1, el `Aggression` de BotProfile.db. Escala desde qué distancia el
   * bot decide acercarse en vez de dispararte de lejos, y con cuánta vida
   * decide retirarse. Un bot fácil te tirotea de lejos y se va temprano;
   * uno experto te busca y aguanta.
   */
  aggression: number
  /**
   * 0..1. Cuánto del retroceso vertical/horizontal ya acumulado COMPENSA el
   * bot al disparar. Es el análogo directo del factor de CS
   * (cs_bot_weapon.cpp): `m_aimGoal -= punchAngles * (1 + (1-skill)*...)`,
   * o sea que un bot con habilidad alta anula casi todo su retroceso y uno
   * flojo no anula nada y sus ráfagas trepan y se van por encima del
   * objetivo.
   *
   * Sin esto, MEDIDO, la precisión no separaba a los tramos: el retroceso
   * del arma es tan dominante que hasta un apuntado perfecto acertaba sólo
   * ~17% de una ráfaga larga a 16 m, así que el cono de error (la palanca de
   * puntería) no tenía margen para mostrarse. 0 = comportamiento anterior
   * (ninguna compensación); 1 = anula el retroceso por completo, que a
   * propósito NINGÚN tramo alcanza -- ni el mejor jugador clava el spray
   * entero.
   */
  recoilControl: number
  /** 0..1. Cuán inteligente es la elección de punto al reposicionarse o
   *  retirarse -- ver bots/fsm.ts (repositionCandidate). */
  repositionQuality: number
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Los cuatro tramos. Los tiempos de reacción siguen de cerca los de
 * BotProfile.db (0.5 / 0.4 / 0.25 / 0.2) porque son valores que llevan
 * veinte años probados contra jugadores reales; los ángulos son nuestros,
 * porque dependen del arsenal y de las hitboxes de este juego, no de las de
 * CS.
 */
export const FACIL: BotDifficulty = {
  attackDelayS: 0.55,
  reactionTimeS: 0.5,
  errorConeRad: degToRad(7.0),
  aimSteadyRad: degToRad(2.5),
  aimSpeedDegPerSec: 200,
  aggression: 0.2,
  recoilControl: 0.0,
  repositionQuality: 0.0,
}

export const NORMAL: BotDifficulty = {
  attackDelayS: 0.3,
  reactionTimeS: 0.4,
  errorConeRad: degToRad(4.5),
  aimSteadyRad: degToRad(1.3),
  aimSpeedDegPerSec: 320,
  aggression: 0.5,
  recoilControl: 0.35,
  repositionQuality: 0.35,
}

export const DIFICIL: BotDifficulty = {
  attackDelayS: 0.14,
  reactionTimeS: 0.26,
  errorConeRad: degToRad(2.2),
  aimSteadyRad: degToRad(0.55),
  aimSpeedDegPerSec: 470,
  aggression: 0.75,
  recoilControl: 0.7,
  repositionQuality: 0.7,
}

export const EXPERTO: BotDifficulty = {
  attackDelayS: 0.05,
  reactionTimeS: 0.18,
  errorConeRad: degToRad(1.0),
  // No es 0 a propósito: ver aimSteadyRad. 0.15° a 16 m son ~4 cm de
  // desvío, así que el Experto falla poco pero falla -- y sobre todo, falla
  // de manera que un jugador puede sentir que le ganó, no que el juego se lo
  // regaló.
  aimSteadyRad: degToRad(0.15),
  aimSpeedDegPerSec: 640,
  aggression: 1.0,
  recoilControl: 0.9,
  repositionQuality: 1.0,
}

/** La escalera, de más fácil a más difícil. El orden es parte del contrato:
 *  `interpolateDifficulty` recorre este arreglo. */
export const TRAMOS: readonly BotDifficulty[] = [FACIL, NORMAL, DIFICIL, EXPERTO]

export type NombreTramo = 'facil' | 'normal' | 'dificil' | 'experto'

export const TRAMOS_POR_NOMBRE: Record<NombreTramo, BotDifficulty> = {
  facil: FACIL,
  normal: NORMAL,
  dificil: DIFICIL,
  experto: EXPERTO,
}

/** Extremos, para quien quiera anclar contra la tabla sin conocer los
 *  nombres. Se mantienen exportados porque la interfaz de carrera
 *  (ui/Career.tsx) y las pruebas ya los usaban. */
export const DIFFICULTY_LOWEST = FACIL
export const DIFFICULTY_HIGHEST = EXPERTO

function lerp(a: number, b: number, t: number): number {
  // Casos borde explícitos: `a + (b-a)*t` con t=1 puede diferir de `b` en el
  // último bit por redondeo. Sin esto, un rank que cae justo sobre un tramo
  // no daría BIT A BIT los números de la tabla.
  if (t <= 0) return a
  if (t >= 1) return b
  return a + (b - a) * t
}

/**
 * Dificultad para un `rank` continuo 0..1 (0 = Fácil, 1 = Experto),
 * interpolando ENTRE TRAMOS VECINOS de la escalera.
 *
 * Sigue siendo un escalar y no un enum porque el sistema de rangos
 * (progression/ranks.ts) mapea el rango del jugador a un continuo: los
 * cuatro tramos son los postes con nombre, no una restricción. Un rank que
 * cae exactamente sobre un tramo devuelve sus números exactos, así que
 * `interpolateDifficulty(0)` es Fácil y `interpolateDifficulty(1)` es
 * Experto, bit a bit.
 */
export function interpolateDifficulty(rank: number): BotDifficulty {
  const t = Math.min(1, Math.max(0, rank))
  const escala = t * (TRAMOS.length - 1)
  const i = Math.min(TRAMOS.length - 2, Math.floor(escala))
  const f = escala - i
  const a = TRAMOS[i]
  const b = TRAMOS[i + 1]
  return {
    attackDelayS: lerp(a.attackDelayS, b.attackDelayS, f),
    reactionTimeS: lerp(a.reactionTimeS, b.reactionTimeS, f),
    errorConeRad: lerp(a.errorConeRad, b.errorConeRad, f),
    aimSteadyRad: lerp(a.aimSteadyRad, b.aimSteadyRad, f),
    aimSpeedDegPerSec: lerp(a.aimSpeedDegPerSec, b.aimSpeedDegPerSec, f),
    aggression: lerp(a.aggression, b.aggression, f),
    recoilControl: lerp(a.recoilControl, b.recoilControl, f),
    repositionQuality: lerp(a.repositionQuality, b.repositionQuality, f),
  }
}
