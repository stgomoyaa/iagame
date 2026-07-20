/**
 * Props estáticos de un .bsp de Source: los saca del mapa, convierte sus
 * modelos a GLB y deja un JSON con dónde va cada instancia.
 *
 *   node scripts/bsp-props.ts <mapa.bsp> <dir_salida>
 *
 * DÓNDE VIVEN LOS PROPS (no es donde uno esperaría)
 * -------------------------------------------------
 * Los `prop_static` NO están en el lump de entidades. vbsp los compila
 * afuera y los guarda en el GAME_LUMP (35), en el sublump `sprp`: un
 * diccionario de rutas de modelo + una lista de instancias de 64 bytes cada
 * una (versión 6). Buscarlos en el lump de entidades da CERO resultados en
 * nuketown y hace pensar que el mapa no tiene props, cuando tiene 88.
 *
 * Lo que sí está en el lump de entidades son los `prop_dynamic` (21),
 * `prop_dynamic_override` (26) y `prop_physics*`: otra cosa, fuera del
 * alcance de este script.
 *
 * LOS MODELOS NO ALCANZAN PARA TODOS
 * ----------------------------------
 * El pakfile del .bsp trae 69 `.mdl`, pero eso NO quiere decir que estén
 * los de todos los props: de los 53 modelos que pide el `sprp` de
 * nuketown, sólo 36 están completos (`.mdl` + `.vvd` + `.vtx`) adentro del
 * mapa. Los otros 17 -- los autos de de_nuke, las camionetas de de_train,
 * las cercas de props_c17, los muebles de cs_office -- son contenido de
 * CS:S/HL2 que vive en los VPK del juego, que este repo no tiene. Se
 * saltean, y el script lo reporta en vez de fallar: 51 de 88 props es
 * mucho mejor que ninguno.
 *
 * EL SKYBOX 3D
 * ------------
 * Source arma el horizonte con una maqueta a escala ubicada lejos del área
 * jugable, marcada por la entidad `sky_camera`. En nuketown esa maqueta
 * incluye un prop (`sky_base.mdl`, en x=-6272 cuando el mapa jugable vive
 * entre -1300 y 2400). Importarlo sin filtrar lo deja flotando al lado del
 * mapa como geometría real. Se filtra por posición contra la caja del área
 * jugable, no por nombre de modelo: el nombre es casualidad de este mapa y
 * la posición es lo que define un skybox 3D en cualquier mapa.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'

import {
  type Lump,
  LUMP_GAME_LUMP,
  leerLumps,
  puntoSourceAThreeMetros,
  rotacionPropSourceAThree,
} from './lib/bsp.ts'
import { extractPakfileFromBsp } from './lib/pakfile.ts'
import { extraerResultados } from './mdl-to-glb.ts'

const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'
const SCRIPT_BLENDER = resolve(import.meta.dirname, 'blender/mdl-to-glb.py')

/**
 * `StaticPropLump_t` versión 6 mide 64 bytes. Se valida contra el tamaño
 * real del sublump antes de leer nada: si un mapa trae otra versión, los
 * campos caen corridos y el resultado son props en posiciones absurdas en
 * vez de un error.
 */
const TAM_PROP_V6 = 64

export interface InstanciaProp {
  /** Índice dentro de `modelos`. */
  modelo: number
  /** Posición en metros, ejes del motor. */
  pos: [number, number, number]
  /** Rotación como cuaternión [x,y,z,w] del motor. */
  quat: [number, number, number, number]
}

export interface PropsMapa {
  /** Nombre de archivo del GLB de cada modelo, sin ruta. */
  modelos: string[]
  instancias: InstanciaProp[]
}

export interface ReporteProps {
  propsEnElMapa: number
  modelosPedidos: number
  modelosDisponibles: number
  instanciasEmitidas: number
  sinModelo: number
  enSkybox3D: number
  modelosFaltantes: string[]
}

interface PropCrudo {
  modelo: string
  origin: [number, number, number]
  angles: [number, number, number]
}

/** Sublump `sprp` del GAME_LUMP: diccionario de modelos + instancias. */
export function leerPropsEstaticos(buf: Buffer, lumps: Lump[]): PropCrudo[] {
  const lG = lumps[LUMP_GAME_LUMP]
  if (lG.largo === 0) return []

  const cantidad = buf.readInt32LE(lG.offset)
  let offset = 0
  let largo = 0
  let version = 0
  for (let i = 0; i < cantidad; i++) {
    const o = lG.offset + 4 + i * 16
    // El id viene como cuatro chars al revés ('prps' en el archivo = 'sprp').
    const id = buf.toString('ascii', o, o + 4).split('').reverse().join('')
    if (id !== 'sprp') continue
    version = buf.readUInt16LE(o + 6)
    offset = buf.readInt32LE(o + 8)
    largo = buf.readInt32LE(o + 12)
  }
  if (offset === 0) return []

  let p = offset
  const nDiccionario = buf.readInt32LE(p)
  p += 4
  const modelos: string[] = []
  for (let i = 0; i < nDiccionario; i++) {
    modelos.push(buf.toString('ascii', p, p + 128).split('\0')[0])
    p += 128
  }

  const nHojas = buf.readInt32LE(p)
  p += 4
  p += nHojas * 2

  const nProps = buf.readInt32LE(p)
  p += 4

  // Chequeo de cordura del formato: si los bytes que quedan no dan
  // exactamente el tamaño de registro que esperamos, estamos leyendo otra
  // versión y todo lo que salga de acá es basura con forma de props.
  const bytesPorProp = nProps > 0 ? (offset + largo - p) / nProps : 0
  if (nProps > 0 && bytesPorProp !== TAM_PROP_V6) {
    throw new Error(
      `sprp versión ${version}: ${bytesPorProp} bytes por prop, se esperaban ${TAM_PROP_V6}. ` +
        'Este script sólo entiende la versión 6.',
    )
  }

  const out: PropCrudo[] = []
  for (let i = 0; i < nProps; i++) {
    const o = p + i * TAM_PROP_V6
    const tipo = buf.readUInt16LE(o + 24)
    out.push({
      modelo: modelos[tipo] ?? '',
      origin: [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)],
      angles: [buf.readFloatLE(o + 12), buf.readFloatLE(o + 16), buf.readFloatLE(o + 20)],
    })
  }
  return out
}

/** `models/props/nuketown/fence_gh01.mdl` -> `props__nuketown__fence_gh01.glb` */
export function nombreGlbDeModelo(ruta: string): string {
  return `${ruta.toLowerCase().replace(/\\/g, '/').replace(/^models\//, '').replace(/\//g, '__').replace(/\.mdl$/, '')}.glb`
}

/**
 * ¿Este prop pertenece al skybox 3D?
 *
 * Se decide por posición contra la caja del área jugable (la de los spawns,
 * agrandada con margen). La maqueta del skybox está a miles de unidades del
 * mapa, así que cualquier margen razonable la separa sin riesgo de comerse
 * un prop del borde del mapa real.
 */
export function esDelSkybox3D(
  origin: readonly [number, number, number],
  jugableMin: readonly [number, number, number],
  jugableMax: readonly [number, number, number],
  margen: number,
): boolean {
  for (let eje = 0; eje < 3; eje++) {
    if (origin[eje] < jugableMin[eje] - margen) return true
    if (origin[eje] > jugableMax[eje] + margen) return true
  }
  return false
}

/** Caja de los `info_player_*`, que es la referencia de "dónde se juega". */
function cajaJugable(buf: Buffer, lumps: Lump[]): { min: [number, number, number]; max: [number, number, number] } {
  const texto = buf.toString('utf8', lumps[0].offset, lumps[0].offset + lumps[0].largo)
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const bloqueRe = /\{([^}]*)\}/g
  let bloque: RegExpExecArray | null
  while ((bloque = bloqueRe.exec(texto)) !== null) {
    if (!/"classname"\s*"info_player_/.test(bloque[1])) continue
    const o = /"origin"\s*"([^"]*)"/.exec(bloque[1])
    if (!o) continue
    const v = o[1].trim().split(/\s+/).map(Number)
    if (v.length !== 3 || v.some((n) => !Number.isFinite(n))) continue
    for (let eje = 0; eje < 3; eje++) {
      if (v[eje] < min[eje]) min[eje] = v[eje]
      if (v[eje] > max[eje]) max[eje] = v[eje]
    }
  }
  return { min, max }
}

/**
 * Margen alrededor de la caja de spawns, en unidades de Source. 4096 son
 * ~78 m: mucho más que cualquier prop de borde del mapa real (nuketown
 * entero mide 69 m) y mucho menos que los 6272 a los que está la maqueta
 * del skybox.
 */
const MARGEN_JUGABLE = 4096

export function construirProps(
  buf: Buffer,
  glbDisponible: (nombreGlb: string) => boolean,
): { props: PropsMapa; reporte: ReporteProps } {
  const { lumps } = leerLumps(buf)
  const crudos = leerPropsEstaticos(buf, lumps)
  const { min, max } = cajaJugable(buf, lumps)

  const modelos: string[] = []
  const indicePorModelo = new Map<string, number>()
  const instancias: InstanciaProp[] = []
  const faltantes = new Set<string>()
  let sinModelo = 0
  let enSkybox = 0

  for (const p of crudos) {
    if (esDelSkybox3D(p.origin, min, max, MARGEN_JUGABLE)) {
      enSkybox++
      continue
    }
    const glb = nombreGlbDeModelo(p.modelo)
    if (!glbDisponible(glb)) {
      sinModelo++
      faltantes.add(p.modelo)
      continue
    }
    let idx = indicePorModelo.get(glb)
    if (idx === undefined) {
      idx = modelos.length
      modelos.push(glb)
      indicePorModelo.set(glb, idx)
    }
    instancias.push({
      modelo: idx,
      pos: puntoSourceAThreeMetros(p.origin),
      quat: rotacionPropSourceAThree(p.angles[0], p.angles[1], p.angles[2]),
    })
  }

  const pedidos = new Set(crudos.map((p) => p.modelo)).size
  return {
    props: { modelos, instancias },
    reporte: {
      propsEnElMapa: crudos.length,
      modelosPedidos: pedidos,
      modelosDisponibles: modelos.length,
      instanciasEmitidas: instancias.length,
      sinModelo,
      enSkybox3D: enSkybox,
      modelosFaltantes: [...faltantes].sort(),
    },
  }
}

/** Extrae el pakfile del .bsp a un directorio temporal y devuelve su ruta. */
function extraerPakfile(buf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'bsp-pak-'))
  const pak = extractPakfileFromBsp(buf)
  for (const nombre of pak.entriesByNormalizedName.keys()) {
    const datos = pak.readEntry(nombre)
    if (datos === undefined) continue
    const ruta = join(dir, nombre)
    mkdirSync(dirname(ruta), { recursive: true })
    writeFileSync(ruta, datos)
  }
  return dir
}

function main(): void {
  const [rutaBsp, dirSalida] = process.argv.slice(2)
  if (!rutaBsp || !dirSalida) {
    console.error('uso: node scripts/bsp-props.ts <mapa.bsp> <dir_salida>')
    process.exit(2)
  }
  if (!existsSync(rutaBsp)) {
    console.error(`no existe: ${rutaBsp}`)
    process.exit(2)
  }
  if (!existsSync(BLENDER)) {
    console.error(`no existe Blender en ${BLENDER}`)
    process.exit(2)
  }

  const nombre = basename(rutaBsp, extname(rutaBsp))
  const buf = readFileSync(rutaBsp)
  const dirPak = extraerPakfile(buf)
  const dirModelos = join(dirSalida, `${nombre}-props`)
  mkdirSync(dirModelos, { recursive: true })

  // Un modelo se puede convertir sólo si el pakfile trae las tres piezas:
  // el .mdl (huesos y materiales), el .vvd (vértices) y algún .vtx (los
  // índices de triángulo). Con el .mdl solo, SourceIO importa una malla
  // vacía sin fallar, que es peor que saltearlo.
  const { lumps } = leerLumps(buf)
  const crudos = leerPropsEstaticos(buf, lumps)
  const pedidos = [...new Set(crudos.map((p) => p.modelo))]

  const trabajos: Array<{ mdl: string; out: string }> = []
  for (const m of pedidos) {
    const rel = m.toLowerCase().replace(/\\/g, '/')
    const mdl = join(dirPak, rel)
    const vvd = mdl.replace(/\.mdl$/, '.vvd')
    const vtx = [`${mdl.replace(/\.mdl$/, '')}.dx90.vtx`, `${mdl.replace(/\.mdl$/, '')}.dx80.vtx`]
    if (!existsSync(mdl) || !existsSync(vvd) || !vtx.some((v) => existsSync(v))) continue
    trabajos.push({ mdl, out: join(dirModelos, nombreGlbDeModelo(m)) })
  }

  if (trabajos.length > 0) {
    const archivo = join(mkdtempSync(join(tmpdir(), 'bsp-props-')), 'trabajos.json')
    writeFileSync(archivo, JSON.stringify(trabajos))
    console.log(`convirtiendo ${trabajos.length} modelos con Blender...`)
    const salida = execFileSync(BLENDER, ['--background', '--python', SCRIPT_BLENDER, '--', archivo], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const fallados = extraerResultados(salida).filter((r) => !r.ok)
    for (const r of fallados) console.log(`  FALLÓ ${basename(r.mdl)}: ${r.error}`)
  }

  const { props, reporte } = construirProps(buf, (glb) => existsSync(join(dirModelos, glb)))

  const rutaJson = join(dirSalida, `${nombre}-props.json`)
  writeFileSync(rutaJson, `${JSON.stringify(props)}\n`)

  console.log(`props estáticos en el mapa: ${reporte.propsEnElMapa}`)
  console.log(`modelos distintos pedidos:  ${reporte.modelosPedidos}`)
  console.log(`modelos convertidos:        ${reporte.modelosDisponibles}`)
  console.log(`instancias emitidas:        ${reporte.instanciasEmitidas}`)
  console.log(`descartadas (sin modelo):   ${reporte.sinModelo}`)
  console.log(`descartadas (skybox 3D):    ${reporte.enSkybox3D}`)
  if (reporte.modelosFaltantes.length > 0) {
    console.log('\nmodelos que el .bsp no empaqueta (vienen de los VPK de CS:S/HL2):')
    for (const m of reporte.modelosFaltantes) console.log(`  - ${m}`)
  }
  console.log('')
  console.log(`escrito: ${rutaJson}`)
  console.log(`escrito: ${dirModelos}/ (${reporte.modelosDisponibles} GLB)`)
}

if (process.argv[1]?.endsWith('bsp-props.ts')) main()
