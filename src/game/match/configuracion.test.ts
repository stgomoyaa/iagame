import { describe, expect, it } from 'vitest'
import {
  aQuery,
  acotarConfig,
  botsDeConfig,
  CONFIG_RANKED,
  configPorDefecto,
  desdeQuery,
  etiquetaDeConfig,
  permiteEditarRoster,
  PRESETS,
  type ConfigPartida,
} from '@/game/match/configuracion'
import { MAX_BOTS, MIN_BOTS } from '@/game/match/roster'
import { MATCH } from '@/game/match/tuning'

function config(over: Partial<ConfigPartida> = {}): ConfigPartida {
  return { mapa: 'arena', modo: 'tdm', jugadores: 8, ranked: false, ...over }
}

describe('configuración de partida', () => {
  it('los presets son 2v2, 3v3 y 6v6', () => {
    expect(PRESETS.map((p) => p.etiqueta)).toEqual(['2v2', '3v3', '6v6'])
    expect(PRESETS.map((p) => p.jugadores)).toEqual([4, 6, 12])
  })

  // El pedido textual del dueño: "si quiero jugar 6v6 en un mapa pequeño que
  // también me deje". Ninguna combinación se rechaza.
  it('deja 6v6 en el mapa más chico, y 2v2 en el más grande', () => {
    const seisEnChico = acotarConfig(config({ mapa: 'bunker', jugadores: 12 }))
    expect(seisEnChico.jugadores).toBe(12)
    expect(seisEnChico.mapa).toBe('bunker')

    const dosEnGrande = acotarConfig(config({ mapa: 'nuketown', jugadores: 4 }))
    expect(dosEnGrande.jugadores).toBe(4)
    expect(dosEnGrande.mapa).toBe('nuketown')
  })

  it('acota a lo que el motor sostiene sin rechazar el mapa', () => {
    expect(acotarConfig(config({ jugadores: 999 })).jugadores).toBe(MAX_BOTS + 1)
    expect(acotarConfig(config({ jugadores: 1 })).jugadores).toBe(MIN_BOTS + 1)
    expect(acotarConfig(config({ mapa: 'inventado' })).mapa).toBe('inventado')
  })

  it('el default reproduce la partida que el repo ya tenía tuneada', () => {
    const d = configPorDefecto('arena')
    expect(botsDeConfig(d)).toBe(MATCH.botCount)
    expect(d.modo).toBe(MATCH.defaultMode)
    expect(d.ranked).toBe(false)
  })

  it('la query reusa los parámetros que el motor ya leía', () => {
    const q = new URLSearchParams(aQuery(config({ mapa: 'torre', modo: 'ffa', jugadores: 6 })))
    expect(q.get('map')).toBe('torre')
    expect(q.get('mode')).toBe('ffa')
    expect(q.get('bots')).toBe('5')
    expect(q.get('ranked')).toBeNull()
  })

  it('ida y vuelta por la query conserva la configuración', () => {
    for (const jugadores of [4, 6, 12, 16]) {
      for (const modo of ['tdm', 'ffa'] as const) {
        const original = config({ mapa: 'nuketown', modo, jugadores })
        const vuelta = desdeQuery(new URLSearchParams(aQuery(original)), 'arena')
        expect(vuelta).toEqual(original)
      }
    }
  })

  it('una query vacía o basura cae al default en vez de romper', () => {
    expect(desdeQuery(new URLSearchParams(''), 'arena')).toEqual(configPorDefecto('arena'))
    const basura = desdeQuery(new URLSearchParams('map=&mode=zzz&bots=abc'), 'arena')
    expect(basura).toEqual(configPorDefecto('arena'))
  })

  it('ranked ignora lo que venga por URL y usa su configuración fija', () => {
    const pedida = desdeQuery(
      new URLSearchParams('ranked=1&map=nuketown&mode=ffa&bots=15'),
      'arena',
    )
    expect(pedida).toEqual(CONFIG_RANKED)
  })

  it('ranked no deja editar el roster en caliente; la casual sí', () => {
    expect(permiteEditarRoster(CONFIG_RANKED)).toBe(false)
    expect(permiteEditarRoster(config())).toBe(true)
  })

  it('etiqueta las partidas como se leen', () => {
    expect(etiquetaDeConfig(config({ jugadores: 12 }))).toBe('6v6')
    expect(etiquetaDeConfig(config({ jugadores: 4 }))).toBe('2v2')
    expect(etiquetaDeConfig(config({ jugadores: 9 }))).toBe('5v4')
    expect(etiquetaDeConfig(config({ modo: 'ffa', jugadores: 8 }))).toBe('8 jugadores')
  })
})
