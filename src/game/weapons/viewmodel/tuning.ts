export interface ViewmodelTuning {
  /** Multiplicador de la velocidad horizontal para acumular fase del bob. */
  bobFreq: number
  /** Amplitud máxima del bob, en metros, a velocidad de sprint. */
  bobAmp: number
  /** Metros de sway por unidad de VELOCIDAD de mouse (píxeles/segundo, no
   *  delta crudo por frame: ver derivación más abajo y rig.ts capa 3). */
  swayScale: number
  /** Tope de desplazamiento del sway, en metros. */
  swayMax: number
  /** Rigidez del resorte de sway/kick: qué tan rápido persigue el objetivo. */
  swayStiffness: number
  /** Amortiguación exponencial del resorte de sway/kick. */
  swayDamping: number
  /** Impulso de culatazo hacia atrás (eje pz), por unidad de kickMagnitude. */
  kickBack: number
  /** Impulso de culatazo hacia arriba (eje py), por unidad de kickMagnitude. */
  kickUp: number
  /** Impulso de roll del culatazo (eje rz), por unidad de kickMagnitude. Alterna de signo. */
  kickRoll: number
  /** Metros bajo la posición de reposo desde donde arranca el draw. */
  drawDrop: number
  /** Metros que baja el arma durante la fase de recarga (comparte orden de magnitud con drawDrop). */
  reloadDrop: number
  /** Radianes que se inclina el arma durante la fase de recarga. */
  reloadTilt: number
  /** Fracción de reloadTime en la que se emite el evento magOut. */
  reloadMagOutAt: number
  /** Fracción de reloadTime en la que se emite el evento magIn. */
  reloadMagInAt: number
  /** Constante de tiempo del acercamiento exponencial de groundedBlend al (des)aterrizar. */
  groundedBlendTime: number
}

// Derivación de swayScale (fix de QA, 2026-07-19: dos defectos medidos).
//
// Defecto 1 — framerate-dependencia: el target del sway se calculaba con
// `mouseDeltaX` crudo (píxeles acumulados EN ESE FRAME), nunca dividido por
// dt. A igual velocidad física de mano, más fps => menos píxeles por frame
// => menos sway. Medido: 240Hz daba exactamente la mitad de sway que
// 120Hz. Fix (rig.ts capa 3): el target ahora se calcula sobre
// `mouseDeltaX / dt`, es decir VELOCIDAD de mouse en píxeles/segundo, no
// delta por frame. Por eso swayScale cambia de unidades: de "metros por
// píxel de delta-por-frame" a "metros por (píxel/segundo)".
//
// Defecto 2 — saturación: con el swayScale viejo (0.6) y swayMax (0.05),
// cualquier delta por encima de 0.05/0.6 ≈ 0.084 píxeles EN UN SOLO FRAME
// pegaba el clamp. A cualquier velocidad de mouse real eso se cruza en la
// primera fracción de milisegundo: el sway era una señal de tres estados
// (+max, 0, -max), no un parámetro continuo.
//
// El nuevo swayScale se deriva de la escala real de input, no se elige a
// ojo: SENSITIVITY (game.ts) es 0.0022 rad/píxel, así que un tracking
// normal de ~800 px/s son ~1.76 rad/s de giro de cámara — nada extremo. El
// rango de apuntado real va de ~100 a ~2000 px/s (SWAY_TYPICAL_MAX_PX_S).
// Se elige que el TOPE de ese rango típico produzca sólo una fracción de
// swayMax (SWAY_TYPICAL_MAX_FRACTION), dejando margen para que el clamp
// actúe únicamente en flicks genuinamente extremos por encima de lo
// típico, no en el rango de operación normal:
//
//   swayScale = (SWAY_TYPICAL_MAX_FRACTION * SWAY_MAX_M) / SWAY_TYPICAL_MAX_PX_S
//
// Si algún día "se simplifica" esto de vuelta a un número redondo elegido a
// ojo, va a volver a saturar en todo el rango útil: no lo hagan sin repetir
// esta cuenta con los rangos de mouse reales del juego.
const SWAY_MAX_M = 0.05
const SWAY_TYPICAL_MAX_PX_S = 2000
const SWAY_TYPICAL_MAX_FRACTION = 0.75

export const VIEWMODEL: ViewmodelTuning = {
  bobFreq: 6.0,
  bobAmp: 0.02,

  swayScale: (SWAY_TYPICAL_MAX_FRACTION * SWAY_MAX_M) / SWAY_TYPICAL_MAX_PX_S,
  swayMax: SWAY_MAX_M,
  swayStiffness: 90,
  swayDamping: 14,

  kickBack: 0.08,
  kickUp: 0.05,
  kickRoll: 0.06,

  drawDrop: 0.35,

  reloadDrop: 0.35,
  reloadTilt: 0.35,
  // Los mismos números que da el spec, no reelegidos: 0.25 y 0.55 de
  // reloadTime. El test de timing de eventos depende de estos dos valores
  // exactos.
  reloadMagOutAt: 0.25,
  reloadMagInAt: 0.55,

  groundedBlendTime: 0.15,
}
