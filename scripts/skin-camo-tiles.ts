/**
 * Genera las teselas de camuflaje para el sistema de skins, su metadata y la
 * hoja de contactos.
 *
 *     node scripts/skin-camo-tiles.ts [dir_salida] [--size 512] [--seed 7]
 *
 * NO integra nada al motor: escribe archivos y nada más. La integración
 * (mapear cada familia a un patrón del shader, o subir las teselas como
 * textura) es otra tarea; acá se prepara el material y se demuestra que
 * sirve.
 *
 * Lo que produce:
 *   teselas/     la tesela suelta de cada familia
 *   teselado/    la misma repetida 3x3 a resolución completa -> es DONDE SE
 *                MIRA si hay costura o repetición obvia. Una tesela puede
 *                verse impecable suelta y mostrar un enrejado evidente al
 *                repetirse; juzgar por el cuadrado suelto es el error clásico.
 *   emisivo/     máscara de qué parte de cada familia debería brillar en las
 *                rarezas altas (el emisivo es lo que separa una legendaria de
 *                una rara, no el dibujo).
 *   contactos.png  todas las familias teseladas, rotuladas, de un vistazo.
 *   camo-tiles.json  metadata: familia, referencia, rareza, animación.
 *
 * Y verifica: cada tesela pasa por una medición de costura, y la medición se
 * valida contra un control roto a propósito (ver `verificarCostura`).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cebra,
  damasco,
  filigrana,
  follaje,
  gema,
  multicam,
} from './lib/camo-families.ts'
import { encodePng } from './lib/png-writer.ts'
import { clamp01, noise2p, pmod, WrapCanvas } from './lib/tileable-noise.ts'
import { drawText, GLYPH_H } from './lib/tiny-font.ts'

/* ------------------------------------------------------------------ *
 * Catálogo: quién es cada familia dentro del sistema de rarezas.
 * ------------------------------------------------------------------ */

interface Familia {
  id: string
  etiqueta: string
  referencia: string
  render: (size: number, seed: number) => WrapCanvas
  /** Tier del sistema (src/game/skins/rarity.ts). */
  rareza: string
  /** Una de las cuatro ya implementadas en el shader. */
  animacion: 'ninguna' | 'pulso' | 'flujo' | 'espectro'
  /** Patrón existente cuyo rol ocupa (patterns.ts). */
  patron: string
  porQue: string
  /** De qué parte de la tesela sale la máscara de emisivo. */
  emisivo: (r: number, g: number, b: number) => number
}

const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

const FAMILIAS: readonly Familia[] = [
  {
    id: 'multicam',
    etiqueta: 'MULTICAM',
    referencia: '3dae4f638fdb41344c58de8249f560e5.jpg',
    render: multicam,
    rareza: 'comun/raro',
    animacion: 'ninguna',
    patron: 'camo',
    porQue:
      'Mate por definición: es ropa de dotación. Si brillara dejaría de leerse como camuflaje. Cubre el piso de la escalera, donde la rareza se nota por la AUSENCIA de efecto.',
    // Sin emisivo por diseño; la máscara queda en cero y sirve de control.
    emisivo: () => 0,
  },
  {
    id: 'follaje',
    etiqueta: 'FOLLAJE',
    referencia: 'Hidden_Camouflage_12_CoDG.webp',
    render: follaje,
    rareza: 'raro',
    animacion: 'ninguna',
    patron: 'camo',
    porQue:
      'Orgánico y denso, con silueta reconocible: sube un escalón sobre multicam por complejidad de dibujo, no por brillo. Raro es el último tier con emisivo 0.',
    emisivo: () => 0,
  },
  {
    id: 'filigrana',
    etiqueta: 'FILIGRANA',
    referencia: 'images-2.jpeg',
    render: filigrana,
    rareza: 'epico',
    animacion: 'pulso',
    patron: 'hidrografico',
    porQue:
      'Primer tier con emisivo. El oro es el candidato natural: ya lee como metal precioso, y el pulso lo hace respirar sin moverlo de lugar. Un ornamento que se DESPLAZA se ve roto; uno que late, se ve caro.',
    // Sólo el oro emite; el fondo de gunmetal se queda apagado.
    emisivo: (r, g, b) => clamp01(((r + g) * 0.5 - b) * 2.6) * clamp01(lum(r, g, b) * 1.7),
  },
  {
    id: 'gema',
    etiqueta: 'GEMA',
    referencia: 'Plague_Diamond_Camo_Icon_BOCW.webp',
    render: gema,
    rareza: 'legendario',
    animacion: 'pulso',
    patron: 'astillas',
    porQue:
      'Las facetas ya tienen brillo propio distinto por cara; el pulso las hace destellar. Flujo estaría mal acá: la retícula de gemas es fija, si el patrón se desplazara las piedras se verían patinando sobre el arma.',
    // Emiten las facetas claras, no las grietas ni el fondo violeta.
    emisivo: (r, g, b) => clamp01((lum(r, g, b) - 0.42) * 2.4),
  },
  {
    id: 'damasco',
    etiqueta: 'DAMASCO',
    referencia: 'Damascus_Menu_Icon_MW.PNG.webp + images.jpeg',
    render: damasco,
    rareza: 'legendario',
    animacion: 'flujo',
    patron: 'hidrografico',
    porQue:
      'Es la única familia cuyo dibujo SUGIERE movimiento parado: son curvas de nivel de un remolino. Flujo (desplazamiento del patrón) completa lo que el dibujo ya insinúa, y es exactamente el efecto del Damascus original.',
    // Emiten las líneas magenta y el relleno naranja, no el campo teal.
    emisivo: (r, g, b) => clamp01((r - Math.max(g, b) * 0.85) * 2.2),
  },
  {
    id: 'cebra',
    etiqueta: 'CEBRA ARCOIRIS',
    referencia: 'Spectrum_Camouflage_CoDG.webp',
    render: cebra,
    rareza: 'exotico',
    animacion: 'espectro',
    patron: 'bandas',
    porQue:
      'Espectro (ciclo de tono) es exclusivo de Exótico y hay uno solo así en todo el sistema. Esta familia ES un barrido de tono: es la única donde ciclar el tono no rompe la paleta sino que ejecuta la idea del patrón.',
    // Emite el color, nunca la franja negra: si emitieran las dos se pierde
    // el contraste que hace legible la cebra.
    emisivo: (r, g, b) => {
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      return clamp01((mx - mn) * 2.0) * clamp01(mx * 1.4)
    },
  },
]

/* ------------------------------------------------------------------ *
 * Verificación de costura.
 * ------------------------------------------------------------------ */

interface Costura {
  horizontal: number
  vertical: number
}

/**
 * Mide si la tesela **realmente** cierra, en vez de confiar en que el código
 * es periódico porque la intención era ésa.
 *
 * Idea: en una tesela periódica, el salto de color entre la última columna y
 * la primera es una muestra más del mismo proceso que el salto entre las dos
 * columnas de al lado. La razón entre uno y otro es ~1.0 si cierra y se
 * dispara si hay costura.
 *
 * La comparación es **local a propósito**: contra las dos columnas vecinas,
 * no contra el promedio de toda la imagen. La primera versión promediaba
 * toda la imagen y reprobaba al damasco (3.06) sin que hubiera costura
 * alguna — con bandas de canto duro, el gradiente interno MEDIO está
 * dominado por el interior liso de las bandas, mientras que una sola columna
 * del borde puede cruzar varios cantos por pura casualidad. O sea: el
 * denominador global medía la lisura del patrón, no su continuidad, y el
 * falso positivo escalaba con lo duro que fuera el canto. Contra las
 * vecinas inmediatas eso desaparece, porque las tres columnas atraviesan las
 * mismas bandas.
 */
function medirCostura(rgba: Uint8ClampedArray, size: number): Costura {
  const px = (x: number, y: number, c: number): number => rgba[(y * size + x) * 4 + c]
  const dif = (ax: number, ay: number, bx: number, by: number): number =>
    Math.abs(px(ax, ay, 0) - px(bx, by, 0)) +
    Math.abs(px(ax, ay, 1) - px(bx, by, 1)) +
    Math.abs(px(ax, ay, 2) - px(bx, by, 2))

  // Gradiente que cruza el borde envolvente.
  let bordeH = 0
  let bordeV = 0
  // Gradientes inmediatamente a los lados de ese mismo borde.
  let vecinoH = 0
  let vecinoV = 0
  for (let y = 0; y < size; y++) {
    bordeH += dif(0, y, size - 1, y)
    vecinoH += dif(1, y, 0, y) + dif(size - 1, y, size - 2, y)
  }
  for (let x = 0; x < size; x++) {
    bordeV += dif(x, 0, x, size - 1)
    vecinoV += dif(x, 1, x, 0) + dif(x, size - 1, x, size - 2)
  }
  bordeH /= size
  bordeV /= size
  vecinoH /= size * 2
  vecinoV /= size * 2

  // Piso en el denominador: un patrón casi liso daría división por ~0.
  return {
    horizontal: bordeH / Math.max(vecinoH, 0.5),
    vertical: bordeV / Math.max(vecinoV, 0.5),
  }
}

/**
 * Control negativo: una tesela hecha con el MISMO ruido pero con el periodo
 * desalineado del borde. Visualmente es indistinguible de una buena, así que
 * es el control correcto — si `medirCostura` la aprobara, la métrica estaría
 * midiendo cualquier otra cosa menos la costura.
 *
 * Este archivo se escribe al disco además de medirse: la métrica dice que hay
 * costura, y la imagen deja verla.
 */
function controlNoPeriodico(size: number, seed: number): WrapCanvas {
  const cv = new WrapCanvas(size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Periodo 997 (primo, >> celdas usadas): el ruido sigue siendo suave y
      // del mismo tipo, pero la celda del borde derecho ya no es la del
      // izquierdo. Es exactamente el bug que se quiere detectar.
      let s = 0
      let amp = 1
      let norm = 0
      let f = 4
      for (let i = 0; i < 4; i++) {
        s += amp * noise2p((x / size) * f, (y / size) * f, 997, seed + i * 1013)
        norm += amp
        amp *= 0.5
        f *= 2
      }
      const v = s / norm
      cv.set(x, y, { r: v, g: v * 0.8 + 0.1, b: 1 - v })
    }
  }
  return cv
}

/* ------------------------------------------------------------------ *
 * Composición de imágenes.
 * ------------------------------------------------------------------ */

/** Repite la tesela n x n a resolución completa. Es la vista que decide. */
function teselar(src: Uint8ClampedArray, size: number, n: number): { rgba: Uint8Array; size: number } {
  const out = new Uint8Array(size * n * size * n * 4)
  const stride = size * n
  for (let y = 0; y < stride; y++) {
    for (let x = 0; x < stride; x++) {
      const si = (pmod(y, size) * size + pmod(x, size)) * 4
      const di = (y * stride + x) * 4
      out[di] = src[si]
      out[di + 1] = src[si + 1]
      out[di + 2] = src[si + 2]
      out[di + 3] = 255
    }
  }
  return { rgba: out, size: stride }
}

/** Box filter. Promediar (y no saltear píxeles) para no inventar aliasing. */
function reducir(src: Uint8Array, srcSize: number, dstSize: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstSize * dstSize * 4)
  const k = srcSize / dstSize
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      const x0 = Math.floor(x * k)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * k))
      const y0 = Math.floor(y * k)
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * k))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcSize + sx) * 4
          r += src[i]
          g += src[i + 1]
          b += src[i + 2]
          n++
        }
      }
      const di = (y * dstSize + x) * 4
      out[di] = r / n
      out[di + 1] = g / n
      out[di + 2] = b / n
      out[di + 3] = 255
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Programa.
 * ------------------------------------------------------------------ */

function main(): void {
  const args = process.argv.slice(2)
  const flag = (name: string, def: number): number => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def
  }
  const outDir = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'skin-tiles'
  const size = flag('size', 512)
  const seed = flag('seed', 7)

  for (const sub of ['teselas', 'teselado', 'emisivo']) {
    mkdirSync(join(outDir, sub), { recursive: true })
  }

  const CELDA = 396 // lado de cada celda de la hoja de contactos
  const ROTULO = 26
  const PAD = 10
  const COLS = 3
  const ROWS = Math.ceil(FAMILIAS.length / COLS)
  const hojaW = COLS * CELDA + (COLS + 1) * PAD
  const hojaH = ROWS * (CELDA + ROTULO) + (ROWS + 1) * PAD
  const hoja = new Uint8ClampedArray(hojaW * hojaH * 4)
  for (let i = 0; i < hojaW * hojaH; i++) {
    hoja[i * 4] = 16
    hoja[i * 4 + 1] = 16
    hoja[i * 4 + 2] = 18
    hoja[i * 4 + 3] = 255
  }

  const meta: unknown[] = []
  let peorCostura = 0

  FAMILIAS.forEach((fam, idx) => {
    const cv = fam.render(size, seed)
    const tile = cv.data

    // --- tesela suelta ---
    const tilePath = join(outDir, 'teselas', `${fam.id}.png`)
    writeFileSync(tilePath, encodePng(size, size, cv.toRgba()))

    // --- costura ---
    const costura = medirCostura(tile, size)
    peorCostura = Math.max(peorCostura, costura.horizontal, costura.vertical)

    // --- teselado 3x3 a resolución completa ---
    const t3 = teselar(tile, size, 3)
    writeFileSync(join(outDir, 'teselado', `${fam.id}-x3.png`), encodePng(t3.size, t3.size, t3.rgba))

    // --- máscara de emisivo ---
    const mask = new Uint8Array(size * size * 4)
    let emisivoMedio = 0
    for (let i = 0; i < size * size; i++) {
      const m = clamp01(fam.emisivo(tile[i * 4] / 255, tile[i * 4 + 1] / 255, tile[i * 4 + 2] / 255))
      emisivoMedio += m
      const v = Math.round(m * 255)
      mask[i * 4] = v
      mask[i * 4 + 1] = v
      mask[i * 4 + 2] = v
      mask[i * 4 + 3] = 255
    }
    emisivoMedio /= size * size
    writeFileSync(join(outDir, 'emisivo', `${fam.id}-emisivo.png`), encodePng(size, size, mask))

    // --- celda de la hoja de contactos ---
    const mini = reducir(t3.rgba, t3.size, CELDA)
    const col = idx % COLS
    const row = Math.floor(idx / COLS)
    const ox = PAD + col * (CELDA + PAD)
    const oy = PAD + row * (CELDA + ROTULO + PAD) + ROTULO
    for (let y = 0; y < CELDA; y++) {
      for (let x = 0; x < CELDA; x++) {
        const si = (y * CELDA + x) * 4
        const di = ((oy + y) * hojaW + ox + x) * 4
        hoja[di] = mini[si]
        hoja[di + 1] = mini[si + 1]
        hoja[di + 2] = mini[si + 2]
        hoja[di + 3] = 255
      }
    }
    drawText(
      hoja,
      hojaW,
      hojaH,
      `${fam.etiqueta} / ${fam.rareza} / ${fam.animacion}`,
      ox,
      oy - ROTULO + 4,
      2,
    )

    meta.push({
      id: fam.id,
      etiqueta: fam.etiqueta,
      origen: 'generado',
      referencia: fam.referencia,
      rareza: fam.rareza,
      animacion: fam.animacion,
      patronDelSistema: fam.patron,
      porQue: fam.porQue,
      archivos: {
        tesela: `teselas/${fam.id}.png`,
        teselado3x3: `teselado/${fam.id}-x3.png`,
        emisivo: `emisivo/${fam.id}-emisivo.png`,
      },
      resolucion: size,
      cobertura_emisiva: Number(emisivoMedio.toFixed(4)),
      costura: {
        horizontal: Number(costura.horizontal.toFixed(3)),
        vertical: Number(costura.vertical.toFixed(3)),
      },
    })

    console.log(
      `${fam.id.padEnd(10)} costura H=${costura.horizontal.toFixed(2)} V=${costura.vertical.toFixed(2)}` +
        `  emisivo=${(emisivoMedio * 100).toFixed(1)}%`,
    )
  })

  writeFileSync(join(outDir, 'contactos.png'), encodePng(hojaW, hojaH, new Uint8Array(hoja.buffer.slice(0))))

  // --- control negativo: la métrica tiene que REPROBAR esto ---
  const ctrl = controlNoPeriodico(size, seed)
  const ctrlCostura = medirCostura(ctrl.data, size)
  const c3 = teselar(ctrl.data, size, 3)
  writeFileSync(join(outDir, '_control-costura.png'), encodePng(c3.size, c3.size, c3.rgba))

  const UMBRAL = 2.0
  const ctrlPeor = Math.max(ctrlCostura.horizontal, ctrlCostura.vertical)
  console.log(
    `\ncontrol no-periodico  costura H=${ctrlCostura.horizontal.toFixed(2)} V=${ctrlCostura.vertical.toFixed(2)}`,
  )
  console.log(`peor familia: ${peorCostura.toFixed(2)}  |  umbral: ${UMBRAL}`)

  if (ctrlPeor < UMBRAL) {
    console.error(
      '\nFALLA: el control roto a proposito PASO la medicion de costura. La metrica no mide lo que dice medir; no confiar en los numeros de arriba.',
    )
    process.exitCode = 1
    return
  }
  if (peorCostura >= UMBRAL) {
    console.error('\nFALLA: alguna familia tiene costura real.')
    process.exitCode = 1
    return
  }

  writeFileSync(
    join(outDir, 'camo-tiles.json'),
    `${JSON.stringify(
      {
        generadoPor: 'scripts/skin-camo-tiles.ts',
        seed,
        resolucion: size,
        verificacion: {
          metrica: 'salto de color en el borde envolvente / salto interno medio; ~1.0 = cierra',
          umbral: UMBRAL,
          peorFamilia: Number(peorCostura.toFixed(3)),
          controlNoPeriodico: Number(ctrlPeor.toFixed(3)),
          nota: 'el control se genera roto a proposito y debe superar el umbral; si no lo supera, la metrica no sirve y el script falla',
        },
        familias: meta,
      },
      null,
      2,
    )}\n`,
  )

  console.log(`\nOK. Salida en ${outDir}/`)
}

main()
