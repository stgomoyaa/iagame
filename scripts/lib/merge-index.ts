/**
 * Fusión del índice de armas (`index.json`) entre corridas del pipeline de
 * conversión.
 *
 * El pipeline es idempotente para la conversión en sí (saltea los FBX cuyo
 * GLB ya existe y es más nuevo), pero eso no basta: el índice tiene que
 * reflejar el contenido completo del directorio de salida, no sólo lo que
 * se convirtió en la corrida actual. Si se reescribiera sólo con lo
 * convertido en esta ejecución, una corrida incremental (o una que falla a
 * mitad de camino) borraría del índice -y por lo tanto del registry, del
 * dropdown del panel de tuning y del arma de arranque del juego- las armas
 * que ya estaban convertidas antes y siguen teniendo su .glb en disco.
 */

export interface IndexEntry {
  slug: string
  name: string
  triangles: number
  /** Caja envolvente tras normalizar, en metros. */
  bounds: { min: [number, number, number]; max: [number, number, number] }
  /**
   * Qué tan clara fue la detección de la boca. Cerca de 0 significa que el
   * arma es casi simétrica y la orientación probablemente esté mal.
   */
  muzzleConfidence: number
  /**
   * Qué tan clara fue la detección del eje "arriba". Cerca de 0 significa
   * que la sección transversal es casi cuadrada y no queda claro cuál lado
   * es el ancho y cuál el alto.
   */
  upAxisConfidence: number
  needsManualReview: boolean
}

/**
 * Combina el índice existente en disco con las entradas producidas por
 * esta corrida.
 *
 * Reglas:
 *   - Una entrada de `fresh` (convertida en esta corrida) reemplaza a la
 *     entrada existente con el mismo slug: la corrida actual es la fuente
 *     de verdad más reciente para lo que sí convirtió.
 *   - Una entrada de `existing` que no aparece en `fresh` (un FBX salteado
 *     por ya estar convertido, o uno no tocado en esta corrida) se
 *     conserva tal cual.
 *   - Excepción: si el .glb de una entrada de `existing` ya no está en
 *     `glbsOnDisk` (se borró a mano, el slug cambió, o nunca se terminó de
 *     escribir), la entrada queda huérfana -apunta a un archivo que no
 *     existe- y se descarta en vez de conservarla. Esta función no hace
 *     I/O ni logging: quien la llama decide si avisa qué se descartó.
 *   - El resultado queda ordenado por slug, igual que antes de esta
 *     corrección.
 *
 * Esto también resuelve el caso de una corrida parcialmente fallida: los
 * archivos que fallan no llegan a `fresh` ni le quitan su slug a
 * `glbsOnDisk` (su .glb previo, si lo tenían, sigue en disco intacto), así
 * que sus entradas de `existing` se conservan sin cambios.
 */
export function mergeIndex(
  existing: readonly IndexEntry[],
  fresh: readonly IndexEntry[],
  glbsOnDisk: ReadonlySet<string>,
): IndexEntry[] {
  const bySlug = new Map<string, IndexEntry>()

  for (const entry of existing) {
    if (glbsOnDisk.has(entry.slug)) bySlug.set(entry.slug, entry)
  }
  for (const entry of fresh) {
    bySlug.set(entry.slug, entry)
  }

  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}
