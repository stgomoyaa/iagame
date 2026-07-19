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

/**
 * Versión del formato guardado. Si cambia la forma de `ProgressData`, sube
 * este número y `load()` descarta lo viejo en vez de intentar interpretarlo.
 */
export const PROGRESS_VERSION = 1

export const PROGRESS_STORAGE_KEY = 'iagame:progreso'

export interface ProgressData {
  version: number
  /** XP acumulada. El nivel se deriva de acá (unlocks.ts, `levelForXp`). */
  xp: number
  /** Seeds de las skins del inventario. */
  skins: string[]
  loadout: Loadout
}

/**
 * Inventario inicial. Ocho seeds fijas que cubren los cinco tiers, de común
 * a exótico, elegidas ejecutando el generador sobre `inicial:N`.
 *
 * Es contenido de arranque, no el sistema de drops: los drops por partida
 * son fase 4 (sección 9 del spec). Hasta que existan, esto es lo que hace
 * que la armería tenga algo que mostrar y que las cinco rarezas se puedan
 * comparar de un vistazo, que es la única forma de saber si el generador
 * está haciendo bien su trabajo.
 */
export const SKINS_INICIALES: readonly string[] = [
  'inicial:2', // Grafito Liso — Común
  'inicial:5', // Ventisca Rayado — Común
  'inicial:0', // Ciruela Rayado — Raro
  'inicial:16', // Turquesa Liso — Raro
  'inicial:4', // Tóxico Fracturado — Épico
  'inicial:26', // Solar Degradado — Épico
  'inicial:8', // Oro Negro Hidrográfico — Legendario
  'inicial:24', // Antimateria Fracturado — Exótico
]

export function createDefaultProgress(): ProgressData {
  return {
    version: PROGRESS_VERSION,
    xp: 0,
    skins: [...SKINS_INICIALES],
    loadout: defaultLoadout(NIVEL_INICIAL),
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
