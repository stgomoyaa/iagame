/**
 * La animación es una VISTA de la simulación, nunca su motor.
 *
 * clipPara() es una función pura de (vida, velocidad, gatillo) -> clip: no
 * tiene memoria propia, no puede contradecir a la FSM y no puede quedar
 * desincronizada, porque no guarda nada que sincronizar. Lo que se prueba
 * acá es justamente esa propiedad: el mismo estado de simulación siempre
 * produce el mismo clip, y ningún clip aparece sin que el estado que lo
 * justifica esté presente (nada de "corriendo en el lugar" estando quieto).
 */

import { describe, expect, it } from 'vitest'
import { clipPara } from '@/game/bots/renderer'

describe('elección de clip según el estado de la simulación', () => {
  it('un bot muerto siempre cae, sin importar velocidad ni gatillo', () => {
    expect(clipPara(false, 0, false)).toBe('Death')
    expect(clipPara(false, 6, true)).toBe('Death')
  })

  it('quieto no corre: el bug de "correr en el lugar" no puede ocurrir', () => {
    expect(clipPara(true, 0, false)).toBe('Idle_Gun')
    // Justo por debajo del umbral de caminar sigue quieto: el ruido numérico
    // de la física (un bot apoyado contra una pared nunca da exactamente 0)
    // no debe hacer que patine caminando sin desplazarse.
    expect(clipPara(true, 0.34, false)).toBe('Idle_Gun')
  })

  it('y a la inversa: moviéndose nunca se queda en idle', () => {
    expect(clipPara(true, 2, false)).toBe('Walk')
    expect(clipPara(true, 5.5, false)).toBe('Run')
  })

  it('el disparo sólo se anima estando quieto', () => {
    // Corriendo gana la locomoción: un bot que dispara en carrera tiene que
    // verse corriendo, o el cuerpo dejaría de seguir a la posición real.
    expect(clipPara(true, 0, true)).toBe('Gun_Shoot')
    expect(clipPara(true, 5.5, true)).toBe('Run')
  })

  it('es determinista: mismo estado, mismo clip', () => {
    for (const v of [0, 0.5, 3.2, 9]) {
      expect(clipPara(true, v, false)).toBe(clipPara(true, v, false))
    }
  })
})
