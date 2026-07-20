import { describe, expect, it } from 'vitest'
import {
  createDefaultPrestige,
  esPermanente,
  fichasDisponibles,
  gastarFicha,
  prestigeLabel,
  prestigiar,
  PRESTIGIO_MAX,
  SIN_PRESTIGIO,
  puedePrestigiar,
  type PrestigeData,
} from '@/game/progression/prestige'
import { levelForXp, NIVEL_MAXIMO, xpParaNivel } from '@/game/progression/unlocks'
import { weaponIndex } from '@/game/weapons/registry'

const XP_TECHO = xpParaNivel(NIVEL_MAXIMO)
const ARMA = weaponIndex()[0].slug
const OTRA_ARMA = weaponIndex()[1].slug

function enElTecho(extra: Partial<PrestigeData> = {}): PrestigeData {
  return { ...createDefaultPrestige(), xp: XP_TECHO, ...extra }
}

describe('cuándo se puede prestigiar', () => {
  it('no se puede antes del techo', () => {
    expect(puedePrestigiar(createDefaultPrestige())).toBe(false)
    expect(puedePrestigiar({ ...createDefaultPrestige(), xp: XP_TECHO - 1 })).toBe(false)
    const r = prestigiar({ ...createDefaultPrestige(), xp: XP_TECHO - 1 })
    expect(r.hecho).toBe(false)
    expect(r.data.prestigio).toBe(SIN_PRESTIGIO)
    expect(r.data.xp).toBe(XP_TECHO - 1)
  })

  it('se puede justo en el techo', () => {
    expect(puedePrestigiar(enElTecho())).toBe(true)
  })

  it('se corta en el prestigio máximo', () => {
    const maximo = enElTecho({ prestigio: PRESTIGIO_MAX })
    expect(puedePrestigiar(maximo)).toBe(false)
    expect(prestigiar(maximo).hecho).toBe(false)
  })
})

describe('qué se reinicia y qué se mantiene', () => {
  it('reinicia la xp y sube el prestigio, y no toca los desbloqueos anteriores', () => {
    const antes = enElTecho({ prestigio: 2, desbloqueosPermanentes: [ARMA, OTRA_ARMA] })
    const { data, hecho } = prestigiar(antes)

    expect(hecho).toBe(true)
    expect(data.xp).toBe(0)
    expect(levelForXp(data.xp)).toBe(1)
    expect(data.prestigio).toBe(3)
    expect(data.desbloqueosPermanentes).toEqual([ARMA, OTRA_ARMA])
  })

  it('no muta el estado anterior', () => {
    const antes = enElTecho({ prestigio: 1, desbloqueosPermanentes: [ARMA] })
    prestigiar(antes, OTRA_ARMA)
    expect(antes.xp).toBe(XP_TECHO)
    expect(antes.prestigio).toBe(1)
    expect(antes.desbloqueosPermanentes).toEqual([ARMA])
  })

  it('la xp sobrante del techo no se arrastra al ciclo nuevo', () => {
    const { data } = prestigiar(enElTecho({ xp: XP_TECHO * 4 }))
    expect(data.xp).toBe(0)
  })
})

describe('la ficha de desbloqueo permanente', () => {
  it('cada prestigio deja una ficha, y las fichas se derivan de las armas elegidas', () => {
    const sinElegir = prestigiar(enElTecho()).data
    expect(fichasDisponibles(sinElegir)).toBe(1)

    const eligiendo = prestigiar(enElTecho(), ARMA).data
    expect(fichasDisponibles(eligiendo)).toBe(0)
    expect(esPermanente(eligiendo, ARMA)).toBe(true)
  })

  it('la ficha postergada se puede gastar después', () => {
    const conFicha = prestigiar(enElTecho()).data
    const { data, hecho } = gastarFicha(conFicha, ARMA)
    expect(hecho).toBe(true)
    expect(data.desbloqueosPermanentes).toEqual([ARMA])
    expect(fichasDisponibles(data)).toBe(0)
  })

  it('sin ficha no se desbloquea nada', () => {
    const r = gastarFicha(createDefaultPrestige(), ARMA)
    expect(r.hecho).toBe(false)
    expect(r.data.desbloqueosPermanentes).toEqual([])
  })

  it('no se puede gastar dos fichas en la misma arma ni en una que no existe', () => {
    const dos = { ...createDefaultPrestige(), prestigio: 2, desbloqueosPermanentes: [ARMA] }
    expect(fichasDisponibles(dos)).toBe(1)
    expect(gastarFicha(dos, ARMA).hecho).toBe(false)
    expect(gastarFicha(dos, 'arma-que-no-existe').hecho).toBe(false)
    expect(gastarFicha(dos, OTRA_ARMA).hecho).toBe(true)
  })

  it('prestigiar con un arma inválida no prestigia a medias', () => {
    // Si esto dejara pasar el prestigio y sólo descartara la ficha, el
    // jugador perdería el ciclo entero por un error de la UI.
    const r = prestigiar(enElTecho(), 'arma-que-no-existe')
    expect(r.hecho).toBe(false)
    expect(r.data.prestigio).toBe(SIN_PRESTIGIO)
    expect(r.data.xp).toBe(XP_TECHO)
  })

  it('diez prestigios dejan diez armas para siempre', () => {
    let data = createDefaultPrestige()
    const elegidas = weaponIndex()
      .slice(0, PRESTIGIO_MAX)
      .map((e) => e.slug)
    for (const slug of elegidas) {
      const r = prestigiar({ ...data, xp: XP_TECHO }, slug)
      expect(r.hecho).toBe(true)
      data = r.data
    }
    expect(data.prestigio).toBe(PRESTIGIO_MAX)
    expect(data.desbloqueosPermanentes).toEqual(elegidas)
    expect(fichasDisponibles(data)).toBe(0)
    expect(puedePrestigiar({ ...data, xp: XP_TECHO })).toBe(false)
  })
})

describe('etiqueta', () => {
  it('siempre lleva el número: los diez emblemas tienen la misma silueta', () => {
    expect(prestigeLabel(SIN_PRESTIGIO)).toBe('Sin prestigio')
    for (let p = 1; p <= PRESTIGIO_MAX; p++) {
      expect(prestigeLabel(p)).toContain(String(p))
    }
  })

  it('aguanta números fuera de rango', () => {
    expect(prestigeLabel(-3)).toBe('Sin prestigio')
    expect(prestigeLabel(99)).toBe(`Prestigio ${PRESTIGIO_MAX}`)
  })
})
