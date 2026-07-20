'use client'

/**
 * Prestigio (ruta /prestige). **Estado vacío honesto.**
 *
 * El sistema de prestigio no existe todavía: se está construyendo aparte en
 * `game/progression/`. Esta pantalla NO lo implementa ni lo simula. Muestra
 * la escalera propuesta de 10 niveles con lo que desbloquearía cada uno, y
 * dice explícitamente que todavía no se puede entrar en prestigio.
 *
 * No lee ni escribe el guardado, y no muestra ningún número de progreso
 * inventado.
 *
 *
 * PUNTO DE ENGANCHE (esto es lo que hay que tocar cuando el sistema exista)
 *
 * Dos variables, hoy fijas:
 *
 *     const prestigioActual: { nivel: number } | null = null
 *     // null = el jugador todavía no entró en prestigio
 *     // { nivel: 3 } = está en Prestigio III
 *
 *     const nivelCuenta: number | null = null
 *     // nivel de cuenta actual, para mostrar cuánto falta para el techo.
 *     // Sale de `levelForXp(progress.xp)` cuando se quiera conectar.
 *
 * Conectarlo es reemplazar esas dos lecturas. El componente ya:
 *
 *   - marca el escalón alcanzado (`alcanzado = prestigioActual !== null &&
 *     p.level <= prestigioActual.nivel`),
 *   - escribe "TU PRESTIGIO ACTUAL" con el romano o "todavía ninguno",
 *   - muestra el progreso al techo cuando `nivelCuenta` no es null.
 *
 *
 * POR QUÉ CADA ESCALÓN LLEVA SU NÚMERO ROTULADO POR FUERA
 *
 * No es decoración. Los 10 PNG generados son círculos del mismo diámetro:
 * el contorno externo es idéntico entre varios pares (IoU 1.00) y sólo el
 * relleno interior los distingue. Medido, 06/07 y 09/10 se confunden a 64 px.
 * Como acá los 10 van en fila comparándose entre sí, el dibujo no alcanza
 * para identificarlos, y el numeral que el SVG dibuja adentro queda tapado
 * en cuanto el PNG carga. Por eso el rótulo va afuera del icono.
 */

import { useState } from 'react'
import { PRESTIGIOS_VISUALES } from '@/ui/progresion/catalogo-visual'
import { ProgresionShell } from '@/ui/progresion/Shell'
import { AvisoPropuesto, Pendiente } from '@/ui/progresion/Pendiente'
import { PrestigeBadge } from '@/ui/progresion/emblemas'

/** PUNTO DE ENGANCHE: null mientras no exista el sistema. Ver cabecera. */
const prestigioActual: { nivel: number } | null = null
/** PUNTO DE ENGANCHE: null mientras no se conecte el nivel de cuenta. */
const nivelCuenta: number | null = null

export function Prestigio() {
  const [seleccionado, setSeleccionado] = useState(0)
  const actual = PRESTIGIOS_VISUALES[seleccionado]

  return (
    <ProgresionShell procedencias={['propuesto']}>
      <div className="flex h-full min-h-0 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
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
              DISEÑO PROPUESTO · SIN SISTEMA AÚN
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
            {/* El número, por fuera del icono. Ver la cabecera. */}
            <div
              className="pg-display mt-3 text-3xl font-bold tracking-[.06em]"
              style={{ color: actual.color }}
            >
              PRESTIGIO {actual.roman}
            </div>
            <div className="pg-mono mt-1 text-[10px] tracking-[.14em]" style={{ color: 'var(--pg-mudo)' }}>
              NIVEL {actual.level} DE {PRESTIGIOS_VISUALES.length}
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
              DESBLOQUEARÍA
            </div>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--pg-texto-medio)' }}>
              {actual.reward}
            </p>
          </div>

          <div
            className="mt-3.5 px-4 py-3.5"
            style={{ background: 'var(--pg-panel)', borderLeft: '2px solid var(--pg-propuesto)' }}
          >
            <div
              className="pg-mono text-[9px] leading-relaxed tracking-[.16em]"
              style={{ color: 'var(--pg-tenue)' }}
            >
              CÓMO FUNCIONARÍA
              <span className="mt-1 block normal-case" style={{ color: 'var(--pg-apagado)' }}>
                Al llegar al techo de nivel de cuenta puedes entrar en Prestigio. Reinicia tu nivel
                a 1 y las armas se vuelven a desbloquear, pero conservas la insignia de forma
                permanente. Las recompensas son cosméticas: no cambian jugabilidad.
              </span>
            </div>
          </div>

          <div
            className="mt-3.5 flex items-center justify-between gap-3 px-3.5 py-3"
            style={{ border: '1px dashed var(--pg-linea-marcada)' }}
          >
            <span className="pg-mono text-[10px] tracking-[.12em]" style={{ color: 'var(--pg-tenue)' }}>
              TU PRESTIGIO ACTUAL
            </span>
            <span className="pg-mono text-xs">
              {prestigioActual === null ? (
                <Pendiente>todavía ninguno</Pendiente>
              ) : (
                <span style={{ color: 'var(--pg-acento)' }}>
                  {PRESTIGIOS_VISUALES[prestigioActual.nivel - 1]?.roman}
                </span>
              )}
            </span>
          </div>

          {nivelCuenta !== null && (
            <div
              className="mt-2 flex items-center justify-between gap-3 px-3.5 py-3"
              style={{ border: '1px dashed var(--pg-linea-marcada)' }}
            >
              <span className="pg-mono text-[10px] tracking-[.12em]" style={{ color: 'var(--pg-tenue)' }}>
                TU NIVEL DE CUENTA
              </span>
              <span className="pg-mono text-xs tabular-nums" style={{ color: 'var(--pg-acento)' }}>
                {nivelCuenta}
              </span>
            </div>
          )}
        </section>

        {/* --- Escalera de prestigios ---------------------------------- */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden p-6">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-3">
            <span className="pg-mono text-[11px] tracking-[.2em]" style={{ color: 'var(--pg-tenue)' }}>
              ESCALERA DE PRESTIGIO · {PRESTIGIOS_VISUALES.length} NIVELES
            </span>
            <span
              className="pg-mono text-[9px] tracking-[.14em]"
              style={{ color: 'var(--pg-pendiente-suave)' }}
            >
              ELIGE UN NIVEL PARA VER QUÉ DESBLOQUEARÍA
            </span>
          </div>
          <p className="pg-mono mb-3.5 text-[9px] tracking-[.1em]" style={{ color: 'var(--pg-mudo)' }}>
            SE ASCIENDE DE IZQUIERDA A DERECHA. EL X ES EL TECHO: INSIGNIA MAESTRO.
          </p>

          <div className="mb-4">
            <AvisoPropuesto>
              Nada de esta escalera está implementada. Es la propuesta de diseño con sus
              recompensas; todavía no puedes entrar en prestigio ni tienes progreso que mostrar acá.
            </AvisoPropuesto>
          </div>

          <ol className="flex min-h-0 flex-1 items-end gap-1.5 pb-2">
            {PRESTIGIOS_VISUALES.map((p, i) => {
              const sel = i === seleccionado
              const alcanzado = prestigioActual !== null && p.level <= prestigioActual.nivel
              return (
                <li key={p.level} className="flex min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setSeleccionado(i)}
                    aria-pressed={sel}
                    aria-label={`Prestigio ${p.roman}`}
                    className="flex w-full flex-col items-center justify-end"
                    style={{ paddingBottom: 4 + i * 7 }}
                  >
                    <PrestigeBadge
                      level={p.level}
                      color={p.color}
                      roman={p.roman}
                      size={54}
                      activo={sel || alcanzado}
                    />
                    {/* Rótulo OBLIGATORIO, no decorativo: sin él, 06/07 y
                        09/10 son indistinguibles a este tamaño. */}
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
