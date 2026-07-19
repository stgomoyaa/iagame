import { describe, expect, it } from 'vitest'
import { MOVEMENT } from '@/game/movement/tuning'

describe('tuning del movimiento', () => {
  it('el sprint es más rápido que caminar y caminar más que ADS', () => {
    expect(MOVEMENT.sprintSpeed).toBeGreaterThan(MOVEMENT.walkSpeed)
    expect(MOVEMENT.walkSpeed).toBeGreaterThan(MOVEMENT.adsSpeed)
    expect(MOVEMENT.adsSpeed).toBeGreaterThan(MOVEMENT.crouchSpeed)
  })

  it('el tope de bhop se mide contra el sprint, no contra la caminata', () => {
    expect(MOVEMENT.bhopSoftCap).toBeCloseTo(MOVEMENT.sprintSpeed * 1.8, 6)
    // El punto del bhop: tiene que ser claramente más rápido que correr.
    expect(MOVEMENT.bhopSoftCap).toBeGreaterThan(MOVEMENT.sprintSpeed * 1.5)
  })

  it('el cap de wish speed aéreo es chico, que es lo que hace funcionar el air-strafe', () => {
    expect(MOVEMENT.airWishSpeedCap).toBeLessThan(1)
    expect(MOVEMENT.airWishSpeedCap).toBeGreaterThan(0)
  })

  it('la ventana de skip de fricción es menor que el buffer de salto', () => {
    expect(MOVEMENT.bhopFrictionSkipWindow).toBeLessThan(MOVEMENT.jumpBufferWindow)
  })

  it('la gravedad arcade es más alta que la real', () => {
    expect(MOVEMENT.gravity).toBeGreaterThan(9.81)
  })

  it('el boost de slide acelera y su decay desacelera', () => {
    expect(MOVEMENT.slideBoost).toBeGreaterThan(1)
    expect(MOVEMENT.slideEndSpeedScale).toBeLessThan(1)
  })

  it('el techo de velocidad del slide es el mismo que el del bhop, no un segundo número', () => {
    expect(MOVEMENT.slideMaxSpeed).toBe(MOVEMENT.bhopSoftCap)
  })

  it('el techo del slide sigue a bhopSoftCap si se muta en vivo, como hace el panel de tuning', () => {
    // engine/tuning-panel.ts tiene un slider que escribe MOVEMENT.bhopSoftCap
    // en caliente y no toca slideMaxSpeed (no existe como campo mutable
    // propio). Si slideMaxSpeed fuera un valor copiado al iniciar el módulo,
    // este test lo pescaría: quedaría pegado al 14.4 original mientras
    // bhopSoftCap ya está en 30.
    const original = MOVEMENT.bhopSoftCap
    try {
      MOVEMENT.bhopSoftCap = 30
      expect(MOVEMENT.slideMaxSpeed).toBe(30)

      MOVEMENT.bhopSoftCap = 9
      expect(MOVEMENT.slideMaxSpeed).toBe(9)
    } finally {
      MOVEMENT.bhopSoftCap = original
    }
  })

  it('el cooldown de slide es positivo: sin él, re-presionar agachar reaplica el boost', () => {
    expect(MOVEMENT.slideCooldown).toBeGreaterThan(0)
  })

  it('el lerp de eyeHeight es positivo pero corto, para que el agache siga sintiéndose ágil', () => {
    expect(MOVEMENT.eyeHeightLerpTime).toBeGreaterThan(0)
    expect(MOVEMENT.eyeHeightLerpTime).toBeLessThan(0.3)
  })
})
