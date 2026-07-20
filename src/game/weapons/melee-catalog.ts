/**
 * Catálogo de armas MELEE (cuchillos). Es el equivalente de source-catalog.ts
 * pero para la rama melee, y vive aparte a propósito: un cuchillo no tiene
 * `ArchetypeId` (no es ninguno de los 10 arquetipos de arma de fuego), así que
 * NO puede ir en `SOURCE_WEAPONS` ni en el `WEAPON_REGISTRY` de registry.ts
 * sin romper la validación de las 148 armas de fuego. La regla melee es
 * simple: un slug es de cuchillo si está acá; si no, es de fuego y sigue por
 * el camino de siempre. game.ts consulta `isMeleeSlug()` ANTES de tocar el
 * registry de fuego, y ramifica.
 *
 * Los slugs de cuchillo (`knife_t`, y en el futuro karambit/butterfly) viven
 * en `public/assets/weapons-local/` igual que las armas de Source: contenido
 * de Workshop, gitignoreado, nunca publicado (docs/WORKSHOP.md).
 */

import type { MeleeArchetype } from '@/game/combat/melee'

/**
 * Estadísticas del cuchillo por defecto. TODOS los números de daño salen de
 * Counter-Strike (CS:GO/CS2), columna SIN armadura — nuestro mundo es de 100
 * de vida y sin armadura (combat/hitboxes.ts).
 *
 * Fuente citable VERIFICADA de los daños y del umbral de backstab: Valve
 * Developer Community, "weapon_knife", tabla "Damage against unarmored
 * (armored) Players", columna CS:GO/CS2:
 *   https://developer.valvesoftware.com/wiki/Weapon_knife
 *   - Primary attack, first swing ....... 40  (armored 34)
 *   - Primary attack, consecutive swing . 25  (armored 21)
 *   - Primary attack, backstab .......... 90  (armored 76)
 *   - Secondary attack .................. 65  (armored 55)
 *   - Secondary attack, backstab ....... 180  (armored 153)  → mata de un golpe
 *   - Backstab si ángulo(orientación víctima, atacante→víctima) ≤ cos⁻¹(0.475)
 * Contrastado con la wiki de Counter-Strike (Fandom), que da los mismos
 * valores sin armadura: https://counterstrike.fandom.com/wiki/Knife
 *
 * Números que NO pude verificar contra el SDK de Valve y quedan marcados como
 * NUESTROS (fieles al patrón, calibrados a nuestra escala):
 *   - `range` (1.5 m): CS mide el alcance en Hammer units dentro del código y
 *     no publica un valor limpio y citable de "rango del cuchillo en metros".
 *     1.5 m es el objetivo de rango corto pedido para el proyecto y encaja con
 *     nuestra escala en metros (archetypes.ts trabaja en metros).
 *   - `slashInterval` (0.4 s) y `stabInterval` (1.0 s): ampliamente
 *     documentados en la comunidad como la cadencia del primary (~0.4 s) y del
 *     secondary (~1.0 s) del cuchillo de CS:GO, pero NO los verifiqué contra el
 *     `m_flNextPrimaryAttack`/`m_flNextSecondaryAttack` del SDK. Coinciden con
 *     el rango que la propia tarea da como referencia (~0.4 s / ~1 s).
 *   - `freshSlashResetS` (1.0 s): totalmente nuestro. CS reduce el daño de los
 *     tajos consecutivos pero no publica la ventana exacta tras la cual el tajo
 *     vuelve a ser "fresco"; 1 s es una pausa razonable para eso.
 *
 * Sobre el TTK: el cuchillo cae FUERA de la banda de 300-400 ms de las armas
 * de fuego, y es a propósito (esa banda es de las 148 de fuego, no del melee).
 * Con estos números: tajo → 4 golpes para matar (40+25+25+25, ~1.2 s), estocada
 * → 2 golpes (65+65, ~1.0 s), estocada por la espalda → 1 golpe (180 ≥ 100).
 * Es el riesgo/recompensa real del cuchillo: rango corto y lento de frente,
 * letal por la espalda. No se ajustó a la banda de fuego porque el patrón real
 * es justamente ese contraste.
 */
export const KNIFE_ARCHETYPE: MeleeArchetype = {
  id: 'knife_t',
  slashDamage: 40,
  slashConsecutiveDamage: 25,
  stabDamage: 65,
  slashBackstabDamage: 90,
  stabBackstabDamage: 180,
  range: 1.5,
  slashInterval: 0.4,
  stabInterval: 1.0,
  backstabCosThreshold: 0.475,
  freshSlashResetS: 1.0,
}

export interface MeleeWeaponEntry {
  /** Nombre del archivo/slug (sin extensión). Igual convención que las de fuego. */
  readonly slug: string
  /** Nombre mostrado. */
  readonly name: string
  /** Estadísticas de la rama melee. */
  readonly archetype: MeleeArchetype
}

/**
 * Las armas melee jugables. Por ahora una: el cuchillo por defecto. Los skins
 * (karambit, butterfly) y variantes son cosméticos futuros que comparten este
 * mismo `archetype` — el modelo cambia cómo se ve, no cómo se juega, igual que
 * con las armas de fuego.
 */
export const MELEE_WEAPONS: readonly MeleeWeaponEntry[] = [
  { slug: 'knife_t', name: 'Cuchillo', archetype: KNIFE_ARCHETYPE },
]

const MELEE_WEAPONS_BY_SLUG: ReadonlyMap<string, MeleeWeaponEntry> = new Map(
  MELEE_WEAPONS.map((e) => [e.slug, e]),
)

/** ¿Este slug es un arma melee? Es el discriminante de la rama: game.ts lo
 *  consulta antes de resolver un arquetipo de fuego. */
export function isMeleeSlug(slug: string): boolean {
  return MELEE_WEAPONS_BY_SLUG.has(slug)
}

/** Estadísticas melee de un slug, o `null` si no es un arma melee. */
export function getMeleeArchetype(slug: string): MeleeArchetype | null {
  return MELEE_WEAPONS_BY_SLUG.get(slug)?.archetype ?? null
}

/** Entrada de catálogo melee de un slug, o `null`. */
export function getMeleeWeapon(slug: string): MeleeWeaponEntry | null {
  return MELEE_WEAPONS_BY_SLUG.get(slug) ?? null
}
