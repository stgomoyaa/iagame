import { describe, expect, it, vi } from 'vitest'
import { Vector2, type WebGLRenderer } from 'three'
import { createPostFx } from '@/game/engine/postprocess'

/**
 * Doble del WebGLRenderer que registra las llamadas de GPU que le importan al
 * bloom. No necesita contexto real: construir los render targets, el quad y los
 * materiales es JS puro; lo único que toca la GPU son estos métodos, y acá se
 * interceptan. Con esto se puede verificar en un test de node (sin WebGL) la
 * invariante dura de la tarea: **en `off` el pipeline no hace ningún trabajo de
 * GPU** (mismo render que hoy).
 */
function rendererDoble() {
  const calls: string[] = []
  const getDrawingBufferSize = vi.fn((v: Vector2) => {
    v.set(1280, 720)
    return v
  })
  const renderer = {
    calls,
    getDrawingBufferSize,
    setRenderTarget: (t: unknown) => calls.push(t === null ? 'setRT:null' : 'setRT:rt'),
    render: () => calls.push('render'),
    copyFramebufferToTexture: () => calls.push('copy'),
  }
  return renderer as unknown as WebGLRenderer & { calls: string[]; getDrawingBufferSize: typeof getDrawingBufferSize }
}

describe('postprocess (bloom)', () => {
  it('en off, render() no toca la GPU (cero llamadas): es el render de hoy', () => {
    const r = rendererDoble()
    const fx = createPostFx(r)
    // Arranca en off por defecto.
    expect(fx.quality).toBe('off')
    fx.render()
    expect(r.calls).toEqual([])
    // Y resize en off tampoco reserva nada: ni siquiera lee el tamaño del buffer.
    fx.resize()
    expect(r.getDrawingBufferSize).not.toHaveBeenCalled()
  })

  it('en bajo/alto, render() copia el canvas, rebota por targets y compone', () => {
    for (const q of ['bajo', 'alto'] as const) {
      const r = rendererDoble()
      const fx = createPostFx(r)
      fx.setQuality(q)
      expect(fx.quality).toBe(q)
      // setQuality dispara el resize que crea los targets (lee el buffer).
      expect(r.getDrawingBufferSize).toHaveBeenCalled()
      fx.render()
      // Copia el framebuffer una vez.
      expect(r.calls.filter((c) => c === 'copy')).toHaveLength(1)
      // Dibuja varias pasadas full-screen (bright + blur + composite).
      expect(r.calls.filter((c) => c === 'render').length).toBeGreaterThan(2)
      // Y el ÚLTIMO bind de target es null (composite al canvas): el pipeline
      // deja el render target donde lo encontró, así el próximo frame dibuja
      // el mundo sobre el canvas sin sorpresas.
      const binds = r.calls.filter((c) => c.startsWith('setRT:'))
      expect(binds[binds.length - 1]).toBe('setRT:null')
    }
  })

  it('volver a off libera el pipeline: render() vuelve a no hacer nada', () => {
    const r = rendererDoble()
    const fx = createPostFx(r)
    fx.setQuality('alto')
    fx.render()
    expect(r.calls.length).toBeGreaterThan(0)
    r.calls.length = 0
    fx.setQuality('off')
    fx.render()
    expect(r.calls).toEqual([])
  })

  it('alto dibuja más pasadas que bajo (más iteraciones de blur)', () => {
    const contar = (q: 'bajo' | 'alto') => {
      const r = rendererDoble()
      const fx = createPostFx(r)
      fx.setQuality(q)
      fx.render()
      return r.calls.filter((c) => c === 'render').length
    }
    expect(contar('alto')).toBeGreaterThan(contar('bajo'))
  })
})
