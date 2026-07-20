/**
 * Pipeline de conversión de personajes: glTF de Quaternius -> GLB de juego.
 *
 *   node scripts/convert-characters.ts <dir_entrada> <dir_salida> [--force]
 *
 * El pack "Ultimate Modular Men" trae cada personaje como un .gltf
 * autocontenido: malla partida en 4-5 sub-mallas (Body/Head/Legs/Feet), 7-11
 * materiales de color plano, esqueleto de 62 huesos y las 24 animaciones del
 * pack embebidas en CADA archivo. Servir eso tal cual costaría ~3.4 MB y 13
 * draw calls POR BOT, con las mismas animaciones repetidas 4 veces.
 *
 * Qué hace este script:
 *
 *   1. Poda los huesos de dedos (38 de 62). Un dedo no se distingue a
 *      distancia de combate, pero cada uno cuesta una matriz de hueso por
 *      frame y una pista por clip de animación. Los pesos de un hueso podado
 *      se reasignan a su ancestro vivo (Wrist.L/R), así que la malla no se
 *      deforma: la mano queda rígida y nada más. 62 -> 24 huesos.
 *   2. Fusiona todas las sub-mallas en UN primitivo. Comparten esqueleto y
 *      transform identidad, así que se pueden concatenar; join() de
 *      gltf-transform se niega a tocar mallas skinneadas, por eso la fusión
 *      es manual. 13 draw calls -> 1 por bot.
 *   3. Hornea el color de cada material en COLOR_0 (RGB) y, en el canal
 *      ALPHA, una máscara de equipo: 0 = piel/ojos (nunca se tiñe), 1 =
 *      ropa y equipo (lo que el shader tiñe del color del equipo). Es lo que
 *      permite un solo material por equipo sin perder la cara humana --
 *      ver bots/character-material.ts.
 *   4. Cuantiza posiciones/normales/pesos y deja el material unlit: el spec
 *      prohíbe el costo de PBR.
 *
 * Las animaciones NO viajan en el personaje: se extraen una sola vez a
 * `animations.glb` (mismos nombres de hueso en los 4 personajes, así que un
 * clip sirve para todos) y el renderer las comparte entre bots.
 *
 * Es idempotente: salta lo ya convertido salvo que se pase --force.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join as joinPath } from 'node:path'
import { Document, NodeIO, type Node as GltfNode } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, quantize, unlit, weld } from '@gltf-transform/functions'

/** Huesos de dedos: `Index1.L`, `Thumb3.R`, etc. */
const HUESO_DEDO = /^(Index|Middle|Ring|Pinky|Thumb)\d/i

/** Materiales que NUNCA se tiñen del color de equipo: piel, ojos y cejas.
 *  Todo lo demás (ropa, chaleco, botas, casco) es superficie de equipo. */
const MATERIAL_PIEL = /skin|eye/i

/**
 * Clips que se quedan, de los 24 del pack. El resto (espada, hechizo, nadar,
 * bailar, sentarse) no tiene ningún estado de la FSM que los dispare.
 * `Idle_Gun` y no `Idle` a propósito: el bot siempre está armado.
 */
const CLIPS = ['Idle_Gun', 'Run', 'Walk', 'Death', 'Gun_Shoot'] as const

/** Nombre del clip tal como viene en el pack: `CharacterArmature|Run`. */
function nombreClip(nombre: string): string {
  const barra = nombre.lastIndexOf('|')
  return barra === -1 ? nombre : nombre.slice(barra + 1)
}

/**
 * Borra una animación junto con sus canales y samplers.
 *
 * Disposing la animación sola NO alcanza: los samplers sobreviven sujetando
 * los accessors de keyframes, prune() ya no los ve como huérfanos y los 24
 * clips del pack terminan viajando dentro de cada personaje aunque no tenga
 * ninguna animación. Son ~315 KB por archivo, más de un tercio del GLB.
 */
function borrarAnimacion(anim: ReturnType<Document['createAnimation']>): void {
  for (const canal of anim.listChannels()) canal.dispose()
  for (const sampler of anim.listSamplers()) sampler.dispose()
  anim.dispose()
}

/**
 * Poda los huesos de dedos del skin y devuelve el mapa `índice viejo ->
 * índice nuevo` para reescribir JOINTS_0. Un hueso podado apunta al índice
 * de su ancestro vivo, de modo que su peso no se pierde: se transfiere.
 */
function podarDedos(doc: Document): { mapa: Int32Array; quitados: Set<GltfNode> } {
  const skin = doc.getRoot().listSkins()[0]
  if (!skin) throw new Error('el personaje no tiene skin')

  const huesos = skin.listJoints()
  const quitados = new Set(huesos.filter((h) => HUESO_DEDO.test(h.getName())))
  const vivos = huesos.filter((h) => !quitados.has(h))
  const indiceVivo = new Map<GltfNode, number>()
  vivos.forEach((h, i) => indiceVivo.set(h, i))

  // Cada hueso viejo -> el índice del primer ancestro que sobrevive.
  const mapa = new Int32Array(huesos.length)
  for (let i = 0; i < huesos.length; i++) {
    let nodo: GltfNode | null = huesos[i]
    while (nodo !== null && quitados.has(nodo)) nodo = nodo.getParentNode()
    mapa[i] = nodo !== null ? (indiceVivo.get(nodo) ?? 0) : 0
  }

  // Las matrices de bind se reordenan a mano: el accessor es un array plano
  // de 16 floats por hueso y su orden TIENE que seguir al de listJoints().
  const ibm = skin.getInverseBindMatrices()
  if (ibm !== null) {
    const viejo = ibm.getArray()
    if (viejo !== null) {
      const nuevo = new Float32Array(vivos.length * 16)
      vivos.forEach((h, destino) => {
        const origen = huesos.indexOf(h)
        nuevo.set(viejo.subarray(origen * 16, origen * 16 + 16), destino * 16)
      })
      ibm.setArray(nuevo)
    }
  }

  for (const hueso of quitados) skin.removeJoint(hueso)
  return { mapa, quitados }
}

/** Concatena arrays tipados en uno solo. El tipo de salida lo fija `crear`,
 *  no las partes: lo que devuelve `Accessor.getArray()` está tipado sobre
 *  ArrayBufferLike y no encaja en el `setArray()` de vuelta. */
function concatenar<T extends Float32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>>(
  partes: ArrayLike<number>[],
  crear: (n: number) => T,
): T {
  let total = 0
  for (const p of partes) total += p.length
  const salida = crear(total)
  let offset = 0
  for (const p of partes) {
    salida.set(p, offset)
    offset += p.length
  }
  return salida
}

/**
 * Fusiona todos los primitivos skinneados en uno solo, horneando el color
 * del material en COLOR_0 y remapeando JOINTS_0 según `mapa`. Cuando dos
 * influencias de un vértice caen en el mismo hueso tras el remapeo (los
 * cuatro huesos de un dedo colapsan en la muñeca), sus pesos se suman en vez
 * de perderse: si no, la mano adelgazaría al deformarse.
 */
function fusionar(doc: Document, mapa: Int32Array): void {
  const root = doc.getRoot()
  const buffer = root.listBuffers()[0]
  const material = doc.createMaterial('personaje').setBaseColorFactor([1, 1, 1, 1])
  const nodos = root.listNodes().filter((n) => n.getMesh() !== null && n.getSkin() !== null)
  const skin = nodos[0].getSkin()

  const posiciones: Float32Array[] = []
  const normales: Float32Array[] = []
  const huesos: Uint8Array[] = []
  const pesos: Float32Array[] = []
  const colores: Uint8Array[] = []
  const indices: number[] = []
  let base = 0

  for (const nodo of nodos) {
    const malla = nodo.getMesh()
    if (malla === null) continue
    for (const prim of malla.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (pos === null) continue
      const n = pos.getCount()

      posiciones.push(new Float32Array(pos.getArray() as Float32Array))
      const nor = prim.getAttribute('NORMAL')
      normales.push(
        nor !== null ? new Float32Array(nor.getArray() as Float32Array) : new Float32Array(n * 3),
      )

      // Color plano del material + máscara de equipo en alpha.
      //
      // El RGB no es el color pelado del material: se le hornea un término
      // direccional a partir de la normal del vértice. El material de
      // runtime es MeshBasicMaterial (unlit, el spec no paga PBR), así que
      // sin esto el personaje sale como una calcomanía plana de un solo
      // tono por prenda y deja de leerse como un cuerpo. Horneado acá sale
      // gratis en frame y además permite tirar el atributo NORMAL después
      // (~65 KB por personaje), porque ya nadie lo necesita.
      const mat = prim.getMaterial()
      const f = mat !== null ? mat.getBaseColorFactor() : [1, 1, 1, 1]
      const esPiel = mat !== null && MATERIAL_PIEL.test(mat.getName())
      const color = new Uint8Array(n * 4)
      const normal = normales[normales.length - 1]
      for (let i = 0; i < n; i++) {
        // Luz de hemisferio: cenital, con piso alto para que nada quede
        // negro (no hay relleno ambiental que lo rescate después).
        const ny = normal[i * 3 + 1]
        const luz = 0.58 + 0.42 * (ny * 0.5 + 0.5)
        color[i * 4] = Math.round(Math.min(1, f[0] * luz) * 255)
        color[i * 4 + 1] = Math.round(Math.min(1, f[1] * luz) * 255)
        color[i * 4 + 2] = Math.round(Math.min(1, f[2] * luz) * 255)
        color[i * 4 + 3] = esPiel ? 0 : 255
      }
      colores.push(color)

      // Remapeo de huesos con suma de pesos colapsados.
      const jAttr = prim.getAttribute('JOINTS_0')
      const wAttr = prim.getAttribute('WEIGHTS_0')
      const jViejo = jAttr !== null ? jAttr.getArray() : null
      const wViejo = wAttr !== null ? wAttr.getArray() : null
      const jNuevo = new Uint8Array(n * 4)
      const wNuevo = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) {
        const acumulado = new Map<number, number>()
        for (let k = 0; k < 4; k++) {
          const idx = jViejo !== null ? mapa[jViejo[i * 4 + k]] : 0
          const peso = wViejo !== null ? wViejo[i * 4 + k] : k === 0 ? 1 : 0
          if (peso > 0) acumulado.set(idx, (acumulado.get(idx) ?? 0) + peso)
        }
        const ordenado = [...acumulado.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
        ordenado.forEach(([idx, peso], k) => {
          jNuevo[i * 4 + k] = idx
          wNuevo[i * 4 + k] = peso
        })
      }
      huesos.push(jNuevo)
      pesos.push(wNuevo)

      const ind = prim.getIndices()
      if (ind !== null) {
        const arr = ind.getArray()
        if (arr !== null) for (let i = 0; i < arr.length; i++) indices.push(arr[i] + base)
      } else {
        for (let i = 0; i < n; i++) indices.push(i + base)
      }
      base += n
    }
  }

  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setAttribute(
      'POSITION',
      doc
        .createAccessor(undefined, buffer)
        .setType('VEC3')
        .setArray(concatenar(posiciones, (n) => new Float32Array(n))),
    )
    .setAttribute(
      'NORMAL',
      doc
        .createAccessor(undefined, buffer)
        .setType('VEC3')
        .setArray(concatenar(normales, (n) => new Float32Array(n))),
    )
    .setAttribute(
      'JOINTS_0',
      doc
        .createAccessor(undefined, buffer)
        .setType('VEC4')
        .setArray(concatenar(huesos, (n) => new Uint8Array(n))),
    )
    .setAttribute(
      'WEIGHTS_0',
      doc
        .createAccessor(undefined, buffer)
        .setType('VEC4')
        .setArray(concatenar(pesos, (n) => new Float32Array(n))),
    )
    .setAttribute(
      'COLOR_0',
      doc
        .createAccessor(undefined, buffer)
        .setType('VEC4')
        .setArray(concatenar(colores, (n) => new Uint8Array(n)))
        .setNormalized(true),
    )

  // Uint16 alcanza mientras el personaje fusionado no pase de 65535 vértices
  // (los del pack rondan los 16k) y ahorra la mitad que Uint32 en el índice,
  // que es el bloque más grande del archivo.
  const indiceArray =
    base <= 0xffff ? new Uint16Array(indices) : new Uint32Array(indices)
  prim.setIndices(doc.createAccessor(undefined, buffer).setType('SCALAR').setArray(indiceArray))

  const malla = doc.createMesh('Personaje').addPrimitive(prim)
  const nodo = doc.createNode('Personaje').setMesh(malla)
  if (skin !== null) nodo.setSkin(skin)
  root.listScenes()[0].addChild(nodo)

  for (const viejo of nodos) {
    const m = viejo.getMesh()
    if (m !== null) m.dispose()
    viejo.dispose()
  }
}

/** Borra los nodos de dedos ya podados del esqueleto y del grafo. */
function borrarNodos(quitados: Set<GltfNode>): void {
  for (const nodo of quitados) nodo.dispose()
}

async function convertirPersonaje(io: NodeIO, entrada: string, salida: string): Promise<number> {
  const doc = await io.read(entrada)
  for (const anim of doc.getRoot().listAnimations()) borrarAnimacion(anim)
  const { mapa, quitados } = podarDedos(doc)
  fusionar(doc, mapa)
  borrarNodos(quitados)
  await doc.transform(
    unlit(),
    dedup(),
    weld(),
    prune(),
    quantize({ pattern: /^(POSITION|NORMAL|WEIGHTS_0)$/ }),
    prune(),
  )
  await io.write(salida, doc)
  return statSync(salida).size
}

/**
 * Extrae los clips compartidos a un GLB sin malla: sólo esqueleto y
 * animaciones. Los cuatro personajes usan los mismos nombres de hueso, así
 * que un único juego de clips los mueve a todos (three.js liga las pistas
 * por nombre de nodo).
 */
async function convertirAnimaciones(io: NodeIO, entrada: string, salida: string): Promise<number> {
  const doc = await io.read(entrada)
  const root = doc.getRoot()

  for (const anim of root.listAnimations()) {
    const corto = nombreClip(anim.getName())
    if (!(CLIPS as readonly string[]).includes(corto)) {
      borrarAnimacion(anim)
      continue
    }
    anim.setName(corto)
  }

  const { quitados } = podarDedos(doc)
  // Las pistas que apuntan a un hueso podado dejan de tener destino: hay que
  // sacarlas antes de borrar el nodo, o el clip queda con canales colgando.
  for (const anim of root.listAnimations()) {
    for (const canal of anim.listChannels()) {
      const destino = canal.getTargetNode()
      if (destino !== null && !quitados.has(destino)) continue
      const sampler = canal.getSampler()
      canal.dispose()
      if (sampler !== null) sampler.dispose()
    }
  }
  for (const nodo of root.listNodes()) {
    const malla = nodo.getMesh()
    if (malla !== null) {
      malla.dispose()
      nodo.dispose()
    }
  }
  borrarNodos(quitados)

  await doc.transform(dedup(), prune())
  await io.write(salida, doc)
  return statSync(salida).size
}

async function main(): Promise<void> {
  const [dirEntrada, dirSalida] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const force = process.argv.includes('--force')
  if (dirEntrada === undefined || dirSalida === undefined) {
    console.error('uso: node scripts/convert-characters.ts <dir_entrada> <dir_salida> [--force]')
    process.exit(1)
  }
  if (!existsSync(dirSalida)) mkdirSync(dirSalida, { recursive: true })

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const entradas = readdirSync(dirEntrada).filter((f) => f.endsWith('.gltf'))
  const slugs: string[] = []
  let total = 0

  for (const archivo of entradas) {
    const nombre = basename(archivo, extname(archivo)).replace(/_default$/, '')
    const slug = nombre.toLowerCase()
    const salida = joinPath(dirSalida, `${slug}.glb`)
    if (existsSync(salida) && !force) {
      total += statSync(salida).size
      slugs.push(slug)
      console.log(`= ${slug} (ya estaba)`)
      continue
    }
    const bytes = await convertirPersonaje(io, joinPath(dirEntrada, archivo), salida)
    total += bytes
    slugs.push(slug)
    console.log(`+ ${slug} ${(bytes / 1024).toFixed(0)} KB`)
  }

  const salidaAnim = joinPath(dirSalida, 'animations.glb')
  if (!existsSync(salidaAnim) || force) {
    const bytes = await convertirAnimaciones(io, joinPath(dirEntrada, entradas[0]), salidaAnim)
    total += bytes
    console.log(`+ animations ${(bytes / 1024).toFixed(0)} KB`)
  } else {
    total += statSync(salidaAnim).size
  }

  slugs.sort()
  writeFileSync(joinPath(dirSalida, 'index.json'), `${JSON.stringify({ characters: slugs }, null, 2)}\n`)
  console.log(`total ${(total / 1024).toFixed(0)} KB en ${slugs.length} personajes + animaciones`)
}

await main()
