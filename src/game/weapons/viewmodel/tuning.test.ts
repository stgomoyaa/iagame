import { describe, expect, it } from 'vitest'
import { VIEWMODEL } from '@/game/weapons/viewmodel/tuning'

describe('tuning del viewmodel', () => {
  it('las fracciones de recarga están en orden y dentro de (0, 1)', () => {
    expect(VIEWMODEL.reloadMagOutAt).toBeGreaterThan(0)
    expect(VIEWMODEL.reloadMagOutAt).toBeLessThan(VIEWMODEL.reloadMagInAt)
    expect(VIEWMODEL.reloadMagInAt).toBeLessThan(1)
  })

  it('las fracciones de recarga son exactamente las del spec: 0.25 y 0.55', () => {
    expect(VIEWMODEL.reloadMagOutAt).toBeCloseTo(0.25, 9)
    expect(VIEWMODEL.reloadMagInAt).toBeCloseTo(0.55, 9)
  })

  it('el resorte de sway/kick es estable a los framerates que corre el render (120-240Hz)', () => {
    // Estabilidad de Euler semi-implícito para un resorte amortiguado:
    // stiffness * dt tiene que quedar lejos de 2 para no oscilar sin control
    // al dt más largo que se corre (120Hz).
    expect(VIEWMODEL.swayStiffness * (1 / 120)).toBeLessThan(1.5)
  })

  it('la constante de tiempo de groundedBlend es positiva pero corta', () => {
    expect(VIEWMODEL.groundedBlendTime).toBeGreaterThan(0)
    expect(VIEWMODEL.groundedBlendTime).toBeLessThan(0.5)
  })

  it('bobFreq y bobAmp son positivos', () => {
    expect(VIEWMODEL.bobFreq).toBeGreaterThan(0)
    expect(VIEWMODEL.bobAmp).toBeGreaterThan(0)
  })

  it('los impulsos de kick son positivos: la dirección la decide el signo en rig.ts', () => {
    expect(VIEWMODEL.kickBack).toBeGreaterThan(0)
    expect(VIEWMODEL.kickUp).toBeGreaterThan(0)
    expect(VIEWMODEL.kickRoll).toBeGreaterThan(0)
  })

  it('drawDrop es positivo: el arma arranca abajo y sube', () => {
    expect(VIEWMODEL.drawDrop).toBeGreaterThan(0)
  })
})
