/**
 * Ancla la alineación entre lo que se DIBUJA y lo que se DISPARA.
 *
 * El peor bug posible en un shooter no es fallar: es acertarle a algo que
 * claramente se ve como una cabeza y que no registre nada, o que el pecho
 * alto cuente como headshot. Se lee como que el juego está roto, no como
 * una falla de puntería. Antes de esta tarea los bots eran cápsulas y no
 * había nada que alinear; ahora hay un modelo humano y las hitboxes tienen
 * que seguirlo.
 *
 * Las medidas de MODELO son del pack de origen (Quaternius Ultimate Modular
 * Men, personaje de pie sobre y=0, esqueleto compartido por los cuatro), y
 * salen de medir los vértices agrupados por el hueso que más los pesa --
 * el mismo criterio con el que se eligieron los números de BOTS. Si alguien
 * cambia modelScale o cualquier offset sin volver a medir, esto falla.
 */

import { describe, expect, it } from 'vitest'
import { HITBOX_MULTIPLIER } from '@/game/combat/hitboxes'
import { BOTS } from '@/game/bots/tuning'
import { PLAYER_CAPSULE } from '@/game/physics/capsule'
import { MOVEMENT } from '@/game/movement/tuning'

/** Geometría visible del personaje SIN escalar, en metros sobre el piso. */
const MODELO = {
  alturaTotal: 1.854,
  cabezaMin: 1.566,
  cabezaMax: 1.852,
  torsoMin: 0.851,
  torsoMax: 1.58,
  piernasMin: 0.0,
  piernasMax: 0.851,
} as const

const s = () => BOTS.modelScale

describe('alineación entre el modelo dibujado y las hitboxes', () => {
  it('la escala deja al personaje dentro de la cápsula de física', () => {
    const alturaEscalada = MODELO.alturaTotal * s()
    // Tolerancia de 1 cm: la cápsula es el volumen de colisión, el modelo
    // no puede sobresalir de ella o el bot atravesaría techos con la cabeza.
    expect(alturaEscalada).toBeLessThanOrEqual(PLAYER_CAPSULE.height + 0.01)
    expect(alturaEscalada).toBeGreaterThan(PLAYER_CAPSULE.height - 0.1)
  })

  it('la hitbox de cabeza cubre el cráneo dibujado y no el pecho', () => {
    const cabezaMin = MODELO.cabezaMin * s()
    const cabezaMax = MODELO.cabezaMax * s()
    const hitMin = BOTS.headOffsetY - BOTS.headRadius
    const hitMax = BOTS.headOffsetY + BOTS.headRadius

    // La esfera tiene que quedar DENTRO del cráneo con holgura de 5 cm: si
    // se pasara por abajo, el cuello y el pecho alto darían x1.8.
    expect(hitMin).toBeGreaterThan(cabezaMin - 0.05)
    expect(hitMax).toBeLessThan(cabezaMax + 0.05)
    // Y su centro tiene que caer dentro del cráneo, no en el borde.
    expect(BOTS.headOffsetY).toBeGreaterThan(cabezaMin)
    expect(BOTS.headOffsetY).toBeLessThan(cabezaMax)
  })

  it('la cabeza sigue anclada a la altura de ojos, que es a donde se apunta', () => {
    // El jugador y los bots apuntan a la altura de ojos del objetivo
    // (bots/bot.ts lookAt, game.ts matchTargets). Si la hitbox de cabeza no
    // vive ahí, un disparo perfectamente apuntado no la toca nunca.
    expect(Math.abs(BOTS.headOffsetY - MOVEMENT.eyeHeight)).toBeLessThan(0.05)
  })

  it('la hitbox de torso cubre el torso dibujado', () => {
    const centroTorso = ((MODELO.torsoMin + MODELO.torsoMax) / 2) * s()
    expect(Math.abs(BOTS.torsoOffsetY - centroTorso)).toBeLessThan(0.1)
  })

  it('las tres hitboxes cubren el cuerpo entero sin huecos', () => {
    const piernas: [number, number] = [
      BOTS.legsOffsetY - BOTS.legsRadius,
      BOTS.legsOffsetY + BOTS.legsRadius,
    ]
    const torso: [number, number] = [
      BOTS.torsoOffsetY - BOTS.torsoRadius,
      BOTS.torsoOffsetY + BOTS.torsoRadius,
    ]
    const cabeza: [number, number] = [
      BOTS.headOffsetY - BOTS.headRadius,
      BOTS.headOffsetY + BOTS.headRadius,
    ]

    // Desde los pies hasta la coronilla no puede haber una franja del cuerpo
    // a la que se le dispare y no registre. Antes de esta tarea las piernas
    // (todo lo de abajo de 0.55) eran exactamente eso.
    expect(piernas[0]).toBeLessThanOrEqual(MODELO.piernasMin * s() + 0.05)
    expect(piernas[1]).toBeGreaterThanOrEqual(torso[0])
    expect(torso[1]).toBeGreaterThanOrEqual(cabeza[0])
    expect(cabeza[1]).toBeGreaterThanOrEqual(MODELO.cabezaMax * s() - 0.05)
  })

  it('cada parte usa el multiplicador que le corresponde', () => {
    // Las piernas estrenan el multiplicador 'limb', que existía en
    // combat/hitboxes.ts desde la fase 1 sin que ningún objetivo lo usara.
    expect(HITBOX_MULTIPLIER.head).toBe(1.8)
    expect(HITBOX_MULTIPLIER.torso).toBe(1.0)
    expect(HITBOX_MULTIPLIER.limb).toBe(0.85)
  })
})
