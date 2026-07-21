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

import {
  defaultLoadout,
  normalizeLoadout,
  type Loadout,
  type LoadoutEntry,
} from '@/game/progression/loadout'
import { levelForXp, NIVEL_INICIAL, NIVEL_MAXIMO, xpParaNivel } from '@/game/progression/unlocks'
import {
  createDefaultPrestige,
  PRESTIGIO_MAX,
  type PrestigeData,
} from '@/game/progression/prestige'
import { createDefaultCareer, type CareerData } from '@/game/progression/career'
import { createPlacementState, PLACEMENT, type PlacementState } from '@/game/progression/placement'
import { HISTORIAL_MAX, type MatchHistoryEntry } from '@/game/progression/history'
import { RANK_MAX, RANK_MIN, RR_MAXIMO } from '@/game/progression/ranks'
import { RR, type RankState } from '@/game/progression/rr'
import { XP_ARMA_MAESTRIA } from '@/game/progression/weapon-xp'
import { emptyTally, parseTally, sumarTallies, type MedalTally } from '@/game/progression/medals'

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

/**
 * Generación de la CURVA de XP con la que se escribió el guardado. Nada que
 * ver con `PROGRESS_VERSION`, y esa diferencia es todo el punto:
 *
 * - `PROGRESS_VERSION` cambia cuando cambia la FORMA del guardado, y subirlo
 *   TIRA lo viejo (ver `parseProgress`).
 * - `curvaXp` cambia cuando cambia el SIGNIFICADO de un campo que sigue
 *   estando, y se MIGRA.
 *
 * Acá pasó lo segundo: la forma no cambió (sigue habiendo un número `xp`),
 * pero 30.000 XP ya no quieren decir el mismo nivel que antes. Subir la
 * versión habría sido el camino fácil y habría borrado la carrera de
 * cualquiera que ya estuviera jugando, que es exactamente lo que no se puede
 * hacer.
 *
 * 0 = curva lineal de 1200 XP por nivel (la que no escribía este campo).
 * 1 = curva cuadrática con techo 55 (unlocks.ts).
 */
export const CURVA_XP_ACTUAL = 1

/**
 * XP por nivel de la curva 0. Se conserva sólo para poder leer un guardado
 * viejo: es la constante con la que ESE guardado calculó su nivel, así que
 * borrarla no simplificaría nada, haría imposible la migración.
 */
const XP_POR_NIVEL_CURVA_0 = 1200

export interface ProgressData {
  version: number
  /** Ver `CURVA_XP_ACTUAL`. Un guardado sin este campo es de la curva 0. */
  curvaXp: number
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
   * Últimas partidas, la más reciente primero (progression/history.ts).
   *
   * NO sube `PROGRESS_VERSION` aunque agregue un campo, y es a propósito:
   * subir la versión hace que `parseProgress` descarte el guardado entero
   * (ver más abajo), o sea que agregar el historial le borraría a un jugador
   * su rango, su nivel y sus skins. Un campo que **falta** se lee como `[]`,
   * que es exactamente lo que corresponde a un guardado anterior al
   * historial: no tenía ninguna partida registrada. Un guardado v2 viejo
   * sigue cargando entero.
   */
  historial: MatchHistoryEntry[]
  /**
   * XP acumulada por arma, por slug (progression/weapon-xp.ts). El nivel de
   * cada arma se deriva de acá, y los camos de maestría se derivan del
   * nivel: no se guarda ninguna recompensa, sólo este número.
   *
   * Mismo criterio aditivo que `historial`, y por el mismo motivo: un
   * guardado viejo no trae este campo, `leerArmas` lo cae a `{}`, y el
   * jugador arranca con todas las armas en nivel 1 — que es exactamente lo
   * que era cierto hasta ahora.
   *
   * **Sólo se guardan las armas USADAS**, no las 148 con cero. Ver
   * `leerArmas`.
   */
  armas: Record<string, number>
  /**
   * Medallas de gesta acumuladas de toda la carrera, `slug -> veces`
   * (progression/medals.ts). Es aditivo sobre el formato v2: un guardado
   * escrito antes de que existieran las medallas no trae este campo, y
   * `parseProgress` lo completa con `{}` -- no hace falta subir
   * PROGRESS_VERSION ni descartar el guardado, porque no hay nada viejo que
   * reinterpretar mal. Ese es el patrón para todo lo que se agregue después:
   * campo nuevo con default, nunca un cambio de forma de lo que ya estaba.
   */
  medallas: MedalTally
  /** Cuántas veces prestigió (prestige.ts). */
  prestigio: number
  /** Armas que las fichas de prestigio dejaron desbloqueadas para siempre. */
  desbloqueosPermanentes: string[]
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
  const prestigio = createDefaultPrestige()
  return {
    version: PROGRESS_VERSION,
    curvaXp: CURVA_XP_ACTUAL,
    xp: 0,
    skins: [...SKINS_INICIALES],
    loadout: defaultLoadout(NIVEL_INICIAL),
    rank: carrera.rank,
    placement: carrera.placement,
    partidasJugadas: 0,
    victorias: 0,
    derrotas: 0,
    historial: [],
    armas: {},
    medallas: emptyTally(),
    prestigio: prestigio.prestigio,
    desbloqueosPermanentes: prestigio.desbloqueosPermanentes,
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

function leerEntrada(raw: unknown): LoadoutEntry {
  if (typeof raw !== 'object' || raw === null)
    return { slug: null, skinSeed: null, camoId: null, opticId: null }
  const obj = raw as Record<string, unknown>
  return {
    slug: typeof obj.slug === 'string' ? obj.slug : null,
    skinSeed: typeof obj.skinSeed === 'string' ? obj.skinSeed : null,
    // `camoId` se agregó después de v2 y es aditivo, mismo criterio que
    // `historial`/`armas`/`medallas`: un guardado viejo no lo trae y cae a
    // null, sin subir PROGRESS_VERSION ni descartar el guardado entero. Acá
    // sólo se exige que sea un string; que el id EXISTA en el catálogo lo
    // valida `normalizeLoadout`, que corre justo después sobre este loadout.
    camoId: typeof obj.camoId === 'string' ? obj.camoId : null,
    // `opticId` es aditivo igual que `camoId`, y por el mismo motivo NO sube
    // PROGRESS_VERSION: un guardado anterior a las miras no lo trae y cae a null.
    // Sólo se exige el tipo (string); que la óptica exista en el catálogo Y que
    // el arma la soporte lo valida `normalizeLoadout`. La óptica es
    // independiente del camo, así que no compite con `camoId` por la ranura.
    opticId: typeof obj.opticId === 'string' ? obj.opticId : null,
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

/** Lee una fila del historial, o null si no es una fila entendible. */
function leerEntradaHistorial(raw: unknown): MatchHistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.partida !== 'number' || !Number.isFinite(o.partida)) return null
  return {
    partida: Math.max(0, Math.floor(o.partida)),
    fecha: Math.max(0, Math.floor(numeroSeguro(o.fecha, 0))),
    mapa: typeof o.mapa === 'string' ? o.mapa : null,
    modo: typeof o.modo === 'string' ? o.modo : null,
    win: o.win === true,
    kills: Math.max(0, Math.floor(numeroSeguro(o.kills, 0))),
    deaths: Math.max(0, Math.floor(numeroSeguro(o.deaths, 0))),
    headshots: Math.max(0, Math.floor(numeroSeguro(o.headshots, 0))),
    damage: Math.max(0, Math.round(numeroSeguro(o.damage, 0))),
    // null y 0 son distintos acá: null es "fue colocación, no hubo RR", 0 es
    // "hubo RR y no se movió". Por eso no se cae a 0 con `numeroSeguro`.
    rrChange: typeof o.rrChange === 'number' && Number.isFinite(o.rrChange)
      ? Math.round(o.rrChange)
      : null,
    rank: typeof o.rank === 'number' && Number.isFinite(o.rank)
      ? clamp(Math.floor(o.rank), RANK_MIN, RANK_MAX)
      : null,
  }
}

function leerHistorial(raw: unknown): MatchHistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const filas: MatchHistoryEntry[] = []
  for (const item of raw) {
    const fila = leerEntradaHistorial(item)
    if (fila !== null) filas.push(fila)
    if (filas.length >= HISTORIAL_MAX) break
  }
  return filas
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
 * Convierte la XP de un guardado de la curva 0 (lineal, 1200 por nivel) a la
 * curva actual.
 *
 * **Se conserva el NIVEL, no la XP.** Es la decisión importante de toda la
 * migración y va contra el reflejo de "es el mismo número, dejalo quieto":
 * la curva nueva es más cara, así que arrastrar la XP tal cual bajaría de
 * nivel a todo el que ya venía jugando —30.000 XP eran nivel 26 y pasarían a
 * ser nivel 22— y bajar de nivel BLOQUEA ARMAS que el jugador ya tenía. No
 * rompe nada (normalizeLoadout las reemplaza y el juego arranca igual), pero
 * el jugador abre la armería y le faltan armas, que es indistinguible de un
 * guardado roto.
 *
 * Convirtiendo el nivel, nadie baja nunca. Lo único que se pierde es el
 * avance parcial dentro del nivel en curso, que a lo sumo es media partida.
 *
 * El clamp al techo importa: con la curva vieja una cuenta de 60 partidas
 * andaba por el nivel 120, y ese número no existe más. Cae en 55, el techo,
 * o sea listo para prestigiar. Es la lectura correcta: esa cuenta terminó el
 * ciclo hace rato.
 */
function migrarXpDeCurva0(xpVieja: number): number {
  const nivelViejo = NIVEL_INICIAL + Math.floor(xpVieja / XP_POR_NIVEL_CURVA_0)
  return xpParaNivel(Math.min(NIVEL_MAXIMO, Math.max(NIVEL_INICIAL, nivelViejo)))
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

  const xpGuardada = typeof obj.xp === 'number' && Number.isFinite(obj.xp) && obj.xp >= 0 ? obj.xp : 0
  const curvaXp = Math.max(0, Math.floor(numeroSeguro(obj.curvaXp, 0)))
  const xp = curvaXp >= CURVA_XP_ACTUAL ? xpGuardada : migrarXpDeCurva0(xpGuardada)
  const skins = esArrayDeStrings(obj.skins) ? obj.skins : [...SKINS_INICIALES]
  const permanentes = esArrayDeStrings(obj.desbloqueosPermanentes) ? obj.desbloqueosPermanentes : []

  const loadoutRaw = (typeof obj.loadout === 'object' && obj.loadout !== null
    ? obj.loadout
    : {}) as Record<string, unknown>
  const loadout: Loadout = {
    primary: leerEntrada(loadoutRaw.primary),
    secondary: leerEntrada(loadoutRaw.secondary),
  }

  return {
    version: PROGRESS_VERSION,
    curvaXp: CURVA_XP_ACTUAL,
    xp,
    skins,
    loadout: normalizeLoadout(loadout, levelForXp(xp), skins, permanentes),
    rank: leerRank(obj.rank),
    placement: leerPlacement(obj.placement),
    partidasJugadas: Math.max(0, Math.floor(numeroSeguro(obj.partidasJugadas, 0))),
    victorias: Math.max(0, Math.floor(numeroSeguro(obj.victorias, 0))),
    derrotas: Math.max(0, Math.floor(numeroSeguro(obj.derrotas, 0))),
    historial: leerHistorial(obj.historial),
    armas: leerArmas(obj.armas),
    // Campo agregado después de v2: ausente cae a {} en vez de invalidar el
    // guardado entero (ver el comentario del campo en ProgressData).
    medallas: parseTally(obj.medallas),
    prestigio: clamp(Math.floor(numeroSeguro(obj.prestigio, 0)), 0, PRESTIGIO_MAX),
    desbloqueosPermanentes: permanentes,
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
 * Suma las medallas de una partida al acumulado histórico del guardado. Es
 * una función aparte y no un paso dentro de `progressWithCareer` porque las
 * medallas NO son parte de `CareerData`: la carrera es rango, RR y XP, y las
 * medallas son su propia capa. Mezclarlas ahí obligaría a la simulación de
 * rangos (progression/simulate.ts) a inventar medallas que no tiene, que es
 * justo el tipo de dato falso que no debe existir en este sistema.
 */
export function progressWithMedals(data: ProgressData, ganadas: MedalTally): ProgressData {
  return { ...data, medallas: sumarTallies(data.medallas, ganadas) }
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
    historial: data.historial,
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
    historial: [...career.historial],
    // Los desbloqueos permanentes entran acá y no son opcionales: son las
    // armas que las fichas de prestigio dejaron abiertas para siempre. Sin
    // pasarlas, `normalizeLoadout` las trataría como bloqueadas por nivel y
    // se las sacaría al jugador justo después de prestigiar, que es cuando
    // más importa que sigan.
    loadout: normalizeLoadout(
      data.loadout,
      levelForXp(career.xp),
      career.skins,
      data.desbloqueosPermanentes,
    ),
  }
}

/** Vista de prestigio del guardado (mismo patrón que `careerFromProgress`). */
export function prestigeFromProgress(data: ProgressData): PrestigeData {
  return {
    prestigio: data.prestigio,
    desbloqueosPermanentes: data.desbloqueosPermanentes,
    xp: data.xp,
  }
}

/**
 * Devuelve un guardado nuevo con el prestigio aplicado.
 *
 * **El `...data` de la primera línea es la garantía de la tabla de "qué se
 * mantiene", y no es un atajo de escritura.** Todo campo que este objeto no
 * nombre explícitamente sobrevive al prestigio por construcción: el rango, el
 * RR, las colocaciones, las skins, los contadores de partidas, y también los
 * campos que TODAVÍA NO EXISTEN. El XP por arma y las medallas los están
 * construyendo en paralelo y van a entrar a `ProgressData` como campos
 * nuevos; con esta forma entran ya protegidos, sin que nadie tenga que
 * acordarse de agregarlos a una lista de excepciones.
 *
 * El loadout se renormaliza porque el nivel volvió a 1: las armas que ya no
 * corresponden se reemplazan solas, salvo las permanentes, que pasan como
 * `permanentes` justamente para que sobrevivan al reinicio.
 */
export function progressWithPrestige(data: ProgressData, prestige: PrestigeData): ProgressData {
  return {
    ...data,
    version: PROGRESS_VERSION,
    curvaXp: CURVA_XP_ACTUAL,
    xp: prestige.xp,
    prestigio: prestige.prestigio,
    desbloqueosPermanentes: prestige.desbloqueosPermanentes,
    loadout: normalizeLoadout(
      data.loadout,
      levelForXp(prestige.xp),
      data.skins,
      prestige.desbloqueosPermanentes,
    ),
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
