import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWeaponTuningPanel,
  loadWeaponTuningOverrides,
  weaponOptionLabel,
} from '@/game/weapons/viewmodel/tuning-panel'
import { getWeaponVisual, weaponIndex, WEAPON_REGISTRY } from '@/game/weapons/registry'
import { createRigWeapon, syncRigWeapon } from '@/game/weapons/viewmodel/adapt'

/**
 * Defecto 5: loadWeaponTuningOverrides valida sólo Number.isFinite, sin
 * rango, y no tenía ni un test. weapons_tuning.json es editable a mano (y lo
 * escribe el panel de tuning), así que un valor corrupto o absurdo tiene que
 * rechazarse en vez de colarse silenciosamente al registro que game.ts lee
 * cada frame.
 *
 * `pistol-1` es un slug real de index.json (ver registry.test.ts).
 * WEAPON_REGISTRY es un singleton de módulo: cada test snapshotea el arma
 * antes de mutarla y la restaura después, para no contaminar otros tests de
 * este archivo.
 */
const SLUG = 'pistol-1'

interface Snapshot {
  hipOffset: { x: number; y: number; z: number; rx: number; ry: number; rz: number }
  adsOffset: { x: number; y: number; z: number; rx: number; ry: number; rz: number }
  rotationOffset: { rx: number; ry: number; rz: number }
  scaleAdjust: number
  adsTime: number
  kickMagnitude: number
}

function snapshot(): Snapshot {
  const v = WEAPON_REGISTRY[SLUG]
  return {
    hipOffset: { ...v.hipOffset },
    adsOffset: { ...v.adsOffset },
    rotationOffset: { ...v.rotationOffset },
    scaleAdjust: v.scaleAdjust,
    adsTime: v.adsTime,
    kickMagnitude: v.kickMagnitude,
  }
}

function restore(snap: Snapshot): void {
  const v = WEAPON_REGISTRY[SLUG]
  Object.assign(v.hipOffset, snap.hipOffset)
  Object.assign(v.adsOffset, snap.adsOffset)
  Object.assign(v.rotationOffset, snap.rotationOffset)
  v.scaleAdjust = snap.scaleAdjust
  v.adsTime = snap.adsTime
  v.kickMagnitude = snap.kickMagnitude
}

/** fetch falso que resuelve con la respuesta dada, sin pegarle a la red. */
function fakeFetch(ok: boolean, body: unknown): typeof fetch {
  return (async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch
}

/** fetch falso cuyo .json() rechaza, como un archivo presente pero con JSON roto. */
function fakeFetchInvalidJson(): typeof fetch {
  return (async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
  })) as unknown as typeof fetch
}

/** fetch falso que rechaza directamente, como una red caída o el server abajo. */
function fakeFetchNetworkError(): typeof fetch {
  return (async () => {
    throw new TypeError('failed to fetch')
  }) as unknown as typeof fetch
}

describe('loadWeaponTuningOverrides', () => {
  let snap: Snapshot
  let originalFetch: typeof fetch
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    snap = snapshot()
    originalFetch = globalThis.fetch
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    restore(snap)
    globalThis.fetch = originalFetch
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('archivo válido pisa los valores del registry', async () => {
    globalThis.fetch = fakeFetch(true, {
      [SLUG]: {
        hipOffset: { x: 0.12 },
        adsOffset: { z: 0.2 },
        rotationOffset: { ry: 0.5 },
        scaleAdjust: 1.4,
        adsTime: 0.3,
        kickMagnitude: 2.1,
      },
    })

    await loadWeaponTuningOverrides()

    const v = WEAPON_REGISTRY[SLUG]
    expect(v.hipOffset.x).toBe(0.12)
    expect(v.adsOffset.z).toBe(0.2)
    expect(v.rotationOffset.ry).toBe(0.5)
    expect(v.scaleAdjust).toBe(1.4)
    expect(v.adsTime).toBe(0.3)
    expect(v.kickMagnitude).toBe(2.1)
  })

  it('un 404 (archivo inexistente) no lanza y no cambia nada', async () => {
    globalThis.fetch = fakeFetch(false, null)
    await expect(loadWeaponTuningOverrides()).resolves.toBeUndefined()
    expect(WEAPON_REGISTRY[SLUG].adsTime).toBe(snap.adsTime)
    expect(WEAPON_REGISTRY[SLUG].scaleAdjust).toBe(snap.scaleAdjust)
  })

  it('la red caída (fetch rechaza) no lanza', async () => {
    globalThis.fetch = fakeFetchNetworkError()
    await expect(loadWeaponTuningOverrides()).resolves.toBeUndefined()
    expect(WEAPON_REGISTRY[SLUG].adsTime).toBe(snap.adsTime)
  })

  it('JSON malformado no lanza, no cambia nada y se loguea', async () => {
    globalThis.fetch = fakeFetchInvalidJson()
    await expect(loadWeaponTuningOverrides()).resolves.toBeUndefined()
    expect(WEAPON_REGISTRY[SLUG].adsTime).toBe(snap.adsTime)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('un slug desconocido no crea una entrada nueva ni lanza', async () => {
    globalThis.fetch = fakeFetch(true, { 'arma-que-no-existe': { adsTime: 0.5 } })
    await expect(loadWeaponTuningOverrides()).resolves.toBeUndefined()
    expect(WEAPON_REGISTRY['arma-que-no-existe']).toBeUndefined()
  })

  it('campos de tipo incorrecto se ignoran, el resto del arma sigue procesándose', async () => {
    globalThis.fetch = fakeFetch(true, {
      [SLUG]: {
        adsTime: 'rapido',
        scaleAdjust: null,
        hipOffset: 'no es un objeto',
        kickMagnitude: 2.5,
      },
    })
    await loadWeaponTuningOverrides()
    const v = WEAPON_REGISTRY[SLUG]
    expect(v.adsTime).toBe(snap.adsTime)
    expect(v.scaleAdjust).toBe(snap.scaleAdjust)
    expect(v.hipOffset).toEqual(snap.hipOffset)
    expect(v.kickMagnitude).toBe(2.5)
  })

  it('campos extra desconocidos no rompen la carga', async () => {
    globalThis.fetch = fakeFetch(true, {
      [SLUG]: { mysteryField: 123, scaleAdjust: 1.2 },
    })
    await expect(loadWeaponTuningOverrides()).resolves.toBeUndefined()
    expect(WEAPON_REGISTRY[SLUG].scaleAdjust).toBe(1.2)
  })

  describe('rango, no sólo finitud (Defecto 5)', () => {
    it('adsTime=0 se rechaza: no puede dividir por cero dentro de stepViewmodel', async () => {
      globalThis.fetch = fakeFetch(true, { [SLUG]: { adsTime: 0 } })
      await loadWeaponTuningOverrides()
      expect(WEAPON_REGISTRY[SLUG].adsTime).toBe(snap.adsTime)
      expect(warnSpy).toHaveBeenCalled()
      const mensaje = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(mensaje).toContain(SLUG)
      expect(mensaje).toContain('adsTime')
    })

    it('adsTime negativo se rechaza', async () => {
      globalThis.fetch = fakeFetch(true, { [SLUG]: { adsTime: -0.5 } })
      await loadWeaponTuningOverrides()
      expect(WEAPON_REGISTRY[SLUG].adsTime).toBe(snap.adsTime)
    })

    it('scaleAdjust=0 se rechaza: el arma no puede quedar invisible por un hand-edit', async () => {
      globalThis.fetch = fakeFetch(true, { [SLUG]: { scaleAdjust: 0 } })
      await loadWeaponTuningOverrides()
      expect(WEAPON_REGISTRY[SLUG].scaleAdjust).toBe(snap.scaleAdjust)
      const mensaje = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(mensaje).toContain(SLUG)
      expect(mensaje).toContain('scaleAdjust')
    })

    it('scaleAdjust negativo se rechaza: el arma no puede quedar invertida', async () => {
      globalThis.fetch = fakeFetch(true, { [SLUG]: { scaleAdjust: -2 } })
      await loadWeaponTuningOverrides()
      expect(WEAPON_REGISTRY[SLUG].scaleAdjust).toBe(snap.scaleAdjust)
    })

    it('valores dentro de rango sí se aplican', async () => {
      globalThis.fetch = fakeFetch(true, { [SLUG]: { adsTime: 0.5, scaleAdjust: 1.8 } })
      await loadWeaponTuningOverrides()
      expect(WEAPON_REGISTRY[SLUG].adsTime).toBe(0.5)
      expect(WEAPON_REGISTRY[SLUG].scaleAdjust).toBe(1.8)
    })
  })

  /**
   * Bug real reproducido en el navegador (Chrome DevTools contra el dev
   * server, no en Vitest): el panel de tuning (createWeaponTuningPanel más
   * abajo en este archivo, ver mount()) construye sus sliders leyendo
   * WEAPON_REGISTRY en el instante del mount, que es ANTES de que resuelva
   * este fetch -- game.ts dispara loadWeaponTuningOverrides() sin esperarla
   * en start(). El registro SÍ terminaba mutado a tiempo (viewmodel/
   * renderer.ts y adapt.ts#syncRigWeapon lo releen en vivo cada frame, así
   * que el arma en pantalla ya se veía bien), pero nada reconstruía el DOM
   * del panel después: quien tuneaba exportaba, guardaba el archivo,
   * recargaba, y el panel seguía mostrando los valores heurísticos de
   * seed.ts para siempre, como si el override nunca se hubiera aplicado.
   *
   * Los tests de arriba (`archivo válido pisa los valores del registry`,
   * etc.) ya probaban que WEAPON_REGISTRY se muta bien -- ESO nunca fue el
   * problema, y seguían en verde con el bug presente: por eso pasaban
   * mientras el feature estaba roto en el navegador, "testeando lo
   * incorrecto" en el sentido de que no cubrían al consumidor que sí
   * fallaba. Este bloque pinea dos cosas distintas:
   *
   * 1. Por qué alcanza con releer/reconstruir el panel después de que la
   *    promesa resuelve (la solución real: refresh() en tuning-panel.ts,
   *    llamado desde mount() con loadWeaponTuningOverrides().then(...)), sin
   *    necesitar un bus de eventos: loadWeaponTuningOverrides() muta el
   *    objeto IN PLACE, así que una referencia tomada ANTES de la carga (como
   *    la que buildSliders() captura al mount) ya ve los valores nuevos
   *    después, sin volver a llamar a getWeaponVisual().
   * 2. Que createWeaponTuningPanel expone refresh() y no revienta si se lo
   *    llama antes o después de mount()/unmount().
   *
   * Lo que este archivo NO puede pinear: que refresh() efectivamente
   * reconstruye el DOM de los sliders con los valores nuevos. vitest.config.ts
   * corre este archivo con environment: 'node' (sin jsdom/happy-dom
   * instalado) y createWeaponTuningPanel().mount() usa document/window de
   * verdad -- no hay forma de invocar mount() acá. Esa parte se verificó a
   * mano contra el dev server: assaultrifle-1 mostraba "rotation.y: 0.000"
   * tras un hard reload antes del fix y "rotation.y: -3.072" (el valor real
   * de weapons_tuning.json) después, sin tocar el dropdown de armas.
   */
  describe('contrato real: lo que game.ts lee cada frame refleja el override, no sólo WEAPON_REGISTRY', () => {
    it('una referencia tomada ANTES de cargar overrides ve los valores nuevos DESPUÉS, sin volver a leer el registry', async () => {
      // Simula lo que buildSliders() hace en mount(): agarra la referencia
      // del WeaponVisual ANTES de que loadWeaponTuningOverrides() resuelva.
      const visualAntesDeLaCarga = getWeaponVisual(SLUG)

      globalThis.fetch = fakeFetch(true, {
        [SLUG]: { adsOffset: { z: 0.31 }, rotationOffset: { ry: 1.2 }, kickMagnitude: 2.2 },
      })
      await loadWeaponTuningOverrides()

      // La MISMA referencia -- sin llamar a getWeaponVisual(SLUG) de nuevo --
      // ya refleja el override: es un objeto mutado in place, no reemplazado.
      expect(visualAntesDeLaCarga.adsOffset.z).toBe(0.31)
      expect(visualAntesDeLaCarga.rotationOffset.ry).toBe(1.2)
      expect(visualAntesDeLaCarga.kickMagnitude).toBe(2.2)

      // Y el consumidor real que game.ts llama cada frame (adapt.ts) ve lo
      // mismo si se lo invoca DESPUÉS de que la carga resolvió -- que es
      // justo lo que render()/syncRigWeapon() hacen en el juego real.
      const rig = createRigWeapon()
      syncRigWeapon(rig, getWeaponVisual(SLUG))
      expect(rig.ads.pz).toBe(0.31)
      expect(rig.kickMagnitude).toBe(2.2)
    })

    it('createWeaponTuningPanel expone refresh() y no revienta si se llama sin estar montado', () => {
      const panel = createWeaponTuningPanel({
        initialSlug: SLUG,
        onSelectWeapon: () => {},
        setFireHeld: () => {},
        onReload: () => {},
        setAds: () => {},
      })
      expect(() => panel.refresh()).not.toThrow()
    })
  })
})

describe('weaponOptionLabel', () => {
  it('no toca el nombre de un arma que no necesita revisión', () => {
    const label = weaponOptionLabel({
      slug: 'foo-1',
      name: 'Foo 1',
      triangles: 100,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      muzzleConfidence: 0.9,
      upAxisConfidence: 0.9,
      needsManualReview: false,
    })
    expect(label).toBe('Foo 1')
  })

  it('marca en el label un arma que sí necesita revisión, sin perder el nombre', () => {
    const label = weaponOptionLabel({
      slug: 'foo-1',
      name: 'Foo 1',
      triangles: 100,
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      muzzleConfidence: 0.1,
      upAxisConfidence: 0.8,
      needsManualReview: true,
    })
    expect(label).not.toBe('Foo 1')
    expect(label).toContain('Foo 1')
  })

  it('sobre el index.json real, marca exactamente las armas que index.json marca', () => {
    // Ancla contra una regresión donde needsManualReview se lee de un
    // campo distinto o se invierte la condición: cada arma real tiene que
    // aparecer marcada si y sólo si su propio needsManualReview es true.
    for (const entry of weaponIndex()) {
      expect(weaponOptionLabel(entry).includes('revisar')).toBe(entry.needsManualReview)
    }
  })

  it('el index.json real trae armas flageadas y sin flagear, para que el chequeo anterior no sea trivial', () => {
    const entradas = weaponIndex()
    expect(entradas.some((e) => e.needsManualReview)).toBe(true)
    expect(entradas.some((e) => !e.needsManualReview)).toBe(true)
  })
})
