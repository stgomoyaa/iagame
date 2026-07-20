import { describe, expect, it } from 'vitest'
import {
  analizarLegibilidad,
  CARAS,
  colorDelCielo,
  direccionDeTexel,
  fbm,
  hornearCara,
  linealASrgb,
  LUMINANCIA_PISO,
  LUMINANCIA_TECHO,
  luminanciaSrgb,
  normalizar,
  PARAMS_POR_DEFECTO,
  ruidoGradiente,
  srgbALineal,
  type Cara,
  type ColorLineal,
  type ParamsCielo,
  type Vec3,
} from './skybox.ts'

function dir(cara: Cara, x: number, y: number, tamano: number): Vec3 {
  const v: Vec3 = { x: 0, y: 0, z: 0 }
  direccionDeTexel(cara, x, y, tamano, v)
  return normalizar(v)
}

function color(v: Vec3, params: ParamsCielo): ColorLineal {
  const out: ColorLineal = { r: 0, g: 0, b: 0 }
  return colorDelCielo(v, params, out)
}

/** Params sin estrellas: las estrellas son puntos de 1-2 texels y meten
 *  ruido de alta frecuencia que tapa lo que miden los tests de continuidad. */
const SIN_ESTRELLAS: ParamsCielo = { ...PARAMS_POR_DEFECTO, densidadEstrellas: 0 }

describe('direccionDeTexel', () => {
  it('el centro de cada cara mira al eje que le corresponde', () => {
    const esperado: Record<Cara, [number, number, number]> = {
      px: [1, 0, 0],
      nx: [-1, 0, 0],
      py: [0, 1, 0],
      ny: [0, -1, 0],
      pz: [0, 0, 1],
      nz: [0, 0, -1],
    }
    // Tamaño par: no hay texel exactamente en el centro, pero los cuatro del
    // medio promedian el eje. Se usa uno y se tolera el medio texel.
    const n = 64
    for (const cara of CARAS) {
      const v = dir(cara, n / 2, n / 2, n)
      const [ex, ey, ez] = esperado[cara]
      expect(v.x).toBeCloseTo(ex, 1)
      expect(v.y).toBeCloseTo(ey, 1)
      expect(v.z).toBeCloseTo(ez, 1)
    }
  })

  it('la fila 0 es ARRIBA en las caras laterales (cubemaps no se voltean)', () => {
    // Este es el test que atrapa el cielo de cabeza. CubeTexture de Three
    // nace con flipY = false: la fila 0 del PNG es t = 0, que en la
    // convención de cubemaps de GL apunta hacia +Y.
    const n = 64
    for (const cara of ['px', 'nx', 'pz', 'nz'] as const) {
      const arriba = dir(cara, n / 2, 0, n)
      const abajo = dir(cara, n / 2, n - 1, n)
      // El tope de una cara lateral es la arista del cubo, a 45 grados: el
      // y normalizado ahí vale 1/raiz(2) = 0.707, no 1. Esperar 0.9 era un
      // error del test, no del generador.
      expect(arriba.y).toBeCloseTo(Math.SQRT1_2, 1)
      expect(abajo.y).toBeCloseTo(-Math.SQRT1_2, 1)
    }
  })

  it('las cuatro caras laterales cubren las cuatro direcciones horizontales', () => {
    const n = 64
    const centros = (['px', 'nz', 'nx', 'pz'] as const).map((c) => dir(c, n / 2, n / 2, n))
    // Consecutivas a 90 grados: el producto punto entre vecinas es ~0.
    for (let i = 0; i < centros.length; i++) {
      const a = centros[i]
      const b = centros[(i + 1) % centros.length]
      expect(a.x * b.x + a.y * b.y + a.z * b.z).toBeCloseTo(0, 1)
    }
  })
})

describe('continuidad entre caras (la razón de generar desde la dirección)', () => {
  it('la arista compartida px/nz da el mismo color desde las dos caras', () => {
    // px con sc = +1 mira a z = -1; nz con sc = -1 mira a x = +1. Es la
    // misma arista del cubo, recorrida por las dos caras.
    const n = 64
    let peor = 0
    for (let y = 0; y < n; y++) {
      const a = color(dir('px', n - 1, y, n), SIN_ESTRELLAS)
      const b = color(dir('nz', 0, y, n), SIN_ESTRELLAS)
      peor = Math.max(peor, Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
    }
    // Los dos texels no son la MISMA dirección: están a medio texel de la
    // arista cada uno, o sea separados ~1/n. Con el cielo siendo continuo en
    // la dirección, la diferencia de color tiene que ser de ese orden.
    // Medido: 0.0054. El umbral deja margen sin volverse decorativo.
    expect(peor).toBeLessThan(0.008)
  })

  it('la arista compartida px/py da el mismo color desde las dos caras', () => {
    // Arista x=+1, y=+1. En px es la fila 0; en py es la columna sc = +1.
    const n = 64
    let peor = 0
    for (let i = 0; i < n; i++) {
      const a = color(dir('px', i, 0, n), SIN_ESTRELLAS)
      // px fila 0, columna i -> z = -sc(i). py necesita z = tc = -sc_px(i).
      const b = color(dir('py', n - 1, n - 1 - i, n), SIN_ESTRELLAS)
      peor = Math.max(peor, Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
    }
    expect(peor).toBeLessThan(0.01)
  })

  it('la tolerancia de la costura es exigente contra lo que varía el cielo', () => {
    // Control del test de arriba: un umbral de continuidad no dice nada si
    // el cielo entero cabe adentro de él. Se comparan las DOS aristas
    // opuestas de la misma cara -- direcciones separadas 90 grados, o sea
    // el peor caso real -- y la diferencia tiene que ser de otro orden.
    // Medido: 0.0439 contra 0.0054 de la costura, 8.1x. Sin este margen el
    // test de la arista pasaría incluso con la convención de caras
    // equivocada, que es exactamente lo que existe para cazar.
    const n = 64
    let peor = 0
    for (let y = 0; y < n; y++) {
      const a = color(dir('px', n - 1, y, n), SIN_ESTRELLAS)
      const b = color(dir('px', 0, y, n), SIN_ESTRELLAS)
      peor = Math.max(peor, Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
    }
    expect(peor).toBeGreaterThan(0.03)
  })
})

describe('ruido', () => {
  it('el ruido de gradiente vale ~0 en los puntos de la grilla', () => {
    // Propiedad definitoria del ruido de Perlin: en un punto de la grilla
    // todos los aportes son gradiente . 0 = 0. Si esto falla, el "ruido de
    // gradiente" en realidad es ruido de valor.
    for (let i = -3; i <= 3; i++) {
      expect(Math.abs(ruidoGradiente(i, i * 2, -i, 123))).toBeLessThan(1e-9)
    }
  })

  it('es continuo: pasos chicos dan cambios chicos', () => {
    let peor = 0
    let previo = ruidoGradiente(0, 0.3, 1.7, 7)
    for (let i = 1; i <= 2000; i++) {
      const n = ruidoGradiente(i * 0.001, 0.3, 1.7, 7)
      peor = Math.max(peor, Math.abs(n - previo))
      previo = n
    }
    expect(peor).toBeLessThan(0.02)
  })

  it('fbm se mantiene acotado', () => {
    for (let i = 0; i < 500; i++) {
      const n = fbm(i * 0.37, i * 0.11, i * 0.73, 42, 5)
      expect(n).toBeGreaterThan(-1.2)
      expect(n).toBeLessThan(1.2)
    }
  })

  it('es determinista y la semilla lo cambia', () => {
    expect(ruidoGradiente(1.3, 2.7, 0.4, 1)).toBe(ruidoGradiente(1.3, 2.7, 0.4, 1))
    expect(ruidoGradiente(1.3, 2.7, 0.4, 1)).not.toBe(ruidoGradiente(1.3, 2.7, 0.4, 2))
  })
})

describe('color', () => {
  it('sRGB y lineal son inversas', () => {
    for (const v of [0, 0.002, 0.04, 0.2, 0.5, 0.9, 1]) {
      expect(srgbALineal(linealASrgb(v))).toBeCloseTo(v, 6)
    }
  })
})

describe('presupuesto de legibilidad', () => {
  // Muestreo denso de direcciones sobre la esfera con la espiral de
  // Fibonacci: reparte parejo por ángulo sólido, a diferencia de un
  // lat/long que amontona en los polos.
  function direccionesFibonacci(n: number): Vec3[] {
    const salida: Vec3[] = []
    const phi = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2
      const radio = Math.sqrt(Math.max(0, 1 - y * y))
      const theta = phi * i
      salida.push({ x: Math.cos(theta) * radio, y, z: Math.sin(theta) * radio })
    }
    return salida
  }

  it('ninguna dirección del cielo baja del piso de luminancia', () => {
    // El requisito de jugabilidad, medido directamente: una silueta oscura
    // (~0.10 sRGB) tiene que recortarse contra CUALQUIER parte del cielo.
    let min = 1
    for (const v of direccionesFibonacci(20000)) {
      const c = color(v, PARAMS_POR_DEFECTO)
      const l = luminanciaSrgb(linealASrgb(c.r), linealASrgb(c.g), linealASrgb(c.b))
      min = Math.min(min, l)
    }
    expect(min).toBeGreaterThanOrEqual(LUMINANCIA_PISO)
  })

  it('ninguna capa puede restar por debajo del degradado base', () => {
    // Propiedad ESTRUCTURAL, y la razón de que el piso no necesite un clamp:
    // nebulosa y estrellas sólo SUMAN, y el polvo sólo atenúa el aporte de
    // la nebulosa. El color final nunca puede quedar por debajo del
    // degradado base.
    //
    // El degradado se recalcula acá, a mano, a partir de la paleta, en vez
    // de pedírselo a colorDelCielo con intensidadNebulosa = 0. Esa primera
    // versión del test era circular: una capa que RESTE del total (el bug
    // que este test existe para cazar) se aplica igual con la nebulosa
    // apagada, así que bajaba los dos lados de la comparación por igual y
    // pasaba. Un oráculo independiente es lo único que detecta eso.
    const p = PARAMS_POR_DEFECTO.paleta
    for (const v of direccionesFibonacci(3000)) {
      const t = Math.pow(Math.abs(v.y), 0.85)
      const destino = v.y >= 0 ? p.cenit : p.nadir
      // Misma forma de lerp que el generador -- (1-t)*a + t*b -- porque la
      // otra no es exacta en t = 1 y hacía fallar este test en el cenit por
      // 3.6e-6 sin que hubiera ningún bug real. Ver `interpolar`.
      const baseR = (1 - t) * p.horizonte.r + t * destino.r
      const baseG = (1 - t) * p.horizonte.g + t * destino.g
      const baseB = (1 - t) * p.horizonte.b + t * destino.b

      const c = color(v, PARAMS_POR_DEFECTO)
      expect(c.r).toBeGreaterThanOrEqual(baseR - 1e-12)
      expect(c.g).toBeGreaterThanOrEqual(baseG - 1e-12)
      expect(c.b).toBeGreaterThanOrEqual(baseB - 1e-12)
    }
  })

  it('el cielo sin estrellas no pasa el techo de luminancia', () => {
    let max = 0
    for (const v of direccionesFibonacci(20000)) {
      const c = color(v, SIN_ESTRELLAS)
      const l = luminanciaSrgb(linealASrgb(c.r), linealASrgb(c.g), linealASrgb(c.b))
      max = Math.max(max, l)
    }
    expect(max).toBeLessThanOrEqual(LUMINANCIA_TECHO)
  })
})

describe('analizarLegibilidad', () => {
  function caraPlana(tamano: number, valor: number): Uint8Array {
    const rgba = new Uint8Array(tamano * tamano * 4)
    for (let i = 0; i < tamano * tamano; i++) {
      rgba[i * 4] = valor
      rgba[i * 4 + 1] = valor
      rgba[i * 4 + 2] = valor
      rgba[i * 4 + 3] = 255
    }
    return rgba
  }

  it('un cielo plano tiene contraste local cero', () => {
    const caras = new Map<Cara, Uint8Array>([['px', caraPlana(64, 128)]])
    const a = analizarLegibilidad(caras, 64)
    expect(a.contrasteLocalP999).toBeCloseTo(0, 6)
    expect(a.luminanciaMin).toBeCloseTo(128 / 255, 3)
  })

  it('un damero a la escala de la silueta dispara el contraste local', () => {
    // Control positivo: la métrica tiene que DETECTAR el caso malo, no sólo
    // dar bajo en el caso bueno.
    const n = 64
    const rgba = new Uint8Array(n * n * 4)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        // Bloques de 8 texels: dentro de la ventana de silueta (que a n=64
        // es 4, pero el patrón varía a una escala comparable).
        const v = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 20 : 230
        const i = (y * n + x) * 4
        rgba[i] = v
        rgba[i + 1] = v
        rgba[i + 2] = v
        rgba[i + 3] = 255
      }
    }
    const a = analizarLegibilidad(new Map<Cara, Uint8Array>([['px', rgba]]), n)
    expect(a.contrasteLocalP999).toBeGreaterThan(0.3)
  })

  it('estrellas sueltas NO cuentan como contraste local', () => {
    // El control que obligó a rediseñar la métrica. La versión con
    // desviación estándar de la ventana daba ~0.1 con este input -- o sea
    // disparaba el gate por unos puntos de 1 texel que no le compiten a
    // ninguna silueta. La métrica pasa-banda tiene que ignorarlos.
    const n = 256
    const rgba = new Uint8Array(n * n * 4)
    for (let i = 0; i < n * n; i++) {
      rgba[i * 4] = 60
      rgba[i * 4 + 1] = 60
      rgba[i * 4 + 2] = 60
      rgba[i * 4 + 3] = 255
    }
    // Estrellas de 1 texel, blancas, repartidas parejo. 1 cada 1200 texels
    // es del orden de la densidad real del asset (0.12% de texels con
    // estrella, que reporta el propio generador).
    for (let i = 0; i < n * n; i += 1200) {
      rgba[i * 4] = 255
      rgba[i * 4 + 1] = 255
      rgba[i * 4 + 2] = 255
    }
    const a = analizarLegibilidad(new Map<Cara, Uint8Array>([['px', rgba]]), n)
    expect(a.contrasteLocalP999).toBeLessThan(0.02)
  })

  it('un degradado suave y grande NO cuenta como contraste local', () => {
    // La distinción que justifica la métrica: rango global alto, variación
    // local baja. Un degradado de horizonte a cenit tiene que pasar.
    const n = 256
    const rgba = new Uint8Array(n * n * 4)
    for (let y = 0; y < n; y++) {
      const v = Math.round((y / (n - 1)) * 255)
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4
        rgba[i] = v
        rgba[i + 1] = v
        rgba[i + 2] = v
        rgba[i + 3] = 255
      }
    }
    const a = analizarLegibilidad(new Map<Cara, Uint8Array>([['px', rgba]]), n)
    // Rango global completo...
    expect(a.luminanciaMin).toBeLessThan(0.01)
    expect(a.luminanciaP999).toBeGreaterThan(0.98)
    // ...pero variación despreciable a la escala de una silueta.
    expect(a.contrasteLocalP999).toBeLessThan(0.02)
  })
})

describe('hornearCara', () => {
  it('es determinista', () => {
    const a = hornearCara('px', 32, PARAMS_POR_DEFECTO)
    const b = hornearCara('px', 32, PARAMS_POR_DEFECTO)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('otra semilla da otro cielo', () => {
    const a = hornearCara('px', 32, PARAMS_POR_DEFECTO)
    const b = hornearCara('px', 32, { ...PARAMS_POR_DEFECTO, semilla: 12345 })
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('deja el alfa opaco y ningún canal fuera de rango', () => {
    const rgba = hornearCara('py', 32, PARAMS_POR_DEFECTO)
    expect(rgba.length).toBe(32 * 32 * 4)
    for (let i = 0; i < 32 * 32; i++) {
      expect(rgba[i * 4 + 3]).toBe(255)
    }
  })
})
