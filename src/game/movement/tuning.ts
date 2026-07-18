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
  slideDuration: number
  slideEndSpeedScale: number
  slideFriction: number
  /** Velocidad horizontal mínima para poder entrar en slide. */
  slideMinSpeed: number

  mantleMaxHeight: number
  mantleMinSpeed: number

  eyeHeight: number
  crouchEyeHeight: number
}

const walkSpeed = 5.0
const sprintSpeed = 8.0

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
  bhopSoftCap: sprintSpeed * 1.8,
  // Derivado, no elegido a ojo. Strafeando perfecto se gana
  // airAccel * dt * airWishSpeedCap = 100 * (1/128) * 0.5 = 0.39 m/s por tick.
  // El equilibrio del decay exponencial es gain / (1 - exp(-decay * dt)).
  // Con decay 3 el equilibrio queda en +16.8 m/s sobre el tope (31 m/s reales),
  // o sea el tope no toparía nada. Con 12 queda en +4.4, que sostiene ~18.8 m/s:
  // el bhop premia, pero no se descontrola.
  bhopSoftCapDecay: 12.0,

  slideBoost: 1.35,
  slideDuration: 0.7,
  slideEndSpeedScale: 0.6,
  slideFriction: 1.2,
  slideMinSpeed: 4.0,

  mantleMaxHeight: 1.2,
  mantleMinSpeed: 1.0,

  eyeHeight: 1.65,
  crouchEyeHeight: 1.0,
}
