export interface MovementTuning {
  walkSpeed: number
  sprintSpeed: number
  adsSpeed: number
  crouchSpeed: number

  groundAccel: number
  groundFriction: number
  /** Piso de velocidad para el cálculo de fricción: hace que frenar sea firme. */
  stopSpeed: number

  airAccel: number
  /** Cuánta velocidad se puede ganar por tick en la dirección deseada, en el aire. */
  airWishSpeedCap: number

  jumpVelocity: number
  gravity: number
  coyoteTime: number

  jumpBufferWindow: number
  /** Si volvés a saltar dentro de esta ventana tras aterrizar, no se aplica fricción. */
  bhopFrictionSkipWindow: number
  bhopSoftCap: number
  /** Tasa de decaimiento exponencial por encima del tope suave. */
  bhopSoftCapDecay: number

  slideBoost: number
  /**
   * Techo de velocidad horizontal al entrar en slide: el boost nunca la
   * supera. Se deriva de `bhopSoftCap` en cada lectura (ver el getter en
   * MOVEMENT más abajo), así que sigue al valor vivo de `bhopSoftCap`
   * incluso si el panel de tuning lo muta en caliente — no es una copia
   * fijada al arrancar.
   *
   * Esto sólo clampea la velocidad *al entrar* al slide. `applySoftCap`
   * (bhop.ts) corre nada más en la rama aérea de step.ts: si el jugador
   * aterriza con velocidad aérea alta, esa velocidad entra a la rama de
   * suelo sin reclampear. Medido: hasta ~16 m/s en el tick de aterrizaje,
   * por encima de este techo (14.4 con la tuning por defecto). No es un
   * runaway — la propia rama aérea lo acota como equilibrio del decay
   * exponencial — pero "techo de velocidad en el suelo" no es 100% literal
   * fuera del instante de entrada al slide.
   */
  slideMaxSpeed: number
  slideDuration: number
  slideEndSpeedScale: number
  slideFriction: number
  /** Velocidad horizontal mínima para poder entrar en slide. */
  slideMinSpeed: number
  /** Tiempo mínimo desde que terminó el último slide antes de poder entrar en otro. */
  slideCooldown: number

  mantleMaxHeight: number
  mantleMinSpeed: number

  eyeHeight: number
  crouchEyeHeight: number
  /** Constante de tiempo del acercamiento exponencial de eyeHeight al agacharse/pararse. */
  eyeHeightLerpTime: number
}

const walkSpeed = 5.0
const sprintSpeed = 8.0
const bhopSoftCap = sprintSpeed * 1.8

export const MOVEMENT: MovementTuning = {
  walkSpeed,
  sprintSpeed,
  adsSpeed: 3.5,
  crouchSpeed: 3.0,

  groundAccel: 60,
  groundFriction: 8.0,
  stopSpeed: 1.5,

  airAccel: 100,
  airWishSpeedCap: 0.5,

  jumpVelocity: 6.5,
  gravity: 22,
  coyoteTime: 0.1,

  jumpBufferWindow: 0.12,
  bhopFrictionSkipWindow: 0.08,
  bhopSoftCap,
  // Derivado, no elegido a ojo. Strafeando perfecto se gana
  // airAccel * dt * airWishSpeedCap = 100 * (1/128) * 0.5 = 0.39 m/s por tick.
  // El equilibrio del decay exponencial es gain / (1 - exp(-decay * dt)).
  // Con decay 3 el equilibrio queda en +16.8 m/s sobre el tope (31 m/s reales),
  // o sea el tope no toparía nada. Con 12 ese mismo cálculo teórico da +4.4
  // (18.8 m/s reales) — pero asume ganancia en TODOS los ticks aéreos, y no
  // es lo que pasa. Medido de verdad (20k ticks de strafe perfecto, mismo
  // patrón que bhop.test.ts): converge a ~14.45 m/s sostenido (el piso de
  // la oscilación en régimen) con picos de ~15.01, bastante por debajo del
  // 18.8 teórico. La causa: con incrementos de yaw fijos, la proyección de
  // la velocidad actual sobre el wishDir de ese tick a veces ya supera
  // airWishSpeedCap (addSpeed <= 0 en accelerate.ts) y ese tick no suma
  // nada — cerca de un 28% de los ticks aéreos, en esta medición. La
  // ganancia promedio real por tick queda por debajo de la máxima teórica,
  // así que el equilibrio también.
  bhopSoftCapDecay: 12.0,

  slideBoost: 1.35,
  // El mismo tope que bhopSoftCap, a propósito: si el slide pudiera superar
  // el tope del bhop, sería la vía barata de saltárselo (agachar y soltar es
  // trivial comparado con air-strafear). Getter, no un valor copiado al
  // inicializar el módulo: `bhopSoftCap` de acá abajo es mutable (el panel
  // de tuning en engine/tuning-panel.ts lo escribe en vivo), y una copia
  // fijada en este objeto se habría quedado pegada al valor de arranque.
  // Con el getter, no hay dos números que alguien pueda desincronizar al
  // tunear: hay uno solo, leído dos veces.
  get slideMaxSpeed(): number {
    return MOVEMENT.bhopSoftCap
  },
  slideDuration: 0.7,
  slideEndSpeedScale: 0.6,
  slideFriction: 1.2,
  slideMinSpeed: 4.0,
  // Sin esto, re-presionar agachar cada ~150ms reaplica el boost sobre una
  // velocidad ya boosteada: crecimiento compuesto sin límite (ver
  // movement/invariants.test.ts). 0.4s es más que suficiente para el
  // slide-cancel legítimo (que ya no depende del cooldown, corta por salto)
  // pero mata el spam de la tecla.
  slideCooldown: 0.4,

  mantleMaxHeight: 1.2,
  mantleMinSpeed: 1.0,

  eyeHeight: 1.65,
  crouchEyeHeight: 1.0,
  eyeHeightLerpTime: 0.12,
}
