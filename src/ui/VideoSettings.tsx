'use client'

/**
 * Ajustes de video del jugador. Hoy tiene un solo control: la calidad del
 * bloom (postprocesado). Es hermano de SensitivitySettings dentro del menú de
 * pausa, con el mismo criterio: acá no se calcula NADA del juego -- el catálogo
 * de calidades y la persistencia viven en settings/video.ts, y este archivo
 * sólo dibuja y guarda.
 *
 * La persistencia es inmediata, sin botón de guardar, igual que la
 * sensibilidad. El cambio se APLICA al reanudar la partida (GameCanvas llama a
 * game.recargarVideo al cerrar el menú): mientras el menú está abierto el juego
 * está congelado, así que no habría nada nuevo que mostrar hasta volver.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BLOOM_QUALITIES,
  BLOOM_QUALITY_LABEL,
  createDefaultVideoSettings,
  createVideoSettingsStore,
  type VideoSettings as VideoSettingsData,
} from '@/game/settings/video'

export function VideoSettings() {
  // `null` = todavía no se leyó localStorage. El store sólo existe en el
  // navegador, así que la lectura va en un efecto y no en el primer render
  // (esta pantalla se prerenderiza en el servidor). Mismo patrón que
  // SensitivitySettings.
  const [settings, setSettings] = useState<VideoSettingsData | null>(null)
  const store = useMemo(() => createVideoSettingsStore(), [])

  useEffect(() => {
    queueMicrotask(() => setSettings(store.load()))
  }, [store])

  const guardar = useCallback(
    (siguiente: VideoSettingsData) => {
      setSettings(siguiente)
      store.save(siguiente)
    },
    [store],
  )

  // Hasta que el efecto lea el guardado se muestran los defaults en vez de un
  // hueco: son los mismos valores con los que el motor arrancaría, así que la
  // pantalla nunca dice algo que el juego no haría.
  const actual = settings ?? createDefaultVideoSettings()

  return (
    <section className="arm-panel arm-chaflan" aria-label="Video">
      <h2 className="arm-mono border-b border-[var(--arm-linea-tenue)] px-3 py-2 text-[0.625rem] text-[var(--arm-tenue)]">
        Video
      </h2>

      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-[var(--arm-tenue)]">
          El bloom hace que los camos neón, los fogonazos y el punto rojo derramen luz, como en un
          shooter AAA. Cuesta GPU: si tu placa sufre, bajalo o apagalo.
        </p>

        <div className="flex flex-col gap-1">
          <span className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">Bloom</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Calidad de bloom">
            {BLOOM_QUALITIES.map((q) => (
              <button
                key={q}
                type="button"
                role="radio"
                aria-checked={q === actual.bloom}
                data-testid={`bloom-${q}`}
                className="arm-tab arm-chaflan flex-1"
                onClick={() => guardar({ ...actual, bloom: q })}
              >
                <span className="arm-mono block py-1 text-sm">{BLOOM_QUALITY_LABEL[q]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
