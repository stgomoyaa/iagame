/**
 * Reparto de armas para los bots (sección "Build" de la tarea: "los bots
 * deberían llevar armas variadas de los 10 arquetipos en vez de que todos
 * tengan el mismo rifle"). Los bots no tienen viewmodel visual propio
 * (bots/renderer.ts es sólo cápsula + esfera, sección 8 del spec) así que
 * el arquetipo elegido es puramente de estadísticas -- no depende de qué
 * modelos 3D ya estén catalogados en weapons/registry.ts, cosa que sí
 * limitaría el jugador (loadout del jugador es fase 3, todavía no existe).
 */

import { ARCHETYPE_LIST, ARCHETYPES, type ArchetypeId, type WeaponArchetype } from '@/game/weapons/archetypes'

/**
 * Arquetipo por índice de bot, en round-robin sobre los 10 arquetipos
 * (ARCHETYPE_LIST). Con `count <= 10` cada bot lleva un arma distinta; por
 * encima de 10 se repite, pero nunca dos bots ADYACENTES en el array
 * comparten arma hasta que el roster entero se agotó -- suficiente para que
 * un vistazo a la partida no lea "todos con el mismo rifle" (el defecto que
 * pide evitar la tarea).
 */
export function assignBotArchetypeIds(count: number): ArchetypeId[] {
  const ids: ArchetypeId[] = []
  for (let i = 0; i < count; i++) ids.push(ARCHETYPE_LIST[i % ARCHETYPE_LIST.length].id)
  return ids
}

export function assignBotArchetypes(count: number): WeaponArchetype[] {
  return assignBotArchetypeIds(count).map((id) => ARCHETYPES[id])
}

/**
 * Etiqueta legible para el killfeed y el panel de tuning ("ar-1" -> "AR 1").
 * No hay assets de íconos (sección 11 del spec: el arte de armas es harina
 * de otro costal, fase 3) -- el spec original pedía "killfeed con ícono de
 * arma"; sin pipeline de íconos, el nombre en texto es la sustitución
 * honesta, no una promesa de ícono que no existe.
 */
export function weaponLabel(id: ArchetypeId): string {
  return id.toUpperCase().replace(/-/g, ' ')
}
