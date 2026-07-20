'use client'

/**
 * El marcador violeta con subrayado punteado del diseño.
 *
 * En el HTML original marca **cada** dato por jugador con `‹CALLSIGN›`,
 * `‹RR›`, `‹±RR›`: era una maqueta y NINGÚN dato estaba conectado.
 *
 * En el port la mayoría de esos marcadores desaparecieron porque el dato
 * ahora existe de verdad: el rango sale de `rankLabel()`, el RR de
 * `RankState`, el nivel de `levelForXp()`. Este componente sobrevive sólo
 * para los tres casos en que sigue siendo cierto que no hay dato:
 *
 * 1. El jugador todavía no jugó (historial vacío, sin rango).
 * 2. El motor no mide ese número (asistencias: `ParticipantStats` no las
 *    tiene, ver progression/history.ts).
 * 3. El sistema no existe (prestigio).
 *
 * Que sea un componente y no un estilo suelto es lo que hace que "esto no
 * es un dato real" sea una decisión visible en el código y no algo que se
 * decide con un color a mano en cada pantalla.
 */

import type { ReactNode } from 'react'

export function Pendiente({ children }: { children: ReactNode }) {
  return (
    <span
      className="pg-mono"
      style={{
        color: 'var(--pg-pendiente)',
        borderBottom: '1px dotted rgba(138,125,255,.4)',
      }}
    >
      {children}
    </span>
  )
}

/**
 * Aviso de "esta pantalla muestra un diseño, no un sistema". Lo usa
 * prestigio, que es la única de las cinco sin nada de código detrás.
 */
export function AvisoPropuesto({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-2.5 px-3.5 py-2.5"
      style={{
        background: 'var(--pg-pendiente-fondo)',
        border: '1px solid var(--pg-pendiente-linea)',
      }}
    >
      <span
        className="mt-1 h-1.5 w-1.5 flex-none"
        style={{
          background: 'var(--pg-propuesto)',
          clipPath: 'polygon(50% 0,100% 100%,0 100%)',
        }}
        aria-hidden
      />
      <p className="pg-mono text-[10px] leading-relaxed tracking-[.08em]" style={{ color: 'var(--pg-tenue)' }}>
        {children}
      </p>
    </div>
  )
}

/** Nota de procedencia en verde: lo que sigue sale del sistema. */
export function AvisoReal({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-2.5 px-3.5 py-2.5"
      style={{ background: 'rgba(70,240,138,.05)', border: '1px solid var(--pg-linea-alta)' }}
    >
      <span
        className="mt-1 h-1.5 w-1.5 flex-none rounded-full"
        style={{ background: 'var(--pg-acento)', boxShadow: '0 0 6px var(--pg-acento)' }}
        aria-hidden
      />
      <p className="pg-mono text-[10px] leading-relaxed tracking-[.08em]" style={{ color: 'var(--pg-tenue)' }}>
        {children}
      </p>
    </div>
  )
}
