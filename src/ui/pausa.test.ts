import { describe, expect, it } from 'vitest'
import {
  FASE_INICIAL,
  juegoPausado,
  mostrarInicio,
  mostrarMenu,
  mostrarReanudar,
  overlayTransparenteAlClick,
  transicion,
  type EventoPausa,
  type FasePausa,
} from '@/ui/pausa'

const FASES: FasePausa[] = ['arranque', 'jugando', 'menu', 'reanudando', 'final']
const EVENTOS: EventoPausa[] = [
  'bloqueo-adquirido',
  'bloqueo-perdido',
  'reanudar',
  'menu-pedido',
  'partida-terminada',
]

/** ¿Esta fase deja la pantalla del juego sin nada encima? */
function sinOverlay(fase: FasePausa): boolean {
  return !mostrarMenu(fase) && !mostrarInicio(fase) && !mostrarReanudar(fase)
}

describe('máquina de pausa', () => {
  it('arranca sin haber capturado el puntero', () => {
    expect(FASE_INICIAL).toBe('arranque')
    expect(mostrarInicio(FASE_INICIAL)).toBe(true)
    expect(juegoPausado(FASE_INICIAL)).toBe(false)
  })

  /**
   * LA invariante de esta funcionalidad, y la razón por la que la máquina
   * existe separada del componente.
   *
   * 'jugando' es el único estado en el que la pantalla queda limpia Y la
   * simulación corre. Si se pudiera llegar ahí por cualquier evento que no
   * sea la confirmación del navegador, el jugador terminaría con el juego
   * andando y el puntero suelto: la cámara no responde y no hay nada en
   * pantalla que explique por qué.
   *
   * Este test recorre el producto cartesiano entero, así que un estado o un
   * evento nuevo que rompa la regla no puede colarse sin que falle.
   */
  it('sólo se entra a jugar cuando el navegador confirmó el bloqueo', () => {
    for (const fase of FASES) {
      for (const evento of EVENTOS) {
        const siguiente = transicion(fase, evento)
        if (siguiente === 'jugando') {
          expect(
            evento,
            `${fase} + ${evento} -> jugando sin confirmación del navegador`,
          ).toBe('bloqueo-adquirido')
        }
      }
    }
  })

  /**
   * El complemento: el único estado sin overlay al que se puede llegar sin
   * confirmación de bloqueo es 'final', y ahí manda MatchSummary, que sí
   * tapa la pantalla. Sin este test, agregar una fase nueva "limpia" pasaría
   * inadvertida.
   */
  it('toda fase sin overlay o tiene el puntero o es el final de partida', () => {
    for (const fase of FASES) {
      if (sinOverlay(fase)) {
        expect(['jugando', 'final'], `fase ${fase} sin overlay`).toContain(fase)
      }
    }
  })

  it('perder el puntero jugando abre el menú y congela la simulación', () => {
    const fase = transicion('jugando', 'bloqueo-perdido')
    expect(fase).toBe('menu')
    expect(mostrarMenu(fase)).toBe(true)
    expect(juegoPausado(fase)).toBe(true)
  })

  /**
   * El enfriamiento de Chrome tras Escape, que es lo que rompe la
   * implementación ingenua: reanudar NO devuelve a 'jugando'. El ciclo
   * completo -- Escape, Reanudar, el navegador que todavía no da el lock, y
   * recién después el lock -- tiene que terminar jugando, y NO puede pasar
   * por ningún estado intermedio con la pantalla limpia.
   */
  it('reanudar espera al navegador en vez de dar el puntero por hecho', () => {
    const enMenu = transicion('jugando', 'bloqueo-perdido')
    const pidiendo = transicion(enMenu, 'reanudar')

    expect(pidiendo).toBe('reanudando')
    expect(juegoPausado(pidiendo), 'no se puede despausar antes de tener el puntero').toBe(true)
    expect(sinOverlay(pidiendo), 'la pantalla no puede quedar sin nada mientras se espera').toBe(
      false,
    )
    // Y el aviso deja pasar el click, para que el listener del canvas
    // (engine/input.ts) pueda reintentar el lock cuando el jugador clickee.
    expect(overlayTransparenteAlClick(pidiendo)).toBe(true)

    const jugando = transicion(pidiendo, 'bloqueo-adquirido')
    expect(jugando).toBe('jugando')
    expect(juegoPausado(jugando)).toBe(false)
    expect(sinOverlay(jugando)).toBe(true)
  })

  it('desde el aviso de reanudar se puede volver al menú con Escape', () => {
    expect(transicion('reanudando', 'menu-pedido')).toBe('menu')
  })

  /**
   * El menú se come los clicks. Si no lo hiciera, clickear el fondo del menú
   * llegaría al canvas, que pediría el pointer lock por su cuenta: el
   * jugador quedaría jugando detrás de su propio menú de pausa, sin verlo.
   */
  it('el menú de pausa bloquea los clicks al canvas', () => {
    expect(overlayTransparenteAlClick('menu')).toBe(false)
  })

  it('el fin de partida absorbe todo y aparta el menú', () => {
    for (const fase of FASES) {
      expect(transicion(fase, 'partida-terminada')).toBe('final')
    }
    for (const evento of EVENTOS) {
      expect(transicion('final', evento)).toBe('final')
    }
    expect(mostrarMenu('final')).toBe(false)
    expect(juegoPausado('final'), 'el resumen se mira sobre un mundo vivo').toBe(false)
  })

  it('el arranque no congela: nunca se dibujó un cuadro que mostrar de fondo', () => {
    expect(juegoPausado('arranque')).toBe(false)
    expect(transicion('arranque', 'bloqueo-adquirido')).toBe('jugando')
  })
})
