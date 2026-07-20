'use client'

/**
 * Prestigio (ruta /prestige).
 *
 * **Es la única de las cinco pantallas sin sistema detrás**, y no lo
 * disimula. El porqué está en progression/prestige.ts: entrar en prestigio
 * reinicia el nivel y vuelve a bloquear las armas, y eso toca desbloqueos,
 * loadout y la relación entre XP y nivel. Ninguna de esas decisiones estaba
 * especificada, así que implementarlas acá sería inventar el diseño en vez
 * de portarlo.
 *
 * Lo que sí es real en esta pantalla: **tu nivel de cuenta y cuánto te falta
 * para el techo**, que sale de `levelForXp` sobre tu XP guardada. El resto
 * se presenta explícitamente como la escalera propuesta.
 */

import { useEffect, useState } from 'react'
import {
  nivelParaPrestigio,
  PRESTIGIOS,
  puedeEntrarEnPrestigio,
} from '@/game/progression/prestige'
import {
  createDefaultProgress,
  createProgressStore,
  type ProgressData,
} from '@/game/progression/store'
import { levelForXp } from '@/game/progression/unlocks'
import { ProgresionShell } from '@/ui/progresion/Shell'
import { AvisoPropuesto, Pendiente } from '@/ui/progresion/Pendiente'
import { PrestigeBadge } from '@/ui/progresion/emblemas'

export function Prestigio() {
  const [store] = useState(() => createProgressStore())
  const [progress, setProgress] = useState<ProgressData>(() => createDefaultProgress())
  const [seleccionado, setSeleccionado] = useState(0)

  useEffect(() => {
    queueMicrotask(() => setProgress(store.load()))
  }, [store])

  const nivel = levelForXp(progress.xp)
  const techo = nivelParaPrestigio()
  const habilitado = puedeEntrarEnPrestigio(nivel)
  const actual = PRESTIGIOS[seleccionado]

  return (
    <ProgresionShell procedencias={['real', 'propuesto']}>
      <div className="flex min-h-0 flex-col xl:h-full xl:flex-row">
        {/* --- Detalle del prestigio seleccionado ---------------------- */}
        <section
          className="flex w-full flex-none flex-col overflow-y-auto p-6 xl:w-[34%] xl:min-w-[340px] xl:max-w-[460px]"
          style={{ borderRight: '1px solid var(--pg-linea)' }}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className="h-1.5 w-1.5"
              style={{
                background: 'var(--pg-propuesto)',
                clipPath: 'polygon(50% 0,100% 100%,0 100%)',
              }}
              aria-hidden
            />
            <span
              className="pg-mono text-[9px] tracking-[.16em]"
              style={{ color: 'var(--pg-pendiente-suave)' }}
            >
              DISEÑO PROPUESTO · SIN CÓDIGO AÚN
            </span>
          </div>
          <h1 className="pg-mono mb-3.5 text-[10px] tracking-[.24em]" style={{ color: 'var(--pg-mudo)' }}>
            PRESTIGIO SELECCIONADO
          </h1>

          <div className="flex flex-col items-center text-center">
            <PrestigeBadge
              level={actual.level}
              color={actual.color}
              roman={actual.roman}
              size={150}
              activo
            />
            <div
              className="pg-display mt-3 text-3xl font-bold tracking-[.06em]"
              style={{ color: actual.color }}
            >
              PRESTIGIO {actual.roman}
            </div>
            <div className="pg-mono mt-1 text-[10px] tracking-[.14em]" style={{ color: 'var(--pg-mudo)' }}>
              NIVEL {actual.level} DE {PRESTIGIOS.length}
            </div>
          </div>

          <div
            className="mt-5 p-4"
            style={{
              background: 'var(--pg-pendiente-fondo)',
              border: '1px solid var(--pg-pendiente-linea)',
            }}
          >
            <div
              className="pg-mono mb-2 text-[9px] tracking-[.18em]"
              style={{ color: 'var(--pg-pendiente)' }}
            >
              DESBLOQUEA
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--pg-texto-medio)' }}>
              {actual.reward}
            </p>
          </div>

          <div
            className="mt-3.5 px-4 py-3.5"
            style={{ background: 'var(--pg-panel)', borderLeft: '2px solid var(--pg-acento)' }}
          >
            <div
              className="pg-mono text-[9px] leading-relaxed tracking-[.16em]"
              style={{ color: 'var(--pg-tenue)' }}
            >
              CÓMO FUNCIONARÍA
              <span className="mt-1 block normal-case" style={{ color: 'var(--pg-apagado)' }}>
                Al llegar a nivel de cuenta {techo} puedes entrar en Prestigio. Reinicia tu nivel a
                1 y las armas se vuelven a desbloquear, pero conservas la insignia de forma
                permanente. Las recompensas son cosméticas: no cambian jugabilidad.
              </span>
            </div>
          </div>

          {/* Lo único real de esta pantalla. */}
          <div
            className="mt-3.5 flex items-center justify-between gap-3 px-3.5 py-3"
            style={{ border: '1px dashed var(--pg-linea-marcada)' }}
          >
            <span className="pg-mono text-[10px] tracking-[.12em]" style={{ color: 'var(--pg-tenue)' }}>
              TU NIVEL DE CUENTA
            </span>
            <span className="pg-mono text-xs tabular-nums" style={{ color: 'var(--pg-acento)' }}>
              {nivel} / {techo}
            </span>
          </div>
          <div
            className="mt-2 flex items-center justify-between gap-3 px-3.5 py-3"
            style={{ border: '1px dashed var(--pg-linea-marcada)' }}
          >
            <span className="pg-mono text-[10px] tracking-[.12em]" style={{ color: 'var(--pg-tenue)' }}>
              TU PRESTIGIO ACTUAL
            </span>
            <span className="pg-mono text-xs">
              <Pendiente>sin sistema</Pendiente>
            </span>
          </div>
          <p className="pg-mono mt-2 text-[9px] leading-relaxed tracking-[.08em]" style={{ color: 'var(--pg-mudo)' }}>
            {habilitado
              ? `Llegaste al techo de nivel ${techo}. Cuando el sistema exista, acá podrías entrar en Prestigio I.`
              : `Te faltan ${techo - nivel} niveles para llegar al techo.`}
          </p>
        </section>

        {/* --- Escalera de prestigios ---------------------------------- */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden p-6">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-3">
            <span className="pg-mono text-[11px] tracking-[.2em]" style={{ color: 'var(--pg-tenue)' }}>
              ESCALERA DE PRESTIGIO · {PRESTIGIOS.length} NIVELES
            </span>
            <span
              className="pg-mono text-[9px] tracking-[.14em]"
              style={{ color: 'var(--pg-pendiente-suave)' }}
            >
              ELIGE UN NIVEL PARA VER QUÉ DESBLOQUEA
            </span>
          </div>
          <p className="pg-mono mb-3.5 text-[9px] tracking-[.1em]" style={{ color: 'var(--pg-mudo)' }}>
            SE ASCIENDE DE IZQUIERDA A DERECHA. EL X ES EL TECHO: INSIGNIA MAESTRO.
          </p>

          <div className="mb-4">
            <AvisoPropuesto>
              Nada de esta escalera está implementado. Es la propuesta de diseño, con las
              recompensas tal como se especificaron. Tu progreso real hacia el nivel {techo} está a
              la izquierda.
            </AvisoPropuesto>
          </div>

          <ol className="flex min-h-0 flex-1 items-end gap-1.5 pb-2">
            {PRESTIGIOS.map((p, i) => {
              const sel = i === seleccionado
              return (
                <li key={p.level} className="flex min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setSeleccionado(i)}
                    aria-pressed={sel}
                    className="flex w-full flex-col items-center justify-end transition-transform"
                    style={{ paddingBottom: 4 + i * 7 }}
                  >
                    <PrestigeBadge
                      level={p.level}
                      color={p.color}
                      roman={p.roman}
                      size={54}
                      activo={sel}
                    />
                    <span
                      className="mt-2 w-full px-0.5 pb-2 pt-2 text-center"
                      style={{
                        background: sel
                          ? `linear-gradient(180deg, ${p.color}26, transparent)`
                          : 'var(--pg-panel)',
                        borderTop: `2px solid ${sel ? p.color : `${p.color}44`}`,
                      }}
                    >
                      <span
                        className="pg-mono text-[11px] font-bold"
                        style={{ color: sel ? p.color : 'var(--pg-mudo-alto)' }}
                      >
                        P{p.roman}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          <div
            className="mt-1.5 h-0.5 flex-none"
            style={{
              background: 'linear-gradient(90deg,#c07f43,#ffce4d,#4fe3cf,#a06bff,#fff2c4)',
            }}
            aria-hidden
          />
        </section>
      </div>
    </ProgresionShell>
  )
}
