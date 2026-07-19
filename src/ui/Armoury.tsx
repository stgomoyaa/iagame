'use client'

/**
 * Armería (fase 3, secciones 6 y 7 del spec): las 40 armas con sus
 * estadísticas de arquetipo, elección de primaria y secundaria, y las skins
 * del inventario aplicadas sobre una vitrina 3D en vivo.
 *
 * Todo lo que decide algo vive en `src/game/`: qué arma está desbloqueada
 * (progression/unlocks.ts), qué loadout es válido (progression/loadout.ts),
 * cómo se ve una seed (skins/generator.ts) y cómo se normalizan las
 * estadísticas (weapons/stats.ts). Este archivo dibuja y guarda; no calcula
 * nada del juego.
 *
 * La persistencia es inmediata: cada click escribe en el `ProgressStore`. No
 * hay botón de guardar porque no hay estado intermedio que confirmar, y
 * porque entrar a la partida desde otra pestaña tiene que encontrar lo
 * último que el jugador eligió.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  equipSkin,
  equipWeapon,
  LOADOUT_SLOTS,
  SLOT_LABEL,
  skinForSlot,
  type Loadout,
  type LoadoutSlot,
} from '@/game/progression/loadout'
import {
  accountLevel,
  createDefaultProgress,
  createProgressStore,
  type ProgressData,
} from '@/game/progression/store'
import { unlockLevelFor } from '@/game/progression/unlocks'
import { generateSkin, type Skin } from '@/game/skins/generator'
import { RARITY_BY_ID, rarityRank } from '@/game/skins/rarity'
import type { PreviewItem } from '@/game/skins/preview'
import { resolveArchetype, weaponIndex } from '@/game/weapons/registry'
import { CLASS_LABEL, statBars } from '@/game/weapons/stats'
import { WeaponPreview } from '@/ui/WeaponPreview'

const MUESCAS = 12

function Barra({ value }: { value: number }) {
  const llenas = Math.max(1, Math.round(value * MUESCAS))
  return (
    <div className="arm-barra" aria-hidden>
      {Array.from({ length: MUESCAS }, (_, i) => (
        <span key={i} className="arm-muesca" data-on={i < llenas ? '1' : '0'} />
      ))}
    </div>
  )
}

function Swatch({ skin }: { skin: Skin }) {
  const hex = (c: Skin['colorBase']): string =>
    `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`
  return (
    <span className="flex shrink-0 gap-px" aria-hidden>
      <span className="block h-3 w-3" style={{ background: hex(skin.colorBase) }} />
      <span className="block h-3 w-3" style={{ background: hex(skin.colorAccent) }} />
    </span>
  )
}

export function Armoury() {
  // El store se lee en un efecto y no en el render inicial: localStorage no
  // existe en el servidor, y arrancar los dos lados con el mismo default
  // evita un desajuste de hidratación.
  const [store] = useState(() => createProgressStore())
  const [progress, setProgress] = useState<ProgressData>(() => createDefaultProgress())
  const [slot, setSlot] = useState<LoadoutSlot>('primary')
  const [debug, setDebug] = useState(false)

  useEffect(() => {
    // queueMicrotask: setState sincrónico en el cuerpo del efecto dispara
    // cascading renders (regla react-hooks/set-state-in-effect). Acá no
    // importa un microtask de rezago: es la carga inicial de una pantalla de
    // menú. Mismo patrón que ui/GameCanvas.tsx.
    queueMicrotask(() => {
      setProgress(store.load())
      setDebug(new URLSearchParams(window.location.search).get('debug') === '1')
    })
  }, [store])

  const guardar = useCallback(
    (loadout: Loadout) => {
      setProgress((prev) => {
        const next = { ...prev, loadout }
        store.save(next)
        return next
      })
    },
    [store],
  )

  const nivel = accountLevel(progress)
  const loadout = progress.loadout
  const slugActual = loadout[slot].slug

  const armas = useMemo(
    () =>
      weaponIndex().map((entry) => ({
        slug: entry.slug,
        nombre: entry.name,
        archetype: resolveArchetype(entry.slug),
        nivel: unlockLevelFor(entry.slug),
      })),
    [],
  )

  const inventario = useMemo(
    () =>
      progress.skins
        .map(generateSkin)
        .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)),
    [progress.skins],
  )

  const items: PreviewItem[] = LOADOUT_SLOTS.flatMap((s) => {
    const slug = loadout[s].slug
    return slug === null ? [] : [{ slug, skin: skinForSlot(loadout, s) }]
  })

  const arma = armas.find((a) => a.slug === slugActual) ?? null
  const skinActual = skinForSlot(loadout, slot)

  return (
    <main className="arm px-4 py-6 sm:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Armería</h1>
          <p className="mt-1 max-w-md text-sm text-[var(--arm-tenue)]">
            Arma tu equipo antes de entrar. Las armas se desbloquean subiendo de nivel de cuenta.
          </p>
        </div>
        <div className="flex items-center gap-5">
          <p className="arm-mono text-[0.6875rem] text-[var(--arm-tenue)]">
            Nivel <span className="text-[var(--arm-texto)]">{nivel}</span>
          </p>
          <Link href="/play" className="arm-enlace arm-mono text-[0.6875rem]">
            Entrar a jugar
          </Link>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Ranuras del loadout">
        {LOADOUT_SLOTS.map((s, i) => {
          const slug = loadout[s].slug
          const nombre = armas.find((a) => a.slug === slug)?.nombre ?? 'Vacía'
          return (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === slot}
              className="arm-tab arm-chaflan"
              onClick={() => setSlot(s)}
            >
              <span className="arm-mono block text-[0.625rem]">
                {SLOT_LABEL[s]} · tecla {i + 1}
              </span>
              <span className="block text-sm text-[var(--arm-texto)]">{nombre}</span>
            </button>
          )
        })}
      </div>

      <div className="arm-grid">
        <section className="arm-panel arm-chaflan" aria-label="Arsenal">
          <h2 className="arm-mono border-b border-[var(--arm-linea-tenue)] px-3 py-2 text-[0.625rem] text-[var(--arm-tenue)]">
            Arsenal · {armas.filter((a) => a.nivel <= nivel).length} de {armas.length}
          </h2>
          <div className="arm-lista">
            {armas.map((a) => {
              const bloqueada = a.nivel > nivel
              return (
                <button
                  key={a.slug}
                  type="button"
                  className="arm-fila"
                  aria-pressed={a.slug === slugActual}
                  disabled={bloqueada}
                  onClick={() => guardar(equipWeapon(loadout, slot, a.slug))}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{a.nombre}</span>
                    <span className="arm-mono block text-[0.5625rem] text-[var(--arm-apagado)]">
                      {CLASS_LABEL[a.archetype.class]}
                    </span>
                  </span>
                  <span className="arm-mono shrink-0 whitespace-nowrap text-[0.5625rem] text-[var(--arm-apagado)]">
                    {bloqueada ? `Nivel ${a.nivel}` : a.archetype.id}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="arm-panel arm-chaflan" aria-label="Vitrina">
          <WeaponPreview items={items} debug={debug} />
          {arma && (
            <div className="border-t border-[var(--arm-linea-tenue)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-bold">{arma.nombre}</h2>
                <p className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">
                  {CLASS_LABEL[arma.archetype.class]} · {arma.archetype.fireMode === 'auto'
                    ? 'automática'
                    : arma.archetype.fireMode === 'semi'
                      ? 'semiautomática'
                      : 'ráfaga'}
                </p>
              </div>
              <p className="mt-1 text-sm text-[var(--arm-tenue)]">
                {skinActual
                  ? `${skinActual.name} · ${RARITY_BY_ID[skinActual.rarity].label}`
                  : 'Sin skin, aspecto de fábrica'}
              </p>

              <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {statBars(arma.archetype).map((bar) => (
                  <div key={bar.id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">
                        {bar.label}
                      </dt>
                      <dd className="text-[0.6875rem] text-[var(--arm-apagado)]">{bar.detail}</dd>
                    </div>
                    <div className="mt-1">
                      <Barra value={bar.value} />
                    </div>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>

        <section className="arm-panel arm-chaflan" aria-label="Skins">
          <h2 className="arm-mono border-b border-[var(--arm-linea-tenue)] px-3 py-2 text-[0.625rem] text-[var(--arm-tenue)]">
            Skins · {SLOT_LABEL[slot].toLowerCase()}
          </h2>
          <div className="arm-lista flex flex-col gap-1 p-2">
            <button
              type="button"
              className="arm-chip"
              aria-pressed={skinActual === null}
              onClick={() => guardar(equipSkin(loadout, slot, null))}
            >
              <span className="py-1 text-sm whitespace-nowrap">Sin skin</span>
            </button>
            {inventario.map((skin) => {
              const tier = RARITY_BY_ID[skin.rarity]
              return (
                <button
                  key={skin.seed}
                  type="button"
                  className="arm-chip"
                  style={{ ['--arm-rareza' as string]: tier.color }}
                  aria-pressed={skinActual?.seed === skin.seed}
                  onClick={() => guardar(equipSkin(loadout, slot, skin.seed))}
                >
                  <span className="flex min-w-0 items-center gap-2 py-1">
                    <Swatch skin={skin} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{skin.name}</span>
                      <span
                        className="arm-mono block text-[0.5625rem]"
                        style={{ color: tier.color }}
                      >
                        {tier.label}
                      </span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}
