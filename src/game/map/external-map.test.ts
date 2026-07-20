import { BufferGeometry, Mesh, MeshBasicMaterial, Object3D, SRGBColorSpace, Texture } from 'three'
import { describe, expect, it } from 'vitest'

import { aplicarLightmap } from '@/game/map/external-map'

/**
 * El atlas de lightmap tiene cuatro formas de quedar enganchado "casi bien",
 * y las cuatro producen una pantalla que se ve iluminada -- o sea, ninguna
 * se detecta sin mirar muy de cerca la imagen correcta:
 *
 *  - sin `channel = 1` muestrea con las UV del albedo (repiten decenas de
 *    veces por pared) y tilea el atlas entero sobre cada muro;
 *  - con `flipY` en true (el default de TextureLoader) cada cara toma la
 *    fila espejada del atlas, o sea la luz de otro lado del mapa;
 *  - sin `lightMapIntensity = π` queda el factor RECIPROCAL_PI de three y
 *    todo sale 3.14 veces más oscuro, que es el "multiplicador global" que
 *    esta tarea justamente NO quería;
 *  - con mipmaps, los niveles altos mezclan caras que en el atlas son
 *    vecinas y en el mundo no.
 */

function mallaConMateriales(cantidad: number): { raiz: Object3D; materiales: MeshBasicMaterial[] } {
  const raiz = new Object3D()
  const materiales: MeshBasicMaterial[] = []
  for (let i = 0; i < cantidad; i++) {
    const mat = new MeshBasicMaterial()
    materiales.push(mat)
    raiz.add(new Mesh(new BufferGeometry(), mat))
  }
  return { raiz, materiales }
}

describe('aplicarLightmap', () => {
  it('engancha la textura en TODOS los materiales de la malla', () => {
    const { raiz, materiales } = mallaConMateriales(3)
    const tex = new Texture()

    const tocados = aplicarLightmap(raiz, tex)

    expect(tocados).toBe(3)
    for (const m of materiales) expect(m.lightMap).toBe(tex)
  })

  it('usa el SEGUNDO juego de UV (channel = 1)', () => {
    const { raiz } = mallaConMateriales(1)
    const tex = new Texture()
    aplicarLightmap(raiz, tex)
    // Si esto fuera 0 (el default de Texture), el lightmap se muestrearía
    // con las UV del albedo y el mapa quedaría tileado de luz.
    expect(tex.channel).toBe(1)
  })

  it('desactiva flipY para coincidir con la convención de UV del glTF', () => {
    const { raiz } = mallaConMateriales(1)
    const tex = new Texture()
    tex.flipY = true // como lo deja TextureLoader
    aplicarLightmap(raiz, tex)
    expect(tex.flipY).toBe(false)
  })

  it('compensa el RECIPROCAL_PI de three: intensidad = π', () => {
    const { raiz, materiales } = mallaConMateriales(1)
    aplicarLightmap(raiz, new Texture())
    // MeshBasicMaterial hace lightMapTexel * lightMapIntensity *
    // RECIPROCAL_PI. Con intensidad π el producto neto es 1 y el lightmap
    // multiplica el albedo tal cual.
    expect(materiales[0].lightMapIntensity).toBeCloseTo(Math.PI, 10)
    expect(materiales[0].lightMapIntensity * (1 / Math.PI)).toBeCloseTo(1, 10)
  })

  it('marca la textura como sRGB y sin mipmaps', () => {
    const { raiz } = mallaConMateriales(1)
    const tex = new Texture()
    aplicarLightmap(raiz, tex)
    expect(tex.colorSpace).toBe(SRGBColorSpace)
    expect(tex.generateMipmaps).toBe(false)
  })

  it('no cuenta dos veces un material compartido por varias mallas', () => {
    const raiz = new Object3D()
    const compartido = new MeshBasicMaterial()
    raiz.add(new Mesh(new BufferGeometry(), compartido))
    raiz.add(new Mesh(new BufferGeometry(), compartido))

    expect(aplicarLightmap(raiz, new Texture())).toBe(1)
  })

  it('recorre la jerarquía completa, no sólo los hijos directos', () => {
    // El GLB del mapa cuelga la malla de un nodo intermedio: un traverse
    // que mire un solo nivel dejaría el mapa entero sin lightmap.
    const raiz = new Object3D()
    const medio = new Object3D()
    const mat = new MeshBasicMaterial()
    medio.add(new Mesh(new BufferGeometry(), mat))
    raiz.add(medio)

    expect(aplicarLightmap(raiz, new Texture())).toBe(1)
    expect(mat.lightMap).not.toBeNull()
  })
})
