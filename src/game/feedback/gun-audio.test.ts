import { describe, expect, it } from 'vitest'
import {
  archivosUnicos,
  createWeaponAudio,
  gananciaPorDistancia,
} from '@/game/feedback/gun-audio'
import { WEAPON_AUDIO } from '@/game/feedback/tuning'
import { SUPERFICIE_CARNE, SUPERFICIE_HORMIGON } from '@/game/feedback/vfx'

// Entorno de test = 'node' (vitest.config.ts): sin `window` ni Web Audio real.
// Igual que en audio.test.ts, esa ausencia ya ejercita el camino "degradar en
// silencio" sin necesidad de mock.
describe('audio de arma: degrada en silencio sin Web Audio', () => {
  it('unlock() y precargar() no tiran sin window ni fetch', () => {
    const a = createWeaponAudio()
    expect(() => a.unlock()).not.toThrow()
    expect(() => a.precargar()).not.toThrow()
  })

  it('reproducir no tira con o sin unlock() previo', () => {
    const a = createWeaponAudio()
    expect(() => a.playShot('ar')).not.toThrow()
    expect(() => a.playReload('shotgun')).not.toThrow()
    expect(() => a.playImpact(SUPERFICIE_HORMIGON)).not.toThrow()
    a.unlock()
    expect(() => a.playShot('sniper', 0.4)).not.toThrow()
    expect(() => a.playImpact(SUPERFICIE_CARNE)).not.toThrow()
  })

  it('no se declara listo si no hay contexto', () => {
    const a = createWeaponAudio()
    expect(a.listo).toBe(false)
    a.unlock()
    expect(a.listo).toBe(false)
  })
})

describe('mapeo de samples', () => {
  it('cubre las siete clases de arma con un disparo cada una', () => {
    const clases = Object.keys(WEAPON_AUDIO.shotByClass)
    expect(clases.length).toBe(7)
    for (const c of clases) {
      expect(WEAPON_AUDIO.shotByClass[c as keyof typeof WEAPON_AUDIO.shotByClass]).toMatch(/\.mp3$/)
    }
  })

  it('cubre las siete clases con una recarga cada una', () => {
    const clases = Object.keys(WEAPON_AUDIO.reloadByClass)
    expect(clases.length).toBe(7)
    for (const c of clases) {
      expect(
        WEAPON_AUDIO.reloadByClass[c as keyof typeof WEAPON_AUDIO.reloadByClass],
      ).toMatch(/\.mp3$/)
    }
  })

  it('deduplica los archivos a bajar: las clases comparten samples', () => {
    const unicos = archivosUnicos()
    // 7 disparos + 4 recargas distintas = 11, aunque los mapas sumen 14 entradas.
    expect(unicos.length).toBe(11)
    expect(new Set(unicos).size).toBe(unicos.length)
  })

  it('el disparo y la recarga de una misma clase son archivos distintos', () => {
    for (const c of Object.keys(WEAPON_AUDIO.shotByClass)) {
      const clase = c as keyof typeof WEAPON_AUDIO.shotByClass
      expect(WEAPON_AUDIO.shotByClass[clase]).not.toBe(WEAPON_AUDIO.reloadByClass[clase])
    }
  })

  it('cada clase suena distinto de las demas en disparo (no hay dos clases calcadas)', () => {
    // Compartir recarga entre familias es deliberado; compartir DISPARO no,
    // porque el disparo es la firma sonora del arma.
    const disparos = Object.values(WEAPON_AUDIO.shotByClass)
    expect(new Set(disparos).size).toBe(disparos.length)
  })
})

describe('atenuacion por distancia', () => {
  it('a distancia cero suena al maximo del nivel de bot', () => {
    expect(gananciaPorDistancia(0)).toBeCloseTo(WEAPON_AUDIO.botShotGain, 6)
  })

  it('se apaga del todo pasado el alcance audible', () => {
    expect(gananciaPorDistancia(WEAPON_AUDIO.botAudibleRange)).toBe(0)
    expect(gananciaPorDistancia(WEAPON_AUDIO.botAudibleRange + 10)).toBe(0)
  })

  it('decae de forma monotona con la distancia', () => {
    let previa = Infinity
    for (let d = 0; d < WEAPON_AUDIO.botAudibleRange; d += 5) {
      const g = gananciaPorDistancia(d)
      expect(g).toBeLessThan(previa)
      previa = g
    }
  })

  it('trata una distancia invalida como inaudible en vez de devolver NaN', () => {
    expect(gananciaPorDistancia(NaN)).toBe(0)
    expect(gananciaPorDistancia(-1)).toBe(0)
  })
})

/**
 * Misma regresión que cubre audio.test.ts para los hitmarkers: unlock() no
 * puede volverse un no-op permanente, porque entonces un contexto suspendido
 * por el navegador (pestaña en segundo plano) deja el arma muda el resto de
 * la partida sin camino de vuelta.
 */
describe('audio de arma: unlock() reintenta resume() en cada gesto', () => {
  it('reintenta resume() sin reconstruir el contexto', () => {
    let construcciones = 0
    let resumes = 0
    let state: 'running' | 'suspended' = 'suspended'

    class NodoFalso {
      gain = { value: 0 }
      threshold = { value: 0 }
      ratio = { value: 0 }
      attack = { value: 0 }
      release = { value: 0 }
      connect(): void {}
    }

    class MockAudioContext {
      destination = new NodoFalso()
      sampleRate = 44100
      currentTime = 0
      constructor() {
        construcciones++
      }
      get state(): 'running' | 'suspended' {
        return state
      }
      resume(): Promise<void> {
        resumes++
        state = 'running'
        return Promise.resolve()
      }
      createGain(): NodoFalso {
        return new NodoFalso()
      }
      createDynamicsCompressor(): NodoFalso {
        return new NodoFalso()
      }
      createBuffer(): { getChannelData: () => Float32Array } {
        return { getChannelData: () => new Float32Array(8) }
      }
    }

    const w = globalThis as unknown as { window?: unknown }
    w.window = { AudioContext: MockAudioContext }

    try {
      const a = createWeaponAudio()

      a.unlock()
      expect(construcciones).toBe(1)
      expect(resumes).toBe(1)

      state = 'suspended'
      a.unlock()
      expect(construcciones).toBe(1)
      expect(resumes).toBe(2)
    } finally {
      delete w.window
    }
  })
})
