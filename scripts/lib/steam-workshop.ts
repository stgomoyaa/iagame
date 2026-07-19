/**
 * Contrato de la Web API de Steam para el catalogador del Workshop de GMod.
 *
 * Endpoint: GET https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/
 *
 * Verificado contra fuentes públicas de Valve (no hace falta key para leerlas):
 *   - Parámetros de request: documentación oficial de Steamworks
 *     (partner.steamgames.com/doc/webapi/IPublishedFileService) y el espejo
 *     machine-readable de esa misma definición en
 *     SteamDatabase/SteamTracking (API/IPublishedFileService.json).
 *   - Forma de la respuesta (total, next_cursor, publishedfiledetails,
 *     vote_data) y los tipos de cada campo: definiciones .proto reales de
 *     Valve espejadas en SteamDatabase/SteamTracking
 *     (Protobufs/steammessages_publishedfile.steamclient.proto).
 *   - Valores numéricos del enum EPublishedFileQueryType: SteamKit
 *     (SteamRE/SteamKit, Resources/SteamLanguage/enums.steamd).
 *
 * Detalle de qué se verificó dónde: ver el reporte de esta tarea en
 * .superpowers/sdd/workshop-catalog-report.md y docs/WORKSHOP.md.
 */

export const GMOD_APPID = 4000

/**
 * EPublishedFileQueryType.k_PublishedFileQueryType_RankedByTextSearch.
 * Es el query_type correcto cuando se filtra por `search_text`: rankea por
 * relevancia del texto buscado. Verificado en SteamKit (enums.steamd).
 */
const QUERY_TYPE_RANKED_BY_TEXT_SEARCH = 12

export const QUERY_FILES_ENDPOINT = 'https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/'

/** Techo de páginas por término de búsqueda: salvaguarda contra un bug de paginación que nunca corta. */
export const MAX_PAGES_PER_TERM = 50

export const DEFAULT_NUM_PER_PAGE = 100

export interface Thresholds {
  minScore: number
  minVotes: number
  minSubscribers: number
}

/**
 * Defaults pedidos: subscribers es la señal más honesta (nadie se suscribe
 * a un addon roto), por eso el umbral de subscribers pesa más que el de
 * score con pocos votos.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  minScore: 0.8,
  minVotes: 50,
  minSubscribers: 2000,
}

/** Una fila del catálogo, ya validada y lista para CSV/JSON. */
export interface CatalogEntry {
  id: string
  title: string
  /** SteamID64 del creador. QueryFiles no devuelve el nombre para mostrar (personaname); resolverlo requeriría un segundo llamado a ISteamUser/GetPlayerSummaries, fuera del alcance de este catalogador. */
  author: string
  subscribers: number
  favourites: number
  score: number
  votesUp: number
  votesDown: number
  fileSizeBytes: number
  tags: string[]
  createdAt: string
  updatedAt: string
  url: string
}

export interface QueryFilesRequestOptions {
  searchText: string
  tags: string[]
  matchAllTags: boolean
  cursor: string
  numPerPage: number
}

/**
 * Arma los query params de un request a QueryFiles.
 *
 * La key va acá porque la API de Steam la exige como query param (no hay
 * forma de pasarla por header en este endpoint). Quien llama a esta función
 * es responsable de no loguear ni el URLSearchParams resultante ni la URL
 * final: ver `redactApiKey`.
 */
export function buildQueryFilesParams(
  apiKey: string,
  opts: QueryFilesRequestOptions,
): URLSearchParams {
  const params = new URLSearchParams()
  params.set('key', apiKey)
  params.set('query_type', String(QUERY_TYPE_RANKED_BY_TEXT_SEARCH))
  params.set('appid', String(GMOD_APPID))
  params.set('search_text', opts.searchText)
  params.set('cursor', opts.cursor)
  params.set('numperpage', String(opts.numPerPage))
  // Sin return_details, la API sólo devuelve datos parciales de votación
  // (documentado así en el propio spec de Valve). return_vote_data y
  // return_tags son necesarios además porque no están incluidos por
  // default aunque return_details esté en true.
  params.set('return_details', 'true')
  params.set('return_vote_data', 'true')
  params.set('return_tags', 'true')

  if (opts.tags.length > 0) {
    // Confirmado contra una implementación real (steam-workshop-api, crate
    // de Rust): requiredtags va como un único string separado por comas,
    // no como requiredtags[0]=.., requiredtags[1]=..
    params.set('requiredtags', opts.tags.join(','))
    params.set('match_all_tags', opts.matchAllTags ? 'true' : 'false')
  }

  return params
}

/** Redacta el valor de `key` de una URL o querystring antes de loguearla. Nunca imprimir la key, ni un prefijo de ella. */
export function redactApiKey(urlOrQuery: string): string {
  return urlOrQuery.replace(/([?&]key=)[^&]*/i, '$1***')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Los campos uint64 (publishedfileid, creator, file_size) llegan como
 * string en el JSON de Steam: es el mapeo canónico de protobuf a JSON para
 * int64/uint64 (no entran seguros en un `number` de JS). Se acepta también
 * `number` de forma defensiva por si algún campo llega chico y sin comillas.
 */
function parseUint64(value: unknown, field: string): string {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return String(Math.trunc(value))
  }
  throw new Error(
    `respuesta de Steam con forma inesperada: ${field} debía ser un entero de 64 bits (string o number), llegó ${JSON.stringify(value)}`,
  )
}

/** Campos uint32 (subscriptions, votos, timestamps): en protobuf-JSON quedan como number. */
function parseUint32(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  throw new Error(
    `respuesta de Steam con forma inesperada: ${field} debía ser un entero, llegó ${JSON.stringify(value)}`,
  )
}

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags: string[] = []
  for (const item of value) {
    if (isRecord(item) && typeof item['tag'] === 'string') tags.push(item['tag'])
  }
  return tags
}

function isoFromUnixSeconds(seconds: number): string {
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : ''
}

/**
 * Valida y convierte un elemento crudo de `publishedfiledetails` a
 * `CatalogEntry`. Nunca castea: cada campo se narrowea desde `unknown`.
 * Tira si falta o tiene forma inválida algo indispensable (publishedfileid);
 * para el resto, usa un default razonable en vez de abortar todo el lote
 * por un campo secundario ausente.
 */
export function parsePublishedFileDetails(raw: unknown, index: number): CatalogEntry {
  if (!isRecord(raw)) {
    throw new Error(`respuesta de Steam con forma inesperada: publishedfiledetails[${index}] no es un objeto`)
  }

  const id = parseUint64(raw['publishedfileid'], `publishedfiledetails[${index}].publishedfileid`)

  const creatorRaw = raw['creator']
  const author =
    typeof creatorRaw === 'string' || typeof creatorRaw === 'number'
      ? parseUint64(creatorRaw, `publishedfiledetails[${index}].creator`)
      : ''

  const title = typeof raw['title'] === 'string' ? raw['title'] : '(sin título)'
  const subscribers = parseUint32(raw['subscriptions'] ?? 0, `publishedfiledetails[${index}].subscriptions`)
  const favourites = parseUint32(raw['favorited'] ?? 0, `publishedfiledetails[${index}].favorited`)
  const fileSizeBytes =
    raw['file_size'] !== undefined
      ? Number(parseUint64(raw['file_size'], `publishedfiledetails[${index}].file_size`))
      : 0
  const createdAt = isoFromUnixSeconds(
    parseUint32(raw['time_created'] ?? 0, `publishedfiledetails[${index}].time_created`),
  )
  const updatedAt = isoFromUnixSeconds(
    parseUint32(raw['time_updated'] ?? 0, `publishedfiledetails[${index}].time_updated`),
  )

  const voteData = raw['vote_data']
  let score = 0
  let votesUp = 0
  let votesDown = 0
  if (isRecord(voteData)) {
    score = typeof voteData['score'] === 'number' ? voteData['score'] : 0
    votesUp = parseUint32(voteData['votes_up'] ?? 0, `publishedfiledetails[${index}].vote_data.votes_up`)
    votesDown = parseUint32(voteData['votes_down'] ?? 0, `publishedfiledetails[${index}].vote_data.votes_down`)
  }

  return {
    id,
    title,
    author,
    subscribers,
    favourites,
    score,
    votesUp,
    votesDown,
    fileSizeBytes,
    tags: parseTags(raw['tags']),
    createdAt,
    updatedAt,
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
  }
}

export interface QueryFilesPage {
  total: number
  entries: CatalogEntry[]
  /** undefined cuando no hay más páginas. */
  nextCursor: string | undefined
}

/**
 * Valida la forma completa de una respuesta de QueryFiles y la convierte a
 * `QueryFilesPage`. Tira con un mensaje legible ante cualquier forma que no
 * coincida con el contrato documentado, en vez de devolver un catálogo
 * parcial que aparente estar completo.
 */
export function parseQueryFilesResponse(json: unknown): QueryFilesPage {
  if (!isRecord(json)) {
    throw new Error('respuesta de Steam con forma inesperada: el body no es un objeto JSON')
  }

  const response = json['response']
  if (!isRecord(response)) {
    throw new Error('respuesta de Steam con forma inesperada: falta el campo "response"')
  }

  const total = parseUint32(response['total'] ?? 0, 'response.total')

  const rawDetails = response['publishedfiledetails']
  const detailsArray = Array.isArray(rawDetails) ? rawDetails : []
  const entries = detailsArray.map((item, i) => parsePublishedFileDetails(item, i))

  const nextCursorRaw = response['next_cursor']
  const nextCursor = typeof nextCursorRaw === 'string' && nextCursorRaw.length > 0 ? nextCursorRaw : undefined

  return { total, entries, nextCursor }
}

/** Total de votos = arriba + abajo. Es el número contra el que se compara `minVotes`. */
export function totalVotes(entry: CatalogEntry): number {
  return entry.votesUp + entry.votesDown
}

/** Aplica los tres umbrales independientes. Los tres tienen que cumplirse. */
export function meetsThresholds(entry: CatalogEntry, thresholds: Thresholds): boolean {
  return (
    entry.score >= thresholds.minScore &&
    totalVotes(entry) >= thresholds.minVotes &&
    entry.subscribers >= thresholds.minSubscribers
  )
}
