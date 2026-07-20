'use client'

/**
 * Galería de medallas (ruta /medals).
 *
 * Las 15 medallas del diseño, con **conteos reales** del guardado
 * (progression/medals.ts). No hay una sola medalla de ejemplo ni un
 * contador de relleno: si nunca sacaste nada, la pantalla lo dice.
 *
 *
 * TRES ESTADOS, NO DOS
 *
 * El diseño alterna entre "vista obtenidas" y "vista pendientes", que era la
 * forma de previsualizar los dos aspectos sin datos. Con datos reales esa
 * alternancia no tiene sentido (cada medalla ya sabe en qué estado está),
 * así que el conmutador pasó a ser un **filtro** y apareció un tercer
 * estado que el diseño no podía tener:
 *
 * - **obtenida**: la sacaste al menos una vez. Color y halo.
 * - **pendiente**: se puede conseguir y todavía no la tienes. Gris.
 * - **bloqueada**: su disparador no existe todavía en el motor (las de
 *   fuente `eventos`). Gris + nota explícita.
 *
 * Meter las bloqueadas en "pendiente" sería prometerle al jugador que puede
 * ir a buscar una medalla que hoy es imposible. Es la misma razón por la que
 * `medals.ts` distingue la fuente.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  MEDALLAS,
  medallasDistintas,
  medallasImplementadas,
  type MedalDef,
} from '@/game/progression/medals'
import {
  createDefaultProgress,
  createProgressStore,
  type ProgressData,
} from '@/game/progression/store'
import { ProgresionShell } from '@/ui/progresion/Shell'
import { AvisoPropuesto } from '@/ui/progresion/Pendiente'
import { MedalBadge } from '@/ui/progresion/emblemas'

type Filtro = 'todas' | 'obtenidas' | 'pendientes'

const FILTROS: readonly { id: Filtro; label: string }[] = [
  { id: 'todas', label: 'TODAS' },
  { id: 'obtenidas', label: 'OBTENIDAS' },
  { id: 'pendientes', label: 'PENDIENTES' },
]

type Estado = 'obtenida' | 'pendiente' | 'bloqueada'

function estadoDe(m: MedalDef, veces: number): Estado {
  if (veces > 0) return 'obtenida'
  return m.fuente === 'eventos' ? 'bloqueada' : 'pendiente'
}

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
  const [filtro, setFiltro] = useState<Filtro>('todas')

  useEffect(() => {
    queueMicrotask(() => setProgress(store.load()))
  }, [store])

  const counts = progress.medallas
  const conseguidas = medallasDistintas(counts)

  const visibles = useMemo(
    () =>
      MEDALLAS.filter((m) => {
        const veces = counts[m.key] ?? 0
        if (filtro === 'obtenidas') return veces > 0
        if (filtro === 'pendientes') return veces === 0
        return true
      }),
    [counts, filtro],
  )

  return (
    <ProgresionShell procedencias={['real', 'pendiente']}>
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
          <span className="pg-mono text-[10px] tracking-[.12em]" style={{ color: 'var(--pg-acento)' }}>
            <span style={{ color: 'var(--pg-mudo)' }}>CONSEGUIDAS </span>
            {conseguidas} / {MEDALLAS.length}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-4">
            <AvisoPropuesto>
              Los conteos salen de tu guardado. De las {MEDALLAS.length} medallas,{' '}
              {medallasImplementadas()} ya se otorgan al terminar una partida; las otras{' '}
              {MEDALLAS.length - medallasImplementadas()} necesitan que el motor mida eventos de
              combate (primera baja, 1vX, dos bajas con una bala) y aparecen bloqueadas hasta
              entonces. Ninguna muestra datos de ejemplo.
            </AvisoPropuesto>
          </div>

          {conseguidas === 0 && filtro !== 'pendientes' && (
            <p
              className="pg-mono mb-4 text-[11px] tracking-[.08em]"
              style={{ color: 'var(--pg-tenue)' }}
            >
              Todavía no consigues ninguna medalla. Termina una partida sin morir o con una racha
              de 5 y sacas la primera.
            </p>
          )}

          {visibles.length === 0 ? (
            <p className="pg-mono text-[11px]" style={{ color: 'var(--pg-mudo)' }}>
              Ninguna medalla en este filtro.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {visibles.map((m) => {
                const veces = counts[m.key] ?? 0
                const estado = estadoDe(m, veces)
                const obtenida = estado === 'obtenida'
                return (
                  <li
                    key={m.key}
                    className="px-3.5 py-4 text-center"
                    style={{
                      background: obtenida
                        ? `radial-gradient(circle at 50% 20%, ${m.color}12, var(--pg-panel) 70%)`
                        : '#060a08',
                      border: `1px solid ${obtenida ? `${m.color}44` : 'var(--pg-linea)'}`,
                      opacity: estado === 'bloqueada' ? 0.65 : 1,
                    }}
                  >
                    <div className="mb-3 flex justify-center">
                      <MedalBadge medalla={m} obtenida={obtenida} size={62} />
                    </div>
                    <div
                      className="pg-display text-[13px] font-bold tracking-[.05em]"
                      style={{ color: obtenida ? m.color : 'var(--pg-mudo-alto)' }}
                    >
                      {m.nombre}
                    </div>
                    <p
                      className="pg-mono mt-1.5 min-h-[26px] text-[9px] leading-relaxed"
                      style={{ color: 'var(--pg-apagado)' }}
                    >
                      {m.desc}
                    </p>
                    <div
                      className="mt-2.5 flex items-center justify-center gap-1.5 pt-2"
                      style={{ borderTop: '1px solid var(--pg-linea)' }}
                    >
                      {estado === 'bloqueada' ? (
                        <span
                          className="pg-mono text-[9px] tracking-[.1em]"
                          style={{ color: 'var(--pg-pendiente)' }}
                          title="El motor todavía no mide el evento que la dispara"
                        >
                          SIN SISTEMA AÚN
                        </span>
                      ) : (
                        <>
                          <span
                            className="pg-mono text-[9px] tracking-[.1em]"
                            style={{ color: 'var(--pg-mudo)' }}
                          >
                            VECES
                          </span>
                          <span
                            className="pg-mono text-[11px] font-semibold tabular-nums"
                            style={{ color: obtenida ? m.color : 'var(--pg-mudo-alto)' }}
                          >
                            {veces}
                          </span>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </ProgresionShell>
  )
}
