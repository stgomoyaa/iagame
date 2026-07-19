import { describe, expect, it } from 'vitest'
import { createFeedbackAudio } from '@/game/feedback/audio'

// Entorno de test = 'node' (vitest.config.ts): no hay `window` ni Web Audio
// real. Este es exactamente el caso "degradar en silencio" que pide el
// spec (política de autoplay / API no disponible) — no hace falta un mock
// de AudioContext para probarlo, la ausencia total de `window` ya lo
// ejercita.
describe('feedback audio: degrada en silencio sin Web Audio disponible', () => {
  it('unlock() no tira sin `window`/AudioContext', () => {
    const audio = createFeedbackAudio()
    expect(() => audio.unlock()).not.toThrow()
  })

  it('playHitmarker no tira para ningún nivel, con o sin unlock() previo', () => {
    const audio = createFeedbackAudio()
    expect(() => audio.playHitmarker('normal')).not.toThrow()
    audio.unlock()
    expect(() => audio.playHitmarker('headshot')).not.toThrow()
    expect(() => audio.playHitmarker('kill')).not.toThrow()
    expect(() => audio.playHitmarker('headshotKill')).not.toThrow()
  })

  it('llamar unlock() repetidas veces es seguro (no reintenta construir el contexto)', () => {
    const audio = createFeedbackAudio()
    for (let i = 0; i < 5; i++) expect(() => audio.unlock()).not.toThrow()
  })
})

/**
 * Regresión del bug real encontrado (no el síntoma reportado -- 1-2s de
 * retraso audible no se pudo reproducir ni en navegador real ni por
 * lectura de código; medido en vivo, el camino normal hitmarker->sonido
 * corre sub-ms, mismo frame, sin cola ni batching, ver
 * .superpowers/sdd/audio-delay-report.md).
 *
 * El bug de verdad: `unlock()` tenía un flag `unlocked` que la volvía
 * no-op para siempre después del primer click -- construir el
 * AudioContext una sola vez es correcto, pero eso también bloqueaba
 * reintentar `resume()` si el navegador suspendía el contexto MÁS
 * ADELANTE (tab en segundo plano, throttling de energía): sin
 * `window`/AudioContext real no se puede reproducir la suspensión del
 * navegador, así que se mockea `window.AudioContext` con una clase de
 * juguete que expone `state` mutable y cuenta construcciones/resumes.
 */
describe('feedback audio: unlock() reintenta resume() en cada gesto, no sólo el primero', () => {
  it('resume() se reintenta si el contexto se suspende de nuevo después del primer unlock(), sin reconstruirlo', () => {
    let constructions = 0
    let resumes = 0
    let state: 'running' | 'suspended' = 'suspended'

    class MockAudioContext {
      constructor() {
        constructions++
      }
      get state(): 'running' | 'suspended' {
        return state
      }
      resume(): Promise<void> {
        resumes++
        state = 'running'
        return Promise.resolve()
      }
    }

    const w = globalThis as unknown as { window?: unknown }
    w.window = { AudioContext: MockAudioContext }

    try {
      const audio = createFeedbackAudio()

      audio.unlock()
      expect(constructions).toBe(1)
      expect(resumes).toBe(1)

      // El navegador vuelve a suspender el contexto ya desbloqueado entre
      // el primer gesto y el segundo (tab en segundo plano, power-saving):
      // sin el fix, esta segunda unlock() sería un no-op y `resumes` se
      // quedaría en 1 para siempre -- playHitmarker() mudo el resto de la
      // partida.
      state = 'suspended'
      audio.unlock()
      expect(constructions).toBe(1)
      expect(resumes).toBe(2)
    } finally {
      delete w.window
    }
  })
})
