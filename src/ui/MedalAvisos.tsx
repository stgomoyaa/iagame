'use client'

/**
 * Avisos de medalla in-game: cuando ganás una gesta (primera sangre, doble
 * baja, headshot...), aparece arriba y al centro por unos segundos. Mismo
 * patrón de sondeo que el Killfeed (src/ui/GameCanvas.tsx re-renderiza un
 * puñado de veces por segundo leyendo estado vivo del motor), así que React
 * no compite con el presupuesto de frame: acá sólo se lee
 * `listActiveAwardsNewestFirst` y se dibuja lo activo.
 *
 * El backend ya otorgaba y guardaba las medallas hace rato; lo único que
 * faltaba era esto, la capa que las hace VISIBLES. Sin esto, para el jugador
 * era como si el sistema de recompensa no existiera.
 *
 * Lenguaje visual heredado del sistema Strike Protocol (tokens --pg-*, fuentes
 * pg-display/pg-mono, animación pg-anim-slam), no inventado acá: un aviso de
 * medalla y el resumen de fin de partida tienen que leerse como el mismo
 * juego. Icono real por slug (progression/medals.ts: medalIconPath), nombre y
 * XP reales del catálogo -- cero datos de ejemplo.
 */

import { listActiveAwardsNewestFirst, type MedalTrackerState } from '@/game/match/medal-tracker'
import { medalById, medalIconPath } from '@/game/progression/medals'

export function MedalAvisos({ tracker }: { tracker: MedalTrackerState }) {
  const avisos = listActiveAwardsNewestFirst(tracker)
  if (avisos.length === 0) return null

  return (
    <div className="pointer-events-none fixed left-1/2 top-[14%] z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      {avisos.map((aviso) => {
        const def = medalById(aviso.medalId)
        if (def === null) return null
        return (
          <div
            key={aviso.seq}
            className="pg-anim-slam flex items-center gap-2.5 rounded-sm border py-1.5 pl-1.5 pr-3.5"
            style={{
              background: 'color-mix(in srgb, var(--pg-panel) 88%, transparent)',
              borderColor: 'var(--pg-linea-marcada)',
              boxShadow: '0 0 0 1px rgba(70,240,138,.06), 0 8px 24px -12px #000',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- icono
                local de UI de juego, no contenido de página; next/image sólo
                agrega el optimizador y un layout shift que acá no sirven
                (mismo criterio que ui/progresion/emblemas.tsx). */}
            <img
              src={medalIconPath(def.slug)}
              alt=""
              aria-hidden
              width={44}
              height={44}
              className="block h-11 w-11"
              style={{ filter: 'drop-shadow(0 0 10px rgba(70,240,138,.35))' }}
            />
            <div className="flex flex-col leading-tight">
              <span
                className="pg-display text-sm font-bold tracking-[.03em]"
                style={{ color: 'var(--pg-texto-alto)' }}
              >
                {def.nombre}
              </span>
              <span
                className="pg-mono mt-0.5 text-[10px] tracking-[.16em]"
                style={{ color: 'var(--pg-acento)' }}
              >
                +{def.xp} XP
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
