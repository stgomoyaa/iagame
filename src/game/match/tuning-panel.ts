/**
 * Panel de tuning de partida (sección "Pacing" de la tarea: "poné cada uno
 * de estos en un objeto de tuning mutable... y exponelos en un panel de
 * debug"). Mismo patrón exacto que engine/tuning-panel.ts (el panel de
 * movimiento): DOM plano, sin React, toggle por tecla, siempre montado (no
 * gateado detrás de `?debug=1` -- igual que el panel de movimiento, que
 * tampoco lo está).
 *
 * Los campos numéricos (respawn, límites de puntaje, duración) se leen en
 * vivo cada frame desde `MATCH` -- cambiar el slider los aplica de
 * inmediato, sin recargar. `botCount`/`difficultyMode` NO: los bots ya
 * existen como entidades creadas una vez al arrancar la partida (mismo
 * motivo que el arma equipada no cambia de malla si se edita
 * `weaponIndex()` a mano) -- el panel lo dice explícito para no prometer
 * algo que no hace.
 */

import { MATCH, type MatchTuning } from '@/game/match/tuning'

interface NumericField {
  key: keyof MatchTuning
  label: string
  min: number
  max: number
  step: number
  /** true: sólo toma efecto en la PRÓXIMA partida (recarga de página). */
  requiresReload: boolean
}

const CAMPOS: NumericField[] = [
  { key: 'botCount', label: 'cantidad de bots', min: 0, max: 20, step: 1, requiresReload: true },
  { key: 'uniformDifficultyRank', label: 'dificultad (uniform)', min: 0, max: 1, step: 0.05, requiresReload: true },
  { key: 'respawnDelayS', label: 'delay de respawn (jugador)', min: 0.5, max: 10, step: 0.5, requiresReload: false },
  { key: 'respawnInvulnerabilityS', label: 'invulnerabilidad', min: 0, max: 5, step: 0.25, requiresReload: false },
  { key: 'scoreLimitFfa', label: 'límite de kills (ffa)', min: 5, max: 100, step: 1, requiresReload: false },
  { key: 'scoreLimitTdm', label: 'límite de kills (tdm, por equipo)', min: 5, max: 150, step: 1, requiresReload: false },
  { key: 'timeLimitS', label: 'duración (segundos)', min: 60, max: 900, step: 15, requiresReload: true },
  { key: 'killfeedMaxEntries', label: 'entradas de killfeed', min: 1, max: 10, step: 1, requiresReload: true },
  { key: 'killfeedEntryLifetimeS', label: 'vida de entrada killfeed', min: 1, max: 15, step: 0.5, requiresReload: false },
]

export interface MatchTuningPanel {
  mount(parent: HTMLElement): void
  unmount(): void
}

export function createMatchTuningPanel(): MatchTuningPanel {
  let root: HTMLDivElement | null = null
  let visible = false

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'KeyM') {
      visible = !visible
      if (root) root.style.display = visible ? 'block' : 'none'
    }
  }

  return {
    mount(parent: HTMLElement): void {
      root = document.createElement('div')
      root.style.cssText =
        'position:absolute;top:8px;right:280px;display:none;z-index:20;' +
        'font:11px ui-monospace,monospace;color:#e6e6e6;' +
        'background:rgba(0,0,0,.85);padding:10px;border-radius:4px;' +
        'max-height:90vh;overflow-y:auto;width:260px'

      const titulo = document.createElement('div')
      titulo.textContent = 'tuning de partida  (tecla M para cerrar)'
      titulo.style.cssText = 'margin-bottom:8px;opacity:.6'
      root.appendChild(titulo)

      const modo = document.createElement('div')
      modo.style.cssText = 'margin-bottom:8px'
      const modoLabel = document.createElement('div')
      modoLabel.textContent = `modo por defecto: ${MATCH.defaultMode}`
      modo.appendChild(modoLabel)
      const modoSelect = document.createElement('select')
      modoSelect.style.cssText = 'width:100%'
      for (const opcion of ['tdm', 'ffa'] as const) {
        const option = document.createElement('option')
        option.value = opcion
        option.textContent = opcion
        if (opcion === MATCH.defaultMode) option.selected = true
        modoSelect.appendChild(option)
      }
      modoSelect.addEventListener('change', () => {
        MATCH.defaultMode = modoSelect.value as MatchTuning['defaultMode']
        modoLabel.textContent = `modo por defecto: ${MATCH.defaultMode} (recargar)`
      })
      modo.appendChild(modoSelect)
      root.appendChild(modo)

      const difFila = document.createElement('div')
      difFila.style.cssText = 'margin-bottom:8px'
      const difLabel = document.createElement('div')
      difLabel.textContent = `dificultad: ${MATCH.difficultyMode}`
      difFila.appendChild(difLabel)
      const difSelect = document.createElement('select')
      difSelect.style.cssText = 'width:100%'
      for (const opcion of ['uniform', 'mixed'] as const) {
        const option = document.createElement('option')
        option.value = opcion
        option.textContent = opcion
        if (opcion === MATCH.difficultyMode) option.selected = true
        difSelect.appendChild(option)
      }
      difSelect.addEventListener('change', () => {
        MATCH.difficultyMode = difSelect.value as MatchTuning['difficultyMode']
        difLabel.textContent = `dificultad: ${MATCH.difficultyMode} (recargar)`
      })
      difFila.appendChild(difSelect)
      root.appendChild(difFila)

      for (const campo of CAMPOS) {
        const fila = document.createElement('div')
        fila.style.cssText = 'margin-bottom:6px'

        const etiqueta = document.createElement('div')
        const valorActual = MATCH[campo.key] as number
        const sufijo = campo.requiresReload ? ' (recargar)' : ''
        etiqueta.textContent = `${campo.label}: ${valorActual.toFixed(2)}${sufijo}`
        fila.appendChild(etiqueta)

        const slider = document.createElement('input')
        slider.type = 'range'
        slider.min = String(campo.min)
        slider.max = String(campo.max)
        slider.step = String(campo.step)
        slider.value = String(valorActual)
        slider.style.cssText = 'width:100%'
        slider.addEventListener('input', () => {
          const v = Number(slider.value)
          ;(MATCH[campo.key] as number) = v
          etiqueta.textContent = `${campo.label}: ${v.toFixed(2)}${sufijo}`
        })
        fila.appendChild(slider)
        root.appendChild(fila)
      }

      parent.appendChild(root)
      window.addEventListener('keydown', onKeyDown)
    },

    unmount(): void {
      window.removeEventListener('keydown', onKeyDown)
      root?.remove()
      root = null
      visible = false
    },
  }
}
