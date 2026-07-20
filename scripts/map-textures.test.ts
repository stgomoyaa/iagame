import { describe, expect, it } from 'vitest'
import { Document } from '@gltf-transform/core'

import { aplicarTexturas } from './map-textures.ts'

/** PNG de 1x1 válido: alcanza para que el GLB quede bien formado. */
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

/** GLB mínimo con la forma que produce bsp-convert.ts: una malla, una
 *  primitiva por material, el nombre del material preservado. */
function docConMateriales(nombres: string[]): Document {
  const doc = new Document()
  const buffer = doc.createBuffer()
  const mesh = doc.createMesh()
  doc.createScene().addChild(doc.createNode().setMesh(mesh))

  for (const nombre of nombres) {
    const pos = doc
      .createAccessor(undefined, buffer)
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    const uv = doc
      .createAccessor(undefined, buffer)
      .setType('VEC2')
      .setArray(new Float32Array([0, 0, 1, 0, 0, 1]))
    const idx = doc.createAccessor(undefined, buffer).setType('SCALAR').setArray(new Uint32Array([0, 1, 2]))
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute('POSITION', pos)
        .setAttribute('TEXCOORD_0', uv)
        .setIndices(idx)
        .setMaterial(doc.createMaterial(nombre).setBaseColorFactor([0.6, 0.6, 0.6, 1])),
    )
  }
  return doc
}

const leerPng = (): Uint8Array => PNG_1X1

describe('aplicarTexturas', () => {
  it('engancha la textura por nombre de material y blanquea el color plano', () => {
    // El gris 0.6 que deja bsp-convert.ts multiplica la textura: si no se
    // blanquea, el mapa entero sale un 40% más oscuro y nadie sabe por qué.
    const doc = docConMateriales(['CONCRETE/FLOOR01'])
    const reporte = aplicarTexturas(doc, { 'CONCRETE/FLOOR01': 'floor.png' }, leerPng)

    expect(reporte.conTextura).toBe(1)
    expect(reporte.sinTextura).toEqual([])
    const mat = doc.getRoot().listMaterials()[0]
    expect(mat.getBaseColorTexture()).not.toBeNull()
    expect(mat.getBaseColorFactor()).toEqual([1, 1, 1, 1])
  })

  it('marca todo material como unlit, tenga textura o no', () => {
    // La escena del juego no tiene ni una luz (engine/renderer.ts): un
    // material PBR se ve NEGRO. Este es el detalle que convierte "el mapa
    // carga" en "el mapa se ve".
    const doc = docConMateriales(['CONCRETE/FLOOR01', 'NO/EXISTE'])
    aplicarTexturas(doc, { 'CONCRETE/FLOOR01': 'floor.png' }, leerPng)
    for (const mat of doc.getRoot().listMaterials()) {
      expect(mat.getExtension('KHR_materials_unlit'), mat.getName()).not.toBeNull()
    }
  })

  it('un material sin entrada en el índice no rompe la carga: queda sin textura', () => {
    // 10 de los 43 materiales de nuketown apuntan a texturas del juego base
    // que el mapa no empaqueta. Que salgan planos es aceptable; que tiren, no.
    const doc = docConMateriales(['AIM_RAID/CONCRETE01'])
    const reporte = aplicarTexturas(doc, {}, leerPng)
    expect(reporte.sinTextura).toEqual(['AIM_RAID/CONCRETE01'])
    expect(doc.getRoot().listMaterials()[0].getBaseColorTexture()).toBeNull()
  })

  it('normaliza la barra inicial del nombre de material', () => {
    // nuketown escribe el pasto como "/NUKETOWN_GRASS01" y el índice lo
    // lista sin barra. Es UN material, pero es el suelo entero del mapa.
    const doc = docConMateriales(['/NUKETOWN_GRASS01'])
    const reporte = aplicarTexturas(doc, { NUKETOWN_GRASS01: 'grass.png' }, leerPng)
    expect(reporte.conTextura).toBe(1)
  })

  it('comparte UNA imagen entre materiales que apuntan al mismo archivo', () => {
    const doc = docConMateriales(['A/UNO', 'B/DOS'])
    const reporte = aplicarTexturas(doc, { 'A/UNO': 'mismo.png', 'B/DOS': 'mismo.png' }, leerPng)
    expect(reporte.conTextura).toBe(2)
    expect(reporte.imagenes).toBe(1)
    expect(doc.getRoot().listTextures()).toHaveLength(1)
  })

  it('descarta las primitivas de materiales TOOLS/*', () => {
    // toolsskybox es una caja que envuelve el mapa entero: dejarla puesta es
    // jugar dentro de un cajón cerrado.
    const doc = docConMateriales(['TOOLS/TOOLSSKYBOX', 'CONCRETE/FLOOR01'])
    const reporte = aplicarTexturas(doc, { 'CONCRETE/FLOOR01': 'floor.png' }, leerPng)
    expect(reporte.primitivasDescartadas).toBe(1)
    const prims = doc.getRoot().listMeshes()[0].listPrimitives()
    expect(prims).toHaveLength(1)
    expect(prims[0].getMaterial()?.getName()).toBe('CONCRETE/FLOOR01')
  })
})
