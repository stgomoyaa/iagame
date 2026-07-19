/**
 * Serialización a CSV del catálogo del Workshop. Sin librería externa: es
 * una sola tabla plana, escapar comillas/comas/saltos de línea a mano es
 * más simple que sumar una dependencia.
 */

// Extensión explícita: Node resuelve ESM nativo y la exige. Vitest resuelve
// sin ella, así que omitirla deja los tests en verde y el script roto (ver
// el mismo comentario en scripts/convert-weapons.ts).
import type { CatalogEntry } from './steam-workshop.ts'

/** Orden fijo de columnas: define el header y el orden de cada fila. */
const CSV_COLUMNS = [
  'id',
  'title',
  'author',
  'subscribers',
  'favourites',
  'score',
  'votesUp',
  'votesDown',
  'fileSizeBytes',
  'tags',
  'createdAt',
  'updatedAt',
  'url',
] as const satisfies readonly (keyof CatalogEntry)[]

/** RFC 4180: entre comillas si el campo trae coma, comilla o salto de línea; las comillas internas se duplican. */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function fieldToString(value: CatalogEntry[keyof CatalogEntry]): string {
  if (Array.isArray(value)) return value.join(';')
  return String(value)
}

/** Serializa el catálogo completo a CSV, con header y terminador CRLF (RFC 4180). */
export function toCsv(entries: readonly CatalogEntry[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const entry of entries) {
    const row = CSV_COLUMNS.map((column) => escapeCsvField(fieldToString(entry[column])))
    lines.push(row.join(','))
  }
  return lines.map((line) => `${line}\r\n`).join('')
}
