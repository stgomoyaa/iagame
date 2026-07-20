/**
 * Traducción del material de Source a metallic-roughness de glTF, sobre un
 * documento ya importado.
 *
 * POR QUÉ ESTÁ ACÁ Y NO ADENTRO DE UN CONVERSOR
 * =============================================
 * Nació dentro de `convert-source-viewmodels.ts`, para los `v_` de CS. Cuando
 * entraron los `c_` de COD hizo falta exactamente lo mismo —conservar UVs,
 * normales y texturas, y sacar el metal del alfa— pero desde el OTRO conversor,
 * que además normaliza la geometría con una matriz.
 *
 * Copiarla habría sido peor que moverla, y no por gusto estético: el modo de
 * falla que esta función existe para evitar (un arma que llega al juego sin
 * normales y se ve plana) es SILENCIOSO. Dos copias significan que arreglar
 * ese bug en una deja la otra rota, y nadie se entera hasta mirar una captura.
 * Una sola implementación con un solo `verificarAtributosPbr` es lo que hace
 * que el guard valga para las dos familias de armas.
 *
 * Lo único que cambiaba entre los dos usos era el LADO MÁXIMO de textura según
 * la malla (los brazos del viewmodel van a la mitad que el cuerpo), así que
 * eso se parametrizó y el resto quedó igual.
 *
 * `lib/source-pbr.ts` es el vecino de al lado y hace la parte pura —analizar
 * el alfa, construir el mapa metal/rugosidad— sin saber qué es un glTF. Acá
 * vive lo que sí toca el documento.
 */

import type { Document } from '@gltf-transform/core'
import { decodePng } from './png-reader.ts'
import { encodePngRaw, type RawImage, resizeArea, targetSide } from './png-writer.ts'
import { analizarMascaraPhong, construirMetalRough, descartarAlfa } from './source-pbr.ts'

/**
 * Lado máximo por defecto del cuerpo de un arma.
 *
 * 1024 es el lado nativo de la mayoría de estas texturas, así que para casi
 * todas no hay reescalado: el tope existe para las pocas de 2048, donde el
 * segundo mip ya no aporta nada a un arma que ocupa un tercio de pantalla.
 */
export const MAX_LADO_CUERPO = 1024

/** Rugosidad de un material sin máscara de phong utilizable. */
const RUGOSIDAD_SIN_MASCARA = 0.75

export interface EstadisticasTexturas {
  /** Texturas reescaladas y reescritas. */
  procesadas: number
  /** Materiales que recibieron un mapa metallic-roughness derivado del alfa. */
  conMascara: number
  /** Bytes de imagen después de procesar. */
  bytes: number
}

/**
 * Devuelve el lado máximo de textura para la malla con ese nombre. Permite que
 * el viewmodel mande sus brazos a 512 sin que esta función sepa qué es un brazo.
 */
export type LadoDeMalla = (nombreMalla: string) => number

/**
 * Conserva UVs, normales y texturas, y traduce el material de Source a
 * metallic-roughness de glTF.
 *
 * Es el reemplazo del horneado a `COLOR_0`. Aquel horneado nació cuando el
 * presupuesto de 2.5 ms mandaba y se buscaba una sola llamada de dibujo por
 * arma; el costo escondido era que dejaba el arma SIN NORMALES y sin UVs, y
 * sin normales no hay iluminación posible: por más luces que se le pongan a la
 * escena, un material sin normales devuelve color plano. De ahí el "parece
 * Roblox".
 *
 * Lo que hace, por material:
 *
 * 1. Reescala la textura base a su lado máximo y le SACA el alfa.
 * 2. Si ese alfa era una máscara de phong (ver `lib/source-pbr.ts`), la
 *    convierte en un mapa metallic-roughness. Eso es lo que hace que el
 *    cerrojo brille y la culata no.
 * 3. Si no lo era —guantes, piel—, deja factores constantes mate.
 *
 * Lo que NO hace: tocar `COLOR_0`, `TEXCOORD_0` ni `NORMAL`. Los tres se
 * conservan tal como vinieron de Blender.
 *
 * Se mantiene un material por PRIMITIVA en vez de colapsar a uno por malla:
 * cada uno lleva su propia textura, así que fusionarlos perdería exactamente
 * la información que este camino vino a rescatar.
 */
export function prepararMaterialesPbr(doc: Document, ladoDeMalla: LadoDeMalla): EstadisticasTexturas {
  const root = doc.getRoot()
  const stats: EstadisticasTexturas = { procesadas: 0, conMascara: 0, bytes: 0 }

  // Lado máximo por material, según la malla que lo usa.
  const ladoPorMaterial = new Map<string, number>()
  for (const mesh of root.listMeshes()) {
    const lado = ladoDeMalla(mesh.getName())
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial()
      if (material) ladoPorMaterial.set(material.getName(), lado)
    }
  }

  // Una textura puede estar compartida por varios materiales; se reescribe una
  // sola vez.
  const yaProcesadas = new Set<unknown>()

  const procesarImagen = (
    texture: ReturnType<Document['createTexture']>,
    lado: number,
    quitarAlfa: boolean,
  ): RawImage | null => {
    const image = texture.getImage()
    if (!image) return null
    const png = decodePng(Buffer.from(image))
    const original: RawImage = {
      width: png.width,
      height: png.height,
      data: png.rgba,
      channels: 4,
    }
    // El lado objetivo se calcula sobre el lado MAYOR y se aplica a los dos
    // ejes por separado, para no deformar texturas que no son cuadradas (la
    // piel de los brazos es 1024x2048).
    const mayor = Math.max(original.width, original.height)
    const destino = targetSide(mayor, lado)
    const factor = destino / mayor
    const escalada = resizeArea(
      original,
      Math.max(1, Math.round(original.width * factor)),
      Math.max(1, Math.round(original.height * factor)),
    )

    if (!yaProcesadas.has(texture)) {
      const final = quitarAlfa ? descartarAlfa(escalada) : escalada
      const bytes = encodePngRaw(final)
      texture.setImage(bytes).setMimeType('image/png')
      yaProcesadas.add(texture)
      stats.procesadas++
      stats.bytes += bytes.length
    }
    return escalada
  }

  for (const material of root.listMaterials()) {
    const lado = ladoPorMaterial.get(material.getName()) ?? MAX_LADO_CUERPO

    const normal = material.getNormalTexture()
    if (normal) procesarImagen(normal, lado, true)

    const base = material.getBaseColorTexture()
    if (!base) {
      material.setMetallicFactor(0).setRoughnessFactor(RUGOSIDAD_SIN_MASCARA)
      continue
    }

    // El análisis de la máscara va sobre la textura YA reescalada: es la que
    // se va a muestrear en el juego, y promediar por área puede achatar
    // máscaras muy finas. Medir sobre la original diría que hay máscara donde
    // después no la hay.
    const escalada = procesarImagen(base, lado, true)
    if (!escalada) {
      material.setMetallicFactor(0).setRoughnessFactor(RUGOSIDAD_SIN_MASCARA)
      continue
    }

    const mascara = analizarMascaraPhong(escalada.data)
    if (!mascara.usable) {
      material.setMetallicFactor(0).setRoughnessFactor(RUGOSIDAD_SIN_MASCARA)
      continue
    }

    // El mapa metallic-roughness va a la MITAD del lado de la base. La
    // rugosidad de un arma es una señal de baja frecuencia —"esta pieza es
    // acero, esta otra es polímero"— y sus bordes coinciden con bordes de
    // geometría que la normal ya define con nitidez. A resolución completa
    // pesaba tanto como el albedo sin aportar nada visible.
    const mrCompleto = construirMetalRough(escalada)
    const mr = resizeArea(
      mrCompleto,
      Math.max(1, mrCompleto.width >> 1),
      Math.max(1, mrCompleto.height >> 1),
    )
    const textura = doc
      .createTexture(`${material.getName()}_mr`)
      .setImage(encodePngRaw(mr))
      .setMimeType('image/png')
    stats.bytes += textura.getImage()?.byteLength ?? 0
    // Factores en 1: los valores salen ENTEROS de la textura. glTF multiplica
    // factor por textura, así que un factor en 0 —el default de este material
    // tras venir de Blender— anularía el mapa entero y dejaría el arma mate,
    // que es el bug silencioso de este bloque.
    material
      .setMetallicRoughnessTexture(textura)
      .setMetallicFactor(1)
      .setRoughnessFactor(1)
      .setAlphaMode('OPAQUE')
    stats.conMascara++
  }

  return stats
}

/**
 * Verifica que las mallas conserven lo que la iluminación necesita.
 *
 * Va aparte y corre DESPUÉS de `prune()` a propósito: `prune()` borra
 * atributos que considera sin usar, y un cambio de versión de la librería que
 * decidiera que las normales sobran dejaría las armas planas otra vez sin
 * ningún error. Ese es exactamente el modo de falla que este proyecto ya vivió
 * —el pipeline que tiraba las normales en silencio— y no se vuelve a dejar
 * abierto.
 */
export function verificarAtributosPbr(doc: Document): void {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial()
      if (!prim.getAttribute('NORMAL')) {
        throw new Error(`la malla "${mesh.getName()}" quedó sin NORMAL: se vería sin iluminación`)
      }
      if (material?.getBaseColorTexture() && !prim.getAttribute('TEXCOORD_0')) {
        throw new Error(`la malla "${mesh.getName()}" tiene textura pero quedó sin TEXCOORD_0`)
      }
    }
  }
}
