/**
 * Analiza un .bsp de Source para decidir si es importable a nuestro motor.
 *
 *   node scripts/bsp-analyze.ts <mapa.bsp>
 *
 * Responde UNA pregunta, con números en vez de opinión: ¿cuánto de la colisión
 * de este mapa entra en cápsula-contra-AABB, que es lo único que el motor sabe
 * hacer hoy?
 *
 * Por qué la pregunta tiene sentido: en Source la colisión del jugador NO es la
 * malla visual, son *brushes* — poliedros convexos definidos por planos. Los
 * mapas se construyen en Hammer con una herramienta de bloques, así que una
 * fracción grande de esos brushes ya son cajas alineadas a los ejes y entran a
 * nuestro sistema sin tocar el motor. La fracción que no, es el trabajo real.
 *
 * Mide además dos cosas que pueden matar la idea por otro lado:
 * - **Displacements**: superficies de terreno esculpido. No son brushes y no hay
 *   forma de aproximarlas con cajas sin que se note.
 * - **Pakfile embebido**: si las texturas no viajan dentro del .bsp, hay que
 *   sacarlas de los VPK del juego original, y sin eso el mapa renderiza gris —
 *   peor que los mapas que ya tenemos escritos en código.
 *
 * No importa nada ni escribe nada: sólo lee y reporta.
 *
 * La lectura de bajo nivel (cabecera, directorio de lumps, planos, brushes
 * sólidos sin bevel, cruce de planos) vive en `scripts/lib/bsp.ts`, compartida
 * con `bsp-convert.ts`. `esNormalAlineada` y `extension` se re-exportan acá
 * tal cual para no romper a quien ya las importa desde este archivo.
 */

import { readFileSync } from 'node:fs'

import {
  LUMP_DISPINFO,
  LUMP_PAKFILE,
  LUMP_PLANES,
  METROS_POR_UNIDAD,
  TAM_DISPINFO,
  esNormalAlineada,
  extension,
  leerBrushesSolidos,
  leerLumps,
  leerPlanos,
} from './lib/bsp.ts'

export { esNormalAlineada, extension } from './lib/bsp.ts'

export interface Analisis {
  version: number
  brushesSolidos: number
  brushesAABB: number
  /** Fracción de brushes sólidos que ya son cajas alineadas a los ejes. */
  fraccionAABB: number
  /** Fracción del VOLUMEN sólido que es AABB. Un mapa puede tener muchos brushes
   *  raros chiquitos y aun así ser casi todo cajas, o al revés. */
  fraccionVolumenAABB: number
  displacements: number
  pakfileBytes: number
}

export function analizar(buf: Buffer): Analisis {
  const { version, lumps } = leerLumps(buf)
  const { nx, ny, nz, dist } = leerPlanos(buf, lumps[LUMP_PLANES])
  const brushesSolidos = leerBrushesSolidos(buf, lumps)

  let brushesAABB = 0
  let volumenTotal = 0
  let volumenAABB = 0

  for (const planos of brushesSolidos) {
    // Un brush es una caja si TODAS sus normales son de eje. No se exige que
    // sean exactamente 6 planos: vbsp deja planos redundantes, y un brush con
    // 7 planos todos alineados sigue siendo un AABB.
    const esCaja = planos.length >= 6 && planos.every((p) => esNormalAlineada(nx[p], ny[p], nz[p]))

    // Volumen de la caja envolvente, calculada desde los VÉRTICES reales del
    // poliedro. Una versión anterior la sacaba sólo de los planos alineados a
    // los ejes, y por eso los brushes inclinados -- que muchas veces no tienen
    // ninguno -- quedaban en volumen cero: el peso se anulaba justo en lo que
    // se quería medir, y cualquier mapa daba 100%.
    const ext = extension(planos, nx, ny, nz, dist)
    const vol = ext === null ? 0 : ext[0] * ext[1] * ext[2] * METROS_POR_UNIDAD ** 3

    volumenTotal += vol
    if (esCaja) {
      brushesAABB++
      volumenAABB += vol
    }
  }

  return {
    version,
    brushesSolidos: brushesSolidos.length,
    brushesAABB,
    fraccionAABB: brushesSolidos.length === 0 ? 0 : brushesAABB / brushesSolidos.length,
    fraccionVolumenAABB: volumenTotal === 0 ? 0 : volumenAABB / volumenTotal,
    displacements: Math.floor(lumps[LUMP_DISPINFO].largo / TAM_DISPINFO),
    pakfileBytes: lumps[LUMP_PAKFILE].largo,
  }
}

function main(): void {
  const ruta = process.argv[2]
  if (!ruta) {
    console.error('uso: node scripts/bsp-analyze.ts <mapa.bsp>')
    process.exit(2)
  }

  const a = analizar(readFileSync(ruta))
  const pct = (v: number) => (v * 100).toFixed(1) + '%'

  console.log(`bsp version:        ${a.version}`)
  console.log(`brushes sólidos:    ${a.brushesSolidos}`)
  console.log(`  cajas alineadas:  ${a.brushesAABB}  (${pct(a.fraccionAABB)} por conteo)`)
  console.log(`  por volumen:      ${pct(a.fraccionVolumenAABB)}`)
  console.log(`displacements:      ${a.displacements}${a.displacements > 0 ? '  <-- terreno esculpido, no aproximable con cajas' : ''}`)
  console.log(
    `pakfile embebido:   ${(a.pakfileBytes / 1048576).toFixed(1)} MB` +
      (a.pakfileBytes < 65536 ? '  <-- casi vacío: las texturas viven en los VPK del juego' : ''),
  )
}

if (process.argv[1]?.endsWith('bsp-analyze.ts')) main()
