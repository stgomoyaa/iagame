'use client'

/**
 * Resumen post-partida (sección "Build" de la tarea: "timer, límite de
 * puntaje, condición de fin, y un resumen post-partida"). Se muestra apenas
 * `MatchState.phase` pasa a 'ended' -- GameCanvas.tsx decide cuándo
 * construir el `MatchSummary` (match/match.ts buildSummary) y lo pasa acá.
 */

import type { MatchSummary as MatchSummaryData } from '@/game/match/match'
import { participantLabel } from '@/ui/participant-label'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function MatchSummary({ summary }: { summary: MatchSummaryData }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 font-mono text-[#e6e8ec]">
      <div className="w-96 rounded bg-black/90 p-5 text-sm">
        <div className="mb-1 text-base">Partida terminada</div>
        <div className="mb-4 text-xs opacity-60">
          {summary.mode === 'tdm' ? 'equipos' : 'todos contra todos'} · {formatDuration(summary.durationS)} ·
          ganó: {summary.winnerLabel}
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left opacity-60">
              <th className="pr-3 pb-1 font-normal">jugador</th>
              <th className="pr-3 pb-1 text-right font-normal">kills</th>
              <th className="pr-3 pb-1 text-right font-normal">muertes</th>
              <th className="pb-1 text-right font-normal">daño</th>
            </tr>
          </thead>
          <tbody>
            {summary.standings.map((p) => (
              <tr key={p.id} className="border-t border-white/10">
                <td className="py-1 pr-3">{participantLabel(p.id)}</td>
                <td className="py-1 pr-3 text-right">{p.kills}</td>
                <td className="py-1 pr-3 text-right">{p.deaths}</td>
                <td className="py-1 text-right">{Math.round(p.damageDealt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
