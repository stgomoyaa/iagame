import { degToRad } from '@/game/weapons/archetypes'

/**
 * Todos los números del sistema de feedback (sección 5 del spec de fase 1)
 * en un solo objeto mutable, siguiendo el mismo patrón que
 * movement/tuning.ts y weapons/viewmodel/tuning.ts: un panel de debug
 * futuro puede escribir estos campos en caliente sin que nadie tenga que
 * tocar el resto del módulo.
 */
export interface FeedbackTuning {
  /** Cuántos hitmarkers pueden estar en pantalla a la vez. El (n+1)-ésimo
   *  hit recicla el slot más viejo del anillo (ver feedback/pool.ts). */
  hitmarkerPoolSize: number
  /** Duración de un hitmarker, segundos. */
  hitmarkerDurationS: number
  /** Escala visual con daño 0. */
  hitmarkerBaseScale: number
  /** Escala visual al daño de saturación (hitmarkerDamageForMaxScale o más). */
  hitmarkerMaxScale: number
  /** Daño al que la escala ya llegó a hitmarkerMaxScale. */
  hitmarkerDamageForMaxScale: number

  /** Cuántos números de daño flotantes pueden estar en pantalla a la vez. */
  damageNumberPoolSize: number
  damageNumberLifetimeS: number
  /** Fracción de la vida útil que tarda en llegar a opacidad completa. */
  damageNumberFadeInFraction: number
  /** Fracción de la vida útil a partir de la que empieza a apagarse. */
  damageNumberFadeOutStart: number
  /** Cuánto sube en coordenadas NDC (pantalla completa = 2) a lo largo de toda su vida. */
  damageNumberRiseDistance: number
  /** Jitter horizontal en NDC para que hits simultáneos no se superpongan exactos. */
  damageNumberJitterRadius: number

  /** Impulso de roll de cámara por disparo, radianes, antes de escalar por
   *  daño/magnitud del arma. Roll (eje Z de cámara) porque pitch/yaw ya los
   *  usa el retroceso (combat/recoil.ts): un canal separado no compite con
   *  la mecánica aprendible de retroceso. */
  cameraPunchPerShot: number
  /** Tope absoluto del roll acumulado: sin esto, fuego sostenido a cadencia
   *  alta podría acumular más rápido de lo que decae. */
  cameraPunchMax: number
  cameraPunchStiffness: number
  cameraPunchDamping: number

  /** NDC de shake por punto de daño recibido. */
  shakePerDamage: number
  shakeMax: number
  /** NDC/seg de decaimiento lineal hacia 0 (mismo patrón que
   *  combat/recoil.ts: approachZero, no exponencial). */
  shakeDecayPerSecond: number

  /** Cuántas viñetas direccionales pueden solaparse. */
  vignettePoolSize: number
  vignetteDurationS: number
  vignetteBaseOpacity: number
  vignetteMaxOpacity: number
  /** Daño al que la opacidad ya llegó a vignetteMaxOpacity. */
  vignetteDamageForMaxOpacity: number

  /** Vida por debajo de la cual arrancan latido + desaturación. */
  lowHealthThreshold: number
  heartbeatBpmAtThreshold: number
  heartbeatBpmAtZero: number
  /** Desaturación máxima (1 = blanco y negro) a vida 0. */
  desaturationMax: number

  /** Vida inicial/de reset del jugador. No hay sistema de vida real todavía
   *  (fase 2 son los bots) — este número sólo alimenta los efectos de
   *  pantalla de esta sección y el hook de debug que los ejercita a mano. */
  startingHealth: number

  /** Sonido de cada nivel de hitmarker (sección 5: "cuatro niveles: impacto
   *  normal, headshot agudo, kill grave, headshot kill"), generado 100% por
   *  Web Audio (osciladores + envolvente de ganancia), sin samples
   *  descargados. No usa el tipo HitmarkerTier de hitmarkers.ts a propósito
   *  (evita un import circular tuning.ts <-> hitmarkers.ts): las cuatro
   *  claves de string son estructuralmente el mismo tipo. */
  hitmarkerAudio: Record<
    'normal' | 'headshot' | 'kill' | 'headshotKill',
    {
      /** Forma de onda del oscilador. */
      type: OscillatorType
      /** Frecuencia inicial, Hz. */
      freqStart: number
      /** Frecuencia final (rampa exponencial), Hz. */
      freqEnd: number
      /** Duración total del click, segundos. */
      durationS: number
      /** Ganancia inicial (0-1). */
      gain: number
    }
  >
}

export const FEEDBACK: FeedbackTuning = {
  hitmarkerPoolSize: 6,
  hitmarkerDurationS: 0.18,
  hitmarkerBaseScale: 0.85,
  hitmarkerMaxScale: 1.6,
  hitmarkerDamageForMaxScale: 60,

  damageNumberPoolSize: 16,
  damageNumberLifetimeS: 0.9,
  damageNumberFadeInFraction: 0.08,
  damageNumberFadeOutStart: 0.55,
  damageNumberRiseDistance: 0.22,
  damageNumberJitterRadius: 0.03,

  cameraPunchPerShot: degToRad(0.55),
  cameraPunchMax: degToRad(3.5),
  cameraPunchStiffness: 140,
  cameraPunchDamping: 16,

  shakePerDamage: 0.0022,
  shakeMax: 0.045,
  shakeDecayPerSecond: 9,

  vignettePoolSize: 3,
  vignetteDurationS: 0.6,
  vignetteBaseOpacity: 0.22,
  vignetteMaxOpacity: 0.65,
  vignetteDamageForMaxOpacity: 40,

  lowHealthThreshold: 30,
  heartbeatBpmAtThreshold: 70,
  heartbeatBpmAtZero: 140,
  desaturationMax: 0.85,

  startingHealth: 100,

  hitmarkerAudio: {
    // Impacto normal: click seco, tono medio.
    normal: { type: 'triangle', freqStart: 1100, freqEnd: 650, durationS: 0.05, gain: 0.22 },
    // Headshot: más agudo y más corto que el normal, para que se distinga
    // de oído sin mirar la pantalla.
    headshot: { type: 'triangle', freqStart: 2200, freqEnd: 1500, durationS: 0.045, gain: 0.26 },
    // Kill: grave, un poco más largo -- la confirmación "se acabó".
    kill: { type: 'sine', freqStart: 500, freqEnd: 200, durationS: 0.14, gain: 0.3 },
    // Headshot kill: el nivel más alto, agudo Y largo, la ganancia más alta
    // del arsenal de sonidos -- inconfundible.
    headshotKill: { type: 'square', freqStart: 2600, freqEnd: 900, durationS: 0.16, gain: 0.34 },
  },
}
