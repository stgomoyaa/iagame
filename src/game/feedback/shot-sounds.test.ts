/**
 * La pregunta que este archivo tiene que contestar es UNA: ¿dos armas
 * distintas de la MISMA clase terminan reproduciendo buffers de audio
 * distintos?
 *
 * No alcanza con "playShot no tira", que es lo que comprobaba el test viejo:
 * esa aserción pasaba idéntica cuando las 79 armas sonaban a 7, que es
 * justamente el bug que esta tarea vino a arreglar. Tampoco alcanza con
 * comparar los NOMBRES de archivo que resuelve el índice -- eso prueba que
 * la tabla está bien, no que el motor la use. Así que acá se arma un Web
 * Audio falso pero completo (contexto, fetch, decodeAudioData) y se mira lo
 * único que decide qué se escucha: el AudioBuffer que quedó colgado del
 * BufferSource en el momento de start().
 *
 * El buffer falso lleva el HASH DEL CONTENIDO del archivo del que salió. Dos
 * buffers con distinto hash vienen, con certeza, de dos archivos con bytes
 * distintos: no hay forma de que el test pase con las dos armas sonando
 * igual.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWeaponAudio } from '@/game/feedback/gun-audio'
import { loadShotIndex, resetShotIndexForTests } from '@/game/feedback/shot-index'
import { WEAPON_AUDIO } from '@/game/feedback/tuning'

const RAIZ = process.cwd()
const DIR_LOCAL = join(RAIZ, 'public/assets/audio/weapons-local')
const INDICE_LOCAL = join(DIR_LOCAL, 'index.json')

/** Un AudioBuffer falso, identificado por el contenido del archivo de origen. */
interface BufferFalso {
  readonly hash: string
  readonly duration: number
}

/** Lo que efectivamente sonó: un start() con el buffer que tenía puesto. */
interface Sonido {
  readonly hash: string | null
  readonly ganancia: number
  /** Argumentos con que se llamó a start(). Vacío = `start()` pelado = ya.
   *  Ver el test de latencia: cualquier offset sería sonido diferido. */
  readonly argsStart: readonly number[]
}

function hashDe(datos: ArrayBuffer): string {
  return createHash('sha1').update(Buffer.from(datos)).digest('hex').slice(0, 12)
}

/**
 * Web Audio + red falsos. `archivos` mapea URL a bytes; una URL ausente
 * responde 404, que es como se simula el checkout limpio.
 */
function montarEntorno(archivos: Map<string, Uint8Array>): {
  sonidos: Sonido[]
  /** hash -> URL, para que un fallo diga qué archivo sonó y no un hex suelto. */
  origen: Map<string, string>
  desmontar: () => void
} {
  const sonidos: Sonido[] = []
  const origen = new Map<string, string>()

  class GainFalso {
    gain = { value: 1 }
    threshold = { value: 0 }
    ratio = { value: 0 }
    attack = { value: 0 }
    release = { value: 0 }
    connect(): void {}
  }

  class FuenteFalsa {
    buffer: BufferFalso | null = null
    playbackRate = { value: 1 }
    /** Ganancia del nodo al que se conectó: así el test ve el volumen real. */
    private destino: GainFalso | null = null
    connect(nodo: GainFalso): void {
      this.destino = nodo
    }
    start(...args: number[]): void {
      sonidos.push({
        hash: this.buffer?.hash ?? null,
        ganancia: this.destino?.gain.value ?? 0,
        argsStart: args,
      })
    }
    stop(): void {}
  }

  class ContextoFalso {
    destination = new GainFalso()
    sampleRate = 48000
    currentTime = 0
    state: 'running' | 'suspended' = 'running'
    resume(): Promise<void> {
      this.state = 'running'
      return Promise.resolve()
    }
    createGain(): GainFalso {
      return new GainFalso()
    }
    createDynamicsCompressor(): GainFalso {
      return new GainFalso()
    }
    createBufferSource(): FuenteFalsa {
      return new FuenteFalsa()
    }
    createBiquadFilter(): { type: string; frequency: { value: number }; Q: { value: number }; connect: () => void } {
      return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: () => {} }
    }
    createBuffer(): { getChannelData: () => Float32Array } {
      return { getChannelData: () => new Float32Array(8) }
    }
    decodeAudioData(datos: ArrayBuffer): Promise<BufferFalso> {
      // El "decodificador" no interpreta Ogg: sólo marca el buffer con la
      // huella de los bytes que le llegaron. Es todo lo que hace falta para
      // distinguir un sample de otro, y no ata el test a un códec.
      return Promise.resolve({ hash: hashDe(datos), duration: datos.byteLength / 48000 })
    }
  }

  const g = globalThis as unknown as {
    window?: unknown
    fetch?: unknown
  }
  const fetchOriginal = g.fetch
  g.window = { AudioContext: ContextoFalso }
  g.fetch = (url: string): Promise<unknown> => {
    const datos = archivos.get(url)
    if (!datos) return Promise.resolve({ ok: false, status: 404 })
    const copia = datos.slice()
    origen.set(hashDe(copia.buffer as ArrayBuffer), url)
    return Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(copia.buffer as ArrayBuffer),
      json: () => Promise.resolve(JSON.parse(Buffer.from(datos).toString('utf8')) as unknown),
    })
  }

  return {
    sonidos,
    origen,
    desmontar: () => {
      delete g.window
      if (fetchOriginal === undefined) delete g.fetch
      else g.fetch = fetchOriginal
    },
  }
}

/** Deja correr las promesas en vuelo (fetch -> decode -> buffers). */
async function asentar(vueltas = 12): Promise<void> {
  for (let i = 0; i < vueltas; i++) await new Promise((r) => setTimeout(r, 0))
}

/** Bytes distintos y deterministas por nombre de archivo. */
function bytesDe(nombre: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(nombre).digest())
}

function archivosPorClase(): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>()
  for (const f of Object.values(WEAPON_AUDIO.shotByClass)) m.set(`/assets/audio/${f}`, bytesDe(f))
  for (const f of Object.values(WEAPON_AUDIO.reloadByClass)) m.set(`/assets/audio/${f}`, bytesDe(f))
  return m
}

afterEach(() => {
  resetShotIndexForTests()
})

describe('dos armas de la misma clase suenan a buffers distintos', () => {
  /**
   * Índice sintético: dos AR (misma clase, `ar`) con archivos propios, más
   * una tercera arma con varias variantes para el test de rotación.
   */
  const INDICE_SINTETICO = {
    generadoPor: 'test',
    armas: {
      'arma-ak': { fuente: 'pack__ak', variantes: ['pack__ak/disparo-1.ogg'] },
      'arma-m4': { fuente: 'pack__m4', variantes: ['pack__m4/disparo-1.ogg'] },
      'arma-multi': {
        fuente: 'pack__multi',
        variantes: ['pack__multi/disparo-1.ogg', 'pack__multi/disparo-2.ogg'],
      },
    },
  }

  function archivosSinteticos(): Map<string, Uint8Array> {
    const m = archivosPorClase()
    m.set(
      '/assets/audio/weapons-local/index.json',
      new Uint8Array(Buffer.from(JSON.stringify(INDICE_SINTETICO), 'utf8')),
    )
    for (const arma of Object.values(INDICE_SINTETICO.armas)) {
      for (const v of arma.variantes) m.set(`/assets/audio/weapons-local/${v}`, bytesDe(v))
    }
    return m
  }

  it('dos slugs distintos de clase "ar" reproducen buffers con contenido distinto', async () => {
    const env = montarEntorno(archivosSinteticos())
    try {
      const a = createWeaponAudio()
      a.precargar()
      a.unlock()
      a.prewarm('arma-ak')
      a.prewarm('arma-m4')
      await asentar()

      a.playShot('arma-ak', 'ar')
      a.playShot('arma-m4', 'ar')

      expect(env.sonidos.length, 'sonaron los dos disparos').toBe(2)
      const [ak, m4] = env.sonidos
      // Lo que importa: NO es el mismo buffer.
      expect(
        ak.hash,
        `ak sonó con ${env.origen.get(ak.hash ?? '') ?? '?'} y m4 con ${env.origen.get(m4.hash ?? '') ?? '?'}`,
      ).not.toBe(m4.hash)
      // Y ninguno de los dos es el sample genérico de la clase, que es la
      // forma en que este test podría "pasar" sin haber arreglado nada
      // (los dos cayendo al fallback darían hashes iguales, pero conviene
      // decirlo explícito para que el fallo señale la causa correcta).
      const genericoAr = env.origen.get(ak.hash ?? '')
      expect(genericoAr).toBe('/assets/audio/weapons-local/pack__ak/disparo-1.ogg')
      expect(env.origen.get(m4.hash ?? '')).toBe(
        '/assets/audio/weapons-local/pack__m4/disparo-1.ogg',
      )
    } finally {
      env.desmontar()
    }
  })

  /**
   * La latencia no puede haber empeorado con el cambio. El sample tiene que
   * arrancar en el MISMO frame en que se resolvió el disparo, que en Web
   * Audio se escribe `start()` sin argumentos (= ya). Cualquier offset o
   * `when` futuro sería sonido diferido, y en un shooter eso se siente.
   *
   * Que resolver por arma haya metido una búsqueda en un Map en el medio no
   * cambia nada de eso: es trabajo sincrónico, sin await ni encolado, y
   * termina antes del start(). Este test fija esa propiedad para que un
   * "precargamos justo antes de sonar" futuro no la rompa sin que nadie se
   * entere -- que es la forma en que este tipo de regresión suele entrar.
   */
  it('el disparo arranca en el mismo frame: start() sin offset', async () => {
    const env = montarEntorno(archivosSinteticos())
    try {
      const a = createWeaponAudio()
      a.precargar()
      a.unlock()
      a.prewarm('arma-ak')
      await asentar()

      a.playShot('arma-ak', 'ar') // nivel 1: sample propio del arma
      a.playShot('arma-desconocida', 'ar') // nivel 2: fallback por clase

      expect(env.sonidos.length).toBe(2)
      for (const s of env.sonidos) {
        expect(s.argsStart, 'start() tiene que ir pelado: sin when ni offset').toEqual([])
      }
    } finally {
      env.desmontar()
    }
  })

  it('rota entre las variantes de un arma en vez de repetir la misma en ráfaga', async () => {
    const env = montarEntorno(archivosSinteticos())
    try {
      const a = createWeaponAudio()
      a.precargar()
      a.unlock()
      a.prewarm('arma-multi')
      await asentar()

      for (let i = 0; i < 4; i++) a.playShot('arma-multi', 'ar')

      expect(env.sonidos.length).toBe(4)
      const hashes = env.sonidos.map((s) => s.hash)
      // Dos variantes, cuatro disparos: ninguno repite al anterior.
      expect(new Set(hashes).size, 'usó las dos variantes').toBe(2)
      for (let i = 1; i < hashes.length; i++) {
        expect(hashes[i], `el disparo ${i} repitió el sample del anterior`).not.toBe(hashes[i - 1])
      }
    } finally {
      env.desmontar()
    }
  })

  it('el arma del bot suena a su propia arma y con la ganancia atenuada', async () => {
    const env = montarEntorno(archivosSinteticos())
    try {
      const a = createWeaponAudio()
      a.precargar()
      a.unlock()
      a.prewarm('arma-ak')
      a.prewarm('arma-m4')
      await asentar()

      // Jugador con la AK a volumen pleno, bot con la M4 atenuado por
      // distancia: el camino de los bots tiene que resolver por arma igual
      // que el del jugador, sin perder la ganancia.
      a.playShot('arma-ak', 'ar')
      a.playShot('arma-m4', 'ar', 0.25)

      const [jugador, bot] = env.sonidos
      expect(bot.hash).not.toBe(jugador.hash)
      expect(bot.ganancia).toBeCloseTo(WEAPON_AUDIO.shotGain * 0.25, 6)
      expect(jugador.ganancia).toBeCloseTo(WEAPON_AUDIO.shotGain, 6)
    } finally {
      env.desmontar()
    }
  })
})

describe('checkout limpio: sin los assets locales, ningún arma queda muda', () => {
  it('sin índice local las dos armas caen al sample de la clase y SUENAN', async () => {
    // Sólo los 11 samples del repo: la carpeta weapons-local/ no existe y
    // todo lo que se le pida responde 404. Es el build publicado.
    const env = montarEntorno(archivosPorClase())
    try {
      const a = createWeaponAudio()
      a.precargar()
      a.unlock()
      a.prewarm('arma-ak')
      await asentar()

      a.playShot('arma-ak', 'ar')
      a.playShot('arma-m4', 'ar')
      a.playShot(null, 'sniper')

      expect(env.sonidos.length, 'los tres disparos sonaron igual que antes').toBe(3)
      for (const s of env.sonidos) expect(s.hash).not.toBeNull()
      // Los dos AR comparten sample: es exactamente el comportamiento viejo,
      // que es lo que se promete como piso, ni más ni menos.
      expect(env.origen.get(env.sonidos[0].hash ?? '')).toBe('/assets/audio/shot-ar.mp3')
      expect(env.origen.get(env.sonidos[1].hash ?? '')).toBe('/assets/audio/shot-ar.mp3')
      expect(env.origen.get(env.sonidos[2].hash ?? '')).toBe('/assets/audio/shot-sniper.mp3')
    } finally {
      env.desmontar()
    }
  })

  it('un arma nunca precalentada suena igual (con la clase) y se auto-ceba', async () => {
    const archivos = archivosSinteticos2()
    const env = montarEntorno(archivos)
    try {
      const a = createWeaponAudio()
      a.precargar()
      a.unlock()
      await asentar()

      // Primer disparo: el índice está, pero los bytes del arma no se
      // pidieron nunca. Tiene que sonar igual -- con la clase.
      a.playShot('arma-ak', 'ar')
      expect(env.origen.get(env.sonidos[0].hash ?? '')).toBe('/assets/audio/shot-ar.mp3')

      // Ese mismo disparo dejó pedidos los bytes. Después de que lleguen, el
      // arma ya suena a sí misma sin que nadie llame a prewarm().
      await asentar()
      a.playShot('arma-ak', 'ar')
      expect(env.origen.get(env.sonidos[1].hash ?? '')).toBe(
        '/assets/audio/weapons-local/pack__ak/disparo-1.ogg',
      )
    } finally {
      env.desmontar()
    }
  })
})

/** Mismo índice sintético que arriba, accesible desde el segundo describe. */
function archivosSinteticos2(): Map<string, Uint8Array> {
  const indice = {
    armas: {
      'arma-ak': { fuente: 'pack__ak', variantes: ['pack__ak/disparo-1.ogg'] },
    },
  }
  const m = archivosPorClase()
  m.set(
    '/assets/audio/weapons-local/index.json',
    new Uint8Array(Buffer.from(JSON.stringify(indice), 'utf8')),
  )
  m.set('/assets/audio/weapons-local/pack__ak/disparo-1.ogg', bytesDe('pack__ak/disparo-1.ogg'))
  return m
}

/**
 * Presupuesto de memoria del camino caliente. `playShot` corre varias veces
 * por frame (el jugador en automático + diez bots) y resolver por arma le
 * sumó trabajo: buscar en un Map, recorrer variantes, mover un cursor. Nada
 * de eso puede acumular, o el sistema de audio se vuelve el que ensucia el
 * frame justo cuando más se dispara.
 *
 * QUÉ MIDE ESTO EXACTAMENTE (y qué no)
 * Mismo patrón que src/game/**\/allocations.test.ts -- gc() ANTES y DESPUÉS
 * del tramo medido -- y por lo tanto la misma cobertura: detecta lo que
 * queda RETENIDO de un disparo al siguiente (un array que crece, un Map que
 * nunca se limpia, un listener que se acumula), no los objetos transitorios
 * que nacen y mueren dentro de una llamada. Está comprobado: un
 * `{ d: Math.random() }` metido a mano en playShot NO hace fallar este test,
 * porque V8 lo elimina por escape analysis o el gc final se lo lleva.
 *
 * O sea que la ausencia de asignaciones transitorias en playShot NO la
 * garantiza este test, sino la forma del código: no hay literales de objeto,
 * de array ni concatenación de strings en el camino del disparo (las claves
 * del Map son las mismas strings que ya viven en el índice). Si alguien mete
 * un `slug + '/' + i` ahí, este guard va a seguir verde -- que quede dicho
 * acá y no que se descubra midiendo.
 *
 * Falla fuerte si no corre con --expose-gc en vez de volverse un no-op
 * silencioso (`pnpm test` lo pasa; `npx vitest` a secas no).
 */
describe('presupuesto de memoria de playShot', () => {
  it('no retiene nada de un disparo al siguiente, ni por arma ni por clase', async () => {
    expect(typeof global.gc, 'correr con --expose-gc (usar pnpm test)').toBe('function')

    // Contexto MUDO y sin asignaciones propias: devuelve siempre los mismos
    // nodos preasignados. Un mock que creara un objeto por llamada mediría
    // el mock, no a playShot.
    const nodo = {
      gain: { value: 1 },
      threshold: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect: (): void => {},
    }
    const fuente = {
      buffer: null as unknown,
      playbackRate: { value: 1 },
      connect: (): void => {},
      start: (): void => {},
      stop: (): void => {},
    }
    const buffersFalsos = { getChannelData: (): Float32Array => new Float32Array(8) }

    const archivos = archivosSinteticos2()
    const g = globalThis as unknown as { window?: unknown; fetch?: unknown }
    const fetchOriginal = g.fetch
    g.window = {
      AudioContext: class {
        destination = nodo
        sampleRate = 48000
        currentTime = 0
        state = 'running' as const
        resume(): Promise<void> {
          return Promise.resolve()
        }
        createGain(): typeof nodo {
          return nodo
        }
        createDynamicsCompressor(): typeof nodo {
          return nodo
        }
        createBufferSource(): typeof fuente {
          return fuente
        }
        createBuffer(): typeof buffersFalsos {
          return buffersFalsos
        }
        decodeAudioData(d: ArrayBuffer): Promise<{ duration: number }> {
          return Promise.resolve({ duration: d.byteLength })
        }
      },
    }
    g.fetch = (url: string): Promise<unknown> => {
      const datos = archivos.get(url)
      if (!datos) return Promise.resolve({ ok: false })
      const copia = datos.slice()
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(copia.buffer as ArrayBuffer),
        json: () => Promise.resolve(JSON.parse(Buffer.from(datos).toString('utf8')) as unknown),
      })
    }

    try {
      const a = createWeaponAudio()
      a.precargar()
      a.unlock()
      a.prewarm('arma-ak')
      await asentar()

      // Calentar: JIT y asentar el estado interno (el Set de pedidos, el
      // cursor de variantes) antes de medir.
      for (let i = 0; i < 20000; i++) {
        a.playShot('arma-ak', 'ar')
        a.playShot(null, 'smg', 0.3)
      }

      global.gc?.()
      const antes = process.memoryUsage().heapUsed
      for (let i = 0; i < 200000; i++) {
        a.playShot('arma-ak', 'ar')
        a.playShot(null, 'smg', 0.3)
      }
      global.gc?.()
      const despues = process.memoryUsage().heapUsed

      // 400.000 disparos. Cualquier cosa RETENIDA por disparo -- aunque sean
      // 8 bytes -- crecería megabytes acá; el margen de 512 KB es ruido del
      // heap, no espacio para una fuga.
      const crecimiento = despues - antes
      expect(
        crecimiento,
        `playShot creció ${(crecimiento / 1024).toFixed(1)} KB en 400.000 disparos: está reteniendo algo por disparo`,
      ).toBeLessThan(512 * 1024)
    } finally {
      delete g.window
      if (fetchOriginal === undefined) delete g.fetch
      else g.fetch = fetchOriginal
    }
  })
})

/**
 * Los tests de arriba prueban el MOTOR con un índice inventado, y corren en
 * cualquier checkout. Éste prueba los ASSETS REALES -- que el índice que
 * dejó scripts/prepare-weapon-sounds.ts efectivamente le da a un AK y a una
 * M4 (las dos `ar`) archivos con bytes distintos. Se saltea si los archivos
 * no están, porque son contenido del Workshop y un checkout limpio no los
 * tiene (docs/WORKSHOP.md): fallar ahí sería castigar el caso normal.
 */
describe.skipIf(!existsSync(INDICE_LOCAL))('assets reales del Workshop', () => {
  it('el índice generado cubre las 79 armas y casi todas con fuente propia', async () => {
    resetShotIndexForTests()
    const crudo = JSON.parse(readFileSync(INDICE_LOCAL, 'utf8')) as {
      armas: Record<string, { fuente: string; variantes: string[] }>
    }
    const n = await loadShotIndex(() => Promise.resolve(crudo))
    expect(n).toBe(79)
    const fuentes = new Set(Object.values(crudo.armas).map((a) => a.fuente))
    // 73 fuentes para 79 armas: seis comparten grabación con otra (no hay
    // material distinto para todas). El número exacto es el que reportó el
    // preparador; si baja mucho, alguien rompió la tabla de asignación.
    expect(fuentes.size).toBeGreaterThanOrEqual(70)
  })

  it('ak47 y m4a4 (las dos "ar") reproducen buffers de archivos distintos', async () => {
    const crudo = JSON.parse(readFileSync(INDICE_LOCAL, 'utf8')) as {
      armas: Record<string, { variantes: string[] }>
    }
    const archivos = archivosPorClase()
    archivos.set(
      '/assets/audio/weapons-local/index.json',
      new Uint8Array(readFileSync(INDICE_LOCAL)),
    )
    // Bytes REALES de los .ogg de las dos armas.
    for (const slug of ['ak47', 'm4a4']) {
      for (const v of crudo.armas[slug].variantes) {
        archivos.set(`/assets/audio/weapons-local/${v}`, new Uint8Array(readFileSync(join(DIR_LOCAL, v))))
      }
    }

    const env = montarEntorno(archivos)
    try {
      const a = createWeaponAudio()
      a.precargar()
      a.unlock()
      a.prewarm('ak47')
      a.prewarm('m4a4')
      await asentar()

      a.playShot('ak47', 'ar')
      a.playShot('m4a4', 'ar')

      expect(env.sonidos.length).toBe(2)
      const [ak, m4] = env.sonidos
      expect(env.origen.get(ak.hash ?? '')).toMatch(/weapons-local\/.*ak47/)
      expect(env.origen.get(m4.hash ?? '')).toMatch(/weapons-local\/.*m16/)
      expect(ak.hash, 'el AK y la M4 sonaron con el MISMO buffer').not.toBe(m4.hash)
    } finally {
      env.desmontar()
    }
  })
})
