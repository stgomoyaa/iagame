'use client'

/**
 * Resumen post-partida. Desde la fase 4 es la pantalla de recompensa
 * (secciones 9 y 10 del spec): cambio de RR, ceremonia de ascenso, barra de
 * XP y **drop de skin con animación de apertura**, que el spec llama "el
 * momento de dopamina más fuerte del ciclo".
 *
 * Fase 5: se portó el diseño de fin de partida de
 * docs/design/progresion.dc.html. **Sigue siendo un overlay dentro de
 * /play, no una ruta**, y por eso no lleva la barra de navegación de las
 * otras cuatro pantallas: no se navega a otra sección con una partida recién
 * terminada encima. Las props no cambiaron, así que ui/GameCanvas.tsx no se
 * tocó.
 *
 * Este archivo no calcula nada del juego: `MatchProgress` viene armado por
 * `progression/career.ts` y acá sólo se dibuja. Misma división que la
 * armería.
 */

import { useState, type ReactNode } from 'react'
import type { MatchSummary as MatchSummaryData } from '@/game/match/match'
import { sortedByKills, teamScore } from '@/game/match/scoring'
import { PLAYER_ID } from '@/game/match/types'
import type { MatchProgress } from '@/game/progression/career'
import { rankColor, rankLabel, RR_MAXIMO } from '@/game/progression/ranks'
import { PLACEMENT } from '@/game/progression/placement'
import { xpParaNivel } from '@/game/progression/unlocks'
import {
  medalBySlug,
  medalIconPath,
  xpDeMedallas,
  type MedalDef,
  type MedalTally,
} from '@/game/progression/medals'
import { RARITY_BY_ID } from '@/game/skins/rarity'
import type { Skin } from '@/game/skins/generator'
import { participantLabel } from '@/ui/participant-label'
import { RankEmblem } from '@/ui/progresion/emblemas'

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function rgb(c: Skin['colorBase']): string {
  return `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`
}

function hsPct(kills: number, headshots: number): number {
  return kills > 0 ? Math.round((headshots / kills) * 100) : 0
}

function Rotulo({ children }: { children: ReactNode }) {
  return (
    <div className="pg-mono text-[11px] tracking-[.2em]" style={{ color: 'var(--pg-tenue)' }}>
      {children}
    </div>
  )
}

/** Barra de progreso con relleno proporcional. */
function Barra({ pct }: { pct: number }) {
  const llenado = Math.max(0, Math.min(100, pct))
  return (
    <div
      className="pg-chaflan relative h-3 overflow-hidden"
      style={{ background: 'var(--pg-panel-alto)', border: '1px solid var(--pg-linea-alta)' }}
      role="progressbar"
      aria-valuenow={Math.round(llenado)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="pg-rayado absolute inset-y-0 left-0"
        style={{ width: `${llenado}%`, background: 'rgba(70,240,138,.18)' }}
      />
    </div>
  )
}

/** Bloque de rango: insignia, RR y, si la hubo, la ceremonia de ascenso. */
function BloqueRango({ progress }: { progress: MatchProgress }) {
  const { rr, placement, seededRank } = progress

  // Colocaciones: no hay rango que mostrar todavía, sólo cuánto falta. El
  // rango sembrado aparece recién al cerrar la quinta.
  if (rr === null) {
    if (seededRank !== null) {
      return (
        <div>
          <Rotulo>COLOCACIONES COMPLETAS</Rotulo>
          <div className="mt-2.5 flex items-center gap-3">
            <RankEmblem rankIndex={seededRank} size={54} />
            <div>
              <div
                className="pg-display text-xl font-bold tracking-[.06em]"
                style={{ color: rankColor(seededRank) }}
              >
                {rankLabel(seededRank).toUpperCase()}
              </div>
              <div className="pg-mono text-[10px]" style={{ color: 'var(--pg-mudo)' }}>
                Este es tu rango. Desde acá ya se gana y se pierde RR.
              </div>
            </div>
          </div>
        </div>
      )
    }

    const jugadas = placement?.state.played ?? 0
    const faltan = PLACEMENT.partidas - jugadas
    return (
      <div>
        <Rotulo>COLOCACIÓN</Rotulo>
        <div className="mt-2.5 flex items-baseline justify-between gap-3">
          <span className="pg-display text-2xl font-bold tabular-nums">
            {jugadas} / {PLACEMENT.partidas}
          </span>
          <span className="pg-mono text-[10px]" style={{ color: 'var(--pg-mudo)' }}>
            {faltan === 1 ? 'Falta una para tener rango' : `Faltan ${faltan} para tener rango`}
          </span>
        </div>
        <p className="pg-mono mt-2 text-[10px] leading-relaxed" style={{ color: 'var(--pg-mudo)' }}>
          Los bots se ajustan a cómo vienes jugando. Todavía no ganas ni pierdes RR.
        </p>
      </div>
    )
  }

  const rankActual = rr.state.rank
  const color = rankColor(rankActual)
  const subio = rr.movement === 'ascenso'
  const bajo = rr.movement === 'descenso'
  const ceremonia = subio || bajo

  return (
    <div>
      <Rotulo>{subio ? 'ASCENSO' : bajo ? 'DESCENSO' : 'CAMBIO DE RR'}</Rotulo>
      <div
        className={`mt-2.5 flex items-center gap-3 ${ceremonia ? 'pg-anim-snap' : ''}`}
        style={
          ceremonia
            ? { background: `linear-gradient(90deg, ${color}1f, transparent)`, padding: 8 }
            : undefined
        }
      >
        <RankEmblem rankIndex={rankActual} size={54} animado={subio} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="pg-display text-lg font-bold tracking-[.06em]" style={{ color }}>
              {rankLabel(rankActual).toUpperCase()}
            </span>
            <span
              className="pg-display text-2xl font-bold tabular-nums"
              style={{ color: rr.change >= 0 ? 'var(--pg-acento)' : 'var(--pg-peligro)' }}
            >
              {rr.change >= 0 ? '+' : ''}
              {rr.change}
            </span>
          </div>
          <div className="mt-1.5">
            <Barra pct={(rr.state.rr / RR_MAXIMO) * 100} />
          </div>
          <div
            className="pg-mono mt-1 flex justify-between gap-3 text-[10px]"
            style={{ color: 'var(--pg-mudo)' }}
          >
            <span className="tabular-nums">
              {rr.state.rr} / {RR_MAXIMO} RR
            </span>
            {subio && <span>Subiste desde {rankLabel(rr.rankAnterior)}</span>}
            {bajo && <span>Bajaste desde {rankLabel(rr.rankAnterior)}</span>}
            {/* El colchón se nombra sólo cuando actuó: si no, sería ruido. */}
            {!ceremonia && rr.colchonConsumido > 0 && <span>Te salvó el colchón de división</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function BloqueXp({ progress }: { progress: MatchProgress }) {
  const { xp } = progress
  const piso = xpParaNivel(xp.level)
  const techo = xpParaNivel(xp.level + 1)
  const dentro = techo > piso ? (xp.xp - piso) / (techo - piso) : 0

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <Rotulo>XP DE CUENTA</Rotulo>
        <span className="pg-mono text-[9px] tracking-[.12em]" style={{ color: 'var(--pg-acento)' }}>
          {(techo - piso).toLocaleString('es-CL')} XP AL PRÓXIMO
        </span>
      </div>
      <div className="mt-2.5 flex items-baseline justify-between gap-3">
        <span className="pg-display text-[15px] font-bold" style={{ color: 'var(--pg-texto-alto)' }}>
          NIVEL <span style={{ color: 'var(--pg-acento)' }}>{xp.level}</span>
        </span>
        <span className="pg-mono text-[11px] font-semibold tabular-nums" style={{ color: 'var(--pg-acento)' }}>
          +{xp.ganada.toLocaleString('es-CL')} XP
        </span>
      </div>
      <div className="mt-1.5">
        <Barra pct={dentro * 100} />
      </div>
      <p className="pg-mono mt-1.5 text-[10px]" style={{ color: 'var(--pg-mudo)' }}>
        {xp.subioDeNivel
          ? 'Subiste de nivel. Tienes armas nuevas en la armería.'
          : `${(xp.xp - piso).toLocaleString('es-CL')} / ${(techo - piso).toLocaleString('es-CL')} hacia el nivel ${xp.level + 1}`}
      </p>
    </div>
  )
}

/**
 * El drop. Cerrado es un botón que invita a abrirlo; abierto muestra la
 * skin. Se abre con un click y no con un temporizador a propósito: el gesto
 * de abrir es la mitad del momento, y quitárselo lo convierte en una
 * notificación.
 */
function BloqueDrop({ progress }: { progress: MatchProgress }) {
  const [abierta, setAbierta] = useState(false)
  const { drop } = progress
  const rareza = RARITY_BY_ID[drop.skin.rarity]

  return (
    <div>
      <Rotulo>DROP DE SKIN</Rotulo>
      <div className="relative mb-3 mt-3 flex min-h-[160px] items-center justify-center">
        {abierta ? (
          <>
            <span
              className="pg-anim-beam absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2"
              style={{
                background: 'linear-gradient(180deg,transparent,var(--pg-acento),transparent)',
              }}
              aria-hidden
            />
            <div className="pg-anim-rise relative z-[2] flex flex-col items-center text-center">
              <div
                className="mb-3.5 flex gap-1"
                style={{ filter: 'drop-shadow(0 0 24px rgba(70,240,138,.45))' }}
                aria-hidden
              >
                <span className="block h-14 w-14" style={{ background: rgb(drop.skin.colorBase) }} />
                <span className="block h-14 w-14" style={{ background: rgb(drop.skin.colorAccent) }} />
              </div>
              <div
                className="pg-display text-xl font-bold tracking-[.04em]"
                style={{ color: 'var(--pg-texto-alto)' }}
              >
                {drop.skin.name}
              </div>
              <div
                className="pg-mono mt-1.5 text-[10px] tracking-[.14em]"
                style={{ color: rareza.color }}
              >
                {rareza.label}
                {!drop.nueva && <span style={{ color: 'var(--pg-mudo)' }}> · repetida</span>}
              </div>
            </div>
          </>
        ) : (
          <div className="text-center">
            <div
              className="pg-hex mx-auto flex h-28 w-28 items-center justify-center"
              style={{
                background: 'linear-gradient(160deg,#12251b,#0a130e)',
                border: '1px solid rgba(70,240,138,.4)',
                boxShadow: '0 0 30px -8px rgba(70,240,138,.5)',
              }}
            >
              <span
                className="pg-display text-[34px] font-bold"
                style={{ color: 'var(--pg-acento)', textShadow: '0 0 14px rgba(70,240,138,.6)' }}
              >
                ?
              </span>
            </div>
            <div
              className="pg-mono mt-3 text-[9px] tracking-[.14em]"
              style={{ color: 'var(--pg-mudo)' }}
            >
              CONTENEDOR DE FIN DE PARTIDA
            </div>
          </div>
        )}
      </div>

      {!abierta ? (
        <button
          type="button"
          onClick={() => setAbierta(true)}
          className="pg-chaflan-btn pg-display w-full py-3 text-[13px] font-bold tracking-[.14em]"
          style={{
            color: 'var(--pg-fondo)',
            background: 'var(--pg-acento)',
            boxShadow: '0 0 20px -4px rgba(70,240,138,.6)',
          }}
        >
          ABRIR CONTENEDOR
        </button>
      ) : (
        <p className="pg-mono text-[10px]" style={{ color: 'var(--pg-mudo)' }}>
          {drop.nueva
            ? 'Ya está en tu inventario. Equípala en la armería.'
            : 'Ya la tenías. No se agrega de nuevo al inventario.'}
        </p>
      )}
    </div>
  )
}

/**
 * Medallas ganadas en la partida, en la columna del drop. Ordenadas por XP
 * (las gestas más valiosas arriba), con el icono real por slug, el nombre del
 * catálogo y la XP que sumaron a la cuenta (ese XP SÍ se acredita, ver
 * progressWithMedals). Sin medallas, no se dibuja nada -- cero bloque vacío.
 */
function BloqueMedallas({ medallas }: { medallas: MedalTally }) {
  const entradas: { def: MedalDef; veces: number }[] = []
  for (const [slug, veces] of Object.entries(medallas)) {
    const def = medalBySlug(slug)
    if (def !== null && veces > 0) entradas.push({ def, veces })
  }
  if (entradas.length === 0) return null
  entradas.sort((a, b) => b.def.xp - a.def.xp || a.def.slug.localeCompare(b.def.slug))
  const totalXp = xpDeMedallas(medallas)

  return (
    <div className="mt-6">
      <Rotulo>MEDALLAS</Rotulo>
      <div className="mt-3 flex flex-col gap-2">
        {entradas.map(({ def, veces }) => (
          <div key={def.slug} className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- icono
                local de UI de juego (mismo criterio que emblemas.tsx). */}
            <img
              src={medalIconPath(def.slug)}
              alt=""
              aria-hidden
              width={32}
              height={32}
              className="block h-8 w-8 flex-none"
              style={{ filter: 'drop-shadow(0 0 6px rgba(70,240,138,.28))' }}
            />
            <span
              className="pg-display min-w-0 flex-1 truncate text-sm font-bold tracking-[.02em]"
              style={{ color: 'var(--pg-texto-alto)' }}
            >
              {def.nombre}
              {veces > 1 && (
                <span className="pg-mono ml-1.5 text-[11px]" style={{ color: 'var(--pg-tenue)' }}>
                  ×{veces}
                </span>
              )}
            </span>
            <span
              className="pg-mono flex-none text-[11px] font-semibold tabular-nums"
              style={{ color: 'var(--pg-acento)' }}
            >
              +{(def.xp * veces).toLocaleString('es-CL')}
            </span>
          </div>
        ))}
      </div>
      <div
        className="mt-3 flex items-center justify-between border-t pt-2"
        style={{ borderColor: 'var(--pg-linea)' }}
      >
        <span className="pg-mono text-[10px] tracking-[.14em]" style={{ color: 'var(--pg-mudo)' }}>
          XP DE MEDALLAS
        </span>
        <span
          className="pg-mono text-[11px] font-semibold tabular-nums"
          style={{ color: 'var(--pg-acento)' }}
        >
          +{totalXp.toLocaleString('es-CL')}
        </span>
      </div>
    </div>
  )
}

export function MatchSummary({
  summary,
  progress,
  medallas,
}: {
  summary: MatchSummaryData
  progress: MatchProgress | null
  /** Medallas ganadas en ESTA partida (slug -> veces), o null si la partida
   *  no cerró todavía. El backend las otorga y guarda; esto sólo las muestra. */
  medallas: MedalTally | null
}) {
  const gano = summary.winnerLabel === 'jugador' || summary.winnerLabel === 'equipo del jugador'
  const empate = summary.winnerLabel === 'empate'
  const colorResultado = gano
    ? 'var(--pg-acento)'
    : empate
      ? 'var(--pg-pendiente)'
      : 'var(--pg-peligro)'
  const banner = gano ? 'VICTORIA' : empate ? 'EMPATE' : 'DERROTA'

  const esTdm = summary.mode === 'tdm'
  const orden = sortedByKills(summary.standings)
  const yo = summary.standings.find((p) => p.id === PLAYER_ID) ?? null
  const puesto = orden.findIndex((p) => p.id === PLAYER_ID) + 1

  const columnas = '20px minmax(0,1.4fr) repeat(4, minmax(0,1fr))'

  return (
    <div
      className="pg fixed inset-0 z-40 flex flex-col overflow-y-auto"
      style={{ background: 'rgba(4,6,10,.94)' }}
    >
      {/* --- Splash de resultado -------------------------------------- */}
      {/* `pt-10` y no `py-4`: el HUD de rendimiento vive pegado arriba a la
          izquierda (ui/Hud.ts, que no se toca) y el banner de VICTORIA le caía
          justo encima. Es el mismo choque que resolvía el `pt-12` del resumen
          anterior; el rediseño lo volvió a traer al ocupar la pantalla entera
          en vez de ser una tarjeta centrada. */}
      <header
        className="relative flex-none overflow-hidden px-6 pb-4 pt-10"
        style={{ borderBottom: '1px solid var(--pg-linea)' }}
      >
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(90deg, ${colorResultado}18, transparent 55%)` }}
          aria-hidden
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2
              className="pg-anim-slam pg-display text-[44px] font-bold leading-[.88] tracking-[.05em]"
              style={{ color: colorResultado, textShadow: `0 0 22px ${colorResultado}55` }}
            >
              {banner}
            </h2>
            <div
              className="pg-mono mt-1.5 text-[11px] tracking-[.18em]"
              style={{ color: 'var(--pg-tenue)' }}
            >
              {esTdm ? 'EQUIPOS' : 'TODOS CONTRA TODOS'} · {formatDuration(summary.durationS)}
            </div>
          </div>

          {esTdm ? (
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div
                  className="pg-display text-[34px] font-bold tabular-nums"
                  style={{ color: 'var(--pg-acento)' }}
                >
                  {teamScore(summary.mode, summary.standings, 0)}
                </div>
                <div
                  className="pg-display text-[9px] tracking-[.2em]"
                  style={{ color: 'var(--pg-mudo)' }}
                >
                  TU EQUIPO
                </div>
              </div>
              <span
                className="pg-display text-xl font-bold"
                style={{ color: 'var(--pg-linea-marcada)' }}
              >
                /
              </span>
              <div className="text-center">
                <div
                  className="pg-display text-[34px] font-bold tabular-nums"
                  style={{ color: 'var(--pg-peligro)' }}
                >
                  {teamScore(summary.mode, summary.standings, 1)}
                </div>
                <div
                  className="pg-display text-[9px] tracking-[.2em]"
                  style={{ color: 'var(--pg-mudo)' }}
                >
                  RIVAL
                </div>
              </div>
            </div>
          ) : (
            /* En todos contra todos no hay dos equipos que marcar. Lo que sí
               existe y es real es en qué puesto quedaste. */
            <div className="text-center">
              <div
                className="pg-display text-[34px] font-bold tabular-nums"
                style={{ color: colorResultado }}
              >
                {puesto > 0 ? `${puesto}º` : '-'}
              </div>
              <div
                className="pg-display text-[9px] tracking-[.2em]"
                style={{ color: 'var(--pg-mudo)' }}
              >
                DE {summary.standings.length}
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        {/* --- Marcador final ----------------------------------------- */}
        <section
          className="min-w-0 flex-1 overflow-y-auto p-5 xl:flex-[1.4]"
          style={{ borderRight: '1px solid var(--pg-linea)' }}
        >
          <div className="mb-2.5">
            <Rotulo>MARCADOR FINAL</Rotulo>
          </div>
          <div
            className="pg-mono grid gap-2.5 px-3 pb-2 text-[9px] tracking-[.12em]"
            style={{ gridTemplateColumns: columnas, color: 'var(--pg-mudo)' }}
          >
            <span />
            <span>JUGADOR</span>
            <span className="text-center">K</span>
            <span className="text-center">D</span>
            <span className="text-center">DMG</span>
            <span className="text-center">HS%</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {orden.map((p) => {
              const eres = p.id === PLAYER_ID
              return (
                <li
                  key={p.id}
                  className="grid items-center gap-2.5 px-3 py-2.5"
                  style={{
                    gridTemplateColumns: columnas,
                    background: eres
                      ? 'linear-gradient(90deg,rgba(70,240,138,.1),transparent)'
                      : 'var(--pg-panel)',
                    borderLeft: `3px solid ${eres ? 'var(--pg-acento)' : 'var(--pg-linea-marcada)'}`,
                  }}
                >
                  <span
                    className="pg-display text-[9px] font-bold"
                    style={{ color: 'var(--pg-acento)' }}
                  >
                    {eres ? 'TÚ' : ''}
                  </span>
                  <span
                    className="pg-mono truncate text-[11px]"
                    style={{ color: eres ? 'var(--pg-texto-alto)' : 'var(--pg-texto-medio)' }}
                  >
                    {participantLabel(p.id)}
                  </span>
                  {[p.kills, p.deaths, Math.round(p.damageDealt), hsPct(p.kills, p.headshots)].map(
                    (v, i) => (
                      <span
                        key={i}
                        className="pg-mono text-center text-[11px] tabular-nums"
                        style={{ color: 'var(--pg-texto-medio)' }}
                      >
                        {v}
                      </span>
                    ),
                  )}
                </li>
              )
            })}
          </ul>

          {yo !== null && (
            <div
              className="mt-4 px-3.5 py-3"
              style={{
                background: 'rgba(70,240,138,.05)',
                border: '1px solid var(--pg-linea-alta)',
              }}
            >
              <div
                className="pg-mono mb-2 text-[9px] tracking-[.18em]"
                style={{ color: 'var(--pg-acento)' }}
              >
                TU LÍNEA
              </div>
              <dl className="flex flex-wrap gap-5">
                {[
                  ['K / D', `${yo.kills} / ${yo.deaths}`],
                  ['DAÑO', `${Math.round(yo.damageDealt)}`],
                  ['HS%', `${hsPct(yo.kills, yo.headshots)}`],
                  ['MEJOR RACHA', `${yo.bestStreak}`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt
                      className="pg-mono text-[9px] tracking-[.14em]"
                      style={{ color: 'var(--pg-mudo)' }}
                    >
                      {k}
                    </dt>
                    <dd
                      className="pg-mono text-sm font-semibold tabular-nums"
                      style={{ color: 'var(--pg-texto-alto)' }}
                    >
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>

        {/* --- RR + XP ------------------------------------------------- */}
        <section
          className="w-full flex-none overflow-y-auto p-5 xl:w-[32%] xl:min-w-[280px]"
          style={{ borderRight: '1px solid var(--pg-linea)' }}
        >
          {/* `progress` puede ser null por un instante: el motor lo llena en
              el frame en que la partida cierra y React sondea cada 200ms. El
              marcador se muestra igual mientras tanto. */}
          {progress === null ? (
            <p className="pg-mono text-[10px]" style={{ color: 'var(--pg-mudo)' }}>
              Calculando tu progresión...
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              <BloqueRango progress={progress} />
              <BloqueXp progress={progress} />
            </div>
          )}
        </section>

        {/* --- Drop + medallas ----------------------------------------- */}
        <section
          className="w-full flex-none overflow-y-auto p-5 xl:w-[26%] xl:min-w-[250px]"
          style={{
            background: 'radial-gradient(circle at 50% 20%,rgba(70,240,138,.05),transparent 60%)',
          }}
        >
          {progress !== null && <BloqueDrop progress={progress} />}
          {medallas !== null && <BloqueMedallas medallas={medallas} />}
        </section>
      </div>
    </div>
  )
}
