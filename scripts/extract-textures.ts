/**
 * CLI: decodifica a PNG todos los materiales (.vmt + .vtf) que trae
 * empacado el pakfile de un .bsp, y escribe un index.json que mapea nombre
 * de material -> archivo PNG. Ese índice es lo que consume después la tarea
 * de integración para enganchar las texturas al GLB del mapa.
 *
 *   node scripts/extract-textures.ts <mapa.bsp> <dir_salida> [--max 1024]
 *
 * Es enteramente offline y no depende del parser de BSP (scripts/lib/bsp.ts,
 * tarea aparte en paralelo): sólo lee el lump 40 (pakfile) del .bsp, que es
 * un zip autocontenido con todos los .vmt/.vtf que el compilador empacó.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractPakfileFromBsp } from './lib/pakfile.ts'
import { extractTextures } from './lib/extract-textures.ts'

const DEFAULT_MAX_SIZE = 1024

interface CliArgs {
  bspPath: string
  outDir: string
  maxSize: number
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const positional = argv.filter((a) => !a.startsWith('--'))
  if (positional.length < 2) {
    throw new Error('uso: node scripts/extract-textures.ts <mapa.bsp> <dir_salida> [--max 1024]')
  }

  let maxSize = DEFAULT_MAX_SIZE
  const maxFlagIndex = argv.indexOf('--max')
  if (maxFlagIndex !== -1) {
    const raw = argv[maxFlagIndex + 1]
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--max inválido: "${raw}"`)
    maxSize = n
  }

  return { bspPath: positional[0], outDir: positional[1], maxSize }
}

function main(): void {
  const { bspPath, outDir, maxSize } = parseCliArgs(process.argv.slice(2))

  const bsp = readFileSync(bspPath)
  const pakfile = extractPakfileFromBsp(bsp)
  const result = extractTextures(pakfile, maxSize)

  mkdirSync(outDir, { recursive: true })

  // Varios materiales pueden compartir el mismo fileName (mismo .vtf
  // subyacente, ver caché en extractTextures): escribir dos veces el mismo
  // archivo es inofensivo pero innecesario.
  const written = new Set<string>()
  const index: Record<string, string> = {}
  for (const texture of result.textures) {
    index[texture.materialName] = texture.fileName
    if (!written.has(texture.fileName)) {
      writeFileSync(join(outDir, texture.fileName), texture.png)
      written.add(texture.fileName)
    }
  }
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)

  console.log(`materiales encontrados: ${result.materialsFound}`)
  console.log(`decodificados:          ${result.textures.length} (${written.size} archivos .png únicos)`)
  console.log(`saltados:               ${result.skipped.length}`)
  if (result.skipped.length > 0) {
    console.log('')
    for (const s of result.skipped) {
      console.log(`  - ${s.materialName}: ${s.reason}`)
    }
  }
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
