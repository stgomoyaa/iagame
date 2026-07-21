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
  camoForSlot,
  equipCamo,
  equipOptic,
  equipSkin,
  equipWeapon,
  LOADOUT_SLOTS,
  opticForSlot,
  SLOT_LABEL,
  skinForSlot,
  type Loadout,
  type LoadoutSlot,
} from '@/game/progression/loadout'
import {
  armaPuedeMontarOptica,
  type CategoriaOptica,
  OPTICAS,
  OPTICAS_ORDEN,
} from '@/game/weapons/attachments/optics-catalog'
import { nivelDeArma } from '@/game/progression/weapon-xp'
import {
  accountLevel,
  createDefaultProgress,
  createProgressStore,
  type ProgressData,
} from '@/game/progression/store'
import { generateSkin, type Skin } from '@/game/skins/generator'
import { RARITY_BY_ID, rarityRank } from '@/game/skins/rarity'
import { CATALOGO_CAMOS, type CamoTextura } from '@/game/skins/texturas'
import type { PreviewItem } from '@/game/skins/preview'
import { loadLocalWeapons } from '@/game/weapons/registry'
import { CLASS_LABEL, statBars } from '@/game/weapons/stats'
import { WeaponPreview } from '@/ui/WeaponPreview'
import { SensitivitySettings } from '@/ui/SensitivitySettings'
// El arsenal se arma en ui/arsenal.ts porque el menú de pausa
// (ui/PauseMenu.tsx) muestra la misma lista con los mismos desbloqueos.
import { construirArsenal } from '@/ui/arsenal'

const MUESCAS = 12

// Etiqueta legible de cada familia de óptica. Ocupa el lugar de la rareza que
// muestran las skins/camos: una mira no tiene rareza, se distingue por su tipo.
const CATEGORIA_OPTICA_LABEL: Record<CategoriaOptica, string> = {
  red_dot: 'Red dot',
  holografica: 'Holográfica',
  magnificada: 'Magnificada',
}

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

// El camo ya trae sus colores en hex sRGB (base/accent/glow), así que el swatch
// los usa directo: el acento (la cresta del patrón) al lado del glow (lo que
// emite), que es el par que distingue un camo de otro del mismo patrón.
function CamoSwatch({ camo }: { camo: CamoTextura }) {
  return (
    <span className="flex shrink-0 gap-px" aria-hidden>
      <span className="block h-3 w-3" style={{ background: camo.accent }} />
      <span className="block h-3 w-3" style={{ background: camo.glow }} />
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
  // El arsenal es ESTADO, no un useMemo con dependencias vacías, y la
  // diferencia importa: el catálogo de armas no está completo cuando este
  // componente se monta. Las armas locales (registry.ts) entran cuando
  // resuelve un fetch, después del primer render. Con un memo de
  // dependencias vacías la lista se queda con la foto de las 40 CC0 para
  // siempre -- el registry SÍ tiene las otras 39 y la partida SÍ las usa,
  // pero la armería no las muestra nunca. Es la misma forma del bug que ya
  // pasó con el panel de tuning, que fotografiaba WEAPON_REGISTRY en el
  // mount, antes de que resolviera weapons_tuning.json.
  const [armas, setArmas] = useState(construirArsenal)

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

  useEffect(() => {
    // Un 404 acá es el caso normal (build publicado sin armas locales) y
    // loadLocalWeapons ya lo trata como "entraron 0": no hay rama de error
    // que manejar, sólo hay que releer el catálogo cuando termine.
    void loadLocalWeapons().then((añadidas) => {
      setArmas(construirArsenal())
      // Releer el store SÓLO si entraron armas locales, y por una razón
      // concreta: `store.load()` corrió en el efecto de arriba ANTES de que
      // loadLocalWeapons registrara las armas de COD. Un loadout guardado con
      // una de esas armas (y su MIRA, que sólo montan las 5 de COD) se
      // normaliza distinto según el registry disponible: sin ellas,
      // `normalizeLoadout` reemplaza el arma por su fallback CC0 y —como ese
      // fallback no soporta ópticas— tira la mira. El dato en localStorage
      // sigue intacto; lo que se perdía era la VISTA al recargar la armería.
      // Releyendo el store una vez que el registry ya tiene las locales, el
      // arma y su mira sobreviven la recarga. En un build publicado (añadidas
      // === 0) no se relee: cero cambios de comportamiento.
      if (añadidas > 0) setProgress(store.load())
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

  const inventario = useMemo(
    () =>
      progress.skins
        .map(generateSkin)
        .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name)),
    [progress.skins],
  )

  // Los 17 camos por textura del catálogo, ordenados por rareza como los
  // procedurales. El catálogo es constante (no depende de progreso), así que el
  // memo va con dependencias vacías. Por ahora se muestran todos disponibles:
  // gatearlos por maestría de arma es un refinamiento futuro.
  const camos = useMemo(
    () =>
      [...CATALOGO_CAMOS].sort(
        (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || a.nombre.localeCompare(b.nombre),
      ),
    [],
  )

  const items: PreviewItem[] = LOADOUT_SLOTS.flatMap((s) => {
    const slug = loadout[s].slug
    if (slug === null) return []
    // El camo gana sobre la skin, igual que en el PreviewItem: si la ranura
    // tiene un camo equipado se pasa como `camo` (la vitrina baja el patrón y
    // lo pinta con su neón); si no, va la skin procedural como hasta ahora.
    const camo = camoForSlot(loadout, s)
    // La óptica es INDEPENDIENTE del aspecto: va en el item tenga o no camo/skin,
    // porque un arma puede llevar los dos a la vez. La vitrina la monta sobre el
    // arma si el arma la soporta (tiene ancla); si no, la ignora sin romper.
    const optic = opticForSlot(loadout, s)
    const base = camo ? { slug, skin: null, camo } : { slug, skin: skinForSlot(loadout, s) }
    return [{ ...base, optic }]
  })

  const arma = armas.find((a) => a.slug === slugActual) ?? null
  const skinActual = skinForSlot(loadout, slot)
  const camoActual = camoForSlot(loadout, slot)
  const opticaActual = opticForSlot(loadout, slot)
  // Desbloqueo de miras por NIVEL DE ARMA (no de cuenta): sale de la XP por arma
  // guardada del arma seleccionada. Una mira está disponible si su nivel de
  // desbloqueo (2..5) es <= el nivel actual del arma. Un arma sin usar (XP 0) va
  // en nivel 1, así que todas sus miras salen bloqueadas.
  const xpDeArma = slugActual !== null ? progress.armas[slugActual] ?? 0 : 0
  const nivelArma = nivelDeArma(xpDeArma)
  // Si el arma no tiene ancla (no es una de las que se anclaron), no monta
  // ópticas todavía. Se dice explícito en el panel en vez de esconderlo.
  const soportaOptica = slugActual !== null && armaPuedeMontarOptica(slugActual)
  const opticasDesbloqueadasCount = OPTICAS_ORDEN.filter(
    (id) => OPTICAS[id].nivelDesbloqueo <= nivelArma,
  ).length

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
                  // El slug queda en el DOM porque dos armas distintas pueden
                  // compartir nombre (la AK-47 CC0 y la cod4_ak47 de COD): sin
                  // esto no hay forma estable de distinguirlas desde afuera.
                  data-slug={a.slug}
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
                {camoActual
                  ? `${camoActual.nombre} · ${RARITY_BY_ID[camoActual.rarity].label}`
                  : skinActual
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

        {/* Columna lateral: el aspecto (skins + camos) y las miras se apilan en
            la MISMA celda de la grilla de tres columnas. Van juntas en un
            wrapper en vez de como cuarta columna para no reescribir la grilla
            (que colapsa a una sola columna en pantallas angostas) ni encoger la
            vitrina del medio. Aspecto y mira son sistemas independientes: el
            aspecto es excluyente (skin XOR camo), la mira se lleva aparte. */}
        <div className="flex flex-col" style={{ gap: 'var(--arm-space-md)' }}>
        <section className="arm-panel arm-chaflan" aria-label="Skins">
          <h2 className="arm-mono border-b border-[var(--arm-linea-tenue)] px-3 py-2 text-[0.625rem] text-[var(--arm-tenue)]">
            Skins · {SLOT_LABEL[slot].toLowerCase()}
          </h2>
          <div className="arm-lista flex flex-col gap-1 p-2">
            <button
              type="button"
              className="arm-chip"
              // "Sin skin" = aspecto de fábrica: sólo está activo cuando la
              // ranura no tiene NI skin NI camo. `equipSkin(..., null)` limpia
              // los dos campos (ver loadout.ts), que es justo lo que se quiere.
              aria-pressed={skinActual === null && camoActual === null}
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

            {/* Camuflajes por textura (skins/texturas.ts): la otra vía de
                aspecto. Van bajo su propio rótulo para que se lea que son un
                sistema aparte de las skins procedurales de arriba, no más
                seeds del inventario. */}
            <p className="arm-mono mt-2 px-1 pt-2 text-[0.5625rem] text-[var(--arm-apagado)]">
              Camuflajes por textura
            </p>
            {camos.map((camo) => {
              const tier = RARITY_BY_ID[camo.rarity]
              return (
                <button
                  key={camo.id}
                  type="button"
                  className="arm-chip"
                  style={{ ['--arm-rareza' as string]: tier.color }}
                  aria-pressed={camoActual?.id === camo.id}
                  onClick={() => guardar(equipCamo(loadout, slot, camo.id))}
                >
                  <span className="flex min-w-0 items-center gap-2 py-1">
                    <CamoSwatch camo={camo} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{camo.nombre}</span>
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

        {/* Miras (ópticas): un accesorio, no un aspecto, así que va en su propio
            panel y es INDEPENDIENTE del camo/skin de arriba. Lista las 6 del
            catálogo para el arma seleccionada; las que el nivel del arma todavía
            no habilita salen atenuadas con el nivel que piden. El desbloqueo es
            por NIVEL DE ARMA (XP por arma), no por nivel de cuenta. */}
        <section className="arm-panel arm-chaflan" aria-label="Miras">
          <h2 className="arm-mono border-b border-[var(--arm-linea-tenue)] px-3 py-2 text-[0.625rem] text-[var(--arm-tenue)]">
            Miras{soportaOptica ? ` · ${opticasDesbloqueadasCount} de ${OPTICAS_ORDEN.length}` : ''}
          </h2>
          <div className="arm-lista flex flex-col gap-1 p-2">
            {!soportaOptica ? (
              // Honesto, no escondido: sólo 5 armas de COD tienen ancla en esta
              // fase (docs/OPTICAS.md), el resto es llenado incremental.
              <p className="px-1 py-2 text-xs text-[var(--arm-tenue)]">
                Esta arma todavía no soporta miras.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="arm-chip"
                  // "Sin mira" = hierros. Sólo saca la óptica; no toca el camo ni
                  // la skin, que son independientes de la mira.
                  aria-pressed={opticaActual === null}
                  onClick={() => guardar(equipOptic(loadout, slot, null))}
                >
                  <span className="py-1 text-sm whitespace-nowrap">Sin mira</span>
                </button>
                {OPTICAS_ORDEN.map((id) => {
                  const def = OPTICAS[id]
                  const desbloqueada = def.nivelDesbloqueo <= nivelArma
                  return (
                    <button
                      key={id}
                      type="button"
                      className="arm-chip"
                      // Bloqueada = deshabilitada y atenuada: se ve que existe y a
                      // qué nivel llega, pero no se puede equipar todavía. Mismo
                      // patrón que las armas bloqueadas del arsenal.
                      disabled={!desbloqueada}
                      aria-pressed={opticaActual?.id === id}
                      onClick={() => guardar(equipOptic(loadout, slot, id))}
                    >
                      <span className="flex min-w-0 items-center justify-between gap-2 py-1">
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{def.nombre}</span>
                          <span className="arm-mono block text-[0.5625rem] text-[var(--arm-apagado)]">
                            {CATEGORIA_OPTICA_LABEL[def.categoria]}
                          </span>
                        </span>
                        {!desbloqueada && (
                          <span className="arm-mono shrink-0 whitespace-nowrap text-[0.5625rem] text-[var(--arm-apagado)]">
                            Nivel {def.nivelDesbloqueo}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </section>
        </div>
      </div>

      {/* Sensibilidad: fuera de la grilla de tres columnas porque no es una
          elección de loadout, es un ajuste de control. Vive igual en la
          armería y no en /play porque es donde el jugador prepara la
          partida antes de entrar, y porque cambiarla necesita un teclado
          libre -- dentro del juego el pointer lock se lo come. */}
      <div className="mt-4">
        <SensitivitySettings />
      </div>
    </main>
  )
}
