import {
  Bone,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'

import { ARCHETYPES, type ArchetypeId } from '@/game/weapons/archetypes'
import {
  alignmentMatrix,
  donorSlugs,
  dominantBoneIndex,
  findBodyMeshes,
  graftArms,
  selectDonor,
} from '@/game/weapons/viewmodel/graft'

const YAW = -Math.PI / 2

/** Caja alineada a los ejes, en la forma en que la devuelve la geometría. */
function box(min: [number, number, number], max: [number, number, number]): Box3 {
  return new Box3(new Vector3(...min), new Vector3(...max))
}

/**
 * Malla skinneada mínima: una caja de 8 vértices repartida entre dos huesos,
 * con el reparto de pesos que se le pase. Es lo que hace falta para probar la
 * elección de hueso sin depender de ningún .glb.
 */
function skinnedBox(
  weightsPerVertex: readonly (readonly [number, number, number, number])[],
  indicesPerVertex: readonly (readonly [number, number, number, number])[],
  size: [number, number, number] = [1, 1, 1],
): { mesh: SkinnedMesh; bones: Bone[] } {
  const count = weightsPerVertex.length
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // Los vértices se reparten entre el origen y `size` para que la caja
    // envolvente tenga exactamente las medidas pedidas.
    positions[i * 3] = i % 2 === 0 ? 0 : size[0]
    positions[i * 3 + 1] = Math.floor(i / 2) % 2 === 0 ? 0 : size[1]
    positions[i * 3 + 2] = Math.floor(i / 4) % 2 === 0 ? 0 : size[2]
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute(
    'skinIndex',
    new BufferAttribute(new Uint16Array(indicesPerVertex.flat()), 4),
  )
  geometry.setAttribute(
    'skinWeight',
    new BufferAttribute(new Float32Array(weightsPerVertex.flat()), 4),
  )

  const bones = [new Bone(), new Bone()]
  bones[0].add(bones[1])
  // El segundo hueso desplazado: si el injerto se colgara del hueso equivocado
  // el arma caería corrida por esta misma distancia, que es lo que detecta el
  // test de posición.
  bones[1].position.set(10, 0, 0)
  bones[0].updateMatrixWorld(true)

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  mesh.name = 'weapon_body'
  mesh.add(bones[0])
  mesh.bind(new Skeleton(bones))
  mesh.updateMatrixWorld(true)
  return { mesh, bones }
}

/**
 * Malla rígida centrada en el origen, con la caja que se le pida. Como llegan
 * las de COD: medidas sobre los .glb reales, las 69 tienen la caja de
 * `weapon_body` centrada exactamente en (0,0,0).
 */
function codBox(size: [number, number, number]): Mesh {
  const [sx, sy, sz] = size
  const positions = new Float32Array([
    -sx / 2, -sy / 2, -sz / 2,
    sx / 2, sy / 2, sz / 2,
  ])
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.name = 'weapon_body'
  return mesh
}

/** Dónde cae un punto de la malla de COD, en el espacio del donante. */
function trasInjerto(cod: Mesh, punto: [number, number, number]): Vector3 {
  return new Vector3(...punto).applyMatrix4(cod.matrixWorld)
}

/** Malla rígida con una caja envolvente conocida, como llegan las de COD. */
function rigidBox(size: [number, number, number], offset: [number, number, number]): Mesh {
  const positions = new Float32Array([
    offset[0],
    offset[1],
    offset[2],
    offset[0] + size[0],
    offset[1] + size[1],
    offset[2] + size[2],
  ])
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.name = 'weapon_body'
  return mesh
}

describe('selectDonor', () => {
  it('da un donante para cada uno de los 10 arquetipos', () => {
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      expect(selectDonor(id), `arquetipo ${id} sin donante`).toBeTruthy()
    }
  })

  it('reparte los donantes por clase en vez de usar uno solo', () => {
    // El pedido era que los brazos "vayan cambiando". Un solo donante para
    // todo el catálogo cumpliría el resto de los tests y no esto.
    expect(donorSlugs().length).toBeGreaterThan(1)
  })
})

describe('alignmentMatrix', () => {
  it('deja el centro del arma de COD sobre el centro del arma del donante', () => {
    const donor = box([-0.04, -0.12, -0.22], [0.017, 0.088, 0.499])
    const cod = box([-0.03, -0.13, -0.43], [0.021, 0.121, 0.42])

    const centro = cod.getCenter(new Vector3()).applyMatrix4(alignmentMatrix(donor, cod, YAW))

    const esperado = donor.getCenter(new Vector3())
    expect(centro.x).toBeCloseTo(esperado.x, 6)
    expect(centro.y).toBeCloseTo(esperado.y, 6)
    expect(centro.z).toBeCloseTo(esperado.z, 6)
  })

  it('escala uniforme: el arma no se deforma', () => {
    // Cajas con relaciones de aspecto distintas a propósito. Una escala por eje
    // las haría calzar exacto en los tres; una semejanza no, y es lo correcto.
    const donor = box([0, 0, 0], [0.05, 0.2, 0.72])
    const cod = box([0, 0, 0], [0.4, 0.3, 0.05])

    const m = alignmentMatrix(donor, cod, YAW)
    const escala = new Vector3().setFromMatrixScale(m)

    expect(escala.x).toBeCloseTo(escala.y, 6)
    expect(escala.y).toBeCloseTo(escala.z, 6)
  })

  it('saca la escala del eje LARGO, no del alto ni del volumen', () => {
    // Donante de 0,72 de largo; arma de COD de 0,90 de largo sobre su eje X
    // (que tras el cuarto de vuelta pasa a ser el eje largo Z).
    const donor = box([0, 0, 0], [0.05, 0.2, 0.72])
    const cod = box([0, 0, 0], [0.9, 0.5, 0.05])

    const escala = new Vector3().setFromMatrixScale(alignmentMatrix(donor, cod, YAW))

    expect(escala.x).toBeCloseTo(0.72 / 0.9, 5)
  })

  it('una malla degenerada no produce NaN', () => {
    // Un NaN acá se propaga por toda la jerarquía de Three y hace desaparecer
    // TAMBIÉN los brazos, así que el caso vale un test propio.
    const donor = box([0, 0, 0], [0.05, 0.2, 0.72])
    const punto = box([1, 1, 1], [1, 1, 1])

    const m = alignmentMatrix(donor, punto, YAW)

    expect(m.elements.every((v) => Number.isFinite(v))).toBe(true)
  })
})

describe('dominantBoneIndex', () => {
  it('elige el hueso con más peso acumulado', () => {
    const { mesh } = skinnedBox(
      Array.from({ length: 8 }, () => [1, 0, 0, 0] as const),
      Array.from({ length: 8 }, () => [1, 0, 0, 0] as const),
    )
    expect(dominantBoneIndex(mesh)).toBe(1)
  })

  it('suma los cuatro canales, no sólo el primero', () => {
    // Cada vértice tiene al hueso 0 en el canal 0 con peso chico y al hueso 1
    // repartido en los otros tres canales sumando más. Mirar sólo el canal 0
    // —el atajo que parece razonable— elegiría el hueso 0, que es el del
    // cargador y no el del arma.
    const { mesh } = skinnedBox(
      Array.from({ length: 8 }, () => [0.4, 0.2, 0.2, 0.2] as const),
      Array.from({ length: 8 }, () => [0, 1, 1, 1] as const),
    )
    expect(dominantBoneIndex(mesh)).toBe(1)
  })

  it('devuelve -1 si la malla no tiene atributos de skin', () => {
    const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial())
    expect(dominantBoneIndex(mesh)).toBe(-1)
  })
})

describe('graftArms', () => {
  it('cuelga el arma del hueso dominante y esconde la del donante', () => {
    const { mesh: donorBody, bones } = skinnedBox(
      Array.from({ length: 8 }, () => [1, 0, 0, 0] as const),
      Array.from({ length: 8 }, () => [1, 0, 0, 0] as const),
    )
    const cod = rigidBox([1, 1, 1], [0, 0, 0])

    const result = graftArms(donorBody, cod)

    expect(result).not.toBeNull()
    // El hueso 1 es el dominante según los pesos de arriba.
    expect(cod.parent).toBe(bones[1])
    expect(donorBody.visible).toBe(false)
  })

  it('en pose de bind el arma cae donde estaba la del donante', () => {
    // Éste es el invariante que importa: si falla, el arma aparece corrida o
    // rotada respecto de las manos, que es exactamente el defecto que el
    // injerto viene a arreglar.
    const { mesh: donorBody } = skinnedBox(
      Array.from({ length: 8 }, () => [1, 0, 0, 0] as const),
      Array.from({ length: 8 }, () => [1, 0, 0, 0] as const),
      [0.05, 0.2, 0.72],
    )
    const cod = rigidBox([0.9, 0.3, 0.05], [-0.45, -0.15, 0])

    expect(graftArms(donorBody, cod)).not.toBeNull()

    donorBody.updateMatrixWorld(true)
    cod.geometry.computeBoundingBox()
    const centro = cod.geometry
      .boundingBox!.getCenter(new Vector3())
      .applyMatrix4(cod.matrixWorld)

    donorBody.geometry.computeBoundingBox()
    const esperado = donorBody.geometry
      .boundingBox!.getCenter(new Vector3())
      .applyMatrix4(donorBody.matrixWorld)

    expect(centro.x).toBeCloseTo(esperado.x, 5)
    expect(centro.y).toBeCloseTo(esperado.y, 5)
    expect(centro.z).toBeCloseTo(esperado.z, 5)
  })

  it('la boca del arma de COD queda del lado de la boca del donante', () => {
    // EL test de este archivo, y el que faltaba: el injerto llegó a producción
    // con el arma dada vuelta —apuntando hacia atrás, a la cara del jugador—
    // y NINGÚN test lo vio. El motivo es que el resto de las aserciones miran
    // el CENTRO de la caja, y una media vuelta sobre el centro deja el centro
    // donde estaba: son ciegas al sentido por construcción.
    //
    // Convenciones, ambas medidas sobre los .glb reales (ver GRAFT_YAW):
    //   donante de CS -> boca en +Z (hueso `flash` del propio archivo)
    //   arma de COD   -> boca en -Z
    // Así que la punta -Z del arma de COD tiene que terminar en la punta +Z
    // del donante. Sin la media vuelta cae en la contraria y este test falla.
    const largoDonante = 0.72
    const { mesh: donorBody } = skinnedBox(
      Array.from({ length: 8 }, () => [1, 0, 0, 0] as const),
      Array.from({ length: 8 }, () => [1, 0, 0, 0] as const),
      [0.05, 0.2, largoDonante],
    )
    // `skinnedBox` reparte los vértices entre 0 y el tamaño pedido, así que la
    // boca del donante (+Z) está en z = largoDonante y la culata en z = 0.
    const cod = codBox([0.05, 0.2, 0.9])

    expect(graftArms(donorBody, cod)).not.toBeNull()
    donorBody.updateMatrixWorld(true)

    const boca = trasInjerto(cod, [0, 0, -0.45])
    const culata = trasInjerto(cod, [0, 0, 0.45])

    expect(boca.z).toBeCloseTo(largoDonante, 5)
    expect(culata.z).toBeCloseTo(0, 5)
    // Redundante con lo de arriba pero es la frase que importa si algún día
    // cambian los números: la boca queda MÁS ADELANTE que la culata.
    expect(boca.z).toBeGreaterThan(culata.z)
  })

  it('encuentra el cuerpo cuando viene partido en varias primitivas', () => {
    // Regresión: una malla glTF con varias primitivas llega a Three como un
    // Group llamado `weapon_body` con una SkinnedMesh por primitiva adentro,
    // no como una SkinnedMesh. Exigir que `weapon_body` FUERA la SkinnedMesh
    // encontraba el Group y devolvía null, y así se caían 4 de los 10
    // donantes: awp, nova, g3sg1 y sg553 — o sea el francotirador, la
    // escopeta, el tirador designado y el fusil de batalla, enteros.
    const { mesh: donorBody } = skinnedBox(
      Array.from({ length: 8 }, () => [1, 0, 0, 0] as const),
      Array.from({ length: 8 }, () => [1, 0, 0, 0] as const),
    )
    // Se replica la forma que arma GLTFLoader: el nombre pasa al grupo y la
    // malla queda adentro.
    const grupo = new Object3D()
    grupo.name = 'weapon_body'
    donorBody.name = 'weapon_body_1'
    const raiz = new Object3D()
    raiz.add(grupo)
    grupo.add(donorBody)

    expect(findBodyMeshes(raiz)).toHaveLength(1)
    expect(graftArms(raiz, rigidBox([1, 1, 1], [0, 0, 0]))).not.toBeNull()
  })

  it('devuelve null si el donante no tiene weapon_body skinneado', () => {
    const suelto = rigidBox([1, 1, 1], [0, 0, 0])
    expect(graftArms(suelto, rigidBox([1, 1, 1], [0, 0, 0]))).toBeNull()
  })
})
