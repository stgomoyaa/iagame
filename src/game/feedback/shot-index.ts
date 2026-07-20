/**
 * Índice de sonidos de disparo POR ARMA (los 79 slugs del catálogo), que es
 * el nivel de detalle que los once samples por clase de tuning.ts no pueden
 * dar. Lo produce scripts/prepare-weapon-sounds.ts a partir de tres packs
 * del Workshop; acá sólo se lee.
 *
 * POR QUÉ ES UN FETCH Y NO UN import DEL JSON
 * Mismo razonamiento exacto que weapons/registry.ts con el índice de armas
 * locales: este archivo NO está en el repo (docs/WORKSHOP.md; es contenido
 * derivado del Workshop, gitignoreado). Un `import` estático lo volvería una
 * dependencia de compilación y el build reventaría en cualquier checkout
 * limpio -- que es el caso NORMAL, no el roto. Se pide por HTTP y un 404 se
 * trata como "no hay índice local", igual que allá.
 *
 * POR QUÉ EL CURSOR VIVE ACÁ ADENTRO Y ES MUTABLE
 * 16 de las 79 armas tienen varias grabaciones del mismo disparo, y rotarlas
 * es lo que evita que el fuego sostenido suene a un bucle de una sola
 * muestra. Ese cursor tiene que sobrevivir entre disparos y avanzar SIN
 * asignar nada -- se dispara varias veces por frame y el presupuesto es cero
 * asignaciones (ver combat/allocations.test.ts). Por eso la entrada es un
 * objeto con un campo mutable en vez de devolver un índice nuevo por
 * llamada: mutar `cursor` es gratis, y no hay ningún array intermedio.
 */

/** Carpeta pública del índice y de los .ogg. Gitignoreada: ver docs/WORKSHOP.md. */
export const SHOT_INDEX_BASE = '/assets/audio/weapons-local/'

/** URL del índice. Un 404 acá es el caso NORMAL, no un error. */
const SHOT_INDEX_URL = `${SHOT_INDEX_BASE}index.json`

/**
 * Las variantes de un arma más el cursor de rotación. `variantes` son rutas
 * relativas a SHOT_INDEX_BASE, tal como las escribe el preparador
 * (`blackops__bo1_ak47/disparo-1.ogg`).
 */
export interface EntradaDisparo {
  readonly variantes: readonly string[]
  /** Próxima variante a usar. Mutable a propósito: ver el encabezado. */
  cursor: number
}

/** Índice vivo. Vacío hasta que `loadShotIndex()` resuelva -- y para siempre
 *  si no hay archivos, que es un estado válido y silencioso. */
const INDICE = new Map<string, EntradaDisparo>()

/**
 * Valida una entrada cruda del índice. Devuelve `null` si no tiene la forma
 * esperada, y quien llama la descarta.
 *
 * Mismo criterio que `parseLocalEntry` en weapons/registry.ts: este archivo
 * lo genera un script en la máquina de quien desarrolla y no pasa por el
 * repo, así que puede estar a medio escribir o ser de una versión vieja del
 * pipeline. Una entrada rota tiene que costar UN arma que suena genérica, no
 * una excepción que se lleva puesto el audio entero.
 */
function parseEntrada(raw: unknown): EntradaDisparo | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as { variantes?: unknown }
  if (!Array.isArray(e.variantes) || e.variantes.length === 0) return null

  const variantes: string[] = []
  for (const v of e.variantes) {
    if (typeof v === 'string' && v.length > 0) variantes.push(v)
  }
  if (variantes.length === 0) return null

  return { variantes, cursor: 0 }
}

/** Baja el índice por HTTP. `null` ante CUALQUIER problema: ver `loadShotIndex`. */
async function fetchShotIndex(): Promise<unknown> {
  if (typeof fetch === 'undefined') return null
  const res = await fetch(SHOT_INDEX_URL)
  if (!res.ok) return null
  return (await res.json()) as unknown
}

/** Estado de la carga: `null` si no se intentó, o la promesa en vuelo / ya
 *  resuelta. Es lo que hace que llamar dos veces no dispare dos fetch. */
let carga: Promise<number> | null = null

/**
 * Carga el índice y devuelve cuántas armas entraron. Idempotente.
 *
 * **Devolver 0 es un final feliz.** En un checkout limpio la carpeta no
 * existe, el fetch da 404 y el juego se queda con los samples por clase, que
 * SÍ están en el repo. No se loguea nada: ese build es el producto normal.
 *
 * `fetchIndex` es inyectable para los tests, que corren en Node sin servidor
 * HTTP -- misma razón y misma forma que `loadLocalWeapons` en el registry.
 */
export function loadShotIndex(
  fetchIndex: () => Promise<unknown> = fetchShotIndex,
): Promise<number> {
  if (carga) return carga

  carga = (async () => {
    let raw: unknown = null
    try {
      raw = await fetchIndex()
    } catch {
      return 0
    }
    if (typeof raw !== 'object' || raw === null) return 0
    const armas = (raw as { armas?: unknown }).armas
    if (typeof armas !== 'object' || armas === null) return 0

    let added = 0
    for (const [slug, valor] of Object.entries(armas as Record<string, unknown>)) {
      const entrada = parseEntrada(valor)
      if (!entrada) continue
      INDICE.set(slug, entrada)
      added++
    }
    return added
  })()

  return carga
}

/** Entrada de un arma, o `null` si no está en el índice (o no hay índice). */
export function entradaDisparo(slug: string): EntradaDisparo | null {
  return INDICE.get(slug) ?? null
}

/** Cuántas armas tiene el índice cargado. Para tests y diagnóstico. */
export function armasConSonidoPropio(): number {
  return INDICE.size
}

/**
 * Deja el índice como recién importado. SÓLO para tests: es un singleton de
 * módulo y, dentro de un mismo archivo de test, el que lo carga se lo dejaría
 * cargado al siguiente. Mismo motivo que `resetLocalWeaponsForTests`.
 */
export function resetShotIndexForTests(): void {
  INDICE.clear()
  carga = null
}
