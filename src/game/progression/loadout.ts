/**
 * Loadout del jugador: un arma primaria y una secundaria (sección 6 del
 * spec), cada una con la skin equipada en esa ranura.
 *
 * Todo acá es matemática pura sobre datos: qué es un loadout válido, cuál es
 * el de una cuenta nueva y cómo se arregla uno que quedó inválido. Dónde se
 * guarda no se sabe en este archivo — eso es `ProgressStore` (store.ts).
 *
 * Un loadout guardado puede volverse inválido solo, sin que nadie lo edite:
 * el pack de armas cambia entre versiones, un slug deja de existir, o el
 * jugador tenía equipada un arma que ya no le corresponde por nivel. Por eso
 * `normalizeLoadout` no es una validación defensiva de más: es el camino
 * normal cada vez que se lee del almacenamiento.
 */

import { generateSkin } from '@/game/skins/generator'
import { CAMO_TEXTURA_POR_ID, type CamoTextura } from '@/game/skins/texturas'
import { isWeaponUnlocked, unlockedWeapons } from '@/game/progression/unlocks'
import { resolveArchetype, WEAPON_REGISTRY } from '@/game/weapons/registry'
// El catálogo de ópticas es DATO PURO (no importa three), así que la lógica de
// loadout puede leerlo para validar la mira equipada sin cruzar el borde con la
// GPU — mismo criterio con el que ya lee el catálogo de camos (texturas.ts).
import {
  armaPuedeMontarOptica,
  OPTICAS,
  type OpticaDef,
} from '@/game/weapons/attachments/optics-catalog'

export type LoadoutSlot = 'primary' | 'secondary'

export const LOADOUT_SLOTS: readonly LoadoutSlot[] = ['primary', 'secondary']

export const SLOT_LABEL: Record<LoadoutSlot, string> = {
  primary: 'Primaria',
  secondary: 'Secundaria',
}

export interface LoadoutEntry {
  /** Slug del modelo, o null si la ranura quedó vacía. */
  slug: string | null
  /** Seed de la skin procedural equipada, o null. */
  skinSeed: string | null
  /**
   * Id del camuflaje por textura equipado (skins/texturas.ts), o null.
   *
   * Un arma tiene UN aspecto: skin procedural (`skinSeed`), camo por textura
   * (`camoId`), o ninguno (fábrica) — nunca dos a la vez. La exclusión la
   * mantienen `equipSkin` y `equipCamo`, que limpian el otro campo al escribir,
   * y la vuelve a garantizar `normalizeLoadout` para lo que venga de un guardado
   * viejo o editado a mano. Que sean dos campos y no uno con etiqueta es a
   * propósito: cada vía guarda una referencia distinta (una seed que genera la
   * skin vs. un id de catálogo), y mezclarlas obligaría a adivinar cuál es cuál.
   */
  camoId: string | null
  /**
   * Id de la óptica (mira) montada sobre el arma (attachments/optics-catalog.ts),
   * o null si va con los hierros.
   *
   * A DIFERENCIA del camo, la óptica es INDEPENDIENTE del aspecto: es un
   * accesorio físico, no una capa de pintura, así que un arma puede llevar camo
   * (o skin) Y mira a la vez. Por eso `equipOptic` NO limpia `camoId` ni
   * `skinSeed` —no hay exclusión que mantener— y la validación de
   * `normalizeLoadout` corre en paralelo a la de camo/skin, sin competir por la
   * ranura. Que exista en el catálogo y que el arma la soporte lo valida
   * `normalizeLoadout`; acá sólo se guarda la referencia.
   */
  opticId: string | null
}

export type Loadout = Record<LoadoutSlot, LoadoutEntry>

function firstUnlockedOfClass(
  accountLevel: number,
  wanted: string,
  permanentes: readonly string[],
): string | null {
  for (const slug of unlockedWeapons(accountLevel, permanentes)) {
    if (resolveArchetype(slug).class === wanted) return slug
  }
  return null
}

/**
 * Loadout de una cuenta nueva: el primer fusil desbloqueado como primaria y
 * la primera pistola como secundaria, que es lo que la escalera de
 * desbloqueos (unlocks.ts) garantiza que existe desde el nivel 1. Sin skin:
 * la primera skin equipada es una decisión del jugador, no del sistema.
 */
export function defaultLoadout(accountLevel: number, permanentes: readonly string[] = []): Loadout {
  const disponibles = unlockedWeapons(accountLevel, permanentes)
  const primary =
    firstUnlockedOfClass(accountLevel, 'ar', permanentes) ?? disponibles[0] ?? null
  const secondary =
    firstUnlockedOfClass(accountLevel, 'pistol', permanentes) ??
    disponibles.find((s) => s !== primary) ??
    null

  return {
    primary: { slug: primary, skinSeed: null, camoId: null, opticId: null },
    secondary: { slug: secondary, skinSeed: null, camoId: null, opticId: null },
  }
}

function slugValido(
  slug: string | null,
  accountLevel: number,
  permanentes: readonly string[],
): boolean {
  if (slug === null) return false
  if (!(slug in WEAPON_REGISTRY)) return false
  return isWeaponUnlocked(slug, accountLevel, permanentes)
}

/**
 * Deja el loadout en un estado jugable: descarta armas que no existen o que
 * el nivel no habilita, skins que no están en el inventario, camos que ya no
 * están en el catálogo y ópticas que no existen o que el arma no soporta. Lo
 * que se descarta se reemplaza por el default de la ranura (las cosméticas caen
 * a null), así el jugador nunca termina spawneando sin arma por un dato viejo
 * en localStorage.
 *
 * También es donde se hace cumplir la exclusión skin/camo para lo que no pasó
 * por `equipSkin`/`equipCamo`: un guardado editado a mano podría traer los dos,
 * y acá gana el camo (ver `fix`).
 *
 * `permanentes` (las armas de las fichas de prestigio, prestige.ts) pasan el
 * filtro sin importar el nivel. Es el camino que hace que prestigiar no te
 * saque de las manos el arma que elegiste llevarte: el reinicio deja el nivel
 * en 1, y sin esto la renormalización posterior la descartaría enseguida.
 */
export function normalizeLoadout(
  loadout: Loadout,
  accountLevel: number,
  inventory: readonly string[],
  permanentes: readonly string[] = [],
): Loadout {
  const fallback = defaultLoadout(accountLevel, permanentes)
  const owned = new Set(inventory)

  const fix = (slot: LoadoutSlot): LoadoutEntry => {
    const entry = loadout[slot]
    const slug = slugValido(entry?.slug ?? null, accountLevel, permanentes)
      ? (entry.slug as string)
      : fallback[slot].slug
    // Un camo vale sólo si su id sigue en el catálogo. Un guardado viejo puede
    // apuntar a un camo que ya no existe (el catálogo cambia entre versiones),
    // y eso cae a null igual que una skin que ya no está en el inventario.
    const camoId =
      entry?.camoId !== null &&
      entry?.camoId !== undefined &&
      entry.camoId in CAMO_TEXTURA_POR_ID
        ? entry.camoId
        : null
    // La skin procedural vale si está en el inventario Y no hay camo válido:
    // los dos aspectos son mutuamente excluyentes. Si un guardado corrupto trae
    // ambos, gana el camo (la vía nueva y más específica) y la skin se descarta,
    // así el estado que sale de acá cumple la misma invariante que garantizan
    // `equipSkin`/`equipCamo`: a lo sumo un aspecto por ranura.
    const skinSeed =
      camoId === null &&
      entry?.skinSeed !== null &&
      entry?.skinSeed !== undefined &&
      owned.has(entry.skinSeed)
        ? entry.skinSeed
        : null
    // La óptica vale sólo si (1) su id sigue en el catálogo de ópticas Y (2) el
    // arma —la ya arreglada, no la que venía— la soporta (tiene ancla). Las dos
    // condiciones caen a null por separado: un id borrado del catálogo, y una
    // mira guardada sobre un arma que no monta ópticas (o que quedó reemplazada
    // por el fallback). NO depende de camo/skin: la mira es un accesorio
    // independiente del aspecto, así que se calcula en paralelo y no compite por
    // la ranura. El nivel de arma (desbloqueo) NO se valida acá —normalizeLoadout
    // no recibe la XP por arma—; ese gate lo hace la armería al ofrecer sólo las
    // desbloqueadas, igual que el catálogo de camos no se gatea por maestría acá.
    const opticId =
      entry?.opticId !== null &&
      entry?.opticId !== undefined &&
      entry.opticId in OPTICAS &&
      slug !== null &&
      armaPuedeMontarOptica(slug)
        ? entry.opticId
        : null
    return { slug, skinSeed, camoId, opticId }
  }

  return { primary: fix('primary'), secondary: fix('secondary') }
}

/** Equipa un arma en una ranura, devolviendo un loadout nuevo. */
export function equipWeapon(loadout: Loadout, slot: LoadoutSlot, slug: string): Loadout {
  return { ...loadout, [slot]: { ...loadout[slot], slug } }
}

/**
 * Equipa (o saca, con null) la skin procedural de una ranura. Limpia el camo
 * por textura: un arma tiene un solo aspecto, así que elegir una skin descarta
 * el camo que hubiera. Pasar `null` deja las dos cosas en null (aspecto de
 * fábrica), que es exactamente lo que hace el botón "Sin skin" de la armería.
 */
export function equipSkin(loadout: Loadout, slot: LoadoutSlot, skinSeed: string | null): Loadout {
  return { ...loadout, [slot]: { ...loadout[slot], skinSeed, camoId: null } }
}

/**
 * Equipa (o saca, con null) el camuflaje por textura de una ranura. Es el
 * espejo de `equipSkin`: limpia la skin procedural, porque los dos aspectos son
 * mutuamente excluyentes.
 */
export function equipCamo(loadout: Loadout, slot: LoadoutSlot, camoId: string | null): Loadout {
  return { ...loadout, [slot]: { ...loadout[slot], camoId, skinSeed: null } }
}

/**
 * Skin equipada en una ranura, ya generada, o null si la ranura va con el
 * aspecto de fábrica. Es el puente entre el loadout (que guarda seeds) y el
 * renderer (que necesita parámetros).
 */
export function skinForSlot(loadout: Loadout, slot: LoadoutSlot): ReturnType<typeof generateSkin> | null {
  const seed = loadout[slot].skinSeed
  return seed === null ? null : generateSkin(seed)
}

/**
 * Camo por textura equipado en una ranura, o null si la ranura va con skin
 * procedural o aspecto de fábrica. Espejo de `skinForSlot`: el puente entre el
 * id que guarda el loadout y el `CamoTextura` que la vitrina —y más adelante el
 * viewmodel en partida— necesitan. Un id que ya no está en el catálogo devuelve
 * null en vez de romper (mismo criterio defensivo que el resto del módulo).
 */
export function camoForSlot(loadout: Loadout, slot: LoadoutSlot): CamoTextura | null {
  const id = loadout[slot].camoId
  return id === null ? null : CAMO_TEXTURA_POR_ID[id] ?? null
}

/**
 * Equipa (o saca, con null) la óptica de una ranura, devolviendo un loadout
 * nuevo.
 *
 * NO limpia `camoId` ni `skinSeed`, y esa es la diferencia central con
 * `equipCamo`/`equipSkin`: la mira es un accesorio independiente del aspecto,
 * no otra vía de pintarlo. Un arma puede llevar camo (o skin) Y mira a la vez,
 * así que elegir una mira sólo toca `opticId`. Pasar `null` la saca (hierros)
 * sin tocar el aspecto: es el botón "Sin mira" de la armería.
 */
export function equipOptic(loadout: Loadout, slot: LoadoutSlot, opticId: string | null): Loadout {
  return { ...loadout, [slot]: { ...loadout[slot], opticId } }
}

/**
 * Óptica equipada en una ranura, ya resuelta a su definición del catálogo, o
 * null si la ranura va con los hierros. Espejo de `camoForSlot`: el puente entre
 * el id que guarda el loadout y el `OpticaDef` que la vitrina necesita para
 * montar la mira. Un id que ya no está en el catálogo devuelve null en vez de
 * romper (mismo criterio defensivo que el resto del módulo).
 */
export function opticForSlot(loadout: Loadout, slot: LoadoutSlot): OpticaDef | null {
  const id = loadout[slot].opticId
  if (id === null) return null
  return id in OPTICAS ? OPTICAS[id as keyof typeof OPTICAS] : null
}
