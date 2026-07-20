/**
 * HUD de combate: munición, vida, arma en mano, reloj y puntaje.
 *
 * DOM imperativo, sin React, por el mismo motivo que
 * `game/feedback/overlay.ts` (leer su cabecera): esto se actualiza en el
 * ritmo del rAF, y un `setState` a 240 Hz mata el framerate. La capa vive
 * fuera del pipeline de WebGL -- es texto que el navegador compone -- así
 * que no toca el presupuesto de 2.5 ms de GPU que mide `engine/gpu-timer.ts`.
 *
 * La disciplina que hace que esto sea gratis es la misma de overlay.ts:
 *
 *  1. Todo el DOM se crea UNA vez en `mount()`. `render()` no crea, no
 *     busca y no borra nodos: sólo escribe propiedades de nodos que ya
 *     existen.
 *  2. Cada escritura está detrás de un guard contra el último valor
 *     escrito. Un frame en el que nada cambió no genera NI UNA escritura de
 *     DOM, y -- más importante -- ni una de las cadenas que armarlas
 *     implicaría. En un tiroteo la munición cambia ~10 veces por segundo y
 *     el reloj una vez por segundo; los otros 230 frames no hacen nada.
 *  3. Las cadenas se arman sólo cuando el NÚMERO cambió, nunca por frame.
 *     `${ammo}` con el mismo ammo genera basura igual, así que el guard va
 *     sobre el número, antes de formatear.
 *
 * Estilo: verde monoespaciado sobre negro translúcido, el mismo lenguaje
 * que `engine/stats.ts` (#5fff9f) y los paneles de tuning. Rojo (#ff5f5f)
 * para los estados que hay que leer sin pensar: poca vida, cargador casi
 * vacío, poco tiempo. Es un HUD para leer de reojo mientras te disparan, no
 * una pantalla de menú.
 */

import type { HudSnapshot } from '@/game/game'
import type { MatchState } from '@/game/match/match'
import { teamScore } from '@/game/match/scoring'
import { PLAYER_ID } from '@/game/match/types'

const VERDE = '#5fff9f'
const ROJO = '#ff5f5f'
const TENUE = '#8a8f98'

/** Bajo esta fracción de vida el número se pone rojo. */
const VIDA_CRITICA = 0.35
/** Bajo esta fracción de cargador la munición se pone roja. */
const MUNICION_CRITICA = 0.25
/** Bajo estos segundos el reloj se pone rojo. */
const TIEMPO_CRITICO_S = 30

/** Muescas de la barra de vida. */
const MUESCAS_VIDA = 10

/**
 * Sombra dura de 1 px en cuatro direcciones en vez de un `text-shadow`
 * difuminado. Un HUD verde sobre el cielo claro de nuketown desaparece sin
 * contorno, y un blur cuesta al compositor lo que un contorno duro no
 * (mismo criterio que el halo de la retícula en feedback/overlay.ts).
 */
const CONTORNO =
  'text-shadow:0 1px 0 #000,0 -1px 0 #000,1px 0 0 #000,-1px 0 0 #000'

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace'

function div(cssText: string): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = cssText
  return el
}

/** "4:32". Sólo se llama cuando el segundo entero cambió. */
function formatearReloj(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos))
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

export interface Hud {
  mount(parent: HTMLElement): void
  unmount(): void
  /** Llamar una vez por frame. Ver la cabecera: no escribe si nada cambió. */
  render(snap: HudSnapshot, match: MatchState): void
}

export function createHud(): Hud {
  let root: HTMLDivElement | null = null

  // --- munición (abajo a la derecha) ---
  let ammoEl: HTMLDivElement | null = null
  let magEl: HTMLDivElement | null = null
  let weaponEl: HTMLDivElement | null = null
  let slotEl: HTMLDivElement | null = null

  // --- vida (abajo a la izquierda) ---
  let healthEl: HTMLDivElement | null = null
  const muescasVida: HTMLDivElement[] = []

  // --- partida (arriba al centro) ---
  let relojEl: HTMLDivElement | null = null
  let marcadorEl: HTMLDivElement | null = null

  // --- muerte (centro) ---
  let muerteEl: HTMLDivElement | null = null
  let muerteTextoEl: HTMLDivElement | null = null

  // Últimos valores ESCRITOS en el DOM. Todos arrancan en un centinela
  // imposible para que el primer render escriba sí o sí: si arrancaran en 0
  // o en '', un HUD que abre con 0 balas no pintaría el cero y quedaría en
  // blanco.
  let lastAmmo = -1
  let lastMag = -1
  let lastAmmoRojo: boolean | null = null
  let lastReloading: boolean | null = null
  let lastWeapon: string | null = null
  let lastSlot: string | null = null
  let lastHealth = -1
  let lastHealthRojo: boolean | null = null
  let lastMuescasLlenas = -1
  let lastSegundos = -1
  let lastRelojRojo: boolean | null = null
  let lastMarcador: string | null = null
  let lastMuerteVisible: boolean | null = null
  let lastMuerteSegundos = -1

  return {
    mount(parent: HTMLElement): void {
      // z-index 16: justo por encima de la capa de feedback (15, ver
      // overlay.ts) para que el contador no quede tapado por una viñeta de
      // daño a pantalla completa, y por debajo del killfeed/scoreboard de
      // React (20/30) y del menú de pausa.
      root = div('position:absolute;inset:0;pointer-events:none;z-index:16;' + `font-family:${MONO}`)

      // ---- Partida: reloj y marcador, arriba al centro ----
      //
      // `top:38px` y no 8px: `engine/stats.ts` monta su línea de diagnóstico
      // en `top:8px` y ocupa el ANCHO ENTERO de la pantalla (cpu, gpu, draws,
      // triángulos y el desglose del profiler, todo en una línea sin wrap),
      // así que un reloj centrado a la misma altura le queda encima. Se
      // verificó mirando la captura: a 8px el "5:53" se leía tachado por
      // "presupuesto 2.5ms". 38px lo deja justo debajo (8 de tope + ~24 de
      // alto de esa línea).
      const partida = div(
        'position:absolute;top:38px;left:50%;transform:translateX(-50%);' +
          'display:flex;flex-direction:column;align-items:center;gap:2px;' +
          'background:rgba(0,0,0,.55);padding:6px 14px;border-radius:4px',
      )
      relojEl = div(`font:600 20px ${MONO};line-height:1;color:${VERDE};${CONTORNO}`)
      marcadorEl = div(`font:12px ${MONO};line-height:1;color:${TENUE};${CONTORNO}`)
      partida.appendChild(relojEl)
      partida.appendChild(marcadorEl)
      root.appendChild(partida)

      // ---- Vida, abajo a la izquierda ----
      const vida = div('position:absolute;left:18px;bottom:16px;')
      healthEl = div(`font:700 34px ${MONO};line-height:1;color:${VERDE};${CONTORNO}`)
      const barra = div('display:flex;gap:2px;margin-top:6px')
      for (let i = 0; i < MUESCAS_VIDA; i++) {
        const m = div(`width:12px;height:4px;background:${VERDE};opacity:.25`)
        muescasVida.push(m)
        barra.appendChild(m)
      }
      vida.appendChild(healthEl)
      vida.appendChild(barra)
      root.appendChild(vida)

      // ---- Munición y arma, abajo a la derecha ----
      const municion = div(
        'position:absolute;right:18px;bottom:16px;display:flex;flex-direction:column;' +
          'align-items:flex-end;gap:2px',
      )
      weaponEl = div(
        `font:600 13px ${MONO};line-height:1;color:#e6e8ec;letter-spacing:.06em;${CONTORNO}`,
      )
      const fila = div('display:flex;align-items:baseline;gap:4px')
      ammoEl = div(`font:700 34px ${MONO};line-height:1;color:${VERDE};${CONTORNO}`)
      magEl = div(`font:600 15px ${MONO};line-height:1;color:${TENUE};${CONTORNO}`)
      fila.appendChild(ammoEl)
      fila.appendChild(magEl)
      // La pista de las ranuras es lo que hace descubrible el cambio de arma:
      // sin ella, "1" y "2" son atajos que nadie sabe que existen.
      slotEl = div(`font:10px ${MONO};line-height:1.4;color:${TENUE};text-align:right;${CONTORNO}`)
      municion.appendChild(weaponEl)
      municion.appendChild(fila)
      municion.appendChild(slotEl)
      root.appendChild(municion)

      // ---- Muerte y cuenta atrás de reaparición, al centro ----
      muerteEl = div(
        'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
          'flex-direction:column;gap:6px',
      )
      const muerteTitulo = div(
        `font:700 22px ${MONO};letter-spacing:.18em;color:${ROJO};${CONTORNO}`,
      )
      muerteTitulo.textContent = 'ELIMINADO'
      muerteTextoEl = div(`font:14px ${MONO};color:#e6e8ec;${CONTORNO}`)
      muerteEl.appendChild(muerteTitulo)
      muerteEl.appendChild(muerteTextoEl)
      root.appendChild(muerteEl)

      parent.appendChild(root)
    },

    render(snap: HudSnapshot, match: MatchState): void {
      if (!root) return

      // ---- Munición ----
      if (snap.ammo !== lastAmmo) {
        lastAmmo = snap.ammo
        if (ammoEl) ammoEl.textContent = String(snap.ammo)
      }
      if (snap.magazine !== lastMag) {
        lastMag = snap.magazine
        if (magEl) magEl.textContent = `/ ${snap.magazine}`
      }
      // El color se decide sobre el booleano derivado, no sobre el número:
      // así una ráfaga de 30 a 8 balas escribe el color UNA vez, cuando
      // cruza el umbral, y no treinta.
      const ammoRojo = snap.magazine > 0 && snap.ammo / snap.magazine <= MUNICION_CRITICA
      if (ammoRojo !== lastAmmoRojo) {
        lastAmmoRojo = ammoRojo
        if (ammoEl) ammoEl.style.color = ammoRojo ? ROJO : VERDE
      }
      if (snap.reloading !== lastReloading) {
        lastReloading = snap.reloading
        // Recargando, el número que está en pantalla ya no significa nada
        // (el cargador se rellena al FINAL de la animación, ver
        // combat/fire-control.ts): se apaga en vez de mentir.
        if (ammoEl) ammoEl.style.opacity = snap.reloading ? '.35' : '1'
        if (slotEl && snap.reloading) slotEl.textContent = 'RECARGANDO'
      }

      if (snap.weaponName !== lastWeapon) {
        lastWeapon = snap.weaponName
        if (weaponEl) weaponEl.textContent = snap.weaponName.toUpperCase()
      }

      // La línea de ranuras depende de tres cosas (nombres y ranura en mano)
      // y de si se está recargando; se rearma sólo cuando alguna cambió.
      const slotClave = `${snap.slot}|${snap.primaryName}|${snap.secondaryName}|${snap.reloading}`
      if (slotClave !== lastSlot) {
        lastSlot = slotClave
        if (slotEl) {
          slotEl.textContent = snap.reloading
            ? 'RECARGANDO'
            : `[1] ${snap.primaryName || '--'}   [2] ${snap.secondaryName || '--'}`
          // La ranura en mano se marca con el color, no con un símbolo: es
          // una lectura de reojo.
          slotEl.style.color = TENUE
        }
      }

      // ---- Vida ----
      const vidaEntera = Math.max(0, Math.ceil(snap.health))
      if (vidaEntera !== lastHealth) {
        lastHealth = vidaEntera
        if (healthEl) healthEl.textContent = String(vidaEntera)
      }
      const fraccion = snap.maxHealth > 0 ? snap.health / snap.maxHealth : 0
      const vidaRoja = fraccion <= VIDA_CRITICA
      if (vidaRoja !== lastHealthRojo) {
        lastHealthRojo = vidaRoja
        if (healthEl) healthEl.style.color = vidaRoja ? ROJO : VERDE
        for (const m of muescasVida) m.style.background = vidaRoja ? ROJO : VERDE
      }
      const llenas = Math.max(0, Math.min(MUESCAS_VIDA, Math.ceil(fraccion * MUESCAS_VIDA)))
      if (llenas !== lastMuescasLlenas) {
        // Sólo se tocan las muescas que CAMBIARON de lado del umbral. Con
        // diez muescas la diferencia es despreciable, pero el patrón importa:
        // es el mismo bucle índice a índice de los pools de overlay.ts.
        const desde = Math.min(llenas, lastMuescasLlenas < 0 ? 0 : lastMuescasLlenas)
        const hasta = Math.max(llenas, lastMuescasLlenas < 0 ? MUESCAS_VIDA : lastMuescasLlenas)
        for (let i = desde; i < hasta; i++) muescasVida[i].style.opacity = i < llenas ? '1' : '.25'
        lastMuescasLlenas = llenas
      }

      // ---- Reloj y marcador ----
      const segundos = Math.max(0, Math.floor(match.timeRemainingS))
      if (segundos !== lastSegundos) {
        lastSegundos = segundos
        if (relojEl) relojEl.textContent = formatearReloj(segundos)
      }
      const relojRojo = segundos <= TIEMPO_CRITICO_S
      if (relojRojo !== lastRelojRojo) {
        lastRelojRojo = relojRojo
        if (relojEl) relojEl.style.color = relojRojo ? ROJO : VERDE
      }

      // En TDM el marcador son los dos equipos; en FFA, los kills del
      // jugador contra el mejor rival. teamScore/leadingKills recorren la
      // lista de participantes, así que se llaman DESPUÉS del guard, no
      // antes: con el marcador quieto esto no cuesta nada.
      const marcador =
        match.mode === 'tdm'
          ? `${teamScore(match.mode, match.participants, 0)} — ${teamScore(match.mode, match.participants, 1)}`
          : `${match.participants[PLAYER_ID].kills} bajas`
      if (marcador !== lastMarcador) {
        lastMarcador = marcador
        if (marcadorEl) marcadorEl.textContent = marcador
      }

      // ---- Muerte ----
      const muerto = !snap.alive
      if (muerto !== lastMuerteVisible) {
        lastMuerteVisible = muerto
        if (muerteEl) muerteEl.style.display = muerto ? 'flex' : 'none'
      }
      if (muerto) {
        const restante = Math.max(0, Math.ceil(snap.respawnInS))
        if (restante !== lastMuerteSegundos) {
          lastMuerteSegundos = restante
          if (muerteTextoEl) muerteTextoEl.textContent = `Reapareces en ${restante}`
        }
      }
    },

    unmount(): void {
      root?.remove()
      root = null
      ammoEl = null
      magEl = null
      weaponEl = null
      slotEl = null
      healthEl = null
      relojEl = null
      marcadorEl = null
      muerteEl = null
      muerteTextoEl = null
      muescasVida.length = 0
      // Los guards son estado del DOM que se acaba de tirar. Sin resetearlos,
      // un mount() posterior (HMR, cambio de mapa) arrancaría creyendo que ya
      // escribió valores que nadie escribió en los nodos nuevos, y el HUD
      // abriría en blanco hasta que algo cambiara. Es el mismo reset que hace
      // feedback/overlay.ts con lastScopeAlpha, y por el mismo motivo.
      lastAmmo = -1
      lastMag = -1
      lastAmmoRojo = null
      lastReloading = null
      lastWeapon = null
      lastSlot = null
      lastHealth = -1
      lastHealthRojo = null
      lastMuescasLlenas = -1
      lastSegundos = -1
      lastRelojRojo = null
      lastMarcador = null
      lastMuerteVisible = null
      lastMuerteSegundos = -1
    },
  }
}
