import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHud } from '@/ui/Hud'
import { createHudSnapshot, type HudSnapshot } from '@/game/game'
import { createMatchState, type MatchState } from '@/game/match/match'
import { MATCH } from '@/game/match/tuning'

/**
 * Lo que se testea acá NO es cómo se ve el HUD -- eso se aprueba mirando la
 * captura, y así se hizo. Se testea lo único que una captura no puede
 * mostrar y que se rompe en silencio: **que un frame sin novedades no toque
 * el DOM.**
 *
 * Ese es el contrato entero de esta capa (ver la cabecera de Hud.ts). Es
 * fácil de escribir bien la primera vez y trivial de romper después: alcanza
 * con que alguien agregue un campo y escriba `el.textContent = ...` sin
 * guard, o mueva el `${}` afuera del `if`. Nada se rompe visualmente, el HUD
 * sigue perfecto, y el juego paga escrituras de estilo y basura a 240 Hz
 * para siempre.
 *
 * Por eso el DOM falso cuenta ESCRITURAS, no nodos: la unidad de costo que
 * importa.
 */

interface DomFalso {
  escrituras: number
  padre: HTMLElement
}

function montarDomFalso(): DomFalso {
  const contador = { escrituras: 0 }

  function crearElemento(): HTMLElement {
    const hijos: HTMLElement[] = []
    // El `style` es un Proxy para cazar CUALQUIER propiedad que se escriba
    // (color, opacity, background, display, cssText...), no sólo una lista
    // que haya que mantener al día.
    const estilo = new Proxy({} as Record<string, string>, {
      set(destino, clave, valor) {
        contador.escrituras++
        destino[clave as string] = String(valor)
        return true
      },
    })

    const el = {
      style: estilo,
      appendChild(hijo: HTMLElement): void {
        hijos.push(hijo)
      },
      remove(): void {},
    }

    // textContent con setter propio: es la otra mitad del costo (asignar
    // texto invalida el layout de ese nodo) y la que más fácil se escapa de
    // un guard.
    let texto = ''
    Object.defineProperty(el, 'textContent', {
      get(): string {
        return texto
      },
      set(v: string): void {
        contador.escrituras++
        texto = v
      },
    })

    return el as unknown as HTMLElement
  }

  vi.stubGlobal('document', { createElement: () => crearElemento() })

  return {
    get escrituras(): number {
      return contador.escrituras
    },
    set escrituras(v: number) {
      contador.escrituras = v
    },
    padre: crearElemento(),
  }
}

function snapshotDePrueba(): HudSnapshot {
  const snap = createHudSnapshot()
  snap.ammo = 30
  snap.magazine = 30
  snap.health = 100
  snap.maxHealth = 100
  snap.alive = true
  snap.weaponName = 'AK-47'
  snap.slot = 'primary'
  snap.primaryName = 'AK-47'
  snap.secondaryName = 'Glock-18'
  return snap
}

let dom: DomFalso

beforeEach(() => {
  dom = montarDomFalso()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('costo por frame del HUD', () => {
  it('el primer render sí pinta: un HUD que abre en blanco no sirve', () => {
    const hud = createHud()
    hud.mount(dom.padre)
    dom.escrituras = 0

    const match: MatchState = createMatchState('tdm', 6, MATCH)
    hud.render(snapshotDePrueba(), match)

    expect(dom.escrituras).toBeGreaterThan(0)
  })

  /**
   * EL test. Si esto falla, el HUD está costando frames.
   */
  it('un frame sin cambios no escribe absolutamente nada en el DOM', () => {
    const hud = createHud()
    hud.mount(dom.padre)

    const snap = snapshotDePrueba()
    const match = createMatchState('tdm', 6, MATCH)

    hud.render(snap, match)
    dom.escrituras = 0

    // 240 frames = un segundo a la tasa de refresco de la máquina del dueño,
    // con el jugador quieto y sin disparar. Tiene que costar cero.
    for (let i = 0; i < 240; i++) hud.render(snap, match)

    expect(dom.escrituras).toBe(0)
  })

  it('gastar una bala escribe la munición y nada más que lo necesario', () => {
    const hud = createHud()
    hud.mount(dom.padre)

    const snap = snapshotDePrueba()
    const match = createMatchState('tdm', 6, MATCH)
    hud.render(snap, match)
    dom.escrituras = 0

    snap.ammo = 29
    hud.render(snap, match)

    // Exactamente una: el textContent del contador. Ni el color (29/30
    // sigue lejos del umbral rojo), ni el cargador, ni el reloj, ni la vida.
    expect(dom.escrituras).toBe(1)
  })

  it('el reloj de partida no escribe hasta que cambia el segundo entero', () => {
    const hud = createHud()
    hud.mount(dom.padre)

    const snap = snapshotDePrueba()
    const match = createMatchState('tdm', 6, MATCH)
    // Se arranca a 359.9 y no en el límite exacto: 120 frames de 1/240 s
    // consumen medio segundo, así que desde 359.9 se llega a 359.4 sin
    // cruzar ningún entero. Arrancando en 360.0 el bucle SÍ cruzaría (360 ->
    // 359) y el test estaría midiendo otra cosa.
    match.timeRemainingS = 359.9
    hud.render(snap, match)
    dom.escrituras = 0

    // Medio segundo de frames a 240 Hz, todos dentro del mismo segundo
    // entero: 120 oportunidades de escribir el reloj, cero escrituras.
    for (let i = 0; i < 120; i++) {
      match.timeRemainingS -= 1 / 240
      hud.render(snap, match)
    }
    expect(dom.escrituras).toBe(0)

    // Cruzar al segundo siguiente sí escribe, una sola vez.
    match.timeRemainingS -= 1
    hud.render(snap, match)
    expect(dom.escrituras).toBe(1)
  })

  it('unmount resetea los guards: un remount vuelve a pintar todo', () => {
    const hud = createHud()
    hud.mount(dom.padre)

    const snap = snapshotDePrueba()
    const match = createMatchState('tdm', 6, MATCH)
    hud.render(snap, match)

    hud.unmount()
    hud.mount(dom.padre)
    dom.escrituras = 0
    hud.render(snap, match)

    // Sin el reset de los guards en unmount(), esto daría 0 y el HUD
    // quedaría en blanco tras un HMR hasta que algo cambiara solo.
    expect(dom.escrituras).toBeGreaterThan(0)
  })
})

describe('lo que muestra el HUD', () => {
  it('muestra la cuenta atrás mientras estás muerto y la esconde al revivir', () => {
    const hud = createHud()
    hud.mount(dom.padre)

    const snap = snapshotDePrueba()
    const match = createMatchState('tdm', 6, MATCH)
    hud.render(snap, match)

    snap.alive = false
    snap.respawnInS = 2.4
    dom.escrituras = 0
    hud.render(snap, match)
    // display:flex del cartel + el texto de la cuenta atrás.
    expect(dom.escrituras).toBe(2)

    // Bajar dentro del mismo segundo entero no escribe.
    snap.respawnInS = 2.1
    dom.escrituras = 0
    hud.render(snap, match)
    expect(dom.escrituras).toBe(0)

    // Revivir esconde el cartel.
    snap.alive = true
    snap.respawnInS = 0
    dom.escrituras = 0
    hud.render(snap, match)
    expect(dom.escrituras).toBe(1)
  })

  it('quedarse sin vida cruza el umbral rojo una sola vez, no por punto de vida', () => {
    const hud = createHud()
    hud.mount(dom.padre)

    const snap = snapshotDePrueba()
    const match = createMatchState('tdm', 6, MATCH)
    hud.render(snap, match)

    // De 100 a 30 en un golpe: número + color del número + color de las diez
    // muescas + las muescas que se apagan. Lo que importa es que bajar OTRA
    // vez, ya en rojo, no vuelva a escribir el color.
    snap.health = 30
    hud.render(snap, match)

    dom.escrituras = 0
    snap.health = 20
    hud.render(snap, match)
    // Sólo el número y la muesca que se apaga: el color ya estaba en rojo.
    expect(dom.escrituras).toBe(2)
  })
})
