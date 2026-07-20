/**
 * Desbloqueo de armas por nivel de cuenta (sección 6 del spec: "Las armas se
 * desbloquean por nivel de cuenta", y sección 9: "Nivel de cuenta por XP,
 * que desbloquea armas").
 *
 * El spec no fija números, así que la regla se deriva de algo que sí existe
 * en los datos y no de una tabla escrita a mano de 40 filas que nadie puede
 * mantener: la **clase** del arquetipo decide el nivel base, y la posición
 * del modelo dentro de su clase agrega escalones. Consecuencias buscadas:
 *
 * - Un jugador nuevo arranca con pistolas y el primer fusil: las dos clases
 *   con las que se puede jugar cualquier situación. Nunca queda sin arma.
 * - Las clases de nicho (escopeta, LMG, francotirador) llegan más tarde,
 *   que es también el orden en que se vuelven interesantes.
 * - Agregar modelos al pack (index.json crece hasta 40 y podría crecer más)
 *   no obliga a tocar nada acá: el modelo nuevo cae en su clase y toma el
 *   escalón que sigue.
 *
 * Es matemática pura sobre el registry, sin estado: el nivel de cuenta entra
 * como parámetro.
 */

import type { WeaponClass } from '@/game/weapons/archetypes'
import { catalogVersion, resolveArchetype, weaponIndex } from '@/game/weapons/registry'

/** Nivel mínimo de cuenta. Una cuenta nueva arranca acá. */
export const NIVEL_INICIAL = 1

/** Nivel base por clase. */
const CLASS_BASE_LEVEL: Record<WeaponClass, number> = {
  pistol: 1,
  ar: 1,
  smg: 3,
  shotgun: 6,
  marksman: 9,
  lmg: 12,
  sniper: 15,
}

/** Escalones entre modelos consecutivos de la misma clase. */
const STEP_PER_MODEL = 2

/**
 * Modelos de cortesía por clase: los primeros N de la clase salen todos al
 * nivel base, sin escalón.
 *
 * Existe por una razón de sensación, no de balance: con escalón desde el
 * primer modelo, una cuenta nueva abre la armería y encuentra 2 armas de 40.
 * Eso no se lee como progresión, se lee como que la pantalla está rota. Con
 * cortesía en las dos clases de arranque el jugador empieza con cinco armas
 * y algo que elegir, y las otras 35 siguen siendo el gancho.
 */
const CORTESIA: Partial<Record<WeaponClass, number>> = {
  ar: 3,
  pistol: 2,
}

function buildUnlockLevels(): Record<string, number> {
  const seenPerClass = new Map<WeaponClass, number>()
  const levels: Record<string, number> = {}

  // El orden de index.json es el orden del pack, estable entre builds: dos
  // ejecuciones asignan los mismos niveles a los mismos modelos, que es lo
  // que evita que un jugador "pierda" un arma que ya tenía desbloqueada.
  for (const entry of weaponIndex()) {
    const clase = resolveArchetype(entry.slug).class
    const indice = seenPerClass.get(clase) ?? 0
    seenPerClass.set(clase, indice + 1)
    const escalones = Math.max(0, indice - ((CORTESIA[clase] ?? 1) - 1))
    levels[entry.slug] = CLASS_BASE_LEVEL[clase] + escalones * STEP_PER_MODEL
  }

  return levels
}

/**
 * Tabla de niveles, calculada bajo demanda y cacheada CONTRA LA VERSIÓN DEL
 * CATÁLOGO, no una sola vez al importar el módulo.
 *
 * Esto era un `const` que corría `buildUnlockLevels()` en el import, y era un
 * bug real, no una precaución: el catálogo de armas ya no está completo
 * cuando este módulo se importa. Las armas locales (registry.ts) entran
 * después, cuando resuelve un fetch, así que la tabla quedaba con la foto de
 * las 40 CC0 y `unlockLevelFor('ak47')` LANZABA. Y no fallaba en un rincón:
 * la primera cosa que hace `createGame` es armar el loadout por defecto, que
 * recorre las armas desbloqueadas — o sea, el juego entero no arrancaba.
 *
 * Cachear contra `catalogVersion()` en vez de recalcular siempre mantiene la
 * propiedad que hacía atractivo al `const`: esto se llama una vez por arma
 * por render de la armería, y recorrer 79 armas en cada llamada sería
 * trabajo cuadrático en una pantalla de menú.
 */
let cache: Record<string, number> | null = null
let cacheVersion = -1

function unlockLevels(): Record<string, number> {
  if (cache === null || cacheVersion !== catalogVersion()) {
    cache = buildUnlockLevels()
    cacheVersion = catalogVersion()
  }
  return cache
}

/** Todos los niveles de desbloqueo del catálogo actual, por slug. */
export function unlockLevelsSnapshot(): Readonly<Record<string, number>> {
  return unlockLevels()
}

/** Nivel de cuenta al que se desbloquea un arma. */
export function unlockLevelFor(slug: string): number {
  const level = unlockLevels()[slug]
  if (level === undefined) throw new Error(`arma desconocida: "${slug}" no está en el catálogo`)
  return level
}

export function isWeaponUnlocked(slug: string, accountLevel: number): boolean {
  return accountLevel >= unlockLevelFor(slug)
}

/** Slugs disponibles a un nivel dado, en el orden del pack. */
export function unlockedWeapons(accountLevel: number): string[] {
  return weaponIndex()
    .map((e) => e.slug)
    .filter((slug) => isWeaponUnlocked(slug, accountLevel))
}

/** Nivel al que se desbloquea la última arma del pack. */
export function nivelMaximoDeDesbloqueo(): number {
  return Math.max(...Object.values(unlockLevels()))
}

/**
 * XP acumulada necesaria para alcanzar un nivel. Curva lineal a propósito:
 * el spec pone el diseño de XP en la fase 4 y acá sólo hace falta que el
 * nivel exista y sea una función pura de la XP, para que el desbloqueo se
 * pueda calcular y testear hoy. Cuando la fase 4 tunee la curva, cambia esta
 * función y nada más.
 */
export const XP_POR_NIVEL = 1200

export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return NIVEL_INICIAL
  return NIVEL_INICIAL + Math.floor(xp / XP_POR_NIVEL)
}

export function xpParaNivel(level: number): number {
  return Math.max(0, level - NIVEL_INICIAL) * XP_POR_NIVEL
}
