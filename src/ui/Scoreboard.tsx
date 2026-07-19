'use client'

/**
 * Scoreboard en tecla sostenida (Tab): kills, deaths y daño por
 * participante, ordenado (sección "Build" de la tarea). El held-key en sí
 * se detecta en GameCanvas.tsx, no acá -- este componente sólo pinta según
 * `visible`.
 */

import type { ParticipantStats } from '@/game/match/scoring'
import { sortedByKills } from '@/game/match/scoring'
import type { MatchMode } from '@/game/match/types'
import { teamForParticipant } from '@/game/match/types'
import { participantLabel } from '@/ui/participant-label'

export function Scoreboard({
  participants,
  mode,
  visible,
}: {
  participants: ParticipantStats[]
  mode: MatchMode
  visible: boolean
}) {
  if (!visible) return null

  const rows = sortedByKills(participants)

  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex items-start justify-center pt-20">
      <div className="min-w-80 rounded bg-black/85 p-3 font-mono text-xs text-[#e6e8ec]">
        <div className="mb-2 opacity-60">
          scoreboard ({mode === 'tdm' ? 'equipos' : 'todos contra todos'})
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left opacity-60">
              <th className="pr-3 pb-1 font-normal">jugador</th>
              {mode === 'tdm' && <th className="pr-3 pb-1 font-normal">equipo</th>}
              <th className="pr-3 pb-1 text-right font-normal">kills</th>
              <th className="pr-3 pb-1 text-right font-normal">muertes</th>
              <th className="pb-1 text-right font-normal">daño</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-white/10">
                <td className="py-1 pr-3">{participantLabel(p.id)}</td>
                {mode === 'tdm' && (
                  <td className="py-1 pr-3">{teamForParticipant(mode, p.id) === 0 ? 'A' : 'B'}</td>
                )}
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
