import {
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'

import { aplicarLightmap, construirProps, esPropsMapaJson } from '@/game/map/external-map'

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

describe('esPropsMapaJson', () => {
  const valido = {
    modelos: ['a.glb', 'b.glb'],
    instancias: [{ modelo: 1, pos: [1, 2, 3], quat: [0, 0, 0, 1] }],
  }

  it('acepta la forma que produce scripts/bsp-props.ts', () => {
    expect(esPropsMapaJson(valido)).toBe(true)
  })

  it('rechaza un índice de modelo fuera de rango', () => {
    // Es el error que más silencio hace: el prop se dibuja igual, pero con
    // el modelo equivocado o con ninguno, y el mapa queda "casi bien".
    expect(esPropsMapaJson({ ...valido, instancias: [{ modelo: 2, pos: [0, 0, 0], quat: [0, 0, 0, 1] }] })).toBe(false)
    expect(esPropsMapaJson({ ...valido, instancias: [{ modelo: -1, pos: [0, 0, 0], quat: [0, 0, 0, 1] }] })).toBe(false)
  })

  it('rechaza un cuaternión de 3 componentes', () => {
    expect(esPropsMapaJson({ ...valido, instancias: [{ modelo: 0, pos: [0, 0, 0], quat: [0, 0, 1] }] })).toBe(false)
  })

  it('rechaza NaN en la posición', () => {
    expect(esPropsMapaJson({ ...valido, instancias: [{ modelo: 0, pos: [0, NaN, 0], quat: [0, 0, 0, 1] }] })).toBe(false)
  })

  it('rechaza un 404 servido como HTML', () => {
    expect(esPropsMapaJson('<!DOCTYPE html>')).toBe(false)
    expect(esPropsMapaJson(null)).toBe(false)
  })
})

describe('construirProps', () => {
  function modeloConMallas(cantidad: number): Object3D {
    const raiz = new Object3D()
    for (let i = 0; i < cantidad; i++) raiz.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()))
    return raiz
  }

  function instanciados(raiz: Object3D): InstancedMesh[] {
    const out: InstancedMesh[] = []
    raiz.traverse((o) => {
      if (o instanceof InstancedMesh) out.push(o)
    })
    return out
  }

  it('agrupa las instancias del mismo modelo en UN InstancedMesh', () => {
    const props = {
      modelos: ['a.glb'],
      instancias: [
        { modelo: 0, pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
        { modelo: 0, pos: [5, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
        { modelo: 0, pos: [9, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
      ],
    }
    const malla = instanciados(construirProps([modeloConMallas(1)], props))
    // Tres props, un solo draw call.
    expect(malla).toHaveLength(1)
    expect(malla[0].count).toBe(3)
  })

  it('coloca cada instancia en su posición', () => {
    const props = {
      modelos: ['a.glb'],
      instancias: [
        { modelo: 0, pos: [1, 2, 3] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
        { modelo: 0, pos: [-4, 5, -6] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
      ],
    }
    const malla = instanciados(construirProps([modeloConMallas(1)], props))[0]
    const m = new Matrix4()
    const p = new Vector3()

    malla.getMatrixAt(0, m)
    p.setFromMatrixPosition(m)
    expect([p.x, p.y, p.z]).toEqual([1, 2, 3])

    malla.getMatrixAt(1, m)
    p.setFromMatrixPosition(m)
    expect([p.x, p.y, p.z]).toEqual([-4, 5, -6])
  })

  it('aplica la rotación de cada instancia', () => {
    // Media vuelta sobre Y: el eje X del modelo tiene que terminar en -X.
    const props = {
      modelos: ['a.glb'],
      instancias: [
        { modelo: 0, pos: [0, 0, 0] as [number, number, number], quat: [0, 1, 0, 0] as [number, number, number, number] },
      ],
    }
    const malla = instanciados(construirProps([modeloConMallas(1)], props))[0]
    const m = new Matrix4()
    malla.getMatrixAt(0, m)
    const eje = new Vector3(1, 0, 0).applyMatrix4(m)
    expect(eje.x).toBeCloseTo(-1, 9)
    expect(eje.z).toBeCloseTo(0, 9)
  })

  it('convierte los materiales PBR a MeshBasicMaterial (la escena no tiene luces)', () => {
    const raiz = new Object3D()
    raiz.add(new Mesh(new BufferGeometry(), new MeshStandardMaterial({ color: 0x336699 })))
    const props = {
      modelos: ['a.glb'],
      instancias: [
        { modelo: 0, pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
      ],
    }
    const malla = instanciados(construirProps([raiz], props))[0]
    // Un MeshStandardMaterial sin luces se dibuja NEGRO: el prop existe,
    // está en su lugar, y es una silueta.
    expect(malla.material).toBeInstanceOf(MeshBasicMaterial)
    expect((malla.material as MeshBasicMaterial).color.getHex()).toBe(0x336699)
  })

  it('un modelo con varias mallas produce un InstancedMesh por malla', () => {
    const props = {
      modelos: ['a.glb'],
      instancias: [
        { modelo: 0, pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
      ],
    }
    expect(instanciados(construirProps([modeloConMallas(3)], props))).toHaveLength(3)
  })

  it('compone la transformación INTERNA del GLB con la del prop', () => {
    // Los GLB de props cuelgan la malla de un nodo con transformación
    // propia (SourceIO deja ahí el centrado y la escala del modelo). Si se
    // ignora, cada prop aparece desplazado respecto de su origen -- poco,
    // lo justo para que las cercas floten o se hundan en el piso.
    const raiz = new Object3D()
    const nodo = new Object3D()
    nodo.position.set(0, 10, 0)
    nodo.updateMatrix()
    nodo.add(new Mesh(new BufferGeometry(), new MeshBasicMaterial()))
    raiz.add(nodo)

    const props = {
      modelos: ['a.glb'],
      instancias: [
        { modelo: 0, pos: [1, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
      ],
    }
    const malla = instanciados(construirProps([raiz], props))[0]
    const m = new Matrix4()
    malla.getMatrixAt(0, m)
    const p = new Vector3().setFromMatrixPosition(m)
    // 1 del prop en X, 10 del nodo interno en Y: las dos tienen que estar.
    expect(p.x).toBeCloseTo(1, 9)
    expect(p.y).toBeCloseTo(10, 9)
  })

  it('ignora una instancia cuyo modelo no se pudo cargar, sin romper el resto', () => {
    const props = {
      modelos: ['a.glb', 'falta.glb'],
      instancias: [
        { modelo: 1, pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
        { modelo: 0, pos: [3, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
      ],
    }
    const malla = instanciados(construirProps([modeloConMallas(1)], props))
    expect(malla).toHaveLength(1)
    expect(malla[0].count).toBe(1)
  })
})
