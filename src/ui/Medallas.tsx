'use client'

/**
 * Galería de medallas (ruta /medals): las 15 del catálogo REAL
 * (progression/medals.ts) con el icono, el nombre y la condición de cada una,
 * cuántas veces la sacaste, y el XP de cuenta que paga. Lee el guardado real
 * (progression/store.ts): el mismo tally que el aviso in-game y el resumen de
 * partida escriben. Antes esta pantalla mostraba un catálogo VISUAL de diseño
 * (glifos dibujados) cuyas claves no coincidían con los slugs reales y decía
 * "el sistema todavía no existe"; el sistema existe hace rato, sólo faltaba
 * que esta pantalla lo leyera.
 *
 * Lenguaje visual heredado del sistema de progresión (tokens --pg-*, fuentes
 * pg-display/pg-mono, ProgresionShell), e icono real por slug (medalIconPath),
 * el mismo que usan el aviso y el resumen: la galería, el aviso y el resumen se
 * leen como la misma colección. Cero datos de ejemplo.
 */

import { useEffect, useMemo, useState } from 'react'
import { CATALOGO_MEDALLAS, medalIconPath } from '@/game/progression/medals'
import {
  createDefaultProgress,
  createProgressStore,
  type ProgressData,
} from '@/game/progression/store'
import { ProgresionShell } from '@/ui/progresion/Shell'

type Filtro = 'todas' | 'obtenidas' | 'pendientes'

const FILTROS: readonly { id: Filtro; label: string }[] = [
  { id: 'todas', label: 'TODAS' },
  { id: 'obtenidas', label: 'OBTENIDAS' },
  { id: 'pendientes', label: 'PENDIENTES' },
]

function Segmento({
  activo,
  onClick,
  children,
}: {
  activo: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className="pg-display px-4 py-1.5 text-[11px] font-semibold tracking-[.12em] transition-colors"
      style={{
        color: activo ? 'var(--pg-fondo)' : 'var(--pg-tenue)',
        background: activo ? 'var(--pg-acento)' : 'transparent',
        border: `1px solid ${activo ? 'var(--pg-acento)' : 'var(--pg-linea-alta)'}`,
      }}
    >
      {children}
    </button>
  )
}

export function Medallas() {
  const [store] = useState(() => createProgressStore())
  const [progress, setProgress] = useState<ProgressData>(() => createDefaultProgress())

  useEffect(() => {
    // Mismo patrón que Career.tsx: localStorage no existe en el servidor, así
    // que los dos lados arrancan con el default y la lectura real ocurre tras
    // montar.
    queueMicrotask(() => setProgress(store.load()))
  }, [store])

  const [filtro, setFiltro] = useState<Filtro>('todas')

  const conseguidas = CATALOGO_MEDALLAS.filter((m) => (progress.medallas[m.slug] ?? 0) > 0).length

  const visibles = useMemo(
    () =>
      CATALOGO_MEDALLAS.filter((m) => {
        const veces = progress.medallas[m.slug] ?? 0
        if (filtro === 'obtenidas') return veces > 0
        if (filtro === 'pendientes') return veces === 0
        return true
      }),
    [progress, filtro],
  )

  return (
    <ProgresionShell procedencias={['real']}>
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="flex flex-none flex-wrap items-center justify-between gap-4 px-6 py-4"
          style={{ borderBottom: '1px solid var(--pg-linea)' }}
        >
          <div className="flex items-center gap-4">
            <h1 className="pg-mono text-[11px] tracking-[.2em]" style={{ color: 'var(--pg-tenue)' }}>
              GALERÍA DE MEDALLAS
            </h1>
            <div className="flex gap-1.5">
              {FILTROS.map((f) => (
                <Segmento key={f.id} activo={filtro === f.id} onClick={() => setFiltro(f.id)}>
                  {f.label}
                </Segmento>
              ))}
            </div>
          </div>
          <span className="pg-mono text-[10px] tracking-[.12em]" style={{ color: 'var(--pg-mudo)' }}>
            {conseguidas} / {CATALOGO_MEDALLAS.length} CONSEGUIDAS
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {visibles.map((m) => {
              const veces = progress.medallas[m.slug] ?? 0
              const obtenida = veces > 0
              return (
                <li
                  key={m.slug}
                  className="px-3.5 py-4 text-center"
                  style={{
                    background: obtenida
                      ? 'radial-gradient(circle at 50% 18%, rgba(70,240,138,.08), var(--pg-panel) 70%)'
                      : '#060a08',
                    border: `1px solid ${obtenida ? 'var(--pg-linea-marcada)' : 'var(--pg-linea)'}`,
                  }}
                >
                  <div className="mb-3 flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element -- icono
                        local de UI de juego, mismo criterio que emblemas.tsx y el
                        aviso/resumen de medallas. */}
                    <img
                      src={medalIconPath(m.slug, 256)}
                      alt=""
                      aria-hidden
                      width={62}
                      height={62}
                      className="block h-[62px] w-[62px]"
                      style={
                        obtenida
                          ? { filter: 'drop-shadow(0 0 10px rgba(70,240,138,.3))' }
                          : { filter: 'grayscale(1) brightness(.55)', opacity: 0.5 }
                      }
                    />
                  </div>
                  <div
                    className="pg-display text-[13px] font-bold tracking-[.05em]"
                    style={{ color: obtenida ? 'var(--pg-acento)' : 'var(--pg-mudo-alto)' }}
                  >
                    {m.nombre}
                  </div>
                  <p
                    className="pg-mono mt-1.5 min-h-[26px] text-[9px] leading-relaxed"
                    style={{ color: 'var(--pg-apagado)' }}
                  >
                    {m.descripcion}
                  </p>
                  <div
                    className="mt-2.5 flex items-center justify-between gap-1.5 pt-2"
                    style={{ borderTop: '1px solid var(--pg-linea)' }}
                  >
                    <span
                      className="pg-mono text-[9px] tracking-[.1em]"
                      style={{ color: 'var(--pg-mudo)' }}
                    >
                      {obtenida ? `VECES ${veces}` : 'PENDIENTE'}
                    </span>
                    <span
                      className="pg-mono text-[11px] font-semibold tabular-nums"
                      style={{ color: obtenida ? 'var(--pg-acento)' : 'var(--pg-mudo-alto)' }}
                    >
                      +{m.xp} XP
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>

          {visibles.length === 0 && (
            <p
              className="pg-mono mt-8 text-center text-[11px] tracking-[.12em]"
              style={{ color: 'var(--pg-mudo)' }}
            >
              {filtro === 'obtenidas'
                ? 'TODAVÍA NO CONSEGUISTE NINGUNA. JUEGA UNA PARTIDA.'
                : 'LAS CONSEGUISTE TODAS.'}
            </p>
          )}
        </div>
      </div>
    </ProgresionShell>
  )
}
