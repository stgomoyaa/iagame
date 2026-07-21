/**
 * Borde con la escena para las ópticas: arma la malla montada y dibuja la
 * retícula por código. Es el ÚNICO archivo de accesorios que toca three; la
 * lógica (catálogo, anclaje, desbloqueo) es pura y vive en `optics-catalog.ts`.
 * Mismo criterio que `skins/material.ts` vs `skins/generator.ts`.
 *
 * REGLA DURA: cero asignaciones por frame. Todo lo de acá es SETUP, se corre
 * una vez al montar la óptica y no vuelve a tocarse cada cuadro. La retícula es
 * una malla estática; el punto rojo no recalcula nada por frame.
 *
 * EL PUNTO ROJO ES TRABAJO NUEVO. Ningún pack lo hornea. Acá es un quad ADITIVO
 * con una textura generada por canvas (un punto, un anillo o un cheurón según
 * la óptica), a ESCALA DE MUNDO fija: no depende del FOV, así que no se agranda
 * ni se achica cuando (en una fase futura) el ADS cambie el zoom. Se dibuja sin
 * test de profundidad para que se vea siempre sobre la lente, como en los
 * shooters de referencia.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Euler,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Vector3,
} from 'three'
import type { AnclaOptica, OpticaDef, ReticulaDef } from '@/game/weapons/attachments/optics-catalog'

/** Lado del canvas de la retícula. Chico: es un puntito, no necesita 4K. */
const RETICULA_PX = 128

/** Convierte un hex 0xRRGGBB a `rgba(r,g,b,a)` para el canvas 2D. */
function css(color: number, alpha: number): string {
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * Textura de la retícula, dibujada por código. Un canvas 2D con la forma en el
 * color de la óptica sobre fondo transparente; el material aditivo la suma
 * sobre la lente. Se genera una vez por óptica montada.
 */
export function crearTexturaReticula(def: ReticulaDef): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = RETICULA_PX
  canvas.height = RETICULA_PX
  const ctx = canvas.getContext('2d')!
  const c = RETICULA_PX / 2
  const brillo = Math.min(1, def.intensidad)

  ctx.clearRect(0, 0, RETICULA_PX, RETICULA_PX)
  ctx.lineCap = 'round'

  if (def.forma === 'punto') {
    // Punto con halo: un gradiente radial da el look de LED encendido en vez de
    // un círculo plano de vector.
    const rad = RETICULA_PX * 0.16
    const grad = ctx.createRadialGradient(c, c, 0, c, c, rad)
    grad.addColorStop(0, css(def.color, brillo))
    grad.addColorStop(0.5, css(def.color, brillo * 0.7))
    grad.addColorStop(1, css(def.color, 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(c, c, rad, 0, Math.PI * 2)
    ctx.fill()
  } else if (def.forma === 'holo') {
    // Anillo + punto: la retícula clásica del EOTech (círculo con punto al
    // centro). El anillo grande, el punto chico y brillante.
    ctx.strokeStyle = css(def.color, brillo * 0.85)
    ctx.lineWidth = RETICULA_PX * 0.03
    ctx.beginPath()
    ctx.arc(c, c, RETICULA_PX * 0.34, 0, Math.PI * 2)
    ctx.stroke()
    const rad = RETICULA_PX * 0.06
    const grad = ctx.createRadialGradient(c, c, 0, c, c, rad)
    grad.addColorStop(0, css(def.color, brillo))
    grad.addColorStop(1, css(def.color, 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(c, c, rad, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // Cheurón del ACOG: una "V" invertida (punta hacia arriba) con una línea
    // vertical de puntería debajo, como la retícula real del TA31.
    ctx.strokeStyle = css(def.color, brillo)
    ctx.lineWidth = RETICULA_PX * 0.035
    const ancho = RETICULA_PX * 0.2
    const alto = RETICULA_PX * 0.16
    ctx.beginPath()
    ctx.moveTo(c - ancho, c)
    ctx.lineTo(c, c - alto)
    ctx.lineTo(c + ancho, c)
    ctx.stroke()
    // Poste vertical bajo el cheurón.
    ctx.beginPath()
    ctx.moveTo(c, c - alto * 0.2)
    ctx.lineTo(c, c + RETICULA_PX * 0.28)
    ctx.stroke()
  }

  const tex = new CanvasTexture(canvas)
  tex.magFilter = LinearFilter
  tex.minFilter = LinearFilter
  tex.needsUpdate = true
  return tex
}

/**
 * Malla de la retícula: un quad en el plano XY (normal +Z, o sea mirando al
 * tirador, que está detrás del arma y mira hacia -Z). Aditivo y sin test de
 * profundidad para que el punto se vea siempre encendido sobre la lente.
 */
export function construirReticula(def: ReticulaDef): Mesh {
  const geo = new PlaneGeometry(def.ladoMundo, def.ladoMundo)
  const mat = new MeshBasicMaterial({
    map: crearTexturaReticula(def),
    transparent: true,
    blending: AdditiveBlending,
    // Sin test ni escritura de profundidad: el punto rojo es un overlay sobre
    // la lente, no geometría que compita por z-buffer. Es la técnica estándar
    // (ArcCW/TFA) para que no lo tape la propia lente translúcida.
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new Mesh(geo, mat)
  mesh.name = 'reticula'
  // renderOrder alto: se dibuja después del cuerpo de la óptica dentro de la
  // pasada del viewmodel, así el aditivo cae sobre la lente ya dibujada.
  mesh.renderOrder = 10
  return mesh
}

/** Todo lo necesario para montar una óptica sobre un arma. */
export interface MontajeOptica {
  /** Escena del GLB de la óptica, YA CLONADA por el llamador (una copia por
   *  montaje: no se comparte el grafo entre armas). */
  opticaScene: Object3D
  def: OpticaDef
  ancla: AnclaOptica
}

/**
 * Arma la jerarquía de una óptica montada, lista para colgar del cuerpo del
 * arma (su espacio local normalizado). Estructura:
 *
 *     grupo (en el ancla; sin rotación: frame del arma)
 *       ├─ holder (rot base +90°Y + escala): mete la óptica en el frame del arma
 *       │    └─ opticaScene
 *       └─ reticula (en el frame del arma, en el centro de la lente)
 *
 * La retícula se cuelga del GRUPO y no del holder a propósito: así su normal
 * queda en +Z del arma (mirando al tirador) sin tener que deshacer la rotación
 * base, y su posición se calcula una vez llevando `def.lente` (espacio de la
 * óptica) al frame del arma. Queda pegada a la lente aunque el ancla cambie de
 * escala.
 */
export function montarOptica(m: MontajeOptica): Group {
  const grupo = new Group()
  grupo.name = `optica:${m.def.id}`
  grupo.position.set(m.ancla.pos[0], m.ancla.pos[1], m.ancla.pos[2])

  const holder = new Group()
  holder.name = 'optica-holder'
  holder.rotation.set(m.ancla.rot[0], m.ancla.rot[1], m.ancla.rot[2])
  holder.scale.setScalar(m.ancla.escala)
  holder.add(m.opticaScene)
  grupo.add(holder)

  // Centro de la lente llevado del espacio de la óptica al del arma: se aplica
  // la MISMA rotación y escala base que al cuerpo, para que el punto caiga en
  // la lente y no al lado. Se calcula una vez, acá.
  const lente = new Vector3(m.def.lente[0], m.def.lente[1], m.def.lente[2])
    .multiplyScalar(m.ancla.escala)
    .applyEuler(new Euler(m.ancla.rot[0], m.ancla.rot[1], m.ancla.rot[2]))

  const reticula = construirReticula(m.def.reticula)
  reticula.position.copy(lente)
  grupo.add(reticula)

  return grupo
}

/**
 * Suelta lo que se creó FRESCO en este montaje: la retícula (su geometría, su
 * material y la textura de canvas). El CUERPO de la óptica NO se toca acá: viene
 * de un `clone` que REUSA la geometría y el material de la escena fuente
 * cacheada (SkeletonUtils.clone comparte esos recursos), así que soltarlos acá
 * los sacaría de debajo de los próximos montajes de la misma óptica. La fuente
 * se libera una sola vez con `desmontarFuenteOptica` cuando se limpia el caché.
 */
export function desmontarOptica(grupo: Object3D): void {
  grupo.removeFromParent()
  const reticula = grupo.getObjectByName('reticula')
  if (!(reticula instanceof Mesh)) return
  reticula.geometry.dispose()
  const mat = reticula.material
  const mats = Array.isArray(mat) ? mat : [mat]
  for (const mm of mats) {
    if (mm instanceof MeshBasicMaterial && mm.map) mm.map.dispose()
    mm.dispose()
  }
}

/**
 * Libera la GEOMETRÍA y los MATERIALES de una escena fuente de óptica (la que
 * se cachea y se clona por montaje). Se llama una vez al vaciar el caché, no por
 * desmontaje: es el par de `desmontarOptica`, que a propósito deja intacto el
 * cuerpo compartido.
 */
export function desmontarFuenteOptica(scene: Object3D): void {
  scene.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    obj.geometry.dispose()
    const mat = obj.material
    const mats = Array.isArray(mat) ? mat : [mat]
    for (const mm of mats) {
      if (mm instanceof MeshBasicMaterial && mm.map) mm.map.dispose()
      mm.dispose()
    }
  })
}
