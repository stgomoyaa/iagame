export interface ViewmodelTuning {
  /** Multiplicador de la velocidad horizontal para acumular fase del bob. */
  bobFreq: number
  /** Amplitud máxima del bob, en metros, a velocidad de sprint. */
  bobAmp: number
  /** Metros de sway por unidad de delta de mouse. */
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

export const VIEWMODEL: ViewmodelTuning = {
  bobFreq: 6.0,
  bobAmp: 0.02,

  swayScale: 0.6,
  swayMax: 0.05,
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
