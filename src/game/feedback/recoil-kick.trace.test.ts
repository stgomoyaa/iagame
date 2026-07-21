/**
 * Trazador de calibración del GOLPE DE VISTA (canal de sensación,
 * camera-punch.ts). No es un test de mecánica fina como camera-punch.test.ts:
 * es la verificación de que el fix "las armas patean y cada clase se siente
 * distinta" es REAL, medida en grados, no leída del código. Imprime la tabla
 * que vive en docs/recoil-kick.md y ancla tres propiedades que el fix promete:
 *
 *  1. TODO disparo patea en el primer tiro (pico > 0): la queja de fondo era
 *     que tap-fire y semis no movían la cámara. Acá el primer tiro de cada
 *     arma tiene pico medible.
 *  2. Las clases se ORDENAN por carácter: escopeta/cerrojo pegan el golpe más
 *     grande, las SMG el más chico. Dos armas ya no "se sienten igual".
 *  3. Ni el fuego sostenido más brutal cruza el tope (cameraKickPitchMax): el
 *     desfase entre la vista y el apuntado real queda acotado, las balas nunca
 *     caen "muy lejos" de la retícula.
 */

import { describe, expect, it } from 'vitest'
import {
  createCameraPunchState,
  fireCameraPunch,
  stepCameraPunch,
} from '@/game/feedback/camera-punch'
import { FEEDBACK } from '@/game/feedback/tuning'
import { ARCHETYPE_LIST, radToDeg } from '@/game/weapons/archetypes'
import { fireInterval } from '@/game/combat/fire-control'

const DT = 1 / 240

/** Pico de pitch (grados) de UN solo disparo, y a los cuántos ms ocurre y
 *  cuándo vuelve a estar bajo 0.05° (asentado). */
function singleShotTrace(viewKick: number): { peakDeg: number; peakMs: number; settleMs: number } {
  const state = createCameraPunchState()
  fireCameraPunch(state, viewKick)
  let peak = 0
  let peakStep = 0
  let settleStep = -1
  const steps = Math.round(1.0 / DT) // 1 segundo
  for (let i = 1; i <= steps; i++) {
    stepCameraPunch(state, DT)
    if (state.pitch > peak) {
      peak = state.pitch
      peakStep = i
    }
    // Asentado = de vuelta bajo 0.05° DESPUÉS del pico (i > peakStep evita
    // contar la fase de subida, cuando el pitch todavía es chico camino al pico).
    if (settleStep < 0 && i > peakStep && Math.abs(state.pitch) < 0.05 * (Math.PI / 180)) {
      settleStep = i
    }
  }
  return {
    peakDeg: radToDeg(peak),
    peakMs: peakStep * DT * 1000,
    settleMs: settleStep < 0 ? -1 : settleStep * DT * 1000,
  }
}

/** Pico de pitch (grados) de un segundo de fuego sostenido a la cadencia real
 *  del arma (para las autos: mide la acumulación bajo el tope). */
function sustainedPeakDeg(viewKick: number, fireIntervalS: number): number {
  const state = createCameraPunchState()
  let peak = 0
  let sinceShot = fireIntervalS // listo para disparar ya
  const steps = Math.round(1.0 / DT)
  for (let i = 0; i < steps; i++) {
    sinceShot += DT
    if (sinceShot >= fireIntervalS) {
      fireCameraPunch(state, viewKick)
      sinceShot -= fireIntervalS
    }
    stepCameraPunch(state, DT)
    if (state.pitch > peak) peak = state.pitch
  }
  return radToDeg(peak)
}

describe('trazador de calibración del golpe de vista', () => {
  it('imprime la tabla y ancla las propiedades del fix', () => {
    const rows: string[] = []
    rows.push('arquetipo        | viewKick° | pico 1 tiro° | pico@ms | asienta@ms | sostenido°')
    rows.push('-----------------|-----------|--------------|---------|------------|-----------')

    let smg1Peak = 0
    let ar1Peak = 0
    let shotgunPeak = 0
    let boltPeak = 0

    for (const a of ARCHETYPE_LIST) {
      const single = singleShotTrace(a.recoil.viewKick)
      const sustained = sustainedPeakDeg(a.recoil.viewKick, fireInterval(a))
      rows.push(
        [
          a.id.padEnd(16),
          radToDeg(a.recoil.viewKick).toFixed(1).padStart(9),
          single.peakDeg.toFixed(3).padStart(12),
          single.peakMs.toFixed(0).padStart(7),
          (single.settleMs < 0 ? '>1000' : single.settleMs.toFixed(0)).padStart(10),
          sustained.toFixed(3).padStart(10),
        ].join(' | '),
      )
      // Propiedad 1: TODO disparo patea en el primer tiro.
      expect(single.peakDeg, `${a.id}: el primer tiro tiene que patear`).toBeGreaterThan(0.1)
      // El pico de un solo tiro nunca cruza el tope.
      expect(single.peakDeg, `${a.id}: pico bajo el tope`).toBeLessThanOrEqual(
        radToDeg(FEEDBACK.cameraKickPitchMax) + 1e-6,
      )
      // Propiedad 3: ni el fuego sostenido cruza el tope.
      expect(sustained, `${a.id}: sostenido bajo el tope`).toBeLessThanOrEqual(
        radToDeg(FEEDBACK.cameraKickPitchMax) + 1e-6,
      )
      if (a.id === 'smg-1') smg1Peak = single.peakDeg
      if (a.id === 'ar-1') ar1Peak = single.peakDeg
      if (a.id === 'shotgun') shotgunPeak = single.peakDeg
      if (a.id === 'sniper-bolt') boltPeak = single.peakDeg
    }

    console.log('\n' + rows.join('\n') + '\n')

    // Propiedad 2: las clases se ordenan por carácter.
    expect(shotgunPeak).toBeGreaterThan(ar1Peak)
    expect(boltPeak).toBeGreaterThan(ar1Peak)
    expect(smg1Peak).toBeLessThan(ar1Peak)
  })
})
