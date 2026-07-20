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
import { resolveArchetypeId, weaponIndex } from '@/game/weapons/registry'

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
 * Arma CONCRETA de cada bot (un slug del catálogo), no sólo su arquetipo.
 *
 * POR QUÉ HACE FALTA SI EL BOT NO SE VE CON EL ARMA EN LA MANO
 * El encabezado de este archivo dice que el arquetipo del bot es "puramente
 * de estadísticas" porque los bots no tienen viewmodel. Eso sigue siendo
 * cierto para lo VISUAL y dejó de serlo para lo sonoro: desde que el disparo
 * se resuelve por arma (feedback/gun-audio.ts), un bot con arquetipo `ar-1`
 * y nada más suena al AR genérico, y diez bots suenan a siete armas. Saber
 * de oído que el que te está flanqueando lleva una AK y no una M4 es
 * información de combate, y para tenerla el bot necesita un arma con nombre.
 *
 * Determinista y estable: el bot i siempre saca el mismo slug para el mismo
 * catálogo, así que su firma sonora no cambia a mitad de partida. Reparte en
 * round-robin DENTRO de los candidatos de su arquetipo -- con dos bots del
 * mismo arquetipo, cada uno lleva un arma distinta mientras el catálogo dé.
 *
 * OJO CON EL MOMENTO DE LLAMARLA: lee el catálogo vivo, así que hay que
 * llamarla después de `loadLocalWeapons()` o los bots se reparten sólo entre
 * las 40 CC0. Hoy `createGame()` corre entera después de esa espera (ver el
 * comentario largo en ui/GameCanvas.tsx), que es justo la carrera que ahí se
 * decidió no correr.
 *
 * Devuelve `null` en la posición de un bot cuyo arquetipo no tenga ni un
 * arma en el catálogo. No es hipotético: `assignBotArchetypeIds` reparte
 * sobre los 10 arquetipos y el catálogo no garantiza cubrirlos todos. Un
 * `null` cuesta que ESE bot suene con el sample de su clase, que es
 * exactamente lo que pasaba antes -- no un hueco de audio.
 */
export function assignBotWeaponSlugs(archetypeIds: readonly ArchetypeId[]): (string | null)[] {
  // Candidatos por arquetipo, armados de una sola pasada sobre el catálogo.
  const porArquetipo = new Map<ArchetypeId, string[]>()
  for (const entry of weaponIndex()) {
    const id = resolveArchetypeId(entry.slug)
    const lista = porArquetipo.get(id)
    if (lista) lista.push(entry.slug)
    else porArquetipo.set(id, [entry.slug])
  }

  const usados = new Map<ArchetypeId, number>()
  const slugs: (string | null)[] = []
  for (const id of archetypeIds) {
    const candidatos = porArquetipo.get(id)
    if (!candidatos || candidatos.length === 0) {
      slugs.push(null)
      continue
    }
    const n = usados.get(id) ?? 0
    usados.set(id, n + 1)
    slugs.push(candidatos[n % candidatos.length])
  }
  return slugs
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
