/**
 * Dónde vive el skybox "galaxia púrpura" y qué decir cuando no está.
 *
 * Este archivo es a propósito PURO -- no importa three -- para no sumar una
 * entrada más a la lista de architecture.test.ts. La parte que sí necesita
 * three (CubeTextureLoader, SRGBColorSpace, scene.background) son cinco
 * líneas y viven en engine/renderer.ts, que ya está autorizado. Lo que se
 * gana partiéndolo así: el orden de las caras y el mensaje de error se
 * pueden testear en Node, sin WebGL, y el test puede compararlos contra el
 * generador -- que es justo donde esto se rompe (ver skybox.test.ts).
 *
 * El asset es NUESTRO: sale de scripts/generate-skybox.ts, es determinista y
 * publicable. NO tiene nada que ver con workshop-assets/ ni con su régimen
 * de procedencia local (ver docs/SKYBOX.md).
 */

/** Carpeta servida por HTTP, relativa a /public. */
export const RUTA_SKYBOX = '/assets/skybox/galaxia-purpura/'

/**
 * Las seis caras EN EL ORDEN QUE EXIGE THREE: +X, -X, +Y, -Y, +Z, -Z.
 * No es alfabético ni arbitrario: es contrato de CubeTextureLoader, y
 * permutarlo no rompe nada de forma visible -- da un cielo rotado y
 * espejado, que es exactamente el tipo de bug que nadie nota en una captura
 * y que después cuesta media hora encontrar. skybox.test.ts lo ancla contra
 * el orden que usa el generador para escribir los archivos.
 */
export const CARAS_SKYBOX = [
  'px.png',
  'nx.png',
  'py.png',
  'ny.png',
  'pz.png',
  'nz.png',
] as const

/** El comando exacto que hornea el asset. Vive acá para que el mensaje de
 *  error y la documentación no se puedan desincronizar en silencio. */
export const COMANDO_GENERAR_SKYBOX = 'node scripts/generate-skybox.ts'

/**
 * Qué gritar cuando una cara da 404.
 *
 * Existe porque este es el modo de falla peligroso del skybox: el asset está
 * gitignoreado (es salida determinista de un script commiteado), así que un
 * checkout limpio que no corrió el generador pide seis PNG que no existen,
 * `scene.background` se queda sin imágenes y el juego vuelve al cielo negro
 * de antes SIN romperse. Falla en silencio, o sea de la peor forma: se ve
 * como "todavía no implementaron el cielo", no como "falta un paso del
 * build". El mensaje dice qué correr, no sólo qué pasó.
 */
export function mensajeSkyboxFaltante(url: string): string {
  return (
    `[skybox] no se pudo cargar "${url}". El cielo queda negro. ` +
    `El asset está gitignoreado a propósito (salida determinista de un script): ` +
    `hornealo con \`${COMANDO_GENERAR_SKYBOX}\`. ` +
    `Los scripts \`dev\` y \`build\` de package.json ya lo corren solos -- ` +
    `si estás viendo esto, algo se saltó ese paso.`
  )
}
