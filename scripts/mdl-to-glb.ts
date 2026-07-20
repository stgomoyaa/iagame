/**
 * Driver de conversión .mdl (Source/GMod) a GLB.
 *
 *   node scripts/mdl-to-glb.ts <dir_addon> <dir_salida> [--solo ak47,m4a1s] [--limite 5]
 *
 * Levanta Blender UNA vez con `scripts/blender/mdl-to-glb.py` y le pasa todos
 * los trabajos juntos: arrancar Blender cuesta unos 5 segundos y no tiene
 * sentido pagarlo por archivo.
 *
 * Convierte los modelos de mundo (`w_*.mdl`), no los viewmodels (`v_*.mdl`):
 * el `v_` trae brazos y rig de Source, y nuestro viewmodel ya anima por código.
 * El porqué completo está en el encabezado del script de Blender.
 *
 * IMPORTANTE: entrada y salida son contenido del Workshop. Viven en
 * `workshop-assets/`, que está gitignoreado, y hay un test que falla si alguno
 * queda trackeado. Ver `docs/WORKSHOP.md`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'

const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
const SCRIPT_BLENDER = resolve(import.meta.dirname, 'blender/mdl-to-glb.py')

export interface Resultado {
  mdl: string
  out?: string
  ok: boolean
  tris?: number
  partes?: number
  dims?: [number, number, number]
  texturas?: number
  bytes?: number
  error?: string
}

/** Busca recursivamente todos los `w_*.mdl` bajo `raiz`. */
export function buscarModelosDeMundo(raiz: string): string[] {
  const encontrados: string[] = []
  const pendientes = [raiz]

  while (pendientes.length > 0) {
    const dir = pendientes.pop()!
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name)
      if (entrada.isDirectory()) {
        pendientes.push(ruta)
      } else if (entrada.name.startsWith('w_') && extname(entrada.name) === '.mdl') {
        encontrados.push(ruta)
      }
    }
  }

  return encontrados.sort()
}

/** `.../rif_ak47/w_ak47.mdl` -> `ak47` */
export function nombreDeSalida(rutaMdl: string): string {
  return basename(rutaMdl, '.mdl').replace(/^w_/, '')
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
  const solo = valorDeFlag(args, '--solo')?.split(',').map((s) => s.trim())
  const limite = Number(valorDeFlag(args, '--limite') ?? Infinity)

  if (!existsSync(BLENDER)) {
    console.error(`no existe Blender en ${BLENDER}`)
    process.exit(2)
  }

  let modelos = buscarModelosDeMundo(dirAddon)
  if (solo) modelos = modelos.filter((m) => solo.includes(nombreDeSalida(m)))
  modelos = modelos.slice(0, limite)

  if (modelos.length === 0) {
    console.error('ningún w_*.mdl coincide')
    process.exit(1)
  }

  const trabajos = modelos.map((mdl) => ({
    mdl: resolve(mdl),
    out: resolve(join(dirSalida, `${nombreDeSalida(mdl)}.glb`)),
  }))

  const archivoTrabajos = join(mkdtempSync(join(tmpdir(), 'mdl2glb-')), 'trabajos.json')
  writeFileSync(archivoTrabajos, JSON.stringify(trabajos))

  console.log(`convirtiendo ${trabajos.length} modelos con Blender...`)
  const salida = execFileSync(
    BLENDER,
    ['--background', '--python', SCRIPT_BLENDER, '--', archivoTrabajos],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  const resultados = extraerResultados(salida)
  const ok = resultados.filter((r) => r.ok)
  const fallados = resultados.filter((r) => !r.ok)

  for (const r of ok) {
    const [x, y, z] = r.dims!
    console.log(
      `  ${basename(r.out!).padEnd(18)} ${String(r.tris).padStart(6)} tris  ` +
        `${x}x${y}x${z}m  ${r.texturas} tex  ${(r.bytes! / 1024).toFixed(0)}KB`,
    )
  }
  for (const r of fallados) console.log(`  FALLÓ ${basename(r.mdl)}: ${r.error}`)

  console.log('')
  console.log(`convertidos: ${ok.length}/${resultados.length} en ${dirSalida}`)
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
