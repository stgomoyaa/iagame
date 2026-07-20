/**
 * Prepara los sonidos de DISPARO por arma a partir de los tres packs del
 * Workshop de GMod ya extraídos, y escribe un índice que ata cada una de
 * nuestras 79 armas a sus archivos.
 *
 *   node scripts/prepare-weapon-sounds.ts \
 *     --raw workshop-assets/sounds-raw \
 *     --out workshop-assets/weapon-sounds
 *
 * Flags: `--formato opus|aac` (default opus), `--dry-run` (no transcodifica,
 * sólo reporta cobertura), `--limite N` (corta el trabajo, para probar).
 *
 * NADA DE ESTO SE COMMITEA. Entra y sale de `workshop-assets/`, que está
 * gitignoreado y con guardia propia (scripts/workshop-guard.test.ts). Este
 * script es código; su salida es asset derivado del Workshop y es local.
 *
 * PRE-REQUISITO (no lo hace este script, a propósito)
 * Bajar los tres addons con SteamCMD y extraerles sólo el audio:
 *   ~/steamcmd/steamcmd.sh +login anonymous \
 *     +workshop_download_item 4000 2169649722 \   # M9k Remastered
 *     +workshop_download_item 4000 2926739280 \   # [ARC9] Modern Warfare Classic
 *     +workshop_download_item 4000 2926734724 +quit  # [ARC9] Black Ops Classic
 *   node scripts/gma-extract.ts <addon.gma> workshop-assets/sounds-raw/<pack> \
 *     --only .wav,.mp3,.ogg
 * Son ~2,4 GB de descarga para ~200 MB de audio. Separarlo evita que una
 * corrida de este script dispare esa descarga sin que nadie la pidiera.
 *
 * POR QUÉ SE TRANSCODIFICA TODO Y NO SÓLO "LOS WAV PCM"
 * Ninguno de los disparos llega en un formato que el navegador decodifique
 * directo:
 *   - Los .wav de M9k y Black Ops son PCM s16le. `decodeAudioData` sí los
 *     acepta, pero pesan ~10x lo que pesa el mismo audio en Opus, y son 73
 *     archivos que se bajan en cada partida.
 *   - Los de MW Classic son ADPCM de Microsoft (`adpcm_ms`), que NO es PCM y
 *     que `decodeAudioData` no decodifica en ningún navegador. Ésos no son
 *     una optimización: sin transcodificar, no suenan.
 *   - Los .mp3 de M9k, que sí entrarían directo, resultaron ser sonidos de
 *     RECARGA, no de disparo (ver scripts/lib/weapon-sounds.ts). No sirven
 *     para esta tarea.
 *
 * POR QUÉ MONO
 * Los disparos se posicionan en 3D. Un PannerNode de la Web Audio API
 * espacializa una fuente mono; si le entra estéreo, el paneo del archivo
 * pelea con el paneo posicional y el arma deja de ubicarse de oído, que es
 * justo la información táctica que esta tarea quiere dar. Además los 7
 * samples que ya existen en public/assets/audio/ son mono 44.1k: esto los
 * iguala en vez de introducir una segunda convención.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ASIGNACION, PACK_IDS, clasificarCarpeta, medirAutomatch, type PackId } from './lib/weapon-sounds.ts'

/** Subcarpeta con una carpeta por arma, dentro de cada pack extraído. */
const RAIZ_DE_ARMAS: Record<PackId, string> = {
  m9k: 'sound/weapons',
  mwclassic: 'sound/weapons/arc9',
  blackops: 'sound/weapons/arc9',
}

interface Formato {
  readonly ext: string
  /** Frecuencia de salida, en Hz. Se declara acá y no como ajuste global
   *  porque libopus SÓLO acepta 48 kHz (ver abajo). */
  readonly hz: number
  readonly args: readonly string[]
}

/**
 * Opus a 96 kbps mono es transparente para un transitorio corto y deja cada
 * disparo en ~5 KB. AAC queda como salida alternativa por si hace falta
 * servir a un Safari viejo: Safari recién soporta Opus-en-Ogg desde 18.4,
 * mientras que AAC en .m4a lo decodifica cualquier navegador desde siempre.
 */
const FORMATOS: Record<string, Formato> = {
  // Opus SIEMPRE trabaja a 48 kHz: libopus rechaza cualquier otra frecuencia,
  // así que la frecuencia es parte del formato y no un ajuste global. No es
  // una pérdida frente a los 44.1 kHz de origen: `decodeAudioData` remuestrea
  // a la frecuencia del AudioContext igual, venga como venga.
  opus: { ext: 'ogg', hz: 48000, args: ['-c:a', 'libopus', '-b:a', '96k', '-ar', '48000'] },
  aac: { ext: 'm4a', hz: 44100, args: ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100'] },
}

interface Opciones {
  readonly raw: string
  readonly out: string
  readonly formato: Formato
  readonly dryRun: boolean
  readonly limite: number
}

function parsear(argv: readonly string[]): Opciones {
  let raw = 'workshop-assets/sounds-raw'
  let out = 'workshop-assets/weapon-sounds'
  let formato = 'opus'
  let dryRun = false
  let limite = Number.POSITIVE_INFINITY

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--dry-run') dryRun = true
    else if (a === '--raw') raw = argv[(i += 1)] ?? raw
    else if (a === '--out') out = argv[(i += 1)] ?? out
    else if (a === '--formato') formato = argv[(i += 1)] ?? formato
    else if (a === '--limite') limite = Number(argv[(i += 1)])
    else throw new Error(`flag desconocida: ${a}`)
  }

  const f = FORMATOS[formato]
  if (f === undefined) throw new Error(`--formato debe ser ${Object.keys(FORMATOS).join('|')}`)
  if (!Number.isFinite(limite) && limite !== Number.POSITIVE_INFINITY) throw new Error('--limite no numérico')
  return { raw, out, formato: f, dryRun, limite }
}

interface Disparo {
  readonly ruta: string
  /** SHA-1 del contenido. Dedup: los packs reusan el mismo asset entre armas
   *  y hasta dentro de una misma arma (sg552-1..4 son byte a byte iguales),
   *  así que contar archivos sobrestima las variantes reales. */
  readonly hash: string
}

/** Recorre los packs extraídos y devuelve, por fuente, sus disparos únicos. */
function inventariar(raw: string): Map<string, Disparo[]> {
  const inv = new Map<string, Disparo[]>()

  for (const pack of PACK_IDS) {
    const base = join(raw, pack)
    if (!existsSync(base)) {
      console.warn(`  aviso: falta el pack "${pack}" en ${base}; se omite`)
      continue
    }
    const raiz = join(base, RAIZ_DE_ARMAS[pack])
    if (!existsSync(raiz)) continue

    for (const dir of readdirSync(raiz)) {
      const carpeta = join(raiz, dir)
      if (!statSync(carpeta).isDirectory()) continue

      for (const [arma, archivos] of clasificarCarpeta(pack, dir, readdirSync(carpeta))) {
        const id = `${pack}__${arma}`
        for (const archivo of archivos) {
          const ruta = join(carpeta, archivo)
          const hash = createHash('sha1').update(readFileSync(ruta)).digest('hex')
          const previos = inv.get(id) ?? []
          // Dedup dentro de la fuente: dos archivos idénticos no son dos
          // variantes, y emitirlos duplicaría bytes sin agregar información.
          if (previos.some((d) => d.hash === hash)) continue
          previos.push({ ruta, hash })
          inv.set(id, previos)
        }
      }
    }
  }

  for (const [, ds] of inv) ds.sort((a, b) => a.ruta.localeCompare(b.ruta))
  return inv
}

interface EntradaIndice {
  readonly fuente: string
  readonly variantes: string[]
}

function main(): void {
  const opciones = parsear(process.argv.slice(2))

  if (!opciones.dryRun) {
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    } catch {
      throw new Error('ffmpeg no está disponible en el PATH; instalalo o usá --dry-run')
    }
  }

  console.log(`inventariando ${opciones.raw} ...`)
  const inventario = inventariar(opciones.raw)
  const totalDisparos = [...inventario.values()].reduce((n, d) => n + d.length, 0)
  console.log(`  ${inventario.size} fuentes con disparo, ${totalDisparos} disparos únicos\n`)

  const slugs = Object.keys(ASIGNACION)
  const fuentesUsadas = [...new Set(Object.values(ASIGNACION))]
  const faltantes = fuentesUsadas.filter((f) => !inventario.has(f))
  if (faltantes.length > 0) {
    // Falla fuerte: una fuente asignada que no existe es una tabla podrida,
    // y seguir dejaría armas mudas sin que nadie se entere.
    throw new Error(`fuentes asignadas sin disparo en el inventario: ${faltantes.join(', ')}`)
  }

  if (!opciones.dryRun) {
    rmSync(opciones.out, { recursive: true, force: true })
    mkdirSync(opciones.out, { recursive: true })
  }

  // Se transcodifica UNA vez por fuente, no por slug: las seis `_scopeless`
  // comparten fuente con su arma con mira y no deben duplicar bytes.
  const salidaPorFuente = new Map<string, string[]>()
  let hechas = 0
  for (const fuente of fuentesUsadas.sort()) {
    if (hechas >= opciones.limite) break
    const disparos = inventario.get(fuente) ?? []
    const rutas: string[] = []

    for (const [i, d] of disparos.entries()) {
      const nombre = `${fuente}/disparo-${i + 1}.${opciones.formato.ext}`
      rutas.push(nombre)
      if (opciones.dryRun) continue
      const destino = join(opciones.out, nombre)
      mkdirSync(join(opciones.out, fuente), { recursive: true })
      execFileSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-i', d.ruta, '-ac', '1', ...opciones.formato.args, destino],
        { stdio: 'inherit' },
      )
    }
    salidaPorFuente.set(fuente, rutas)
    hechas += 1
    if (!opciones.dryRun) process.stdout.write(`\r  transcodificadas ${hechas}/${fuentesUsadas.length} fuentes`)
  }
  if (!opciones.dryRun) process.stdout.write('\n\n')

  const armas: Record<string, EntradaIndice> = {}
  for (const slug of slugs) {
    const fuente = ASIGNACION[slug]
    armas[slug] = { fuente, variantes: salidaPorFuente.get(fuente) ?? [] }
  }

  const indice = {
    generadoPor: 'scripts/prepare-weapon-sounds.ts',
    formato: `${opciones.formato.ext} (mono ${opciones.formato.hz} Hz)`,
    packs: {
      m9k: '2169649722 M9k Remastered',
      mwclassic: '2926739280 [ARC9] Modern Warfare Classic',
      blackops: '2926734724 [ARC9] Black Ops Classic',
    },
    armas,
  }
  if (!opciones.dryRun) {
    writeFileSync(join(opciones.out, 'index.json'), `${JSON.stringify(indice, null, 2)}\n`)
  }

  // --- Informe de cobertura ---
  const conVariantes = slugs.map((s) => armas[s].variantes.length)
  const hist = new Map<number, number>()
  for (const n of conVariantes) hist.set(n, (hist.get(n) ?? 0) + 1)

  console.log('=== COBERTURA ===')
  console.log(`armas de nuestro catálogo:      ${slugs.length}`)
  console.log(`armas con al menos un disparo:  ${conVariantes.filter((n) => n > 0).length}`)
  console.log(`fuentes distintas usadas:       ${fuentesUsadas.length}`)
  console.log(
    `variantes por arma:             ${[...hist]
      .sort((a, b) => a[0] - b[0])
      .map(([n, c]) => `${n}v:${c}`)
      .join('  ')}`,
  )

  const auto = medirAutomatch(slugs, [...inventario.keys()])
  console.log(
    `\nmapeo automático por nombre:    ${auto.length}/${slugs.length} armas ` +
      `(${Math.round((100 * auto.length) / slugs.length)}%). El resto necesita la tabla a mano.`,
  )

  if (!opciones.dryRun) {
    let bytes = 0
    const pila = [opciones.out]
    while (pila.length > 0) {
      const d = pila.pop() as string
      for (const e of readdirSync(d)) {
        const p = join(d, e)
        const st = statSync(p)
        if (st.isDirectory()) pila.push(p)
        else bytes += st.size
      }
    }
    console.log(`\npeso total de la salida:        ${(bytes / 1e6).toFixed(1)} MB en ${opciones.out}`)
  }
}

main()
