'use client'

/**
 * Resumen post-partida. Desde la fase 4 es la pantalla de recompensa
 * (secciones 9 y 10 del spec): cambio de RR, ceremonia de ascenso, barra de
 * XP y **drop de skin con animación de apertura**, que el spec llama "el
 * momento de dopamina más fuerte del ciclo".
 *
 * El orden vertical va de lo que más importa a lo que menos: primero el
 * rango (la razón por la que jugaste), después el nivel, después el botín, y
 * la tabla de puntaje al final. La tabla era lo único que existía en la fase
 * 2 y ahora es el cierre, no el titular.
 *
 * Este archivo no calcula nada: `MatchProgress` viene armado por
 * `progression/career.ts` y acá sólo se dibuja. Misma división que la
 * armería.
 */

import { useState, type ReactNode } from 'react'
import type { MatchSummary as MatchSummaryData } from '@/game/match/match'
import type { MatchProgress } from '@/game/progression/career'
import { rankColor, rankLabel, RR_MAXIMO } from '@/game/progression/ranks'
import { PLACEMENT } from '@/game/progression/placement'
import { xpParaNivel } from '@/game/progression/unlocks'
import { RARITY_BY_ID } from '@/game/skins/rarity'
import type { Skin } from '@/game/skins/generator'
import { participantLabel } from '@/ui/participant-label'

const MUESCAS = 20

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function rgb(c: Skin['colorBase']): string {
  return `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`
}

/**
 * Barra de RR segmentada. Marca aparte las muescas que se movieron en ESTA
 * partida, así el cambio se lee sin mirar el número.
 */
function BarraRr({ rrFinal, cambio }: { rrFinal: number; cambio: number }) {
  const previo = Math.max(0, Math.min(RR_MAXIMO, rrFinal - cambio))

  return (
    <div className="rng-barra" aria-hidden>
      {Array.from({ length: MUESCAS }, (_, i) => {
        const tope = ((i + 1) / MUESCAS) * RR_MAXIMO
        let estado = 'vacio'
        if (tope <= Math.min(previo, rrFinal)) estado = 'previo'
        else if (tope <= rrFinal) estado = 'ganado'
        else if (tope <= previo) estado = 'perdido'
        return <span key={i} className="rng-muesca" data-estado={estado} />
      })}
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rng-panel rng-chaflan p-3">
      <h3 className="rng-mono mb-2 text-[10px]" style={{ color: 'var(--rng-tenue)' }}>
        {titulo}
      </h3>
      {children}
    </section>
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
        <Seccion titulo="Colocaciones completas">
          <div
            className="rng-ceremonia flex items-center gap-3 py-1 pl-3"
            style={{ '--rng-tier': rankColor(seededRank) } as React.CSSProperties}
          >
            <span
              className="rng-insignia shrink-0"
              style={{ '--rng-tier': rankColor(seededRank) } as React.CSSProperties}
            />
            <div>
              <div className="text-base">{rankLabel(seededRank)}</div>
              <div className="text-xs" style={{ color: 'var(--rng-tenue)' }}>
                Este es tu rango. Desde acá ya se gana y se pierde RR.
              </div>
            </div>
          </div>
        </Seccion>
      )
    }

    const jugadas = placement?.state.played ?? 0
    const faltan = PLACEMENT.partidas - jugadas
    return (
      <Seccion titulo="Colocación">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-base tabular-nums">
            {jugadas} de {PLACEMENT.partidas}
          </span>
          <span className="text-xs" style={{ color: 'var(--rng-tenue)' }}>
            {faltan === 1 ? 'Falta una para tener rango' : `Faltan ${faltan} para tener rango`}
          </span>
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--rng-tenue)' }}>
          Los bots se ajustan a cómo vienes jugando. Todavía no ganas ni pierdes RR.
        </p>
      </Seccion>
    )
  }

  const rankActual = rr.state.rank
  const color = rankColor(rankActual)
  const subio = rr.movement === 'ascenso'
  const bajo = rr.movement === 'descenso'
  const ceremonia = subio || bajo

  return (
    <Seccion titulo={subio ? 'Ascenso' : bajo ? 'Descenso' : 'Rango'}>
      <div
        className={`flex items-center gap-3 ${ceremonia ? 'rng-ceremonia py-1 pl-3' : ''}`}
        style={{ '--rng-tier': color } as React.CSSProperties}
      >
        <span
          className="rng-insignia shrink-0"
          style={{ '--rng-tier': color } as React.CSSProperties}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-base">{rankLabel(rankActual)}</span>
            <span
              className="text-base tabular-nums"
              style={{ color: rr.change >= 0 ? 'var(--rng-gana)' : 'var(--rng-pierde)' }}
            >
              {rr.change >= 0 ? '+' : ''}
              {rr.change} RR
            </span>
          </div>
          <div className="mt-1.5">
            <BarraRr rrFinal={rr.state.rr} cambio={rr.change} />
          </div>
          <div
            className="mt-1 flex justify-between gap-3 text-[10px]"
            style={{ color: 'var(--rng-tenue)' }}
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
    </Seccion>
  )
}

function BloqueXp({ progress }: { progress: MatchProgress }) {
  const { xp } = progress
  const piso = xpParaNivel(xp.level)
  const techo = xpParaNivel(xp.level + 1)
  const dentro = techo > piso ? (xp.xp - piso) / (techo - piso) : 0
  const llenas = Math.max(0, Math.min(MUESCAS, Math.round(dentro * MUESCAS)))

  return (
    <Seccion titulo={xp.subioDeNivel ? `Nivel ${xp.level} alcanzado` : `Nivel ${xp.level}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs" style={{ color: 'var(--rng-tenue)' }}>
          {xp.subioDeNivel ? 'Tienes armas nuevas en la armería' : 'Progreso al siguiente nivel'}
        </span>
        <span className="tabular-nums" style={{ color: 'var(--rng-gana)' }}>
          +{xp.ganada.toLocaleString('es-CL')} XP
        </span>
      </div>
      <div className="rng-barra mt-2" aria-hidden>
        {Array.from({ length: MUESCAS }, (_, i) => (
          <span key={i} className="rng-muesca" data-estado={i < llenas ? 'previo' : 'vacio'} />
        ))}
      </div>
    </Seccion>
  )
}

/**
 * El drop. Cerrado es un botón que invita a abrirlo; abierto muestra la
 * skin. Se abre con un click y no con un temporizador a propósito: el gesto
 * de abrir es la mitad del momento, y quitárselo lo convierte en una
 * notificación.
 *
 * La skin está renderizada SIEMPRE debajo de las mitades selladas, no se
 * monta al abrir: si la animación no corre, igual se ve.
 */
function BloqueDrop({ progress }: { progress: MatchProgress }) {
  const [abierta, setAbierta] = useState(false)
  const { drop } = progress
  const rareza = RARITY_BY_ID[drop.skin.rarity]

  return (
    <Seccion titulo="Botín de partida">
      <button
        type="button"
        className="rng-caja rng-chaflan"
        data-abierta={abierta ? '1' : '0'}
        onClick={() => setAbierta(true)}
        aria-label={abierta ? `Skin obtenida: ${drop.skin.name}` : 'Abrir el botín de la partida'}
        aria-expanded={abierta}
      >
        <div className={`px-4 py-3 text-center ${abierta ? 'rng-revelado' : ''}`}>
          <div className="mb-2 flex justify-center gap-1" aria-hidden>
            <span className="block h-6 w-6" style={{ background: rgb(drop.skin.colorBase) }} />
            <span className="block h-6 w-6" style={{ background: rgb(drop.skin.colorAccent) }} />
          </div>
          <div className="text-sm">{drop.skin.name}</div>
          <div className="rng-mono mt-1 text-[10px]" style={{ color: rareza.color }}>
            {rareza.label}
            {!drop.nueva && <span style={{ color: 'var(--rng-apagado)' }}> · repetida</span>}
          </div>
        </div>

        {/* Mitades selladas, decorativas: tapan la skin hasta que se abre. */}
        <span className="rng-mitad" data-lado="izq" aria-hidden />
        <span className="rng-mitad" data-lado="der" aria-hidden />
        {!abierta && (
          <span className="rng-mono absolute text-xs" style={{ color: 'var(--rng-acento)' }}>
            Abrir
          </span>
        )}
      </button>
      {abierta && drop.nueva && (
        <p className="mt-2 text-xs" style={{ color: 'var(--rng-tenue)' }}>
          Ya está en tu inventario. Equípala en la armería.
        </p>
      )}
    </Seccion>
  )
}

export function MatchSummary({
  summary,
  progress,
}: {
  summary: MatchSummaryData
  progress: MatchProgress | null
}) {
  return (
    // pt-12: el HUD de rendimiento vive pegado arriba a la izquierda y el
    // encabezado del resumen le caía justo encima cuando el contenido es más
    // alto que la pantalla (el overlay pasa a alinear arriba en vez de al
    // centro). Ese margen lo despeja sin mover nada cuando sí entra.
    <div className="rng fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/80 p-4 pt-12">
      <div className="w-full max-w-md">
        <header className="mb-3">
          <h2 className="text-base">Partida terminada</h2>
          <p className="text-xs" style={{ color: 'var(--rng-tenue)' }}>
            {summary.mode === 'tdm' ? 'equipos' : 'todos contra todos'} ·{' '}
            {formatDuration(summary.durationS)} · ganó: {summary.winnerLabel}
          </p>
        </header>

        {/* `progress` puede ser null por un instante: el motor lo llena en el
            frame en que la partida cierra y React sondea cada 200ms. La tabla
            se muestra igual mientras tanto. */}
        {progress !== null && (
          <div className="mb-3 grid gap-2">
            <BloqueRango progress={progress} />
            <BloqueXp progress={progress} />
            <BloqueDrop progress={progress} />
          </div>
        )}

        <section className="rng-panel rng-chaflan p-3">
          <h3 className="rng-mono mb-2 text-[10px]" style={{ color: 'var(--rng-tenue)' }}>
            Puntaje
          </h3>
          <table className="rng-tabla w-full border-collapse text-xs tabular-nums">
            <thead>
              <tr className="text-left" style={{ color: 'var(--rng-tenue)' }}>
                <th className="font-normal">jugador</th>
                <th className="text-right font-normal">kills</th>
                <th className="text-right font-normal">muertes</th>
                <th className="text-right font-normal">hs</th>
                <th className="text-right font-normal">daño</th>
              </tr>
            </thead>
            <tbody>
              {summary.standings.map((p) => (
                <tr key={p.id}>
                  <td>{participantLabel(p.id)}</td>
                  <td className="text-right">{p.kills}</td>
                  <td className="text-right">{p.deaths}</td>
                  <td className="text-right">{p.headshots}</td>
                  <td className="text-right">{Math.round(p.damageDealt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}
