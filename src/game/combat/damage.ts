/**
 * Daño final de un impacto: la curva de distancia del arquetipo
 * (weapons/archetypes.ts, ya implementada y testeada) multiplicada por el
 * multiplicador de la hitbox golpeada (combat/hitboxes.ts). Sección 2 del
 * spec de fase 1.
 */

import { damageAtRange, type WeaponArchetype } from '@/game/weapons/archetypes'
import { HITBOX_MULTIPLIER, type BodyPart } from '@/game/combat/hitboxes'

export function resolveDamage(archetype: WeaponArchetype, distance: number, part: BodyPart): number {
  return damageAtRange(archetype, distance) * HITBOX_MULTIPLIER[part]
}
