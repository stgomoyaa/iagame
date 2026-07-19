/**
 * Tabla de perfiles de sensibilidad por juego.
 *
 * `yaw` es el valor que define todo: grados de rotación horizontal por cada
 * conteo del mouse, a sensibilidad 1.0. Dos juegos con el mismo yaw comparten
 * escala de sensibilidad; convertir entre ellos es multiplicar por 1.
 *
 * HONESTIDAD SOBRE ESTOS NÚMEROS: sólo se exponen en la UI los perfiles con
 * `verified: true`. Un yaw incorrecto no falla ruidosamente, produce una
 * conversión silenciosamente equivocada, y el jugador reconstruye su memoria
 * muscular sobre un número malo. Es peor que no ofrecer el juego.
 *
 * Cada valor verificado se cruzó contra un cm/360 público conocido:
 *   CS2      sens 1.0 @ 800 DPI -> 51.95 cm/360
 *   Valorant sens 0.4 @ 800 DPI -> 40.80 cm/360
 * y contra los ratios entre juegos que la comunidad usa desde hace años
 * (Valorant/CS = 3.18, CS/Overwatch = 0.30).
 */

export interface GameProfile {
  id: string
  name: string
  /** Grados de rotación por conteo de mouse a sensibilidad 1.0. */
  yaw: number
  /** Rango que acepta el campo de sensibilidad del juego real. */
  range: { min: number; max: number }
  /** Decimales que muestra la UI de ese juego. */
  decimals: number
  /**
   * Sólo los verificados se ofrecen al usuario. Un perfil sin verificar
   * se mantiene acá documentado pero no se muestra.
   */
  verified: boolean
  /** Por qué confiamos en este yaw, o qué falta para confiar. */
  note: string
}

/** Familia Source: CS, Apex y Quake comparten exactamente la misma escala. */
const SOURCE_YAW = 0.022

/** Familia Overwatch/Call of Duty: escala común, 1/3.333 de Source. */
const OW_YAW = 0.0066

export const GAME_PROFILES: GameProfile[] = [
  {
    id: 'strike-protocol',
    name: 'Strike Protocol',
    yaw: SOURCE_YAW,
    range: { min: 0.05, max: 10 },
    decimals: 3,
    verified: true,
    note: 'Este juego. Adopta la escala Source a propósito: es la más difundida y hace que convertir desde CS, Apex o Quake sea identidad.',
  },
  {
    id: 'cs2',
    name: 'Counter-Strike 2',
    yaw: SOURCE_YAW,
    range: { min: 0.1, max: 10 },
    decimals: 3,
    verified: true,
    note: 'Verificado: 1.0 @ 800 DPI da 51.95 cm/360, que es el valor de referencia público.',
  },
  {
    id: 'valorant',
    name: 'Valorant',
    yaw: 0.07,
    range: { min: 0.1, max: 5 },
    decimals: 3,
    verified: true,
    note: 'Verificado por doble vía: 0.4 @ 800 DPI da 40.8 cm/360, y el ratio contra CS es 3.18, el multiplicador que usa la comunidad.',
  },
  {
    id: 'apex',
    name: 'Apex Legends',
    yaw: SOURCE_YAW,
    range: { min: 0.1, max: 20 },
    decimals: 3,
    verified: true,
    note: 'Motor Source. Misma escala que CS, conversión 1:1.',
  },
  {
    id: 'overwatch2',
    name: 'Overwatch 2',
    yaw: OW_YAW,
    range: { min: 1, max: 100 },
    decimals: 2,
    verified: true,
    note: 'Verificado contra el ratio CS/OW de 3.333 que usa la comunidad.',
  },
  {
    id: 'cod',
    name: 'Call of Duty',
    yaw: OW_YAW,
    range: { min: 1, max: 20 },
    decimals: 2,
    verified: true,
    note: 'Comparte escala con Overwatch. Ratio conocido y estable entre ambos.',
  },
  {
    id: 'quake-champions',
    name: 'Quake Champions',
    yaw: SOURCE_YAW,
    range: { min: 0.1, max: 10 },
    decimals: 3,
    verified: true,
    note: 'Linaje Quake, misma escala que Source.',
  },

  // No verificados: documentados para que nadie los re-investigue desde cero,
  // pero NO se muestran en la UI hasta confirmarlos contra un cm/360 medido.
  {
    id: 'r6-siege',
    name: 'Rainbow Six Siege',
    yaw: 0,
    range: { min: 1, max: 100 },
    decimals: 0,
    verified: false,
    note: 'PENDIENTE. Siege no usa un yaw plano: la sensibilidad interactúa con el FOV y con un multiplicador por operador. Necesita su propia fórmula, no una entrada en esta tabla.',
  },
  {
    id: 'fortnite',
    name: 'Fortnite',
    yaw: 0,
    range: { min: 0, max: 1 },
    decimals: 3,
    verified: false,
    note: 'PENDIENTE. Escala propia y no lineal en algunos rangos. No convertir con un yaw único.',
  },
]

/** Los únicos perfiles que la UI puede ofrecer. */
export const SELECTABLE_PROFILES = GAME_PROFILES.filter((g) => g.verified)

export function findProfile(id: string): GameProfile | undefined {
  return GAME_PROFILES.find((g) => g.id === id)
}
