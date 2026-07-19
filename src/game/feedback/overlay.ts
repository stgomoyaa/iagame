/**
 * Capa visual del sistema de feedback: DOM imperativo, sin React (sección
 * 5 del spec: "hitmarkers y números de daño se actualizan por frame, así
 * que van en DOM imperativo o en canvas -- nunca en estado de React, un
 * setState a 240Hz mata el framerate"). Mismo espíritu que
 * engine/stats.ts, pero SIN el throttle a 4Hz de ese HUD: acá el
 * requisito explícito es actualizar cada frame.
 *
 * Todo el DOM (crosshair, N hitmarkers, N números de daño, N flashes de
 * viñeta, overlay de latido) se crea UNA sola vez en mount(): render() sólo
 * muta propiedades de estilo de nodos ya existentes -- índice a índice
 * contra los pools de FeedbackState, 1:1, sin buscar ni crear nada. Los
 * únicos dos efectos que tocan el <canvas> del juego en vez de esta capa
 * son el shake (transform) y la desaturación (filter): ambos son
 * transformaciones de compositor puras, nunca disparan layout/paint, y no
 * pasan por el pipeline de WebGL que mide engine/gpu-timer.ts -- por eso
 * una viñeta full-screen es barata (gradiente alfa compuesto por el
 * navegador) y por eso NO se implementa acá con `backdrop-filter: blur`,
 * que sí es caro de compositor (sección 5 del spec: "una viñeta full-screen
 * es barata, un blur full-screen no").
 */

import type { HitmarkerTier } from '@/game/feedback/hitmarkers'
import { hitmarkerOpacity } from '@/game/feedback/hitmarkers'
import { damageNumberOpacity, damageNumberRiseOffset } from '@/game/feedback/damage-numbers'
import { vignetteOpacity } from '@/game/feedback/vignette'
import { desaturationAmount, heartbeatPulse } from '@/game/feedback/health-vfx'
import { FEEDBACK } from '@/game/feedback/tuning'
import type { FeedbackState } from '@/game/feedback/feedback'

const HITMARKER_COLOR: Record<HitmarkerTier, string> = {
  normal: '#e6e8ec',
  headshot: '#ffd35c',
  kill: '#ff5f5f',
  headshotKill: '#ff2d6e',
}

function styleBase(el: HTMLElement, cssText: string): void {
  el.style.cssText = cssText
}

function createCrosshair(): HTMLDivElement {
  const el = document.createElement('div')
  styleBase(
    el,
    'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;' +
      'border-radius:50%;background:#e6e8ec;opacity:0.85;pointer-events:none',
  )
  return el
}

function createHitmarkerElement(): { root: HTMLDivElement } {
  const root = document.createElement('div')
  styleBase(
    root,
    'position:absolute;left:50%;top:50%;width:24px;height:24px;' +
      'pointer-events:none;opacity:0;will-change:transform,opacity',
  )
  const bar1 = document.createElement('div')
  styleBase(
    bar1,
    'position:absolute;left:1px;top:10px;width:22px;height:3px;' +
      'background:currentColor;border-radius:2px;transform:rotate(45deg)',
  )
  const bar2 = document.createElement('div')
  styleBase(
    bar2,
    'position:absolute;left:1px;top:10px;width:22px;height:3px;' +
      'background:currentColor;border-radius:2px;transform:rotate(-45deg)',
  )
  root.appendChild(bar1)
  root.appendChild(bar2)
  return { root }
}

function createDamageNumberElement(): HTMLDivElement {
  const el = document.createElement('div')
  styleBase(
    el,
    'position:absolute;left:0;top:0;font:700 15px ui-monospace,monospace;' +
      'color:#ffd35c;text-shadow:0 1px 2px rgba(0,0,0,.8);' +
      'pointer-events:none;opacity:0;will-change:transform,opacity',
  )
  return el
}

function createVignetteElement(): HTMLDivElement {
  const el = document.createElement('div')
  styleBase(
    el,
    'position:absolute;inset:0;pointer-events:none;opacity:0;' +
      'background:radial-gradient(ellipse 90% 65% at 50% -8%, rgba(220,20,20,.9), transparent 62%)',
  )
  return el
}

export interface FeedbackOverlay {
  mount(parent: HTMLElement, canvas: HTMLCanvasElement): void
  unmount(): void
  /** El tamaño en pantalla del canvas, para convertir NDC a píxeles. Se
   *  llama desde el mismo onResize() que ya usa game.ts (gfx.resize,
   *  viewmodel.resize) -- nunca desde adentro de render(), para no leer
   *  clientWidth/clientHeight (layout forzado) en el camino de frame. */
  resize(width: number, height: number): void
  /** Llamar una vez por frame, después de stepFeedback(). */
  render(state: FeedbackState): void
}

export function createFeedbackOverlay(): FeedbackOverlay {
  let root: HTMLDivElement | null = null
  let canvasEl: HTMLCanvasElement | null = null
  let crosshair: HTMLDivElement | null = null
  let heartbeatEl: HTMLDivElement | null = null

  const hitmarkerEls: HTMLDivElement[] = []
  const damageNumberEls: HTMLDivElement[] = []
  const vignetteEls: HTMLDivElement[] = []

  let width = 1
  let height = 1

  return {
    mount(parent: HTMLElement, canvas: HTMLCanvasElement): void {
      canvasEl = canvas
      width = canvas.clientWidth || 1
      height = canvas.clientHeight || 1

      root = document.createElement('div')
      styleBase(root, 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:15')

      crosshair = createCrosshair()
      root.appendChild(crosshair)

      for (let i = 0; i < FEEDBACK.hitmarkerPoolSize; i++) {
        const { root: el } = createHitmarkerElement()
        hitmarkerEls.push(el)
        root.appendChild(el)
      }

      for (let i = 0; i < FEEDBACK.damageNumberPoolSize; i++) {
        const el = createDamageNumberElement()
        damageNumberEls.push(el)
        root.appendChild(el)
      }

      for (let i = 0; i < FEEDBACK.vignettePoolSize; i++) {
        const el = createVignetteElement()
        vignetteEls.push(el)
        root.appendChild(el)
      }

      heartbeatEl = document.createElement('div')
      styleBase(
        heartbeatEl,
        'position:absolute;inset:0;pointer-events:none;opacity:0;' +
          'background:radial-gradient(ellipse 140% 140% at 50% 50%, transparent 55%, rgba(180,10,10,.55))',
      )
      root.appendChild(heartbeatEl)

      parent.appendChild(root)
    },

    resize(w: number, h: number): void {
      width = Math.max(1, w)
      height = Math.max(1, h)
    },

    render(state: FeedbackState): void {
      if (!root) return

      // Hitmarkers: centrados en la mira, sólo escala + opacidad + color varían.
      const hmItems = state.hitmarkers.pool.items
      for (let i = 0; i < hmItems.length; i++) {
        const entry = hmItems[i]
        const el = hitmarkerEls[i]
        if (!entry.active) {
          el.style.opacity = '0'
          continue
        }
        const opacity = hitmarkerOpacity(entry.age, FEEDBACK.hitmarkerDurationS)
        el.style.opacity = String(opacity)
        el.style.color = HITMARKER_COLOR[entry.tier]
        el.style.transform = `translate(-50%,-50%) scale(${entry.scale})`
      }

      // Números de daño: NDC -> píxeles, más el offset de subida.
      const dnItems = state.damageNumbers.pool.items
      const halfW = width * 0.5
      const halfH = height * 0.5
      for (let i = 0; i < dnItems.length; i++) {
        const entry = dnItems[i]
        const el = damageNumberEls[i]
        if (!entry.active) {
          el.style.opacity = '0'
          continue
        }
        const opacity = damageNumberOpacity(entry.age, FEEDBACK.damageNumberLifetimeS)
        const rise = damageNumberRiseOffset(entry.age, FEEDBACK.damageNumberLifetimeS)
        const px = halfW + entry.ndcX * halfW
        const py = halfH - entry.ndcY * halfH - rise * halfH
        el.style.opacity = String(opacity)
        el.style.color = entry.isHeadshot ? '#ffd35c' : '#e6e8ec'
        el.style.transform = `translate(${px}px, ${py}px)`
        el.textContent = Math.round(entry.value).toString()
      }

      // Viñeta direccional: rotar el gradiente (anclado arriba) al bearing.
      const vgItems = state.vignette.pool.items
      for (let i = 0; i < vgItems.length; i++) {
        const entry = vgItems[i]
        const el = vignetteEls[i]
        if (!entry.active) {
          el.style.opacity = '0'
          continue
        }
        const opacity = vignetteOpacity(entry.age, entry.peakOpacity, FEEDBACK.vignetteDurationS)
        el.style.opacity = String(opacity)
        // El gradiente está anclado arriba (50% -8%, ver createVignetteElement)
        // y CSS rotate() gira en sentido horario con ángulo positivo. La
        // convención de bearing es la opuesta (positivo = izquierda del
        // jugador, ver vignette.ts) porque sigue el mismo signo de yaw que
        // el resto del motor (engine/input.ts: girar a la derecha DISMINUYE
        // el yaw) -- así que hay que invertir el signo acá para que
        // "bearing negativo (derecha)" efectivamente pinte el borde
        // DERECHO de la pantalla, no el izquierdo. Verificado a mano en el
        // navegador: sin este signo invertido, un golpe desde la derecha
        // del jugador iluminaba el borde izquierdo.
        el.style.transform = `rotate(${-entry.bearing}rad)`
      }

      // Latido + desaturación bajo el umbral de vida.
      const health = state.health.health
      if (heartbeatEl) {
        const pulse = heartbeatPulse(health, state.elapsedSeconds)
        heartbeatEl.style.opacity = String(pulse * 0.6)
      }
      if (canvasEl) {
        const desat = desaturationAmount(health)
        canvasEl.style.filter = desat > 0 ? `saturate(${1 - desat})` : ''
      }

      // Shake: transform de compositor puro sobre el canvas, nunca sobre
      // esta capa de UI -- la mira y los hitmarkers quedan fijos aunque la
      // "cámara" tiemble, que es lo que espera cualquier jugador de shooter.
      if (canvasEl) {
        const { offsetX, offsetY } = state.shake
        if (offsetX === 0 && offsetY === 0) {
          canvasEl.style.transform = ''
        } else {
          const px = offsetX * width
          const py = offsetY * height
          canvasEl.style.transform = `translate(${px}px, ${py}px)`
        }
      }
    },

    unmount(): void {
      root?.remove()
      root = null
      canvasEl = null
      crosshair = null
      heartbeatEl = null
      hitmarkerEls.length = 0
      damageNumberEls.length = 0
      vignetteEls.length = 0
    },
  }
}
