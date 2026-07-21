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
import {
  crosshairOpacityUnderScope,
  mildotOffsetPx,
  SCOPE,
  scopeAlpha,
  scopeLensRadiusPx,
  scopeLensScale,
  type ScopeReticle,
} from '@/game/feedback/scope'

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

function createHitmarkerElement(): { root: HTMLDivElement; killMark: HTMLDivElement } {
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
  // Marca de baja: un rombo que ENMARCA la X, el "ding" visual de COD. Sólo
  // aparece en los niveles kill/headshotKill (render lo togglea por display),
  // así que una baja se lee distinta de un impacto normal sin depender sólo
  // del color. Hereda `currentColor`, o sea el color del nivel (rojo para la
  // baja, magenta para la baja a la cabeza). Es un nodo estático más del pool,
  // no se crea por frame.
  const killMark = document.createElement('div')
  styleBase(
    killMark,
    'position:absolute;left:1px;top:1px;width:22px;height:22px;box-sizing:border-box;' +
      'border:2px solid currentColor;transform:rotate(45deg);opacity:.9;display:none',
  )
  root.appendChild(killMark)
  root.appendChild(bar1)
  root.appendChild(bar2)
  return { root, killMark }
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

/**
 * Color del tubo del visor y de la retícula. Casi negro y no negro puro: el
 * resto del HUD ya vive en esta familia (#05070b es el fondo del aviso de
 * contexto perdido en game.ts) y un negro absoluto contra un cielo oscuro se
 * lee como si el canvas se hubiera apagado, no como un tubo.
 */
const SCOPE_TUBE = '#04050a'

/**
 * Las líneas de la retícula van negras con un halo blanco de 1 px
 * (`box-shadow` de spread, sin desenfoque: no es un blur, no cuesta lo que
 * cuesta un blur). Sin el halo, una retícula negra sobre una silueta en
 * sombra a 60 m —el caso de uso ENTERO de un francotirador— desaparece.
 */
const RETICLE_INK = 'background:#000;box-shadow:0 0 0 1px rgba(255,255,255,.22)'

function createScopeLayer(): HTMLDivElement {
  const el = document.createElement('div')
  styleBase(el, 'position:absolute;left:0;top:0;pointer-events:none;' + RETICLE_INK)
  return el
}

/**
 * Indicador de daño direccional: un ARCO rojo (sprite art-dirigido) pegado al
 * borde de la pantalla que apunta de DÓNDE vino el disparo (spec sección 5:
 * "indica de dónde vino"). El sprite apunta hacia ARRIBA (12 en punto = daño
 * de frente) y se desvanece a transparente en las puntas; render() lo ROTA
 * alrededor del centro de la pantalla según el bearing del atacante y le
 * modula la opacidad para que aparezca y se apague solo.
 *
 * Se sube como imagen (no un arco dibujado por CSS) porque el arte lo define
 * el dueño: alpha real en gradiente, mejor grano que un `conic-gradient`. El
 * `cover` lo escala a lo ancho para que el arco quede cerca del borde
 * superior, y `transform-origin:50% 50%` sobre un elemento a pantalla
 * completa hace que la rotación gire alrededor del centro exacto. Compositor
 * puro: sólo se anima `transform` (la rotación) y `opacity` (el fundido),
 * nunca layout. El navegador baja el PNG al montar (el elemento existe con la
 * imagen aunque esté a opacidad 0), así que el primer golpe ya lo tiene.
 */
const INDICADOR_DANO_URL = '/assets/ui/indicador-dano.png'

function createVignetteElement(): HTMLDivElement {
  const el = document.createElement('div')
  styleBase(
    el,
    'position:absolute;inset:0;pointer-events:none;opacity:0;transform-origin:50% 50%;' +
      'will-change:transform,opacity;background-repeat:no-repeat;background-position:center;' +
      `background-size:cover;background-image:url(${INDICADOR_DANO_URL})`,
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
  /**
   * Estampa de mira telescópica (feedback/scope.ts). Llamar una vez por
   * frame, ANTES de render(): `reticle` es null para todo lo que no sea un
   * arma de precisión con óptica —y ahí esta llamada no toca un solo nodo
   * del DOM, por lo que el ADS de hierros queda literalmente idéntico— y
   * `easedAdsT` es el MISMO adsT ya pasado por easeInOutCubic que alimentan
   * FOV y sensibilidad en combat/ads.ts, para que el tubo termine de
   * cerrarse exactamente cuando el zoom termina de llegar.
   */
  setScope(reticle: ScopeReticle | null, easedAdsT: number): void
  /** Llamar una vez por frame, después de stepFeedback(). */
  render(state: FeedbackState): void
}

export function createFeedbackOverlay(): FeedbackOverlay {
  let root: HTMLDivElement | null = null
  let canvasEl: HTMLCanvasElement | null = null
  let crosshair: HTMLDivElement | null = null
  let heartbeatEl: HTMLDivElement | null = null

  const hitmarkerEls: HTMLDivElement[] = []
  /** El rombo de "baja" de cada hitmarker del pool, 1:1 con `hitmarkerEls`.
   *  render() lo enciende/apaga por nivel sin crear ni buscar nada. */
  const hitmarkerKillMarks: HTMLDivElement[] = []
  const damageNumberEls: HTMLDivElement[] = []
  const vignetteEls: HTMLDivElement[] = []

  // --- estampa de visor (feedback/scope.ts) --------------------------------
  // Todo esto se crea UNA vez en mount() y se coloca en píxeles UNA vez por
  // resize(). El camino de frame sólo escribe dos propiedades (la opacidad
  // de la raíz y la escala del contenedor interno), y ni eso cuando el valor
  // no cambió: con un arma de hierros equipada, setScope() sale por el
  // primer `if` sin tocar nada.
  //
  // Los cuatro brazos, en el orden [derecha, izquierda, abajo, arriba]. Se
  // guarda como pares (dx, dy) para que colocar mildots, postes y tramos
  // finos sea el mismo bucle en vez de cuatro casos copiados.
  const ARM_DX = [1, -1, 0, 0]
  const ARM_DY = [0, 0, 1, -1]

  let scopeRoot: HTMLDivElement | null = null
  /** Contenedor interno: acá vive el `transform: scale()` del acercamiento
   *  de la lente, separado de la opacidad de la raíz para que animar las dos
   *  cosas no obligue a recomponer la misma propiedad. */
  let scopeInner: HTMLDivElement | null = null
  let scopeMask: HTMLDivElement | null = null
  /** Grupo de la retícula del cerrojo: cruz a pantalla completa + mildots. */
  let mildotGroup: HTMLDivElement | null = null
  /** Grupo de la retícula del marksman: postes duplex + punto central. */
  let duplexGroup: HTMLDivElement | null = null
  let scopeHLine: HTMLDivElement | null = null
  let scopeVLine: HTMLDivElement | null = null
  const mildotEls: HTMLDivElement[] = []
  const duplexThickEls: HTMLDivElement[] = []
  const duplexThinEls: HTMLDivElement[] = []
  let duplexDot: HTMLDivElement | null = null

  /** Última opacidad y última retícula ya escritas en el DOM: el guard que
   *  hace que un frame sin cambios no genere ni una escritura de estilo (ni,
   *  por lo tanto, ninguna de las cadenas que armarlas implicaría). */
  let lastScopeAlpha = -1
  let lastReticle: ScopeReticle | null = null

  let width = 1
  let height = 1

  /**
   * Recoloca toda la estampa en píxeles para el tamaño actual del canvas.
   * Corre en mount() y en resize(), NUNCA en el camino de frame: acá sí se
   * arman decenas de cadenas de estilo, y eso es exactamente lo que no puede
   * pasar 240 veces por segundo.
   */
  function layoutScope(): void {
    if (!scopeRoot || !scopeMask) return
    const cx = width * 0.5
    const cy = height * 0.5
    const r = scopeLensRadiusPx(width, height)

    // Dos gradientes en un solo elemento (una sola capa que componer):
    //  1. el tubo — transparente adentro del radio, opaco afuera. El medio
    //     píxel de rampa entre las dos paradas es lo que le da el borde
    //     antialias; con una parada dura el círculo queda dentado.
    //  2. el viñeteo de la lente — oscurecimiento progresivo hacia el borde
    //     del vidrio, que es lo que hace que se lea como una óptica y no
    //     como un agujero recortado en una cartulina.
    // El orden importa: el primero se pinta encima, así que afuera del radio
    // tapa por completo al segundo.
    scopeMask.style.background =
      `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${r - 1}px, ${SCOPE_TUBE} ${r}px),` +
      `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${r * 0.55}px, rgba(0,0,0,.62) ${r}px)`

    // Cruz a pantalla completa del cerrojo: las líneas NO se cortan en el
    // centro (el AWP de CS tampoco las corta) — la intersección ES el punto
    // de puntería, y un hueco ahí obligaría a adivinar dónde se cruzan.
    if (scopeHLine) {
      scopeHLine.style.left = '0px'
      scopeHLine.style.top = `${cy - 0.5}px`
      scopeHLine.style.width = `${width}px`
      scopeHLine.style.height = '1px'
    }
    if (scopeVLine) {
      scopeVLine.style.left = `${cx - 0.5}px`
      scopeVLine.style.top = '0px'
      scopeVLine.style.width = '1px'
      scopeVLine.style.height = `${height}px`
    }

    const dotSize = SCOPE.mildotSizePx
    for (let arm = 0; arm < ARM_DX.length; arm++) {
      for (let i = 0; i < SCOPE.mildotsPerArm; i++) {
        const el = mildotEls[arm * SCOPE.mildotsPerArm + i]
        const offset = mildotOffsetPx(i, r)
        el.style.width = `${dotSize}px`
        el.style.height = `${dotSize}px`
        el.style.borderRadius = '50%'
        el.style.left = `${cx + ARM_DX[arm] * offset - dotSize * 0.5}px`
        el.style.top = `${cy + ARM_DY[arm] * offset - dotSize * 0.5}px`
      }
    }

    // Duplex: poste grueso desde casi el borde de la lente hacia adentro,
    // tramo fino de ahí al hueco central. Los dos son el mismo rectángulo
    // rotado 90°, así que se calculan con el mismo par (dx, dy).
    const thickOuter = r * 0.97
    const thickInner = r * SCOPE.duplexThickInnerFraction
    const gap = r * SCOPE.duplexCenterGapFraction
    for (let arm = 0; arm < ARM_DX.length; arm++) {
      const dx = ARM_DX[arm]
      const dy = ARM_DY[arm]
      const horizontal = dx !== 0
      const thick = duplexThickEls[arm]
      const thin = duplexThinEls[arm]
      // `near`/`far` en distancia al centro; el signo lo pone dx/dy después.
      layoutArmSegment(thick, cx, cy, dx, dy, horizontal, thickInner, thickOuter, 3)
      layoutArmSegment(thin, cx, cy, dx, dy, horizontal, gap, thickInner, 1)
    }
    if (duplexDot) {
      duplexDot.style.width = '2px'
      duplexDot.style.height = '2px'
      duplexDot.style.borderRadius = '50%'
      duplexDot.style.left = `${cx - 1}px`
      duplexDot.style.top = `${cy - 1}px`
    }
  }

  /** Coloca un tramo de brazo (poste o filamento) entre `near` y `far`
   *  píxeles del centro, sobre el eje que indique (dx, dy). */
  function layoutArmSegment(
    el: HTMLDivElement,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
    horizontal: boolean,
    near: number,
    far: number,
    thickness: number,
  ): void {
    const length = Math.max(0, far - near)
    if (horizontal) {
      el.style.width = `${length}px`
      el.style.height = `${thickness}px`
      el.style.left = `${cx + (dx > 0 ? near : -far)}px`
      el.style.top = `${cy - thickness * 0.5}px`
    } else {
      el.style.width = `${thickness}px`
      el.style.height = `${length}px`
      el.style.left = `${cx - thickness * 0.5}px`
      el.style.top = `${cy + (dy > 0 ? near : -far)}px`
    }
  }

  return {
    mount(parent: HTMLElement, canvas: HTMLCanvasElement): void {
      canvasEl = canvas
      width = canvas.clientWidth || 1
      height = canvas.clientHeight || 1

      root = document.createElement('div')
      styleBase(root, 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:15')

      crosshair = createCrosshair()
      root.appendChild(crosshair)

      // La estampa se inserta DESPUÉS de la mira y ANTES de hitmarkers,
      // números de daño y viñetas: el tubo tapa la mira normal (que además
      // se apaga por opacidad, ver setScope) pero nunca puede tapar el
      // feedback de combate — apuntar por un visor no puede costarte ver que
      // acertaste.
      scopeRoot = document.createElement('div')
      styleBase(
        scopeRoot,
        'position:absolute;inset:0;pointer-events:none;display:none;opacity:0;will-change:opacity',
      )
      scopeInner = document.createElement('div')
      styleBase(
        scopeInner,
        'position:absolute;inset:0;pointer-events:none;transform-origin:50% 50%;will-change:transform',
      )
      scopeMask = document.createElement('div')
      styleBase(scopeMask, 'position:absolute;inset:0;pointer-events:none')
      scopeInner.appendChild(scopeMask)

      mildotGroup = document.createElement('div')
      styleBase(mildotGroup, 'position:absolute;inset:0;pointer-events:none;display:none')
      scopeHLine = createScopeLayer()
      scopeVLine = createScopeLayer()
      mildotGroup.appendChild(scopeHLine)
      mildotGroup.appendChild(scopeVLine)
      for (let i = 0; i < ARM_DX.length * SCOPE.mildotsPerArm; i++) {
        const dot = createScopeLayer()
        mildotEls.push(dot)
        mildotGroup.appendChild(dot)
      }
      scopeInner.appendChild(mildotGroup)

      duplexGroup = document.createElement('div')
      styleBase(duplexGroup, 'position:absolute;inset:0;pointer-events:none;display:none')
      for (let i = 0; i < ARM_DX.length; i++) {
        const thick = createScopeLayer()
        const thin = createScopeLayer()
        duplexThickEls.push(thick)
        duplexThinEls.push(thin)
        duplexGroup.appendChild(thick)
        duplexGroup.appendChild(thin)
      }
      duplexDot = createScopeLayer()
      duplexGroup.appendChild(duplexDot)
      scopeInner.appendChild(duplexGroup)

      scopeRoot.appendChild(scopeInner)
      root.appendChild(scopeRoot)
      layoutScope()

      for (let i = 0; i < FEEDBACK.hitmarkerPoolSize; i++) {
        const { root: el, killMark } = createHitmarkerElement()
        hitmarkerEls.push(el)
        hitmarkerKillMarks.push(killMark)
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
      layoutScope()
    },

    setScope(reticle: ScopeReticle | null, easedAdsT: number): void {
      // Camino de las armas de hierros: `reticle` es null, el alfa es 0, y
      // en cuanto el estado ya está escrito esta función sale sin tocar el
      // DOM. Es la garantía de que el ADS medido al píxel del resto del
      // arsenal no cambió — no hay nada que pueda cambiarlo.
      const alpha = reticle === null ? 0 : scopeAlpha(easedAdsT)
      if (alpha === lastScopeAlpha && reticle === lastReticle) return

      if (reticle !== lastReticle) {
        if (mildotGroup) mildotGroup.style.display = reticle === 'mildot' ? 'block' : 'none'
        if (duplexGroup) duplexGroup.style.display = reticle === 'duplex' ? 'block' : 'none'
        lastReticle = reticle
      }

      if (scopeRoot) {
        // `display:none` con la estampa apagada y no sólo `opacity:0`: una
        // capa transparente a pantalla completa se sigue componiendo en cada
        // frame. Apagada de verdad, el 90% del arsenal no paga absolutamente
        // nada por que esta característica exista.
        scopeRoot.style.display = alpha > 0 ? 'block' : 'none'
        scopeRoot.style.opacity = String(alpha)
      }
      if (scopeInner && alpha > 0) {
        scopeInner.style.transform = `scale(${scopeLensScale(alpha)})`
      }
      if (crosshair) {
        crosshair.style.opacity = String(crosshairOpacityUnderScope(alpha))
      }
      lastScopeAlpha = alpha
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
        // El rombo de baja sólo enmarca la X en los niveles kill: es lo que
        // convierte un impacto en una CONFIRMACIÓN de baja. Los otros dos
        // niveles (normal/headshot) se distinguen por color, sin rombo.
        hitmarkerKillMarks[i].style.display =
          entry.tier === 'kill' || entry.tier === 'headshotKill' ? 'block' : 'none'
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

      // Indicador de daño direccional: rotar el sprite (que apunta arriba) al
      // bearing del atacante.
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
        // El sprite apunta arriba (ver createVignetteElement) y CSS rotate()
        // gira en sentido horario con ángulo positivo. La convención de
        // bearing es la opuesta (positivo = izquierda del jugador, ver
        // vignette.ts) porque sigue el mismo signo de yaw que el resto del
        // motor (engine/input.ts: girar a la derecha DISMINUYE el yaw) -- así
        // que hay que invertir el signo acá para que "bearing negativo
        // (derecha)" efectivamente apunte el arco al borde DERECHO de la
        // pantalla, no al izquierdo. Verificado a mano en el navegador: sin
        // este signo invertido, un golpe desde la derecha del jugador iluminaba
        // el borde izquierdo.
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
      hitmarkerKillMarks.length = 0
      damageNumberEls.length = 0
      vignetteEls.length = 0
      scopeRoot = null
      scopeInner = null
      scopeMask = null
      mildotGroup = null
      duplexGroup = null
      scopeHLine = null
      scopeVLine = null
      duplexDot = null
      mildotEls.length = 0
      duplexThickEls.length = 0
      duplexThinEls.length = 0
      // El guard de "no escribas si no cambió" es estado del DOM que se
      // acaba de tirar: sin resetearlo, un mount() posterior (cambio de
      // mapa, HMR) arrancaría creyendo que ya escribió una opacidad que en
      // realidad nadie escribió en los nodos nuevos.
      lastScopeAlpha = -1
      lastReticle = null
    },
  }
}
