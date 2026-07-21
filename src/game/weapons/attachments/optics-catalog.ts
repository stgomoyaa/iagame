/**
 * Catálogo de ÓPTICAS (miras) y su anclaje sobre cada arma. Es la primera
 * categoría del sistema de accesorios, y en esta fase es PURAMENTE COSMÉTICA:
 * una óptica montada se ve sobre el arma, pero no toca ninguna estadística
 * (daño, retroceso, ADS). El efecto en stats es una fase futura.
 *
 * Este archivo es DATO PURO: no importa three. El borde con la escena (armar
 * la malla, dibujar la retícula) vive en `mount.ts`. La separación es la misma
 * que usa el resto de src/game (lógica pura + un único archivo que toca la
 * GPU), y es lo que deja testear el anclaje y el desbloqueo sin un canvas.
 *
 *
 * DE DÓNDE SALEN LOS MODELOS
 *
 * Del pack ARC9 Modern Warfare Classic (workshop-assets/cod-arc9), convertidos
 * a GLB por `scripts/convert-opticas.ts`. Del pack sale SÓLO el cuerpo de la
 * mira; el punto rojo / la retícula la dibuja el juego (ver `ReticulaDef` y
 * `mount.ts`), porque NINGÚN pack la hornea: ARC9/ArcCW/TFA la dibujan por
 * código, y nosotros también.
 *
 *
 * LOS DOS ESPACIOS DE COORDENADAS (esto es lo que se hace mal)
 *
 * El GLB del arma (public/assets/weapons-local, normalizado por
 * `convert-source-weapons.ts`) y el GLB de la óptica (crudo de
 * `mdl-to-glb.py`) NO están en el mismo frame:
 *
 * - Arma normalizada: adelante = -Z, arriba = +Y, ancho = X. Un rifle mide
 *   0,85 m sobre Z (todas las clases se reescalan a un largo canónico).
 * - Óptica cruda: adelante = +X (objetivo), arriba = +Y, ancho = Z. En metros
 *   reales (un red dot mide ~9 cm sobre X).
 *
 * Por eso el ancla lleva una ROTACIÓN base de +90° sobre Y: mapea el frame de
 * la óptica al del arma (óptica +X -> arma -Z). Y una ESCALA ~1.0 para rifles,
 * porque la óptica en metros reales ya cae casi a escala del arma reescalada a
 * 0,85 m. Los dos números se afinan por arma MIRANDO el resultado en el banco
 * (`src/app/optics-harness`), no de una fórmula: el juez de si la mira está
 * en el riel es la captura, no un test verde.
 */

import { nivelDeArma } from '@/game/progression/weapon-xp'

/** Media vuelta de cuarto: rotación base que alinea el frame de la óptica
 *  (adelante +X) con el del arma (adelante -Z). Ver la cabecera. */
const BASE_YAW = Math.PI / 2

export type OpticaId =
  | 'optic_reddot_m68'
  | 'optic_reflex_mw3'
  | 'optic_holo_eotech'
  | 'optic_holo_cod4'
  | 'optic_acog'
  | 'optic_hamr'

/** Familias visuales de mira. En esta fase sólo cambian cómo se ve la
 *  retícula; en la fase de stats decidirían zoom/ADS. */
export type CategoriaOptica = 'red_dot' | 'holografica' | 'magnificada'

/** Cómo se dibuja la retícula por código (nunca horneada). El punto rojo es un
 *  quad aditivo; estos números lo describen sin tocar three. */
export interface ReticulaDef {
  /**
   * - `punto`: un solo punto (red dot).
   * - `holo`: anillo con punto al centro (holográfica estilo EOTech).
   * - `chevron`: cheurón + retícula de puntería (ACOG magnificado).
   */
  forma: 'punto' | 'holo' | 'chevron'
  /** Color del emisivo, hex RGB. Rojo por defecto; el holo suele ir verde. */
  color: number
  /** Lado del quad de la retícula, en metros del espacio del arma. Chico: un
   *  red dot es un puntito, no un disco. */
  ladoMundo: number
  /** Multiplicador de brillo del aditivo. >1 lo hace destacar sobre la lente. */
  intensidad: number
}

export interface OpticaDef {
  id: OpticaId
  /** Nombre que ve el jugador (de la definición Lua del pack). */
  nombre: string
  /** Slug del asset: `/assets/weapons-local/<glbSlug>.glb`. */
  glbSlug: string
  categoria: CategoriaOptica
  reticula: ReticulaDef
  /**
   * Centro de la LENTE en el espacio LOCAL de la óptica (metros), donde se
   * dibuja la retícula. Arranca del centro geométrico medido del GLB y se
   * afina en el banco. La óptica tiene su origen en el pie de montaje, así que
   * la lente está por encima (+Y) y hacia el ocular.
   */
  lente: readonly [number, number, number]
  /**
   * Nivel de arma (2..5) en que esta óptica se desbloquea. Se apoya en la
   * curva ya calibrada de `weapon-xp.ts` (5 niveles, ascensos en 2..5): el
   * nivel de arma ya era el gancho para "levear el arma", sólo que hasta ahora
   * sólo pagaba camos porque no existía sistema de accesorios. Ahora paga
   * también ópticas. No se rediseña la progresión: se cuelga de ella.
   */
  nivelDesbloqueo: number
}

/**
 * Las 6 ópticas convertidas. Elegidas por ser las más DISTINTAS: dos red dot,
 * dos holográficas (una de época CoD4), y dos magnificadas. Los `lente` y las
 * escalas se afinaron en el banco.
 */
export const OPTICAS: Readonly<Record<OpticaId, OpticaDef>> = {
  optic_reddot_m68: {
    id: 'optic_reddot_m68',
    nombre: 'Aimpoint Comp M2',
    glbSlug: 'optic_reddot_m68',
    categoria: 'red_dot',
    reticula: { forma: 'punto', color: 0xff2b2b, ladoMundo: 0.012, intensidad: 1.6 },
    lente: [-0.028, 0.024, -0.002],
    nivelDesbloqueo: 2,
  },
  optic_reflex_mw3: {
    id: 'optic_reflex_mw3',
    nombre: 'Reflex MW3',
    glbSlug: 'optic_reflex_mw3',
    categoria: 'red_dot',
    reticula: { forma: 'punto', color: 0xff2b2b, ladoMundo: 0.011, intensidad: 1.6 },
    lente: [-0.014, 0.013, 0],
    nivelDesbloqueo: 2,
  },
  optic_holo_eotech: {
    id: 'optic_holo_eotech',
    nombre: 'EOTech EXPS3',
    glbSlug: 'optic_holo_eotech',
    categoria: 'holografica',
    reticula: { forma: 'holo', color: 0xff3838, ladoMundo: 0.02, intensidad: 1.5 },
    lente: [-0.016, 0.019, -0.004],
    nivelDesbloqueo: 3,
  },
  optic_holo_cod4: {
    id: 'optic_holo_cod4',
    nombre: 'Holográfica CoD4',
    glbSlug: 'optic_holo_cod4',
    categoria: 'holografica',
    reticula: { forma: 'holo', color: 0xff3838, ladoMundo: 0.018, intensidad: 1.5 },
    lente: [-0.006, 0.016, -0.002],
    nivelDesbloqueo: 3,
  },
  optic_acog: {
    id: 'optic_acog',
    nombre: 'Trijicon ACOG 4x',
    glbSlug: 'optic_acog',
    categoria: 'magnificada',
    reticula: { forma: 'chevron', color: 0xff2b2b, ladoMundo: 0.016, intensidad: 1.7 },
    lente: [-0.03, 0.02, -0.001],
    nivelDesbloqueo: 4,
  },
  optic_hamr: {
    id: 'optic_hamr',
    nombre: 'HAMR',
    glbSlug: 'optic_hamr',
    categoria: 'magnificada',
    reticula: { forma: 'chevron', color: 0xff2b2b, ladoMundo: 0.015, intensidad: 1.7 },
    lente: [-0.03, 0.024, -0.001],
    nivelDesbloqueo: 5,
  },
}

/** Orden estable para la UI y el banco. */
export const OPTICAS_ORDEN: readonly OpticaId[] = [
  'optic_reddot_m68',
  'optic_reflex_mw3',
  'optic_holo_eotech',
  'optic_holo_cod4',
  'optic_acog',
  'optic_hamr',
]

/**
 * Dónde se monta una óptica sobre un arma. Todo en el espacio NORMALIZADO del
 * arma (mismo que `bounds`/`muzzle` del índice), metros.
 */
export interface AnclaOptica {
  /** Pie de montaje de la óptica sobre el riel. */
  pos: readonly [number, number, number]
  /** Rotación euler (rad) del frame de la óptica al del arma. Base
   *  (0, +PI/2, 0); se corrige por arma sólo si el modelo lo pide. */
  rot: readonly [number, number, number]
  /** Escala uniforme de la óptica sobre el arma. ~1.0 en rifles. */
  escala: number
}

/**
 * Anclas por arma. En esta fase se llenaron 5 rifles de COD representativos,
 * afinados en el banco. Las Y salen de `sightHeight` del índice (el techo de
 * la silueta, o sea el riel), las Z se corrieron a media caña, y las X quedaron
 * ~0 (centradas en la línea de puntería).
 *
 * EL COSTO REAL DE ESTA CAPA es llenar estos datos para las 69 armas de COD:
 * cada una es una medición + un ajuste a ojo. Se deja como llenado INCREMENTAL
 * documentado (ver `docs/OPTICAS.md`): agregar un arma es medir su
 * `sightHeight`, poner el ancla acá, y verificar en el banco. Un arma sin
 * ancla simplemente no puede montar óptica todavía (`anclaDe` devuelve null),
 * que es honesto: mejor sin mira que con una mira flotando.
 */
export const ANCLAS: Readonly<Record<string, AnclaOptica>> = {
  // Valores afinados en el banco (docs/opticas-capturas): la mira queda
  // asentada sobre el riel/tapa, con el punto rojo mirando al tirador.
  cod4_ak47: { pos: [-0.002, 0.083, 0.04], rot: [0, BASE_YAW, 0], escala: 1.0 },
  mw2e_acr: { pos: [0.0, 0.098, 0.05], rot: [0, BASE_YAW, 0], escala: 1.0 },
  mw3e_m4a1: { pos: [-0.004, 0.092, 0.05], rot: [0, BASE_YAW, 0], escala: 1.0 },
  mw3e_scarl: { pos: [0.006, 0.102, 0.03], rot: [0, BASE_YAW, 0], escala: 1.0 },
  mw2e_scar: { pos: [0.006, 0.091, 0.05], rot: [0, BASE_YAW, 0], escala: 1.0 },
}

/** Ancla de un arma, o null si todavía no tiene (llenado incremental). */
export function anclaDe(slug: string): AnclaOptica | null {
  return ANCLAS[slug] ?? null
}

/** True si el arma puede montar ópticas (tiene ancla). */
export function armaPuedeMontarOptica(slug: string): boolean {
  return slug in ANCLAS
}

export function opticaDef(id: OpticaId): OpticaDef {
  return OPTICAS[id]
}

/**
 * URL del GLB de una óptica. Vive en el mismo directorio local (gitignoreado)
 * que las armas de COD: `convert-opticas.ts` deja ahí el binario. No pasa por el
 * registry de armas —una óptica no es un arma— así que se arma la URL a mano.
 */
export function opticAssetUrl(id: OpticaId): string {
  return `/assets/weapons-local/${OPTICAS[id].glbSlug}.glb`
}

/**
 * Ópticas DESBLOQUEADAS para un arma dada su XP de arma. Se apoya en
 * `nivelDeArma` (weapon-xp.ts): una óptica está disponible si su
 * `nivelDesbloqueo` es menor o igual al nivel actual del arma. Pura y
 * determinista: la misma XP da siempre la misma lista.
 */
export function opticasDesbloqueadas(xpDeArma: number): OpticaId[] {
  const nivel = nivelDeArma(xpDeArma)
  return OPTICAS_ORDEN.filter((id) => OPTICAS[id].nivelDesbloqueo <= nivel)
}

/** True si una óptica está desbloqueada a esa XP de arma. */
export function opticaDesbloqueada(id: OpticaId, xpDeArma: number): boolean {
  return OPTICAS[id].nivelDesbloqueo <= nivelDeArma(xpDeArma)
}
