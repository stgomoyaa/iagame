/**
 * Verifica que un PNG sirva como patrón de camuflaje: que TESELE y que sea
 * gris de verdad.
 *
 *     node scripts/verificar-teselado.ts public/assets/camos/*.png
 *
 * Devuelve un NÚMERO por archivo, no un "se ve bien" (ver la cabecera de
 * scripts/lib/teselado.ts para qué mide ese número y por qué es una razón).
 * Sale con código 1 si alguno no pasa, así se puede encadenar antes de meter
 * un lote de imágenes generadas al catálogo.
 *
 * Se corre ANTES de integrar nada. Una tesela con costura muestra una línea
 * recta cruzando el arma en cada repetición, y eso no se arregla con paleta
 * ni con emisión: hay que descartar la imagen y volver a generarla.
 *
 * `--control <archivo>` agrega un archivo que se espera que FALLE. Sirve para
 * demostrar que la medición discrimina de verdad: si el control pasa, la
 * herramienta está rota y el comando falla aunque todo lo demás esté bien. Un
 * verificador que nunca vio un caso negativo no es evidencia de nada.
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { decodePng } from './lib/png-reader.ts'
import { medirRgba, UMBRAL_CROMA, UMBRAL_RAZON } from './lib/teselado.ts'

function n(v: number, dec = 2): string {
  return v.toFixed(dec)
}

function main(): void {
  const argv = process.argv.slice(2)
  const controles = new Set<string>()
  const archivos: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--control') {
      const ruta = argv[++i]
      if (ruta) {
        controles.add(ruta)
        archivos.push(ruta)
      }
      continue
    }
    archivos.push(argv[i])
  }

  if (archivos.length === 0) {
    console.error('uso: node scripts/verificar-teselado.ts <patron.png> [...] [--control <roto.png>]')
    process.exit(2)
  }

  console.log(
    `umbral de costura: razón <= ${UMBRAL_RAZON}   |   croma <= ${UMBRAL_CROMA} para ser gris\n`,
  )
  console.log(
    'archivo'.padEnd(22) +
      'tamaño'.padEnd(12) +
      'razónH'.padEnd(9) +
      'razónV'.padEnd(9) +
      'croma'.padEnd(7) +
      'desv'.padEnd(7) +
      'veredicto',
  )
  console.log('-'.repeat(88))

  let fallas = 0

  for (const ruta of archivos) {
    let m
    try {
      const png = decodePng(readFileSync(ruta))
      m = medirRgba(png.width, png.height, png.rgba)
    } catch (err) {
      console.log(`${basename(ruta).padEnd(22)}ILEGIBLE: ${(err as Error).message}`)
      fallas++
      continue
    }

    const esControl = controles.has(ruta)
    // El control tiene que fallar: si pasa, es la MEDICIÓN la que está rota.
    const ok = esControl ? !m.tesela : m.tesela && m.esGris
    if (!ok) fallas++

    const motivos: string[] = []
    if (!m.tesela) motivos.push('COSTURA')
    if (!m.esGris) motivos.push('NO ES GRIS')
    if (m.desviacion < 12) motivos.push('SIN CONTRASTE')

    const veredicto = esControl
      ? m.tesela
        ? 'CONTROL NO FALLÓ -> la medición está rota'
        : 'control OK (falla como corresponde)'
      : motivos.length > 0
        ? motivos.join(' + ')
        : 'pasa'

    console.log(
      basename(ruta).padEnd(22) +
        `${m.ancho}x${m.alto}`.padEnd(12) +
        n(m.razonH).padEnd(9) +
        n(m.razonV).padEnd(9) +
        String(m.croma).padEnd(7) +
        n(m.desviacion, 1).padEnd(7) +
        veredicto,
    )
  }

  console.log('')
  if (fallas > 0) {
    console.log(`${fallas} archivo(s) no pasaron. No los integres: regenerá la imagen.`)
    process.exit(1)
  }
  console.log('todos pasan.')
}

main()
