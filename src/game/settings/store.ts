/**
 * Persistencia y aplicación de la sensibilidad elegida por el jugador.
 *
 * Es la pieza que le faltaba al conversor: `sensitivity.ts` y `games.ts`
 * ya sabían traducir un número de CS o Valorant a la escala de este juego,
 * pero nadie los llamaba y el motor usaba una constante fija. Acá viven las
 * dos costuras que hacían falta para que el conversor sirva de verdad:
 * dónde se guarda lo que el jugador eligió (localStorage, mismo patrón y
 * misma filosofía que progression/store.ts) y cómo se convierte ese número
 * en lo que el motor consume (radianes por conteo de mouse).
 *
 * La conversión en sí NO está acá: sigue en sensitivity.ts, pura y
 * testeada. Este módulo guarda, valida y aplica.
 */

import { GAME_PROFILES, findProfile, type GameProfile } from '@/game/settings/games'

export const SENSITIVITY_STORAGE_KEY = 'iagame:sensibilidad'

/** Versión del formato guardado, mismo criterio que PROGRESS_VERSION: si
 *  cambia la forma, se sube el número y lo viejo se descarta en vez de
 *  interpretarlo mal. Una sensibilidad mal leída es peor que una por
 *  defecto -- el jugador la sentiría rara sin saber por qué. */
export const SENSITIVITY_VERSION = 1

/** El perfil de ESTE juego. La sensibilidad guardada siempre está en su
 *  escala: el juego de origen es sólo el punto de partida de la conversión,
 *  no algo que el motor tenga que recordar. */
export const PERFIL_PROPIO: GameProfile =
  findProfile('strike-protocol') ?? GAME_PROFILES[0]

const DEG_A_RAD = Math.PI / 180

/**
 * Sensibilidad histórica del juego, en la escala de Strike Protocol.
 *
 * Antes de que existiera este panel, game.ts tenía la constante
 * `SENSITIVITY = 0.0022` radianes por conteo de mouse, sin unidad declarada
 * ni forma de tocarla. Ese número se conserva EXACTO como default para que
 * nadie que ya venía jugando sienta que el mouse le cambió:
 *
 *   sens = radianes_por_conteo / (yaw_grados * pi/180)
 *        = 0.0022 / (0.022 * 0.0174532925)
 *        = 0.0022 / 0.000383972
 *        = 5.729578
 *
 * (que es 0.1 * 180/pi, porque 0.0022/0.022 da exactamente 0.1.)
 * A 800 DPI eso da ~9.07 cm/360: una sensibilidad alta para un FPS
 * competitivo, pero es la que el juego tuvo siempre y cambiarla en silencio
 * sería peor que documentarla.
 */
export const SENS_POR_DEFECTO = 0.0022 / (PERFIL_PROPIO.yaw * DEG_A_RAD)

/** DPI por defecto. 800 es el valor más común en mouses de gaming y el que
 *  usan los cm/360 de referencia con los que se verificó games.ts. Sólo
 *  afecta lo que el panel MUESTRA (cm/360, eDPI): el motor consume
 *  radianes por conteo, que no dependen del DPI. */
export const DPI_POR_DEFECTO = 800

export interface SensitivitySettings {
  version: number
  /** Sensibilidad en la escala de este juego (PERFIL_PROPIO). */
  sens: number
  /** DPI del mouse del jugador. Sólo para mostrar cm/360 y eDPI. */
  dpi: number
  /** Último juego de origen elegido en el conversor, para que el panel
   *  vuelva a abrirse donde el jugador lo dejó. No afecta al motor. */
  origenId: string
}

export function createDefaultSensitivity(): SensitivitySettings {
  return {
    version: SENSITIVITY_VERSION,
    sens: SENS_POR_DEFECTO,
    dpi: DPI_POR_DEFECTO,
    origenId: 'cs2',
  }
}

/**
 * Radianes de giro por conteo de mouse: exactamente lo que
 * engine/input.ts multiplica por `movementX`. Es la única función de este
 * módulo que el motor necesita.
 *
 * Pura y sin `window` a propósito: game.ts la llama con lo que haya
 * cargado, y el test la puede llamar con cualquier cosa.
 */
export function radianesPorConteo(settings: SensitivitySettings): number {
  return settings.sens * PERFIL_PROPIO.yaw * DEG_A_RAD
}

/**
 * Recorta y sanea lo que venga de afuera (localStorage editado a mano, un
 * guardado de otra versión, un NaN). Una sensibilidad de 0 dejaría el mouse
 * muerto y una de Infinity haría girar la cámara sin control: los dos casos
 * se ven como "el juego está roto", no como "hay un dato malo guardado",
 * así que se atajan acá.
 */
export function normalizeSensitivity(raw: unknown): SensitivitySettings {
  const base = createDefaultSensitivity()
  if (typeof raw !== 'object' || raw === null) return base

  const obj = raw as Partial<Record<keyof SensitivitySettings, unknown>>
  if (obj.version !== SENSITIVITY_VERSION) return base

  const sens = typeof obj.sens === 'number' && Number.isFinite(obj.sens)
    ? Math.min(Math.max(obj.sens, PERFIL_PROPIO.range.min), PERFIL_PROPIO.range.max)
    : base.sens
  const dpi = typeof obj.dpi === 'number' && Number.isFinite(obj.dpi) && obj.dpi > 0
    ? Math.min(Math.max(obj.dpi, 50), 32_000)
    : base.dpi
  const origenId = typeof obj.origenId === 'string' && findProfile(obj.origenId) !== undefined
    ? obj.origenId
    : base.origenId

  return { version: SENSITIVITY_VERSION, sens, dpi, origenId }
}

export interface SensitivityStore {
  load(): SensitivitySettings
  save(settings: SensitivitySettings): void
}

/**
 * Implementación contra localStorage. Igual que `ProgressStore`: la
 * interfaz es tonta (lee un blob, escribe un blob) para que cambiarla por
 * un backend no toque nada de la lógica.
 *
 * Cualquier fallo de localStorage (modo privado, cookies bloqueadas, cuota)
 * degrada al default en vez de tirar: quedarse sin poder mover la cámara
 * porque el navegador no deja guardar sería absurdo.
 */
export function createSensitivityStore(): SensitivityStore {
  return {
    load(): SensitivitySettings {
      try {
        const raw = window.localStorage.getItem(SENSITIVITY_STORAGE_KEY)
        if (raw === null) return createDefaultSensitivity()
        return normalizeSensitivity(JSON.parse(raw))
      } catch {
        return createDefaultSensitivity()
      }
    },
    save(settings: SensitivitySettings): void {
      try {
        window.localStorage.setItem(SENSITIVITY_STORAGE_KEY, JSON.stringify(settings))
      } catch {
        // Sin persistencia el ajuste vale para esta sesión y nada más.
      }
    },
  }
}
