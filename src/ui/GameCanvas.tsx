'use client'

import { useEffect, useRef } from 'react'
import { createGame } from '@/game/game'

export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const game = createGame(canvas)
    game.start()
    return () => game.stop()
  }, [])

  return <canvas ref={ref} className="block h-screen w-screen cursor-crosshair" />
}
