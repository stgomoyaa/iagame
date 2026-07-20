/**
 * `ProgressStore`: la costura de persistencia de la progresión (sección 3 del
 * spec, límites entre módulos: "`progression` es matemática pura detrás de
 * una interfaz `ProgressStore`. Implementación actual: `localStorage`.
 * Cambiarla por Neon después no toca la lógica").
 *
 * La interfaz es deliberadamente tonta: lee un blob, escribe un blob. Toda
 * la lógica (qué loadout es válido, qué arma está desbloqueada, qué skin sale
 * de una seed) vive en funciones puras de este módulo y no sabe nada de
 * dónde se guarda. Una implementación contra un backend sólo tiene que
 * devolver y aceptar el mismo `ProgressData`; la lógica del juego no se
 * entera.
 *
 * Se guardan **seeds, no skins**. Una skin es una función pura de su seed
 * (skins/generator.ts), así que persistir la seed alcanza y el guardado pesa
 * unos pocos bytes por skin en vez de un objeto de parámetros. Es también lo
 * que hace que el determinismo del generador sea un requisito real y no una
 * propiedad linda: si el generador cambiara de resultado, todas las skins
 * guardadas cambiarían de aspecto al recargar.
 */

import { defaultLoadout, normalizeLoadout, type Loadout } from '@/game/progression/loadout'
import { levelForXp, NIVEL_INICIAL } from '@/game/progression/unlocks'
import { createDefaultCareer, type CareerData } from '@/game/progression/career'
import { createPlacementState, PLACEMENT, type PlacementState } from '@/game/progression/placement'
import { RANK_MAX, RANK_MIN, RR_MAXIMO } from '@/game/progression/ranks'
import { RR, type RankState } from '@/game/progression/rr'
import { XP_ARMA_MAESTRIA } from '@/game/progression/weapon-xp'

/**
 * Versión del formato guardado. Si cambia la forma de `ProgressData`, sube
 * este número y `load()` descarta lo viejo en vez de intentar interpretarlo.
 *
 * v2 (fase 4): suma rango, RR, colocaciones y contadores de partidas. Se
 * descarta el guardado v1 en vez de migrarlo: lo único que se pierde son
 * unas skins de arranque y un loadout que se rearma solo, y no vale la pena
 * mantener un camino de migración para eso.
 */
export const PROGRESS_VERSION = 2

export const PROGRESS_STORAGE_KEY = 'iagame:progreso'

export interface ProgressData {
  version: number
  /** XP acumulada. El nivel se deriva de acá (unlocks.ts, `levelForXp`). */
  xp: number
  /** Seeds de las skins del inventario. */
  skins: string[]
  loadout: Loadout
  /** Posición en la escalera, o null si el jugador todavía está en
   *  colocaciones (progression/ranks.ts y rr.ts). */
  rank: RankState | null
  placement: PlacementState
  /** Partidas terminadas, colocaciones incluidas. */
  partidasJugadas: number
  victorias: number
  derrotas: number
  /**
   * XP acumulada por arma, por slug (progression/weapon-xp.ts). El nivel de
   * cada arma se deriva de acá, y los camos de maestría se derivan del
   * nivel: no se guarda ninguna recompensa, sólo este número.
   *
   * CAMPO ADITIVO: se agregó SIN subir `PROGRESS_VERSION` a propósito. Subir
   * la versión haría que `parseProgress` descartara todos los guardados
   * existentes, y un jugador perdería su rango y su inventario por estrenar
   * una capa nueva. Un guardado viejo no trae este campo, `leerArmas` lo cae
   * a `{}`, y el jugador simplemente arranca con todas las armas en nivel 1,
   * que es exactamente lo que era cierto hasta ahora.
   *
   * **Sólo se guardan las armas USADAS**, no las 148 con cero. Ver
   * `leerArmas`.
   */
  armas: Record<string, number>
}

/**
 * Inventario inicial. Ocho seeds fijas elegidas ejecutando el generador
 * sobre `inicial:N`, que cubren las cinco rarezas, **las seis familias de
 * camuflaje y las cuatro animaciones**.
 *
 * Es contenido de arranque, no el sistema de drops: los drops por partida
 * son fase 4 (sección 9 del spec). Hasta que existan, esto es lo que hace
 * que la armería tenga algo que mostrar y que las cinco rarezas se puedan
 * comparar de un vistazo, que es la única forma de saber si el generador
 * está haciendo bien su trabajo.
 *
 *
 * POR QUÉ SE CAMBIARON LAS SEEDS, Y POR QUÉ ES UN ARREGLO DE REPARTO
 *
 * El set anterior se eligió antes de que existieran las seis familias de
 * camuflaje, así que las ignoraba: de sus ocho seeds, **siete caían en
 * `clasico`** y una sola (`inicial:8`) mostraba una familia. Con eso, un
 * jugador nuevo tenía las seis familias construidas y compiladas en el
 * shader y podía ver exactamente UNA. Es la explicación de "veo siempre los
 * mismos camos": no era que los camuflajes fueran malos, era que el
 * inventario de arranque no los mostraba.
 *
 * Lo mismo con las animaciones: seis de las ocho anteriores eran
 * `ninguna`, así que `pulso`, `flujo` y `espectro` casi no se veían.
 *
 * Las seis familias no son alcanzables desde cualquier rareza (ver
 * camo-families.ts): multicam y follaje viven en los tiers sin emisivo, y
 * gema, filigrana, damasco y cebra en los altos. Común no puede tener
 * familia —su lista de patrones no incluye `camo`—, así que las dos comunes
 * son necesariamente clásicas y las otras seis cubren una familia cada una.
 *
 * NO se tocó el generador. Cambiar una seed no cambia lo que devuelve
 * ninguna otra, así que las skins ya guardadas en localStorage siguen
 * siendo exactamente las mismas: esto sólo afecta a un jugador nuevo.
 */
export const SKINS_INICIALES: readonly string[] = [
  'inicial:2', // Grafito Liso — Común · clásico
  'inicial:3', // Nocturno Liso — Común · clásico
  'inicial:52', // Turquesa Mimético — Raro · multicam
  'inicial:6', // Cobalto Mimético — Raro · follaje
  'inicial:136', // Cian Fracturado — Épico · gema · pulso
  'inicial:116', // Coral Hidrográfico — Épico · filigrana · pulso
  'inicial:29', // Sangre Real Hidrográfico — Legendario · damasco · flujo
  'inicial:397', // Antimateria Degradado — Exótico · cebra · espectro
]

export function createDefaultProgress(): ProgressData {
  const carrera = createDefaultCareer()
  return {
    version: PROGRESS_VERSION,
    xp: 0,
    skins: [...SKINS_INICIALES],
    loadout: defaultLoadout(NIVEL_INICIAL),
    rank: carrera.rank,
    placement: carrera.placement,
    partidasJugadas: 0,
    victorias: 0,
    derrotas: 0,
    armas: {},
  }
}

export interface ProgressStore {
  load(): ProgressData
  save(data: ProgressData): void
  clear(): void
}

function esArrayDeStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function leerEntrada(raw: unknown): { slug: string | null; skinSeed: string | null } {
  if (typeof raw !== 'object' || raw === null) return { slug: null, skinSeed: null }
  const obj = raw as Record<string, unknown>
  return {
    slug: typeof obj.slug === 'string' ? obj.slug : null,
    skinSeed: typeof obj.skinSeed === 'string' ? obj.skinSeed : null,
  }
}

function numeroSeguro(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Lee un `RankState` de un blob desconocido. Devuelve null (= todavía en
 *  colocaciones) ante cualquier cosa que no sea un rango entendible, que es
 *  el estado seguro: un rango inventado por un guardado corrupto pondría al
 *  jugador contra bots que no le corresponden. */
function leerRank(raw: unknown): RankState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.rank !== 'number' || !Number.isFinite(obj.rank)) return null
  return {
    rank: clamp(Math.floor(obj.rank), RANK_MIN, RANK_MAX),
    rr: clamp(Math.floor(numeroSeguro(obj.rr, 0)), 0, RR_MAXIMO),
    cushion: clamp(numeroSeguro(obj.cushion, RR.colchon), 0, RR.colchon),
  }
}

function leerPlacement(raw: unknown): PlacementState {
  if (typeof raw !== 'object' || raw === null) return createPlacementState()
  const obj = raw as Record<string, unknown>
  return {
    played: clamp(Math.floor(numeroSeguro(obj.played, 0)), 0, PLACEMENT.partidas),
    skill: clamp(numeroSeguro(obj.skill, PLACEMENT.skillInicial), 0, 1),
  }
}

/**
 * Lee el mapa de XP por arma de un blob desconocido.
 *
 * Se descartan entradas en vez de rechazar el mapa entero: si una sola clave
 * quedó corrupta, perder el nivel de ESA arma es mucho mejor que perder el
 * de las otras 147. Es el mismo criterio defensivo del resto del archivo,
 * aplicado por entrada.
 *
 * El valor se topea en `XP_ARMA_MAESTRIA` porque el nivel satura ahí de
 * todas formas: así un guardado editado a mano no puede meter un número
 * absurdo, y cada entrada ocupa a lo sumo cuatro dígitos.
 */
function leerArmas(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const armas: Record<string, number> = {}
  for (const slug of Object.keys(obj)) {
    const v = obj[slug]
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
    armas[slug] = Math.min(XP_ARMA_MAESTRIA, Math.floor(v))
  }
  return armas
}

/**
 * Interpreta lo que salió del almacenamiento. Todo lo que llega es `unknown`
 * a propósito: localStorage lo puede haber escrito una versión anterior del
 * juego, otra pestaña, o el propio usuario desde la consola. Nada de lo que
 * venga de ahí puede dejar al juego sin arma ni tirar una excepción en el
 * arranque, así que cada campo se valida y cae a su default.
 */
export function parseProgress(raw: unknown): ProgressData {
  const base = createDefaultProgress()
  if (typeof raw !== 'object' || raw === null) return base

  const obj = raw as Record<string, unknown>
  if (obj.version !== PROGRESS_VERSION) return base

  const xp = typeof obj.xp === 'number' && Number.isFinite(obj.xp) && obj.xp >= 0 ? obj.xp : 0
  const skins = esArrayDeStrings(obj.skins) ? obj.skins : [...SKINS_INICIALES]

  const loadoutRaw = (typeof obj.loadout === 'object' && obj.loadout !== null
    ? obj.loadout
    : {}) as Record<string, unknown>
  const loadout: Loadout = {
    primary: leerEntrada(loadoutRaw.primary),
    secondary: leerEntrada(loadoutRaw.secondary),
  }

  return {
    version: PROGRESS_VERSION,
    xp,
    skins,
    loadout: normalizeLoadout(loadout, levelForXp(xp), skins),
    rank: leerRank(obj.rank),
    placement: leerPlacement(obj.placement),
    partidasJugadas: Math.max(0, Math.floor(numeroSeguro(obj.partidasJugadas, 0))),
    victorias: Math.max(0, Math.floor(numeroSeguro(obj.victorias, 0))),
    derrotas: Math.max(0, Math.floor(numeroSeguro(obj.derrotas, 0))),
    armas: leerArmas(obj.armas),
  }
}

/**
 * Devuelve un guardado nuevo con la XP por arma actualizada. Va aparte de
 * `progressWithCareer` porque la XP de arma NO es parte de la carrera: no
 * toca rango, RR ni colocaciones, y el llamador puede persistir una sin la
 * otra.
 */
export function progressWithWeaponXp(
  data: ProgressData,
  armas: Record<string, number>,
): ProgressData {
  return { ...data, armas }
}

/**
 * Vista de carrera del guardado. `career.ts` trabaja con `CareerData`, un
 * subconjunto sin loadout ni versión, para no arrastrar el blob entero a la
 * matemática de rangos ni a la simulación.
 */
export function careerFromProgress(data: ProgressData): CareerData {
  return {
    rank: data.rank,
    placement: data.placement,
    partidasJugadas: data.partidasJugadas,
    victorias: data.victorias,
    derrotas: data.derrotas,
    xp: data.xp,
    skins: data.skins,
  }
}

/**
 * Devuelve un guardado nuevo con la carrera actualizada. El loadout se
 * renormaliza porque subir de nivel puede haber desbloqueado armas y el drop
 * agrega una skin al inventario: los dos cambian qué es un loadout válido.
 */
export function progressWithCareer(data: ProgressData, career: CareerData): ProgressData {
  return {
    ...data,
    version: PROGRESS_VERSION,
    xp: career.xp,
    skins: career.skins,
    rank: career.rank,
    placement: career.placement,
    partidasJugadas: career.partidasJugadas,
    victorias: career.victorias,
    derrotas: career.derrotas,
    loadout: normalizeLoadout(data.loadout, levelForXp(career.xp), career.skins),
  }
}

/**
 * Implementación en memoria. Es la que usan los tests, y también el fallback
 * cuando localStorage no está disponible (modo privado, cookies bloqueadas):
 * en ese caso la progresión no sobrevive a la recarga, pero el juego arranca,
 * que es la prioridad correcta.
 */
export function createMemoryProgressStore(initial?: ProgressData): ProgressStore {
  let data: ProgressData = initial ?? createDefaultProgress()
  return {
    load: () => data,
    save: (next) => {
      data = next
    },
    clear: () => {
      data = createDefaultProgress()
    },
  }
}

/** Implementación actual: `localStorage`. */
export function createLocalStorageProgressStore(): ProgressStore {
  return {
    load(): ProgressData {
      try {
        const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
        if (raw === null) return createDefaultProgress()
        return parseProgress(JSON.parse(raw))
      } catch {
        // JSON corrupto o almacenamiento bloqueado. Una progresión perdida
        // no vale una pantalla en blanco (mismo criterio que el mapa
        // recordado en game.ts).
        return createDefaultProgress()
      }
    },

    save(data: ProgressData): void {
      try {
        window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(data))
      } catch {
        // Cuota llena o almacenamiento bloqueado: se pierde el guardado, no
        // la partida.
      }
    },

    clear(): void {
      try {
        window.localStorage.removeItem(PROGRESS_STORAGE_KEY)
      } catch {
        // Nada que hacer.
      }
    },
  }
}

/**
 * Store por defecto del juego. Devuelve el de memoria si no hay `window`
 * (render en servidor de Next) o si localStorage tira al tocarlo.
 */
export function createProgressStore(): ProgressStore {
  if (typeof window === 'undefined') return createMemoryProgressStore()
  try {
    window.localStorage.getItem(PROGRESS_STORAGE_KEY)
  } catch {
    return createMemoryProgressStore()
  }
  return createLocalStorageProgressStore()
}

/** Nivel de cuenta actual, derivado de la XP guardada. */
export function accountLevel(data: ProgressData): number {
  return levelForXp(data.xp)
}
