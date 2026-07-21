import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFeedbackOverlay } from '@/game/feedback/overlay'
import { createFeedbackState } from '@/game/feedback/feedback'
import { spawnHitmarker } from '@/game/feedback/hitmarkers'
import { spawnVignette } from '@/game/feedback/vignette'
import { spawnDamageNumber } from '@/game/feedback/damage-numbers'

/**
 * Lo que se testea acá NO es cómo se ve el feedback -- eso se aprueba mirando
 * la captura (hitmarker, confirmación de baja, arco de daño). Se testea el
 * contrato de costo que una captura no puede mostrar y que se rompe en
 * silencio (misma filosofía que Hud.test.ts):
 *
 *  1. render() NUNCA crea ni borra un nodo. Todo el DOM (mira, hitmarkers,
 *     números de daño, arcos de daño, estampa de visor, latido) se crea UNA
 *     vez en mount(). Si alguien mete un `createElement` en el camino de
 *     frame, el juego paga asignaciones a 240 Hz para siempre -- la fuga de
 *     "8 bytes por frame" que la disciplina de esta capa existe para evitar.
 *  2. La marca de baja (el rombo del "ding" de COD) sólo se enciende en los
 *     niveles kill; un impacto normal no la toca.
 *  3. El indicador de daño direccional usa el sprite art-dirigido y se rota
 *     (transform) según el bearing, sin recrear el nodo.
 *
 * El DOM falso cuenta CREACIONES y escrituras de `display:block`, las dos
 * unidades de costo/semántica que importan acá.
 */

interface FakeEl {
  style: Record<string, string>
  _store: Record<string, string>
  appendChild(hijo: FakeEl): void
  remove(): void
  textContent: string
}

interface Contadores {
  creados: number
  displayBlock: number
  elementos: FakeEl[]
}

function montarDomFalso(): { contadores: Contadores; padre: FakeEl; canvas: unknown } {
  const contadores: Contadores = { creados: 0, displayBlock: 0, elementos: [] }

  function crearElemento(): FakeEl {
    const store: Record<string, string> = {}
    const style = new Proxy(store, {
      set(destino, clave, valor) {
        const k = clave as string
        if (k === 'display' && String(valor) === 'block') contadores.displayBlock++
        destino[k] = String(valor)
        return true
      },
    })
    let texto = ''
    const el = {
      style,
      _store: store,
      appendChild(): void {},
      remove(): void {},
      get textContent(): string {
        return texto
      },
      set textContent(v: string) {
        texto = v
      },
    } as unknown as FakeEl
    contadores.elementos.push(el)
    return el
  }

  vi.stubGlobal('document', {
    createElement: () => {
      contadores.creados++
      return crearElemento()
    },
  })

  // El canvas sólo se lee (clientWidth/Height) y se le escribe filter/transform
  // en render: un objeto plano alcanza, no pasa por el contador de creaciones.
  const canvas = { clientWidth: 1280, clientHeight: 720, style: {} as Record<string, string> }
  return { contadores, padre: crearElemento(), canvas }
}

let dom: ReturnType<typeof montarDomFalso>

beforeEach(() => {
  dom = montarDomFalso()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('costo por frame de la capa de feedback', () => {
  it('render no crea NI UN nodo, aunque haya feedback activo de todo tipo', () => {
    const overlay = createFeedbackOverlay()
    overlay.mount(dom.padre as unknown as HTMLElement, dom.canvas as HTMLCanvasElement)

    const creadosTrasMount = dom.contadores.creados
    expect(creadosTrasMount).toBeGreaterThan(0)

    const state = createFeedbackState()
    // Un poco de todo, activo a la vez: hitmarker de baja, número de daño y
    // arco de daño direccional.
    spawnHitmarker(state.hitmarkers, 'headshotKill', 60)
    spawnDamageNumber(state.damageNumbers, 0.2, 0.1, 42, true)
    spawnVignette(state.vignette, 0.8, 40)

    // Un segundo entero de frames a 240 Hz con todo en pantalla: cero
    // creaciones nuevas.
    for (let i = 0; i < 240; i++) overlay.render(state)

    expect(dom.contadores.creados).toBe(creadosTrasMount)
  })
})

describe('confirmación de baja', () => {
  it('el rombo de baja se enciende en kill y NO en un impacto normal', () => {
    // Impacto normal: ningún nodo pasa a display:block (el rombo se queda
    // oculto, la baja se distingue por color nada más... no: sin rombo).
    const overlayNormal = createFeedbackOverlay()
    overlayNormal.mount(dom.padre as unknown as HTMLElement, dom.canvas as HTMLCanvasElement)
    const st1 = createFeedbackState()
    spawnHitmarker(st1.hitmarkers, 'normal', 20)
    dom.contadores.displayBlock = 0
    overlayNormal.render(st1)
    expect(dom.contadores.displayBlock).toBe(0)

    // Baja: exactamente un rombo (el del slot activo) se enciende. Si se
    // borrara la lógica del rombo, esto daría 0 y el test fallaría.
    const overlayKill = createFeedbackOverlay()
    overlayKill.mount(dom.padre as unknown as HTMLElement, dom.canvas as HTMLCanvasElement)
    const st2 = createFeedbackState()
    spawnHitmarker(st2.hitmarkers, 'kill', 40)
    dom.contadores.displayBlock = 0
    overlayKill.render(st2)
    expect(dom.contadores.displayBlock).toBe(1)
  })
})

describe('indicador de daño direccional', () => {
  it('usa el sprite art-dirigido y lo rota al bearing, sin recrear el nodo', () => {
    const overlay = createFeedbackOverlay()
    overlay.mount(dom.padre as unknown as HTMLElement, dom.canvas as HTMLCanvasElement)

    // El sprite tiene que estar cableado: algún nodo lo referencia. Guarda
    // contra que alguien lo saque y deje el indicador en blanco.
    const conSprite = dom.contadores.elementos.filter((el) =>
      (el._store.cssText ?? '').includes('indicador-dano.png'),
    )
    expect(conSprite.length).toBeGreaterThan(0)

    const state = createFeedbackState()
    spawnVignette(state.vignette, 1.0, 40)
    overlay.render(state)

    // El primer arco del pool quedó activo y con una rotación escrita.
    const rotado = conSprite.some((el) => (el._store.transform ?? '').includes('rotate'))
    expect(rotado).toBe(true)
  })
})
