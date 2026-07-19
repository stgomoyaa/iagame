/**
 * Panel de tuning de armas (sección 6.4 del spec). Overlay de debug detrás
 * de `?debug=1` en la URL, DOM plano, sin React (misma restricción que
 * engine/tuning-panel.ts, que es el panel de movimiento; este archivo sigue
 * el mismo patrón: mount/unmount, sliders que mutan el objeto de datos en
 * vivo, nada de estado propio más allá del DOM).
 *
 * Los sliders escriben directo sobre `WEAPON_REGISTRY` (registry.ts), el
 * mismo objeto mutable que game.ts lee cada frame para animar el
 * viewmodel: no hace falta un canal de eventos, el cambio se ve apenas se
 * suelta el mouse del slider porque el frame siguiente ya lee el valor
 * nuevo.
 */

import {
  getWeaponVisual,
  WEAPON_REGISTRY,
  weaponIndex,
  type Transform,
  type WeaponIndexEntry,
  type WeaponVisual,
} from '@/game/weapons/registry'

export function debugModeEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('debug') === '1'
}

/**
 * Label del dropdown de armas del panel de tuning. `needsManualReview` lo
 * marca el pipeline de conversión (sección 6.3 del spec) en ~29% de los
 * modelos, porque su heurística de orientación de cañón por bounding box
 * falla en siluetas atípicas — precisamente para que alguien lo corrija a
 * mano acá. Vivía sólo en index.json: el dropdown mostraba nada más
 * `entry.name`, así que quien tunea no tenía forma de saber cuáles de las
 * armas necesitan la corrección de rotationOffset sin abrir el JSON, y
 * terminaba revisando las 14 en vez de las ~4 que importan.
 */
export function weaponOptionLabel(entry: WeaponIndexEntry): string {
  return entry.needsManualReview ? `${entry.name} · revisar` : entry.name
}

/**
 * Callbacks hacia game.ts: el panel no toca ViewmodelState ni el combate
 * directamente, game.ts es quien llama a stepViewmodel()/stepCombat() cada
 * frame (ver game.ts).
 *
 * setFireHeld (no un onFire() de un solo disparo) para poder probar auto y
 * ráfaga desde este panel sin necesidad de pointer lock: game.ts combina
 * este estado sostenido con el de engine/input.ts (fireHeld real) igual que
 * ya hace con ADS, y combat/fire-control.ts es quien decide cuántos tiros
 * salen según el fireMode del arma.
 */
export interface WeaponTuningControls {
  initialSlug: string
  onSelectWeapon(slug: string): void
  setFireHeld(held: boolean): void
  onReload(): void
  setAds(held: boolean): void
}

export interface WeaponTuningPanel {
  mount(parent: HTMLElement): void
  unmount(): void
}

interface SliderSpec {
  label: string
  min: number
  max: number
  step: number
  get(v: WeaponVisual): number
  set(v: WeaponVisual, value: number): void
}

function posSliders(prefix: string, offset: (v: WeaponVisual) => Transform): SliderSpec[] {
  return (['x', 'y', 'z'] as const).map((axis) => ({
    label: `${prefix}.${axis}`,
    min: -1,
    max: 1,
    step: 0.005,
    get: (v) => offset(v)[axis],
    set: (v, value) => {
      offset(v)[axis] = value
    },
  }))
}

const SLIDERS: SliderSpec[] = [
  ...posSliders('hipOffset', (v) => v.hipOffset),
  ...posSliders('adsOffset', (v) => v.adsOffset),
  {
    label: 'rotation.x',
    min: -Math.PI,
    max: Math.PI,
    step: 0.01,
    get: (v) => v.rotationOffset.rx,
    set: (v, value) => {
      v.rotationOffset.rx = value
    },
  },
  {
    label: 'rotation.y',
    min: -Math.PI,
    max: Math.PI,
    step: 0.01,
    get: (v) => v.rotationOffset.ry,
    set: (v, value) => {
      v.rotationOffset.ry = value
    },
  },
  {
    label: 'rotation.z',
    min: -Math.PI,
    max: Math.PI,
    step: 0.01,
    get: (v) => v.rotationOffset.rz,
    set: (v, value) => {
      v.rotationOffset.rz = value
    },
  },
  {
    label: 'scaleAdjust',
    min: 0.1,
    max: 3,
    step: 0.01,
    get: (v) => v.scaleAdjust,
    set: (v, value) => {
      v.scaleAdjust = value
    },
  },
  {
    label: 'adsTime',
    min: 0.02,
    max: 1,
    step: 0.01,
    get: (v) => v.adsTime,
    set: (v, value) => {
      v.adsTime = value
    },
  },
  {
    label: 'kickMagnitude',
    min: 0,
    max: 5,
    step: 0.05,
    get: (v) => v.kickMagnitude,
    set: (v, value) => {
      v.kickMagnitude = value
    },
  },
]

function exportTuning(): void {
  const data: Record<string, unknown> = {}
  for (const visual of Object.values(WEAPON_REGISTRY)) {
    data[visual.slug] = {
      hipOffset: { ...visual.hipOffset },
      adsOffset: { ...visual.adsOffset },
      rotationOffset: { ...visual.rotationOffset },
      scaleAdjust: visual.scaleAdjust,
      adsTime: visual.adsTime,
      kickMagnitude: visual.kickMagnitude,
    }
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'weapons_tuning.json'
  a.click()
  URL.revokeObjectURL(url)
}

export function createWeaponTuningPanel(controls: WeaponTuningControls): WeaponTuningPanel {
  let root: HTMLDivElement | null = null
  let slidersBox: HTMLDivElement | null = null
  let currentSlug = controls.initialSlug
  let adsHeld = false
  let fireHeld = false

  function buildSliders(): void {
    if (!slidersBox) return
    slidersBox.innerHTML = ''
    const visual = getWeaponVisual(currentSlug)

    for (const spec of SLIDERS) {
      const fila = document.createElement('div')
      fila.style.cssText = 'margin-bottom:6px'

      const etiqueta = document.createElement('div')
      const valorActual = spec.get(visual)
      etiqueta.textContent = `${spec.label}: ${valorActual.toFixed(3)}`
      fila.appendChild(etiqueta)

      const slider = document.createElement('input')
      slider.type = 'range'
      slider.min = String(spec.min)
      slider.max = String(spec.max)
      slider.step = String(spec.step)
      slider.value = String(valorActual)
      slider.style.cssText = 'width:100%'
      slider.addEventListener('input', () => {
        const value = Number(slider.value)
        spec.set(getWeaponVisual(currentSlug), value)
        etiqueta.textContent = `${spec.label}: ${value.toFixed(3)}`
      })
      fila.appendChild(slider)
      slidersBox.appendChild(fila)
    }
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button === 2) {
      adsHeld = true
      controls.setAds(true)
    } else if (e.button === 0) {
      fireHeld = true
      controls.setFireHeld(true)
    }
  }

  function onMouseUp(e: MouseEvent): void {
    if (e.button === 2 && adsHeld) {
      adsHeld = false
      controls.setAds(false)
    } else if (e.button === 0 && fireHeld) {
      fireHeld = false
      controls.setFireHeld(false)
    }
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault()
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'KeyR') controls.onReload()
  }

  return {
    mount(parent: HTMLElement): void {
      root = document.createElement('div')
      root.style.cssText =
        'position:absolute;top:8px;left:8px;z-index:20;' +
        'font:11px ui-monospace,monospace;color:#e6e6e6;' +
        'background:rgba(0,0,0,.85);padding:10px;border-radius:4px;' +
        'max-height:90vh;overflow-y:auto;width:280px'

      const titulo = document.createElement('div')
      titulo.textContent = 'tuning de armas'
      titulo.style.cssText = 'margin-bottom:8px;opacity:.6'
      root.appendChild(titulo)

      const select = document.createElement('select')
      select.style.cssText = 'width:100%;margin-bottom:8px'
      for (const entry of weaponIndex()) {
        const option = document.createElement('option')
        option.value = entry.slug
        option.textContent = weaponOptionLabel(entry)
        if (entry.slug === currentSlug) option.selected = true
        select.appendChild(option)
      }
      select.addEventListener('change', () => {
        currentSlug = select.value
        controls.onSelectWeapon(currentSlug)
        buildSliders()
      })
      root.appendChild(select)

      const acciones = document.createElement('div')
      acciones.style.cssText = 'margin-bottom:8px;opacity:.6'
      acciones.textContent = 'click izq: disparo · click der (sostener): ADS · R: recarga'
      root.appendChild(acciones)

      const exportBtn = document.createElement('button')
      exportBtn.textContent = 'EXPORT'
      exportBtn.style.cssText = 'width:100%;margin-bottom:8px;padding:4px'
      exportBtn.addEventListener('click', exportTuning)
      root.appendChild(exportBtn)

      slidersBox = document.createElement('div')
      root.appendChild(slidersBox)
      buildSliders()

      parent.appendChild(root)
      window.addEventListener('mousedown', onMouseDown)
      window.addEventListener('mouseup', onMouseUp)
      window.addEventListener('contextmenu', onContextMenu)
      window.addEventListener('keydown', onKeyDown)
    },

    unmount(): void {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      root?.remove()
      root = null
      slidersBox = null
    },
  }
}

interface FieldRange {
  min: number
  max: number
}

// Mismos límites que ya exponen los sliders de SLIDERS más arriba: el
// archivo cargado no debería poder expresar un estado que la propia UI en
// vivo nunca produciría. positionOffset en metros, rotación en radianes.
const POSITION_RANGE: FieldRange = { min: -1, max: 1 }
const ROTATION_RANGE: FieldRange = { min: -Math.PI, max: Math.PI }
const SCALE_ADJUST_RANGE: FieldRange = { min: 0.1, max: 3 }
const ADS_TIME_RANGE: FieldRange = { min: 0.02, max: 1 }
const KICK_MAGNITUDE_RANGE: FieldRange = { min: 0, max: 5 }

/**
 * Lee un campo numérico validando tipo, finitud Y rango. `weapons_tuning.json`
 * es editable a mano y también lo escribe el panel (exportTuning), así que
 * un valor corrupto o fuera de rango tiene que rechazarse en vez de
 * colarse: un adsTime de 0 divide por cero dentro de stepViewmodel (ver
 * rig.ts, `frac / weapon.adsTime`) y un scaleAdjust de 0 o negativo deja el
 * arma invisible o invertida. Se loguea slug + campo + valor rechazado
 * (nunca sólo "valor inválido") para que un hand-edit malo sea
 * diagnosticable en vez de un misterio. Un campo ausente (`undefined`) es
 * el caso normal — nadie tuneó ese campo — y no se loguea.
 */
function readNumber(
  slug: string,
  field: string,
  raw: unknown,
  range: FieldRange,
): number | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    console.warn(
      `weapons_tuning.json: "${slug}".${field} no es un número finito (recibido: ${JSON.stringify(raw)}), se ignora`,
    )
    return undefined
  }
  if (raw < range.min || raw > range.max) {
    console.warn(
      `weapons_tuning.json: "${slug}".${field} = ${raw} fuera de rango [${range.min}, ${range.max}], se ignora`,
    )
    return undefined
  }
  return raw
}

function applyTransformOverride(
  slug: string,
  fieldPrefix: string,
  target: Transform,
  raw: unknown,
): void {
  if (typeof raw !== 'object' || raw === null) return
  const src = raw as Record<string, unknown>
  const x = readNumber(slug, `${fieldPrefix}.x`, src.x, POSITION_RANGE)
  const y = readNumber(slug, `${fieldPrefix}.y`, src.y, POSITION_RANGE)
  const z = readNumber(slug, `${fieldPrefix}.z`, src.z, POSITION_RANGE)
  const rx = readNumber(slug, `${fieldPrefix}.rx`, src.rx, ROTATION_RANGE)
  const ry = readNumber(slug, `${fieldPrefix}.ry`, src.ry, ROTATION_RANGE)
  const rz = readNumber(slug, `${fieldPrefix}.rz`, src.rz, ROTATION_RANGE)
  if (x !== undefined) target.x = x
  if (y !== undefined) target.y = y
  if (z !== undefined) target.z = z
  if (rx !== undefined) target.rx = rx
  if (ry !== undefined) target.ry = ry
  if (rz !== undefined) target.rz = rz
}

function applyRotationOffsetOverride(
  slug: string,
  target: { rx: number; ry: number; rz: number },
  raw: unknown,
): void {
  if (typeof raw !== 'object' || raw === null) return
  const src = raw as Record<string, unknown>
  const rx = readNumber(slug, 'rotationOffset.rx', src.rx, ROTATION_RANGE)
  const ry = readNumber(slug, 'rotationOffset.ry', src.ry, ROTATION_RANGE)
  const rz = readNumber(slug, 'rotationOffset.rz', src.rz, ROTATION_RANGE)
  if (rx !== undefined) target.rx = rx
  if (ry !== undefined) target.ry = ry
  if (rz !== undefined) target.rz = rz
}

/**
 * Carga public/weapons_tuning.json si existe y pisa los valores heurísticos
 * de WEAPON_REGISTRY con lo exportado por el panel. Un 404 es el caso
 * normal (nadie tuneó nada todavía) y no debe registrarse como error; sólo
 * un JSON presente pero corrupto vale la pena loguear, y ni así se relanza:
 * el juego tiene que arrancar igual con los valores heurísticos de seed.ts.
 */
export async function loadWeaponTuningOverrides(): Promise<void> {
  let response: Response
  try {
    response = await fetch('/weapons_tuning.json')
  } catch {
    return
  }
  if (!response.ok) return

  let data: unknown
  try {
    data = await response.json()
  } catch (err) {
    console.error('weapons_tuning.json existe pero no es JSON válido', err)
    return
  }
  if (typeof data !== 'object' || data === null) return

  for (const [slug, override] of Object.entries(data as Record<string, unknown>)) {
    const visual = WEAPON_REGISTRY[slug]
    if (!visual) continue
    if (typeof override !== 'object' || override === null) continue
    const o = override as Record<string, unknown>

    if ('hipOffset' in o) applyTransformOverride(slug, 'hipOffset', visual.hipOffset, o.hipOffset)
    if ('adsOffset' in o) applyTransformOverride(slug, 'adsOffset', visual.adsOffset, o.adsOffset)
    if ('rotationOffset' in o) {
      applyRotationOffsetOverride(slug, visual.rotationOffset, o.rotationOffset)
    }

    const scaleAdjust = readNumber(slug, 'scaleAdjust', o.scaleAdjust, SCALE_ADJUST_RANGE)
    if (scaleAdjust !== undefined) visual.scaleAdjust = scaleAdjust
    const adsTime = readNumber(slug, 'adsTime', o.adsTime, ADS_TIME_RANGE)
    if (adsTime !== undefined) visual.adsTime = adsTime
    const kickMagnitude = readNumber(slug, 'kickMagnitude', o.kickMagnitude, KICK_MAGNITUDE_RANGE)
    if (kickMagnitude !== undefined) visual.kickMagnitude = kickMagnitude
  }
}
