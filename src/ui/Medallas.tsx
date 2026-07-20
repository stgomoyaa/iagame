'use client'

/**
 * Galería de medallas (ruta /medals). **Estado vacío honesto.**
 *
 * El sistema de medallas no existe todavía: se está construyendo aparte en
 * `game/progression/`. Esta pantalla NO lo implementa ni lo simula. Muestra
 * las 15 medallas del diseño en silueta apagada, con su nombre y la
 * condición que las otorgaría, y dice explícitamente que todavía no se
 * puede conseguir ninguna.
 *
 * Lo que deliberadamente NO hace, porque sería inventar datos:
 *
 * - No muestra contadores. Ni "0 veces", ni "0/15 conseguidas". Un contador
 *   implica que alguien lleva la cuenta, y hoy nadie la lleva.
 * - No marca ninguna como obtenida.
 * - No lee ni escribe el guardado.
 *
 *
 * PUNTO DE ENGANCHE (esto es lo que hay que tocar cuando el sistema exista)
 *
 * Todo lo que falta entra por una sola variable, `conteos`, hoy fija en un
 * mapa vacío. Forma esperada:
 *
 *     type ConteosMedallas = ReadonlyMap<string, number>
 *     // clave de MEDALLAS_VISUALES -> veces que se consiguió (>0)
 *     // clave ausente = nunca conseguida
 *
 * Conectarlo es:
 *
 *   1. Reemplazar `const conteos = SIN_SISTEMA` por la lectura real (el
 *      guardado, un hook, lo que exponga el sistema).
 *   2. Nada más. El resto del componente ya distingue obtenida de pendiente
 *      con `conteos.get(m.key) ?? 0`, ya pinta la medalla con su color y su
 *      halo cuando el conteo es mayor que cero, ya muestra "VECES n", y el
 *      filtro OBTENIDAS/PENDIENTES ya funciona sobre ese mismo dato.
 *
 * El aviso de "todavía no hay sistema" se apaga solo: está condicionado a
 * `haySistema`, que es `conteos !== SIN_SISTEMA`.
 */

import { useMemo, useState } from 'react'
import { MEDALLAS_VISUALES } from '@/ui/progresion/catalogo-visual'
import { ProgresionShell } from '@/ui/progresion/Shell'
import { AvisoPropuesto } from '@/ui/progresion/Pendiente'
import { MedalBadge } from '@/ui/progresion/emblemas'

/** Conteos por clave de medalla. Ver "punto de enganche" arriba. */
type ConteosMedallas = ReadonlyMap<string, number>

/**
 * El mapa vacío mientras el sistema no exista. Es una constante con nombre y
 * no un `new Map()` suelto para que `haySistema` pueda distinguir "no hay
 * sistema" de "hay sistema y este jugador no consiguió nada": son estados
 * distintos y la pantalla dice cosas distintas en cada uno.
 */
const SIN_SISTEMA: ConteosMedallas = new Map()

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
  // PUNTO DE ENGANCHE: cambiar esta línea por la lectura real. Ver cabecera.
  const conteos = SIN_SISTEMA
  const haySistema = conteos !== SIN_SISTEMA

  const [filtro, setFiltro] = useState<Filtro>('todas')

  const visibles = useMemo(
    () =>
      MEDALLAS_VISUALES.filter((m) => {
        const veces = conteos.get(m.key) ?? 0
        if (filtro === 'obtenidas') return veces > 0
        if (filtro === 'pendientes') return veces === 0
        return true
      }),
    [conteos, filtro],
  )

  return (
    <ProgresionShell procedencias={['propuesto']}>
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="flex flex-none flex-wrap items-center justify-between gap-4 px-6 py-4"
          style={{ borderBottom: '1px solid var(--pg-linea)' }}
        >
          <div className="flex items-center gap-4">
            <h1 className="pg-mono text-[11px] tracking-[.2em]" style={{ color: 'var(--pg-tenue)' }}>
              GALERÍA DE MEDALLAS
            </h1>
            {/* El filtro sólo tiene sentido cuando hay estados que filtrar. */}
            {haySistema && (
              <div className="flex gap-1.5">
                {FILTROS.map((f) => (
                  <Segmento key={f.id} activo={filtro === f.id} onClick={() => setFiltro(f.id)}>
                    {f.label}
                  </Segmento>
                ))}
              </div>
            )}
          </div>
          <span
            className="pg-mono text-[10px] tracking-[.12em]"
            style={{ color: 'var(--pg-mudo)' }}
          >
            {MEDALLAS_VISUALES.length} MEDALLAS DE DISEÑO
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {!haySistema && (
            <div className="mb-4">
              <AvisoPropuesto>
                Todavía no conseguiste ninguna medalla, porque el sistema que las otorga no está
                construido. Estas son las {MEDALLAS_VISUALES.length} del diseño con la condición que
                las daría. No hay contadores acá: cuando el sistema exista, cada una va a mostrar
                cuántas veces la sacaste.
              </AvisoPropuesto>
            </div>
          )}

          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {visibles.map((m) => {
              const veces = conteos.get(m.key) ?? 0
              const obtenida = veces > 0
              return (
                <li
                  key={m.key}
                  className="px-3.5 py-4 text-center"
                  style={{
                    background: obtenida
                      ? `radial-gradient(circle at 50% 20%, ${m.color}12, var(--pg-panel) 70%)`
                      : '#060a08',
                    border: `1px solid ${obtenida ? `${m.color}44` : 'var(--pg-linea)'}`,
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
                  {/* La fila de conteo aparece SÓLO cuando hay sistema. Sin
                      él no se dibuja un cero: no habría quién lo cuente. */}
                  {haySistema && (
                    <div
                      className="mt-2.5 flex items-center justify-center gap-1.5 pt-2"
                      style={{ borderTop: '1px solid var(--pg-linea)' }}
                    >
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
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </ProgresionShell>
  )
}
