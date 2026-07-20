import { degToRad } from '@/game/weapons/archetypes'
import type { WeaponClass } from '@/game/weapons/archetypes'

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

/**
 * Números de los efectos visuales de disparo (fulgor de boca, trazadores,
 * impactos y calcomanías). Van en un objeto aparte de FEEDBACK porque los
 * consume otro sistema (feedback/vfx.ts + feedback/vfx-renderer.ts), pero
 * siguen el mismo patrón mutable para que un panel de debug pueda tocarlos
 * en caliente.
 *
 * Los tamaños de pool son el techo de todo: no hay crecimiento dinámico en
 * ningún lado. Están elegidos contra el presupuesto de 2.5 ms combinado —
 * el riesgo real acá no es CPU (escribir instancias es ruido) sino FILL
 * RATE: cada partícula aditiva es overdraw de pantalla completa en potencia.
 * Por eso los quads son chicos y las vidas cortas.
 */
export interface VfxTuning {
  /** Fulgores de boca simultáneos. Con cadencia alta se solapan dos o tres. */
  muzzlePoolSize: number
  /** Vida del fulgor, segundos. Muy corto a propósito: un fulgor que dura
   *  se lee como bengala, no como disparo. */
  muzzleLifeS: number
  /** Tamaño del quad del fulgor en espacio del viewmodel (metros). */
  muzzleScale: number
  /** Variación aleatoria de escala, fracción (0.3 = ±30%). */
  muzzleScaleJitter: number

  /** Trazadores simultáneos. Techo pensado para jugador + 10 bots disparando. */
  tracerPoolSize: number
  /** Vida del trazador, segundos. */
  tracerLifeS: number
  /** Velocidad de viaje del trazador, m/s. No es la del proyectil real (el
   *  hitscan resuelve instantáneo): es la que hace que se LEA como un tiro. */
  tracerSpeed: number
  /** Largo del segmento luminoso, metros. */
  tracerLength: number
  /** Ancho del segmento, metros. */
  tracerWidth: number
  /** Fracción de disparos que dejan trazador (1 = todos). Menos de 1 se ve
   *  más real y baja el fill; los shooters suelen usar 1 de cada 3-5. */
  tracerFraction: number

  /** Impactos (chispa + humo) simultáneos. */
  impactPoolSize: number
  impactLifeS: number
  /** Tamaño del quad de chispa, metros. */
  impactScale: number
  /**
   * Cuánto se despega la chispa de la superficie, metros. No es cosmético:
   * el quad es un billboard CENTRADO en el punto de impacto, así que puesto
   * exactamente sobre la pared queda medio enterrado -- la mitad de atrás la
   * descarta el depth test y la de adelante pelea en z. El efecto se veía
   * cuando lo agrandé a 2 m (sobresalía) y desaparecía al tamaño real, que
   * es exactamente el síntoma de esto.
   */
  impactOffset: number

  /** Calcomanías vivas a la vez. Es un anillo: la número (n+1) pisa la más
   *  vieja, así que el costo queda plano por más que la partida dure horas.
   *  Ese acotamiento es el punto -- calcomanías sin techo son la forma
   *  clásica de filtrar draw calls y memoria a lo largo de una partida. */
  decalPoolSize: number
  /** Vida de la calcomanía, segundos. Se desvanece al final en vez de
   *  desaparecer de golpe. */
  decalLifeS: number
  /** Fracción final de la vida en la que se desvanece. */
  decalFadeFraction: number
  /** Tamaño de la calcomanía, metros. */
  decalScale: number
  /** Cuánto se despega de la pared para no pelear en z con ella, metros. */
  decalOffset: number
}

export const VFX: VfxTuning = {
  muzzlePoolSize: 4,
  muzzleLifeS: 0.07,
  muzzleScale: 0.2,
  muzzleScaleJitter: 0.35,

  tracerPoolSize: 48,
  tracerLifeS: 0.09,
  tracerSpeed: 420,
  tracerLength: 5.5,
  tracerWidth: 0.045,
  tracerFraction: 1,

  impactPoolSize: 96,
  impactLifeS: 0.22,
  impactScale: 0.2,
  impactOffset: 0.12,

  decalPoolSize: 64,
  decalLifeS: 18,
  decalFadeFraction: 0.2,
  decalScale: 0.12,
  decalOffset: 0.05,
}

/**
 * Audio de arma con samples reales (a diferencia de los hitmarkers, que
 * siguen siendo osciladores: un click filtrado se sintetiza convincente y
 * gratis, un disparo no).
 *
 * El mapeo es por FAMILIA de arma, no por modelo: 10 arquetipos comparten 7
 * disparos y 4 recargas. Eso es deliberado — un sample por arma multiplicaría
 * el peso de descarga sin que nadie note la diferencia entre dos fusiles.
 */
export interface WeaponAudioTuning {
  /** Ganancia del disparo (0-1). Los samples ya vienen normalizados a -3 dBFS
   *  de pico, esto es el nivel dentro de la mezcla. */
  shotGain: number
  /** Ganancia de la recarga. Más bajo que el disparo: es un sonido de
   *  manipulación, no un evento de combate. */
  reloadGain: number
  /** Ganancia del impacto (sintetizado, ver gun-audio.ts). */
  impactGain: number
  /** Variación aleatoria de tono por disparo, fracción de playbackRate.
   *  Sin esto, fuego sostenido suena a bucle de una sola muestra — es el
   *  truco más barato para que una sola grabación no se delate. */
  shotDetune: number
  /** Ganancia del disparo de un bot, relativa a la del jugador. */
  botShotGain: number
  /** Distancia (m) a partir de la cual el disparo de un bot deja de oírse. */
  botAudibleRange: number
  /** Archivo de disparo por clase de arma. */
  shotByClass: Record<WeaponClass, string>
  /** Archivo de recarga por clase de arma. */
  reloadByClass: Record<WeaponClass, string>
}

export const WEAPON_AUDIO: WeaponAudioTuning = {
  shotGain: 0.5,
  reloadGain: 0.42,
  impactGain: 0.3,
  shotDetune: 0.06,
  botShotGain: 0.55,
  botAudibleRange: 60,

  shotByClass: {
    smg: 'shot-smg.mp3',
    ar: 'shot-ar.mp3',
    lmg: 'shot-lmg.mp3',
    sniper: 'shot-sniper.mp3',
    marksman: 'shot-marksman.mp3',
    pistol: 'shot-pistol.mp3',
    shotgun: 'shot-shotgun.mp3',
  },

  reloadByClass: {
    // Cuatro recargas para siete clases: el cargador de fusil sirve igual
    // para SMG, AR, LMG y marksman -- son todos "sacar mag, meter mag".
    smg: 'reload-mag.mp3',
    ar: 'reload-mag.mp3',
    lmg: 'reload-mag.mp3',
    marksman: 'reload-mag.mp3',
    sniper: 'reload-bolt.mp3',
    pistol: 'reload-pistol.mp3',
    shotgun: 'reload-pump.mp3',
  },
}
