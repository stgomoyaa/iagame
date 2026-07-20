import {
  Float32BufferAttribute,
  BufferGeometry,
  Color,
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

import {
  aplicarColisionDeProps,
  aplicarLightmap,
  construirProps,
  esPropsMapaJson,
  filtrarSpawnsPorProps,
  hornearColisionDeProps,
} from '@/game/map/external-map'
import { convexDeCaja } from '@/game/map/colision-props'
import type { MapDef } from '@/game/map/types'
import { vec3 } from '@/game/math/vec3'
import { PLAYER_CAPSULE, capsuleOverlapsConvex } from '@/game/physics/capsule'

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

  it('acepta una instancia sin `luz` (mapa sin lightmap)', () => {
    expect(esPropsMapaJson({ ...valido, instancias: [{ modelo: 0, pos: [0, 0, 0], quat: [0, 0, 0, 1] }] })).toBe(true)
  })

  it('acepta una instancia con `luz` bien formada', () => {
    expect(
      esPropsMapaJson({
        ...valido,
        instancias: [{ modelo: 0, pos: [0, 0, 0], quat: [0, 0, 0, 1], luz: [0.3, 0.28, 0.19] }],
      }),
    ).toBe(true)
  })

  it('rechaza una `luz` mal formada en vez de pintar el prop de negro', () => {
    // Un array de dos componentes o con un NaN adentro llega hasta
    // `setRGB` sin que nada falle, y el prop sale negro o transparente.
    for (const luz of [[0.3, 0.2], [0.3, 0.2, NaN], 0.5, 'gris']) {
      expect(
        esPropsMapaJson({ ...valido, instancias: [{ modelo: 0, pos: [0, 0, 0], quat: [0, 0, 0, 1], luz }] }),
      ).toBe(false)
    }
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
    const malla = instanciados(construirProps([modeloConMallas(1)], props, true))
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
    const malla = instanciados(construirProps([modeloConMallas(1)], props, true))[0]
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
    const malla = instanciados(construirProps([modeloConMallas(1)], props, true))[0]
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
    const malla = instanciados(construirProps([raiz], props, true))[0]
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
    expect(instanciados(construirProps([modeloConMallas(3)], props, true))).toHaveLength(3)
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
    const malla = instanciados(construirProps([raiz], props, true))[0]
    const m = new Matrix4()
    malla.getMatrixAt(0, m)
    const p = new Vector3().setFromMatrixPosition(m)
    // 1 del prop en X, 10 del nodo interno en Y: las dos tienen que estar.
    expect(p.x).toBeCloseTo(1, 9)
    expect(p.y).toBeCloseTo(10, 9)
  })

  it('tinta cada instancia con SU luz, sin romper el instanciado', () => {
    // El punto del tinte por instancia es que las tres cercas sigan siendo
    // UN draw call. Si esto alguna vez se implementara clonando material
    // por prop, este test seguiría pasando por color pero `malla` pasaría
    // a tener 3 elementos.
    const props = {
      modelos: ['a.glb'],
      instancias: [
        { modelo: 0, pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number], luz: [0.25, 0.5, 0.75] as [number, number, number] },
        { modelo: 0, pos: [5, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number], luz: [1, 1, 1] as [number, number, number] },
      ],
    }
    const malla = instanciados(construirProps([modeloConMallas(1)], props, true))
    expect(malla).toHaveLength(1)
    expect(malla[0].instanceColor).not.toBeNull()

    const c = new Color()
    malla[0].getColorAt(0, c)
    // `setRGB`/`getColorAt` trabajan en espacio LINEAL: el valor tiene que
    // volver tal cual se escribió. Si alguien lo pasara por sRGB, un 0.25
    // volvería como ~0.53.
    expect(c.r).toBeCloseTo(0.25, 6)
    expect(c.g).toBeCloseTo(0.5, 6)
    expect(c.b).toBeCloseTo(0.75, 6)

    malla[0].getColorAt(1, c)
    expect(c.r).toBeCloseTo(1, 6)
  })

  it('NO tinta cuando el lightmap no se aplicó', () => {
    // Props tintados sobre paredes a albedo pleno es el mismo desajuste al
    // revés: si el mapa se dibuja sin lightmap, los props van sin tinte.
    const props = {
      modelos: ['a.glb'],
      instancias: [
        { modelo: 0, pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number], luz: [0.25, 0.5, 0.75] as [number, number, number] },
      ],
    }
    const malla = instanciados(construirProps([modeloConMallas(1)], props, false))
    expect(malla[0].instanceColor).toBeNull()
  })

  it('deja sin tinte las instancias que no traen `luz`', () => {
    const props = {
      modelos: ['a.glb'],
      instancias: [
        { modelo: 0, pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
      ],
    }
    const malla = instanciados(construirProps([modeloConMallas(1)], props, true))
    expect(malla[0].instanceColor).toBeNull()
  })

  it('ignora una instancia cuyo modelo no se pudo cargar, sin romper el resto', () => {
    const props = {
      modelos: ['a.glb', 'falta.glb'],
      instancias: [
        { modelo: 1, pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
        { modelo: 0, pos: [3, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] },
      ],
    }
    const malla = instanciados(construirProps([modeloConMallas(1)], props, true))
    expect(malla).toHaveLength(1)
    expect(malla[0].count).toBe(1)
  })
})

/**
 * Malla de prueba con volumen real: un cubo de `lado` metros con una
 * esquina en el origen del modelo. `construirProps` sólo mira geometría, y
 * un BufferGeometry vacío (el que usan los tests de arriba) no sirve para
 * verificar nada de colisión.
 */
function cubo(lado: number): Object3D {
  const raiz = new Object3D()
  const geo = new BufferGeometry()
  const [x1, y1, z1] = [lado, lado, lado]
  geo.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        0, 0, 0, 0, y1, 0, 0, y1, z1, 0, 0, 0, 0, y1, z1, 0, 0, z1,
        x1, 0, 0, x1, y1, z1, x1, y1, 0, x1, 0, 0, x1, 0, z1, x1, y1, z1,
        0, 0, 0, x1, 0, z1, x1, 0, 0, 0, 0, 0, 0, 0, z1, x1, 0, z1,
        0, y1, 0, x1, y1, 0, x1, y1, z1, 0, y1, 0, x1, y1, z1, 0, y1, z1,
        0, 0, 0, x1, y1, 0, x1, 0, 0, 0, 0, 0, 0, y1, 0, x1, y1, 0,
        0, 0, z1, x1, 0, z1, x1, y1, z1, 0, 0, z1, x1, y1, z1, 0, y1, z1,
      ],
      3,
    ),
  )
  raiz.add(new Mesh(geo, new MeshBasicMaterial()))
  return raiz
}

/**
 * Panel plano tipo cerca: `ancho` x `alto` x `espesor` con una esquina en
 * el origen del modelo. Es la forma que de verdad importa -- las cercas son
 * el prop que cambia dónde es seguro pararse.
 */
function panel(ancho: number, alto: number, espesor: number): Object3D {
  const raiz = new Object3D()
  const geo = new BufferGeometry()
  const [x1, y1, z1] = [ancho, alto, espesor]
  geo.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        0, 0, 0, 0, y1, 0, 0, y1, z1, 0, 0, 0, 0, y1, z1, 0, 0, z1,
        x1, 0, 0, x1, y1, z1, x1, y1, 0, x1, 0, 0, x1, 0, z1, x1, y1, z1,
        0, 0, 0, x1, y1, 0, x1, 0, 0, 0, 0, 0, 0, y1, 0, x1, y1, 0,
        0, 0, z1, x1, 0, z1, x1, y1, z1, 0, 0, z1, x1, y1, z1, 0, y1, z1,
      ],
      3,
    ),
  )
  raiz.add(new Mesh(geo, new MeshBasicMaterial()))
  return raiz
}

function propsDe(
  posiciones: Array<[number, number, number]>,
): { modelos: string[]; instancias: Array<{ modelo: number; pos: [number, number, number]; quat: [number, number, number, number] }> } {
  return {
    modelos: ['a.glb'],
    instancias: posiciones.map((pos) => ({ modelo: 0, pos, quat: [0, 0, 0, 1] as [number, number, number, number] })),
  }
}

describe('hornearColisionDeProps', () => {
  /**
   * ÉSTE es el bug que la tarea vino a arreglar, y el único test que no se
   * puede saltear: el agente anterior dejó los props fuera del BVH porque
   * "un InstancedMesh no expone sus instancias como triángulos de mundo" y
   * meterlo crudo apilaría las 50 instancias en el origen del modelo.
   *
   * Un test que sólo contara triángulos pasaría con las 50 apiladas. Éste
   * mira DÓNDE quedaron.
   */
  it('expande cada instancia a SU posición de mundo, no al origen del modelo', () => {
    const raiz = construirProps([cubo(1)], propsDe([[10, 0, 0], [-20, 0, 5]]), false)
    const { triangulos } = hornearColisionDeProps(raiz)

    expect(triangulos.length).toBe(36 * 3 * 2) // 12 triángulos x 2 instancias

    let minX = Infinity
    let maxX = -Infinity
    for (let i = 0; i < triangulos.length; i += 3) {
      minX = Math.min(minX, triangulos[i])
      maxX = Math.max(maxX, triangulos[i])
    }
    // Apiladas en el origen, el rango sería [0, 1]. Bien colocadas va de
    // -20 a 11.
    expect(minX).toBeCloseTo(-20, 5)
    expect(maxX).toBeCloseTo(11, 5)
  })

  it('los cuerpos de cada instancia se quedan alrededor de SU prop', () => {
    const raiz = construirProps([cubo(1)], propsDe([[10, 0, 0], [-20, 0, 5]]), false)
    const { convexes } = hornearColisionDeProps(raiz)

    // Ninguna caja puede cruzar de un prop al otro: si la expansión de
    // instancias estuviera mal, saldría un cuerpo estirado de -20 a 11.
    for (const c of convexes) expect(c.max.x - c.min.x).toBeLessThan(2)
    // Y tiene que haber cuerpo en los DOS lugares donde se ve un prop.
    expect(convexes.some((c) => c.min.x >= 9.9 && c.max.x <= 11.1)).toBe(true)
    expect(convexes.some((c) => c.min.x >= -20.1 && c.max.x <= -18.9)).toBe(true)
  })

  it('el cuerpo sólido frena a la cápsula donde se ve el prop, y no antes', () => {
    // Un panel de cerca: 4 m de largo, 1,4 de alto, 6 cm de espesor.
    const raiz = construirProps([panel(4, 1.4, 0.06)], propsDe([[10, 0, 0]]), false)
    const { convexes } = hornearColisionDeProps(raiz)

    // Pegado a la cerca: la cápsula (radio 0,4) la toca.
    expect(convexes.some((c) => capsuleOverlapsConvex(vec3(12, 0, 0.2), PLAYER_CAPSULE, c))).toBe(true)
    // A cinco metros, libre: si esto fallara, el prop tendría un colchón
    // invisible alrededor y "dónde es seguro pararse" sería mentira.
    expect(convexes.some((c) => capsuleOverlapsConvex(vec3(12, 0, 5), PLAYER_CAPSULE, c))).toBe(false)
  })

  it('sin props, ni triángulos ni cuerpos', () => {
    const { triangulos, convexes } = hornearColisionDeProps(new Object3D())
    expect(triangulos.length).toBe(0)
    expect(convexes).toEqual([])
  })
})

/**
 * LA COSTURA. Los tests de arriba prueban que los props se hornean bien;
 * éstos, que lo horneado LLEGA al mapa.
 *
 * No es una distinción académica: con el pegado escrito inline dentro de
 * `cargarMapaExterno` se lo borró a propósito y los 1526 tests del repo
 * siguieron pasando con la colisión de props apagada. Los props se
 * calculaban enteros y se tiraban a la basura, y nada lo veía. Si alguien
 * vuelve a mover esta lógica adentro del cargador, este archivo pierde el
 * único test que distingue "funciona" de "se calcula y se descarta".
 */
describe('aplicarColisionDeProps', () => {
  function defVacio(): MapDef {
    return {
      name: 'test',
      boxes: [],
      convexes: [],
      spawns: [vec3(20, 0, 20)],
      spawnYaws: [0],
      bounds: { min: vec3(-50, -50, -50), max: vec3(50, 50, 50) },
    }
  }

  it('los triángulos de los props QUEDAN en def.triangles, detrás de los del mapa', () => {
    const raiz = construirProps([panel(4, 1.4, 0.06)], propsDe([[10, 0, 0]]), false)
    const colision = hornearColisionDeProps(raiz)
    const def = defVacio()
    // Un triángulo de mapa cualquiera, para verificar que no se pisa.
    const triangulosMapa = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])

    const r = aplicarColisionDeProps(def, triangulosMapa, colision)

    expect(r.triangulosProps).toBeGreaterThan(0)
    expect(def.triangles).toBeDefined()
    // El total es mapa + props: si los props no se sumaran, sería 9.
    expect(def.triangles?.length).toBe(triangulosMapa.length + colision.triangulos.length)
    // Los del mapa siguen adelante, intactos.
    expect(Array.from((def.triangles as Float32Array).slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    // Y hay geometría de props allá donde está el prop (x ~ 10..14).
    let maxX = -Infinity
    for (let i = 0; i < (def.triangles as Float32Array).length; i += 3) {
      maxX = Math.max(maxX, (def.triangles as Float32Array)[i])
    }
    expect(maxX).toBeGreaterThan(9)
  })

  it('los cuerpos QUEDAN en def.convexes sin borrar los brushes del mapa', () => {
    const raiz = construirProps([panel(4, 1.4, 0.06)], propsDe([[10, 0, 0]]), false)
    const colision = hornearColisionDeProps(raiz)
    const def = defVacio()
    const brushDelMapa = convexDeCaja({ min: vec3(-30, 0, -30), max: vec3(-29, 3, -29) })
    def.convexes = [brushDelMapa]

    const r = aplicarColisionDeProps(def, new Float32Array(0), colision)

    expect(r.cuerpos).toBeGreaterThan(0)
    expect(def.convexes).toHaveLength(1 + colision.convexes.length)
    expect(def.convexes?.[0]).toBe(brushDelMapa)
    // El jugador parado contra la cerca choca contra ALGO de la lista final
    // del mapa -- que es la lista que ve la cápsula y el navgrid.
    expect(
      (def.convexes ?? []).some((c) => capsuleOverlapsConvex(vec3(12, 0, 0.2), PLAYER_CAPSULE, c)),
    ).toBe(true)
  })

  it('llamarla dos veces no apila los props sobre sí mismos', () => {
    const raiz = construirProps([panel(4, 1.4, 0.06)], propsDe([[10, 0, 0]]), false)
    const colision = hornearColisionDeProps(raiz)
    const def = defVacio()
    const triangulosMapa = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])

    aplicarColisionDeProps(def, triangulosMapa, colision)
    const largoUnaVez = def.triangles?.length
    aplicarColisionDeProps(def, triangulosMapa, colision)

    // Los triángulos se recomponen desde `triangulosMapa`, no se acumulan.
    expect(def.triangles?.length).toBe(largoUnaVez)
  })
})

describe('filtrarSpawnsPorProps', () => {
  function defCon(spawns: Array<[number, number, number]>): MapDef {
    return {
      name: 'test',
      boxes: [],
      convexes: [],
      spawns: spawns.map((s) => vec3(s[0], s[1], s[2])),
      spawnYaws: spawns.map((_, i) => i),
      bounds: { min: vec3(-50, -50, -50), max: vec3(50, 50, 50) },
    }
  }

  it('descarta el spawn que quedó adentro de un prop y CONSERVA su yaw pareado', () => {
    // El spawn 1 cae contra la cerca; los otros dos, lejos.
    const raiz = construirProps([panel(4, 1.4, 0.06)], propsDe([[0, 0, 0]]), false)
    const { convexes } = hornearColisionDeProps(raiz)
    const def = defCon([[20, 0, 20], [2, 0, 0], [-20, 0, -20]])

    expect(filtrarSpawnsPorProps(def, convexes)).toBe(1)
    expect(def.spawns).toHaveLength(2)
    // Los yaws se reindexan por el spawn del que salieron: si se
    // recortaran por posición en la lista ya filtrada, acá saldría [0, 1].
    expect(def.spawnYaws).toEqual([0, 2])
  })

  it('si TODOS caen adentro, no borra ninguno (una lista vacía es pantalla negra)', () => {
    const raiz = construirProps([panel(4, 1.4, 0.06)], propsDe([[0, 0, 0]]), false)
    const { convexes } = hornearColisionDeProps(raiz)
    const def = defCon([[2, 0, 0]])

    filtrarSpawnsPorProps(def, convexes)
    expect(def.spawns).toHaveLength(1)
  })

  it('sin props no toca nada', () => {
    const def = defCon([[1, 0, 1]])
    expect(filtrarSpawnsPorProps(def, [])).toBe(0)
    expect(def.spawns).toHaveLength(1)
  })
})
