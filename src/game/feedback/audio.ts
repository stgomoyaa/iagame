/**
 * Sonido de hitmarker, 100% procedural con Web Audio (sección 5 del spec:
 * "no bajar samples"): un oscilador más una envolvente de ganancia
 * reproduce un click convincente a costo de descarga cero y totalmente
 * tuneable (ver FEEDBACK.hitmarkerAudio). Coherente con el sesgo del
 * proyecto por generación procedural (el viewmodel anima por código, las
 * skins salen de una seed) — los samples de disparo reales quedan fuera de
 * alcance a propósito (sección "fuera de alcance" del spec).
 *
 * Política de autoplay del navegador: `AudioContext` no se crea hasta
 * `unlock()`, y `unlock()` sólo tiene efecto real si corre dentro de un
 * gesto de usuario (game.ts la cuelga de CADA click sobre el canvas, no
 * sólo el primero -- ver el comentario de `unlock()` más abajo sobre por
 * qué). Cualquier fallo -- contexto bloqueado, extensión inexistente, un
 * throw de la API -- degrada en silencio: `playHitmarker` nunca tira, sólo
 * no suena. La construcción del `AudioContext` sí se testea con Vitest
 * (mockeando `window.AudioContext`, ver audio.test.ts); los nodos reales
 * (oscilador/ganancia) no, porque el entorno es 'node' sin Web Audio real
 * (ver vitest.config.ts).
 */

import type { HitmarkerTier } from '@/game/feedback/hitmarkers'
import { FEEDBACK } from '@/game/feedback/tuning'

export interface FeedbackAudio {
  /** Crea (sólo la primera vez) y reanuda el AudioContext. Llamar desde
   *  dentro de un handler de gesto de usuario (click, keydown) -- y en
   *  CADA gesto, no sólo el primero: el navegador puede suspender un
   *  AudioContext ya desbloqueado en cualquier momento (tab en segundo
   *  plano, ahorro de energía) y sin un resume() posterior no hay forma de
   *  recuperarlo, así que playHitmarker() se queda mudo hasta que algo lo
   *  reintente. No-op si Web Audio no está disponible. */
  unlock(): void
  /** Reproduce el click del nivel pedido. No-op silencioso si el contexto
   *  no está listo (bloqueado por autoplay, no soportado, no desbloqueado
   *  todavía). */
  playHitmarker(tier: HitmarkerTier): void
}

interface AudioContextCtor {
  new (): AudioContext
}

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

export function createFeedbackAudio(): FeedbackAudio {
  let ctx: AudioContext | null = null

  return {
    unlock(): void {
      // Antes había un flag `unlocked` que hacía este método un no-op
      // después del primer click: eso construye el AudioContext una sola
      // vez (correcto), pero también bloqueaba el resume() de más abajo
      // para siempre -- si el navegador suspendía el contexto en CUALQUIER
      // momento posterior (tab en segundo plano, throttling de energía),
      // playHitmarker() quedaba mudo el resto de la partida sin ningún
      // camino de vuelta, porque nada más vuelve a llamar resume(). El
      // `if (!ctx)` de abajo ya deja la construcción como una sola vez;
      // el resume() ahora se reintenta en cada gesto del jugador.
      try {
        if (!ctx) {
          const Ctor = resolveAudioContextCtor()
          if (!Ctor) return
          ctx = new Ctor()
        }
        if (ctx.state === 'suspended') {
          // resume() devuelve una promesa; un rechazo (bloqueado por el
          // navegador) no debe volverse un error no manejado.
          ctx.resume().catch(() => {})
        }
      } catch {
        ctx = null
      }
    },

    playHitmarker(tier: HitmarkerTier): void {
      const c = ctx
      if (!c || c.state !== 'running') return

      try {
        const spec = FEEDBACK.hitmarkerAudio[tier]
        const osc = c.createOscillator()
        const gain = c.createGain()

        osc.type = spec.type
        const now = c.currentTime
        osc.frequency.setValueAtTime(spec.freqStart, now)
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freqEnd), now + spec.durationS)

        gain.gain.setValueAtTime(spec.gain, now)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.durationS)

        osc.connect(gain)
        gain.connect(c.destination)
        osc.start(now)
        osc.stop(now + spec.durationS)
      } catch {
        // Degrada en silencio: nunca tirar desde el camino de feedback.
      }
    },
  }
}
