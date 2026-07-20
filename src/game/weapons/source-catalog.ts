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

import type { ArchetypeId, TacticalStyle } from '@/game/weapons/archetypes'

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
 * elige por ella ("hoy juego estilo COD").
 *
 * El tipo se dejó como unión de un solo miembro esperando exactamente esto, y
 * sumar COD fue agregar el miembro: ni una convención de texto nueva, ni una
 * columna más, ni tocar `sourceWeaponDisplayName()`.
 *
 * Que la etiqueta viva en el catálogo (y no pegada dentro de `name`) es lo que
 * permite que dos armas homónimas de packs distintos convivan: el nombre real
 * puede repetirse entre juegos, la combinación nombre+juego no. Con COD
 * adentro eso dejó de ser hipotético — hay un AK-47, un FAMAS, un AUG, un P90,
 * un MP7, un MP9, una Desert Eagle, una Five-seveN y un M249 en los DOS packs,
 * y conviven como `AK-47 (CS)` y `AK-47 (COD)`.
 */
export type SourceGame = 'CS' | 'COD'

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

  // =======================================================================
  // PACK DE CALL OF DUTY (ARC9): 69 armas de los 103 modelos `c_*.mdl`.
  // =======================================================================
  //
  // Mismas tres columnas y mismo criterio que arriba. Lo que cambia es de
  // dónde salen los modelos y, por lo tanto, qué hubo que decidir:
  //
  // **Los 34 modelos que NO entraron, y por qué.** Ninguno se descartó por
  // "no me gustó": cada motivo es estructural.
  //
  // - **11 no son armas de fuego de mano**: cinco lanzacohetes (`rpg7`,
  //   `at4`, `javelin`, `stinger`, `smaw`), tres lanzagranadas (`m79`,
  //   `m320`, `xm25`), una granada (`frag`), un escudo antidisturbios
  //   (`riotshield`, cuya caja de 0.12 x 0.42 x 0.71 m ya dice que no es un
  //   arma) y un `item`. No hay arquetipo al que mapearlos sin inventar uno,
  //   y inventar arquetipos está prohibido.
  // - **1 es de puño doble** (`1887_akimbo`), exactamente el caso de `elite`
  //   y `mac10_dual` de CS: dos armas espejadas en el mismo plano, que el rig
  //   de viewmodel no puede posar. Mismo motivo, misma decisión.
  // - **22 son el MISMO arma repetida en otro pack de COD.** El AK-47 viene
  //   en `cod4`, `mw2e` y `mw3e`; la M1911 en `cod4` y `mw3e` (955 triángulos
  //   las dos: es el mismo archivo). Entrarían como tres `AK-47 (COD)`, que
  //   ni siquiera es representable — el nombre mostrado tiene que ser único.
  //   Se eligió UN modelo por arma real, el de malla más limpia, y se
  //   descartaron los demás.
  //
  // **La escala del pack no se toca.** Los `c_` de COD miden distinto que los
  // `w_` de CS (el AK-47 de COD 0.71 m contra 0.80 m del de CS), pero eso no
  // llega a este archivo: `buildNormalizeMatrix` reescala cada arma al largo
  // canónico de su clase, así que las dos salen midiendo lo mismo. Lo que sí
  // cambia por pack es la ORIENTACIÓN (eje largo en +X acá, en +Z en CS), y
  // vive en `RAW_AXES_BY_GAME` de convert-source-weapons.ts.
  //
  // **Ninguna trae cargador separable.** Los `w_` de CS traen el cargador como
  // malla aparte (`weapon_mag`) y por eso la recarga lo puede sacar y poner.
  // En los `c_` de COD el cargador es un HUESO (`tag_clip`), no una malla, y
  // el pipeline descarta el esqueleto: salen con un solo nodo. La consecuencia
  // es concreta y conocida — estas 69 recargan con la coreografía procedural
  // sola, como las 40 CC0, no con el cargador animado. Cuestan 1 draw call en
  // vez de 2.

  // --- COD: fusiles de asalto --------------------------------------------
  // `ar-1` es la línea base: automático, cartucho intermedio.
  { slug: 'cod4_ak47', name: 'AK-47', game: 'COD', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'mw3e_m4a1', name: 'M4A1', game: 'COD', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'mw2e_acr', name: 'ACR', game: 'COD', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'cod4_g36c', name: 'G36C', game: 'COD', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'mw3e_g36', name: 'G36', game: 'COD', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'mw2e_f2000', name: 'F2000', game: 'COD', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'mw2e_tavor', name: 'TAR-21', game: 'COD', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'cod4_mp44', name: 'STG-44', game: 'COD', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'mw3e_scarl', name: 'SCAR-L', game: 'COD', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'mw3e_fad', name: 'FAD', game: 'COD', archetype: 'ar-1', sight: 'hierros' },
  { slug: 'mw3e_cm901', name: 'CM901', game: 'COD', archetype: 'ar-1', sight: 'hierros' },

  // Ráfaga de 3 -> `ar-2`, el único arquetipo `burst`. Las tres lo son en su
  // juego de origen, y es la razón por la que se las eligió para este
  // arquetipo y no por su silueta.
  { slug: 'mw2e_m16', name: 'M16A4', game: 'COD', archetype: 'ar-2', sight: 'hierros' },
  { slug: 'mw2e_famas', name: 'FAMAS', game: 'COD', archetype: 'ar-2', sight: 'hierros' },
  { slug: 'mw3e_qbz97', name: 'Type 95', game: 'COD', archetype: 'ar-2', sight: 'hierros' },

  // Fusil de batalla (7.62, más daño y alcance, menos cadencia) -> `ar-3`.
  { slug: 'mw2e_scar', name: 'SCAR-H', game: 'COD', archetype: 'ar-3', sight: 'hierros' },
  { slug: 'mw2e_fnfal', name: 'FN FAL', game: 'COD', archetype: 'ar-3', sight: 'hierros' },
  { slug: 'cod4_g3', name: 'G3', game: 'COD', archetype: 'ar-3', sight: 'hierros' },
  { slug: 'cod4_m14', name: 'M14', game: 'COD', archetype: 'ar-3', sight: 'hierros' },
  { slug: 'mw2e_aug', name: 'AUG HBAR', game: 'COD', archetype: 'ar-3', sight: 'hierros' },

  // --- COD: subfusiles ---------------------------------------------------
  // Mismo corte que en CS: `smg-2` para los de cartucho pesado o cañón corto
  // de fusil (cadencia contenida, más alcance); `smg-1` para el resto.
  { slug: 'cod4_mp5', name: 'MP5', game: 'COD', archetype: 'smg-2', sight: 'hierros' },
  { slug: 'mw3e_ump45', name: 'UMP45', game: 'COD', archetype: 'smg-2', sight: 'hierros' },
  { slug: 'mw3e_ak74u', name: 'AK-74u', game: 'COD', archetype: 'smg-2', sight: 'hierros' },
  { slug: 'mw2e_mp5k', name: 'MP5K', game: 'COD', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'cod4_uzi', name: 'Uzi', game: 'COD', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'cod4_p90', name: 'P90', game: 'COD', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'cod4_skorpion', name: 'Skorpion', game: 'COD', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mw2e_vector', name: 'Vector', game: 'COD', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mw2e_pp2000', name: 'PP-2000', game: 'COD', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mw3e_pp90m1', name: 'PP90M1', game: 'COD', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mw3e_mp7', name: 'MP7', game: 'COD', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mw3e_mp9', name: 'MP9', game: 'COD', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mw3e_fmg9', name: 'FMG9', game: 'COD', archetype: 'smg-1', sight: 'hierros' },
  { slug: 'mw3e_pm9', name: 'PM-9', game: 'COD', archetype: 'smg-1', sight: 'hierros' },

  // --- COD: escopetas ----------------------------------------------------
  { slug: 'cod4_w1200', name: 'W1200', game: 'COD', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'cod4_m1014', name: 'M1014', game: 'COD', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'mw2e_spas12', name: 'SPAS-12', game: 'COD', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'mw3e_striker', name: 'Striker', game: 'COD', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'mw3e_aa12', name: 'AA-12', game: 'COD', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'mw3e_ksg12', name: 'KSG 12', game: 'COD', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'mw3e_usas12', name: 'USAS 12', game: 'COD', archetype: 'shotgun', sight: 'hierros' },
  { slug: 'mw3e_m1887', name: 'Model 1887', game: 'COD', archetype: 'shotgun', sight: 'hierros' },

  // --- COD: precisión ----------------------------------------------------
  // Cerrojo -> `sniper-bolt`; semiautomático de precisión ->
  // `sniper-marksman`. Las diez van con `optica` porque en estos modelos el
  // visor viene MODELADO DENTRO del cuerpo (a diferencia de CS, donde es una
  // pieza aparte y por eso existen las variantes `_scopeless`). Acá no hay
  // variante sin visor que ofrecer: sacarlo implicaría editar la malla.
  { slug: 'cod4_m40a3', name: 'M40A3', game: 'COD', archetype: 'sniper-bolt', sight: 'optica' },
  { slug: 'cod4_r700', name: 'R700', game: 'COD', archetype: 'sniper-bolt', sight: 'optica' },
  { slug: 'mw2e_cheytac', name: 'Intervention', game: 'COD', archetype: 'sniper-bolt', sight: 'optica' },
  { slug: 'mw3e_awm', name: 'L118A', game: 'COD', archetype: 'sniper-bolt', sight: 'optica' },
  { slug: 'mw3e_msr', name: 'MSR', game: 'COD', archetype: 'sniper-bolt', sight: 'optica' },
  { slug: 'cod4_m82', name: 'Barrett .50cal', game: 'COD', archetype: 'sniper-marksman', sight: 'optica' },
  { slug: 'mw3e_as50', name: 'AS50', game: 'COD', archetype: 'sniper-marksman', sight: 'optica' },
  { slug: 'cod4_dragunov', name: 'Dragunov', game: 'COD', archetype: 'sniper-marksman', sight: 'optica' },
  { slug: 'mw3e_rsass', name: 'RSASS', game: 'COD', archetype: 'sniper-marksman', sight: 'optica' },
  { slug: 'mw3e_mk14', name: 'Mk14 EBR', game: 'COD', archetype: 'sniper-marksman', sight: 'optica' },

  // --- COD: ametralladoras -----------------------------------------------
  { slug: 'cod4_m249', name: 'M249 SAW', game: 'COD', archetype: 'lmg', sight: 'hierros' },
  { slug: 'cod4_m60', name: 'M60E4', game: 'COD', archetype: 'lmg', sight: 'hierros' },
  { slug: 'cod4_rpd', name: 'RPD', game: 'COD', archetype: 'lmg', sight: 'hierros' },
  { slug: 'mw2e_m240', name: 'M240', game: 'COD', archetype: 'lmg', sight: 'hierros' },
  { slug: 'mw2e_mg4', name: 'MG4', game: 'COD', archetype: 'lmg', sight: 'hierros' },
  { slug: 'mw3e_mk46', name: 'Mk46', game: 'COD', archetype: 'lmg', sight: 'hierros' },
  { slug: 'mw3e_pkp', name: 'PKP Pecheneg', game: 'COD', archetype: 'lmg', sight: 'hierros' },
  { slug: 'mw3e_l86', name: 'L86 LSW', game: 'COD', archetype: 'lmg', sight: 'hierros' },
  { slug: 'mw3e_mg36', name: 'MG36', game: 'COD', archetype: 'lmg', sight: 'hierros' },

  // --- COD: armas cortas -------------------------------------------------
  // Todas a `pistol`, igual que en CS: es el único arquetipo de arma corta.
  { slug: 'cod4_m1911', name: 'M1911', game: 'COD', archetype: 'pistol', sight: 'hierros' },
  { slug: 'cod4_m9', name: 'M9', game: 'COD', archetype: 'pistol', sight: 'hierros' },
  { slug: 'cod4_usp', name: 'USP .45', game: 'COD', archetype: 'pistol', sight: 'hierros' },
  { slug: 'mw2e_g17', name: 'G18', game: 'COD', archetype: 'pistol', sight: 'hierros' },
  { slug: 'mw3e_deagle', name: 'Desert Eagle', game: 'COD', archetype: 'pistol', sight: 'hierros' },
  { slug: 'mw3e_fiveseven', name: 'Five-seveN', game: 'COD', archetype: 'pistol', sight: 'hierros' },
  { slug: 'mw3e_p99', name: 'P99', game: 'COD', archetype: 'pistol', sight: 'hierros' },
  { slug: 'mw3e_anaconda', name: '.44 Magnum', game: 'COD', archetype: 'pistol', sight: 'hierros' },
  { slug: 'mw3e_mp412', name: 'MP-412 REX', game: 'COD', archetype: 'pistol', sight: 'hierros' },
]

/** Índice por slug, para el pipeline y el registry. */
export const SOURCE_WEAPONS_BY_SLUG: ReadonlyMap<string, SourceWeaponEntry> = new Map(
  SOURCE_WEAPONS.map((e) => [e.slug, e]),
)

/**
 * Estilo táctico de un arma por su slug (el eje CS/COD que pidió el dueño).
 * Es la ÚNICA fuente de esta decisión: el estilo sale de la PROCEDENCIA del
 * arma (de qué pack real vino), no del arquetipo ni del modelo.
 *
 * - Un arma del pack CS -> `cs`; del pack COD -> `cod`.
 * - Un slug que no está en este catálogo -> `neutral`. Son las 40 CC0 (nunca
 *   declararon procedencia real) y cualquier slug desconocido: el default
 *   seguro es el punto medio, no inventarle un bando (ver EFFECTIVE_ARCHETYPES
 *   en archetypes.ts para el porqué de que las CC0 queden neutrales).
 */
export function tacticalStyleForSlug(slug: string | null): TacticalStyle {
  if (slug === null) return 'neutral'
  const source = SOURCE_WEAPONS_BY_SLUG.get(slug)
  if (source === undefined) return 'neutral'
  return source.game === 'CS' ? 'cs' : 'cod'
}

/**
 * Si el arma permite ADS (apuntar con el botón derecho centrando el arma).
 *
 * La regla del eje CS/COD: en Counter-Strike las armas de HIERROS no apuntan
 * —se disparan a la cadera y la precisión la da quedarse quieto y tapear—, así
 * que el botón derecho no debe centrarlas. Todo lo demás SÍ apunta:
 *
 * - CS con ÓPTICA (AWP, SSG08, SCAR-20, G3SG1): conserva su mira telescópica,
 *   con su zoom real. "Sin ADS" es sólo para los hierros de CS; borrarlo acá
 *   rompería la mira del sniper (ver feedback/scope.ts: la estampa se apoya en
 *   que estas armas entren en ADS).
 * - COD: apunta normal, sea hierros u óptica. Es la gracia del estilo.
 * - CC0 / desconocido: apunta normal. Sin procedencia no se le quita el ADS.
 *
 * Apagar el ADS acá cascadea solo: game.ts fuerza el input de apuntado a false
 * para estas armas, así vmState.adsT nunca sube y FOV/sensibilidad/velocidad
 * se quedan en base sin tocar combat/ads.ts.
 */
export function weaponAllowsAds(slug: string | null): boolean {
  const source = slug === null ? undefined : SOURCE_WEAPONS_BY_SLUG.get(slug)
  if (source === undefined) return true
  return !(source.game === 'CS' && source.sight === 'hierros')
}
