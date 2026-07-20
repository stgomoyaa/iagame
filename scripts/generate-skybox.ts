/**
 * Hornea el skybox procedural "galaxia púrpura" a un cubemap de 6 PNG que
 * Three.js carga con CubeTextureLoader.
 *
 * Uso:
 *   node scripts/generate-skybox.ts
 *   node scripts/generate-skybox.ts --tamano 512 --semilla 7 --salida /tmp/cielo
 *   node scripts/generate-skybox.ts --hoja        # + contact sheet para mirar
 *
 * El asset NO está commiteado: se regenera con este script en segundos y es
 * 100% nuestro (ver docs/SKYBOX.md). Cambiar `--semilla` da otra galaxia con
 * la misma paleta; cambiar la paleta en scripts/lib/skybox.ts da la misma
 * galaxia en otro color.
 */

// Extensión explícita: Node resuelve ESM nativo y la exige (mismo caso que
// scripts/lib/cli-args.ts).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodePng } from './lib/png-writer.ts'
import {
  analizarLegibilidad,
  CARAS,
  CROMA_ESTRUCTURA_PISO,
  hornearCara,
  LUMINANCIA_PISO,
  LUMINANCIA_TECHO,
  maxLuminanciaSinEstrellas,
  PARAMS_POR_DEFECTO,
  VENTANA_SILUETA_TEXELS,
  type Cara,
  type ParamsCielo,
} from './lib/skybox.ts'

const SALIDA_POR_DEFECTO = 'public/assets/skybox/galaxia-purpura'

interface Opciones {
  tamano: number
  salida: string
  semilla: number
  hoja: boolean
}

export function parsearOpciones(argv: readonly string[]): Opciones {
  const opciones: Opciones = {
    tamano: 1024,
    salida: SALIDA_POR_DEFECTO,
    semilla: PARAMS_POR_DEFECTO.semilla,
    hoja: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--hoja') {
      opciones.hoja = true
      continue
    }
    const valor = argv[i + 1]
    if (valor === undefined || valor.startsWith('--')) {
      throw new Error(`${arg} necesita un valor`)
    }
    i++
    switch (arg) {
      case '--tamano': {
        const n = Number(valor)
        // Potencia de dos: sin eso el driver no puede generar la cadena de
        // mips completa de un cubemap y Three cae a NEAREST, que convierte
        // cada estrella en un cuadrado que titila al girar la cámara.
        if (!Number.isInteger(n) || n < 16 || (n & (n - 1)) !== 0) {
          throw new Error(`--tamano tiene que ser una potencia de dos >= 16, no "${valor}"`)
        }
        opciones.tamano = n
        break
      }
      case '--salida':
        opciones.salida = valor
        break
      case '--semilla': {
        const n = Number(valor)
        if (!Number.isFinite(n)) throw new Error(`--semilla inválida: "${valor}"`)
        opciones.semilla = n >>> 0
        break
      }
      default:
        throw new Error(`flag desconocido: ${arg}`)
    }
  }

  return opciones
}

/**
 * Contact sheet en cruz desplegada: las 6 caras en una sola imagen, con la
 * disposición del cubo abierto. Sirve para MIRAR el resultado sin levantar
 * un navegador -- que es la mitad del trabajo cuando el objetivo es visual.
 */
function hojaDeContacto(caras: ReadonlyMap<Cara, Uint8Array>, tamano: number): Buffer {
  //        [py]
 //  [nx] [pz] [px] [nz]
  //        [ny]
  const columnas = 4
  const filas = 3
  const ancho = tamano * columnas
  const alto = tamano * filas
  const salida = new Uint8Array(ancho * alto * 4)

  const posicion: Record<Cara, [number, number]> = {
    py: [1, 0],
    nx: [0, 1],
    pz: [1, 1],
    px: [2, 1],
    nz: [3, 1],
    ny: [1, 2],
  }

  for (const [cara, rgba] of caras) {
    const [cx, cy] = posicion[cara]
    for (let y = 0; y < tamano; y++) {
      const destino = ((cy * tamano + y) * ancho + cx * tamano) * 4
      salida.set(rgba.subarray(y * tamano * 4, (y + 1) * tamano * 4), destino)
    }
  }

  return encodePng(ancho, alto, salida)
}

function main(): void {
  const opciones = parsearOpciones(process.argv.slice(2))
  const params: ParamsCielo = { ...PARAMS_POR_DEFECTO, semilla: opciones.semilla }

  mkdirSync(opciones.salida, { recursive: true })

  const caras = new Map<Cara, Uint8Array>()
  const arranque = Date.now()
  for (const cara of CARAS) {
    const t0 = Date.now()
    const rgba = hornearCara(cara, opciones.tamano, params)
    caras.set(cara, rgba)
    const png = encodePng(opciones.tamano, opciones.tamano, rgba)
    const ruta = join(opciones.salida, `${cara}.png`)
    writeFileSync(ruta, png)
    console.log(`  ${cara}.png  ${(png.length / 1024).toFixed(0)} KB  (${Date.now() - t0} ms)`)
  }
  console.log(`horneado en ${((Date.now() - arranque) / 1000).toFixed(1)} s`)

  if (opciones.hoja) {
    const ruta = join(opciones.salida, 'hoja-contacto.png')
    writeFileSync(ruta, hojaDeContacto(caras, opciones.tamano))
    console.log(`  hoja-contacto.png (cruz desplegada, sólo para revisar)`)
  }

  // --- presupuesto de legibilidad ------------------------------------------
  const a = analizarLegibilidad(caras, opciones.tamano)
  const ventana = Math.max(4, Math.round((VENTANA_SILUETA_TEXELS * opciones.tamano) / 1024))
  console.log('')
  console.log('legibilidad (luminancia Rec.709 sobre sRGB codificado)')
  const maxSinEstrellas = maxLuminanciaSinEstrellas(params)
  console.log(`  mínima              ${a.luminanciaMin.toFixed(3)}  (piso ${LUMINANCIA_PISO})`)
  console.log(`  media               ${a.luminanciaMedia.toFixed(3)}`)
  console.log(`  máxima sin estrellas ${maxSinEstrellas.toFixed(3)}  (techo ${LUMINANCIA_TECHO})`)
  console.log(`  p99.9 (con estrellas) ${a.luminanciaP999.toFixed(3)}  -- no se controla: son puntos`)
  console.log(`  contraste local p99.9 ${a.contrasteLocalP999.toFixed(4)}  (ventana ${ventana} texels)`)
  console.log(`  contraste local medio ${a.contrasteLocalMedio.toFixed(4)}`)
  console.log(
    `  contraste croma p99.9  ${a.contrasteCromaP999.toFixed(4)}  (piso ${CROMA_ESTRUCTURA_PISO})`,
  )
  console.log(`  texels de estrella    ${(a.fraccionEstrellas * 100).toFixed(3)}%`)

  const problemas: string[] = []
  if (a.luminanciaMin < LUMINANCIA_PISO) {
    problemas.push(
      `luminancia mínima ${a.luminanciaMin.toFixed(3)} por debajo del piso ${LUMINANCIA_PISO}: ` +
        'una silueta oscura se pierde contra esa zona del cielo',
    )
  }
  if (maxSinEstrellas > LUMINANCIA_TECHO) {
    problemas.push(
      `luminancia máxima sin estrellas ${maxSinEstrellas.toFixed(3)} por encima del techo ` +
        `${LUMINANCIA_TECHO}: el cielo deja de leerse como noche y le come contraste a los ` +
        'colores de equipo claros',
    )
  }
  if (a.contrasteCromaP999 < CROMA_ESTRUCTURA_PISO) {
    problemas.push(
      `contraste cromático p99.9 ${a.contrasteCromaP999.toFixed(4)} por debajo del piso ` +
        `${CROMA_ESTRUCTURA_PISO}: el cielo no tiene estructura de color a escala de silueta, ` +
        'o sea que volvió a ser un degradado plano',
    )
  }
  if (a.contrasteLocalP999 > 0.05) {
    problemas.push(
      `contraste local p99.9 ${a.contrasteLocalP999.toFixed(4)} > 0.05: hay estructura del ` +
        'tamaño de un enemigo compitiendo con la silueta',
    )
  }
  if (problemas.length > 0) {
    console.error('')
    for (const p of problemas) console.error(`FALLA: ${p}`)
    process.exitCode = 1
  } else {
    console.log('')
    console.log('OK: el cielo cumple el presupuesto de legibilidad.')
  }
}

// Sólo corre como script, no cuando el test importa parsearOpciones.
if (process.argv[1]?.endsWith('generate-skybox.ts')) main()
