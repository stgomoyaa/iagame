'use client'

/**
 * Killfeed: últimas muertes con el arma usada, esquina superior derecha.
 * UI de baja frecuencia (sección "Build" de la tarea) -- a diferencia de
 * hitmarkers/números de daño (feedback/overlay.ts, DOM imperativo porque
 * corren por disparo), esto sondea el estado un puñado de veces por
 * segundo (ver src/ui/GameCanvas.tsx), así que React no compite con el
 * presupuesto de frame del motor.
 *
 * Mismo lenguaje visual que los paneles imperativos ya existentes
 * (engine/tuning-panel.ts, engine/stats.ts): panel oscuro translúcido,
 * monoespaciada, sin sombras ni gradientes.
 */

import { listActiveKillsNewestFirst, type KillfeedState } from '@/game/match/killfeed'
import { participantLabel } from '@/ui/participant-label'

export function Killfeed({ killfeed }: { killfeed: KillfeedState }) {
  const entries = listActiveKillsNewestFirst(killfeed)
  if (entries.length === 0) return null

  return (
    <div className="pointer-events-none fixed top-2 right-2 z-20 flex w-72 flex-col items-end gap-1 font-mono text-xs text-[#e6e8ec]">
      {entries.map((entry) => (
        <div
          key={entry.seq}
          className="w-full rounded bg-black/70 px-2.5 py-1.5 text-right leading-tight"
        >
          <span>{participantLabel(entry.killerId)}</span>
          <span className="mx-1.5 text-[#8a8f98]">
            {entry.weaponLabel}
            {entry.headshot ? ' · HS' : ''}
          </span>
          <span>{participantLabel(entry.victimId)}</span>
        </div>
      ))}
    </div>
  )
}
