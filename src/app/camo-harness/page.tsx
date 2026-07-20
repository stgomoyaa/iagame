'use client'

/**
 * Banco de pruebas VISUAL de la vía de camuflaje por textura. NO es parte del
 * juego: es la pantalla contra la que se sacan las capturas del entregable
 * (los tres patrones aplicados a un arma, en movimiento, comparados contra un
 * camo procedural).
 *
 * Vive en src/app y no en src/ui a propósito: src/ui es zona de otro workflow y
 * esta página es de usar y tirar. Maneja el mismo `createSkinPreview` que la
 * armería real, así que lo que se ve acá es exactamente lo que se vería
 * equipado.
 *
 * Se maneja desde afuera por `window.__camoHarness`, que el script de capturas
 * (scripts/capturar-camos.ts) llama por CDP: elige el arma y la lista de camos
 * a mostrar. El atril los apila y oscila, así se ve correr el brillo y fluir la
 * animación, que es la mitad del punto de toda la vía.
 */

import { useEffect, useRef } from 'react'
import { generateSkin } from '@/game/skins/generator'
import { createSkinPreview, type PreviewItem, type SkinPreview } from '@/game/skins/preview'
import { CAMO_TEXTURA_POR_ID } from '@/game/skins/texturas'

/** Descriptor simple que el script de afuera manda por JSON. */
interface Descriptor {
  /**
   * 'camo'   = por textura (ref = id de catálogo).
   * 'skin'   = procedural cruda por seed (ref = seed).
   * 'family' = procedural forzada a una familia legendaria (ref = seed, family
   *            = la familia): la referencia "espectacular" contra la que se
   *            compara la vía por textura. Se sube emisivo/metal/animación a
   *            mano para que sea un camo caro y no una común lisa, igual que
   *            hacen los tests de material.ts con overrides parciales.
   */
  kind: 'camo' | 'skin' | 'family'
  ref: string
  family?: 'multicam' | 'follaje' | 'filigrana' | 'gema' | 'damasco' | 'cebra'
}

declare global {
  interface Window {
    __camoHarness?: {
      mostrar: (slug: string, descriptores: Descriptor[]) => void
      drawCalls: () => number
      error: () => string | null
    }
  }
}

function aPreviewItem(slug: string, d: Descriptor): PreviewItem {
  if (d.kind === 'camo') {
    return { slug, skin: null, camo: CAMO_TEXTURA_POR_ID[d.ref] ?? null }
  }
  if (d.kind === 'family') {
    const base = generateSkin(d.ref)
    return {
      slug,
      skin: {
        ...base,
        rarity: 'legendario',
        family: d.family ?? 'damasco',
        emissive: 0.8,
        metalness: 0.85,
        wear: 0.05,
        animation: 'flujo',
      },
    }
  }
  return { slug, skin: generateSkin(d.ref) }
}

export default function CamoHarnessPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<SkinPreview | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const preview = createSkinPreview(canvas)
    previewRef.current = preview
    preview.start()
    const resize = (): void => preview.resize(canvas.clientWidth, canvas.clientHeight)
    resize()
    window.addEventListener('resize', resize)

    window.__camoHarness = {
      mostrar(slug, descriptores) {
        preview.setWeapons(descriptores.map((d) => aPreviewItem(slug, d)))
      },
      drawCalls: () => preview.drawCalls,
      error: () => preview.lastError,
    }

    return () => {
      window.removeEventListener('resize', resize)
      delete window.__camoHarness
      previewRef.current = null
      preview.dispose()
    }
  }, [])

  return (
    <main style={{ margin: 0, background: '#0b0d12', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100vw', height: '100vh' }} />
    </main>
  )
}
