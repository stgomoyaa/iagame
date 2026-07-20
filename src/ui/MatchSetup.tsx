'use client'

/**
 * Pantalla de configuración de partida: lo que hay entre abrir el juego y
 * disparar. El pedido del dueño, textual: "en el menú uno puede iniciar una
 * partida o una ranked, con 2v2 en mapas pequeños... o ir personalizando. Si
 * quiero jugar 6v6 en un mapa pequeño que también me deje".
 *
 * DOS DECISIONES DE DISEÑO, LAS DOS DEL DUEÑO:
 *
 *  1. **Los presets sugieren, no imponen.** 2v2, 3v3 y 6v6 son atajos que
 *     rellenan la configuración; el tamaño del mapa es una SUGERENCIA que se
 *     muestra al lado (medida de verdad, no una lista a mano: ver
 *     ui/medidas-mapa.ts). Ninguna combinación de mapa y tamaño está
 *     prohibida ni deshabilitada. Este es un juego para él, no un
 *     matchmaking que lo protege de sí mismo.
 *  2. **La ranked es aparte.** Ahí la configuración la fija el modo, porque
 *     el RR y el rango sólo significan algo si las partidas son comparables
 *     entre sí (ver match/configuracion.ts CONFIG_RANKED).
 *
 * Acá no se calcula nada del juego: la matemática de la configuración vive
 * en match/configuracion.ts y la del tamaño de mapa en match/tamano-mapa.ts,
 * las dos puras y testeadas aparte. Esta pantalla sólo las muestra y arma la
 * URL de /play. Misma división que la armería y la carrera.
 *
 * El estilo hereda los tokens `--arm-*` (app/globals.css): es el mismo
 * juego, no una pantalla pegada aparte. La firma propia de esta pantalla es
 * el INSTRUMENTO DE EQUIPOS: dos hileras de muescas que muestran cómo queda
 * el reparto A contra B, con tu lugar marcado, en el mismo lenguaje de barra
 * segmentada que la armería usa para las estadísticas.
 */

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  acotarConfig,
  aQuery,
  CONFIG_RANKED,
  configPorDefecto,
  etiquetaDeConfig,
  MAX_POR_EQUIPO,
  porEquipo,
  PRESETS,
  type ConfigPartida,
} from '@/game/match/configuracion'
import { MIN_BOTS } from '@/game/match/roster'
import type { MatchMode } from '@/game/match/types'
import { DEFAULT_MAP_NAME } from '@/game/map/registry'
import { ETIQUETA_TAMANO, type MedidaMapa } from '@/game/match/tamano-mapa'
import { medirMapaDeCodigo, medirPorNombre, nombresDeMapas } from '@/ui/medidas-mapa'

/** Nombre de mapa como se lee en pantalla. Los importados llegan en
 *  minúscula con guiones bajos desde su archivo; se limpian sólo para
 *  mostrar. */
function nombreLegible(nombre: string): string {
  return nombre.replace(/_/g, ' ')
}

/** Instrumento de equipos: dos hileras de muescas, A contra B, con tu lugar
 *  marcado. En FFA no hay equipos, así que es una sola hilera de jugadores. */
function InstrumentoEquipos({ config }: { config: ConfigPartida }) {
  const total = config.jugadores
  if (config.modo === 'ffa') {
    return (
      <div className="setup-equipos" aria-hidden>
        <div className="setup-hilera">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className="setup-muesca" data-tu={i === 0 ? '1' : undefined} />
          ))}
        </div>
      </div>
    )
  }
  const a = Math.ceil(total / 2)
  const b = Math.floor(total / 2)
  return (
    <div className="setup-equipos" aria-hidden>
      <div className="setup-hilera" data-equipo="a">
        {Array.from({ length: a }, (_, i) => (
          <span key={i} className="setup-muesca" data-equipo="a" data-tu={i === 0 ? '1' : undefined} />
        ))}
      </div>
      <div className="setup-hilera" data-equipo="b">
        {Array.from({ length: b }, (_, i) => (
          <span key={i} className="setup-muesca" data-equipo="b" />
        ))}
      </div>
    </div>
  )
}

export function MatchSetup() {
  // La configuración editable de la partida casual. Arranca en el default que
  // el motor ya tenía tuneado (MATCH.botCount + jugador), así que entrar sin
  // tocar nada juega la partida de siempre.
  const [config, setConfig] = useState<ConfigPartida>(() => configPorDefecto(DEFAULT_MAP_NAME))
  // 'casual' se configura; 'ranked' muestra CONFIG_RANKED de sólo lectura.
  const [entrada, setEntrada] = useState<'casual' | 'ranked'>('casual')

  // Medidas de tamaño por mapa. Los mapas de código se miden al instante (su
  // geometría ya está en memoria); los importados hay que bajarlos, así que
  // entran de a uno cuando resuelve su medición. `null` = medido y sin dato
  // (archivo ausente); ausente del Map = todavía midiendo.
  const [medidas, setMedidas] = useState<Map<string, MedidaMapa | null>>(() => {
    const inicial = new Map<string, MedidaMapa | null>()
    for (const nombre of nombresDeMapas()) {
      const deCodigo = medirMapaDeCodigo(nombre)
      if (deCodigo !== null) inicial.set(nombre, deCodigo)
    }
    return inicial
  })

  useEffect(() => {
    let vivo = true
    void (async () => {
      for (const nombre of nombresDeMapas()) {
        if (medidas.has(nombre)) continue
        const m = await medirPorNombre(nombre)
        if (!vivo) return
        setMedidas((prev) => {
          const siguiente = new Map(prev)
          siguiente.set(nombre, m)
          return siguiente
        })
      }
    })()
    return () => {
      vivo = false
    }
    // Sólo al montar: la lista de mapas no cambia en vida de esta pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activa = entrada === 'ranked' ? CONFIG_RANKED : config
  const editable = entrada === 'casual'
  const mapas = nombresDeMapas()
  const porEq = porEquipo(activa.jugadores)

  const href = useMemo(() => `/play?${aQuery(activa)}`, [activa])

  function setJugadores(jugadores: number): void {
    setConfig((c) => acotarConfig({ ...c, jugadores }))
  }
  function setPorEquipo(n: number): void {
    setJugadores(n * 2)
  }
  function setMapa(mapa: string): void {
    setConfig((c) => ({ ...c, mapa }))
  }
  function setModo(modo: MatchMode): void {
    setConfig((c) => ({ ...c, modo }))
  }

  const presetActivo = (jugadores: number): boolean =>
    editable && activa.modo === 'tdm' && activa.jugadores === jugadores

  return (
    <main className="arm flex min-h-screen flex-col items-center px-4 py-6">
      <div className="arm-panel arm-chaflan flex w-full max-w-3xl flex-col overflow-hidden">
        {/* Cabecera + elección de tipo de partida */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--arm-linea-tenue)] px-4 py-3">
          <div>
            <p className="arm-mono text-[0.5625rem] text-[var(--arm-apagado)]">Arcade FPS</p>
            <h1 className="arm-mono mt-1 text-sm tracking-[0.22em] text-[var(--arm-texto)]">
              Configurar partida
            </h1>
          </div>
          <div className="flex gap-2" role="tablist" aria-label="Tipo de partida">
            <button
              type="button"
              role="tab"
              aria-selected={entrada === 'casual'}
              className="arm-tab arm-chaflan px-4 py-2"
              onClick={() => setEntrada('casual')}
            >
              <span className="arm-mono text-[0.6875rem]">Partida</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={entrada === 'ranked'}
              className="arm-tab arm-chaflan px-4 py-2"
              onClick={() => setEntrada('ranked')}
            >
              <span className="arm-mono text-[0.6875rem]">Ranked</span>
            </button>
          </div>
        </header>

        <div className="flex flex-col gap-4 p-4">
          {entrada === 'ranked' ? (
            <div className="arm-panel arm-chaflan flex flex-col gap-3 p-4">
              <p className="arm-mono text-[0.5625rem] text-[var(--arm-tenue)]">
                Partida clasificatoria
              </p>
              <p className="text-sm leading-relaxed text-[var(--arm-texto)]">
                La ranked la fija el modo: {etiquetaDeConfig(CONFIG_RANKED)} en{' '}
                {nombreLegible(CONFIG_RANKED.mapa)}. Así todas las partidas son comparables y el
                RR significa lo mismo cada vez. Acá no se cambia nada, ni siquiera se agregan o
                sacan bots durante el juego.
              </p>
              <InstrumentoEquipos config={CONFIG_RANKED} />
            </div>
          ) : (
            <>
              {/* Presets: atajos que rellenan la configuración */}
              <section className="flex flex-col gap-2" aria-label="Atajos de tamaño">
                <p className="arm-mono text-[0.5625rem] text-[var(--arm-apagado)]">
                  Atajos rápidos
                </p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="arm-tab arm-chaflan px-4 py-2"
                      aria-pressed={presetActivo(p.jugadores)}
                      onClick={() => {
                        setModo('tdm')
                        setJugadores(p.jugadores)
                      }}
                    >
                      <span className="arm-mono text-[0.75rem] tracking-[0.14em]">{p.etiqueta}</span>
                    </button>
                  ))}
                  <span className="arm-mono self-center text-[0.5625rem] text-[var(--arm-apagado)]">
                    o arma el tuyo abajo
                  </span>
                </div>
              </section>

              <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
                {/* Mapa, con su tamaño medido */}
                <section className="flex flex-col gap-2" aria-label="Mapa">
                  <p className="arm-mono text-[0.5625rem] text-[var(--arm-apagado)]">Mapa</p>
                  <div className="arm-panel arm-chaflan flex flex-col overflow-hidden">
                    {mapas.map((nombre) => {
                      const medida = medidas.get(nombre)
                      const seleccionado = activa.mapa === nombre
                      return (
                        <button
                          key={nombre}
                          type="button"
                          className="arm-fila w-full"
                          aria-pressed={seleccionado}
                          onClick={() => setMapa(nombre)}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm capitalize">
                              {nombreLegible(nombre)}
                            </span>
                            <span className="arm-mono block text-[0.5625rem] text-[var(--arm-apagado)]">
                              {medida === undefined
                                ? 'midiendo…'
                                : medida === null
                                  ? 'tamaño sin medir'
                                  : `${ETIQUETA_TAMANO[medida.tamano]} · sugerido ${medida.porEquipoSugerido}v${medida.porEquipoSugerido}`}
                            </span>
                          </span>
                          {medida !== undefined && medida !== null && (
                            <span
                              className="setup-tamano"
                              data-tamano={medida.tamano}
                              aria-hidden
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </section>

                {/* Modo + tamaño manual + instrumento de equipos */}
                <section className="flex flex-col gap-3" aria-label="Equipos">
                  <div className="flex flex-col gap-2">
                    <p className="arm-mono text-[0.5625rem] text-[var(--arm-apagado)]">Modo</p>
                    <div className="flex gap-2" role="tablist" aria-label="Modo de juego">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activa.modo === 'tdm'}
                        className="arm-tab arm-chaflan flex-1 py-2"
                        onClick={() => setModo('tdm')}
                      >
                        <span className="arm-mono text-[0.6875rem]">Equipos</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activa.modo === 'ffa'}
                        className="arm-tab arm-chaflan flex-1 py-2"
                        onClick={() => setModo('ffa')}
                      >
                        <span className="arm-mono text-[0.6875rem]">Todos contra todos</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <p className="arm-mono text-[0.5625rem] text-[var(--arm-apagado)]">
                      {activa.modo === 'tdm' ? 'Jugadores por equipo' : 'Jugadores'}
                    </p>
                    <Stepper
                      valor={activa.modo === 'tdm' ? porEq : activa.jugadores}
                      min={activa.modo === 'tdm' ? MIN_BOTS : MIN_BOTS + 1}
                      max={activa.modo === 'tdm' ? MAX_POR_EQUIPO : MAX_POR_EQUIPO * 2}
                      onChange={(v) => (activa.modo === 'tdm' ? setPorEquipo(v) : setJugadores(v))}
                      etiqueta={activa.modo === 'tdm' ? 'jugadores por equipo' : 'jugadores'}
                    />
                  </div>

                  <div className="arm-panel arm-chaflan flex flex-col gap-2 p-3">
                    <p className="arm-mono text-[0.5625rem] text-[var(--arm-tenue)]">
                      {etiquetaDeConfig(activa)} · {activa.jugadores} en cancha
                    </p>
                    <InstrumentoEquipos config={activa} />
                  </div>
                </section>
              </div>
            </>
          )}
        </div>

        {/* Pie: lanzar, o irse a otra pantalla */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--arm-linea-tenue)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/armory" className="arm-enlace arm-mono text-[0.6875rem]">
              Armería
            </Link>
            <Link href="/career" className="arm-enlace arm-mono text-[0.6875rem]">
              Carrera
            </Link>
          </div>
          <Link href={href} className="setup-jugar arm-chaflan" prefetch={false}>
            <span className="arm-mono text-[0.75rem] tracking-[0.2em]">
              {entrada === 'ranked' ? 'Entrar a ranked' : 'Jugar'}
            </span>
          </Link>
        </footer>
      </div>

      {editable && (
        <p className="arm-mono mt-4 max-w-3xl text-center text-[0.5625rem] leading-relaxed text-[var(--arm-apagado)]">
          Dentro de la partida, la tecla + agrega un bot y la tecla - saca al último. La ranked no.
        </p>
      )}
    </main>
  )
}

/** Contador con menos/más. Ocho estados por botón salen de `.arm-tab`; el
 *  tope y el piso deshabilitan el botón que no corresponde en vez de dejarlo
 *  fingir que hace algo. */
function Stepper({
  valor,
  min,
  max,
  onChange,
  etiqueta,
}: {
  valor: number
  min: number
  max: number
  onChange: (v: number) => void
  etiqueta: string
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="setup-paso arm-chaflan"
        onClick={() => onChange(valor - 1)}
        disabled={valor <= min}
        aria-label={`Un ${etiqueta} menos`}
      >
        <span aria-hidden>–</span>
      </button>
      <span
        className="arm-mono min-w-[2ch] text-center text-lg text-[var(--arm-texto)]"
        aria-live="polite"
      >
        {valor}
      </span>
      <button
        type="button"
        className="setup-paso arm-chaflan"
        onClick={() => onChange(valor + 1)}
        disabled={valor >= max}
        aria-label={`Un ${etiqueta} más`}
      >
        <span aria-hidden>+</span>
      </button>
    </div>
  )
}
