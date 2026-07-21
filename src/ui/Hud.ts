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
 * Estética: dark-técnico neón, el mismo lenguaje que la armería y las
 * pantallas de rango (globals.css: acento cian `oklch(0.82 0.145 195)` y
 * chaflán). La jerarquía es deliberada, no plana como un profiler:
 *
 *  - Los PROTAGONISTAS (vida abajo-izq, munición abajo-der) son numerales
 *    Oswald condensados de 58px que DOMINAN sus esquinas. Es lo único que se
 *    mira en pleno combate; tiene que leerse de reojo sin buscar.
 *  - Lo SECUNDARIO (reloj, marcador, nombre de arma, selector de ranuras)
 *    queda en Geist Mono chico y tenue: informa, no compite.
 *  - La FIRMA geométrica: placas chaflanadas con una barra de acento cian en
 *    el techo. El mismo gesto angular se repite en vida, munición, reloj y en
 *    el cartel de muerte -- eso es lo que hace que este HUD sea de ESTE juego
 *    y no una consola de debug genérica.
 *  - Rojo (#ff5f5f) SÓLO para los estados que hay que leer sin pensar: poca
 *    vida, cargador casi vacío, poco tiempo. El acento cian es identidad; el
 *    rojo es alarma. No se mezclan.
 */

import type { HudSnapshot } from '@/game/game'
import type { MatchState } from '@/game/match/match'
import { teamScore } from '@/game/match/scoring'
import { PLAYER_ID } from '@/game/match/types'

/** Acento de identidad: el mismo cian de la armería y el rango
 *  (globals.css `--arm-acento`). Conversa con la galaxia púrpura del cielo y
 *  con los camos neón. Es CHROME, no alarma: nunca marca un estado de peligro. */
const ACENTO = 'oklch(0.82 0.145 195)'
/** Cian apagado para el nombre del arma: presente pero subordinado al número. */
const ACENTO_TENUE = 'oklch(0.70 0.11 195)'
/** Numerales protagonistas: casi blanco con una pizca de cian, para que se
 *  lean "encendidos" sobre el negro (misma familia que los camos que emiten). */
const TINTA = 'oklch(0.97 0.02 200)'
/** Alarma. Se conserva exactamente el rojo de antes: poca vida, cargador casi
 *  vacío, poco tiempo. */
const ROJO = '#ff5f5f'
/** Texto secundario (reloj-marcador, hints): gris tinteado al azul, nunca un
 *  gris neutro (globals.css `--arm-tenue`/`--arm-apagado`). */
const TENUE = 'oklch(0.70 0.012 255)'
const APAGADO = 'oklch(0.50 0.012 255)'
/** Placa translúcida: la familia #04050a del resto del juego, no negro puro. */
const PANEL = 'rgba(4,6,12,.56)'
const PANEL_FUERTE = 'rgba(3,5,10,.74)'

/** Bajo esta fracción de vida el número se pone rojo. */
const VIDA_CRITICA = 0.35
/** Bajo esta fracción de cargador la munición se pone roja. */
const MUNICION_CRITICA = 0.25
/** Bajo estos segundos el reloj se pone rojo. */
const TIEMPO_CRITICO_S = 30

/** Muescas de la barra de vida. */
const MUESCAS_VIDA = 10

/** Tamaño del chaflán, igual al de la armería (globals.css `--arm-chaflan`). */
const CHAFLAN = 14

/**
 * Sombra dura de 1 px en cuatro direcciones en vez de un `text-shadow`
 * difuminado. Un HUD sobre el cielo claro de nuketown desaparece sin
 * contorno, y un blur cuesta al compositor lo que un contorno duro no
 * (mismo criterio que el halo de la retícula en feedback/overlay.ts).
 */
const CONTORNO =
  'text-shadow:0 1px 0 #000,0 -1px 0 #000,1px 0 0 #000,-1px 0 0 #000'

/** Display condensada de carácter (Oswald, ya cargada por next/font en
 *  layout.tsx para las pantallas de progresión). Es la cara de los
 *  protagonistas: peso, condensación y numerales tabulares. */
const DISPLAY = "var(--font-oswald),'Oswald','Arial Narrow',sans-serif"
/** Mono para TODO lo secundario. El mono ya no es el protagonista: informa. */
const MONO = 'var(--font-geist-mono),ui-monospace,SFMono-Regular,Menlo,monospace'

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
  let ammoPlacaEl: HTMLDivElement | null = null
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
  let lastMelee: boolean | null = null
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
      // `top:16px` porque la barra de perf de `engine/stats.ts` ya no está
      // siempre visible: ahora arranca oculta y se enciende con F3 (ver
      // game.ts). Con el techo despejado el reloj puede subir y el HUD respira.
      // Chico y tenue a propósito: el reloj es contexto, no protagonista.
      const partida = div(
        'position:absolute;top:16px;left:50%;transform:translateX(-50%);' +
          'display:flex;flex-direction:column;align-items:center;gap:2px;' +
          `background:${PANEL};padding:5px 18px 6px;` +
          'clip-path:polygon(0 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,10px 100%,0 calc(100% - 10px))',
      )
      // Barra de acento en el techo: la firma geométrica, repetida en cada
      // placa del HUD.
      partida.appendChild(
        div(`position:absolute;top:0;left:0;right:0;height:2px;background:${ACENTO}`),
      )
      relojEl = div(
        `font:600 22px ${DISPLAY};line-height:1;color:${TINTA};letter-spacing:.02em;` +
          `font-variant-numeric:tabular-nums;${CONTORNO}`,
      )
      marcadorEl = div(`font:500 11px ${MONO};line-height:1;letter-spacing:.14em;color:${TENUE};${CONTORNO}`)
      partida.appendChild(relojEl)
      partida.appendChild(marcadorEl)
      root.appendChild(partida)

      // ---- Vida, abajo a la izquierda ----
      // Placa chaflanada en la esquina superior DERECHA (la que mira al
      // centro), con la barra de acento corriendo por el techo hasta el
      // chaflán. El número Oswald de 58px es el que domina la esquina.
      const vida = div(
        'position:absolute;left:24px;bottom:22px;display:flex;flex-direction:column;' +
          `align-items:flex-start;background:${PANEL};padding:6px 22px 9px 16px;` +
          `clip-path:polygon(0 0,calc(100% - ${CHAFLAN}px) 0,100% ${CHAFLAN}px,100% 100%,0 100%)`,
      )
      vida.appendChild(
        div(`position:absolute;top:0;left:0;width:calc(100% - ${CHAFLAN}px);height:2px;background:${ACENTO}`),
      )
      const labelVida = div(
        `font:500 10px ${MONO};line-height:1;letter-spacing:.26em;color:${TENUE};${CONTORNO}`,
      )
      labelVida.textContent = 'VIDA'
      vida.appendChild(labelVida)
      healthEl = div(
        `font:700 58px ${DISPLAY};line-height:.82;color:${TINTA};margin-top:3px;` +
          `font-variant-numeric:tabular-nums;${CONTORNO}`,
      )
      const barra = div('display:flex;gap:3px;margin-top:7px')
      for (let i = 0; i < MUESCAS_VIDA; i++) {
        // Muescas con un leve sesgo: el mismo idioma angular del chaflán, no
        // rectángulos planos.
        const m = div(`width:13px;height:4px;background:${ACENTO};opacity:.22;transform:skewX(-12deg)`)
        muescasVida.push(m)
        barra.appendChild(m)
      }
      vida.appendChild(healthEl)
      vida.appendChild(barra)
      root.appendChild(vida)

      // ---- Munición y arma, abajo a la derecha ----
      // El selector de ranuras vive AFUERA de la placa de munición: con el
      // cuchillo en mano la placa se oculta (no hay balas que mostrar), pero
      // el selector [1][2][3] tiene que seguir visible para saber a qué
      // cambiar.
      const municion = div(
        'position:absolute;right:24px;bottom:22px;display:flex;flex-direction:column;' +
          'align-items:flex-end;gap:6px',
      )
      // Placa chaflanada en la esquina superior IZQUIERDA (espejo de la vida).
      ammoPlacaEl = div(
        'position:relative;display:flex;flex-direction:column;align-items:flex-end;' +
          `background:${PANEL};padding:6px 16px 9px 22px;` +
          `clip-path:polygon(${CHAFLAN}px 0,100% 0,100% 100%,0 100%,0 ${CHAFLAN}px)`,
      )
      ammoPlacaEl.appendChild(
        div(`position:absolute;top:0;right:0;width:calc(100% - ${CHAFLAN}px);height:2px;background:${ACENTO}`),
      )
      weaponEl = div(
        `font:500 12px ${MONO};line-height:1;color:${ACENTO_TENUE};letter-spacing:.14em;${CONTORNO}`,
      )
      const fila = div('display:flex;align-items:baseline;gap:6px;margin-top:3px')
      ammoEl = div(
        `font:700 58px ${DISPLAY};line-height:.82;color:${TINTA};` +
          `font-variant-numeric:tabular-nums;${CONTORNO}`,
      )
      magEl = div(`font:500 15px ${MONO};line-height:1;color:${TENUE};${CONTORNO}`)
      fila.appendChild(ammoEl)
      fila.appendChild(magEl)
      ammoPlacaEl.appendChild(weaponEl)
      ammoPlacaEl.appendChild(fila)
      // La pista de las ranuras es lo que hace descubrible el cambio de arma:
      // sin ella, "1" y "2" son atajos que nadie sabe que existen.
      slotEl = div(
        `font:500 10px ${MONO};line-height:1.4;color:${APAGADO};text-align:right;letter-spacing:.04em;${CONTORNO}`,
      )
      municion.appendChild(ammoPlacaEl)
      municion.appendChild(slotEl)
      root.appendChild(municion)

      // ---- Muerte y cuenta atrás de reaparición, al centro ----
      muerteEl = div(
        'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
          'flex-direction:column',
      )
      const muerteCard = div(
        'position:relative;display:flex;flex-direction:column;align-items:center;gap:9px;' +
          `background:${PANEL_FUERTE};padding:20px 46px;` +
          'clip-path:polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)',
      )
      // Barra de acento roja: mismo gesto de firma, pero en color de alarma.
      muerteCard.appendChild(div(`position:absolute;top:0;left:0;right:0;height:2px;background:${ROJO}`))
      const muerteTitulo = div(
        `font:700 30px ${DISPLAY};letter-spacing:.30em;color:${ROJO};${CONTORNO}`,
      )
      muerteTitulo.textContent = 'ELIMINADO'
      muerteTextoEl = div(`font:500 13px ${MONO};letter-spacing:.06em;color:${TENUE};${CONTORNO}`)
      muerteCard.appendChild(muerteTitulo)
      muerteCard.appendChild(muerteTextoEl)
      muerteEl.appendChild(muerteCard)
      root.appendChild(muerteEl)

      parent.appendChild(root)
    },

    render(snap: HudSnapshot, match: MatchState): void {
      if (!root) return

      // ---- Munición ----
      // Con el cuchillo en mano no hay munición que mostrar: la placa se
      // oculta entera (el selector de ranuras, que está afuera, se queda). El
      // guard hace que togglear el display cueste una escritura sólo al
      // cambiar de/a melee, no por frame.
      const esMelee = snap.slot === 'melee'
      if (esMelee !== lastMelee) {
        lastMelee = esMelee
        if (ammoPlacaEl) ammoPlacaEl.style.display = esMelee ? 'none' : 'flex'
      }

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
        if (ammoEl) ammoEl.style.color = ammoRojo ? ROJO : TINTA
      }
      if (snap.reloading !== lastReloading) {
        lastReloading = snap.reloading
        // Recargando, el número que está en pantalla ya no significa nada
        // (el cargador se rellena al FINAL de la animación, ver
        // combat/fire-control.ts): se apaga en vez de mentir.
        if (ammoEl) ammoEl.style.opacity = snap.reloading ? '.35' : '1'
      }

      if (snap.weaponName !== lastWeapon) {
        lastWeapon = snap.weaponName
        if (weaponEl) weaponEl.textContent = snap.weaponName.toUpperCase()
      }

      // La línea de ranuras depende de tres cosas (nombres y ranura en mano)
      // y de si se está recargando; se rearma sólo cuando alguna cambió.
      const slotClave = `${snap.slot}|${snap.primaryName}|${snap.secondaryName}|${snap.meleeName}|${snap.reloading}`
      if (slotClave !== lastSlot) {
        lastSlot = slotClave
        if (slotEl) {
          // [3] = cuchillo, SIEMPRE presente (slot fijo, como en CS/COD).
          slotEl.textContent = snap.reloading
            ? 'RECARGANDO'
            : `[1] ${snap.primaryName || '--'}   [2] ${snap.secondaryName || '--'}   [3] ${snap.meleeName || 'Cuchillo'}`
          // Recargando se resalta en cian; en reposo el selector queda apagado.
          slotEl.style.color = snap.reloading ? ACENTO : APAGADO
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
        if (healthEl) healthEl.style.color = vidaRoja ? ROJO : TINTA
        for (const m of muescasVida) m.style.background = vidaRoja ? ROJO : ACENTO
      }
      const llenas = Math.max(0, Math.min(MUESCAS_VIDA, Math.ceil(fraccion * MUESCAS_VIDA)))
      if (llenas !== lastMuescasLlenas) {
        // Sólo se tocan las muescas que CAMBIARON de lado del umbral. Con
        // diez muescas la diferencia es despreciable, pero el patrón importa:
        // es el mismo bucle índice a índice de los pools de overlay.ts.
        const desde = Math.min(llenas, lastMuescasLlenas < 0 ? 0 : lastMuescasLlenas)
        const hasta = Math.max(llenas, lastMuescasLlenas < 0 ? MUESCAS_VIDA : lastMuescasLlenas)
        for (let i = desde; i < hasta; i++) muescasVida[i].style.opacity = i < llenas ? '1' : '.22'
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
        if (relojEl) relojEl.style.color = relojRojo ? ROJO : TINTA
      }

      // En TDM el marcador son los dos equipos; en FFA, los kills del
      // jugador contra el mejor rival. teamScore/leadingKills recorren la
      // lista de participantes, así que se llaman DESPUÉS del guard, no
      // antes: con el marcador quieto esto no cuesta nada. Separador con
      // interpunto, nunca un guion largo (regla de copy: cero em-dashes).
      const marcador =
        match.mode === 'tdm'
          ? `${teamScore(match.mode, match.participants, 0)} · ${teamScore(match.mode, match.participants, 1)}`
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
      ammoPlacaEl = null
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
      lastMelee = null
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
