/**
 * Catálogo de las armas derivadas de modelos del Workshop (ver
 * docs/WORKSHOP.md). Es una tabla escrita a mano, a propósito: cada fila
 * declara tres cosas que NO se pueden inferir de la malla sin equivocarse.
 *
 * Son 39 de los 42 .glb convertidos. Los tres que faltan (`elite`,
 * `deagle_dual`, `mac10_dual`) son modelos de PUÑO DOBLE y quedan afuera a
 * propósito, no por olvido: medidos, no son "un arma ancha" sino DOS armas
 * acostadas en el mismo plano y espejadas entre sí (caja envolvente de
 * 0,27 x 0,03 x 0,28 m contra los 0,03 x 0,15 x 0,27 del arma sola, o sea el
 * eje vertical de cada una apunta para su lado). No existe una rotación
 * única que las deje a las dos derechas, así que el rig de viewmodel —que
 * anima UN arma, ver viewmodel/rig.ts— no las puede posar, y el ADS tampoco
 * tiene sentido: no se apunta con dos armas a la vez. Entrarían visiblemente
 * rotas. Si alguna vez se quieren, el trabajo real es partir la malla en dos
 * y tratar cada mitad como un arma, no agregar la fila acá.
 *
 * 1. **El nombre mostrado.** Los modelos de origen son armas reales con
 *    marca. Ninguna marca puede aparecer en nada que vea el jugador — ni en
 *    la armería, ni en el panel de tuning, ni en el killfeed. El slug
 *    interno sí conserva el nombre del archivo de origen (es lo que ata la
 *    entrada a su .glb en disco y nunca se muestra), pero `name` es un
 *    nombre propio inventado. `no-brands.test.ts` verifica la separación
 *    contra una lista negra explícita: la regla vive en un test, no en la
 *    memoria de quien agregue la fila 43.
 *
 * 2. **El arquetipo de estadísticas.** No se inventan arquetipos nuevos: los
 *    10 que existen (`archetypes.ts`) están calibrados con TTK 300-400 ms y
 *    sin dominancia estricta, y meter un arquetipo por arma tiraría ese
 *    balance a la basura por 42 modelos que son puramente cosméticos. El
 *    criterio de mapeo es por CLASE y por carácter dentro de la clase:
 *    - Fusil de asalto automático de cartucho intermedio -> `ar-1` (la línea
 *      base).
 *    - Fusil de ráfaga de 3 -> `ar-2` (es el único arquetipo `burst`).
 *    - Fusil "de batalla" (más daño y alcance, menos cadencia y cargador)
 *      -> `ar-3`. Es donde caen los bullpup con óptica integrada.
 *    - Subfusil de cadencia altísima y control justo -> `smg-1`; subfusil de
 *      cadencia contenida y más alcance -> `smg-2`.
 *    - Cerrojo de un tiro -> `sniper-bolt`; semiautomático de precisión ->
 *      `sniper-marksman`.
 *    - Escopeta -> `shotgun`; ametralladora de cargador grande -> `lmg`;
 *      cualquier arma corta -> `pistol`.
 *    Varias armas comparten arquetipo. Es intencional: el modelo cambia cómo
 *    se ve el arma, no cómo se juega (sección 6 del spec).
 *
 * 3. **El tipo de mira.** Ver `SightType` en scripts/lib/sight.ts para el
 *    razonamiento completo de por qué esto se declara y no se detecta. En
 *    resumen: apuntar por encima de un visor telescópico en vez de a través
 *    de él es un error que sólo se ve mirando la pantalla, y el umbral
 *    geométrico que separaría un visor de un riel alto se solapa entre
 *    clases. Declararlo cuesta una columna.
 *
 * Las variantes `*_scopeless` son el MISMO arma sin el visor: comparten
 * arquetipo con su versión con óptica (la estadística no depende del modelo)
 * y cambian a `hierros`. Existen porque un visor tapa el centro de la
 * pantalla en ADS y hay clases donde eso no se quiere.
 */

import type { ArchetypeId } from '@/game/weapons/archetypes'

/**
 * Tipo de mira. Duplicado estructural (mismo union que `SightType` en
 * scripts/lib/sight.ts) y no un import: `scripts/` corre con Node crudo
 * resolviendo rutas relativas con extensión, y `src/` con el alias `@/` del
 * bundler. Importar de un lado al otro ataría el runtime del script a la
 * resolución del bundler. Son dos strings; el pipeline los cruza en
 * convert-source-weapons.ts, que sí importa los dos y ahí TypeScript
 * verifica que coincidan.
 */
export type SourceSightType = 'hierros' | 'optica'

export interface SourceWeaponEntry {
  /** Nombre del archivo de origen, sin extensión. Nunca se muestra. */
  readonly slug: string
  /** Nombre propio inventado. Esto sí lo ve el jugador. */
  readonly name: string
  readonly archetype: ArchetypeId
  readonly sight: SourceSightType
}

export const SOURCE_WEAPONS: readonly SourceWeaponEntry[] = [
  // --- Fusiles de asalto -------------------------------------------------
  { slug: 'ak47', name: 'Cárpato', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'm4a4', name: 'Halcón', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'm4a1s', name: 'Halcón Táctico', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'galil', name: 'Sirocco', archetype: 'ar-1', sight: 'hierros' },
  // Único fusil de ráfaga de 3 del lote: el arquetipo `ar-2` existe
  // exactamente para esto y no hay otro `burst` en el roster.
  { slug: 'famas', name: 'Alud', archetype: 'ar-2', sight: 'hierros' },
  // Bullpup con óptica integrada: más alcance y daño por tiro, menos
  // cadencia. Es el perfil de `ar-3` (fusil de batalla).
  { slug: 'aug', name: 'Peñasco', archetype: 'ar-3', sight: 'optica' },
  { slug: 'aug_scopeless', name: 'Peñasco Abierto', archetype: 'ar-3', sight: 'hierros' },
  { slug: 'sg553', name: 'Tornado', archetype: 'ar-3', sight: 'optica' },
  { slug: 'sg553_scopeless', name: 'Tornado Abierto', archetype: 'ar-3', sight: 'hierros' },

  // --- Subfusiles --------------------------------------------------------
  // smg-2 (cadencia contenida, más alcance y control) para los dos de
  // cartucho pesado o con supresor; smg-1 (cadencia altísima) para el resto.
  { slug: 'mp5sd', name: 'Susurro', archetype: 'smg-2', sight: 'hierros' },
  { slug: 'ump45', name: 'Yunque', archetype: 'smg-2', sight: 'hierros' },
  { slug: 'mp7', name: 'Dardo', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mp9', name: 'Avispa', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mac10', name: 'Zumbido', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'p90', name: 'Enjambre', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'bizon', name: 'Torrente', archetype: 'smg-1', sight: 'hierros' },

  // --- Armas cortas ------------------------------------------------------
  // Todas a `pistol`: es el único arquetipo de arma corta y las diferencias
  // entre ellas (calibre, capacidad) son justamente lo que el spec dice que
  // NO tiene que depender del modelo.
  { slug: 'deagle', name: 'Mazo', archetype: 'pistol', sight: 'hierros' },
  { slug: 'glock18', name: 'Chispa', archetype: 'pistol', sight: 'hierros' },
  { slug: 'usps', name: 'Sombra', archetype: 'pistol', sight: 'hierros' },
  { slug: 'p2000', name: 'Guardián', archetype: 'pistol', sight: 'hierros' },
  { slug: 'p250', name: 'Centella', archetype: 'pistol', sight: 'hierros' },
  { slug: 'fiveseven', name: 'Alfil', archetype: 'pistol', sight: 'hierros' },
  { slug: 'cz75', name: 'Brasa', archetype: 'pistol', sight: 'hierros' },
  { slug: 'revolver', name: 'Trueno', archetype: 'pistol', sight: 'hierros' },
  { slug: 'tec9', name: 'Astilla', archetype: 'pistol', sight: 'hierros' },

  // --- Precisión ---------------------------------------------------------
  // Cerrojo (un tiro mata a torso) vs. semiautomático de precisión: la
  // diferencia real entre `sniper-bolt` y `sniper-marksman`.
  { slug: 'awp', name: 'Lanza', archetype: 'sniper-bolt', sight: 'optica' },
  { slug: 'awp_scopeless', name: 'Lanza Abierta', archetype: 'sniper-bolt', sight: 'hierros' },
  { slug: 'ssg08', name: 'Aguja', archetype: 'sniper-bolt', sight: 'optica' },
  { slug: 'ssg08_scopeless', name: 'Aguja Abierta', archetype: 'sniper-bolt', sight: 'hierros' },
  { slug: 'scar20', name: 'Cóndor', archetype: 'sniper-marksman', sight: 'optica' },
  { slug: 'scar20_scopeless', name: 'Cóndor Abierto', archetype: 'sniper-marksman', sight: 'hierros' },
  { slug: 'g3sg1', name: 'Bastión', archetype: 'sniper-marksman', sight: 'optica' },
  { slug: 'g3sg1_scopeless', name: 'Bastión Abierto', archetype: 'sniper-marksman', sight: 'hierros' },

  // --- Escopetas ---------------------------------------------------------
  { slug: 'nova', name: 'Roble', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'xm1014', name: 'Estampida', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'sawedoff', name: 'Recorte', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'mag7', name: 'Ariete', archetype: 'shotgun', sight: 'hierros' },

  // --- Ametralladoras ----------------------------------------------------
  { slug: 'm249', name: 'Tormenta', archetype: 'lmg', sight: 'hierros' },
  { slug: 'negev', name: 'Diluvio', archetype: 'lmg', sight: 'hierros' },
]

/** Índice por slug, para el pipeline y el registry. */
export const SOURCE_WEAPONS_BY_SLUG: ReadonlyMap<string, SourceWeaponEntry> = new Map(
  SOURCE_WEAPONS.map((e) => [e.slug, e]),
)
