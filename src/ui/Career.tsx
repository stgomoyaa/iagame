'use client'

/**
 * Carrera (ruta /career, sección 3 del spec). Dónde estás en la escalera
 * cuando no acabás de terminar una partida.
 *
 * Existe por una razón concreta y no por completar el mapa de rutas: el
 * rango sólo aparecía en la pantalla de fin de partida, que dura lo que el
 * jugador tarde en cerrarla. Un rango que no se puede mirar entre partidas
 * es un número que pasa, no una posición que se defiende.
 *
 * Igual que la armería: acá no se calcula nada del juego. Rango, RR, nivel y
 * dificultad salen de `src/game/progression/`.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { careerDifficulty, estaColocando } from '@/game/progression/career'
import { PLACEMENT } from '@/game/progression/placement'
import { rankColor, rankLabel, RANK_MAX, RR_MAXIMO, TIERS } from '@/game/progression/ranks'
import { RR } from '@/game/progression/rr'
import {
  careerFromProgress,
  createDefaultProgress,
  createProgressStore,
  type ProgressData,
} from '@/game/progression/store'
import { levelForXp, xpParaNivel } from '@/game/progression/unlocks'
import { interpolateDifficulty } from '@/game/bots/difficulty'

const MUESCAS = 20

function Muescas({ llenas }: { llenas: number }) {
  return (
    <div className="rng-barra" aria-hidden>
      {Array.from({ length: MUESCAS }, (_, i) => (
        <span key={i} className="rng-muesca" data-estado={i < llenas ? 'previo' : 'vacio'} />
      ))}
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
  const color = rank === null ? 'var(--rng-acento)' : rankColor(rank.rank)

  return (
    <div className="rng min-h-screen bg-[#05070b] p-6">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-5 flex items-baseline justify-between gap-4">
          <h1 className="text-lg">Carrera</h1>
          <nav className="flex gap-4 text-xs">
            <Link href="/play" className="arm-enlace">
              Jugar
            </Link>
            <Link href="/armory" className="arm-enlace">
              Armería
            </Link>
          </nav>
        </header>

        <section
          className="rng-panel rng-chaflan mb-3 p-4"
          style={{ '--rng-tier': color } as React.CSSProperties}
        >
          <h2 className="rng-mono mb-3 text-[10px]" style={{ color: 'var(--rng-tenue)' }}>
            {colocando ? 'Colocación' : 'Rango actual'}
          </h2>

          {rank === null ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xl tabular-nums">
                  {carrera.placement.played} de {PLACEMENT.partidas}
                </span>
                <span className="text-xs" style={{ color: 'var(--rng-tenue)' }}>
                  partidas de colocación jugadas
                </span>
              </div>
              <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--rng-tenue)' }}>
                Todavía no tienes rango. Los bots se ajustan a cómo vienes jugando y, al terminar la
                quinta, se siembra tu rango inicial.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <span
                  className="rng-insignia shrink-0"
                  style={{ '--rng-tier': color } as React.CSSProperties}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xl">{rankLabel(rank.rank)}</span>
                    <span className="text-sm tabular-nums" style={{ color: 'var(--rng-tenue)' }}>
                      {rank.rr} / {RR_MAXIMO} RR
                    </span>
                  </div>
                  <div className="mt-2">
                    <Muescas llenas={Math.round((rank.rr / RR_MAXIMO) * MUESCAS)} />
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs" style={{ color: 'var(--rng-tenue)' }}>
                Colchón de división: {rank.cushion} de {RR.colchon} RR. Mientras te quede, un mal
                partido no te baja de división.
              </p>
            </>
          )}
        </section>

        {/* Lo que hace que el rango signifique algo: contra qué juegas. */}
        <section className="rng-panel rng-chaflan mb-3 p-4">
          <h2 className="rng-mono mb-3 text-[10px]" style={{ color: 'var(--rng-tenue)' }}>
            Bots que enfrentas
          </h2>
          <dl className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <dt style={{ color: 'var(--rng-tenue)' }}>Reacción</dt>
              <dd className="mt-1 text-base tabular-nums">
                {Math.round(bots.reactionTimeS * 1000)} ms
              </dd>
            </div>
            <div>
              <dt style={{ color: 'var(--rng-tenue)' }}>Cono de error</dt>
              <dd className="mt-1 text-base tabular-nums">
                {((bots.errorConeRad * 180) / Math.PI).toFixed(1)}°
              </dd>
            </div>
            <div>
              <dt style={{ color: 'var(--rng-tenue)' }}>Reposicionamiento</dt>
              <dd className="mt-1 text-base tabular-nums">{bots.repositionQuality.toFixed(2)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--rng-tenue)' }}>
            Suben con tu rango. En {TIERS[0]} reaccionan en 400 ms con 6.0° de error; en{' '}
            {TIERS[TIERS.length - 1]}, en 120 ms con 0.7°.
          </p>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rng-panel rng-chaflan p-4">
            <h2 className="rng-mono mb-3 text-[10px]" style={{ color: 'var(--rng-tenue)' }}>
              Nivel de cuenta
            </h2>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xl tabular-nums">{nivel}</span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--rng-tenue)' }}>
                {progress.xp.toLocaleString('es-CL')} XP
              </span>
            </div>
            <div className="mt-2">
              <Muescas llenas={Math.round(dentroNivel * MUESCAS)} />
            </div>
            <p className="mt-2 text-xs" style={{ color: 'var(--rng-tenue)' }}>
              Desbloquea armas en la armería.
            </p>
          </section>

          <section className="rng-panel rng-chaflan p-4">
            <h2 className="rng-mono mb-3 text-[10px]" style={{ color: 'var(--rng-tenue)' }}>
              Historial
            </h2>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt style={{ color: 'var(--rng-tenue)' }}>Partidas</dt>
                <dd className="mt-1 text-base tabular-nums">{progress.partidasJugadas}</dd>
              </div>
              <div>
                <dt style={{ color: 'var(--rng-tenue)' }}>Ganadas</dt>
                <dd className="mt-1 text-base tabular-nums">{progress.victorias}</dd>
              </div>
              <div>
                <dt style={{ color: 'var(--rng-tenue)' }}>Perdidas</dt>
                <dd className="mt-1 text-base tabular-nums">{progress.derrotas}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs" style={{ color: 'var(--rng-tenue)' }}>
              {progress.skins.length} skins en el inventario.
            </p>
          </section>
        </div>

        {rank !== null && rank.rank === RANK_MAX && (
          <p className="mt-4 text-xs" style={{ color: 'var(--rng-tenue)' }}>
            Estás en el techo de la escalera. No hay rango por encima.
          </p>
        )}
      </div>
    </div>
  )
}
