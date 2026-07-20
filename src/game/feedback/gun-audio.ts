/**
 * Audio de arma con samples REALES (grabaciones de campo), a diferencia de
 * feedback/audio.ts, que sintetiza los hitmarkers con osciladores.
 *
 * POR QUÉ ACÁ SÍ HAY DESCARGA Y EN audio.ts NO
 * Un hitmarker es un click filtrado de 50 ms: un oscilador con envolvente lo
 * reproduce convincente y gratis. Un disparo no — su timbre es una explosión
 * con cuerpo, cola y reflexiones que ningún oscilador imita sin sonar a
 * juguete. Los impactos, en cambio, vuelven al lado sintetizado: son
 * transientes de ruido filtrado, que es justo lo que un buffer de ruido
 * blanco con un bandpass hace bien y a costo cero de descarga.
 *
 * POLÍTICA DE AUTOPLAY
 * Mismo contrato que audio.ts: el AudioContext no se crea hasta unlock(), y
 * unlock() se llama en CADA gesto del jugador, no sólo el primero. La razón
 * está documentada en audio.ts y viene de un bug real: un flag `unlocked`
 * que convertía unlock() en no-op dejaba el resume() inalcanzable para
 * siempre, y bastaba con que el navegador suspendiera el contexto una vez
 * (pestaña en segundo plano) para que el audio no volviera nunca. Acá se
 * repite el patrón a propósito, no se comparte estado con audio.ts: cada
 * módulo maneja su propio contexto y su propio grafo.
 *
 * DESCARGA vs DECODIFICACIÓN
 * Los bytes se bajan apenas arranca el juego (precargar(), que no necesita
 * AudioContext), pero decodificarlos sí lo necesita. Por eso son dos pasos:
 * al primer gesto ya están los bytes en memoria y decodificar es inmediato,
 * en vez de recién ahí empezar a pedirlos por red y perderse los primeros
 * disparos de la partida.
 */

import type { WeaponClass } from '@/game/weapons/archetypes'
import { WEAPON_AUDIO } from '@/game/feedback/tuning'
import { SUPERFICIE_CARNE } from '@/game/feedback/vfx'

/** Carpeta pública de los samples. */
const BASE = '/assets/audio/'

export interface WeaponAudio {
  /** Crea (una sola vez) y reanuda el AudioContext, y dispara la
   *  decodificación de lo que ya se haya bajado. Llamar desde un gesto. */
  unlock(): void
  /** Baja los bytes de todos los samples. No necesita gesto de usuario ni
   *  AudioContext. Idempotente. */
  precargar(): void
  /** Disparo de la clase indicada. `ganancia` escala sobre WEAPON_AUDIO.shotGain
   *  (los bots disparan más bajo y con atenuación por distancia). */
  playShot(clase: WeaponClass, ganancia?: number): void
  /** Recarga de la clase indicada. */
  playReload(clase: WeaponClass): void
  /** Impacto, sintetizado. `superficie` es uno de los SUPERFICIE_* de vfx.ts. */
  playImpact(superficie: number): void
  /** true cuando hay contexto corriendo y al menos un sample decodificado. */
  readonly listo: boolean
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

/**
 * Lista de archivos únicos a bajar. Se deduplica sobre los dos mapas de
 * tuning porque varias clases comparten sample: bajar
 * WEAPON_AUDIO.shotByClass tal cual pediría 'reload-mag.mp3' cuatro veces.
 */
export function archivosUnicos(): string[] {
  const set = new Set<string>()
  for (const f of Object.values(WEAPON_AUDIO.shotByClass)) set.add(f)
  for (const f of Object.values(WEAPON_AUDIO.reloadByClass)) set.add(f)
  return Array.from(set)
}

/**
 * Atenuación por distancia para el disparo de otro (un bot). Lineal hasta
 * botAudibleRange y 0 más allá: es más barato que una curva y a esta escala
 * de mapa (60 m de lado) nadie nota la diferencia.
 */
export function gananciaPorDistancia(distancia: number): number {
  const r = WEAPON_AUDIO.botAudibleRange
  if (!(distancia >= 0) || distancia >= r) return 0
  return (1 - distancia / r) * WEAPON_AUDIO.botShotGain
}

export function createWeaponAudio(): WeaponAudio {
  let ctx: AudioContext | null = null
  /** Nodo maestro: todo pasa por acá. */
  let master: GainNode | null = null
  /** Compresor de salida. Con diez bots disparando se suman muchas voces y
   *  sin esto la mezcla satura y suena a distorsión, no a combate. */
  let limitador: DynamicsCompressorNode | null = null
  /** Ruido blanco preasignado, fuente de todos los impactos. */
  let ruido: AudioBuffer | null = null

  /** Bytes bajados, por archivo. */
  const bytes = new Map<string, ArrayBuffer>()
  /** Buffers ya decodificados, por archivo. */
  const buffers = new Map<string, AudioBuffer>()
  let precargaIniciada = false

  function decodificarPendientes(): void {
    const c = ctx
    if (!c) return
    for (const [nombre, datos] of bytes) {
      if (buffers.has(nombre)) continue
      // decodeAudioData consume (detach) el ArrayBuffer, así que se le pasa
      // una copia: si falla y hay que reintentar en otro unlock, el original
      // sigue sirviendo.
      try {
        const copia = datos.slice(0)
        const p = c.decodeAudioData(copia)
        // Safari viejo devuelve undefined y usa callbacks; el guard evita
        // romperse ahí.
        if (p && typeof p.then === 'function') {
          p.then((buf) => {
            buffers.set(nombre, buf)
          }).catch(() => {})
        }
      } catch {
        // Degrada en silencio: un sample que no decodifica sólo no suena.
      }
    }
  }

  function construirRuido(c: AudioContext): AudioBuffer {
    // Medio segundo alcanza para cualquier impacto; se reusa recortando.
    const largo = Math.floor(c.sampleRate * 0.5)
    const buf = c.createBuffer(1, largo, c.sampleRate)
    const datos = buf.getChannelData(0)
    // PRNG propio en vez de Math.random: mismo ruido en cada sesión, así el
    // sonido de impacto no cambia de una partida a otra.
    let x = 0x9e3779b9
    for (let i = 0; i < largo; i++) {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      x >>>= 0
      datos[i] = (x / 0xffffffff) * 2 - 1
    }
    return buf
  }

  function reproducir(nombre: string, ganancia: number, detune: number): void {
    const c = ctx
    const dest = master
    if (!c || !dest || c.state !== 'running' || ganancia <= 0) return
    const buf = buffers.get(nombre)
    if (!buf) return

    try {
      const src = c.createBufferSource()
      src.buffer = buf
      // Variar el tono por disparo es el truco más barato contra la
      // sensación de "bucle de una sola muestra" en fuego sostenido.
      src.playbackRate.value = 1 + detune
      const g = c.createGain()
      g.gain.value = ganancia
      src.connect(g)
      g.connect(dest)
      // start(0) = ya, en el mismo frame en que se resolvió el disparo.
      src.start()
    } catch {
      // Nunca tirar desde el camino de feedback.
    }
  }

  return {
    get listo(): boolean {
      return ctx !== null && ctx.state === 'running' && buffers.size > 0
    },

    precargar(): void {
      if (precargaIniciada) return
      precargaIniciada = true
      if (typeof fetch === 'undefined') return
      for (const nombre of archivosUnicos()) {
        fetch(BASE + nombre)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .then((datos) => {
            if (!datos) return
            bytes.set(nombre, datos)
            // Si el contexto ya existe (el jugador ya hizo click), decodificar
            // apenas llega en vez de esperar al próximo gesto.
            decodificarPendientes()
          })
          .catch(() => {})
      }
    },

    unlock(): void {
      try {
        if (!ctx) {
          const Ctor = resolveAudioContextCtor()
          if (!Ctor) return
          ctx = new Ctor()
          limitador = ctx.createDynamicsCompressor()
          limitador.threshold.value = -8
          limitador.ratio.value = 12
          limitador.attack.value = 0.002
          limitador.release.value = 0.12
          master = ctx.createGain()
          master.gain.value = 1
          master.connect(limitador)
          limitador.connect(ctx.destination)
          ruido = construirRuido(ctx)
        }
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {})
        }
        decodificarPendientes()
      } catch {
        ctx = null
        master = null
        limitador = null
        ruido = null
      }
    },

    playShot(clase: WeaponClass, ganancia = 1): void {
      const nombre = WEAPON_AUDIO.shotByClass[clase]
      if (!nombre) return
      const d = (Math.random() * 2 - 1) * WEAPON_AUDIO.shotDetune
      reproducir(nombre, WEAPON_AUDIO.shotGain * ganancia, d)
    },

    playReload(clase: WeaponClass): void {
      const nombre = WEAPON_AUDIO.reloadByClass[clase]
      if (!nombre) return
      reproducir(nombre, WEAPON_AUDIO.reloadGain, 0)
    },

    playImpact(superficie: number): void {
      const c = ctx
      const dest = master
      const n = ruido
      if (!c || !dest || !n || c.state !== 'running') return

      try {
        const carne = superficie === SUPERFICIE_CARNE
        // Hormigón: crack corto y brillante. Carne: golpe sordo y más largo.
        const dur = carne ? 0.11 : 0.07
        const freq = carne ? 380 : 2400
        const q = carne ? 0.8 : 1.6

        const src = c.createBufferSource()
        src.buffer = n
        // Arrancar en un punto variable del ruido evita que dos impactos
        // seguidos suenen exactamente iguales.
        const desfase = Math.random() * 0.3

        const filtro = c.createBiquadFilter()
        filtro.type = carne ? 'lowpass' : 'bandpass'
        filtro.frequency.value = freq
        filtro.Q.value = q

        const g = c.createGain()
        const ahora = c.currentTime
        g.gain.setValueAtTime(WEAPON_AUDIO.impactGain, ahora)
        g.gain.exponentialRampToValueAtTime(0.0001, ahora + dur)

        src.connect(filtro)
        filtro.connect(g)
        g.connect(dest)
        src.start(ahora, desfase, dur)
        src.stop(ahora + dur)
      } catch {
        // Igual que el resto: en silencio.
      }
    },
  }
}
