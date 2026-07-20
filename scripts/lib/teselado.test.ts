/**
 * Calibración de la medida de teselado contra dos controles.
 *
 * El control positivo y el negativo son EL MISMO CAMPO DE RUIDO: uno
 * renderizado sobre su periodo completo (tesela por construcción) y el otro
 * recortado fuera de su periodo (no tesela). Es el control correcto porque
 * entre los dos cambia únicamente la propiedad que se mide — mismo contraste,
 * misma frecuencia, misma estadística — así que si la métrica los separa, los
 * separa por la costura y no por otra cosa.
 *
 * Un umbral elegido a ojo no serviría de nada acá: el punto entero de esta
 * herramienta es no confiar en el ojo.
 */

import { describe, expect, it } from 'vitest'
import { fbmP } from './tileable-noise.ts'
import { medirRgba, medirTeselado, UMBRAL_RAZON, type Gris } from './teselado.ts'

const LADO = 192
/** Celdas del ruido. Entero, que es la condición para que el mosaico cierre. */
const CELDAS = 6
const SEED = 11

/** Campo de ruido periódico muestreado sobre un rectángulo cualquiera de su
 *  dominio. Con (0,0,1,1) sale la tesela completa y cierra; con una ventana
 *  interior sale un recorte que no cierra. */
function campo(u0: number, v0: number, du: number, dv: number, lado = LADO): Gris {
  const px = new Uint8Array(lado * lado)
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const u = u0 + (x / lado) * du
      const v = v0 + (y / lado) * dv
      px[y * lado + x] = Math.round(fbmP(u, v, CELDAS, 4, SEED) * 255)
    }
  }
  return { ancho: lado, alto: lado, px }
}

describe('medida de teselado', () => {
  it('control positivo: el campo periódico completo tesela', () => {
    const m = medirTeselado(campo(0, 0, 1, 1), 0)
    // El borde no se distingue de cualquier otro par de columnas contiguas.
    expect(m.razon).toBeLessThan(1.5)
    expect(m.tesela).toBe(true)
  })

  it('control negativo: el MISMO campo recortado no tesela', () => {
    // Ventana interior: los bordes caen en fases distintas del periodo.
    const m = medirTeselado(campo(0.17, 0.23, 0.61, 0.58), 0)
    expect(m.razon).toBeGreaterThan(3)
    expect(m.tesela).toBe(false)
  })

  it('los dos controles quedan separados por un margen ancho', () => {
    // Lo que justifica el umbral: no está al filo de ninguno de los dos.
    const bueno = medirTeselado(campo(0, 0, 1, 1), 0).razon
    const malo = medirTeselado(campo(0.17, 0.23, 0.61, 0.58), 0).razon
    expect(bueno).toBeLessThan(UMBRAL_RAZON)
    expect(malo).toBeGreaterThan(UMBRAL_RAZON)
    // El umbral tiene aire de sobra a los dos lados, no es un empate resuelto
    // a favor de nadie.
    expect(malo / bueno).toBeGreaterThan(2.5)
  })

  it('detecta costura en UN solo eje', () => {
    // Estira sólo en horizontal: arriba/abajo sigue cerrando, izq/der no.
    const m = medirTeselado(campo(0.1, 0, 0.73, 1), 0)
    expect(m.razonH).toBeGreaterThan(UMBRAL_RAZON)
    expect(m.razonV).toBeLessThan(UMBRAL_RAZON)
    // Y la razón que decide es la peor de las dos: una costura ya alcanza.
    expect(m.razon).toBe(m.razonH)
    expect(m.tesela).toBe(false)
  })

  it('un degradado lineal es el peor caso y se detecta como tal', () => {
    // Suave puertas adentro (denominador chico) y con un salto de negro a
    // blanco en el borde: es el modo de falla más común de una imagen
    // generada que no pensó en teselar.
    const px = new Uint8Array(64 * 64)
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) px[y * 64 + x] = Math.round((x / 63) * 255)
    }
    const m = medirTeselado({ ancho: 64, alto: 64, px }, 0)
    expect(m.razon).toBeGreaterThan(20)
    expect(m.tesela).toBe(false)
  })

  it('el ruido blanco aprueba, y tiene que aprobar', () => {
    // No tiene estructura que cortar: repetido no muestra ninguna línea. La
    // métrica mide discontinuidad VISIBLE, no intención del autor.
    const px = new Uint8Array(96 * 96)
    let s = 7
    for (let i = 0; i < px.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      px[i] = s % 256
    }
    const m = medirTeselado({ ancho: 96, alto: 96, px }, 0)
    expect(m.razon).toBeLessThan(1.5)
  })

  it('una imagen plana no divide por cero', () => {
    const px = new Uint8Array(32 * 32).fill(128)
    const m = medirTeselado({ ancho: 32, alto: 32, px }, 0)
    expect(Number.isFinite(m.razon)).toBe(true)
    expect(m.razon).toBe(0)
    expect(m.desviacion).toBe(0)
  })
})

describe('auditoría del archivo, no de lo que el generador prometió', () => {
  it('delata un PNG con tinte aunque se haya pedido escala de grises', () => {
    const rgba = new Uint8Array(16 * 16 * 4)
    for (let i = 0; i < 16 * 16; i++) {
      // Verde apenas por encima del resto: invisible mirando la miniatura.
      rgba[i * 4] = 100
      rgba[i * 4 + 1] = 128
      rgba[i * 4 + 2] = 100
      rgba[i * 4 + 3] = 255
    }
    const m = medirRgba(16, 16, rgba)
    expect(m.croma).toBe(28)
    expect(m.esGris).toBe(false)
  })

  it('acepta el redondeo de un gris que pasó por un conversor', () => {
    const rgba = new Uint8Array(16 * 16 * 4)
    for (let i = 0; i < 16 * 16; i++) {
      rgba[i * 4] = 128
      rgba[i * 4 + 1] = 129
      rgba[i * 4 + 2] = 128
      rgba[i * 4 + 3] = 255
    }
    expect(medirRgba(16, 16, rgba).esGris).toBe(true)
  })

  it('mide el rango real: un patrón sin contraste no da dibujo sobre el arma', () => {
    const px = new Uint8Array(32 * 32)
    for (let i = 0; i < px.length; i++) px[i] = 120 + (i % 8)
    const m = medirTeselado({ ancho: 32, alto: 32, px }, 0)
    expect(m.maximo - m.minimo).toBeLessThan(20)
    expect(m.desviacion).toBeLessThan(5)
  })
})
