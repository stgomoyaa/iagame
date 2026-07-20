/**
 * Driver de conversión .mdl (Source/GMod) a GLB.
 *
 *   node scripts/mdl-to-glb.ts <dir_addon> <dir_salida> [--solo ak47,m4a1s] [--limite 5]
 *   node scripts/mdl-to-glb.ts <dir_addon> <dir_salida> --viewmodel
 *
 * Levanta Blender UNA vez con el script de Blender que corresponda y le pasa
 * todos los trabajos juntos: arrancar Blender cuesta unos 5 segundos y no
 * tiene sentido pagarlo por archivo.
 *
 * Hay DOS modos, porque hay dos familias de modelo en el mismo pack y sirven
 * para cosas distintas:
 *
 * - **Por defecto: modelos de MUNDO (`w_*.mdl`)** con `blender/mdl-to-glb.py`.
 *   Sólo malla, sin esqueleto. Es lo que consume el rig procedural de seis
 *   capas, y es el único camino que existe para las 40 armas CC0.
 * - **`--viewmodel`: los VIEWMODELS (`v_*.mdl`)** con
 *   `blender/vmdl-to-glb.py`. Traen esqueleto, brazos modelados y las
 *   secuencias reales de CS (recarga, draw, disparo). Es lo que hace que la
 *   recarga sea la del juego y no una imitación nuestra.
 *
 * IMPORTANTE: entrada y salida son contenido del Workshop. Viven en
 * `workshop-assets/`, que está gitignoreado, y hay un test que falla si alguno
 * queda trackeado. Ver `docs/WORKSHOP.md`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { chooseBodygroupModels, readBodyparts } from './lib/mdl-bodyparts.ts'

const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
const SCRIPT_MUNDO = resolve(import.meta.dirname, 'blender/mdl-to-glb.py')
const SCRIPT_VIEWMODEL = resolve(import.meta.dirname, 'blender/vmdl-to-glb.py')

/** Un clip de animación importado del `v_`. Sólo en modo viewmodel. */
export interface ClipImportado {
  /** Nombre canónico: `reload`, `draw`, `idle` o `fire`. */
  clip: string
  /** Cómo se llamaba en el .mdl (`ak47_reload`, `start_reload`, ...). */
  origen: string
  frames: number
  fps: number
  /** Segundos que dura el clip a su fps nativo. */
  duracion: number
}

export interface Resultado {
  mdl: string
  out?: string
  ok: boolean
  tris?: number
  partes?: number
  /** El modelo traía el cargador como malla aparte y se preservó como
   *  `weapon_mag`. Falso en revólveres y escopetas, que no tienen.
   *  Sólo en modo mundo: en el viewmodel el cargador es un HUESO, no una
   *  malla, y lo mueve la animación importada. */
  cargador?: boolean
  /** Modo viewmodel: el modelo trajo brazos modelados (`weapon_arms`). */
  brazos?: boolean
  huesos?: number
  clips?: ClipImportado[]
  tris_cuerpo?: number
  tris_brazos?: number
  dims?: [number, number, number]
  texturas?: number
  bytes?: number
  error?: string
}

/**
 * Busca recursivamente todos los `.mdl` con el prefijo dado bajo `raiz`.
 * `w_` son los modelos de mundo, `v_` los viewmodels.
 */
export function buscarModelos(raiz: string, prefijo: string): string[] {
  const encontrados: string[] = []
  const pendientes = [raiz]

  while (pendientes.length > 0) {
    const dir = pendientes.pop()!
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name)
      if (entrada.isDirectory()) {
        pendientes.push(ruta)
      } else if (entrada.name.startsWith(prefijo) && extname(entrada.name) === '.mdl') {
        encontrados.push(ruta)
      }
    }
  }

  return encontrados.sort()
}

/** Compatibilidad con el nombre viejo, que sólo sabía de modelos de mundo. */
export function buscarModelosDeMundo(raiz: string): string[] {
  return buscarModelos(raiz, 'w_')
}

/**
 * `.../rif_ak47/w_ak47.mdl` -> `ak47`, `.../rif_ak47/v_ak47.mdl` -> `ak47`.
 *
 * Los prefijos `w_` y `v_` colapsan al MISMO slug a propósito: son el mismo
 * arma vista de dos maneras, y el resto del juego (catálogo, arquetipos,
 * nombres, skins) la identifica por ese slug único. Es lo que permite que
 * cambiar de pipeline `w_` a `v_` no toque ni una fila del registry.
 *
 * `c_` (los modelos de COD, ver `--cod`) se pela igual, pero ahí NO hay
 * colisión que temer: esos archivos ya vienen con el juego adentro del nombre
 * (`c_cod4_ak47.mdl` -> `cod4_ak47`), así que el AK-47 de COD y el `ak47` de
 * CS conviven como dos slugs distintos sin que haya que renombrar nada.
 */
export function nombreDeSalida(rutaMdl: string): string {
  return basename(rutaMdl, '.mdl').replace(/^[wvc]_/, '')
}

/**
 * Aísla la línea de resultados del ruido que Blender escribe en stdout.
 * Blender imprime decenas de líneas propias; el script marca la suya.
 */
export function extraerResultados(salida: string): Resultado[] {
  const marca = 'RESULTADOS_JSON:'
  const linea = salida.split('\n').find((l) => l.startsWith(marca))
  if (!linea) throw new Error('Blender no emitió la línea de resultados')
  return JSON.parse(linea.slice(marca.length))
}

function main(): void {
  const args = process.argv.slice(2)
  const posicionales = args.filter((a) => !a.startsWith('--') && !esValorDeFlag(args, a))

  if (posicionales.length < 2) {
    console.error('uso: node scripts/mdl-to-glb.ts <dir_addon> <dir_salida> [--solo a,b] [--limite N]')
    process.exit(2)
  }

  const [dirAddon, dirSalida] = posicionales
  const viewmodel = args.includes('--viewmodel')
  // `--cod` son los `c_*.mdl` del pack de ARC9. Usan el MISMO script de
  // Blender que los `w_` (malla sola, sin esqueleto): lo único que cambia es
  // el prefijo y que hay que elegir bodygroups, porque estos modelos traen
  // varias variantes de cada pieza encimadas. Ver `keepPorTrabajo`.
  const cod = args.includes('--cod')
  if (viewmodel && cod) {
    console.error('--viewmodel y --cod son excluyentes')
    process.exit(2)
  }
  const prefijo = viewmodel ? 'v_' : cod ? 'c_' : 'w_'
  const script = viewmodel ? SCRIPT_VIEWMODEL : SCRIPT_MUNDO
  const solo = valorDeFlag(args, '--solo')?.split(',').map((s) => s.trim())
  const limite = Number(valorDeFlag(args, '--limite') ?? Infinity)

  if (!existsSync(BLENDER)) {
    console.error(`no existe Blender en ${BLENDER}`)
    process.exit(2)
  }

  let modelos = buscarModelos(dirAddon, prefijo)
  if (solo) modelos = modelos.filter((m) => solo.includes(nombreDeSalida(m)))
  modelos = modelos.slice(0, limite)

  if (modelos.length === 0) {
    console.error(`ningún ${prefijo}*.mdl coincide`)
    process.exit(1)
  }

  const trabajos = modelos.map((mdl) => ({
    mdl: resolve(mdl),
    out: resolve(join(dirSalida, `${nombreDeSalida(mdl)}.glb`)),
    // Sólo los `c_` lo necesitan. Los `w_` de CS traen una pieza por
    // bodygroup y el filtro no tendría nada que hacer, así que ni se manda:
    // `keep` ausente deja el filtro apagado del lado de Blender.
    ...(cod ? { keep: chooseBodygroupModels(readBodyparts(resolve(mdl))) } : {}),
  }))

  const archivoTrabajos = join(mkdtempSync(join(tmpdir(), 'mdl2glb-')), 'trabajos.json')
  writeFileSync(archivoTrabajos, JSON.stringify(trabajos))

  console.log(`convirtiendo ${trabajos.length} modelos con Blender (${prefijo})...`)
  const salida = execFileSync(
    BLENDER,
    ['--background', '--python', script, '--', archivoTrabajos],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  const resultados = extraerResultados(salida)
  const ok = resultados.filter((r) => r.ok)
  const fallados = resultados.filter((r) => !r.ok)

  for (const r of ok) {
    if (viewmodel) {
      const clips = (r.clips ?? []).map((c) => `${c.clip}:${c.duracion}s`).join(' ')
      console.log(
        `  ${basename(r.out!).padEnd(18)} ${String(r.tris).padStart(6)} tris ` +
          `(${r.tris_cuerpo}+${r.tris_brazos} brazos)  ${r.huesos} huesos  ` +
          `${(r.bytes! / 1024).toFixed(0)}KB  ${clips}`,
      )
      continue
    }
    const [x, y, z] = r.dims!
    console.log(
      `  ${basename(r.out!).padEnd(18)} ${String(r.tris).padStart(6)} tris  ` +
        `${x}x${y}x${z}m  ${r.texturas} tex  ${(r.bytes! / 1024).toFixed(0)}KB` +
        `${r.cargador ? '  +cargador' : ''}`,
    )
  }
  for (const r of fallados) console.log(`  FALLÓ ${basename(r.mdl)}: ${r.error}`)

  console.log('')
  console.log(`convertidos: ${ok.length}/${resultados.length} en ${dirSalida}`)
  if (viewmodel) {
    // Los dos datos que deciden si el lote sirve: sin recarga el arma no
    // cumple el motivo por el que se trajo el `v_`, y sin brazos se pierde lo
    // único que TODOS los shooters de referencia muestran y nosotros no.
    const conBrazos = ok.filter((r) => r.brazos).length
    const conRecarga = ok.filter((r) => (r.clips ?? []).some((c) => c.clip === 'reload')).length
    console.log(`con brazos:  ${conBrazos}/${ok.length}`)
    console.log(`con recarga: ${conRecarga}/${ok.length}`)
  } else {
    // Se reporta explícito porque es el dato que decide si un arma puede animar
    // la recarga con geometría o cae a la coreografía procedural sola.
    console.log(`con cargador separado: ${ok.filter((r) => r.cargador).length}/${ok.length}`)
  }
  if (fallados.length > 0) process.exitCode = 1
}

function valorDeFlag(args: string[], flag: string): string | undefined {
  const conIgual = args.find((a) => a.startsWith(`${flag}=`))
  if (conIgual) return conIgual.slice(flag.length + 1)
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

/** True si `valor` es el argumento que sigue a un flag, no un posicional. */
function esValorDeFlag(args: string[], valor: string): boolean {
  const i = args.indexOf(valor)
  return i > 0 && args[i - 1].startsWith('--') && !args[i - 1].includes('=')
}

if (process.argv[1]?.endsWith('mdl-to-glb.ts')) main()
