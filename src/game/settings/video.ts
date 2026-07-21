/**
 * Persistencia de los ajustes de VIDEO elegidos por el jugador.
 *
 * Hoy tiene un solo control -- la calidad del bloom (postprocesado)-- pero
 * vive en su propio store y su propia clave de localStorage, separado del de
 * sensibilidad (settings/store.ts), a propósito: sensibilidad y video son dos
 * decisiones distintas del jugador y no tienen por qué compartir versión de
 * formato. Si mañana se agrega otro ajuste gráfico (sombras, resolución de
 * render, FOV), entra acá sin tocar la sensibilidad.
 *
 * Mismo patrón y misma filosofía que SensitivityStore: la interfaz es tonta
 * (lee un blob, escribe un blob), la conversión a lo que el motor consume no
 * vive acá, y cualquier fallo de localStorage degrada al default en vez de
 * tirar -- quedarse sin bloom porque el navegador no deja guardar es mejor que
 * un crash.
 *
 * Este módulo es PURO: no importa three ni toca la GPU. Sólo define el catálogo
 * de calidades y la persistencia. Quién traduce una calidad en render targets y
 * shaders es engine/postprocess.ts, el único borde de esta feature contra la
 * escena real.
 */

export const VIDEO_STORAGE_KEY = 'iagame:video'

/** Versión del formato guardado, mismo criterio que SENSITIVITY_VERSION: si la
 *  forma cambia, se sube el número y lo viejo se descarta en vez de leerlo
 *  mal. */
export const VIDEO_VERSION = 1

/**
 * Calidad del bloom.
 *
 * - `off`: el pipeline de postprocesado se saltea ENTERO. Cero render targets,
 *   cero pasadas, mismo render (y mismo costo de GPU) que antes de esta
 *   feature. Es la salida para GPUs que no tienen el margen.
 * - `bajo`: bloom a media resolución con un desenfoque moderado. Es el DEFAULT
 *   -- el "nivel medio" de la tarea: se ve premium (el derrame neón de los
 *   camos ya se lee) y entra cómodo en el presupuesto de una GPU modesta.
 * - `alto`: media resolución también, pero con más iteraciones y radio más
 *   ancho, para el derrame lujoso tipo Call of Duty. Para quien tiene GPU de
 *   sobra.
 *
 * La escalera off < bajo < alto es deliberada: `bajo` es el default balanceado,
 * `off` deja bajar a las GPUs débiles y `alto` deja subir a las que sobran. No
 * hay un nivel "siempre-máximo para todos" porque el bloom en alto excede el
 * presupuesto de 2,5 ms y esa decisión es del jugador, no del motor.
 */
export type BloomQuality = 'off' | 'bajo' | 'alto'

/** Orden de menor a mayor costo, para el selector de la UI. */
export const BLOOM_QUALITIES: readonly BloomQuality[] = ['off', 'bajo', 'alto']

/** Etiqueta en es-CL para cada calidad (la UI no arma strings a mano). */
export const BLOOM_QUALITY_LABEL: Record<BloomQuality, string> = {
  off: 'Desactivado',
  bajo: 'Bajo',
  alto: 'Alto',
}

export interface VideoSettings {
  version: number
  /** Calidad del bloom elegida por el jugador. */
  bloom: BloomQuality
}

/** Default: bloom en `bajo`. Ver el comentario de BloomQuality sobre por qué
 *  el nivel medio, y no `off` ni `alto`, es el arranque correcto. */
export function createDefaultVideoSettings(): VideoSettings {
  return {
    version: VIDEO_VERSION,
    bloom: 'bajo',
  }
}

/** True si `v` es una calidad de bloom conocida. Narrowing sin `any`. */
export function esBloomQuality(v: unknown): v is BloomQuality {
  return v === 'off' || v === 'bajo' || v === 'alto'
}

/**
 * Recorta y sanea lo que venga de afuera (localStorage editado a mano, un
 * guardado de otra versión, un string basura). Una calidad desconocida cae al
 * default en vez de dejar el motor con un valor que no sabe interpretar.
 */
export function normalizeVideoSettings(raw: unknown): VideoSettings {
  const base = createDefaultVideoSettings()
  if (typeof raw !== 'object' || raw === null) return base

  const obj = raw as Partial<Record<keyof VideoSettings, unknown>>
  if (obj.version !== VIDEO_VERSION) return base

  const bloom = esBloomQuality(obj.bloom) ? obj.bloom : base.bloom
  return { version: VIDEO_VERSION, bloom }
}

export interface VideoSettingsStore {
  load(): VideoSettings
  save(settings: VideoSettings): void
}

/**
 * Implementación contra localStorage, gemela de SensitivityStore: lee un blob,
 * escribe un blob. Cualquier fallo (modo privado, cuota, cookies bloqueadas)
 * degrada al default.
 */
export function createVideoSettingsStore(): VideoSettingsStore {
  return {
    load(): VideoSettings {
      try {
        const raw = window.localStorage.getItem(VIDEO_STORAGE_KEY)
        if (raw === null) return createDefaultVideoSettings()
        return normalizeVideoSettings(JSON.parse(raw))
      } catch {
        return createDefaultVideoSettings()
      }
    },
    save(settings: VideoSettings): void {
      try {
        window.localStorage.setItem(VIDEO_STORAGE_KEY, JSON.stringify(settings))
      } catch {
        // Sin persistencia el ajuste vale para esta sesión y nada más.
      }
    },
  }
}
