import { MOVEMENT, type MovementTuning } from '@/game/movement/tuning'

interface Campo {
  key: keyof MovementTuning
  label: string
  min: number
  max: number
  step: number
}

const CAMPOS: Campo[] = [
  { key: 'walkSpeed', label: 'caminar', min: 1, max: 12, step: 0.1 },
  { key: 'sprintSpeed', label: 'sprint', min: 1, max: 20, step: 0.1 },
  { key: 'groundAccel', label: 'accel suelo', min: 5, max: 200, step: 1 },
  { key: 'groundFriction', label: 'fricción', min: 0, max: 20, step: 0.1 },
  { key: 'airAccel', label: 'accel aire', min: 0, max: 300, step: 1 },
  { key: 'airWishSpeedCap', label: 'cap wish aire', min: 0.05, max: 3, step: 0.05 },
  { key: 'jumpVelocity', label: 'salto', min: 1, max: 15, step: 0.1 },
  { key: 'gravity', label: 'gravedad', min: 5, max: 50, step: 0.5 },
  { key: 'bhopSoftCap', label: 'tope bhop', min: 5, max: 40, step: 0.5 },
  { key: 'bhopSoftCapDecay', label: 'decay bhop', min: 0.1, max: 20, step: 0.1 },
  { key: 'slideBoost', label: 'boost slide', min: 1, max: 2.5, step: 0.05 },
  { key: 'slideDuration', label: 'dur. slide', min: 0.1, max: 2, step: 0.05 },
  { key: 'slideFriction', label: 'fricción slide', min: 0, max: 10, step: 0.1 },
  { key: 'mantleMaxHeight', label: 'altura mantle', min: 0.3, max: 3, step: 0.1 },
  { key: 'eyeHeightLerpTime', label: 'lerp ojos', min: 0.01, max: 0.5, step: 0.01 },
]

export interface TuningPanel {
  mount(parent: HTMLElement): void
  unmount(): void
  toggle(): void
}

export function createTuningPanel(): TuningPanel {
  let root: HTMLDivElement | null = null
  let visible = false

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Backquote') {
      visible = !visible
      if (root) root.style.display = visible ? 'block' : 'none'
    }
  }

  return {
    mount(parent: HTMLElement): void {
      root = document.createElement('div')
      root.style.cssText =
        'position:absolute;top:8px;right:8px;display:none;z-index:20;' +
        'font:11px ui-monospace,monospace;color:#e6e6e6;' +
        'background:rgba(0,0,0,.85);padding:10px;border-radius:4px;' +
        'max-height:90vh;overflow-y:auto;width:260px'

      const titulo = document.createElement('div')
      titulo.textContent = 'tuning de movimiento  (tecla ` para cerrar)'
      titulo.style.cssText = 'margin-bottom:8px;opacity:.6'
      root.appendChild(titulo)

      for (const campo of CAMPOS) {
        const fila = document.createElement('div')
        fila.style.cssText = 'margin-bottom:6px'

        const etiqueta = document.createElement('div')
        const valorActual = MOVEMENT[campo.key] as number
        etiqueta.textContent = `${campo.label}: ${valorActual.toFixed(2)}`
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
          ;(MOVEMENT[campo.key] as number) = v
          etiqueta.textContent = `${campo.label}: ${v.toFixed(2)}`
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

    toggle(): void {
      visible = !visible
      if (root) root.style.display = visible ? 'block' : 'none'
    },
  }
}
