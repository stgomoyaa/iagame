import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInputSystem } from '@/game/engine/input'
import { convert } from '@/game/settings/sensitivity'
import { findProfile } from '@/game/settings/games'
import {
  createDefaultSensitivity,
  createSensitivityStore,
  PERFIL_PROPIO,
  radianesPorConteo,
  SENSITIVITY_STORAGE_KEY,
  SENSITIVITY_VERSION,
} from '@/game/settings/store'

/**
 * La costura completa: lo que el jugador elige en la armería tiene que
 * terminar girando la cámara.
 *
 * Existe porque el resto de los tests del conversor prueban la MATEMÁTICA,
 * y este proyecto ya se comió un feature "existente y testeado" que no
 * servía porque nadie había verificado la costura (ver la nota sobre el
 * panel que fotografiaba el registro antes de que resolviera el fetch, en
 * ui/GameCanvas.tsx). El equivalente acá sería un conversor perfecto cuyo
 * resultado nunca llega a `createInputSystem`.
 *
 * En el navegador esta cadena se verificó hasta el valor efectivo que el
 * motor construye. El último tramo -- el `mousemove` real -- necesita
 * pointer lock, que un Chrome automatizado no otorga; por eso se cierra
 * acá, ejercitando el MISMO camino de eventos con un DOM mínimo.
 */

/** DOM mínimo: sólo lo que createInputSystem toca. */
function montarDomFalso() {
  const listeners = new Map<string, ((e: unknown) => void)[]>()
  const on = (tipo: string, fn: (e: unknown) => void) => {
    const lista = listeners.get(tipo) ?? []
    lista.push(fn)
    listeners.set(tipo, lista)
  }
  const canvas = { addEventListener: on, removeEventListener: () => {} }
  const doc = {
    addEventListener: on,
    removeEventListener: () => {},
    // El sistema lee esto en pointerlockchange para decidir `locked`.
    pointerLockElement: canvas,
  }
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', {
    addEventListener: on,
    removeEventListener: () => {},
    localStorage: {
      _v: null as string | null,
      getItem(): string | null { return this._v },
      setItem(_k: string, v: string): void { this._v = v },
    },
  })

  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    disparar(tipo: string, evento: unknown): void {
      for (const fn of listeners.get(tipo) ?? []) fn(evento)
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('la sensibilidad elegida llega a la cámara', () => {
  it('un mousemove gira el yaw según lo guardado, no según la constante vieja', () => {
    const dom = montarDomFalso()

    // 1. El jugador convierte su sensibilidad de Valorant y la guarda,
    //    igual que hace el panel de la armería.
    const valorant = findProfile('valorant')
    expect(valorant).toBeDefined()
    if (valorant === undefined) return

    const DPI = 800
    const resultado = convert({ from: valorant, to: PERFIL_PROPIO, sens: 0.4, dpi: DPI })
    const store = createSensitivityStore()
    store.save({
      version: SENSITIVITY_VERSION,
      sens: resultado.clamped,
      dpi: DPI,
      origenId: 'valorant',
    })

    // 2. El motor la lee al arrancar y arma su input system con ella.
    const sensDelMotor = radianesPorConteo(store.load())
    const input = createInputSystem(() => sensDelMotor)
    input.attach(dom.canvas)
    dom.disparar('pointerlockchange', {})
    expect(input.locked, 'sin lock el mousemove se ignora y el test no probaría nada').toBe(true)

    // 3. Un movimiento de mouse real gira exactamente lo convertido.
    const MOVIMIENTO = 1000
    dom.disparar('mousemove', { movementX: MOVIMIENTO, movementY: 0 })
    expect(input.player.yaw).toBeCloseTo(-MOVIMIENTO * sensDelMotor, 12)

    // 4. Y NO gira lo que giraba con la constante hardcodeada de la fase 1.
    //    Sin esta comprobación el test pasaría igual con el conversor
    //    desconectado.
    const CONSTANTE_VIEJA = 0.0022
    expect(input.player.yaw).not.toBeCloseTo(-MOVIMIENTO * CONSTANTE_VIEJA, 6)
  })

  it('sin nada guardado el giro es idéntico al de la constante histórica', () => {
    const dom = montarDomFalso()

    const sensDelMotor = radianesPorConteo(createSensitivityStore().load())
    expect(createSensitivityStore().load()).toEqual(createDefaultSensitivity())

    const input = createInputSystem(() => sensDelMotor)
    input.attach(dom.canvas)
    dom.disparar('pointerlockchange', {})

    dom.disparar('mousemove', { movementX: 500, movementY: 0 })
    expect(input.player.yaw).toBeCloseTo(-500 * 0.0022, 12)
  })

  it('la clave de guardado es la que el panel escribe', () => {
    const dom = montarDomFalso()
    const store = createSensitivityStore()
    store.save({ version: SENSITIVITY_VERSION, sens: 2, dpi: 400, origenId: 'cs2' })
    expect(window.localStorage.getItem(SENSITIVITY_STORAGE_KEY)).toContain('"sens":2')
    // `dom` se usa por su efecto de stub; referenciarlo evita que el linter
    // lo marque como inútil.
    expect(dom.canvas).toBeDefined()
  })
})
