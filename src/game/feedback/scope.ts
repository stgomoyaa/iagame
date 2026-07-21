/**
 * Estampa de mira telescópica: toda la MATEMÁTICA y todos los CRITERIOS del
 * visor, sin una sola línea de DOM. La capa visual que consume esto vive en
 * feedback/overlay.ts (mismo reparto que hitmarkers.ts / damage-numbers.ts /
 * vignette.ts: la lógica es pura y testeable, el DOM es un traductor tonto).
 *
 * ## Por qué superposición a pantalla completa y no render a textura
 *
 * Hay dos formas de hacer que apuntar con un sniper se vea como mirar por un
 * visor:
 *
 * 1. **Superposición** (lo que hace el AWP de Counter-Strike, la referencia
 *    del proyecto): al apuntar, la pantalla se cubre con la óptica — negro
 *    opaco afuera, lente circular al centro, retícula dibujada encima. El
 *    zoom NO lo da la estampa: lo da el FOV que combat/ads.ts ya interpola
 *    (`ads.fovScale`, 0.3 para el cerrojo = ~21° de FOV contra los 70 de
 *    cadera; ver WORLD_FOV en engine/renderer.ts). La estampa es puramente
 *    cosmética.
 * 2. **Render a textura** (picture-in-picture): dibujar la escena una segunda
 *    vez, con una cámara de FOV angosto, dentro del círculo de la lente.
 *
 * Se eligió (1). El motivo NO es sólo que sea más barata (un pase de render
 * extra sobre una escena entera contra un compositado de gradientes), sino
 * que es lo que hace la referencia: en CS el zoom del AWP es un cambio de
 * FOV de la cámara única y el visor es una calcomanía de HUD. Con (2) el
 * mundo dentro de la lente y el mundo de afuera serían dos imágenes
 * distintas, que es un efecto de mira réflex/PiP, no el de un francotirador
 * de CS. Además (2) obligaría a un tercer pase de render en un pipeline que
 * ya tiene dos (mundo + viewmodel) y ~1,1 ms de GPU medidos.
 *
 * Dentro de (1) todavía había una elección: quad + shader en el pipeline de
 * WebGL, o compositado del navegador (CSS) en la capa de feedback. Se eligió
 * lo segundo por el mismo razonamiento ya escrito en la cabecera de
 * feedback/overlay.ts para la viñeta: un gradiente alfa a pantalla completa
 * es un compositado barato del navegador y NO entra al pipeline que mide
 * engine/gpu-timer.ts, así que no le come nada al presupuesto de 2,5 ms de
 * la GPU del juego. Un quad a pantalla completa sí sumaría un draw call, un
 * program y fill-rate de pantalla entera sobre las dos pasadas que ya
 * existen. La contra honesta: el costo de compositor que sí existe queda
 * fuera del alcance de EXT_disjoint_timer_query_webgl2 y hay que medirlo
 * aparte, por tiempo de frame. Medido en nuketown con el AWP en ADS, quitando
 * y reponiendo la capa: draws y triángulos idénticos (53 / 71,2k), y la
 * diferencia de GPU entre las dos condiciones queda por debajo de la varianza
 * entre corridas de una misma condición.
 *
 * ## Qué armas llevan estampa
 *
 * Ver `scopeReticleForWeapon()` más abajo: es la regla, con su porqué.
 */

import type { ArchetypeId } from '@/game/weapons/archetypes'
import { SOURCE_WEAPONS_BY_SLUG, type SourceSightType } from '@/game/weapons/source-catalog'

/**
 * Qué retícula dibuja el visor. No es decorado: son dos armas distintas.
 *
 * - `mildot`: cerrojo (`sniper-bolt`). La cruz fina que cruza la pantalla
 *   ENTERA más los puntos de milésima sobre los cuatro brazos — la estampa
 *   del AWP de CS, tal cual. Los mildots son la referencia de compensación
 *   por caída/adelanto de un rifle de precisión puro.
 * - `duplex`: semiautomático de precisión (`sniper-marksman`). Retícula
 *   duplex: postes gruesos desde el borde de la lente que se afinan hacia el
 *   centro, punto central, y SIN las líneas a pantalla completa. Es la mira
 *   de un DMR: campo más limpio para reencuadrar entre disparos, que es lo
 *   que distingue jugar un marksman de jugar un cerrojo.
 */
export type ScopeReticle = 'mildot' | 'duplex'

/**
 * Arquetipos que, TENIENDO óptica, reciben estampa. La condición es una
 * conjunción a propósito (ver scopeReticleForWeapon): ni el arquetipo solo
 * ni la mira sola alcanzan.
 */
const RETICLE_BY_ARCHETYPE: Partial<Record<ArchetypeId, ScopeReticle>> = {
  'sniper-bolt': 'mildot',
  'sniper-marksman': 'duplex',
}

/**
 * Decide si un arma lleva estampa de visor y cuál. `null` = no lleva, y el
 * ADS de esa arma sigue exactamente el camino de siempre, sin tocar un solo
 * píxel (la alineación de hierros de fusil/subfusil/pistola está medida con
 * desvío de 0 a 1 px sobre 1280 y esta tarea no la puede rozar).
 *
 * La regla es la CONJUNCIÓN de dos cosas, y ninguna de las dos sola sirve:
 *
 * - **Por propiedad del arma** (`sight === 'optica'`, declarada a mano en
 *   weapons/source-catalog.ts). Hace falta porque el catálogo tiene
 *   variantes `*_scopeless`: el MISMO arma sin el visor, mismo arquetipo,
 *   `sight: 'hierros'`. `awp_scopeless` es un cerrojo `sniper-bolt` sin
 *   óptica encima — taparle la pantalla con un tubo negro sería dibujar un
 *   visor que el modelo no tiene. Un criterio "por arquetipo" solo se las
 *   comería a las seis.
 * - **Por arquetipo** (`sniper-bolt` / `sniper-marksman`). Hace falta porque
 *   `optica` no implica visor telescópico: `aug` y `sg553` son fusiles de
 *   asalto (`ar-3`) con óptica integrada y están marcados `optica` — su
 *   `fovScale` es 0.85, un acercamiento leve, y CS tampoco les tapa la
 *   pantalla al apuntar, sólo les acerca la imagen. Un criterio "por
 *   propiedad" solo le pondría tubo de francotirador a dos fusiles de
 *   asalto.
 *
 * Un arma sin fila en el catálogo de Source (`sight === undefined`: las CC0
 * de public/assets/weapons/, que nunca declararon tipo de mira) no lleva
 * estampa. Es el default seguro: sin dato no se inventa un visor, y el
 * camino de hierros queda intacto.
 */
export function scopeReticleForWeapon(
  archetypeId: ArchetypeId | null,
  sight: SourceSightType | undefined,
): ScopeReticle | null {
  if (archetypeId === null) return null
  if (sight !== 'optica') return null
  return RETICLE_BY_ARCHETYPE[archetypeId] ?? null
}

/** Tipo de mira declarado para `slug`, o undefined si el arma no está en el
 *  catálogo de Source (ver scopeReticleForWeapon para qué implica eso). */
export function sightForSlug(slug: string | null): SourceSightType | undefined {
  if (slug === null) return undefined
  return SOURCE_WEAPONS_BY_SLUG.get(slug)?.sight
}

/**
 * Números de la estampa. Mismo patrón que feedback/tuning.ts: todo junto y
 * mutable, para que un panel de debug futuro los pueda mover en caliente.
 */
export const SCOPE = {
  /**
   * Radio de la lente como fracción del lado MENOR de la pantalla. 0.46 deja
   * el círculo casi tocando arriba y abajo en un monitor apaisado (0.92 del
   * alto) con un anillo negro fino de sobra — la proporción del AWP de CS.
   * Se ata al lado menor y no al alto para que la lente siga siendo un
   * círculo entero y no se salga por arriba en una ventana más alta que
   * ancha (una ventana de navegador acoplada, por ejemplo).
   */
  lensRadiusFraction: 0.46,
  /**
   * A partir de qué punto de la transición de ADS (ya pasada por
   * easeInOutCubic, la MISMA curva de la pose del arma y del FOV) empieza a
   * aparecer la estampa. No es 0: con el negro entrando desde el primer
   * instante, la pantalla se tapa mientras el FOV todavía está a medio
   * acercar y se lee como un parpadeo, no como levantar el arma. Entrando en
   * el último ~45% de la transición, el tubo termina de cerrarse justo
   * cuando el zoom termina de llegar. Y como usa la misma `easedAdsT` en los
   * dos sentidos, salir de ADS es la misma curva al revés: tampoco hay salto
   * seco al bajar el arma.
   */
  fadeStartT: 0.55,
  /**
   * Escala de la lente al arrancar el fundido, que cae a 1 al completarse.
   * Un 8% de "el tubo se acerca al ojo" mientras aparece: sin esto la
   * estampa es un fundido plano y se lee como una calcomanía que aparece
   * encima, no como acercar el ojo a la óptica.
   */
  lensZoomIn: 1.08,
  /** Opacidad de la mira normal en cadera (la que ya tenía overlay.ts). */
  crosshairOpacity: 0.85,
  /** Cuántos mildots por brazo (cuatro brazos) en la retícula `mildot`. */
  mildotsPerArm: 4,
  /** Separación entre mildots, como fracción del radio de lente. */
  mildotSpacingFraction: 0.19,
  /** Diámetro de un mildot, px. */
  mildotSizePx: 3,
  /**
   * Opacidad de estampa a partir de la cual el arma deja de dibujarse. Ver
   * `weaponHiddenByScope()`.
   */
  hideWeaponAtAlpha: 0.5,
  /** Dónde termina el poste grueso de la retícula `duplex` y empieza el
   *  tramo fino, como fracción del radio de lente. */
  duplexThickInnerFraction: 0.36,
  /** Hueco central de la retícula `duplex`, fracción del radio de lente: el
   *  punto de puntería tiene que quedar despejado. */
  duplexCenterGapFraction: 0.06,
}

/** Curva de Hermite, 0 en 0 y 1 en 1 con pendiente nula en ambos extremos.
 *  Local a este módulo (archetypes.ts tiene la suya, privada). */
function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/**
 * Opacidad de la estampa para un `easedAdsT` dado (adsT ya pasado por
 * easeInOutCubic en game.ts, el mismo valor que alimenta FOV y sensibilidad).
 * 0 hasta `fadeStartT`, y de ahí a 1 con una S sin discontinuidad de
 * pendiente en ninguno de los dos empalmes.
 */
export function scopeAlpha(easedAdsT: number): number {
  const span = 1 - SCOPE.fadeStartT
  if (span <= 0) return easedAdsT >= 1 ? 1 : 0
  return smoothstep((easedAdsT - SCOPE.fadeStartT) / span)
}

/** Escala de la lente mientras aparece: `lensZoomIn` con la estampa recién
 *  asomando, exactamente 1 con la estampa completa. Nunca baja de 1, así el
 *  negro de los bordes cubre la pantalla entera en todo momento. */
export function scopeLensScale(alpha: number): number {
  return SCOPE.lensZoomIn + (1 - SCOPE.lensZoomIn) * Math.min(1, Math.max(0, alpha))
}

/** Opacidad de la mira normal: se apaga a medida que entra la estampa. Las
 *  dos miras juntas serían dos puntos de puntería en pantalla. */
export function crosshairOpacityUnderScope(alpha: number): number {
  return SCOPE.crosshairOpacity * (1 - Math.min(1, Math.max(0, alpha)))
}

/**
 * Si el arma tiene que dejar de dibujarse. Mirando por un visor no se ve el
 * arma: se ve lo que hay del otro lado del vidrio. CS esconde el viewmodel
 * al entrar en mira y lo devuelve al salir, y sin esto el cuerpo del rifle
 * —que en cadera vive abajo a la derecha, fuera del camino— se planta en el
 * centro exacto de la lente y tapa medio campo de visión. Verificado en
 * pantalla: es lo primero que se ve mal en una captura de ADS con el AWP.
 *
 * Es binario y no un fundido a propósito: fundir el arma exigiría tocar la
 * opacidad de sus materiales (weapons/skins), que es otro subsistema entero.
 * El umbral está a mitad del fundido de la estampa y no en su arranque
 * porque ahí el tubo ya tapa la mitad de la pantalla y el viñeteo de la
 * lente ya oscureció el resto: el corte cae en el instante en que la imagen
 * más está cambiando por otras razones, que es donde menos se nota.
 */
export function weaponHiddenByScope(alpha: number): boolean {
  return alpha >= SCOPE.hideWeaponAtAlpha
}

/** Radio de la lente en píxeles para un canvas de `width` x `height`. */
export function scopeLensRadiusPx(width: number, height: number): number {
  return Math.min(width, height) * SCOPE.lensRadiusFraction
}

/** Distancia al centro del mildot `index` (0-based) sobre un brazo, px. */
export function mildotOffsetPx(index: number, lensRadiusPx: number): number {
  return (index + 1) * SCOPE.mildotSpacingFraction * lensRadiusPx
}
