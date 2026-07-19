/**
 * Fusión aditiva del catálogo del Workshop entre corridas del catalogador.
 *
 * El catalogador consulta la API por término de búsqueda y filtra por
 * umbrales, pero la curación real ("cuáles de estos packs realmente sirven")
 * pasa en varias sesiones: hoy se corre con "mw2019", mañana con "arccw". Si
 * cada corrida reescribiera el archivo de salida en vez de fusionarlo con lo
 * que ya había, cada corrida nueva borraría el trabajo de curación de las
 * anteriores. Ese exacto bug (reescribir en vez de fusionar) ya rompió el
 * índice del pipeline de conversión de armas una vez (ver
 * `scripts/lib/merge-index.ts`); esta función existe para no repetirlo acá.
 *
 * Reglas:
 *   - Una entrada de `fresh` (recién consultada) reemplaza a la entrada
 *     existente con el mismo `publishedfileid`: la corrida actual trae
 *     números de subscribers/votos más al día.
 *   - Una entrada de `existing` que no aparece en `fresh` (porque esta
 *     corrida usó otros términos de búsqueda) se conserva tal cual: a
 *     diferencia del pipeline de conversión, acá no hay archivo en disco
 *     que confirme si un item del Workshop "sigue existiendo", así que no
 *     hay política de descarte por huérfanos.
 *   - El resultado queda ordenado por subscribers descendente, que es el
 *     orden pedido para el catálogo final.
 *   - No muta `existing` ni `fresh`.
 */

// Extensión explícita: Node resuelve ESM nativo y la exige. Vitest resuelve
// sin ella, así que omitirla deja los tests en verde y el script roto (ver
// el mismo comentario en scripts/convert-weapons.ts).
import type { CatalogEntry } from './steam-workshop.ts'

export function mergeCatalog(
  existing: readonly CatalogEntry[],
  fresh: readonly CatalogEntry[],
): CatalogEntry[] {
  const byId = new Map<string, CatalogEntry>()

  for (const entry of existing) byId.set(entry.id, entry)
  for (const entry of fresh) byId.set(entry.id, entry)

  return [...byId.values()].sort((a, b) => b.subscribers - a.subscribers)
}
