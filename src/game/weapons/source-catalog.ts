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
 * 1. **El nombre mostrado y su etiqueta de juego.** Estas 39 armas llevan su
 *    NOMBRE REAL más el juego del que salió el pack: `AK-47 (CS)`. El motivo
 *    es de jugabilidad, no de estética — el jugador elige por ahí ("hoy juego
 *    estilo COD"), y con nombres inventados esa elección no existe.
 *
 *    Que eso no sea un problema de marca lo resuelve la PROCEDENCIA, no el
 *    nombre. Estas 39 viven en `public/assets/weapons-local/`, que está
 *    gitignoreada y nunca se publica (docs/WORKSHOP.md): un build publicado
 *    literalmente no tiene estos archivos, así que estos nombres tampoco
 *    aparecen. Las 40 armas CC0 —las que SÍ se publican— siguen con nombre
 *    genérico, y eso no se relaja nunca.
 *
 *    `source-catalog.test.ts` es lo que impide que esa separación se erosione:
 *    la lista negra de marcas se corre contra el catálogo PUBLICABLE (las CC0)
 *    y falla si alguna marca se cuela ahí, y en paralelo exige que las locales
 *    sí lleven nombre real y etiqueta. Un guard que se limitara a prohibir
 *    marcas en todo el catálogo ya no tendría sentido acá, pero apagarlo sería
 *    peor: la regla vive en un test, no en la memoria de quien agregue la
 *    fila 43.
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

/**
 * Juego del que viene el pack de origen. Es la etiqueta que se muestra entre
 * paréntesis detrás del nombre (`AK-47 (CS)`), y no es decoración: el jugador
 * elige por ella ("hoy juego estilo COD"). Hoy los 39 modelos salen de packs
 * de Counter-Strike y por eso `'CS'` es el único valor que aparece en la tabla
 * — el tipo es una unión y no un string suelto justamente para que sumar un
 * pack de otro juego sea agregar un miembro acá, no inventar una convención de
 * texto en cada fila.
 *
 * Que la etiqueta viva en el catálogo (y no pegada dentro de `name`) es lo que
 * permite que dos armas homónimas de packs distintos convivan: el nombre real
 * puede repetirse entre juegos, la combinación nombre+juego no.
 */
export type SourceGame = 'CS'

export interface SourceWeaponEntry {
  /** Nombre del archivo de origen, sin extensión. Nunca se muestra. */
  readonly slug: string
  /**
   * Nombre REAL del arma, sin la etiqueta de juego. Se muestra, pero nunca
   * solo: lo que ve el jugador lo arma `sourceWeaponDisplayName()`.
   */
  readonly name: string
  readonly game: SourceGame
  readonly archetype: ArchetypeId
  readonly sight: SourceSightType
}

/**
 * Lo que ve el jugador: `AK-47 (CS)`. Es la ÚNICA función que compone ese
 * texto, para que la etiqueta no quede a veces sí y a veces no según qué
 * pantalla lo arme por su cuenta.
 */
export function sourceWeaponDisplayName(entry: SourceWeaponEntry): string {
  return `${entry.name} (${entry.game})`
}

export const SOURCE_WEAPONS: readonly SourceWeaponEntry[] = [
  // --- Fusiles de asalto -------------------------------------------------
  { slug: 'ak47', name: 'AK-47', game: 'CS', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'm4a4', name: 'M4A4', game: 'CS', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'm4a1s', name: 'M4A1-S', game: 'CS', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'galil', name: 'Galil AR', game: 'CS', archetype: 'ar-1', sight: 'hierros' },
  // Único fusil de ráfaga de 3 del lote: el arquetipo `ar-2` existe
  // exactamente para esto y no hay otro `burst` en el roster.
  { slug: 'famas', name: 'FAMAS', game: 'CS', archetype: 'ar-2', sight: 'hierros' },
  // Bullpup con óptica integrada: más alcance y daño por tiro, menos
  // cadencia. Es el perfil de `ar-3` (fusil de batalla).
  { slug: 'aug', name: 'AUG', game: 'CS', archetype: 'ar-3', sight: 'optica' },
  { slug: 'aug_scopeless', name: 'AUG sin visor', game: 'CS', archetype: 'ar-3', sight: 'hierros' },
  { slug: 'sg553', name: 'SG 553', game: 'CS', archetype: 'ar-3', sight: 'optica' },
  { slug: 'sg553_scopeless', name: 'SG 553 sin visor', game: 'CS', archetype: 'ar-3', sight: 'hierros' },

  // --- Subfusiles --------------------------------------------------------
  // smg-2 (cadencia contenida, más alcance y control) para los dos de
  // cartucho pesado o con supresor; smg-1 (cadencia altísima) para el resto.
  { slug: 'mp5sd', name: 'MP5-SD', game: 'CS', archetype: 'smg-2', sight: 'hierros' },
  { slug: 'ump45', name: 'UMP-45', game: 'CS', archetype: 'smg-2', sight: 'hierros' },
  { slug: 'mp7', name: 'MP7', game: 'CS', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mp9', name: 'MP9', game: 'CS', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mac10', name: 'MAC-10', game: 'CS', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'p90', name: 'P90', game: 'CS', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'bizon', name: 'PP-Bizon', game: 'CS', archetype: 'smg-1', sight: 'hierros' },

  // --- Armas cortas ------------------------------------------------------
  // Todas a `pistol`: es el único arquetipo de arma corta y las diferencias
  // entre ellas (calibre, capacidad) son justamente lo que el spec dice que
  // NO tiene que depender del modelo.
  { slug: 'deagle', name: 'Desert Eagle', game: 'CS', archetype: 'pistol', sight: 'hierros' },
  { slug: 'glock18', name: 'Glock-18', game: 'CS', archetype: 'pistol', sight: 'hierros' },
  { slug: 'usps', name: 'USP-S', game: 'CS', archetype: 'pistol', sight: 'hierros' },
  { slug: 'p2000', name: 'P2000', game: 'CS', archetype: 'pistol', sight: 'hierros' },
  { slug: 'p250', name: 'P250', game: 'CS', archetype: 'pistol', sight: 'hierros' },
  { slug: 'fiveseven', name: 'Five-SeveN', game: 'CS', archetype: 'pistol', sight: 'hierros' },
  { slug: 'cz75', name: 'CZ75-Auto', game: 'CS', archetype: 'pistol', sight: 'hierros' },
  { slug: 'revolver', name: 'R8 Revolver', game: 'CS', archetype: 'pistol', sight: 'hierros' },
  { slug: 'tec9', name: 'Tec-9', game: 'CS', archetype: 'pistol', sight: 'hierros' },

  // --- Precisión ---------------------------------------------------------
  // Cerrojo (un tiro mata a torso) vs. semiautomático de precisión: la
  // diferencia real entre `sniper-bolt` y `sniper-marksman`.
  { slug: 'awp', name: 'AWP', game: 'CS', archetype: 'sniper-bolt', sight: 'optica' },
  { slug: 'awp_scopeless', name: 'AWP sin visor', game: 'CS', archetype: 'sniper-bolt', sight: 'hierros' },
  { slug: 'ssg08', name: 'SSG 08', game: 'CS', archetype: 'sniper-bolt', sight: 'optica' },
  { slug: 'ssg08_scopeless', name: 'SSG 08 sin visor', game: 'CS', archetype: 'sniper-bolt', sight: 'hierros' },
  { slug: 'scar20', name: 'SCAR-20', game: 'CS', archetype: 'sniper-marksman', sight: 'optica' },
  { slug: 'scar20_scopeless', name: 'SCAR-20 sin visor', game: 'CS', archetype: 'sniper-marksman', sight: 'hierros' },
  { slug: 'g3sg1', name: 'G3SG1', game: 'CS', archetype: 'sniper-marksman', sight: 'optica' },
  { slug: 'g3sg1_scopeless', name: 'G3SG1 sin visor', game: 'CS', archetype: 'sniper-marksman', sight: 'hierros' },

  // --- Escopetas ---------------------------------------------------------
  { slug: 'nova', name: 'Nova', game: 'CS', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'xm1014', name: 'XM1014', game: 'CS', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'sawedoff', name: 'Sawed-Off', game: 'CS', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'mag7', name: 'MAG-7', game: 'CS', archetype: 'shotgun', sight: 'hierros' },

  // --- Ametralladoras ----------------------------------------------------
  { slug: 'm249', name: 'M249', game: 'CS', archetype: 'lmg', sight: 'hierros' },
  { slug: 'negev', name: 'Negev', game: 'CS', archetype: 'lmg', sight: 'hierros' },
]

/** Índice por slug, para el pipeline y el registry. */
export const SOURCE_WEAPONS_BY_SLUG: ReadonlyMap<string, SourceWeaponEntry> = new Map(
  SOURCE_WEAPONS.map((e) => [e.slug, e]),
)
