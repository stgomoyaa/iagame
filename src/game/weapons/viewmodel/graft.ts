/**
 * Injerto de brazos: le pone los brazos de un viewmodel de CS (`v_`) a las 69
 * armas de Call of Duty, que llegan como UNA malla rígida y sin esqueleto.
 *
 * El problema, medido y no supuesto (ver docs/BRAZOS.md): los 39 `.glb` de CS
 * traen `weapon_arms` + `weapon_body` skinneados a un esqueleto Bip01 con
 * dedos completos y 4 clips (`draw`/`fire`/`idle`/`reload`); los 69 de COD
 * traen sólo `weapon_body`, 0 skins y 0 clips. En Call of Duty los brazos son
 * un modelo aparte que el motor compone, así que no están en el archivo del
 * arma y no hay nada que "arreglar" en la conversión: hay que traerlos.
 *
 * ## Por qué se injerta en RUNTIME y no se hornea un GLB por arma
 *
 * La alternativa era exportar 69 archivos nuevos, cada uno con su copia de los
 * brazos. Se descartó por PESO, que es un límite declarado del proyecto:
 * `weapons-local/` pesa 148 MB y los brazos de un donante son ~11k triángulos
 * más el esqueleto y los 4 clips (entre 0,6 y 1,0 MB por arma). Multiplicado
 * por 69 son ~50-70 MB extra, un +40% del directorio entero, para duplicar 10
 * veces la misma geometría.
 *
 * Injertando en runtime los 69 comparten los mismos 10 donantes que YA están
 * en disco: 0 MB agregados, una sola copia de cada malla de brazos en GPU, y
 * la alineación queda en código —o sea, ajustable— en vez de horneada en un
 * binario que habría que reconvertir para mover un milímetro.
 *
 * ## Cómo se elige el hueso del que cuelga el arma
 *
 * NO por nombre. La tentación era `<arma>_parent`, que existe en el AK, pero
 * se midió sobre los 17 donantes candidatos y NO es una convención: famas,
 * sg553, nova, m249, xm1014, ump45, g3sg1 y aug no tienen ningún hueso
 * `_parent`, la usps lo llama `223_parent` y la scar20 reusa `ak47_parent` del
 * modelo del que la derivaron. Un injerto por nombre habría funcionado en el
 * arma con la que se probó y fallado en la mitad del catálogo.
 *
 * Se elige por PESO DE SKIN: el hueso que más influencia acumula sobre los
 * vértices de `weapon_body` es, por definición, el que movía el arma en la
 * animación original. Eso no depende de cómo se llame nada.
 */

import { Box3, Matrix4, Mesh, Object3D, SkinnedMesh, Vector3 } from 'three'

import type { ArchetypeId } from '@/game/weapons/archetypes'

/** Nombre de la malla del arma en los `v_` de Source (ver renderer.ts). */
const BODY_NODE_NAME = 'weapon_body'

/**
 * Donante de brazos por arquetipo.
 *
 * Se elige POR CLASE y no uno solo para todas por una razón geométrica, no
 * estética: la alineación de más abajo apoya el arma de COD sobre la caja del
 * arma del donante, así que cuanto más parecidas son las proporciones de las
 * dos, más cerca caen la empuñadura y el guardamanos de donde están las manos.
 * Un AK de COD sobre el donante AK agarra bien; ese mismo AK sobre el donante
 * de pistola quedaría con las manos juntas en el medio del cañón.
 *
 * Que los brazos cambien según el arma es además lo que pidió el dueño
 * explícitamente ("los mismos brazos que ya funcionan y que vayan cambiando").
 */
const DONOR_BY_ARCHETYPE: Readonly<Record<ArchetypeId, string>> = {
  'ar-1': 'ak47',
  'ar-2': 'famas',
  'ar-3': 'sg553',
  'smg-1': 'mac10',
  'smg-2': 'mp5sd',
  'sniper-bolt': 'awp',
  'sniper-marksman': 'g3sg1',
  shotgun: 'nova',
  lmg: 'm249',
  pistol: 'glock18',
}

/** Donante de brazos para un arquetipo. */
export function selectDonor(archetype: ArchetypeId): string {
  return DONOR_BY_ARCHETYPE[archetype]
}

/** Todos los donantes usados, sin repetir: sirve para precargar. */
export function donorSlugs(): string[] {
  return [...new Set(Object.values(DONOR_BY_ARCHETYPE))]
}

/**
 * Índice del hueso que MÁS influencia acumula sobre la malla, o -1 si la malla
 * no tiene atributos de skin.
 *
 * Suma los pesos por hueso sobre todos los vértices y devuelve el máximo. Los
 * cuatro canales de `skinWeight` se recorren enteros a propósito: quedarse con
 * el canal 0 daría el hueso "principal" de cada vértice, que en las zonas de
 * transición (donde el cargador se mezcla con el cuerpo) no es el hueso del
 * arma sino el de la pieza móvil.
 */
export function dominantBoneIndex(mesh: SkinnedMesh): number {
  const index = mesh.geometry.getAttribute('skinIndex')
  const weight = mesh.geometry.getAttribute('skinWeight')
  if (!index || !weight) return -1

  const totals = new Map<number, number>()
  for (let v = 0; v < index.count; v++) {
    for (let c = 0; c < 4; c++) {
      const w = weight.getComponent(v, c)
      if (w <= 0) continue
      const b = index.getComponent(v, c)
      totals.set(b, (totals.get(b) ?? 0) + w)
    }
  }

  let best = -1
  let bestWeight = -1
  for (const [bone, total] of totals) {
    if (total > bestWeight) {
      bestWeight = total
      best = bone
    }
  }
  return best
}

/**
 * Matriz que lleva la geometría del arma de COD a donde estaba la del donante.
 *
 * Es una semejanza (rotación + escala uniforme + traslación), nunca una escala
 * por eje: estirar el arma para que su caja calce exacto con la del donante la
 * deformaría, y un AK aplastado se ve peor que un AK dos centímetros corrido.
 *
 * La rotación es fija y vale `yaw`, que el llamador pasa como -SOURCE_VIEWMODEL_YAW.
 * El motivo: los `.glb` de COD ya salen orientados para dibujarse SIN el cuarto
 * de vuelta que renderer.ts le aplica a los viewmodels de Source (por eso el
 * camino estático usa yaw 0). Al colgarlos adentro de la jerarquía del donante
 * van a comerse ese cuarto de vuelta igual, así que hay que descontarlo acá.
 * Deducirlo de la caja es imposible: una caja es simétrica y no distingue
 * "cañón adelante" de "culata adelante".
 *
 * La escala sale del EJE LARGO y no del volumen ni del promedio de los tres
 * ejes: lo que tiene que coincidir para que las manos caigan en la empuñadura
 * y en el guardamanos es el LARGO del arma. Un fusil con mira telescópica es
 * mucho más alto que uno de hierros y eso no debe encoger el arma entera.
 */
export function alignmentMatrix(donorBox: Box3, codBox: Box3, yaw: number): Matrix4 {
  const rotation = new Matrix4().makeRotationY(yaw)

  // La caja del arma de COD DESPUÉS de rotar: girar 90° sobre Y intercambia
  // los ejes X y Z, así que medir el largo sobre la caja sin rotar tomaría el
  // eje equivocado y la escala saldría con el factor de otro eje.
  const rotated = codBox.clone().applyMatrix4(rotation)

  const donorSize = donorBox.getSize(new Vector3())
  const codSize = rotated.getSize(new Vector3())

  const donorLong = Math.max(donorSize.x, donorSize.y, donorSize.z)
  const codLong = Math.max(codSize.x, codSize.y, codSize.z)
  // Una malla degenerada (todo en un punto) daría división por cero y una
  // matriz con NaN, que en Three se propaga a toda la jerarquía y hace
  // desaparecer los brazos TAMBIÉN. Ante la duda no se escala.
  const scale = codLong > 1e-6 && donorLong > 1e-6 ? donorLong / codLong : 1

  // Centro contra centro. Es la alineación honesta con lo que se sabe: sin
  // marcar a mano la empuñadura de cada una de las 69 no hay forma de saber
  // dónde agarra cada arma, y el centro de la caja es el único punto que las
  // dos comparten por construcción.
  const donorCenter = donorBox.getCenter(new Vector3())
  const codCenter = rotated.getCenter(new Vector3()).multiplyScalar(scale)

  return new Matrix4()
    .makeTranslation(
      donorCenter.x - codCenter.x,
      donorCenter.y - codCenter.y,
      donorCenter.z - codCenter.z,
    )
    .multiply(new Matrix4().makeScale(scale, scale, scale))
    .multiply(rotation)
}

/** La malla `weapon_body` de una escena, o null si no está. */
export function findBody(scene: Object3D): Mesh | null {
  let found: Mesh | null = null
  scene.traverse((child) => {
    if (found === null && child instanceof Mesh && child.name === BODY_NODE_NAME) found = child
  })
  return found
}

/** Resultado del injerto, para que el llamador sepa qué quedó en la escena. */
export interface GraftResult {
  /** La escena del donante, ya con el arma de COD adentro. */
  scene: Object3D
  /** La malla del arma injertada: es a la que se le engancha el camo. */
  body: Mesh
}

/**
 * Cuelga `codBody` del esqueleto de `donorScene` en el lugar que ocupaba el
 * arma del donante, y esconde el arma del donante.
 *
 * Devuelve null si la escena del donante no sirve como tal (sin `weapon_body`
 * skinneado, sin esqueleto o sin hueso dominante). Devolver null y no lanzar es
 * deliberado: el llamador ya tiene un camino estático que funciona, y un arma
 * sin brazos se ve peor que antes pero se ve; una excepción adentro del `.then`
 * del loader la haría desaparecer entera.
 */
export function graftArms(donorScene: Object3D, codBody: Mesh): GraftResult | null {
  const donorBody = findBody(donorScene)
  if (donorBody === null || !(donorBody instanceof SkinnedMesh)) return null

  const skeleton = donorBody.skeleton
  if (!skeleton) return null

  const boneIndex = dominantBoneIndex(donorBody)
  if (boneIndex < 0) return null
  const bone = skeleton.bones[boneIndex]
  const boneInverse = skeleton.boneInverses[boneIndex]
  if (!bone || !boneInverse) return null

  // Las dos cajas se miden en el MISMO espacio (el de bind de la malla del
  // donante, que es donde viven los vértices de una malla skinneada antes de
  // que el esqueleto los mueva). Por eso se usa la geometría cruda de las dos
  // y no `setFromObject`, que aplicaría los transforms de nodo y mezclaría
  // espacios distintos.
  donorBody.geometry.computeBoundingBox()
  codBody.geometry.computeBoundingBox()
  const donorBox = donorBody.geometry.boundingBox
  const codBox = codBody.geometry.boundingBox
  if (!donorBox || !codBox) return null

  const align = alignmentMatrix(donorBox, codBox, -Math.PI / 2)

  // El transform local del hijo respecto del hueso. La identidad que lo
  // justifica: colgado del hueso, el mundo de la malla es
  // `mundoDelHueso * local`; en pose de bind `mundoDelHueso` es exactamente la
  // inversa de `boneInverse`, así que con `local = boneInverse * align` la
  // malla cae en `align` —donde estaba el arma del donante— y a partir de ahí
  // sigue al hueso en cada frame de la animación sin más trabajo.
  const local = new Matrix4().multiplyMatrices(boneInverse, align)

  codBody.matrixAutoUpdate = false
  codBody.matrix.copy(local)
  codBody.matrix.decompose(codBody.position, codBody.quaternion, codBody.scale)
  bone.add(codBody)

  // El arma del donante se esconde en vez de borrarse: es una SkinnedMesh y su
  // esqueleto es el mismo objeto que mueve los brazos. Sacarla del grafo es lo
  // que en este archivo ya se documenta como el error que rompe el skinning.
  donorBody.visible = false

  return { scene: donorScene, body: codBody }
}
