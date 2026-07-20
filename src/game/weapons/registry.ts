/**
 * Registry de armas: mapea slugs de modelo (`public/assets/weapons/`) a
 * arquetipos de estadísticas (`archetypes.ts`) y guarda la configuración
 * visual por arma que define la sección 6.1 del spec (`WeaponVisual`).
 *
 * El registry no valida modelos "a mano" uno por uno: lee
 * `index.json`, que hoy tiene 14 entradas y va a crecer hasta 40 a medida
 * que la descarga se completa (sección 6.3 del spec). Un modelo sin
 * mapeo explícito en `MODEL_ARCHETYPE_MAP` no revienta el build: se le
 * infiere un arquetipo por el prefijo del slug (`inferArchetypeFromSlug`),
 * así que el registry nunca lanza por un modelo nuevo todavía sin
 * catalogar a mano.
 */

import rawIndex from '../../../public/assets/weapons/index.json'
import {
  ARCHETYPES,
  type ArchetypeId,
  type WeaponArchetype,
  type WeaponClass,
} from '@/game/weapons/archetypes'
import { SOURCE_WEAPONS_BY_SLUG, sourceWeaponDisplayName } from '@/game/weapons/source-catalog'
import {
  seedWeaponOffsets,
  type Transform,
  type WeaponIndexEntry,
  type WeaponOrigin,
} from '@/game/weapons/seed'

export type { Transform, WeaponIndexEntry, WeaponOrigin } from '@/game/weapons/seed'

/**
 * Carpeta pública de cada procedencia. La separación es la garantía FÍSICA
 * de la política de dos niveles (docs/WORKSHOP.md): `weapons-local/` está
 * gitignoreado, así que un build publicado sencillamente NO TIENE esos
 * archivos y no puede servirlos aunque alguien se equivoque. No hay ninguna
 * bandera de "publicar sí/no" que se pueda dejar mal puesta — el error
 * posible no es "se publicó lo que no correspondía" sino "faltan armas en mi
 * máquina", que se nota y no cuesta un problema legal.
 */
const ASSET_DIR: Record<WeaponOrigin, string> = {
  cc0: '/assets/weapons',
  local: '/assets/weapons-local',
}

/** URL del índice local. Un 404 acá es el caso NORMAL, no un error. */
const LOCAL_INDEX_URL = `${ASSET_DIR.local}/index.json`

/**
 * El catálogo es MUTABLE y crece: arranca con las armas CC0 (que vienen del
 * import estático de arriba, disponibles de forma sincrónica desde el primer
 * frame) y `loadLocalWeapons()` le suma las locales cuando y si existen.
 *
 * Que sea un array vivo y no un valor nuevo es deliberado, y es la mitad
 * fácil del problema: `weaponIndex()` devuelve SIEMPRE este array, así que
 * quien lo lea después de la carga ve las 79. La mitad difícil es quien lo
 * lee ANTES —un `useMemo(..., [])` de React, un `const armas = weaponIndex()`
 * al montar— y se queda con una foto de 40 para siempre. Para eso está
 * `catalogVersion()`: un contador que cambia cuando el catálogo cambia, para
 * poner como dependencia. Ya hubo un bug de esta forma exacta en este
 * proyecto (el panel de tuning fotografiaba WEAPON_REGISTRY en el mount,
 * antes de que resolviera el fetch de weapons_tuning.json, ver el comentario
 * de reload() en viewmodel/tuning-panel.ts); esta vez el contador existe
 * desde el principio.
 */
const WEAPON_INDEX: WeaponIndexEntry[] = (rawIndex as Omit<WeaponIndexEntry, 'origin'>[]).map(
  (entry) => ({ ...entry, origin: 'cc0' as const }),
)

/**
 * Configuración visual por arma (sección 6.1 del spec). `slug` identifica
 * el modelo, `archetype` es la clave en `ARCHETYPES` de donde salen las
 * estadísticas. `rotationOffset` es la corrección de orientación del
 * modelo crudo, previa a cualquier pose de hip/ads: el pipeline de
 * conversión (sección 6.3) marca `needsManualReview` en ~29% de los
 * modelos porque su heurística de detección de cañón por bounding box
 * falla en siluetas atípicas, y esos modelos necesitan esta corrección
 * antes de que hip/ads tengan sentido. Queda en {0,0,0} hasta que alguien
 * la ajuste con el panel de tuning: no hay forma de derivarla sólo del
 * bounding box, que es toda la información que trae index.json.
 */
export interface WeaponVisual {
  slug: string
  archetype: ArchetypeId
  hipOffset: Transform
  adsOffset: Transform
  rotationOffset: { rx: number; ry: number; rz: number }
  adsTime: number
  drawTime: number
  reloadTime: number
  kickMagnitude: number
  scaleAdjust: number
}

/**
 * Mapeo explícito de los modelos ya catalogados en index.json a un
 * arquetipo. La familia "assaultrifle" y "assaultrifle2" (9 modelos en
 * total) se reparte entre los 3 arquetipos de fusil para que el arsenal
 * visual no repita la misma silueta con la misma estadística; los
 * "bullpup" (compactos) van a las SMG y a AR-3 (carabina de batalla
 * compacta); "pistol" es la única familia sin ambigüedad de clase.
 * Ningún modelo actual mapea a sniper-bolt, sniper-marksman, shotgun o
 * lmg: esos packs todavía no llegaron (sección 11 del spec), y no hace
 * falta mapearlos a mano hasta que existan.
 */
const MODEL_ARCHETYPE_MAP: Record<string, ArchetypeId> = {
  'assaultrifle-1': 'ar-1',
  'assaultrifle-2': 'ar-1',
  'assaultrifle-3': 'ar-3',
  'assaultrifle-4': 'ar-2',
  'assaultrifle-5': 'ar-1',
  'assaultrifle2-1': 'ar-2',
  'assaultrifle2-2': 'ar-3',
  'assaultrifle2-3': 'ar-1',
  'assaultrifle2-4': 'ar-3',
  'bullpup-1': 'smg-1',
  'bullpup-2': 'smg-2',
  'bullpup-3': 'ar-3',
  'pistol-1': 'pistol',
  'pistol-2': 'pistol',
}

/**
 * Arquetipo por defecto para un slug que no matchea ninguna palabra clave
 * conocida. `ar-1` es el arquetipo de línea de base del arsenal (sección
 * 5 del spec lo usa como ejemplo de referencia), así que es la opción
 * menos mala cuando no hay ninguna señal en el nombre del modelo.
 */
const FALLBACK_ARCHETYPE: ArchetypeId = 'ar-1'

/**
 * Infiere un arquetipo a partir del prefijo del slug cuando no hay entrada
 * en `MODEL_ARCHETYPE_MAP`. Nunca lanza: si ninguna palabra clave
 * matchea, devuelve `FALLBACK_ARCHETYPE`. El orden de los checks importa
 * (de más específico a más genérico): "sniper" tiene que evaluarse antes
 * que "rifle" porque un slug como "sniperrifle-1" contiene ambas palabras,
 * y por la misma razón "submachinegun" tiene que evaluarse antes que
 * "machinegun": el pack CC0 trae cinco modelos "SubmachineGun_N" y con el
 * orden inverso los cinco caían en el arquetipo `lmg` (ametralladora
 * pesada), que es justo lo contrario de lo que son.
 */
export function inferArchetypeFromSlug(slug: string): ArchetypeId {
  const base = slug.toLowerCase().replace(/-\d+$/, '')

  if (/sniper|bolt/.test(base)) return 'sniper-bolt'
  if (/marksman|dmr|designated/.test(base)) return 'sniper-marksman'
  if (/shotgun|pump|scatter/.test(base)) return 'shotgun'
  if (/submachinegun|smg|pdw|subgun/.test(base)) return 'smg-1'
  if (/lmg|machinegun|minigun|belt/.test(base)) return 'lmg'
  if (/pistol|handgun|revolver|sidearm/.test(base)) return 'pistol'
  if (/burst/.test(base)) return 'ar-2'
  if (/bullpup/.test(base)) return 'smg-1'
  if (/rifle|carbine/.test(base)) return 'ar-1'

  return FALLBACK_ARCHETYPE
}

/**
 * Arquetipo mapeado explícitamente, o inferido del slug si no hay mapeo.
 *
 * El catálogo de armas derivadas de Source se consulta ANTES del inferidor
 * por slug, y no es un detalle de orden: esos slugs son nombres de archivo de
 * armas reales, y `inferArchetypeFromSlug` -que busca palabras como "rifle" o
 * "pistol"- no encuentra ninguna en "ak47" ni en "awp", así que las 39
 * caerían enteras en `FALLBACK_ARCHETYPE`. Un rifle de francotirador con
 * estadísticas de fusil de asalto no rompe nada visible; simplemente el
 * arsenal deja de tener clases.
 */
export function resolveArchetypeId(slug: string): ArchetypeId {
  const source = SOURCE_WEAPONS_BY_SLUG.get(slug)
  if (source) return source.archetype
  return MODEL_ARCHETYPE_MAP[slug] ?? inferArchetypeFromSlug(slug)
}

export function resolveArchetype(slug: string): WeaponArchetype {
  return ARCHETYPES[resolveArchetypeId(slug)]
}

/**
 * Tiempo de draw (subir el arma al equiparla) por clase. No lo fija el
 * spec como número: es una heurística de peso percibido, más lenta para
 * las clases pesadas (LMG, francotiradores) y más rápida para las
 * livianas (pistola, SMG). Punto de partida para el panel de tuning, como
 * el resto de esta configuración visual.
 */
const CLASS_DRAW_TIME: Record<WeaponClass, number> = {
  pistol: 0.2,
  smg: 0.25,
  ar: 0.3,
  marksman: 0.35,
  sniper: 0.45,
  shotgun: 0.32,
  lmg: 0.5,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * kickMagnitude escala con el daño base del arquetipo: un impacto que
 * pega más fuerte también se siente más fuerte en el viewmodel al
 * disparar. El divisor y el clamp son arbitrarios (no hay un número del
 * spec para esto) pero mantienen el rango entre "apenas se nota" (SMG,
 * ~0.45) y "kick grande" (francotirador/escopeta, ~2.8) sin que ningún
 * arquetipo se salga a un extremo absurdo.
 */
function kickMagnitudeFor(archetype: WeaponArchetype): number {
  return clamp(archetype.damage.base / 40, 0.4, 3.0)
}

function buildWeaponVisual(entry: WeaponIndexEntry): WeaponVisual {
  const archetypeId = resolveArchetypeId(entry.slug)
  const archetype = ARCHETYPES[archetypeId]
  const { hipOffset, adsOffset } = seedWeaponOffsets(entry)

  return {
    slug: entry.slug,
    archetype: archetypeId,
    hipOffset,
    adsOffset,
    rotationOffset: { rx: 0, ry: 0, rz: 0 },
    adsTime: archetype.ads.time,
    drawTime: CLASS_DRAW_TIME[archetype.class],
    reloadTime: archetype.reload.tactical,
    kickMagnitude: kickMagnitudeFor(archetype),
    scaleAdjust: 1,
  }
}

/** Todas las entradas de index.json, sin transformar. Útil para tests y para el panel de tuning. */
export function weaponIndex(): WeaponIndexEntry[] {
  return WEAPON_INDEX
}

/** Configuración visual de cada modelo catalogado, indexada por slug. */
export const WEAPON_REGISTRY: Record<string, WeaponVisual> = Object.fromEntries(
  WEAPON_INDEX.map((entry) => [entry.slug, buildWeaponVisual(entry)]),
)

export function getWeaponVisual(slug: string): WeaponVisual {
  const visual = WEAPON_REGISTRY[slug]
  if (!visual) throw new Error(`arma desconocida: "${slug}" no está en index.json`)
  return visual
}

/** Procedencia de un slug, o `null` si no está en el catálogo. */
export function weaponOrigin(slug: string): WeaponOrigin | null {
  return WEAPON_INDEX.find((e) => e.slug === slug)?.origin ?? null
}

/**
 * URL del .glb de un arma. Es la ÚNICA función que arma esa ruta: el
 * viewmodel (viewmodel/renderer.ts) y la vitrina de la armería
 * (skins/preview.ts) la usan los dos. Antes cada uno concatenaba
 * `/assets/weapons/${slug}.glb` por su cuenta, lo cual estaba bien cuando
 * había una sola carpeta y deja de estarlo con dos: un arma local pedida a
 * la carpeta CC0 da 404 y desaparece de la pantalla sin más explicación que
 * un console.error.
 *
 * Un slug desconocido cae a la carpeta CC0. No lanza: quien llama es un
 * cargador de recursos y su forma de fallar ya es el 404, con su propio
 * mensaje.
 */
export function weaponAssetUrl(slug: string): string {
  return `${ASSET_DIR[weaponOrigin(slug) ?? 'cc0']}/${slug}.glb`
}

/**
 * Contador de versión del catálogo. Arranca en 0 y sube cada vez que entran
 * armas nuevas. Sirve como dependencia de un `useMemo`/`useEffect` para que
 * nada se quede con la foto de las 40 CC0. Ver el comentario de
 * `WEAPON_INDEX`.
 */
let version = 0
export function catalogVersion(): number {
  return version
}

/** Estado de la carga local: `null` si no se intentó, o la promesa en vuelo
 *  / ya resuelta. Es lo que hace que llamar dos veces no duplique armas ni
 *  dispare dos fetch. */
let localLoad: Promise<number> | null = null

/**
 * Valida y normaliza una entrada cruda del índice local. Devuelve `null` si
 * no tiene la forma esperada, y quien llama la descarta.
 *
 * El índice local es un archivo que produce un script en la máquina de
 * quien desarrolla y que NO pasa por el repo: puede estar a medio escribir,
 * ser de una versión vieja del pipeline, o directamente ser otra cosa que
 * alguien dejó ahí. Una entrada rota tiene que costar UN arma que no
 * aparece, no una excepción en el arranque del juego que se lleva puestas
 * también a las 40 CC0.
 */
function parseLocalEntry(raw: unknown): WeaponIndexEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Record<string, unknown>
  const bounds = e.bounds as { min?: unknown; max?: unknown } | undefined
  if (typeof e.slug !== 'string' || e.slug.length === 0) return null
  if (typeof e.name !== 'string' || e.name.length === 0) return null
  if (!Array.isArray(bounds?.min) || !Array.isArray(bounds?.max)) return null
  if (bounds.min.length < 3 || bounds.max.length < 3) return null

  // El nombre mostrado lo manda el CATÁLOGO, no el índice en disco. El índice
  // local lo escribe un script en la máquina de quien desarrolla y puede ser
  // de una corrida vieja: si el nombre saliera de ahí, renombrar un arma en
  // source-catalog.ts no se vería hasta reconvertir los 39 .glb. El índice
  // aporta la geometría; el catálogo, cómo se llama.
  const source = SOURCE_WEAPONS_BY_SLUG.get(e.slug)

  return {
    slug: e.slug,
    name: source ? sourceWeaponDisplayName(source) : e.name,
    triangles: typeof e.triangles === 'number' ? e.triangles : 0,
    bounds: { min: bounds.min as number[], max: bounds.max as number[] },
    muzzleConfidence: typeof e.muzzleConfidence === 'number' ? e.muzzleConfidence : 1,
    upAxisConfidence: typeof e.upAxisConfidence === 'number' ? e.upAxisConfidence : 1,
    needsManualReview: e.needsManualReview === true,
    origin: 'local',
    ...(typeof e.sightHeight === 'number' ? { sightHeight: e.sightHeight } : {}),
    ...(typeof e.sightLateral === 'number' ? { sightLateral: e.sightLateral } : {}),
    // Sólo el `true` explícito cuenta. Un índice viejo (sin el campo) describe
    // modelos de mundo, y tratarlo como viewmodel les daría pose neutra a las
    // 39 armas: todas amontonadas en el ojo del jugador.
    ...(e.viewmodel === true ? { viewmodel: true } : {}),
  }
}

/** Baja el índice local por HTTP. Devuelve `null` ante CUALQUIER problema
 *  (404, red caída, JSON inválido): ver `loadLocalWeapons`. */
async function fetchLocalIndex(): Promise<unknown> {
  const res = await fetch(LOCAL_INDEX_URL)
  if (!res.ok) return null
  return (await res.json()) as unknown
}

/**
 * Suma al catálogo las armas locales, si están. Devuelve cuántas entraron.
 *
 * **Un 404 no es un error, es el caso esperado.** En un build publicado la
 * carpeta `weapons-local/` no existe (está gitignoreada) y el juego tiene
 * que arrancar con sus 40 armas CC0 sin un solo mensaje raro en pantalla:
 * ese build es el producto normal, no una instalación rota. Por eso no se
 * loguea nada y se devuelve 0. Lo mismo con la red caída o un JSON inválido:
 * el catálogo CC0 es siempre un estado válido para jugar.
 *
 * Es idempotente: la segunda llamada devuelve la misma promesa y no vuelve a
 * pedir nada. Varias pantallas (la armería, la partida) la llaman sin
 * coordinarse entre sí.
 *
 * `fetchIndex` es inyectable para los tests, que corren en Node sin servidor
 * HTTP. No es una abstracción de más: sin ella el único test posible del
 * camino "sí hay índice local" sería levantar un servidor, y ese test no
 * correría en `pnpm test`.
 */
export function loadLocalWeapons(
  fetchIndex: () => Promise<unknown> = fetchLocalIndex,
): Promise<number> {
  if (localLoad) return localLoad

  localLoad = (async () => {
    let raw: unknown = null
    try {
      raw = await fetchIndex()
    } catch {
      return 0
    }
    if (!Array.isArray(raw)) return 0

    let added = 0
    for (const item of raw) {
      const entry = parseLocalEntry(item)
      if (!entry) continue
      // Un slug repetido no pisa al CC0: el catálogo publicable es la
      // autoridad, lo local sólo puede sumar.
      if (WEAPON_REGISTRY[entry.slug]) continue
      WEAPON_INDEX.push(entry)
      WEAPON_REGISTRY[entry.slug] = buildWeaponVisual(entry)
      added++
    }
    if (added > 0) version++
    return added
  })()

  return localLoad
}

/**
 * Deja el catálogo como recién importado. Existe SÓLO para los tests: el
 * registry es un singleton de módulo y, dentro de un mismo archivo de test,
 * el que carga el índice local le dejaría 39 armas de más al siguiente. No
 * lo llames desde el juego — no hay ningún caso en que quitar armas del
 * catálogo en caliente tenga sentido.
 */
export function resetLocalWeaponsForTests(): void {
  for (const entry of WEAPON_INDEX) {
    if (entry.origin === 'local') delete WEAPON_REGISTRY[entry.slug]
  }
  const kept = WEAPON_INDEX.filter((e) => e.origin === 'cc0')
  WEAPON_INDEX.length = 0
  WEAPON_INDEX.push(...kept)
  localLoad = null
  version = 0
}
