'use client'

/**
 * Conversor de sensibilidad, la interfaz del jugador sobre
 * `settings/sensitivity.ts`.
 *
 * El jugador escribe la sensibilidad que ya usa en el juego del que viene
 * (CS, Valorant, Apex...) y su DPI; esto la traduce a la escala de Strike
 * Protocol manteniendo los cm/360, la guarda, y la próxima partida arranca
 * con ella. Sin este archivo el conversor era matemática correcta que nadie
 * llamaba.
 *
 * Igual que la armería: acá no se calcula NADA del juego. La conversión es
 * `convert()`, el redondeo es `formatForGame()`, los perfiles son
 * `SELECTABLE_PROFILES` y la persistencia es `SensitivityStore`. Este
 * archivo dibuja y guarda.
 *
 * La persistencia es inmediata, sin botón de guardar, por el mismo motivo
 * que la armería: entrar a la partida desde otra pestaña tiene que
 * encontrar lo último que el jugador eligió.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { SELECTABLE_PROFILES, findProfile } from '@/game/settings/games'
import { cmPer360, convert, edpi, formatForGame } from '@/game/settings/sensitivity'
import {
  createDefaultSensitivity,
  createSensitivityStore,
  PERFIL_PROPIO,
  type SensitivitySettings,
} from '@/game/settings/store'

/** Sensibilidad tipeada en el juego de origen. Es texto, no número, porque
 *  un input controlado que fuerza `Number()` en cada tecla no deja escribir
 *  "0." ni borrar el campo. Se parsea al usarlo. */
const SENS_ORIGEN_INICIAL = '1'

function esNumeroUsable(texto: string): boolean {
  const n = Number.parseFloat(texto)
  return Number.isFinite(n) && n > 0
}

export function SensitivitySettings() {
  // `null` = todavía no se leyó localStorage. El store sólo existe en el
  // navegador, así que la lectura va en un efecto y no en el primer render:
  // esta página se prerenderiza en el servidor, donde `window` no existe.
  const [settings, setSettings] = useState<SensitivitySettings | null>(null)
  const [sensOrigen, setSensOrigen] = useState(SENS_ORIGEN_INICIAL)

  const store = useMemo(() => createSensitivityStore(), [])

  useEffect(() => {
    // queueMicrotask: setState sincrónico en el cuerpo del efecto dispara
    // cascading renders (regla react-hooks/set-state-in-effect). Mismo
    // patrón que ui/Armoury.tsx y ui/GameCanvas.tsx -- un microtask de
    // rezago no se nota en la carga inicial de una pantalla de menú.
    queueMicrotask(() => setSettings(store.load()))
  }, [store])

  const guardar = useCallback(
    (siguiente: SensitivitySettings) => {
      setSettings(siguiente)
      store.save(siguiente)
    },
    [store],
  )

  // Hasta que el efecto lea el guardado se muestran los defaults en vez de
  // un hueco: son los mismos valores con los que el motor arrancaría si no
  // hubiera nada guardado, así que no hay un instante en que la pantalla
  // diga algo que el juego no haría.
  const actual = settings ?? createDefaultSensitivity()
  const origen = findProfile(actual.origenId) ?? SELECTABLE_PROFILES[0]

  const sensOrigenNum = Number.parseFloat(sensOrigen)
  const entradaValida = esNumeroUsable(sensOrigen)

  const resultado = useMemo(() => {
    if (!entradaValida) return null
    return convert({ from: origen, to: PERFIL_PROPIO, sens: sensOrigenNum, dpi: actual.dpi })
  }, [entradaValida, origen, sensOrigenNum, actual.dpi])

  const cmActual = cmPer360(actual.sens, actual.dpi, PERFIL_PROPIO.yaw)

  return (
    <section className="arm-panel arm-chaflan" aria-label="Sensibilidad">
      <h2 className="arm-mono border-b border-[var(--arm-linea-tenue)] px-3 py-2 text-[0.625rem] text-[var(--arm-tenue)]">
        Sensibilidad
      </h2>

      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-[var(--arm-tenue)]">
          Poné la sensibilidad del juego del que venís y tu DPI. La traducción mantiene los
          centímetros que tu mouse recorre para dar una vuelta completa, así que la puntería se
          transfiere tal cual.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">Juego de origen</span>
            <select
              className="rounded border border-[var(--arm-linea-tenue)] bg-transparent px-2 py-1 text-sm"
              value={origen.id}
              onChange={(e) => guardar({ ...actual, origenId: e.target.value })}
            >
              {SELECTABLE_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">
              DPI de tu mouse
            </span>
            <input
              type="number"
              min={50}
              max={32000}
              step={50}
              className="rounded border border-[var(--arm-linea-tenue)] bg-transparent px-2 py-1 text-sm"
              value={actual.dpi}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10)
                if (Number.isFinite(n) && n > 0) guardar({ ...actual, dpi: n })
              }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">
              Tu sensibilidad en {origen.name}
            </span>
            <input
              type="text"
              inputMode="decimal"
              data-testid="sens-origen"
              className="rounded border border-[var(--arm-linea-tenue)] bg-transparent px-2 py-1 text-sm"
              value={sensOrigen}
              onChange={(e) => setSensOrigen(e.target.value)}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">
              Equivalente acá
            </span>
            <output
              data-testid="sens-convertida"
              className="arm-mono px-2 py-1 text-sm text-[var(--arm-apagado)]"
            >
              {resultado === null ? '—' : formatForGame(resultado.clamped, PERFIL_PROPIO)}
            </output>
          </div>
        </div>

        {resultado !== null && resultado.outOfRange && (
          <p className="text-[0.6875rem] text-[var(--arm-apagado)]">
            Ese valor cae fuera de lo que este juego acepta ({PERFIL_PROPIO.range.min} a{' '}
            {PERFIL_PROPIO.range.max}). Se aplica el más cercano posible, así que los cm/360 no van
            a coincidir exactamente.
          </p>
        )}

        <button
          type="button"
          className="arm-chip"
          disabled={resultado === null}
          onClick={() => {
            if (resultado !== null) guardar({ ...actual, sens: resultado.clamped })
          }}
        >
          <span className="py-1 text-sm whitespace-nowrap">Aplicar al juego</span>
        </button>

        <dl
          className="grid gap-x-6 gap-y-2 border-t border-[var(--arm-linea-tenue)] pt-3 sm:grid-cols-3"
          data-testid="sens-activa"
        >
          <div>
            <dt className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">Sensibilidad activa</dt>
            <dd className="text-sm" data-testid="sens-activa-valor">
              {formatForGame(actual.sens, PERFIL_PROPIO)}
            </dd>
          </div>
          <div>
            <dt className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">cm/360</dt>
            <dd className="text-sm">{cmActual.toFixed(2)}</dd>
          </div>
          <div>
            {/* El eDPI va SIEMPRE junto al nombre del juego: comparar el de
                Valorant con el de CS no significa nada (ver el comentario de
                edpi() en sensitivity.ts). */}
            <dt className="arm-mono text-[0.625rem] text-[var(--arm-tenue)]">
              eDPI ({PERFIL_PROPIO.name})
            </dt>
            <dd className="text-sm">{Math.round(edpi(actual.sens, actual.dpi))}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
