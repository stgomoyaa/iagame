'use client'

import { useEffect, useRef, useState } from 'react'
import { createGame, type Game } from '@/game/game'
import { cargarMapaExterno, type MapaExternoCargado } from '@/game/map/external-map'
import { mapaExternoSeleccionado } from '@/game/map/seleccion'
import { buildSummary } from '@/game/match/match'
import { MATCH } from '@/game/match/tuning'
import { loadLocalWeapons } from '@/game/weapons/registry'
import { Killfeed } from '@/ui/Killfeed'
import { Scoreboard } from '@/ui/Scoreboard'
import { MatchSummary } from '@/ui/MatchSummary'

/** Cada cuánto React sondea el estado de partida (killfeed, puntaje, fase)
 *  para re-renderizar (sección "Build" de la tarea: killfeed/scoreboard son
 *  UI de baja frecuencia, "a diferencia de hitmarkers y números de daño,
 *  que corren por frame y son DOM imperativo"). React nunca corre dentro
 *  del frame del motor (sección 3 del spec) -- esto fuerza un re-render
 *  periódico que lee `game.matchState` (referencia mutable en vivo) directo
 *  en el render, sin copiarlo ni suscribirse al loop de juego. */
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
    const id = window.setInterval(() => setPollTick((t) => t + 1), MATCH_POLL_MS)
    return () => window.clearInterval(id)
  }, [])

  // Scoreboard en tecla sostenida (Tab, sección "Build" de la tarea): input
  // de UI de menú, no de movimiento/combate -- vive acá, no en
  // engine/input.ts. preventDefault() evita que Tab robe el foco del
  // documento mientras se juega.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code === 'Tab') {
        e.preventDefault()
        setScoreboardHeld(true)
      }
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
  }, [])

  if (fatalError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#05070b] p-8 text-center">
        <p className="max-w-md font-mono text-sm leading-relaxed text-[#e6e8ec]">{fatalError}</p>
      </div>
    )
  }

  const matchState = game?.matchState ?? null

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
    </>
  )
}
