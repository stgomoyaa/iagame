/**
 * Extractor de archivos .gma (addons empaquetados de Garry's Mod).
 *
 *   node scripts/gma-extract.ts <archivo.gma> <dir_salida> [--only .mdl,.vvd,.vtx]
 *
 * El formato es simple y está documentado, así que no dependemos de `gmad`,
 * que viene con el cliente de Garry's Mod y no está disponible acá.
 *
 * Estructura:
 *   char[4]  "GMAD"
 *   uint8    versión (3)
 *   uint64   steamid
 *   uint64   timestamp
 *   string[] contenido requerido, termina con string vacío (versión > 1)
 *   string   nombre
 *   string   descripción (JSON)
 *   string   autor
 *   int32    versión del addon
 *   índice de archivos, repetido hasta fileNumber == 0:
 *     uint32   fileNumber
 *     string   nombre de archivo
 *     int64    tamaño
 *     uint32   crc
 *   después, el contenido de cada archivo concatenado en el mismo orden
 *
 * Todos los strings son terminados en cero.
 *
 * IMPORTANTE: lo que se extrae de acá es contenido del Workshop y no puede
 * salir de esta máquina. El destino tiene que estar dentro de la carpeta
 * gitignoreada; hay un test que falla si alguno de estos archivos aparece
 * trackeado en git.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

interface EntradaIndice {
  nombre: string
  tamano: number
}

/** Lee un string terminado en cero desde `pos`. Devuelve el valor y la nueva posición. */
function leerString(buf: Buffer, pos: number): [string, number] {
  const fin = buf.indexOf(0, pos)
  if (fin === -1) throw new Error(`string sin terminador en offset ${pos}`)
  return [buf.toString('utf8', pos, fin), fin + 1]
}

export interface GmaLeido {
  nombre: string
  autor: string
  entradas: EntradaIndice[]
  /** Offset donde arranca el contenido concatenado. */
  inicioDatos: number
}

export function leerIndice(buf: Buffer): GmaLeido {
  if (buf.toString('ascii', 0, 4) !== 'GMAD') throw new Error('no es un archivo GMAD')
  const version = buf.readUInt8(4)
  if (version < 1 || version > 3) throw new Error(`versión de GMA no soportada: ${version}`)

  let pos = 5
  pos += 8 // steamid
  pos += 8 // timestamp

  // Contenido requerido: lista de strings que termina con uno vacío.
  if (version > 1) {
    for (;;) {
      const [req, siguiente] = leerString(buf, pos)
      pos = siguiente
      if (req === '') break
    }
  }

  const [nombre, p1] = leerString(buf, pos)
  const [, p2] = leerString(buf, p1) // descripción, no la usamos
  const [autor, p3] = leerString(buf, p2)
  pos = p3
  pos += 4 // versión del addon

  const entradas: EntradaIndice[] = []
  for (;;) {
    const fileNumber = buf.readUInt32LE(pos)
    pos += 4
    if (fileNumber === 0) break
    const [nombreArchivo, siguiente] = leerString(buf, pos)
    pos = siguiente
    const tamano = Number(buf.readBigInt64LE(pos))
    pos += 8
    pos += 4 // crc
    entradas.push({ nombre: nombreArchivo, tamano })
  }

  return { nombre, autor, entradas, inicioDatos: pos }
}

function main(): void {
  const args = process.argv.slice(2)
  const posicionales = args.filter((a) => !a.startsWith('--'))
  if (posicionales.length < 2) {
    console.error('uso: node scripts/gma-extract.ts <archivo.gma> <dir_salida> [--only .mdl,.vvd]')
    process.exit(2)
  }

  const [rutaGma, dirSalida] = posicionales
  const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)
    ?? (args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined)
  const filtros = only ? only.split(',').map((s) => s.trim().toLowerCase()) : null

  if (!existsSync(rutaGma)) {
    console.error(`no existe: ${rutaGma}`)
    process.exit(2)
  }

  const buf = readFileSync(rutaGma)
  const { nombre, autor, entradas, inicioDatos } = leerIndice(buf)

  console.log(`addon:    ${nombre}`)
  console.log(`autor:    ${autor}`)
  console.log(`archivos: ${entradas.length}`)

  let offset = inicioDatos
  let escritos = 0
  let bytesEscritos = 0
  const porExtension = new Map<string, number>()

  for (const entrada of entradas) {
    const ext = entrada.nombre.slice(entrada.nombre.lastIndexOf('.')).toLowerCase()
    porExtension.set(ext, (porExtension.get(ext) ?? 0) + 1)

    const pasa = !filtros || filtros.includes(ext)
    if (pasa) {
      const destino = resolve(join(dirSalida, entrada.nombre))
      mkdirSync(dirname(destino), { recursive: true })
      writeFileSync(destino, buf.subarray(offset, offset + entrada.tamano))
      escritos++
      bytesEscritos += entrada.tamano
    }
    offset += entrada.tamano
  }

  console.log('')
  console.log('por extensión:')
  const orden = [...porExtension.entries()].sort((a, b) => b[1] - a[1])
  for (const [ext, n] of orden.slice(0, 12)) console.log(`  ${ext.padEnd(8)} ${n}`)

  console.log('')
  console.log(`extraídos: ${escritos} (${(bytesEscritos / 1048576).toFixed(1)} MB) en ${dirSalida}`)
}

if (process.argv[1]?.endsWith('gma-extract.ts')) main()
