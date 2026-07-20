import { describe, expect, it } from 'vitest'
import {
  createDefaultSensitivity,
  normalizeSensitivity,
  radianesPorConteo,
  PERFIL_PROPIO,
  SENS_POR_DEFECTO,
  SENSITIVITY_VERSION,
} from '@/game/settings/store'
import { convert, cmPer360 } from '@/game/settings/sensitivity'
import { findProfile } from '@/game/settings/games'

/** El valor que game.ts tuvo hardcodeado desde la fase 1. Que el default
 *  siga dando EXACTAMENTE esto es lo que garantiza que conectar el
 *  conversor no le cambió el mouse a nadie. */
const SENSIBILIDAD_HISTORICA = 0.0022

describe('sensibilidad persistida', () => {
  it('el default reproduce la constante histórica de game.ts', () => {
    expect(radianesPorConteo(createDefaultSensitivity())).toBeCloseTo(SENSIBILIDAD_HISTORICA, 12)
  })

  it('SENS_POR_DEFECTO está dentro del rango que el propio juego declara', () => {
    expect(SENS_POR_DEFECTO).toBeGreaterThanOrEqual(PERFIL_PROPIO.range.min)
    expect(SENS_POR_DEFECTO).toBeLessThanOrEqual(PERFIL_PROPIO.range.max)
  })

  it('radianesPorConteo es lineal en la sensibilidad', () => {
    const base = createDefaultSensitivity()
    const doble = { ...base, sens: base.sens * 2 }
    expect(radianesPorConteo(doble)).toBeCloseTo(radianesPorConteo(base) * 2, 12)
  })

  describe('normalizeSensitivity', () => {
    it('acepta un guardado válido tal cual', () => {
      const guardado = { version: SENSITIVITY_VERSION, sens: 3, dpi: 1600, origenId: 'valorant' }
      expect(normalizeSensitivity(guardado)).toEqual(guardado)
    })

    it('descarta un guardado de otra versión', () => {
      const viejo = { version: 999, sens: 3, dpi: 1600, origenId: 'valorant' }
      expect(normalizeSensitivity(viejo)).toEqual(createDefaultSensitivity())
    })

    // Los casos que dejarían el juego "roto" sin que se vea por qué: mouse
    // muerto o cámara girando sin control.
    for (const roto of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      it(`recorta una sensibilidad de ${String(roto)}`, () => {
        const salida = normalizeSensitivity({
          version: SENSITIVITY_VERSION, sens: roto, dpi: 800, origenId: 'cs2',
        })
        expect(salida.sens).toBeGreaterThanOrEqual(PERFIL_PROPIO.range.min)
        expect(salida.sens).toBeLessThanOrEqual(PERFIL_PROPIO.range.max)
        expect(radianesPorConteo(salida)).toBeGreaterThan(0)
      })
    }

    it('rechaza un juego de origen que no existe', () => {
      const salida = normalizeSensitivity({
        version: SENSITIVITY_VERSION, sens: 3, dpi: 800, origenId: 'halo',
      })
      expect(findProfile(salida.origenId)).toBeDefined()
    })

    for (const basura of [null, undefined, 42, 'hola', []]) {
      it(`devuelve el default ante ${JSON.stringify(basura) ?? 'undefined'}`, () => {
        expect(normalizeSensitivity(basura)).toEqual(createDefaultSensitivity())
      })
    }
  })

  /**
   * El punto del conversor entero: si el jugador aplica su sensibilidad de
   * CS, los centímetros por vuelta que va a recorrer acá tienen que ser los
   * mismos. Se verifica de punta a punta -- convert() y después el número
   * que el MOTOR realmente consume -- porque es la costura donde una
   * conversión correcta se puede perder por una unidad mal aplicada.
   */
  it('aplicar una conversión preserva los cm/360 hasta los radianes del motor', () => {
    const cs2 = findProfile('cs2')
    expect(cs2).toBeDefined()
    if (cs2 === undefined) return

    const DPI = 800
    const SENS_CS = 1.6
    const resultado = convert({ from: cs2, to: PERFIL_PROPIO, sens: SENS_CS, dpi: DPI })
    expect(resultado.outOfRange).toBe(false)

    const aplicado = normalizeSensitivity({
      version: SENSITIVITY_VERSION, sens: resultado.clamped, dpi: DPI, origenId: 'cs2',
    })

    // 1) La conversión conserva los cm/360 en la escala del juego destino.
    expect(resultado.cmPer360).toBeCloseTo(cmPer360(SENS_CS, DPI, cs2.yaw), 6)

    // 2) Y esos cm/360 sobreviven el viaje a radianes por conteo, que es lo
    //    único que engine/input.ts mira. Reconstruye el cm/360 desde el
    //    número del motor, sin volver a pasar por la escala del juego:
    //      conteos_por_360 = 2*pi / rad_por_conteo
    //      cm              = conteos / dpi * 2.54
    const radPorConteo = radianesPorConteo(aplicado)
    const cmDesdeElMotor = ((2 * Math.PI) / radPorConteo / DPI) * 2.54
    expect(cmDesdeElMotor).toBeCloseTo(resultado.cmPer360, 6)
  })
})
