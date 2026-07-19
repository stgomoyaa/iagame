'use client'

/**
 * Vitrina 3D de la armería. React sólo monta el canvas y le pasa qué armas
 * mostrar; el dibujo es imperativo y vive en `src/game/skins/preview.ts`
 * (sección 3 del spec: React nunca corre dentro del frame).
 *
 * Muestra las dos ranuras del loadout a la vez, no sólo la seleccionada: es
 * la forma de comparar primaria y secundaria antes de entrar a la partida, y
 * de paso deja a la vista que dos armas con skin siguen costando dos
 * llamadas de dibujo (el contador de abajo, detrás de `?debug=1`).
 */

import { useEffect, useRef, useState } from 'react'
import { createSkinPreview, type PreviewItem, type SkinPreview } from '@/game/skins/preview'

export function WeaponPreview({ items, debug }: { items: PreviewItem[]; debug: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<SkinPreview | null>(null)
  const [drawCalls, setDrawCalls] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let preview: SkinPreview
    try {
      preview = createSkinPreview(canvas)
    } catch {
      // queueMicrotask por la regla react-hooks/set-state-in-effect, igual
      // que en ui/GameCanvas.tsx: es un error fatal de arranque, no un valor
      // que alguien note un microtask más tarde.
      queueMicrotask(() => {
        setError('Tu navegador o tu GPU no soportan WebGL2, así que la vitrina no puede dibujar.')
      })
      return
    }
    previewRef.current = preview
    preview.start()

    const resize = (): void => {
      preview.resize(canvas.clientWidth, canvas.clientHeight)
    }
    resize()
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      previewRef.current = null
      preview.dispose()
    }
  }, [])

  // La lista de armas se pasa como dependencia serializada: `items` es un
  // array nuevo en cada render de React y compararlo por referencia
  // recargaría los GLB en cada tecla apretada.
  const clave = items.map((i) => `${i.slug}:${i.skin?.seed ?? '-'}`).join('|')
  useEffect(() => {
    previewRef.current?.setWeapons(items)
    // items entra por `clave`, que es su contenido: ver el comentario de
    // arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  useEffect(() => {
    if (!debug) return
    const id = window.setInterval(() => {
      setDrawCalls(previewRef.current?.drawCalls ?? 0)
      setError(previewRef.current?.lastError ?? null)
    }, 500)
    return () => window.clearInterval(id)
  }, [debug])

  return (
    <div className="relative">
      <canvas ref={canvasRef} className="block h-[22rem] w-full sm:h-[26rem]" />
      {error && (
        <p className="absolute inset-x-0 bottom-0 p-3 text-center text-xs text-[var(--arm-tenue)]">
          {error}
        </p>
      )}
      {debug && !error && (
        <p className="arm-mono absolute right-3 bottom-3 text-[0.625rem] text-[var(--arm-apagado)]">
          {drawCalls} draw calls
        </p>
      )}
    </div>
  )
}
