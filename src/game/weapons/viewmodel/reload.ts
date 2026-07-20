/**
 * Coreografía de recarga: las curvas que hacen que recargar se LEA como
 * cambiar un cargador.
 *
 * El problema que resuelve. La versión anterior era una sola envolvente
 * (bajar + inclinar) aplicada al arma entera. Bajar e inclinar es también lo
 * que hace un arma cuando el jugador se agacha, cuando corre, o cuando saca
 * el arma: no hay nada en ese gesto que diga "cargador". El dueño lo reportó
 * jugando y tenía razón — se leía como el arma agachándose.
 *
 * Lo que agrega esta capa, en orden de cuánto aporta a la lectura:
 *
 * 1. **Roll.** Girar el arma sobre su eje longitudinal para que el pozo del
 *    cargador quede a la vista. Es lo único de toda la lista que un agachón
 *    NO puede hacer, así que es lo que más separa un gesto del otro.
 * 2. **Dos golpes secos, uno por evento.** Un tirón hacia abajo en `magOut` y
 *    una palmada hacia arriba en `magIn`. Le dan a la secuencia dos acentos
 *    en momentos precisos; sin ellos el movimiento es continuo y los eventos
 *    no se ven, sólo se emiten.
 * 3. **Tirón de manija de carga** al final. Remata: sin él la secuencia
 *    termina en "metí el cargador" y no en "el arma quedó lista".
 * 4. **El cargador de verdad**, cuando el modelo lo trae como malla aparte
 *    (ver `magazinePose`). Es lo más literal, pero sólo 35 de las 79 armas
 *    lo tienen, así que no puede ser de lo que dependa la lectura.
 *
 * Los puntos 1 a 3 no dependen de geometría: valen para las 40 armas CC0 de
 * una sola pieza igual que para las de Source.
 *
 * ## Dos propiedades que este archivo tiene por construcción
 *
 * **Independencia de framerate.** Todo acá es función PURA de `frac`, la
 * fracción de la recarga ya transcurrida. No hay integración, ni resortes, ni
 * estado que avance por frame, así que no hay ningún paso por frame que
 * pudiera depender del tamaño del paso: a 120 y a 240 Hz se muestrea la misma
 * curva continua. Ésta es la razón por la que la coreografía se escribió como
 * curvas y no como impulsos a un resorte amortiguado (que era la alternativa
 * obvia, y que habría heredado el error de integración del resorte).
 *
 * **Termina exactamente en reposo.** Toda función de acá devuelve
 * exactamente 0 fuera de su ventana, y todas las ventanas cierran antes de
 * `frac = 1`. O sea que una recarga terminada —o pasada de largo por un dt
 * gigante tras un stall de tab— deja el arma en su pose base sin residuo, no
 * "casi" en reposo. Hay un test que depende de esa igualdad exacta.
 *
 * ## Cero asignaciones
 *
 * Las funciones de forma devuelven `number`. La pose del cargador, que son
 * seis valores, se escribe en un `VmMagTransform` que el llamador preasigna
 * una vez — mismo patrón que `VmTransform` en el rig.
 */

import { VIEWMODEL } from '@/game/weapons/viewmodel/tuning'

/**
 * Pose del cargador RELATIVA a su asiento en el arma, en el mismo espacio que
 * el pivote animado del viewmodel (metros, radianes). Todo en cero = cargador
 * puesto, que es el estado en el 100% del tiempo salvo durante una recarga.
 *
 * `visible` existe porque el cargador viejo se va de cuadro y el nuevo todavía
 * no llegó: durante ese hueco no hay ningún cargador que dibujar. Mover la
 * malla lejos también lo sacaría de cuadro, pero seguiría costando su draw
 * call y podría asomar por el borde de la pantalla en un FOV ancho.
 */
export interface VmMagTransform {
  px: number
  py: number
  pz: number
  rx: number
  rz: number
  visible: boolean
}

/** Cargador en su asiento. Se preasigna una vez al arrancar el juego. */
export function createMagTransform(): VmMagTransform {
  return { px: 0, py: 0, pz: 0, rx: 0, rz: 0, visible: true }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeOutCubic(t: number): number {
  const u = 1 - t
  return 1 - u * u * u
}

/**
 * Pico del polinomio `t * (1-t)^3`, que está en t = 1/4. Se divide por esta
 * constante para que `snap()` valga exactamente 1 en su pico y los parámetros
 * de tuning se puedan leer como "metros de golpe" y no como "metros por una
 * constante rara".
 */
const SNAP_PEAK = 0.25 * 0.75 * 0.75 * 0.75

/**
 * Golpe seco: 0 antes de `start`, sube rápido hasta 1 al 25% de la ventana, y
 * decae hasta exactamente 0 en `start + span`.
 *
 * Asimétrico a propósito. Un pulso simétrico (una campana centrada en el
 * evento) empieza a moverse ANTES del evento, y eso se lee como anticipación:
 * el arma se sacude un poco antes de que salga el cargador. Un impacto real
 * arranca EN el golpe y se apaga después, que es exactamente esta forma.
 */
export function snap(frac: number, start: number, span: number): number {
  const t = (frac - start) / span
  if (t <= 0 || t >= 1) return 0
  const u = 1 - t
  return (t * u * u * u) / SNAP_PEAK
}

/**
 * Tirón de ida y vuelta: 0 en los dos extremos de la ventana, 1 en el medio.
 * Es la forma de un gesto que va y vuelve al mismo lugar —tirar de la manija
 * de carga y soltarla— y por eso es un seno y no un `snap`: la manija vuelve
 * sola, no se queda a medio camino decayendo.
 */
export function tug(frac: number, start: number, span: number): number {
  const t = (frac - start) / span
  if (t <= 0 || t >= 1) return 0
  return Math.sin(Math.PI * t)
}

/**
 * Envolvente principal: 0 en reposo, 1 con el arma abajo y rolada.
 *
 * Conserva las tres fases del spec original y sus mismos bordes (`magOutAt` y
 * `magInAt`), porque son los dos números que la tarea no permite mover y que
 * un test verifica. Lo que cambió no es CUÁNDO pasan las cosas sino QUÉ se
 * mueve: la misma envolvente ahora maneja también el roll y el yaw.
 *
 * El clamp de la fase C no es decorativo: sin él, un dt que salte `frac` por
 * encima de 1 (stall de tab con un `reloadTime` corto) mete un valor > 1 a
 * `easeInOutCubic`, que devuelve > 1, y la envolvente sale NEGATIVA — el arma
 * termina la recarga por encima de su posición de reposo y baja hasta ella.
 */
export function reloadEnvelope(frac: number): number {
  if (frac >= 1) return 0
  if (frac <= VIEWMODEL.reloadMagOutAt) {
    return easeInOutCubic(frac / VIEWMODEL.reloadMagOutAt)
  }
  if (frac <= VIEWMODEL.reloadMagInAt) return 1
  const c = clamp01((frac - VIEWMODEL.reloadMagInAt) / (1 - VIEWMODEL.reloadMagInAt))
  return 1 - easeInOutCubic(c)
}

/** Tirón hacia abajo del cuerpo al arrancar el cargador viejo. */
export function yankShape(frac: number): number {
  return snap(frac, VIEWMODEL.reloadMagOutAt, VIEWMODEL.reloadSnapSpan)
}

/** Golpe hacia arriba del cuerpo al encajar el cargador nuevo de una palmada. */
export function slapShape(frac: number): number {
  return snap(frac, VIEWMODEL.reloadMagInAt, VIEWMODEL.reloadSnapSpan)
}

/** Tirón de manija de carga que remata la secuencia. */
export function chargeShape(frac: number): number {
  return tug(frac, VIEWMODEL.reloadChargeAt, VIEWMODEL.reloadChargeSpan)
}

/**
 * Escribe en `out` la pose del cargador para esta fracción de recarga.
 *
 * Cuatro tramos:
 *
 * - **Antes de `magOutAt`:** puesto. Todo en cero.
 * - **Cae** durante `magFallSpan`. La caída es CUADRÁTICA, no lineal ni
 *   suavizada: un cargador que se suelta cae por gravedad, y la gravedad es
 *   aceleración constante. Una caída con `easeOut` (que desacelera) se lee
 *   como si el cargador flotara hacia abajo. Voltea mientras cae, porque nada
 *   lo sostiene.
 * - **Hueco** hasta `magInAt`: no hay cargador. `visible = false`.
 * - **Entra** durante `magInsertSpan`, desde `magEntryDistance` abajo, con
 *   `easeOut` (llega frenando: la mano lo acompaña, no lo tira) y termina
 *   exactamente en cero.
 *
 * `frac >= 1` cae por el primer caso y devuelve la pose asentada, que es lo
 * correcto: recarga terminada = cargador puesto.
 */
export function magazinePose(frac: number, out: VmMagTransform): void {
  const fallStart = VIEWMODEL.reloadMagOutAt
  const fallEnd = fallStart + VIEWMODEL.reloadMagFallSpan
  const insertStart = VIEWMODEL.reloadMagInAt
  const insertEnd = insertStart + VIEWMODEL.reloadMagInsertSpan

  if (frac < fallStart || frac >= insertEnd) {
    out.px = 0
    out.py = 0
    out.pz = 0
    out.rx = 0
    out.rz = 0
    out.visible = true
    return
  }

  if (frac < fallEnd) {
    const t = (frac - fallStart) / VIEWMODEL.reloadMagFallSpan
    out.px = 0
    out.py = -VIEWMODEL.reloadMagFallDistance * t * t
    // Sale un poco hacia adelante además de caer: un cargador que se suelta se
    // va del arma, no baja pegado a ella.
    out.pz = -0.05 * t
    out.rx = VIEWMODEL.reloadMagTumble * t
    out.rz = VIEWMODEL.reloadMagTumble * 0.4 * t
    out.visible = true
    return
  }

  if (frac < insertStart) {
    // El viejo ya salió de cuadro, el nuevo todavía no entró. Los campos se
    // ponen en cero igual, aunque nada los vaya a dibujar: dejar la pose de la
    // caída congelada acá haría que la salida dependa del tramo anterior, y
    // esta función tiene que ser función de `frac` y nada más.
    out.px = 0
    out.py = 0
    out.pz = 0
    out.rx = 0
    out.rz = 0
    out.visible = false
    return
  }

  const t = clamp01((frac - insertStart) / VIEWMODEL.reloadMagInsertSpan)
  const e = easeOutCubic(t)
  out.px = 0
  out.py = -VIEWMODEL.reloadMagEntryDistance * (1 - e)
  out.pz = 0
  out.rx = 0
  out.rz = 0
  out.visible = true
}
