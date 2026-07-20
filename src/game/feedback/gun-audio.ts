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
 *
 * DOS NIVELES DE DISPARO: POR ARMA, CON RED DE SEGURIDAD POR CLASE
 * El disparo se resuelve por SLUG (el arma concreta) y sólo cae a la clase
 * si no hay nada mejor. Antes se resolvía únicamente por clase, y eso hacía
 * que las 79 armas sonaran como 7: en un shooter, distinguir de oído qué te
 * está disparando es información táctica, no adorno.
 *
 * Los dos niveles no son intercambiables ni opcionales:
 *
 *  - **Por clase** (11 samples, `public/assets/audio/`): están EN EL REPO.
 *    Es el piso garantizado -- ningún arma queda muda jamás.
 *  - **Por arma** (130 archivos, `public/assets/audio/weapons-local/`):
 *    derivados del Workshop, gitignoreados (docs/WORKSHOP.md). En un
 *    checkout limpio sencillamente NO ESTÁN, el fetch da 404 y el juego
 *    suena exactamente como antes de esta tarea. Sin mensaje de error: ese
 *    build es el producto normal, no una instalación rota.
 *
 * ESTRATEGIA DE CARGA: PEREZOSA POR ARMA, CON PRECALENTAMIENTO
 * Bajar los 130 archivos al arranque (1,8 MB) sería tirar ~10x de lo que una
 * partida usa -- se juega con dos armas propias y N de bots, no con 79 -- y
 * competiría por ancho de banda con los GLB y el mapa justo en el momento en
 * que la latencia importa. Así que:
 *
 *   1. `precargar()` baja los 11 samples por clase + el índice (~15 KB).
 *   2. `prewarm(slug)` baja las 1-5 variantes de UN arma (~10-70 KB).
 *      Lo llama el juego al equipar un arma y al armar el escuadrón de bots.
 *   3. `playShot()` se auto-ceba: si le piden un arma que nadie precalentó,
 *      dispara su descarga y ESE disparo sale con el sample de la clase.
 *
 * El punto fino: la carga perezosa normalmente se paga con un tirón la
 * primera vez. Acá no, porque el nivel por clase ya está decodificado y
 * suena en el mismo frame. Lo peor que puede pasar es que un disparo suene
 * genérico; nunca que falte, ni que el hilo se bloquee esperando bytes.
 *
 * FORMATO: OPUS EN OGG, SIN FALLBACK AAC (decisión deliberada)
 * Safari soporta Opus-en-Ogg recién desde 18.4 (marzo 2025). Un Safari
 * anterior falla el decodeAudioData, el catch de `decodificarPendientes` se
 * lo come, el buffer nunca entra al mapa y `playShot` cae al sample de la
 * clase. O sea: en el navegador que no soporta el formato, el juego suena
 * como sonaba antes -- que es el mismo desenlace que ya tiene un checkout
 * sin los assets. Duplicar los 130 archivos a AAC (el preparador lo soporta
 * con `--formato aac`) costaría el doble de disco y un segundo pipeline para
 * comprar una degradación que ya está cubierta y es silenciosa. Si algún día
 * el fallback por clase deja de existir, esta decisión hay que revisarla.
 */

import type { WeaponClass } from '@/game/weapons/archetypes'
import { WEAPON_AUDIO } from '@/game/feedback/tuning'
import { SUPERFICIE_CARNE } from '@/game/feedback/vfx'
import { entradaDisparo, loadShotIndex, SHOT_INDEX_BASE } from '@/game/feedback/shot-index'

/** Carpeta pública de los samples por clase (los que sí están en el repo). */
const BASE = '/assets/audio/'

export interface WeaponAudio {
  /** Crea (una sola vez) y reanuda el AudioContext, y dispara la
   *  decodificación de lo que ya se haya bajado. Llamar desde un gesto. */
  unlock(): void
  /** Baja los bytes de los samples por clase y el índice por arma. No
   *  necesita gesto de usuario ni AudioContext. Idempotente. */
  precargar(): void
  /** Baja las variantes de un arma concreta. Idempotente y seguro de llamar
   *  con un slug que no tenga sonido propio (no hace nada). Llamarlo al
   *  equipar un arma evita que su primer disparo salga con el sample de la
   *  clase. */
  prewarm(slug: string): void
  /**
   * Disparo del arma indicada. `slug` elige el sample propio del arma; si es
   * `null` o el arma todavía no tiene su buffer listo, cae al sample de
   * `clase`, que siempre existe. `ganancia` escala sobre
   * WEAPON_AUDIO.shotGain (los bots disparan más bajo y con atenuación por
   * distancia).
   */
  playShot(slug: string | null, clase: WeaponClass, ganancia?: number): void
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
  /** Claves ya pedidas por red (hayan llegado o no). Evita repetir el fetch. */
  const pedidos = new Set<string>()
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

  /**
   * Devuelve `true` si el sample efectivamente arrancó. Ese booleano es lo
   * que hace posible la cascada de dos niveles sin preguntar dos veces por
   * el mismo buffer: quien llama intenta el sample del arma y, si devuelve
   * `false` (todavía no bajó, no decodificó, o el navegador no soporta el
   * formato), tira el de la clase.
   */
  function reproducir(nombre: string, ganancia: number, detune: number): boolean {
    const c = ctx
    const dest = master
    if (!c || !dest || c.state !== 'running' || ganancia <= 0) return false
    const buf = buffers.get(nombre)
    if (!buf) return false

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
      return true
    } catch {
      // Nunca tirar desde el camino de feedback.
      return false
    }
  }

  /**
   * Baja UN archivo y lo deja listo para decodificar. Idempotente por clave:
   * `pedidos` marca lo que ya se pidió, así que llamar mil veces con el
   * mismo sample cuesta un `Set.has` -- que es exactamente lo que pasa
   * cuando `playShot` se auto-ceba con el arma que el jugador está usando.
   */
  function bajar(clave: string, url: string): void {
    if (pedidos.has(clave)) return
    pedidos.add(clave)
    if (typeof fetch === 'undefined') return
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((datos) => {
        if (!datos) return
        bytes.set(clave, datos)
        // Si el contexto ya existe (el jugador ya hizo click), decodificar
        // apenas llega en vez de esperar al próximo gesto.
        decodificarPendientes()
      })
      .catch(() => {})
  }

  /**
   * Pide las variantes de un arma. Devuelve `false` si el arma no está en el
   * índice -- que puede querer decir dos cosas MUY distintas: que no hay
   * índice (checkout limpio, y no lo habrá nunca) o que todavía no llegó.
   * Quien llama decide si vale la pena reintentar; acá no se puede saber.
   */
  function pedirVariantes(slug: string): boolean {
    const entrada = entradaDisparo(slug)
    if (!entrada) return false
    for (const v of entrada.variantes) bajar(v, SHOT_INDEX_BASE + v)
    return true
  }

  return {
    get listo(): boolean {
      return ctx !== null && ctx.state === 'running' && buffers.size > 0
    },

    precargar(): void {
      if (precargaIniciada) return
      precargaIniciada = true
      // Los 11 por clase: son el piso garantizado, se bajan siempre y
      // enteros. Pesan ~120 KB en total.
      for (const nombre of archivosUnicos()) bajar(nombre, BASE + nombre)
      // El índice por arma, en cambio, sólo trae la TABLA (~15 KB): los 1,8
      // MB de .ogg se bajan por arma, cuando y si hacen falta. Ver el
      // encabezado, "estrategia de carga".
      loadShotIndex().catch(() => {})
    },

    prewarm(slug: string): void {
      if (pedirVariantes(slug)) return
      // El índice todavía no llegó. Y no es un caso raro: equipar el arma
      // inicial y armar el escuadrón de bots pasan en el mismo arranque en
      // que se pide el índice, así que SIN este reintento el
      // precalentamiento no serviría casi nunca y todo el mundo estrenaría
      // arma con el sample de la clase. `loadShotIndex()` es idempotente:
      // devuelve la misma promesa en vuelo, no dispara un segundo fetch.
      loadShotIndex()
        .then(() => {
          pedirVariantes(slug)
        })
        .catch(() => {})
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

    playShot(slug: string | null, clase: WeaponClass, ganancia = 1): void {
      // Variar el tono por disparo (mismo detune para los dos niveles: es
      // una propiedad del disparo, no del sample que le tocó).
      const d = (Math.random() * 2 - 1) * WEAPON_AUDIO.shotDetune
      const g = WEAPON_AUDIO.shotGain * ganancia

      // NIVEL 1: el sample propio del arma.
      const entrada = slug === null ? null : entradaDisparo(slug)
      if (slug !== null && entrada) {
        const n = entrada.variantes.length
        // Recorre desde el cursor: rota entre las variantes en ráfaga y, si
        // sólo algunas decodificaron todavía, usa las que sí en vez de caer
        // a la clase por culpa de la que faltaba. Son 5 vueltas como mucho,
        // sobre un array ya asignado -- ni un objeto nuevo por disparo.
        for (let i = 0; i < n; i++) {
          const idx = (entrada.cursor + i) % n
          if (reproducir(entrada.variantes[idx], g, d)) {
            entrada.cursor = idx + 1 === n ? 0 : idx + 1
            return
          }
        }
        // Nadie precalentó esta arma (o todavía está en vuelo): pedirla
        // ahora para que el PRÓXIMO disparo ya suene como corresponde. Es
        // idempotente, así que sostener el gatillo no dispara mil fetch.
        pedirVariantes(slug)
      }

      // NIVEL 2: el sample de la clase. Siempre está en el repo.
      const porClase = WEAPON_AUDIO.shotByClass[clase]
      if (porClase) reproducir(porClase, g, d)
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
