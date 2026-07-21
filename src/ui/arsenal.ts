/**
 * La lista de armas tal como la necesita una pantalla de selección.
 *
 * Vive acá y no adentro de `Armoury.tsx` porque desde el menú de pausa se
 * puede cambiar de arma sin salir de la partida, y las dos pantallas tienen
 * que mostrar EL MISMO arsenal con LOS MISMOS niveles de desbloqueo. Si cada
 * una armara su lista por su cuenta, la primera vez que cambie la regla de
 * desbloqueo una de las dos quedaría mintiendo.
 *
 * El markup de la fila NO se comparte a propósito: la armería es una página
 * entera con estadísticas y vitrina 3D, y el menú de pausa es una lista
 * compacta sobre el juego congelado. Lo que se comparte son los datos y de
 * dónde salen, que es donde estaba la duplicación real.
 */

import { unlockLevelFor } from '@/game/progression/unlocks'
import { resolveArchetype, weaponIndex } from '@/game/weapons/registry'
import { isMeleeSlug } from '@/game/weapons/melee-catalog'

export interface ArmaDeLista {
  slug: string
  nombre: string
  archetype: ReturnType<typeof resolveArchetype>
  /** Nivel de cuenta que la desbloquea. */
  nivel: number
}

/**
 * Foto del catálogo AHORA. Es una función y no una constante porque el
 * catálogo crece cuando resuelve el fetch de las armas locales
 * (weapons/registry.ts, `loadLocalWeapons`): quien la llame tiene que
 * volver a llamarla después de esa carga, no cachear el resultado para
 * siempre. Ver el comentario sobre el bug de la foto vieja en Armoury.tsx.
 */
export function construirArsenal(): ArmaDeLista[] {
  // El cuchillo NO se lista: no es un arma seleccionable ni desbloqueable, es el
  // slot 3 fijo que game.ts equipa aparte (como en CS/COD). Vive en el índice
  // sólo para que el renderer cargue su viewmodel, no para elegirlo acá.
  return weaponIndex()
    .filter((entry) => !isMeleeSlug(entry.slug))
    .map((entry) => ({
      slug: entry.slug,
      nombre: entry.name,
      archetype: resolveArchetype(entry.slug),
      nivel: unlockLevelFor(entry.slug),
    }))
}
