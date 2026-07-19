/**
 * Parseo de argumentos de línea de comandos del catalogador del Workshop.
 *
 * Uso:
 *   node scripts/workshop-catalog.ts "mw2019" "css weapons" "arccw" \
 *     --tags Weapon --min-subs 5000
 *
 * Cualquier argumento que no empiece con "--" es un término de búsqueda.
 * Deliberadamente no acepta la API key como argumento: sólo sale de
 * process.env.STEAM_API_KEY (ver scripts/workshop-catalog.ts), así nunca
 * queda en el historial de la shell.
 */

// Extensión explícita: Node resuelve ESM nativo y la exige. Vitest resuelve
// sin ella, así que omitirla deja los tests en verde y el script roto (ver
// el mismo comentario en scripts/convert-weapons.ts).
import { DEFAULT_THRESHOLDS, type Thresholds } from './steam-workshop.ts'

export interface ParsedArgs {
  terms: string[]
  tags: string[]
  matchAllTags: boolean
  thresholds: Thresholds
}

const FLAGS_WITH_VALUE = new Set(['--tags', '--min-score', '--min-votes', '--min-subs'])

function parseNumberFlag(raw: string, flag: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error(`valor inválido para ${flag}: "${raw}" no es un número`)
  }
  return n
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const terms: string[] = []
  const tags: string[] = []
  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS }
  let matchAllTags = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (!arg.startsWith('--')) {
      terms.push(arg)
      continue
    }

    if (arg === '--match-all-tags') {
      matchAllTags = true
      continue
    }

    if (!FLAGS_WITH_VALUE.has(arg)) {
      throw new Error(`flag desconocido: ${arg}`)
    }

    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} necesita un valor`)
    }
    i++

    switch (arg) {
      case '--tags':
        for (const t of value.split(',').map((s) => s.trim())) {
          if (t.length > 0) tags.push(t)
        }
        break
      case '--min-score':
        thresholds.minScore = parseNumberFlag(value, arg)
        break
      case '--min-votes':
        thresholds.minVotes = parseNumberFlag(value, arg)
        break
      case '--min-subs':
        thresholds.minSubscribers = parseNumberFlag(value, arg)
        break
    }
  }

  return { terms, tags, matchAllTags, thresholds }
}
