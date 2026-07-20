'use client'

/**
 * Carrera (ruta /career, sección 3 del spec). Dónde estás en la escalera
 * cuando no acabas de terminar una partida.
 *
 * Existe por una razón concreta y no por completar el mapa de rutas: el
 * rango sólo aparecía en la pantalla de fin de partida, que dura lo que el
 * jugador tarde en cerrarla. Un rango que no se puede mirar entre partidas
 * es un número que pasa, no una posición que se defiende.
 *
 * Fase 5: se reemplazó la maqueta por el diseño de
 * docs/design/progresion.dc.html. **La ruta y lo que informa se
 * conservaron**, incluido el panel de bots, que el diseño no traía y que es
 * lo que convierte al rango en algo que se siente (sección 8 del spec: la
 * dificultad se deriva del rango). Sacarlo hubiera sido perder información
 * real a cambio de parecerse más a una maqueta.
 *
 * Igual que la armería: acá no se calcula nada del juego. Rango, RR, nivel y
 * dificultad salen de `src/game/progression/`.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { careerDifficulty, estaColocando } from '@/game/progression/career'
import { headshotPct } from '@/game/progression/history'
import { PLACEMENT } from '@/game/progression/placement'
import {
  rankColor,
  rankIndex,
  rankLabel,
  rankName,
  RANK_COUNT,
  RANK_MAX,
  RR_MAXIMO,
  TIERS,
} from '@/game/progression/ranks'
import {
  careerFromProgress,
  createDefaultProgress,
  createProgressStore,
  type ProgressData,
} from '@/game/progression/store'
import { levelForXp, xpParaNivel } from '@/game/progression/unlocks'
import { interpolateDifficulty } from '@/game/bots/difficulty'
import { ProgresionShell } from '@/ui/progresion/Shell'
import { Pendiente } from '@/ui/progresion/Pendiente'
import { RankEmblem, RankEmblemVacio } from '@/ui/progresion/emblemas'

function Rotulo({ children }: { children: ReactNode }) {
  return (
    <span className="pg-mono text-[10px] tracking-[.16em]" style={{ color: 'var(--pg-tenue)' }}>
      {children}
    </span>
  )
}

/** Barra con relleno proporcional. El rayado en movimiento es la textura;
 *  el ancho es el dato. */
function Barra({ pct, variante }: { pct: number; variante: 'rr' | 'xp' }) {
  const llenado = Math.max(0, Math.min(100, pct))
  return (
    <div
      className="pg-chaflan relative h-3.5 overflow-hidden"
      style={{ background: 'var(--pg-panel-alto)', border: '1px solid var(--pg-linea-alta)' }}
      role="progressbar"
      aria-valuenow={Math.round(llenado)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`absolute inset-y-0 left-0 ${variante === 'rr' ? 'pg-rayado-rr' : 'pg-rayado'}`}
        style={{
          width: `${llenado}%`,
          background: variante === 'rr' ? 'rgba(138,125,255,.22)' : 'rgba(70,240,138,.18)',
        }}
      />
    </div>
  )
}

export function Career() {
  const [store] = useState(() => createProgressStore())
  const [progress, setProgress] = useState<ProgressData>(() => createDefaultProgress())

  useEffect(() => {
    // Mismo patrón que Armoury.tsx: localStorage no existe en el servidor,
    // así que los dos lados arrancan con el mismo default y la lectura real
    // ocurre después de montar.
    queueMicrotask(() => setProgress(store.load()))
  }, [store])

  const carrera = careerFromProgress(progress)
  const colocando = estaColocando(carrera)
  const dificultad = careerDifficulty(carrera)
  const bots = interpolateDifficulty(dificultad)

  const nivel = levelForXp(progress.xp)
  const piso = xpParaNivel(nivel)
  const techo = xpParaNivel(nivel + 1)
  const dentroNivel = techo > piso ? (progress.xp - piso) / (techo - piso) : 0

  const rank = carrera.rank
  const color = rank === null ? 'var(--pg-pendiente)' : rankColor(rank.rank)
  const tierActual = rank === null ? -1 : TIERS.indexOf(rankName(rank.rank).tier)

  return (
    <ProgresionShell procedencias={rank === null ? ['real', 'pendiente'] : ['real']}>
      <div className="flex h-full min-h-0 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
        {/* --- Columna izquierda: rango, RR, colocaciones, bots --------- */}
        <section
          className="flex w-full flex-none flex-col overflow-y-auto p-6 xl:w-[34%] xl:min-w-[340px] xl:max-w-[460px]"
          style={{ borderRight: '1px solid var(--pg-linea)' }}
        >
          <h2 className="pg-mono mb-4 text-[10px] tracking-[.24em]" style={{ color: 'var(--pg-mudo)' }}>
            {colocando ? 'COLOCACIÓN' : 'RANGO ACTUAL'}
          </h2>

          <div className="flex flex-col items-center text-center">
            {rank === null ? (
              <RankEmblemVacio size={118} />
            ) : (
              <RankEmblem rankIndex={rank.rank} size={118} animado={rank.rank === RANK_MAX} />
            )}

            <div className="mt-3 flex items-baseline gap-2">
              {rank === null ? (
                <span className="pg-display text-2xl font-bold tracking-[.08em]">
                  <Pendiente>SIN RANGO TODAVÍA</Pendiente>
                </span>
              ) : (
                <span className="pg-display text-2xl font-bold tracking-[.08em]" style={{ color }}>
                  {rankLabel(rank.rank).toUpperCase()}
                </span>
              )}
            </div>

            <div className="pg-mono mt-1 text-[10px] tracking-[.16em]" style={{ color: 'var(--pg-mudo)' }}>
              {rank === null
                ? `${RANK_COUNT} RANGOS · HIERRO 1 → DEIDAD`
                : `${rank.rank + 1} DE ${RANK_COUNT} RANGOS · HIERRO 1 → DEIDAD`}
            </div>
          </div>

          {/* Rank Rating */}
          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <Rotulo>RANK RATING</Rotulo>
              <span className="pg-mono text-sm font-semibold tabular-nums">
                {rank === null ? (
                  <Pendiente>sin RR</Pendiente>
                ) : (
                  <span style={{ color }}>{rank.rr}</span>
                )}
                <span style={{ color: 'var(--pg-mudo)' }}> / {RR_MAXIMO}</span>
              </span>
            </div>
            <Barra pct={rank === null ? 0 : (rank.rr / RR_MAXIMO) * 100} variante="rr" />
            <p className="pg-mono mt-1.5 text-[9px] tracking-[.08em]" style={{ color: 'var(--pg-mudo)' }}>
              {RR_MAXIMO} RR PARA SUBIR DE RANGO. LA VICTORIA SUMA, LA DERROTA RESTA.
            </p>
          </div>

          {/* Colocaciones */}
          <div className="mt-6">
            <div className="mb-2.5">
              <Rotulo>
                COLOCACIONES · {carrera.placement.played}/{PLACEMENT.partidas}
              </Rotulo>
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: PLACEMENT.partidas }, (_, i) => {
                const hecha = i < carrera.placement.played
                return (
                  <div
                    key={i}
                    className="pg-mono flex h-8 flex-1 items-center justify-center text-[11px]"
                    style={{
                      background: hecha ? 'rgba(70,240,138,.08)' : 'var(--pg-panel-alto)',
                      border: hecha
                        ? '1px solid var(--pg-acento)'
                        : '1px dashed var(--pg-linea-marcada)',
                      color: hecha ? 'var(--pg-acento)' : 'var(--pg-mudo)',
                    }}
                  >
                    {hecha ? '✓' : i + 1}
                  </div>
                )
              })}
            </div>
            <p className="pg-mono mt-1.5 text-[9px] tracking-[.08em]" style={{ color: 'var(--pg-mudo)' }}>
              {colocando
                ? 'SIN RANGO HASTA COMPLETAR LAS 5.'
                : 'COLOCACIONES COMPLETAS. YA CORRES POR RR.'}
            </p>
          </div>

          {/* Nivel de cuenta */}
          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <Rotulo>NIVEL DE CUENTA</Rotulo>
              <span className="pg-mono text-sm font-semibold tabular-nums">
                <span style={{ color: 'var(--pg-acento)' }}>{nivel}</span>
                <span style={{ color: 'var(--pg-mudo)' }}>
                  {' '}
                  · {progress.xp.toLocaleString('es-CL')} XP
                </span>
              </span>
            </div>
            <Barra pct={dentroNivel * 100} variante="xp" />
          </div>

          {/* Contra qué juegas. No está en el diseño: viene de la pantalla
              anterior y es dato real que no se pierde en el rediseño. */}
          <div className="mt-6">
            <div className="mb-2.5">
              <Rotulo>BOTS QUE ENFRENTAS</Rotulo>
            </div>
            <dl className="grid grid-cols-3 gap-3">
              {[
                ['REACCIÓN', `${Math.round(bots.reactionTimeS * 1000)} ms`],
                ['CONO', `${((bots.errorConeRad * 180) / Math.PI).toFixed(1)}°`],
                ['REPOSIC.', bots.repositionQuality.toFixed(2)],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="px-2.5 py-2"
                  style={{ background: 'var(--pg-panel)', border: '1px solid var(--pg-linea)' }}
                >
                  <dt className="pg-mono text-[8px] tracking-[.12em]" style={{ color: 'var(--pg-mudo)' }}>
                    {k}
                  </dt>
                  <dd
                    className="pg-mono mt-1 text-sm tabular-nums"
                    style={{ color: 'var(--pg-texto-medio)' }}
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            <p
              className="pg-mono mt-1.5 text-[9px] leading-relaxed tracking-[.08em]"
              style={{ color: 'var(--pg-mudo)' }}
            >
              SUBEN CON TU RANGO. EN {TIERS[0].toUpperCase()} REACCIONAN EN 400 MS CON 6.0° DE
              ERROR; EN {TIERS[TIERS.length - 1].toUpperCase()}, EN 120 MS CON 0.7°.
            </p>
          </div>
        </section>

        {/* --- Columna derecha: escalera e historial -------------------- */}
        <section className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mb-3.5 flex items-baseline justify-between gap-4">
            <span className="pg-mono text-[11px] tracking-[.2em]" style={{ color: 'var(--pg-tenue)' }}>
              ESCALERA COMPLETA · {TIERS.length} TIERS × 3 DIVISIONES + DEIDAD
            </span>
            <span className="pg-mono text-[9px] tracking-[.14em]" style={{ color: 'var(--pg-acento)' }}>
              {RANK_COUNT} RANGOS · DATO REAL
            </span>
          </div>

          <ol className="grid grid-cols-3 gap-2 lg:grid-cols-5">
            {TIERS.map((tier, i) => {
              const representante = rankIndex(tier, 1)
              const esActual = i === tierActual
              const c = rankColor(representante)
              const unica = tier === 'Deidad'
              return (
                <li
                  key={tier}
                  className="px-1 pb-2.5 pt-3 text-center"
                  aria-current={esActual ? 'true' : undefined}
                  style={{
                    background: esActual
                      ? `linear-gradient(180deg, ${c}22, transparent)`
                      : unica
                        ? 'linear-gradient(180deg,rgba(255,242,196,.08),transparent)'
                        : 'var(--pg-panel)',
                    borderTop: `2px solid ${esActual ? c : `${c}66`}`,
                    outline: esActual ? `1px solid ${c}55` : 'none',
                  }}
                >
                  <div className="flex justify-center">
                    <RankEmblem rankIndex={representante} size={46} animado={unica} />
                  </div>
                  <div className="pg-display mt-1.5 text-xs font-bold tracking-[.06em]" style={{ color: c }}>
                    {tier.toUpperCase()}
                  </div>
                  <div
                    className="pg-mono mt-0.5 text-[9px] tracking-[.08em]"
                    style={{ color: 'var(--pg-mudo-alto)' }}
                  >
                    {unica ? 'RANGO ÚNICO' : 'III · II · I'}
                  </div>
                </li>
              )
            })}
          </ol>

          <div className="mb-3 mt-6 flex items-baseline justify-between gap-4">
            <span className="pg-mono text-[11px] tracking-[.2em]" style={{ color: 'var(--pg-tenue)' }}>
              HISTORIAL RECIENTE
            </span>
            <span className="pg-mono text-[9px] tracking-[.14em]" style={{ color: 'var(--pg-mudo)' }}>
              {carrera.historial.length === 0
                ? 'SIN PARTIDAS'
                : `ÚLTIMAS ${carrera.historial.length}`}
            </span>
          </div>

          {carrera.historial.length === 0 ? (
            <div className="px-4 py-6 text-center" style={{ border: '1px dashed var(--pg-linea-marcada)' }}>
              <p className="pg-mono text-[11px] tracking-[.08em]" style={{ color: 'var(--pg-tenue)' }}>
                Todavía no jugaste ninguna partida.
              </p>
              <p className="pg-mono mt-1.5 text-[10px] tracking-[.08em]" style={{ color: 'var(--pg-mudo)' }}>
                Acá aparecen las últimas 10, con el mapa, tu línea y el RR que ganaste o perdiste.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {carrera.historial.map((h) => (
                <li
                  key={h.partida}
                  className="grid items-center gap-3 px-3.5 py-2.5"
                  style={{
                    gridTemplateColumns: '22px minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) 84px',
                    background: 'var(--pg-panel)',
                    borderLeft: `3px solid ${h.win ? 'var(--pg-acento)' : 'var(--pg-peligro)'}`,
                  }}
                >
                  <span
                    className="pg-display text-[13px] font-bold"
                    style={{ color: h.win ? 'var(--pg-acento)' : 'var(--pg-peligro)' }}
                    title={h.win ? 'Victoria' : 'Derrota'}
                  >
                    {h.win ? 'V' : 'D'}
                  </span>
                  <span className="pg-mono truncate text-[11px]" style={{ color: 'var(--pg-texto-medio)' }}>
                    {h.mapa ?? 'Mapa desconocido'}
                    {h.modo !== null && (
                      <span style={{ color: 'var(--pg-mudo)' }}>
                        {' '}
                        · {h.modo === 'tdm' ? 'equipos' : 'todos contra todos'}
                      </span>
                    )}
                  </span>
                  <span className="pg-mono text-[11px] tabular-nums" style={{ color: 'var(--pg-texto-medio)' }}>
                    {h.kills} / {h.deaths}
                  </span>
                  <span className="pg-mono text-[11px] tabular-nums" style={{ color: 'var(--pg-texto-medio)' }}>
                    {headshotPct(h)}% HS
                  </span>
                  <span
                    className="pg-mono text-right text-xs font-semibold tabular-nums"
                    style={{
                      color:
                        h.rrChange === null
                          ? 'var(--pg-mudo)'
                          : h.rrChange >= 0
                            ? 'var(--pg-acento)'
                            : 'var(--pg-peligro)',
                    }}
                  >
                    {h.rrChange === null
                      ? 'colocación'
                      : `${h.rrChange >= 0 ? '+' : ''}${h.rrChange} RR`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ProgresionShell>
  )
}
