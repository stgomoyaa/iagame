/**
 * Traducción del modelo de materiales de Source (VertexLitGeneric + phong) al
 * metallic-roughness de glTF.
 *
 * POR QUÉ EXISTE
 * ==============
 * Las armas se veían "de plástico" porque el pipeline horneaba la textura en
 * `COLOR_0` y tiraba UVs, normales y texturas: sin normales no hay
 * iluminación, y sin iluminación no hay especular que corra por el riel
 * cuando movés la vista. Conservar la textura es la mitad del arreglo; la
 * otra mitad es decirle al render QUÉ PARTE del arma es metal pulido y cuál
 * es polímero mate. Un arma con una rugosidad uniforme sigue leyéndose como
 * un juguete, sólo que ahora con dibujitos.
 *
 * DE DÓNDE SALE ESE DATO
 * ======================
 * Source lo guarda en el canal ALFA de la textura base. El VMT del AK dice:
 *
 *     "$phong" "1"
 *     "$basemapalphaphongmask" "1"
 *
 * o sea: "el alfa de $basetexture es la máscara de phong". Es un dato que ya
 * viaja dentro del PNG que importó Blender — no hay que decodificar ningún
 * VTF extra ni volver a correr Blender para tenerlo. En el `v_ak47` esa
 * máscara va de 0 a 255 con media 13: casi todo el arma es mate y unas pocas
 * zonas (cerrojo, cañón, tornillería) son metal. Eso es exactamente la
 * información que faltaba.
 *
 * LO QUE NO SE RECUPERA
 * =====================
 * `$phongexponenttexture` (`v_ak47_exp.vtf`) daría el exponente de brillo
 * por téxel, más fino que la máscara binaria-ish del alfa. No se usa porque
 * vive en un VTF que SourceIO no importó al GLB, y traerlo obligaría a
 * escribir un decodificador de VTF con sus formatos comprimidos (DXT1/5).
 * La máscara del alfa ya separa metal de polímero, que es el salto grande;
 * el exponente sería un refinamiento sobre eso.
 *
 * Los viewmodels de CS tampoco traen `$bumpmap`: el relieve de un arma de CS
 * viene de la GEOMETRÍA (24 mil triángulos) más el especular, no de un normal
 * map. Por eso conservar el atributo NORMAL del GLB es la pieza crítica y no
 * hace falta inventar un mapa de normales que el original nunca tuvo.
 */

import type { RawImage } from './png-writer.ts'

/**
 * Rango de alfa por debajo del cual se considera que NO hay máscara.
 *
 * Hace falta porque no todos los materiales usan el alfa como máscara de
 * phong: en los brazos, `gloves` viene con alfa 255 constante (opacidad, no
 * máscara) y `skin1` con alfa entre 0 y 5 (ruido). Tomar esos al pie de la
 * letra dejaría los guantes cromados —alfa 255 leído como "metal puro"— que
 * es un bug muy visible y muy fácil de introducir sin querer.
 *
 * 8/255 es la línea: por debajo de eso la variación no alcanza para
 * distinguir materiales ni con buena voluntad, y es holgadamente mayor que
 * el ruido de compresión que deja un VTF DXT5 al pasar por Blender.
 */
const RANGO_MINIMO_MASCARA = 8

export interface EstadisticasMascara {
  readonly min: number
  readonly max: number
  readonly promedio: number
  /** Si el alfa se puede leer como máscara de phong. */
  readonly usable: boolean
}

/** Mide el canal alfa para decidir si es una máscara de phong o relleno. */
export function analizarMascaraPhong(rgba: Uint8Array): EstadisticasMascara {
  let min = 255
  let max = 0
  let suma = 0
  let n = 0
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i]
    if (a < min) min = a
    if (a > max) max = a
    suma += a
    n++
  }
  if (n === 0) return { min: 0, max: 0, promedio: 0, usable: false }
  return {
    min,
    max,
    promedio: suma / n,
    usable: max - min >= RANGO_MINIMO_MASCARA,
  }
}

/**
 * Rugosidad para un valor de máscara de phong.
 *
 * Deriva de a qué corresponden los extremos en un arma de CS:
 *   máscara 0   -> polímero, madera, pintura mate. Rugosidad 0.82: refleja
 *                  la luz difusa y casi no produce reflejo especular nítido.
 *   máscara 255 -> acero pulido del cerrojo y el cañón. Rugosidad 0.16: da
 *                  un reflejo apretado que se DESPLAZA al mover la vista,
 *                  que es literalmente lo que el dueño pedía ver.
 *
 * La interpolación es lineal en la máscara. No se usa una curva porque la
 * máscara de Source ya viene con su propio contraste horneado: en el AK el
 * 87% de los téxeles están por debajo de 64, así que la mayor parte del arma
 * cae naturalmente en el extremo mate sin necesidad de forzarla.
 */
export function mascaraARugosidad(mascara: number): number {
  const m = mascara / 255
  return 0.82 - m * (0.82 - 0.16)
}

/**
 * Metalicidad para un valor de máscara de phong.
 *
 * Elevada al cuadrado y no lineal, a diferencia de la rugosidad, y por una
 * razón concreta: en metallic-roughness un valor de metalicidad intermedio
 * no existe en la naturaleza —una superficie es conductora o no lo es— y
 * repartir metalicidad media por toda el arma la deja gris y apagada, porque
 * el albedo deja de contribuir al difuso sin llegar a comportarse como
 * metal. Con el cuadrado, sólo lo que la máscara marca FUERTE (cerrojo,
 * cañón) llega a leerse como metal y el resto se queda dieléctrico.
 *
 * El tope es 0.9 y no 1.0: un metal perfectamente puro sin nada que reflejar
 * se ve NEGRO. El rig de iluminación del viewmodel trae un environment
 * (weapons/viewmodel/renderer.ts), pero dejar un 10% de dieléctrico es el
 * seguro barato contra que un arma quede como una silueta oscura si ese
 * environment alguna vez falta.
 */
export function mascaraAMetalicidad(mascara: number): number {
  const m = mascara / 255
  return m * m * 0.9
}

/**
 * Arma la textura metallic-roughness de glTF a partir del alfa de la base.
 *
 * El layout lo fija la especificación de glTF y es fácil de equivocar:
 *   R = oclusión ambiental (acá 255: no hay dato de AO en el original)
 *   G = ROUGHNESS
 *   B = METALNESS
 *
 * Invertir G y B es el error clásico y no revienta nada: simplemente deja el
 * arma entera metálica y mate, o sea peor que antes de todo este trabajo.
 * Por eso hay un test que fija los canales.
 */
export function construirMetalRough(base: RawImage): RawImage {
  if (base.channels !== 4) {
    throw new Error('construirMetalRough: la textura base tiene que venir RGBA para tener máscara')
  }
  const { width, height, data } = base
  const salida = new Uint8Array(width * height * 3)
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    const mascara = data[i + 3]
    salida[p] = 255
    salida[p + 1] = Math.round(mascaraARugosidad(mascara) * 255)
    salida[p + 2] = Math.round(mascaraAMetalicidad(mascara) * 255)
  }
  return { width, height, data: salida, channels: 3 }
}

/**
 * Descarta el alfa de una textura RGBA.
 *
 * Se hace SIEMPRE con la textura base del arma, incluso cuando el alfa traía
 * máscara de phong, y es deliberado: una vez que la máscara se copió a la
 * textura metallic-roughness, dejar el alfa en la base sólo sirve para que
 * algo lo confunda con transparencia. Un `alphaMode` mal puesto sobre esta
 * textura convierte el 87% del AK —el que tiene máscara baja— en un arma casi
 * invisible. Sacarlo, además, baja el peso del PNG un cuarto.
 */
export function descartarAlfa(img: RawImage): RawImage {
  if (img.channels !== 4) return img
  const { width, height, data } = img
  const salida = new Uint8Array(width * height * 3)
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    salida[p] = data[i]
    salida[p + 1] = data[i + 1]
    salida[p + 2] = data[i + 2]
  }
  return { width, height, data: salida, channels: 3 }
}
