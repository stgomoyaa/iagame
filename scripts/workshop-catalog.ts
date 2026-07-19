/**
 * Catalogador del Workshop de GMod para packs de armas.
 *
 *   node --env-file=.env.local scripts/workshop-catalog.ts "mw2019" "css weapons" "arccw" \
 *     --tags Weapon --min-subs 5000
 *
 * SÓLO CATALOGA. No descarga nada del Workshop: eso necesita SteamCMD y es
 * un paso futuro separado y sin construir todavía (ver docs/WORKSHOP.md).
 *
 * Qué hace:
 *   1. Corre un query a IPublishedFileService/QueryFiles por cada término
 *      de búsqueda recibido, paginando con cursor hasta agotar resultados.
 *   2. Fusiona y deduplica todos los términos por publishedfileid.
 *   3. Filtra por tres umbrales independientes (score, votos totales,
 *      subscribers). Subscribers es la señal más honesta: nadie se
 *      suscribe a un addon roto, así que pesa más que un score alto con
 *      pocos votos.
 *   4. Fusiona el resultado con el catálogo existente en disco (aditivo:
 *      no lo reescribe) y lo ordena por subscribers descendente.
 *   5. Escribe workshop-catalog.csv y workshop-catalog.json en la raíz del
 *      repo. Ambos están en .gitignore.
 *
 * La API key sale únicamente de process.env.STEAM_API_KEY. Nunca se acepta
 * como argumento (quedaría en el historial de la shell), nunca se loguea,
 * nunca se escribe en ningún archivo de salida. Los mensajes de error sólo
 * dicen si está presente o no, jamás su valor.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from './lib/cli-args.ts'
import { toCsv } from './lib/csv.ts'
import { mergeCatalog } from './lib/merge-catalog.ts'
import {
  DEFAULT_NUM_PER_PAGE,
  MAX_PAGES_PER_TERM,
  QUERY_FILES_ENDPOINT,
  buildQueryFilesParams,
  meetsThresholds,
  parseQueryFilesResponse,
  redactApiKey,
  type CatalogEntry,
} from './lib/steam-workshop.ts'

const CATALOG_JSON_PATH = join(process.cwd(), 'workshop-catalog.json')
const CATALOG_CSV_PATH = join(process.cwd(), 'workshop-catalog.csv')

/** Recorta el body de un error para el mensaje de log, sin que crezca sin límite. */
function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Trae todas las páginas de resultados para un término de búsqueda.
 * Falla ruidosamente: cualquier respuesta no-200 o con forma inesperada
 * corta la corrida entera con un error legible en vez de devolver un
 * catálogo parcial que aparente estar completo.
 */
async function fetchAllForTerm(
  apiKey: string,
  term: string,
  tags: string[],
  matchAllTags: boolean,
): Promise<CatalogEntry[]> {
  const results: CatalogEntry[] = []
  let cursor = '*'
  let previousCursor: string | undefined

  for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
    const params = buildQueryFilesParams(apiKey, {
      searchText: term,
      tags,
      matchAllTags,
      cursor,
      numPerPage: DEFAULT_NUM_PER_PAGE,
    })

    let res: Response
    try {
      res = await fetch(`${QUERY_FILES_ENDPOINT}?${params.toString()}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`no se pudo conectar a la API de Steam para "${term}": ${message}`)
    }

    if (!res.ok) {
      const body = truncate(await res.text().catch(() => ''))
      // 429/403 son los códigos típicos de rate limit o key inválida; el
      // status y el body alcanzan para diagnosticar sin necesitar la key.
      throw new Error(
        `la API de Steam respondió ${res.status} ${res.statusText} para "${term}" (${redactApiKey(res.url)}): ${body}`,
      )
    }

    let json: unknown
    try {
      json = await res.json()
    } catch {
      throw new Error(`la API de Steam devolvió una respuesta que no es JSON válido para "${term}"`)
    }

    const pageResult = parseQueryFilesResponse(json)
    results.push(...pageResult.entries)

    const nextCursor = pageResult.nextCursor
    const noMoreResults =
      pageResult.entries.length === 0 ||
      !nextCursor ||
      nextCursor === cursor ||
      nextCursor === previousCursor ||
      results.length >= pageResult.total

    if (noMoreResults || !nextCursor) break

    previousCursor = cursor
    cursor = nextCursor
  }

  return results
}

function readExistingCatalog(path: string): CatalogEntry[] {
  if (!existsSync(path)) return []
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(raw) ? (raw as CatalogEntry[]) : []
  } catch {
    console.error(`no se pudo leer ${path}, se lo trata como vacío`)
    return []
  }
}

function printMissingKeyHelp(): void {
  console.error('falta STEAM_API_KEY. Pasos:')
  console.error('  1. Conseguir una key gratis en https://steamcommunity.com/dev/apikey')
  console.error('  2. Guardarla en .env.local (STEAM_API_KEY=...), que ya está en .gitignore')
  console.error('  3. Correr el script con: node --env-file=.env.local scripts/workshop-catalog.ts ...')
  console.error('     (o exportarla a mano: export STEAM_API_KEY=... antes de correr node)')
  console.error('La key nunca se acepta como argumento de este script: quedaría en el historial de la shell.')
}

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(
      'uso: node scripts/workshop-catalog.ts "termino1" "termino2" ... [--tags TagA,TagB] [--match-all-tags] [--min-score N] [--min-votes N] [--min-subs N]',
    )
    process.exit(2)
  }

  const { terms, tags, matchAllTags, thresholds } = parsed

  if (terms.length === 0) {
    console.error('hace falta al menos un término de búsqueda.')
    console.error(
      'uso: node scripts/workshop-catalog.ts "termino1" "termino2" ... [--tags TagA,TagB] [--match-all-tags] [--min-score N] [--min-votes N] [--min-subs N]',
    )
    process.exit(2)
  }

  const apiKey = process.env.STEAM_API_KEY
  if (!apiKey || apiKey.trim().length === 0) {
    printMissingKeyHelp()
    process.exit(1)
  }

  const byId = new Map<string, CatalogEntry>()
  for (const term of terms) {
    console.log(`consultando Workshop de GMod por: "${term}"...`)
    const entries = await fetchAllForTerm(apiKey, term, tags, matchAllTags)
    for (const entry of entries) byId.set(entry.id, entry)
    console.log(`  ${entries.length} resultados`)
  }

  const all = [...byId.values()]
  const filtered = all.filter((e) => meetsThresholds(e, thresholds))
  console.log(
    `${all.length} resultados únicos entre los ${terms.length} términos, ${filtered.length} pasan los umbrales ` +
      `(score >= ${thresholds.minScore}, votos totales >= ${thresholds.minVotes}, subscribers >= ${thresholds.minSubscribers})`,
  )

  const existing = readExistingCatalog(CATALOG_JSON_PATH)
  const merged = mergeCatalog(existing, filtered)

  writeFileSync(CATALOG_JSON_PATH, `${JSON.stringify(merged, null, 2)}\n`)
  writeFileSync(CATALOG_CSV_PATH, toCsv(merged))

  console.log('')
  console.log(`catálogo actualizado: ${merged.length} entradas (antes ${existing.length})`)
  console.log(`  ${CATALOG_JSON_PATH}`)
  console.log(`  ${CATALOG_CSV_PATH}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
