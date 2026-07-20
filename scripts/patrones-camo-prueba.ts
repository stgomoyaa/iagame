/**
 * Genera los patrones de camuflaje de PRUEBA en escala de grises.
 *
 *     node scripts/patrones-camo-prueba.ts [dir_salida] [--size 512]
 *
 * POR QUÉ EXISTEN, SI LA IDEA ES QUE LOS GENERE UN GENERADOR DE IMÁGENES
 *
 * La vía por textura (src/game/skins/texturas.ts) está pensada para consumir
 * PNG de un generador de imágenes, y el dueño va a producirlos en otra
 * instancia con la hoja de docs/PROMPTS-CAMOS.md. Pero probar el motor CONTRA
 * las imágenes definitivas es el orden equivocado: si la vía no funciona, se
 * descubre después de haber generado cincuenta. Estos tres patrones existen
 * para recorrer la vía entera antes de que exista una sola imagen generada, y
 * cubren los tres casos que se leen distinto sobre el arma:
 *
 *   1. vetas  — orgánico, filamentos finos sobre fondo oscuro. Es el caso
 *      Element 115: el motor le pone la emisión y las vetas se encienden.
 *   2. celdas — geométrico duro, bordes rectos y contraste alto. Es el que
 *      delata cualquier estiramiento de la proyección: una recta doblada se
 *      ve, una mancha deformada no.
 *   3. nube   — ruido suave sin estructura. Es el piso: si acá el resultado
 *      se ve plano, el problema es de la vía y no del patrón.
 *
 * Y un cuarto que NO es un patrón sino un CONTROL:
 *
 *   4. control-costura — el mismo campo de "vetas" recortado fuera de su
 *      periodo. Tiene que FALLAR la verificación de teselado. Está para que
 *      la herramienta de medición se pueda demostrar sobre un archivo real y
 *      no sólo sobre un array en un test: una verificación que nunca vio un
 *      caso negativo no es una verificación.
 *
 * Los tres primeros se construyen con ruido PERIÓDICO (scripts/lib/
 * tileable-noise.ts), así que teselan por construcción. Eso es deliberado:
 * separa "la vía por textura funciona" de "esta imagen en particular tesela",
 * que son dos preguntas distintas y fallan por motivos distintos.
 *
 * Salida: PNG de 8 bits de UN canal (gris de verdad, no RGB con los tres
 * canales iguales). Importa para el peso, que es el argumento entero de esta
 * vía: un canal pesa la cuarta parte que RGBA, y el catálogo se mide en lo
 * que el jugador descarga.
 *
 * Como el skybox (docs/SKYBOX.md), la salida es determinista y NO se
 * commitea: es la consecuencia de un script que sí está versionado.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodePngRaw } from './lib/png-writer.ts'
import { clamp01, fbmP, ridgedP, smoothstep } from './lib/tileable-noise.ts'

const SALIDA_POR_DEFECTO = 'public/assets/camos'
const LADO_POR_DEFECTO = 512

/**
 * Campo de un patrón: de (u,v) en [0,1) a nivel de gris en 0..1.
 *
 * Trabajan sobre u,v normalizados y no sobre píxeles para que la resolución
 * de salida no cambie el dibujo: la misma función a 512 y a 1024 da la misma
 * imagen con más detalle, no otra imagen.
 */
type Campo = (u: number, v: number) => number

/**
 * VETAS. Las curvas de nivel del ruido ridged dan filamentos de ancho
 * controlado, que es lo que es una veta. La alternativa obvia —umbralizar el
 * ruido entre dos valores— da manchas gordas, porque el campo pasa mucho
 * tiempo dentro del rango. Es el mismo hallazgo que ya está documentado en la
 * filigrana del shader (src/game/skins/material.ts).
 *
 * Fondo casi negro y vetas casi blancas: en escala de grises el CLARO es lo
 * que el motor va a encender, así que el dibujo tiene que decidir dónde va la
 * luz. Ver docs/PROMPTS-CAMOS.md.
 */
const vetas: Campo = (u, v) => {
  const warp = (fbmP(u, v, 3, 3, 91) - 0.5) * 0.35
  const r = ridgedP(u + warp, v - warp, 5, 4, 17)
  // Dos curvas de nivel a distinta altura: una red principal y una secundaria
  // más tenue, que es lo que hace que se lea como un sistema de vetas y no
  // como un alambre suelto.
  const principal = smoothstep(0.055, 0.012, Math.abs(r - 0.74))
  const fina = smoothstep(0.03, 0.008, Math.abs(r - 0.52)) * 0.55
  const fondo = 0.06 + 0.1 * fbmP(u, v, 7, 3, 55)
  return clamp01(Math.max(fondo, Math.max(principal, fina)))
}

/**
 * CELDAS. Retícula hexagonal con bordes duros.
 *
 * Hexágonos y no cuadrados porque una grilla cuadrada alineada con los ejes
 * del objeto se lee como error de render sobre un arma: las líneas coinciden
 * con las aristas de la geometría. El hexágono no tiene ninguna dirección
 * privilegiada que pueda alinearse.
 *
 * El teselado hexagonal cierra en un rectángulo sólo con la proporción
 * correcta, así que la coordenada v se estira por sqrt(3) y el patrón se
 * repite un número ENTERO de veces en cada eje. Cualquier otra cosa mete una
 * costura que no viene del ruido sino de la geometría del mosaico.
 */
const celdas: Campo = (u, v) => {
  // COLUMNAS y PERIODOS son los dos números que hacen que esto cierre, y no
  // se pueden elegir sueltos.
  //
  // La retícula hexagonal tiene periodo 1 en x (una columna) y 1.5 en y (una
  // fila de cada sub-retícula), así que el dominio muestreado tiene que medir
  // un número ENTERO de columnas por un múltiplo entero de 1.5. Cualquier
  // otra proporción corta la última fila de hexágonos por la mitad y deja una
  // costura horizontal — que es exactamente lo que midió
  // scripts/verificar-teselado.ts en la primera versión de este patrón
  // (razónV 25.3 contra un umbral de 1.8), con `y = v * N * 2/sqrt(3)`, que
  // no es múltiplo de 1.5 para ningún N entero.
  //
  // Para que además el hexágono salga regular y no aplastado, la relación
  // entre los dos sale de igualar los píxeles por unidad en los dos ejes
  // contra el factor sqrt(3)/2 de la métrica: COLUMNAS ~ 1.732 * PERIODOS.
  // Con 4 periodos da 6.93, y 7 es el entero de al lado.
  const COLUMNAS = 7
  const PERIODOS = 4
  const ALTO = 1.5 * PERIODOS

  const x = u * COLUMNAS
  const y = v * ALTO

  // Hexágonos como unión de dos retículas rómbicas desfasadas: se prueba el
  // centro más cercano de cada una y gana el que esté más cerca.
  const cerca = (ox: number, oy: number): { d: number; cx: number; cy: number } => {
    const cy = Math.round((y - oy) / 1.5) * 1.5 + oy
    const cx = Math.round(x - ox) + ox
    const dx = Math.abs(x - cx)
    const dy = Math.abs(y - cy) * (Math.sqrt(3) / 2)
    // Distancia HEXAGONAL, no euclidiana. Con `hypot` las celdas salen
    // redondas y el patrón se lee como un pavé de piedras: bonito, pero
    // inútil para lo que este patrón tiene que probar. Un hexágono tiene
    // ARISTAS RECTAS, y una recta es lo único que delata a simple vista que
    // la proyección sobre el arma estira o dobla el patrón — una mancha
    // deformada se ve igual de bien que una mancha sana.
    return { d: Math.max(dx * 0.8660254 + dy * 0.5, dy), cx, cy }
  }
  const a = cerca(0, 0)
  const b = cerca(0.5, 0.75)
  const g = a.d <= b.d ? a : b

  // Índice de celda con módulo sobre el periodo del dominio. Es lo que hace
  // que una celda partida por el borde reciba el MISMO nivel de los dos
  // lados: sin esto la geometría cerraría pero el color no, y la costura
  // seguiría ahí.
  const ci = pmodEntero(Math.round(g.cx * 2), COLUMNAS * 2)
  const cj = pmodEntero(Math.round(g.cy / 0.75), PERIODOS * 2)
  const nivel = 0.42 + 0.5 * hashCelda(ci, cj)

  // Borde duro: la junta entre placas. Es lo que hace geométrico al patrón.
  const junta = smoothstep(0.40, 0.455, g.d)
  // Chaflán interior: la placa no es plana, tiene un bisel hacia la junta.
  const bisel = smoothstep(0.28, 0.40, g.d)
  return clamp01(nivel * (1 - 0.45 * bisel) * (1 - junta) + junta * 0.08)
}

/** Módulo siempre positivo sobre enteros. */
function pmodEntero(a: number, n: number): number {
  return ((a % n) + n) % n
}

/** Hash estable de celda -> [0,1). Determinista y sin estado. */
function hashCelda(i: number, j: number): number {
  const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/**
 * NUBE. fBm puro con bastantes octavas.
 *
 * No lleva ningún truco a propósito: es el control de que la vía por textura
 * agrega algo por sí sola. Si un fBm gris con paleta, emisión y animación del
 * motor se ve bien sobre el arma, la vía funciona; si se ve plano, ninguna
 * imagen generada la va a salvar.
 */
const nube: Campo = (u, v) => {
  const base = fbmP(u, v, 4, 6, 203)
  // Estiramiento suave del rango: el fBm crudo se apiña alrededor de 0.5 y
  // deja un patrón sin negros ni blancos, que sobre el arma es un gris plano.
  return clamp01((base - 0.5) * 1.9 + 0.5)
}

interface Patron {
  id: string
  campo: Campo
  /** Ventana del dominio que se muestrea. (0,0,1,1) cierra; otra cosa NO. */
  ventana: readonly [number, number, number, number]
  nota: string
}

const PATRONES: readonly Patron[] = [
  { id: 'vetas', campo: vetas, ventana: [0, 0, 1, 1], nota: 'orgánico, filamentos' },
  { id: 'celdas', campo: celdas, ventana: [0, 0, 1, 1], nota: 'geométrico duro' },
  { id: 'nube', campo: nube, ventana: [0, 0, 1, 1], nota: 'ruido suave' },
  {
    id: 'control-costura',
    campo: vetas,
    // Ventana interior: los bordes caen en fases distintas del periodo del
    // ruido, así que la imagen NO cierra. Tiene que fallar la verificación.
    ventana: [0.17, 0.23, 0.61, 0.58],
    nota: 'CONTROL: tiene que fallar el teselado',
  },
]

function render(p: Patron, lado: number): Uint8Array {
  const [u0, v0, du, dv] = p.ventana
  const px = new Uint8Array(lado * lado)
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const u = u0 + (x / lado) * du
      const v = v0 + (y / lado) * dv
      px[y * lado + x] = Math.round(clamp01(p.campo(u, v)) * 255)
    }
  }
  return px
}

function main(): void {
  const args = process.argv.slice(2)
  const dir = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? SALIDA_POR_DEFECTO
  const iSize = args.indexOf('--size')
  const lado = iSize >= 0 && args[iSize + 1] ? Number(args[iSize + 1]) : LADO_POR_DEFECTO
  if (!Number.isInteger(lado) || lado < 16) {
    throw new Error(`--size tiene que ser un entero >= 16, llegó "${args[iSize + 1]}"`)
  }

  mkdirSync(dir, { recursive: true })
  console.log(`patrones de prueba -> ${dir}  (${lado}x${lado}, gris de 8 bits)`)

  for (const p of PATRONES) {
    const data = render(p, lado)
    // channels: 1 -> COLOR_TYPE_GRAY. Un canal, no RGBA con los tres iguales:
    // es la diferencia entre 60 kB y 240 kB por patrón.
    const png = encodePngRaw({ width: lado, height: lado, data, channels: 1 })
    const ruta = join(dir, `${p.id}.png`)
    writeFileSync(ruta, png)
    console.log(`  ${p.id.padEnd(16)} ${String(png.length).padStart(7)} bytes   ${p.nota}`)
  }

  console.log('\nverificá el teselado:  node scripts/verificar-teselado.ts ' + dir + '/*.png')
}

main()
