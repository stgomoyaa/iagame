/**
 * Catálogo de medallas de gesta: la única capa de progresión que paga **en
 * el momento del acto** y no al terminar la partida.
 *
 * Este archivo es dato puro -- qué medallas existen, cómo se llaman, cuánto
 * pagan y de dónde sale su icono. La DETECCIÓN vive en
 * `match/medal-tracker.ts`, que es quien conoce el reloj de partida, los
 * equipos y quién mató a quién. La separación es la misma que ya usan
 * `combat-score.ts` (matemática) y `match/scoring.ts` (quién llama y
 * cuándo): acá no hay estado, no hay ventanas de tiempo y no hay nada que
 * pueda salir mal en el camino de frame.
 *
 *
 * POR QUÉ SON QUINCE Y NO CUARENTA
 *
 * La progresión por capas de Call of Duty funciona porque toda acción
 * alimenta alguna barra. Pero está calibrada contra cientos de horas de
 * contenido, y este juego tiene 148 armas y 4 mapas. Copiar la densidad de
 * recompensas sin el volumen detrás agota el sistema en una tarde, y una
 * galería completa que ya no sube desmotiva más que una que nunca existió.
 *
 * De ahí sale la forma del set: **quince medallas repetibles y ninguna
 * "colección" que se pueda terminar**. Una medalla acá no se desbloquea una
 * vez y queda tildada -- se cuenta. El contador de "Headshot" en 340 sigue
 * significando algo a las cien horas; una casilla marcada, no.
 *
 *
 * DÓNDE VIVE CADA COSA (contrato con la UI)
 *
 * - **En la partida**: `MedalAward` del anillo del tracker, que la UI
 *   consume igual que el killfeed (`listActiveAwardsNewestFirst`).
 * - **Al terminar**: `MedalTally` -- `slug -> veces` de esa partida sola.
 * - **Para siempre**: `ProgressData.medallas`, otro `MedalTally`, acumulado
 *   sobre todas las partidas (progression/store.ts).
 *
 * Los iconos son `public/assets/ui/256/medalla-<slug>.png` y `.../64/...`.
 * Los slugs de acá abajo SON esos nombres de archivo: cambiar uno rompe una
 * imagen, así que se tratan como formato de datos, no como texto editable.
 */

/** Índice de una medalla dentro de `CATALOGO_MEDALLAS`. Se usa como id
 *  numérico en el camino caliente para que el tracker nunca tenga que tocar
 *  un string mientras corre la partida. */
export type MedalId = number

export interface MedalDef {
  /** Índice propio dentro del catálogo. Redundante con la posición del
   *  array a propósito: deja pasar la definición sola sin arrastrar el
   *  índice aparte. */
  readonly id: MedalId
  /** kebab-case. Es a la vez la clave de persistencia y el nombre del
   *  archivo del icono. */
  readonly slug: string
  readonly nombre: string
  /** Qué hiciste para ganarla, en una línea, como la lee el jugador. */
  readonly descripcion: string
  /**
   * XP de cuenta que paga cada vez. Alimenta el NIVEL DE CUENTA (cuánto
   * jugaste) y jamás el RANGO (qué tan bien jugás) -- ver el comentario de
   * cabecera de progression/xp.ts sobre por qué esas dos escaleras no se
   * cruzan. Una medalla que moviera el RR haría que el rango dejara de
   * medir habilidad relativa.
   *
   * Los valores están escalados contra lo que ya paga una partida (~2500 a
   * 4000 XP, progression/xp.ts): una tanda típica de medallas suma del
   * orden de 400-600 XP, un 15% arriba. Alcanza para que se note en la
   * barra y no tanto como para que farmear medallas sea mejor que jugar.
   */
  readonly xp: number
}

/**
 * Las quince. El orden es el de la galería y NO se reordena: `MedalId` es
 * el índice y el tracker lo usa como índice de array.
 *
 * "Invicto de ronda" no está y no es un olvido: pedía rondas, y este juego
 * no tiene rondas -- TDM y FFA con reloj y límite de puntaje, con respawn a
 * los 3 segundos. Una "ronda" tendría que inventarse sólo para sostener una
 * medalla, que es exactamente al revés de como se diseña esto. Su lugar lo
 * toma `dominacion`, que mide lo mismo que quería medir (imponerte sobre
 * alguien de forma sostenida) con los modos que sí existen.
 */
export const CATALOGO_MEDALLAS: readonly MedalDef[] = [
  {
    id: 0,
    slug: 'primera-sangre',
    nombre: 'Primera sangre',
    descripcion: 'La primera baja de la partida fue tuya.',
    xp: 150,
  },
  {
    id: 1,
    slug: 'doble-baja',
    nombre: 'Doble baja',
    descripcion: 'Dos bajas seguidas sin dejar respirar.',
    xp: 50,
  },
  {
    id: 2,
    slug: 'triple-baja',
    nombre: 'Triple baja',
    descripcion: 'Tres bajas en la misma andanada.',
    xp: 100,
  },
  {
    id: 3,
    slug: 'masacre',
    nombre: 'Masacre',
    descripcion: 'Cuatro o más bajas sin cortar el ritmo.',
    xp: 200,
  },
  {
    id: 4,
    slug: 'headshot',
    nombre: 'Headshot',
    descripcion: 'Baja limpia a la cabeza.',
    xp: 25,
  },
  {
    id: 5,
    slug: 'racha-de-5',
    nombre: 'Racha de 5',
    descripcion: 'Cinco bajas sin morir.',
    xp: 150,
  },
  {
    id: 6,
    slug: 'racha-de-10',
    nombre: 'Racha de 10',
    descripcion: 'Diez bajas sin morir.',
    xp: 400,
  },
  {
    id: 7,
    slug: 'clutch',
    nombre: 'Clutch',
    descripcion: 'Con la vida en rojo, diste vuelta el duelo que venías perdiendo.',
    xp: 250,
  },
  {
    id: 8,
    slug: 'venganza',
    nombre: 'Venganza',
    descripcion: 'Cobraste la cuenta con quien te acababa de matar.',
    xp: 75,
  },
  {
    id: 9,
    slug: 'salvada',
    nombre: 'Salvada',
    descripcion: 'Bajaste al que estaba castigando a un compañero.',
    xp: 100,
  },
  {
    id: 10,
    slug: 'tiro-largo',
    nombre: 'Tiro largo',
    descripcion: 'Baja desde el otro lado del mapa.',
    xp: 100,
  },
  {
    id: 11,
    slug: 'a-quemarropa',
    nombre: 'A quemarropa',
    descripcion: 'Baja tan de cerca que se sintió en la cara.',
    xp: 75,
  },
  {
    id: 12,
    slug: 'ultima-bala',
    nombre: 'Última bala',
    descripcion: 'La última del cargador fue la que contó.',
    xp: 125,
  },
  {
    id: 13,
    slug: 'sin-morir',
    nombre: 'Sin morir',
    descripcion: 'Un minuto entero en pie, y peleando.',
    xp: 500,
  },
  {
    id: 14,
    slug: 'dominacion',
    nombre: 'Dominación',
    descripcion: 'Tres bajas sobre el mismo rival sin que te devolviera ninguna.',
    xp: 150,
  },
]

/** Ids con nombre, para que el tracker no dependa de índices mágicos. Los
 *  tests verifican que cada uno apunta al slug que dice. */
export const MEDALLA = {
  primeraSangre: 0,
  dobleBaja: 1,
  tripleBaja: 2,
  masacre: 3,
  headshot: 4,
  rachaDe5: 5,
  rachaDe10: 6,
  clutch: 7,
  venganza: 8,
  salvada: 9,
  tiroLargo: 10,
  aQuemarropa: 11,
  ultimaBala: 12,
  sinMorir: 13,
  dominacion: 14,
} as const

export const MEDALLAS_TOTALES = CATALOGO_MEDALLAS.length

/** Definición por id, o `null` si el id no existe (un guardado viejo con un
 *  slug que ya no está, por ejemplo). Nunca tira. */
export function medalById(id: MedalId): MedalDef | null {
  return CATALOGO_MEDALLAS[id] ?? null
}

/** Definición por slug, o `null`. Lineal a propósito: quince entradas, y se
 *  llama desde la UI o al cargar el guardado, nunca en el camino de frame. */
export function medalBySlug(slug: string): MedalDef | null {
  for (const def of CATALOGO_MEDALLAS) if (def.slug === slug) return def
  return null
}

/**
 * Ruta del icono. Los dos tamaños existen porque el aviso en pantalla y la
 * galería no piden lo mismo: 64 para el aviso que aparece y se va, 256 para
 * la ficha de la galería.
 */
export function medalIconPath(slug: string, size: 64 | 256 = 64): string {
  return `/assets/ui/${size}/medalla-${slug}.png`
}

/**
 * Cuántas veces se ganó cada medalla, por slug. Es la forma que viaja al
 * guardado y a la UI. Se indexa por SLUG y no por id porque es lo que se
 * persiste: si algún día se reordena el catálogo, un guardado con ids
 * numéricos quedaría apuntando a medallas equivocadas y uno con slugs no.
 */
export type MedalTally = Readonly<Record<string, number>>

export function emptyTally(): MedalTally {
  return {}
}

/**
 * Suma dos conteos. Se usa al cerrar la partida: el acumulado histórico del
 * guardado más lo que se ganó recién. Ignora slugs que no están en el
 * catálogo -- un guardado editado a mano no puede inventar medallas.
 */
export function sumarTallies(a: MedalTally, b: MedalTally): MedalTally {
  const out: Record<string, number> = {}
  for (const def of CATALOGO_MEDALLAS) {
    const total = (a[def.slug] ?? 0) + (b[def.slug] ?? 0)
    if (total > 0) out[def.slug] = total
  }
  return out
}

/**
 * Lee un conteo de un blob desconocido (localStorage). Mismo criterio
 * defensivo que el resto de progression/store.ts: cualquier cosa rara cae a
 * su default en vez de romper. Se descartan slugs desconocidos, valores no
 * numéricos, negativos y no enteros.
 */
export function parseTally(raw: unknown): MedalTally {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const def of CATALOGO_MEDALLAS) {
    const v = obj[def.slug]
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
    out[def.slug] = Math.floor(v)
  }
  return out
}

/** Total de medallas ganadas, de todos los tipos. */
export function totalMedallas(tally: MedalTally): number {
  let total = 0
  for (const def of CATALOGO_MEDALLAS) total += tally[def.slug] ?? 0
  return total
}

/**
 * XP de cuenta que paga un conteo de medallas. Pura: no sabe de rangos ni
 * de partidas, sólo suma el `xp` del catálogo por cada vez.
 */
export function xpDeMedallas(tally: MedalTally): number {
  let total = 0
  for (const def of CATALOGO_MEDALLAS) total += def.xp * (tally[def.slug] ?? 0)
  return total
}
