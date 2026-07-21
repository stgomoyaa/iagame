/**
 * Convierte ópticas (miras) del pack ARC9 Modern Warfare Classic de `.mdl` a
 * GLB. Es la fase COSMÉTICA del sistema de accesorios: del pack sacamos SÓLO
 * el cuerpo de la mira; el punto rojo / la retícula la dibuja el juego por
 * código (ver `src/game/weapons/attachments/reticle.ts`), no se hornea acá.
 *
 *   node scripts/convert-opticas.ts <repo_arc9> <dir_salida> [--solo m68,eotech]
 *
 * Por qué un script propio y no `--optic` dentro de `mdl-to-glb.ts`:
 *
 * - Los modelos de óptica NO llevan prefijo `w_`/`v_`/`c_` (son `mw3_acog.mdl`,
 *   `mw3e_optic_m68.mdl`, ...), así que la búsqueda por prefijo de aquel
 *   driver no los encuentra. Acá la lista de ópticas es EXPLÍCITA: cada una es
 *   una decisión, no el resultado de barrer un directorio, porque de las 37
 *   miras del pack sólo convertimos un puñado representativo y verificable.
 * - Mantiene el conflicto de merge con el driver de armas en cero: aquel
 *   archivo lo tocan otros flujos (viewmodels, armas de COD, cuchillo).
 *
 * Reusa el MISMO script de Blender que los modelos de mundo
 * (`blender/mdl-to-glb.py`): una óptica es un prop igual que un arma sin
 * esqueleto (malla + a lo sumo pocos huesos que se descartan). El `.py` une
 * todo en `weapon_body`; para una óptica eso es exactamente el cuerpo de la
 * mira, que es lo único que queremos.
 *
 * IMPORTANTE: entrada y salida son contenido del Workshop. La salida va a
 * `workshop-assets/`, gitignoreado, y hay un guard que falla si queda
 * trackeado. Ver `docs/WORKSHOP.md`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { chooseBodygroupModels, readBodyparts } from './lib/mdl-bodyparts.ts'
import { extraerResultados } from './mdl-to-glb.ts'

const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
const SCRIPT = resolve(import.meta.dirname, 'blender/mdl-to-glb.py')

/**
 * Las ópticas a convertir. La CLAVE es el slug de salida (lo que consume el
 * juego); el VALOR es la ruta del `.mdl` dentro del repo del pack, relativa a
 * `models/weapons/arc9/atts/`.
 *
 * Elegidas por ser las más DISTINTAS entre sí y verificables de un vistazo:
 * un red dot, un holográfico, un ACOG magnificado, y variantes de época. No
 * son las 37: convertir todas de una es llenar disco antes de saber que el
 * anclaje funciona. Ampliar es agregar una línea acá y correr de nuevo.
 */
const OPTICAS: Readonly<Record<string, string>> = {
  // Red dot / reflex: Aimpoint Comp M2 (mwc_optic_aimpoint.lua). El punto rojo
  // más simple, la mira de menos riesgo para arrancar.
  optic_reddot_m68: 'mw3e_optic_m68.mdl',
  // Reflex alternativo, cuerpo distinto al M68 (mwc_optic_sureshot.lua).
  optic_reflex_mw3: 'mw3_reflex.mdl',
  // Holográfico: EOTech EXPS3 (mwc_optic_holo.lua). Ventana cuadrada grande.
  optic_holo_eotech: 'mw3_eotech.mdl',
  // Holográfico de época CoD4 (mwc_optic_holo_cod4.lua). Estética más vieja.
  optic_holo_cod4: 'cod4_eotech.mdl',
  // Magnificado: Trijicon ACOG TA31 4x (mwc_optic_acog.lua). Cuerpo de scope,
  // retícula de chevron.
  optic_acog: 'mw3_acog.mdl',
  // Magnificado híbrido: HAMR (mwc_optic_hamr.lua). Scope con red dot arriba.
  optic_hamr: 'mw3e_hamr.mdl',
}

interface Trabajo {
  mdl: string
  out: string
  keep?: readonly string[]
}

function main(): void {
  const args = process.argv.slice(2)
  const posicionales = args.filter((a) => !a.startsWith('--'))
  if (posicionales.length < 2) {
    console.error('uso: node scripts/convert-opticas.ts <repo_arc9> <dir_salida> [--solo a,b]')
    process.exit(2)
  }
  const [repo, dirSalida] = posicionales
  const attsDir = resolve(repo, 'models/weapons/arc9/atts')

  const solo = valorDeFlag(args, '--solo')?.split(',').map((s) => s.trim())

  if (!existsSync(BLENDER)) {
    console.error(`no existe Blender en ${BLENDER}`)
    process.exit(2)
  }

  const slugs = Object.keys(OPTICAS).filter((s) => !solo || solo.includes(s))
  if (slugs.length === 0) {
    console.error('ninguna óptica coincide con --solo')
    process.exit(1)
  }

  const trabajos: Trabajo[] = slugs.map((slug) => {
    const mdl = resolve(attsDir, OPTICAS[slug])
    if (!existsSync(mdl)) {
      console.error(`no existe el modelo: ${mdl}`)
      process.exit(1)
    }
    // Igual que el camino `--cod`: una óptica puede traer bodygroups (variantes
    // encimadas). `chooseBodygroupModels` resuelve cuáles conservar leyendo la
    // cabecera del `.mdl`. Si no tiene bodygroups devuelve la lista completa y
    // el filtro no borra nada.
    return { mdl, out: resolve(join(dirSalida, `${slug}.glb`)), keep: chooseBodygroupModels(readBodyparts(mdl)) }
  })

  const archivoTrabajos = join(mkdtempSync(join(tmpdir(), 'opticas-')), 'trabajos.json')
  writeFileSync(archivoTrabajos, JSON.stringify(trabajos))

  console.log(`convirtiendo ${trabajos.length} ópticas con Blender...`)
  const salida = execFileSync(
    BLENDER,
    ['--background', '--python', SCRIPT, '--', archivoTrabajos],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  const resultados = extraerResultados(salida)
  const ok = resultados.filter((r) => r.ok)
  const fallados = resultados.filter((r) => !r.ok)

  for (const r of ok) {
    const [x, y, z] = r.dims ?? [0, 0, 0]
    console.log(
      `  ${basename(r.out!).padEnd(24)} ${String(r.tris).padStart(5)} tris  ` +
        `${x}x${y}x${z}m  ${r.texturas} tex  ${((r.bytes ?? 0) / 1024).toFixed(0)}KB`,
    )
  }
  for (const r of fallados) console.log(`  FALLÓ ${basename(r.mdl)}: ${r.error}`)

  console.log('')
  console.log(`convertidas: ${ok.length}/${resultados.length} en ${dirSalida}`)
  if (fallados.length > 0) process.exitCode = 1
}

function valorDeFlag(args: string[], flag: string): string | undefined {
  const conIgual = args.find((a) => a.startsWith(`${flag}=`))
  if (conIgual) return conIgual.slice(flag.length + 1)
  const i = args.indexOf(flag)
  return i === -1 ? undefined : args[i + 1]
}

if (process.argv[1]?.endsWith('convert-opticas.ts')) main()
