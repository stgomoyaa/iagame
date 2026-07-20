'use client'

/**
 * Desbloqueos por nivel (ruta /unlocks).
 *
 * Dos vistas del MISMO catálogo real, que es lo que pide el diseño:
 *
 * - **Ruta por nivel**: en qué nivel de cuenta se abre cada arma. Sale de
 *   `unlockLevelsSnapshot()` vía `construirArsenal()`, o sea de la regla de
 *   verdad (progression/unlocks.ts), no de una tabla copiada.
 * - **Catálogo por origen**: las mismas armas agrupadas por clase, con la
 *   **etiqueta de juego** (`AK-47 (CS)`). Esa etiqueta es información de
 *   jugabilidad y no adorno: eliges tu estilo eligiendo el origen del arma.
 *   La compone `sourceWeaponDisplayName()` y ya viene dentro del nombre.
 *
 * El catálogo crece cuando resuelve el fetch de armas locales, así que se
 * relee después de `loadLocalWeapons()`: el mismo patrón (y por el mismo
 * bug de la foto vieja) que la armería.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  nivelMaximoDeDesbloqueo,
  XP_POR_NIVEL,
  xpParaNivel,
  levelForXp,
} from '@/game/progression/unlocks'
import {
  createDefaultProgress,
  createProgressStore,
  type ProgressData,
} from '@/game/progression/store'
import { loadLocalWeapons } from '@/game/weapons/registry'
import { SOURCE_WEAPONS_BY_SLUG } from '@/game/weapons/source-catalog'
import { CLASS_LABEL } from '@/game/weapons/stats'
import type { WeaponClass } from '@/game/weapons/archetypes'
import { construirArsenal, type ArmaDeLista } from '@/ui/arsenal'
import { ProgresionShell } from '@/ui/progresion/Shell'
import { AvisoReal } from '@/ui/progresion/Pendiente'

type Vista = 'nivel' | 'origen'

/** Color por clase. Es el único dato de esta pantalla que se decide en la
 *  capa visual: sirve para leer la clase de un vistazo en la lista. */
const COLOR_CLASE: Record<WeaponClass, string> = {
  ar: '#46f08a',
  smg: '#4fe3cf',
  shotgun: '#ff9a3c',
  pistol: '#7bb0ff',
  marksman: '#a06bff',
  sniper: '#ffce4d',
  lmg: '#ff5d6c',
}

/** Orden de presentación de las clases: de lo que usas siempre a lo de nicho. */
const ORDEN_CLASE: readonly WeaponClass[] = [
  'ar',
  'smg',
  'shotgun',
  'pistol',
  'marksman',
  'sniper',
  'lmg',
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

/** Etiqueta de origen: el juego del que viene el modelo, o CC0. */
function EtiquetaOrigen({ slug }: { slug: string }) {
  const source = SOURCE_WEAPONS_BY_SLUG.get(slug)
  const esSource = source !== undefined
  return (
    <span
      className="pg-display flex-none px-1.5 py-0.5 text-[9px] font-bold tracking-[.08em]"
      style={{
        color: esSource ? 'var(--pg-acento)' : 'var(--pg-apagado)',
        border: `1px solid ${esSource ? 'rgba(70,240,138,.33)' : 'var(--pg-linea-marcada)'}`,
      }}
      title={esSource ? `Modelo del pack de ${source.game}` : 'Modelo CC0 del pack base'}
    >
      {esSource ? source.game : 'CC0'}
    </span>
  )
}

export function Desbloqueos() {
  const [store] = useState(() => createProgressStore())
  const [progress, setProgress] = useState<ProgressData>(() => createDefaultProgress())
  const [armas, setArmas] = useState<ArmaDeLista[]>(() => construirArsenal())
  const [vista, setVista] = useState<Vista>('nivel')

  useEffect(() => {
    queueMicrotask(() => setProgress(store.load()))
  }, [store])

  useEffect(() => {
    // Un 404 acá es el caso normal (build publicado sin armas locales) y
    // loadLocalWeapons ya lo trata como "entraron 0".
    void loadLocalWeapons().then(() => setArmas(construirArsenal()))
  }, [])

  const nivel = levelForXp(progress.xp)
  const nivelMax = armas.length > 0 ? nivelMaximoDeDesbloqueo() : 0

  /** Armas agrupadas por nivel de desbloqueo, de menor a mayor. */
  const porNivel = useMemo(() => {
    const mapa = new Map<number, ArmaDeLista[]>()
    for (const a of armas) {
      const lista = mapa.get(a.nivel)
      if (lista) lista.push(a)
      else mapa.set(a.nivel, [a])
    }
    return [...mapa.entries()].sort((a, b) => a[0] - b[0])
  }, [armas])

  /** Armas agrupadas por clase, en el orden de presentación. */
  const porClase = useMemo(() => {
    const mapa = new Map<WeaponClass, ArmaDeLista[]>()
    for (const a of armas) {
      const c = a.archetype.class
      const lista = mapa.get(c)
      if (lista) lista.push(a)
      else mapa.set(c, [a])
    }
    return ORDEN_CLASE.filter((c) => mapa.has(c)).map((c) => ({
      clase: c,
      armas: mapa.get(c) ?? [],
    }))
  }, [armas])

  return (
    <ProgresionShell procedencias={['real']}>
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="flex flex-none flex-wrap items-center justify-between gap-4 px-6 py-4"
          style={{ borderBottom: '1px solid var(--pg-linea)' }}
        >
          <div className="flex items-center gap-4">
            <h1 className="pg-mono text-[11px] tracking-[.2em]" style={{ color: 'var(--pg-tenue)' }}>
              DESBLOQUEOS POR NIVEL
            </h1>
            <div className="flex gap-1.5">
              <Segmento activo={vista === 'nivel'} onClick={() => setVista('nivel')}>
                RUTA POR NIVEL
              </Segmento>
              <Segmento activo={vista === 'origen'} onClick={() => setVista('origen')}>
                CATÁLOGO POR ORIGEN
              </Segmento>
            </div>
          </div>
          <dl
            className="pg-mono flex gap-5 text-[10px] tracking-[.12em]"
            style={{ color: 'var(--pg-acento)' }}
          >
            <div className="flex gap-1.5">
              <dt style={{ color: 'var(--pg-mudo)' }}>ARMAS</dt>
              <dd>{armas.length}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt style={{ color: 'var(--pg-mudo)' }}>NIVEL MÁX</dt>
              <dd>{nivelMax}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt style={{ color: 'var(--pg-mudo)' }}>XP / NIVEL</dt>
              <dd>{XP_POR_NIVEL}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt style={{ color: 'var(--pg-mudo)' }}>TU NIVEL</dt>
              <dd>{nivel}</dd>
            </div>
          </dl>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {vista === 'nivel' ? (
            <>
              <div className="mb-4">
                <AvisoReal>
                  Ruta real del sistema. Cada arma se abre al alcanzar el nivel de cuenta que
                  aparece a la izquierda, y ese nivel lo calcula la regla de desbloqueo a partir de
                  la clase del arma, no una tabla escrita a mano.
                </AvisoReal>
              </div>

              <ol className="relative flex flex-col gap-3.5 pl-5">
                <div
                  className="absolute bottom-1.5 left-[5px] top-1.5 w-0.5"
                  style={{ background: 'linear-gradient(180deg,var(--pg-acento),var(--pg-linea-alta))' }}
                  aria-hidden
                />
                {porNivel.map(([nivelDesbloqueo, lista]) => {
                  const alcanzado = nivel >= nivelDesbloqueo
                  return (
                    <li key={nivelDesbloqueo} className="relative">
                      <span
                        className="absolute -left-5 top-1 h-3 w-3"
                        style={{
                          background: alcanzado ? 'var(--pg-acento)' : 'var(--pg-fondo)',
                          border: `2px solid ${alcanzado ? 'var(--pg-acento)' : 'var(--pg-linea-marcada)'}`,
                          clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
                        }}
                        aria-hidden
                      />
                      <div className="flex items-start gap-4">
                        <div className="w-24 flex-none">
                          <div
                            className="pg-display text-[22px] font-bold leading-none tracking-[.04em]"
                            style={{
                              color: alcanzado ? 'var(--pg-texto-alto)' : 'var(--pg-mudo-alto)',
                            }}
                          >
                            NIVEL {nivelDesbloqueo}
                          </div>
                          <div
                            className="pg-mono mt-0.5 text-[9px] tracking-[.1em]"
                            style={{ color: 'var(--pg-mudo)' }}
                          >
                            {xpParaNivel(nivelDesbloqueo).toLocaleString('es-CL')} XP AC.
                          </div>
                        </div>
                        <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                          {lista.map((a) => (
                            <li
                              key={a.slug}
                              className="flex items-center gap-2.5 px-3 py-2"
                              style={{
                                background: 'var(--pg-panel)',
                                border: '1px solid var(--pg-linea)',
                                borderLeft: `3px solid ${COLOR_CLASE[a.archetype.class]}`,
                                opacity: alcanzado ? 1 : 0.55,
                              }}
                            >
                              <div className="min-w-0">
                                <div
                                  className="pg-display text-[13px] font-semibold tracking-[.03em]"
                                  style={{ color: 'var(--pg-texto-medio)' }}
                                >
                                  {a.nombre}
                                </div>
                                <div className="mt-0.5 flex items-center gap-2">
                                  <span
                                    className="pg-mono text-[8px] tracking-[.12em]"
                                    style={{ color: COLOR_CLASE[a.archetype.class] }}
                                  >
                                    {CLASS_LABEL[a.archetype.class].toUpperCase()}
                                  </span>
                                  <EtiquetaOrigen slug={a.slug} />
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </>
          ) : (
            <>
              <div className="mb-4">
                <AvisoReal>
                  Catálogo real con etiqueta de juego de origen. La etiqueta es información de
                  jugabilidad: eliges tu estilo eligiendo el origen del arma. CC0 marca los modelos
                  del pack base.
                </AvisoReal>
              </div>

              <div className="flex flex-col gap-4">
                {porClase.map(({ clase, armas: lista }) => (
                  <section key={clase}>
                    <div className="mb-2 flex items-baseline gap-2.5">
                      <span
                        className="h-2 w-2"
                        style={{
                          background: COLOR_CLASE[clase],
                          clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
                        }}
                        aria-hidden
                      />
                      <h2
                        className="pg-display text-sm font-bold tracking-[.08em]"
                        style={{ color: COLOR_CLASE[clase] }}
                      >
                        {CLASS_LABEL[clase].toUpperCase()}
                      </h2>
                      <span
                        className="pg-mono text-[9px] tracking-[.12em]"
                        style={{ color: 'var(--pg-mudo)' }}
                      >
                        {lista.length} ARMAS
                      </span>
                    </div>
                    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                      {lista.map((a) => (
                        <li
                          key={a.slug}
                          className="flex items-center justify-between gap-2 px-3 py-2"
                          style={{
                            background: 'var(--pg-panel)',
                            border: '1px solid var(--pg-linea)',
                            borderLeft: `2px solid ${COLOR_CLASE[clase]}`,
                          }}
                        >
                          <div className="min-w-0">
                            <div
                              className="pg-display truncate text-xs font-semibold"
                              style={{ color: 'var(--pg-texto-medio)' }}
                            >
                              {a.nombre}
                            </div>
                            <div
                              className="pg-mono text-[8px] tracking-[.08em]"
                              style={{ color: 'var(--pg-apagado)' }}
                            >
                              NIVEL {a.nivel}
                            </div>
                          </div>
                          <EtiquetaOrigen slug={a.slug} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </ProgresionShell>
  )
}
