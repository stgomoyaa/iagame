'use client'

/**
 * Menú dentro de la partida: cambiar de arma, ajustar la sensibilidad y
 * salir, sin irse a otra página del navegador.
 *
 * Es React y no DOM imperativo, al revés que el HUD (ui/Hud.ts), y la razón
 * es la frecuencia: esto se dibuja cuando el jugador aprieta Escape, o sea
 * un puñado de veces por partida, y mientras está abierto la simulación
 * está CONGELADA (game.setPaused). No compite con el presupuesto de frame
 * porque cuando existe no hay frames que presupuestar. La regla del
 * proyecto es "React nunca corre dentro del frame del motor", y acá se
 * cumple por construcción.
 *
 * El estilo reusa los tokens `--arm-*` de la armería (app/globals.css) a
 * propósito: es la misma decisión (elegir un arma) y tiene que verse como
 * el mismo juego, no como una pantalla distinta. Lo único que cambia es el
 * fondo, translúcido, para que se vea el cuadro congelado abajo.
 *
 * Este archivo NO decide nada del juego. Qué armas hay y qué nivel las
 * desbloquea sale de ui/arsenal.ts (que es progression/unlocks.ts); equipar
 * es `game.equipEnPartida`. Misma división que la armería.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LOADOUT_SLOTS, SLOT_LABEL, type Loadout, type LoadoutSlot } from '@/game/progression/loadout'
import { loadLocalWeapons } from '@/game/weapons/registry'
import { CLASS_LABEL } from '@/game/weapons/stats'
import { SensitivitySettings } from '@/ui/SensitivitySettings'
import { VideoSettings } from '@/ui/VideoSettings'
import { construirArsenal } from '@/ui/arsenal'

export interface PauseMenuProps {
  /** 'inicio' antes del primer click de la partida, 'pausa' después. Cambia
   *  el título y el texto del botón principal, nada más: es el mismo menú. */
  variante: 'inicio' | 'pausa'
  loadout: Loadout
  /** Ranura en mano. Puede ser 'melee' (el cuchillo del slot 3 fijo): ese slot
   *  no se edita acá -- no se elige ni se desbloquea -- así que cuando está en
   *  mano el menú no marca ninguna de las dos ranuras editables como "en mano". */
  slotEquipado: LoadoutSlot | 'melee'
  nivelCuenta: number
  /** ¿Esta partida deja agregar y sacar bots con + y -? Falso en ranked, y
   *  entonces la ayuda de controles no menciona esas teclas: prometer una
   *  tecla que no hace nada es peor que no nombrarla. */
  rosterEditable: boolean
  onReanudar: () => void
  onEquipar: (slot: LoadoutSlot, slug: string) => void
}

export function PauseMenu({
  variante,
  loadout,
  slotEquipado,
  nivelCuenta,
  rosterEditable,
  onReanudar,
  onEquipar,
}: PauseMenuProps) {
  // Qué ranura se está EDITANDO, que no es necesariamente la que está en
  // mano: se puede cambiar la secundaria sin dejar de mirar la primaria.
  // Arranca en la que está equipada porque es lo que el jugador tiene en la
  // cabeza cuando abre el menú.
  // Si lo que está en mano es el cuchillo ('melee', no editable), el menú
  // arranca editando la primaria: sólo primary/secondary se eligen acá.
  const [slotEditando, setSlotEditando] = useState<LoadoutSlot>(
    slotEquipado === 'melee' ? 'primary' : slotEquipado,
  )

  // Mismo cuidado que en la armería: el catálogo NO está completo en el
  // primer render (las armas locales entran cuando resuelve un fetch), así
  // que la lista es estado y se rearma cuando la carga termina. Con un memo
  // de dependencias vacías, este menú mostraría 40 armas mientras la partida
  // juega con 79.
  const [armas, setArmas] = useState(construirArsenal)
  useEffect(() => {
    void loadLocalWeapons().then(() => setArmas(construirArsenal()))
  }, [])

  const slugEditando = loadout[slotEditando].slug
  const disponibles = armas.filter((a) => a.nivel <= nivelCuenta)

  return (
    <div
      className="arm fixed inset-0 z-40 flex items-center justify-center p-4"
      // El fondo se pinta acá y no con la clase `.arm` (que es opaca): el
      // cuadro congelado del juego tiene que verse detrás, o el menú se
      // siente como haber salido del juego en vez de haberlo pausado.
      style={{ background: 'rgba(3, 5, 9, 0.82)' }}
      role="dialog"
      aria-modal="true"
      aria-label={variante === 'inicio' ? 'Entrar a la partida' : 'Menú de pausa'}
    >
      <div className="arm-panel arm-chaflan flex max-h-full w-full max-w-4xl flex-col overflow-hidden">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--arm-linea-tenue)] px-4 py-3">
          <h1 className="arm-mono text-sm tracking-[0.22em] text-[var(--arm-texto)]">
            {variante === 'inicio' ? 'LISTO PARA ENTRAR' : 'PAUSA'}
          </h1>
          <p className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">
            Nivel <span className="text-[var(--arm-texto)]">{nivelCuenta}</span> ·{' '}
            {disponibles.length} de {armas.length} armas
          </p>
        </header>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 md:grid-cols-[1fr_1fr]">
          {/* ---- Loadout ---- */}
          <section className="flex min-h-0 flex-col gap-2" aria-label="Loadout">
            <div className="flex gap-2" role="tablist" aria-label="Ranuras del loadout">
              {LOADOUT_SLOTS.map((s, i) => {
                const slug = loadout[s].slug
                const nombre = armas.find((a) => a.slug === slug)?.nombre ?? 'Vacía'
                return (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={s === slotEditando}
                    className="arm-tab arm-chaflan flex-1"
                    onClick={() => setSlotEditando(s)}
                  >
                    <span className="arm-mono block text-[0.625rem]">
                      {SLOT_LABEL[s]} · tecla {i + 1}
                      {s === slotEquipado ? ' · en mano' : ''}
                    </span>
                    <span className="block truncate text-sm text-[var(--arm-texto)]">{nombre}</span>
                  </button>
                )
              })}
            </div>

            <div className="arm-panel arm-chaflan flex min-h-0 flex-1 flex-col overflow-hidden">
              <h2 className="arm-mono shrink-0 border-b border-[var(--arm-linea-tenue)] px-3 py-2 text-[0.625rem] text-[var(--arm-tenue)]">
                Elegí tu {SLOT_LABEL[slotEditando].toLowerCase()}
              </h2>
              {/* Alto acotado y scroll propio: con 79 armas, una lista sin
                  límite empuja los botones de salir fuera de la pantalla. */}
              <div className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: '46vh' }}>
                {disponibles.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    className="arm-fila w-full"
                    aria-pressed={a.slug === slugEditando}
                    // Equipar cambia el arma Y deja esa ranura en mano: en
                    // un menú de pausa elegir un arma es elegir con qué vas
                    // a salir, no editar una ficha.
                    onClick={() => onEquipar(slotEditando, a.slug)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{a.nombre}</span>
                      <span className="arm-mono block text-[0.5625rem] text-[var(--arm-apagado)]">
                        {CLASS_LABEL[a.archetype.class]}
                      </span>
                    </span>
                    <span className="arm-mono shrink-0 whitespace-nowrap text-[0.5625rem] text-[var(--arm-apagado)]">
                      {a.slug === slugEditando ? 'equipada' : a.archetype.id}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* ---- Ajustes ---- */}
          <section className="flex min-h-0 flex-col gap-2 overflow-y-auto" aria-label="Ajustes">
            <SensitivitySettings />
            <VideoSettings />
            <p className="arm-mono text-[0.5625rem] leading-relaxed text-[var(--arm-apagado)]">
              Los cambios de sensibilidad y de video se aplican al cerrar este menú, en esta misma
              partida.
            </p>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--arm-linea-tenue)] px-4 py-3">
          <p className="arm-mono text-[0.5625rem] text-[var(--arm-apagado)]">
            Esc abre este menú · Tab muestra el marcador · 1 y 2 cambian de arma
            {rosterEditable ? ' · + y - agregan o sacan un bot' : ''}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/armory" className="arm-enlace arm-mono text-[0.6875rem]">
              Armería completa
            </Link>
            <Link href="/" className="arm-enlace arm-mono text-[0.6875rem]">
              Salir del juego
            </Link>
            <button
              type="button"
              className="arm-tab arm-chaflan px-5 py-2"
              onClick={onReanudar}
              autoFocus
            >
              <span className="arm-mono text-[0.6875rem] tracking-[0.18em] text-[var(--arm-texto)]">
                {variante === 'inicio' ? 'ENTRAR' : 'REANUDAR'}
              </span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/**
 * Aviso mínimo mientras se espera que el navegador devuelva el puntero.
 *
 * Existe por el enfriamiento de ~1.25 s que Chrome aplica a
 * `requestPointerLock()` después de que el usuario salió con Escape (ver la
 * cabecera de ui/pausa.ts). Sin esto, el jugador clickearía "Reanudar" y se
 * quedaría mirando una pantalla congelada, sin menú y sin control, sin
 * ninguna pista de qué pasó.
 *
 * `pointer-events-none` es la otra mitad del truco: el click atraviesa este
 * cartel y llega al canvas, que ya tiene su propio listener que pide el
 * pointer lock (engine/input.ts). O sea que la pantalla entera es el botón.
 */
export function AvisoReanudar() {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center">
      <p
        className="rounded px-4 py-2 font-mono text-sm text-[#e6e8ec]"
        style={{ background: 'rgba(3, 5, 9, 0.8)' }}
      >
        Hacé click para volver al juego
      </p>
    </div>
  )
}
