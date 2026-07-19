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
