/**
 * La detección de mira se prueba contra armas SINTÉTICAS construidas acá:
 * una caja (el cuerpo) más las piezas que representan la mira, con las
 * medidas escritas a mano. Así el test sabe la respuesta correcta al
 * milímetro, cosa imposible con un modelo real, donde lo único que se puede
 * afirmar es "el número parece razonable" — que no es un test.
 *
 * Convención de las posiciones, igual que la salida de buildNormalizeMatrix:
 * boca hacia -Z, arriba +Y, centrado en el origen.
 */

import { describe, expect, it } from 'vitest'
import { detectSightLine } from './sight.ts'

/** Nube de puntos de una caja alineada a los ejes, con `n` muestras por eje.
 *  Se llena el volumen (no sólo la cáscara) para que ninguna rebanada del
 *  perfil quede vacía por azar de muestreo. */
function caja(
  cx: number, cy: number, cz: number,
  sx: number, sy: number, sz: number,
  n = 6,
): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        out.push(
          cx + (i / (n - 1) - 0.5) * sx,
          cy + (j / (n - 1) - 0.5) * sy,
          cz + (k / (n - 1) - 0.5) * sz,
        )
      }
    }
  }
  return out
}

const LARGO = 0.8
const ALTO_CUERPO = 0.12
const ANCHO = 0.06
/** Altura del cuerpo desde el eje: el techo del cajón queda acá. */
const TECHO_CUERPO = ALTO_CUERPO / 2
/** Las miras sobresalen 2 cm por encima de ese techo. */
const ALTURA_MIRA = TECHO_CUERPO + 0.02

/**
 * Fusil con hierros: cuerpo largo, punto de mira cerca de la boca (-Z) y
 * alza cerca del cajón (+Z), los dos a la misma altura y los dos angostos y
 * sobre la línea central, que es lo que los hace miras.
 */
function fusilConHierros(): Float32Array {
  const cuerpo = caja(0, 0, 0, ANCHO, ALTO_CUERPO, LARGO, 8)
  const alturaPoste = ALTURA_MIRA - TECHO_CUERPO
  const puntoDeMira = caja(0, TECHO_CUERPO + alturaPoste / 2, -0.34, 0.006, alturaPoste, 0.01)
  const alza = caja(0, TECHO_CUERPO + alturaPoste / 2, 0.3, 0.008, alturaPoste, 0.012)
  return Float32Array.from([...cuerpo, ...puntoDeMira, ...alza])
}

describe('detectSightLine con hierros', () => {
  it('devuelve la altura de la cresta, no el borde de la caja envolvente', () => {
    const s = detectSightLine(fusilConHierros(), 'hierros')
    expect(s.height).toBeCloseTo(ALTURA_MIRA, 3)
    // La distinción que justifica todo el archivo: la cresta está 2 cm por
    // encima del techo del cuerpo. Si alguien "simplifica" esto a
    // bounds.max[1] el número da igual... salvo que acá coinciden a propósito
    // para que el test siguiente los separe.
    expect(s.height).toBeGreaterThan(TECHO_CUERPO)
  })

  it('el punto de mira queda adelante y el alza atrás, bien separados', () => {
    const s = detectSightLine(fusilConHierros(), 'hierros')
    expect(s.frontZ).toBeLessThan(0)
    expect(s.rearZ).toBeGreaterThan(0)
    expect(s.frontZ).toBeLessThan(s.rearZ)
    // Separación real: dos miras a 64 cm sobre un arma de 80 cm.
    expect(s.confidence).toBeGreaterThan(0.6)
  })

  it('ignora una pieza alta que NO está sobre la línea central', () => {
    // Un manubrio de carga: tan alto como las miras pero corrido al costado.
    // Si la franja central no filtrara por X, éste ganaría la cresta y el
    // ADS quedaría alineado con una manija.
    const manubrio = caja(ANCHO * 0.45, TECHO_CUERPO + 0.05, 0.1, 0.01, 0.1, 0.03)
    const conManubrio = Float32Array.from([...fusilConHierros(), ...manubrio])

    const s = detectSightLine(conManubrio, 'hierros')
    expect(s.height).toBeCloseTo(ALTURA_MIRA, 3)
  })

  it('avisa con confianza baja cuando hay un solo pico y no una línea', () => {
    // Sólo alza, sin punto de mira: no hay dos puntos que definan una línea.
    const cuerpo = caja(0, 0, 0, ANCHO, ALTO_CUERPO, LARGO, 8)
    const alza = caja(0, ALTURA_MIRA - 0.01, 0.3, 0.008, 0.02, 0.012)
    const s = detectSightLine(Float32Array.from([...cuerpo, ...alza]), 'hierros')

    expect(s.confidence).toBeLessThan(0.1)
  })
})

describe('detectSightLine con óptica', () => {
  /** Mismo cuerpo, con un tubo de 4 cm de diámetro montado 3 cm por encima
   *  del techo del cajón. El eje del tubo es lo que el ojo tiene que usar. */
  const DIAMETRO_TUBO = 0.04
  const EJE_TUBO = TECHO_CUERPO + 0.03 + DIAMETRO_TUBO / 2

  function fusilConVisor(): Float32Array {
    const cuerpo = caja(0, 0, 0, ANCHO, ALTO_CUERPO, LARGO, 8)
    const tubo = caja(0, EJE_TUBO, 0.05, 0.03, DIAMETRO_TUBO, 0.28, 8)
    // Montura: une el tubo con el cajón. Es lo que hace que "lo que sobresale
    // del cuerpo" no sea sólo el tubo, y por eso el test la incluye.
    const montura = caja(0, TECHO_CUERPO + 0.015, 0.05, 0.02, 0.03, 0.05)
    return Float32Array.from([...cuerpo, ...tubo, ...montura])
  }

  it('apunta al EJE del tubo, no al techo del visor', () => {
    const s = detectSightLine(fusilConVisor(), 'optica')
    const techoDelVisor = EJE_TUBO + DIAMETRO_TUBO / 2

    // Es el bug entero de esta tarea, un piso más arriba: con la cresta, la
    // cruceta queda apoyada SOBRE el visor en vez de dentro de él.
    expect(s.height).toBeLessThan(techoDelVisor - 0.005)
    expect(s.height).toBeGreaterThan(TECHO_CUERPO)
    // El punto medio entre cresta y vientre del tubo cae dentro del tubo: eso
    // es lo que se afirma, no un valor exacto (la montura corre un poco el
    // vientre hacia abajo, a propósito).
    expect(s.height).toBeGreaterThan(EJE_TUBO - DIAMETRO_TUBO)
    expect(s.height).toBeLessThan(EJE_TUBO + DIAMETRO_TUBO / 2)
  })

  it('la MISMA malla leída como hierros da la cresta: el tipo de mira cambia el resultado', () => {
    const malla = fusilConVisor()
    const comoOptica = detectSightLine(malla, 'optica')
    const comoHierros = detectSightLine(malla, 'hierros')

    // Si estos dos dieran lo mismo, declarar el tipo de mira en el catálogo
    // no serviría para nada y este test es lo que lo demuestra.
    expect(comoHierros.height).toBeGreaterThan(comoOptica.height + 0.01)
    expect(comoHierros.height).toBeCloseTo(EJE_TUBO + DIAMETRO_TUBO / 2, 2)
  })
})

describe('detectSightLine en casos degenerados', () => {
  it('una nube vacía no lanza: devuelve confianza 0', () => {
    const s = detectSightLine(new Float32Array(0), 'hierros')
    expect(s.confidence).toBe(0)
  })

  it('un cuerpo liso sin mira devuelve su propio techo, no un número inventado', () => {
    const cuerpo = Float32Array.from(caja(0, 0, 0, ANCHO, ALTO_CUERPO, LARGO, 8))
    const s = detectSightLine(cuerpo, 'hierros')
    expect(s.height).toBeCloseTo(TECHO_CUERPO, 3)
  })
})
