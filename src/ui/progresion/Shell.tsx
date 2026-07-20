'use client'

/**
 * Marco compartido de las pantallas de progresión: fondo, barra superior con
 * las pestañas y la franja de procedencia de datos.
 *
 * Las cuatro pantallas con ruta propia (carrera, prestigio, desbloqueos,
 * medallas) lo usan. **La quinta no**: el resumen de fin de partida es un
 * overlay dentro de /play, no una página, así que no lleva barra de
 * navegación (no se puede navegar a otra sección con una partida recién
 * terminada encima) y arma su propio marco.
 *
 *
 * LA FRANJA DE PROCEDENCIA NO ES DECORACIÓN
 *
 * El diseño la trae y se portó tal cual porque responde a la pregunta que
 * hace valioso todo esto: **qué de lo que estoy viendo es un dato real**.
 * Tres estados, y cada pantalla declara los suyos:
 *
 * - verde: sale del sistema (rangos, RR, XP, desbloqueos, armas).
 * - violeta: el dato existe como concepto pero este jugador todavía no lo
 *   tiene, o el motor no lo mide.
 * - triángulo: diseño propuesto sin sistema detrás (prestigio).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

export interface Solapa {
  href: string
  label: string
}

/** Las cuatro pantallas navegables. El fin de partida no está: no es ruta. */
export const SOLAPAS: readonly Solapa[] = [
  { href: '/career', label: 'CARRERA / RANGO' },
  { href: '/prestige', label: 'PRESTIGIO' },
  { href: '/unlocks', label: 'DESBLOQUEOS' },
  { href: '/medals', label: 'MEDALLAS' },
]

export type Procedencia = 'real' | 'pendiente' | 'propuesto'

const LEYENDAS: Record<Procedencia, { texto: string; color: string; marca: ReactNode }> = {
  real: {
    texto: 'DATOS REALES DEL SISTEMA',
    color: 'var(--pg-acento)',
    marca: (
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: 'var(--pg-acento)', boxShadow: '0 0 6px var(--pg-acento)' }}
      />
    ),
  },
  pendiente: {
    texto: 'MARCADO EN VIOLETA = TODAVÍA NO LO TIENES',
    color: 'var(--pg-pendiente)',
    marca: (
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ border: '1px dotted var(--pg-pendiente)' }}
      />
    ),
  },
  propuesto: {
    texto: 'PRESTIGIO: DISEÑO PROPUESTO, SIN SISTEMA AÚN',
    color: 'var(--pg-pendiente-suave)',
    marca: (
      <span
        className="h-1.5 w-1.5"
        style={{ background: 'var(--pg-propuesto)', clipPath: 'polygon(50% 0,100% 100%,0 100%)' }}
      />
    ),
  },
}

function Solapas() {
  const pathname = usePathname()

  return (
    <div className="flex min-w-0 gap-1 overflow-hidden">
      {SOLAPAS.map((s) => {
        const activa = pathname === s.href
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={activa ? 'page' : undefined}
            className="pg-display whitespace-nowrap px-3.5 py-2 text-xs font-semibold tracking-[.1em] transition-colors"
            style={{
              color: activa ? 'var(--pg-fondo)' : 'var(--pg-tenue)',
              background: activa ? 'var(--pg-acento)' : 'transparent',
              border: `1px solid ${activa ? 'var(--pg-acento)' : 'var(--pg-linea-alta)'}`,
            }}
          >
            {s.label}
          </Link>
        )
      })}
    </div>
  )
}

export function ProgresionShell({
  children,
  procedencias = ['real'],
}: {
  children: ReactNode
  /** Qué leyendas mostrar en la franja. Cada pantalla declara las suyas: una
   *  pantalla 100% real no debería anunciar datos pendientes que no tiene. */
  procedencias?: readonly Procedencia[]
}) {
  return (
    <div className="pg relative flex min-h-screen flex-col overflow-hidden">
      <div className="pg-nebulosa pointer-events-none absolute inset-0" aria-hidden />
      <div className="pg-estrellas pointer-events-none absolute inset-0" aria-hidden />

      <header
        className="relative z-20 flex flex-none items-center justify-between gap-4 px-5 py-3.5"
        style={{ borderBottom: '1px solid var(--pg-linea)', background: 'rgba(4,7,10,.7)' }}
      >
        <div className="flex min-w-0 items-center gap-5">
          <Link href="/" className="flex flex-none items-center gap-2.5">
            <span
              className="pg-hex h-5 w-5"
              style={{ background: 'var(--pg-acento)', boxShadow: '0 0 14px rgba(70,240,138,.6)' }}
              aria-hidden
            />
            <span
              className="pg-display text-sm font-bold tracking-[.36em]"
              style={{ color: 'var(--pg-texto-alto)' }}
            >
              PROGRESIÓN
            </span>
          </Link>
          <Solapas />
        </div>

        <nav className="flex flex-none items-center gap-4">
          <Link
            href="/play"
            className="pg-display px-3.5 py-2 text-xs font-semibold tracking-[.1em]"
            style={{ color: 'var(--pg-tenue)', border: '1px solid var(--pg-linea-alta)' }}
          >
            JUGAR
          </Link>
          <Link
            href="/armory"
            className="pg-display px-3.5 py-2 text-xs font-semibold tracking-[.1em]"
            style={{ color: 'var(--pg-tenue)', border: '1px solid var(--pg-linea-alta)' }}
          >
            ARMERÍA
          </Link>
        </nav>
      </header>

      <div
        className="pg-mono relative z-[19] flex flex-none flex-wrap items-center gap-4 px-5 py-1.5 text-[9px] tracking-[.1em]"
        style={{
          background: 'rgba(124,92,255,.06)',
          borderBottom: '1px solid var(--pg-pendiente-linea)',
        }}
      >
        {procedencias.map((p) => {
          const l = LEYENDAS[p]
          return (
            <span key={p} className="flex items-center gap-1.5" style={{ color: l.color }}>
              {l.marca}
              {l.texto}
            </span>
          )
        })}
      </div>

      <main className="relative z-10 min-h-0 flex-1">{children}</main>
    </div>
  )
}
