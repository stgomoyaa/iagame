'use client'

import { useEffect, useRef, useState } from 'react'
import { createGame, type Game } from '@/game/game'
import { buildSummary } from '@/game/match/match'
import { MATCH } from '@/game/match/tuning'
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

    try {
      const g = createGame(canvas)
      setGame(g)
      g.start()
      return () => {
        setGame(null)
        g.stop()
      }
    } catch (err) {
      console.error('GameCanvas: no se pudo iniciar el juego', err)
      // queueMicrotask: setState sincrónico dentro del cuerpo del efecto
      // dispara cascading renders (regla react-hooks/set-state-in-effect).
      // Difiere el aviso un microtask, que acá no importa: es un error
      // fatal de arranque, no un valor que el usuario vaya a notar un
      // frame más tarde.
      queueMicrotask(() => {
        setFatalError(
          'Tu navegador o tu GPU no soportan lo que este juego necesita (WebGL2). Probá actualizar el navegador o los drivers de video.',
        )
      })
      return
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
          {matchState.phase === 'ended' && <MatchSummary summary={buildSummary(matchState, MATCH)} />}
        </>
      )}
    </>
  )
}
