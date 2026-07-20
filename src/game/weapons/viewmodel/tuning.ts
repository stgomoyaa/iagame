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
  /** Radianes de ROLL durante la recarga: gira el arma sobre su eje para que
   *  la boca del cargador quede a la vista. Es la señal que distingue una
   *  recarga de un agachón — agacharse no rola. */
  reloadRoll: number
  /** Radianes de YAW durante la recarga: mete el arma un poco hacia adentro,
   *  como quien la acerca al cuerpo para manipularla. */
  reloadYaw: number
  /** Metros que el arma se corre hacia el centro del encuadre al recargar.
   *  El arma vive a la derecha; recargar la trae hacia adentro, que es lo que
   *  hace alguien que se mira las manos. Además es lo que la mantiene EN
   *  CUADRO mientras baja. */
  reloadPullIn: number
  /** Fracción de reloadTime en la que se emite el evento magOut. */
  reloadMagOutAt: number
  /** Fracción de reloadTime en la que se emite el evento magIn. */
  reloadMagInAt: number
  /** Ancho (en fracción de reloadTime) de los golpes secos de magOut/magIn. */
  reloadSnapSpan: number
  /** Metros del tirón hacia abajo al arrancar el cargador viejo. */
  reloadYankAmount: number
  /** Metros del golpe hacia arriba al encajar el cargador nuevo de una palmada. */
  reloadSlapAmount: number
  /** Fracción de reloadTime donde arranca el tirón de manija de carga. */
  reloadChargeAt: number
  /** Ancho de ese tirón, en fracción de reloadTime. */
  reloadChargeSpan: number
  /** Metros que se tira la manija de carga hacia atrás. */
  reloadChargeAmount: number
  /** Radianes de cabeceo que acompañan al tirón de manija. */
  reloadChargeTilt: number
  /** Fracción de reloadTime que tarda el cargador viejo en salir de cuadro. */
  reloadMagFallSpan: number
  /** Fracción de reloadTime que tarda el cargador nuevo en entrar y asentarse. */
  reloadMagInsertSpan: number
  /** Metros que cae el cargador viejo antes de ocultarse. */
  reloadMagFallDistance: number
  /** Metros por debajo de su asiento donde aparece el cargador nuevo. */
  reloadMagEntryDistance: number
  /** Radianes que voltea el cargador viejo mientras cae. */
  reloadMagTumble: number
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

/**
 * El bob tiene que leerse como cadencia de pasos, no como vibración.
 *
 * La fase avanza `speed * dt * bobFreq` radianes, y el componente vertical usa
 * el doble de esa frecuencia, así que las oscilaciones verticales por segundo
 * son `speed * bobFreq / pi`. Igualando eso a la cadencia real de una persona
 * esprintando (unos 3 pasos por segundo a 8 m/s) sale:
 *
 *   bobFreq = 3 * pi / 8 = 1.18
 *
 * A velocidad de caminata (5 m/s) eso da 1.9 pasos por segundo, que también es
 * la cadencia correcta al caminar.
 *
 * Estaba en 6.0, que daba 15.3 oscilaciones verticales por segundo a sprint:
 * cinco veces la cadencia humana, y se leía como si el arma tiritara.
 */
const SPRINT_STEPS_PER_SECOND = 3
const SPRINT_SPEED_MS = 8

export const VIEWMODEL: ViewmodelTuning = {
  bobFreq: (SPRINT_STEPS_PER_SECOND * Math.PI) / SPRINT_SPEED_MS,
  bobAmp: 0.02,

  swayScale: (SWAY_TYPICAL_MAX_FRACTION * SWAY_MAX_M) / SWAY_TYPICAL_MAX_PX_S,
  swayMax: SWAY_MAX_M,
  swayStiffness: 90,
  swayDamping: 14,

  kickBack: 0.08,
  kickUp: 0.05,
  kickRoll: 0.06,

  drawDrop: 0.35,

  // La caída bajó de 0,35 a 0,10 m, y eso NO es un ajuste cosmético: con 0,35
  // el arma se iba literalmente abajo del borde inferior de la pantalla y sólo
  // quedaba asomando la punta del cañón. Medido en el navegador, es
  // probablemente la causa principal de que la recarga se leyera como el arma
  // agachándose — un arma que se va de cuadro no puede leerse como otra cosa.
  // Ahora baja lo justo para sentirse, y el trabajo de mostrar que se está
  // manipulando el arma lo hacen el roll y el desplazamiento hacia el centro.
  reloadDrop: 0.1,
  reloadTilt: 0.34,
  // El roll es lo que convierte "el arma se agacha" en "alguien manipula el
  // arma": 0,85 rad son ~49°, que es lo que hace falta para que el pozo del
  // cargador quede de frente a la cámara. Verificado mirando la secuencia:
  // con ~30° el arma apenas se ladea y en un modelo largo y fino (las 40 CC0)
  // el gesto casi no se nota, porque de punta un fusil es casi simétrico.
  reloadRoll: 0.85,
  reloadYaw: 0.3,
  reloadPullIn: 0.13,
  // Los mismos números que da el spec, no reelegidos: 0.25 y 0.55 de
  // reloadTime. El test de timing de eventos depende de estos dos valores
  // exactos. Las fases NUEVAS de abajo se agregaron alrededor de estos dos
  // sin moverlos, que es la restricción de la tarea.
  reloadMagOutAt: 0.25,
  reloadMagInAt: 0.55,

  // Golpes secos. Son cortos a propósito (7% de la recarga): un impacto que
  // dura mucho deja de leerse como impacto y se lee como deriva. El de la
  // palmada es más fuerte que el del tirón porque meter un cargador de un
  // manotazo mueve más el arma que sacarlo.
  reloadSnapSpan: 0.07,
  reloadYankAmount: 0.045,
  reloadSlapAmount: 0.075,

  // Manija de carga: arranca DESPUÉS de que el cargador quedó asentado
  // (0,55 + 0,16 = 0,71) y termina en 0,87, con margen antes del final. Es el
  // gesto que remata la lectura: sin él, la secuencia termina en "metí el
  // cargador" en vez de "el arma quedó lista".
  reloadChargeAt: 0.72,
  reloadChargeSpan: 0.15,
  reloadChargeAmount: 0.055,
  reloadChargeTilt: 0.09,

  // Cargador. Cae rápido (14% de la recarga hasta salir de cuadro) y entra
  // más lento (16%): sacarlo es un tirón, meterlo es puntería.
  reloadMagFallSpan: 0.14,
  reloadMagInsertSpan: 0.16,
  reloadMagFallDistance: 0.6,
  reloadMagEntryDistance: 0.28,
  reloadMagTumble: 1.4,

  groundedBlendTime: 0.15,
}
