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
import { isWeaponUnlocked, unlockedWeapons } from '@/game/progression/unlocks'
import { resolveArchetype, WEAPON_REGISTRY } from '@/game/weapons/registry'

export type LoadoutSlot = 'primary' | 'secondary'

export const LOADOUT_SLOTS: readonly LoadoutSlot[] = ['primary', 'secondary']

export const SLOT_LABEL: Record<LoadoutSlot, string> = {
  primary: 'Primaria',
  secondary: 'Secundaria',
}

export interface LoadoutEntry {
  /** Slug del modelo, o null si la ranura quedó vacía. */
  slug: string | null
  /** Seed de la skin equipada, o null para el aspecto de fábrica. */
  skinSeed: string | null
}

export type Loadout = Record<LoadoutSlot, LoadoutEntry>

function firstUnlockedOfClass(accountLevel: number, wanted: string): string | null {
  for (const slug of unlockedWeapons(accountLevel)) {
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
export function defaultLoadout(accountLevel: number): Loadout {
  const disponibles = unlockedWeapons(accountLevel)
  const primary =
    firstUnlockedOfClass(accountLevel, 'ar') ?? disponibles[0] ?? null
  const secondary =
    firstUnlockedOfClass(accountLevel, 'pistol') ??
    disponibles.find((s) => s !== primary) ??
    null

  return {
    primary: { slug: primary, skinSeed: null },
    secondary: { slug: secondary, skinSeed: null },
  }
}

function slugValido(slug: string | null, accountLevel: number): boolean {
  if (slug === null) return false
  if (!(slug in WEAPON_REGISTRY)) return false
  return isWeaponUnlocked(slug, accountLevel)
}

/**
 * Deja el loadout en un estado jugable: descarta armas que no existen o que
 * el nivel no habilita, y skins que no están en el inventario. Lo que se
 * descarta se reemplaza por el default de la ranura, así el jugador nunca
 * termina spawneando sin arma por un dato viejo en localStorage.
 */
export function normalizeLoadout(
  loadout: Loadout,
  accountLevel: number,
  inventory: readonly string[],
): Loadout {
  const fallback = defaultLoadout(accountLevel)
  const owned = new Set(inventory)

  const fix = (slot: LoadoutSlot): LoadoutEntry => {
    const entry = loadout[slot]
    const slug = slugValido(entry?.slug ?? null, accountLevel)
      ? (entry.slug as string)
      : fallback[slot].slug
    const skinSeed =
      entry?.skinSeed !== null && entry?.skinSeed !== undefined && owned.has(entry.skinSeed)
        ? entry.skinSeed
        : null
    return { slug, skinSeed }
  }

  return { primary: fix('primary'), secondary: fix('secondary') }
}

/** Equipa un arma en una ranura, devolviendo un loadout nuevo. */
export function equipWeapon(loadout: Loadout, slot: LoadoutSlot, slug: string): Loadout {
  return { ...loadout, [slot]: { ...loadout[slot], slug } }
}

/** Equipa (o saca, con null) la skin de una ranura. */
export function equipSkin(loadout: Loadout, slot: LoadoutSlot, skinSeed: string | null): Loadout {
  return { ...loadout, [slot]: { ...loadout[slot], skinSeed } }
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
