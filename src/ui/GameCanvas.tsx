'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createGame, createHudSnapshot, type Game } from '@/game/game'
import { cargarMapaExterno, type MapaExternoCargado } from '@/game/map/external-map'
import { mapaExternoSeleccionado } from '@/game/map/seleccion'
import { buildSummary } from '@/game/match/match'
import { MATCH } from '@/game/match/tuning'
import { accountLevel, createProgressStore } from '@/game/progression/store'
import type { LoadoutSlot } from '@/game/progression/loadout'
import { loadLocalWeapons } from '@/game/weapons/registry'
import { Killfeed } from '@/ui/Killfeed'
import { Scoreboard } from '@/ui/Scoreboard'
import { MatchSummary } from '@/ui/MatchSummary'
import { createHud } from '@/ui/Hud'
import { AvisoReanudar, PauseMenu } from '@/ui/PauseMenu'
import {
  FASE_INICIAL,
  juegoPausado,
  mostrarInicio,
  mostrarMenu,
  mostrarReanudar,
  transicion,
  type EventoPausa,
  type FasePausa,
} from '@/ui/pausa'

/** Cada cuánto React sondea el estado de partida (killfeed, puntaje, fase)
 *  para re-renderizar (sección "Build" de la tarea: killfeed/scoreboard son
 *  UI de baja frecuencia, "a diferencia de hitmarkers y números de daño,
 *  que corren por frame y son DOM imperativo"). React nunca corre dentro
 *  del frame del motor (sección 3 del spec) -- esto fuerza un re-render
 *  periódico que lee `game.matchState` (referencia mutable en vivo) directo
 *  en el render, sin copiarlo ni suscribirse al loop de juego.
 *
 *  Ojo con la tentación de usar este mismo sondeo para el HUD de munición y
 *  vida: a 200 ms el contador de balas iría cinco cuadros atrás del disparo.
 *  El HUD corre aparte, en su propio rAF y sin React (ver ui/Hud.ts). */
const MATCH_POLL_MS = 200

export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  // new WebGLRenderer(...) (engine/renderer.ts, vía createGame) tira si el
  // navegador o la GPU no dan WebGL2: sin este catch, ese throw se propaga
  // afuera del useEffect como un error de React sin manejar y la página
  // queda en blanco, sin ningún mensaje.
  const [fatalError, setFatalError] = useState<string | null>(null)
  // `Game` en useState, no useRef: leer matchState durante el render (más
  // abajo) con un ref está prohibido por la regla react-hooks/refs de
  // React 19 -- un ref es "fuera del render" por definición. El objeto
  // `Game` en sí es completamente estable (una sola instancia por montaje),
  // así que guardarlo en estado no dispara ningún re-render extra por su
  // cuenta; el sondeo de match/ de abajo es quien fuerza los re-renders
  // periódicos que necesitamos para reflejar `game.matchState`.
  const [game, setGame] = useState<Game | null>(null)
  const [, setPollTick] = useState(0)
  const [scoreboardHeld, setScoreboardHeld] = useState(false)

  // Fase del menú de pausa y del pointer lock. Toda la lógica de qué se
  // muestra y qué se congela vive en ui/pausa.ts, testeada aparte: acá sólo
  // se traducen eventos del DOM a eventos de esa máquina.
  const [fase, setFase] = useState<FasePausa>(FASE_INICIAL)
  const despachar = useCallback((evento: EventoPausa) => {
    setFase((actual) => transicion(actual, evento))
  }, [])

  // Nivel de cuenta, para saber qué armas puede elegir el jugador desde el
  // menú. Se lee en un efecto porque localStorage no existe en el servidor.
  const [nivelCuenta, setNivelCuenta] = useState(1)
  // Contador para forzar el re-render cuando se equipa un arma desde el
  // menú: `game.loadout` es una referencia mutable del motor, así que React
  // no se entera solo de que cambió. Sin esto la lista tardaría hasta 200 ms
  // (el sondeo de partida) en marcar el arma nueva, y el click se sentiría
  // ignorado.
  const [loadoutTick, setLoadoutTick] = useState(0)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    // Un mapa importado de Source son dos archivos que hay que bajar antes
    // de poder armar el motor (map/external-map.ts). `cancelado` evita que
    // una carga que termina después de desmontar arranque una partida
    // huérfana -- en dev, el StrictMode monta y desmonta el efecto dos
    // veces, así que esto no es un caso teórico.
    let cancelado = false
    let juego: Game | null = null

    const externo = mapaExternoSeleccionado()
    const carga: Promise<MapaExternoCargado | null> =
      externo === null
        ? Promise.resolve(null)
        : cargarMapaExterno(externo).catch((err: unknown) => {
            // El mapa importado no está o está mal: se juega en el mapa por
            // defecto en vez de dejar la pantalla negra. Los archivos son
            // un paso manual (ver docs/WORKSHOP.md), así que faltar es el
            // caso esperable, no un bug.
            console.error(`GameCanvas: no se pudo cargar el mapa "${externo.name}"`, err)
            return null
          })

    // El catálogo de armas locales (docs/WORKSHOP.md) se espera ANTES de
    // armar el motor, no en paralelo. createGame() lee el catálogo de una
    // sola vez al arrancar -- elige el arma inicial con `weaponIndex()[0]` y
    // valida el loadout guardado contra WEAPON_REGISTRY (progression/
    // loadout.ts) -- así que si el fetch todavía está en vuelo, la partida
    // arranca con las 40 CC0 y un loadout que apuntaba a un arma local queda
    // "inválido" y se descarta en silencio. El jugador vería su arma elegida
    // en la armería y otra distinta al entrar. Es el mismo bug de foto vieja
    // que ya pasó con el panel de tuning (ver registry.ts), y la forma de no
    // repetirlo es que no haya carrera: se espera.
    Promise.all([carga, loadLocalWeapons()])
      .then(([mapa]) => {
        if (cancelado) return
        juego = createGame(canvas, mapa)
        setGame(juego)
        juego.start()
      })
      .catch((err: unknown) => {
        console.error('GameCanvas: no se pudo iniciar el juego', err)
        setFatalError(
          'Tu navegador o tu GPU no soportan lo que este juego necesita (WebGL2). Probá actualizar el navegador o los drivers de video.',
        )
      })

    return () => {
      cancelado = true
      setGame(null)
      juego?.stop()
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      setNivelCuenta(accountLevel(createProgressStore().load()))
    })
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      setPollTick((t) => t + 1)
      // El fin de partida aparta el menú de pausa y le deja la pantalla al
      // resumen (ui/MatchSummary.tsx). Se detecta acá, en el sondeo que ya
      // existía, en vez de agregar un callback nuevo al motor.
      if (game !== null && game.matchState.phase === 'ended') despachar('partida-terminada')
    }, MATCH_POLL_MS)
    return () => window.clearInterval(id)
  }, [game, despachar])

  // ---- HUD de combate: DOM imperativo, rAF propio, sin React ----
  //
  // Este bucle es el que hace que el contador de balas siga al disparo en el
  // mismo cuadro. No re-renderiza nada de React: llama a `game.readHud`
  // (lectura pura, cero asignaciones) y le pasa el resultado a una capa que
  // sólo escribe lo que cambió (ver ui/Hud.ts). Con el jugador quieto, un
  // frame acá no toca el DOM ni una vez.
  useEffect(() => {
    const canvas = ref.current
    if (game === null || canvas === null) return
    const padre = canvas.parentElement
    if (padre === null) return

    const hud = createHud()
    hud.mount(padre)

    // Un único snapshot para toda la vida del HUD, rellenado en el lugar en
    // cada frame. Es el mismo patrón de `out` param que usa el motor para
    // ShotResult y VmTransform, y por el mismo motivo: 240 objetos nuevos
    // por segundo son 240 objetos que el GC después tiene que juntar.
    const snap = createHudSnapshot()
    let rafId = 0

    const tick = (): void => {
      rafId = requestAnimationFrame(tick)
      game.readHud(snap)
      hud.render(snap, game.matchState)
    }
    rafId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafId)
      hud.unmount()
    }
  }, [game])

  // ---- Pointer lock -> fase del menú ----
  //
  // Esta es la única fuente de verdad sobre si el jugador tiene el control:
  // se escucha al navegador en vez de suponerlo. Perder el lock (Escape,
  // alt-tab, cambiar de ventana) abre el menú; recuperarlo lo cierra.
  useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return

    function onPointerLockChange(): void {
      despachar(document.pointerLockElement === canvas ? 'bloqueo-adquirido' : 'bloqueo-perdido')
    }
    document.addEventListener('pointerlockchange', onPointerLockChange)
    return () => document.removeEventListener('pointerlockchange', onPointerLockChange)
  }, [despachar])

  // Congelar / descongelar la simulación según la fase. Va en un efecto y no
  // en el manejador del click para que no haya forma de que la fase y el
  // motor queden en desacuerdo: la fase es el estado, esto es su
  // consecuencia.
  useEffect(() => {
    game?.setPaused(juegoPausado(fase))
  }, [game, fase])

  // Scoreboard en tecla sostenida (Tab, sección "Build" de la tarea): input
  // de UI de menú, no de movimiento/combate -- vive acá, no en
  // engine/input.ts. preventDefault() evita que Tab robe el foco del
  // documento mientras se juega.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // Con el menú abierto, Tab le pertenece al navegador: es como se
      // recorren los botones con el teclado. Robárselo ahí dejaría el menú
      // inutilizable sin mouse.
      if (e.code === 'Tab' && fase === 'jugando') {
        e.preventDefault()
        setScoreboardHeld(true)
      }
      // Escape mientras se espera el puntero devuelve al menú. Jugando no
      // hace falta: el navegador ya suelta el lock solo, y eso dispara
      // 'bloqueo-perdido' por el efecto de arriba.
      if (e.code === 'Escape' && fase === 'reanudando') despachar('menu-pedido')
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Tab') setScoreboardHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [fase, despachar])

  /**
   * Volver al juego. El orden importa:
   *
   *  1. Se despacha 'reanudar', que lleva la fase a 'reanudando' -- NO a
   *     'jugando'. El menú se va, pero queda el aviso de "hacé click".
   *  2. Se relee la sensibilidad, porque el panel del menú la pudo haber
   *     cambiado y el motor la había leído una sola vez al arrancar.
   *  3. Recién ahí se pide el puntero.
   *
   * Si el navegador lo concede, `pointerlockchange` dispara
   * 'bloqueo-adquirido' y la fase pasa a 'jugando' sola. Si lo rechaza
   * -- Chrome bloquea la petición durante ~1.25 s después de un Escape, que
   * es EXACTAMENTE la ventana en la que cae este click -- no pasa nada malo:
   * la fase se queda en 'reanudando' y el aviso, que deja pasar los clicks,
   * convierte la pantalla entera en el botón de reintento (el canvas ya pide
   * el lock en su propio 'click', ver engine/input.ts).
   *
   * La versión ingenua de esta función cierra el menú y asume que el puntero
   * volvió. Ahí es donde nace el bug clásico: el jugador se queda con el
   * juego andando, sin control y sin nada en pantalla que se lo explique.
   */
  const reanudar = useCallback(() => {
    despachar('reanudar')
    game?.recargarSensibilidad()
    const canvas = ref.current
    if (canvas === null) return
    // El tipo de retorno cambió entre versiones de la spec (void antes,
    // Promise<void> ahora). Se normaliza en vez de asumir una: sin el catch,
    // el rechazo del enfriamiento sale como "unhandled promise rejection" en
    // la consola.
    const pedido: unknown = canvas.requestPointerLock()
    if (pedido instanceof Promise) pedido.catch(() => {})
  }, [despachar, game])

  const equipar = useCallback(
    (slot: LoadoutSlot, slug: string) => {
      game?.equipEnPartida(slot, slug)
      setLoadoutTick((t) => t + 1)
    },
    [game],
  )

  if (fatalError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#05070b] p-8 text-center">
        <p className="max-w-md font-mono text-sm leading-relaxed text-[#e6e8ec]">{fatalError}</p>
      </div>
    )
  }

  const matchState = game?.matchState ?? null
  // `loadoutTick` no se usa como valor, sólo obliga a releer la referencia
  // mutable del motor después de equipar. Se nombra en el render para que
  // quede explícito que la lectura de abajo depende de él.
  void loadoutTick
  const loadout = game?.loadout ?? null

  return (
    <>
      <canvas ref={ref} className="block h-screen w-screen cursor-crosshair" />
      {matchState && (
        <>
          <Killfeed killfeed={matchState.killfeed} />
          <Scoreboard
            participants={matchState.participants}
            mode={matchState.mode}
            visible={scoreboardHeld}
          />
          {matchState.phase === 'ended' && (
            <MatchSummary
              summary={buildSummary(matchState, MATCH)}
              progress={game?.matchProgress ?? null}
            />
          )}
        </>
      )}
      {loadout && game && (mostrarMenu(fase) || mostrarInicio(fase)) && (
        <PauseMenu
          variante={mostrarInicio(fase) ? 'inicio' : 'pausa'}
          loadout={loadout}
          slotEquipado={game.slotEquipado}
          nivelCuenta={nivelCuenta}
          onReanudar={reanudar}
          onEquipar={equipar}
        />
      )}
      {mostrarReanudar(fase) && <AvisoReanudar />}
    </>
  )
}
