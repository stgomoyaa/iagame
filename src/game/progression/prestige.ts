/**
 * Prestigio: el ciclo que le sigue al techo del nivel de cuenta.
 *
 * Al llegar al nivel máximo (`NIVEL_MAXIMO`, unlocks.ts) el jugador puede
 * reiniciar su nivel a cambio de una insignia. Hasta 10 veces.
 *
 *
 * LO QUE DEFINE AL PRESTIGIO NO SON LOS 10 NIVELES, ES LA ASIMETRÍA
 *
 * Lo único que importa de este sistema es QUÉ se reinicia y QUÉ se mantiene:
 *
 *   SE REINICIA                    SE MANTIENE
 *   la XP de cuenta                el rango competitivo, el RR, las colocaciones
 *   el nivel (vuelve a 1)          las skins del inventario
 *   el acceso a las armas          el historial de partidas, victorias y derrotas
 *                                  el XP de arma y los camuflajes
 *                                  las medallas
 *                                  los desbloqueos permanentes de prestigios anteriores
 *
 * La regla que ordena la tabla: **se reinicia lo que mide cuánto jugaste, se
 * mantiene todo lo que ganaste**. Si prestigiar también borrara los camos o
 * el progreso de cada arma, se sentiría un castigo y nadie lo haría dos
 * veces; el jugador que prestigia está pidiendo volver a tener algo que
 * desbloquear, no perder lo que tiene colgado en la pared.
 *
 * El rango competitivo está en esa lista por un motivo distinto y más fuerte:
 * el nivel de cuenta mide cuánto jugaste y el rango mide qué tan bien jugás.
 * Son dos preguntas distintas y no se cruzan. Prestigiar no te puede bajar de
 * rango porque prestigiar no dice nada sobre cómo jugás.
 *
 * En código la asimetría es literal: este módulo trabaja sobre `PrestigeData`,
 * que tiene exactamente los tres campos que el prestigio puede tocar. Lo que
 * no está en esta interfaz no se puede reiniciar aunque alguien se equivoque,
 * y `progressWithPrestige` (store.ts) copia el resto del guardado tal cual,
 * incluidos los campos que hoy todavía no existen (el XP de arma y las
 * medallas los están construyendo en paralelo).
 *
 *
 * LA FICHA DE DESBLOQUEO PERMANENTE
 *
 * Cada prestigio deja **una** ficha, y una ficha desbloquea **un arma para
 * siempre**: sobrevive a este reinicio y a todos los que vengan. Es el detalle
 * que hace que la decisión pese, porque son 79 armas y te llevás una.
 *
 * No se guarda un contador de fichas. Se guardan las armas elegidas y las
 * fichas disponibles se DERIVAN (`fichasDisponibles`): un contador aparte se
 * puede desincronizar de la lista con un guardado corrupto o con un bug de
 * orden, y "tengo 3 fichas y 5 armas permanentes" no es un estado que valga
 * la pena poder representar.
 */

import { NIVEL_MAXIMO, levelForXp, unlockLevelsSnapshot } from '@/game/progression/unlocks'

/** Cuántas veces se puede prestigiar. */
export const PRESTIGIO_MAX = 10

/** Valor de `prestigio` de una cuenta que nunca prestigió. */
export const SIN_PRESTIGIO = 0

/**
 * La parte del guardado que el prestigio puede tocar. Mismo criterio que
 * `CareerData` (career.ts): el módulo no ve el blob entero, y lo que no ve no
 * lo puede romper.
 */
export interface PrestigeData {
  /** Cuántas veces prestigió: 0..PRESTIGIO_MAX. */
  prestigio: number
  /** Slugs que ignoran el nivel para siempre, uno por ficha gastada. */
  desbloqueosPermanentes: string[]
  /** XP de cuenta. Es lo único que se reinicia. */
  xp: number
}

export function createDefaultPrestige(): PrestigeData {
  return { prestigio: SIN_PRESTIGIO, desbloqueosPermanentes: [], xp: 0 }
}

/** Fichas ganadas y todavía sin gastar. Derivado, nunca guardado. */
export function fichasDisponibles(data: PrestigeData): number {
  return Math.max(0, data.prestigio - data.desbloqueosPermanentes.length)
}

export function esPermanente(data: PrestigeData, slug: string): boolean {
  return data.desbloqueosPermanentes.includes(slug)
}

/** ¿Ya llegó al techo del ciclo y le queda algún prestigio por delante? */
export function puedePrestigiar(data: PrestigeData): boolean {
  return data.prestigio < PRESTIGIO_MAX && levelForXp(data.xp) >= NIVEL_MAXIMO
}

/** Un arma existe si está en el catálogo cargado en este momento. */
function existeEnCatalogo(slug: string): boolean {
  return slug in unlockLevelsSnapshot()
}

export interface PrestigeResult {
  data: PrestigeData
  /** false si la operación no se pudo hacer; `data` vuelve sin tocar. */
  hecho: boolean
  /** Por qué no se pudo, para que la UI diga algo concreto. */
  motivo: string | null
}

/**
 * Sube un prestigio y reinicia la XP.
 *
 * `slugElegido` es el arma que se lleva con la ficha de este prestigio, o
 * null para decidir después (`gastarFicha`). Poder postergar existe porque la
 * alternativa es peor: obligar a elegir en el momento convierte una decisión
 * que vale la pena pensar en un trámite que se resuelve con el primer nombre
 * de la lista.
 *
 * No muta `data`.
 */
export function prestigiar(data: PrestigeData, slugElegido: string | null = null): PrestigeResult {
  if (data.prestigio >= PRESTIGIO_MAX) {
    return { data, hecho: false, motivo: 'ya estás en el prestigio máximo' }
  }
  if (levelForXp(data.xp) < NIVEL_MAXIMO) {
    return { data, hecho: false, motivo: `te falta llegar al nivel ${NIVEL_MAXIMO}` }
  }
  if (slugElegido !== null) {
    if (!existeEnCatalogo(slugElegido)) {
      return { data, hecho: false, motivo: 'esa arma no está en el catálogo' }
    }
    if (esPermanente(data, slugElegido)) {
      return { data, hecho: false, motivo: 'esa arma ya es permanente' }
    }
  }

  return {
    data: {
      prestigio: data.prestigio + 1,
      desbloqueosPermanentes:
        slugElegido === null
          ? [...data.desbloqueosPermanentes]
          : [...data.desbloqueosPermanentes, slugElegido],
      // Lo único que se reinicia. La XP sobrante por encima del techo se
      // pierde acá y es a propósito: si se arrastrara, el primer nivel del
      // ciclo nuevo ya vendría regalado.
      xp: 0,
    },
    hecho: true,
    motivo: null,
  }
}

/**
 * Gasta una ficha pendiente en un arma. No muta `data`.
 *
 * No pide nivel: la ficha se ganó llegando al techo, donde todas las armas
 * estaban desbloqueadas. Pedir nivel acá haría que postergar la decisión
 * costara armas, y postergar no debería costar nada.
 */
export function gastarFicha(data: PrestigeData, slug: string): PrestigeResult {
  if (fichasDisponibles(data) <= 0) return { data, hecho: false, motivo: 'no tenés fichas' }
  if (!existeEnCatalogo(slug)) return { data, hecho: false, motivo: 'esa arma no está en el catálogo' }
  if (esPermanente(data, slug)) return { data, hecho: false, motivo: 'esa arma ya es permanente' }

  return {
    data: { ...data, desbloqueosPermanentes: [...data.desbloqueosPermanentes, slug] },
    hecho: true,
    motivo: null,
  }
}

/**
 * Etiqueta de la insignia. **Siempre incluye el número.**
 *
 * No es una preferencia de redacción. Los 10 emblemas se midieron y son
 * círculos del mismo diámetro: el contorno externo es idéntico entre pares
 * (IoU 1.00), toda la diferencia está en el relleno interior. O sea que en
 * una fila de insignias chicas la silueta no distingue nada y el número es
 * información, no decoración. Cualquier lugar que muestre el emblema tiene
 * que poder mostrar este texto al lado.
 */
export function prestigeLabel(prestigio: number): string {
  const p = Math.max(0, Math.min(PRESTIGIO_MAX, Math.floor(prestigio)))
  return p === SIN_PRESTIGIO ? 'Sin prestigio' : `Prestigio ${p}`
}
