'use client'

import { useEffect, useRef, useState } from 'react'
import { createGame } from '@/game/game'

export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  // new WebGLRenderer(...) (engine/renderer.ts, vía createGame) tira si el
  // navegador o la GPU no dan WebGL2: sin este catch, ese throw se propaga
  // afuera del useEffect como un error de React sin manejar y la página
  // queda en blanco, sin ningún mensaje.
  const [fatalError, setFatalError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    try {
      const game = createGame(canvas)
      game.start()
      return () => game.stop()
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

  if (fatalError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#05070b] p-8 text-center">
        <p className="max-w-md font-mono text-sm leading-relaxed text-[#e6e8ec]">{fatalError}</p>
      </div>
    )
  }

  return <canvas ref={ref} className="block h-screen w-screen cursor-crosshair" />
}
