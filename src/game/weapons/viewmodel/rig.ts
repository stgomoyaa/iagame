import { MOVEMENT } from '@/game/movement/tuning'
import type { VmTransform, WeaponVisual } from '@/game/weapons/viewmodel/types'
import { VIEWMODEL } from '@/game/weapons/viewmodel/tuning'

/** Entrada del rig por tick. Nada de esto asigna: todos los campos son primitivos. */
export interface ViewmodelInput {
  /** Velocidad horizontal actual del jugador, m/s. */
  speed: number
  grounded: boolean
  /** Sostenido, no flanco: el rig integra adsT hacia 0 o 1 según este booleano. */
  ads: boolean
  /** Delta de mouse de este frame, horizontal. */
  mouseDeltaX: number
  /** Delta de mouse de este frame, vertical. */
  mouseDeltaY: number
}

export interface ViewmodelState {
  /** 0 = hip, 1 = ads. Avanza a razón de dt / adsTime, clampeado. */
  adsT: number

  /** Fase acumulada del bob. Nunca se resetea: sólo deja de avanzar si speed es 0. */
  bobPhase: number
  /** Acercamiento exponencial a 1 (suelo) o 0 (aire). Evita el corte en seco del bob al saltar. */
  groundedBlend: number

  swayX: number
  swayVelX: number
  swayY: number
  swayVelY: number

  kickPz: number
  kickVelPz: number
  kickPy: number
  kickVelPy: number
  kickRz: number
  kickVelRz: number
  /** +1 o -1. Alterna en cada fire() para que el roll no repita el mismo lado. */
  kickSide: number

  reloading: boolean
  /** Segundos transcurridos desde startReload. */
  reloadT: number
  /** Copia de weapon.reloadTime al momento de iniciar, para no depender del arma en cada tick. */
  reloadTime: number
  emittedMagOut: boolean
  emittedMagIn: boolean

  drawing: boolean
  drawT: number
  drawTime: number
}

export function createViewmodelState(): ViewmodelState {
  return {
    adsT: 0,

    bobPhase: 0,
    groundedBlend: 0,

    swayX: 0,
    swayVelX: 0,
    swayY: 0,
    swayVelY: 0,

    kickPz: 0,
    kickVelPz: 0,
    kickPy: 0,
    kickVelPy: 0,
    kickRz: 0,
    kickVelRz: 0,
    kickSide: 1,

    reloading: false,
    reloadT: 0,
    reloadTime: 0,
    emittedMagOut: false,
    emittedMagIn: false,

    drawing: false,
    drawT: 0,
    drawTime: 0,
  }
}

/** Impulso de culatazo al gatillo. El roll alterna de signo entre disparos. */
export function fire(state: ViewmodelState, weapon: WeaponVisual): void {
  state.kickVelPz += weapon.kickMagnitude * VIEWMODEL.kickBack
  state.kickVelPy += weapon.kickMagnitude * VIEWMODEL.kickUp
  state.kickVelRz += weapon.kickMagnitude * VIEWMODEL.kickRoll * state.kickSide
  state.kickSide = -state.kickSide
}

/** Arranca (o reinicia) la secuencia de recarga. Resetea los flags de evento. */
export function startReload(state: ViewmodelState, weapon: WeaponVisual): void {
  state.reloading = true
  state.reloadT = 0
  state.reloadTime = weapon.reloadTime
  state.emittedMagOut = false
  state.emittedMagIn = false
}

/** Arranca la subida desde DRAW_DROP al cambiar de arma. */
export function startDraw(state: ViewmodelState, weapon: WeaponVisual): void {
  state.drawing = true
  state.drawT = 0
  state.drawTime = weapon.drawTime
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
 * Un paso del resorte amortiguado de segundo orden (sway y kick comparten
 * esta misma dinámica). Devuelve sólo la nueva velocidad: la posición se
 * integra afuera con `pos += vel * dt`, para no tener que devolver dos
 * números sin asignar un array u objeto.
 */
function springVelocity(
  pos: number,
  vel: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): number {
  const v = vel + (target - pos) * stiffness * dt
  return v * Math.exp(-damping * dt)
}

/**
 * Evalúa el rig completo para un tick y escribe el resultado en `out`. Cero
 * asignaciones: todo el estado transitorio vive en `state`, que el llamador
 * preasigna una vez con createViewmodelState().
 */
export function stepViewmodel(
  state: ViewmodelState,
  input: ViewmodelInput,
  weapon: WeaponVisual,
  out: VmTransform,
  dt: number,
): void {
  // 1. base: interpolación hip -> ads según adsT.
  //
  // Integración lineal, no exponencial: el spec pide que adsT alcance
  // exactamente 1.0 al cumplirse adsTime y no se pase, en cualquiera de los
  // dos extremos. Un decaimiento exponencial nunca llega exacto a su
  // objetivo; una rampa lineal clampeada sí.
  const adsDir = input.ads ? 1 : -1
  state.adsT = clamp01(state.adsT + (adsDir * dt) / weapon.adsTime)
  const baseT = easeInOutCubic(state.adsT)

  out.px = weapon.hip.px + (weapon.ads.px - weapon.hip.px) * baseT
  out.py = weapon.hip.py + (weapon.ads.py - weapon.hip.py) * baseT
  out.pz = weapon.hip.pz + (weapon.ads.pz - weapon.hip.pz) * baseT
  out.rx = weapon.hip.rx + (weapon.ads.rx - weapon.hip.rx) * baseT
  out.ry = weapon.hip.ry + (weapon.ads.ry - weapon.hip.ry) * baseT
  out.rz = weapon.hip.rz + (weapon.ads.rz - weapon.hip.rz) * baseT

  // 2. bob: figura de ocho por velocidad de movimiento.
  //
  // La fase se acumula siempre, incluso a velocidad 0 (donde el incremento
  // es 0 y no pasa nada): nunca se resetea explícitamente, así que no hay
  // salto visible cuando el jugador retoma el movimiento.
  state.bobPhase += input.speed * dt * VIEWMODEL.bobFreq

  const groundedTarget = input.grounded ? 1 : 0
  // Acercamiento exponencial exacto (no Euler semi-implícito): esta es la
  // solución analítica de un decaimiento de primer orden, así que es
  // framerate-independiente sin importar el dt, igual que eyeHeight en
  // movement/step.ts.
  const groundedFactor = 1 - Math.exp(-dt / VIEWMODEL.groundedBlendTime)
  state.groundedBlend += (groundedTarget - state.groundedBlend) * groundedFactor

  const speedRatio = clamp01(input.speed / MOVEMENT.sprintSpeed)
  const bobAmp = VIEWMODEL.bobAmp * speedRatio * (1 - state.adsT) * state.groundedBlend
  out.px += Math.sin(state.bobPhase) * bobAmp
  out.py += Math.sin(state.bobPhase * 2) * bobAmp * 0.5

  // 3. sway: retardo respecto al mouse, resorte amortiguado de segundo
  // orden. Dos canales independientes: el delta horizontal cabecea en roll
  // (rz) y retrasa la posición en px; el vertical cabecea en pitch (rx) y
  // retrasa py. Mismo par stiffness/damping para ambos canales.
  const swayTargetX = Math.min(
    Math.max(-input.mouseDeltaX * VIEWMODEL.swayScale, -VIEWMODEL.swayMax),
    VIEWMODEL.swayMax,
  )
  state.swayVelX = springVelocity(
    state.swayX,
    state.swayVelX,
    swayTargetX,
    VIEWMODEL.swayStiffness,
    VIEWMODEL.swayDamping,
    dt,
  )
  state.swayX += state.swayVelX * dt

  const swayTargetY = Math.min(
    Math.max(-input.mouseDeltaY * VIEWMODEL.swayScale, -VIEWMODEL.swayMax),
    VIEWMODEL.swayMax,
  )
  state.swayVelY = springVelocity(
    state.swayY,
    state.swayVelY,
    swayTargetY,
    VIEWMODEL.swayStiffness,
    VIEWMODEL.swayDamping,
    dt,
  )
  state.swayY += state.swayVelY * dt

  const swayAtten = 1 - state.adsT * 0.6
  out.px += state.swayX * swayAtten
  out.rz += state.swayX * swayAtten
  out.py += state.swayY * swayAtten
  out.rx += state.swayY * swayAtten

  // 4. kick: impulso al disparar (aplicado en fire()), retorno elástico acá.
  // Mismo resorte que sway, objetivo cero, sin atenuación por ADS: el
  // culatazo se ve entero dispares donde dispares.
  state.kickVelPz = springVelocity(
    state.kickPz,
    state.kickVelPz,
    0,
    VIEWMODEL.swayStiffness,
    VIEWMODEL.swayDamping,
    dt,
  )
  state.kickPz += state.kickVelPz * dt

  state.kickVelPy = springVelocity(
    state.kickPy,
    state.kickVelPy,
    0,
    VIEWMODEL.swayStiffness,
    VIEWMODEL.swayDamping,
    dt,
  )
  state.kickPy += state.kickVelPy * dt

  state.kickVelRz = springVelocity(
    state.kickRz,
    state.kickVelRz,
    0,
    VIEWMODEL.swayStiffness,
    VIEWMODEL.swayDamping,
    dt,
  )
  state.kickRz += state.kickVelRz * dt

  out.pz += state.kickPz
  out.py += state.kickPy
  out.rz += state.kickRz

  // 5. reload: secuencia por código, tres fases sobre fracciones de
  // reloadTime. Los eventos se emiten una sola vez por recarga, en el tick
  // donde se cruza la fracción: el flag arranca en false y sólo se pone en
  // true, nunca se vuelve a poner en false hasta el próximo startReload().
  if (state.reloading) {
    state.reloadT += dt
    const frac = state.reloadT / state.reloadTime

    if (!state.emittedMagOut && frac >= VIEWMODEL.reloadMagOutAt) {
      state.emittedMagOut = true
    }
    if (!state.emittedMagIn && frac >= VIEWMODEL.reloadMagInAt) {
      state.emittedMagIn = true
    }

    // reloadT sólo avanza mientras reloading es true, así que una vez que
    // termina esta rama deja de ejecutarse: no hace falta un flag aparte
    // para saber si la capa está "activa", alcanza con `state.reloading`.
    let reloadShape: number
    if (frac <= VIEWMODEL.reloadMagOutAt) {
      // Fase A: baja e inclina.
      reloadShape = easeInOutCubic(frac / VIEWMODEL.reloadMagOutAt)
    } else if (frac <= VIEWMODEL.reloadMagInAt) {
      // Fase B: sostiene abajo, cargador afuera.
      reloadShape = 1
    } else {
      // Fase C: vuelve a la posición.
      const c = (frac - VIEWMODEL.reloadMagInAt) / (1 - VIEWMODEL.reloadMagInAt)
      reloadShape = 1 - easeInOutCubic(c)
    }
    out.py -= VIEWMODEL.reloadDrop * reloadShape
    out.rx += VIEWMODEL.reloadTilt * reloadShape

    if (frac >= 1) state.reloading = false
  }

  // 6. draw: sube desde DRAW_DROP metros abajo hasta cero en drawTime.
  if (state.drawing) {
    state.drawT += dt
    const f = clamp01(state.drawT / state.drawTime)
    out.py -= VIEWMODEL.drawDrop * (1 - easeOutCubic(f))
    if (f >= 1) state.drawing = false
  }
}
