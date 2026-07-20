import { DirectionalLight, Object3D, Scene, type WebGLRenderer } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { instalarRigDeLuz } from './lighting.ts'

/**
 * El mismo doble mínimo que usa renderer.test.ts. No tiene contexto WebGL, así
 * que el rig tiene que caer al camino sin environment.
 */
function rendererFalso(): WebGLRenderer {
  return { clearDepth: vi.fn(), render: vi.fn() } as unknown as WebGLRenderer
}

function luces(padre: Object3D): DirectionalLight[] {
  const out: DirectionalLight[] = []
  padre.traverse((o) => {
    if (o instanceof DirectionalLight) out.push(o)
  })
  return out
}

describe('instalarRigDeLuz', () => {
  it('cuelga las tres direccionales del padre, no de la escena', () => {
    // Del PADRE (la cámara) es lo que hace que las luces acompañen al punto de
    // vista. Colgarlas de la escena las dejaría fijas en el mundo y el arma se
    // apagaría al rotar.
    const scene = new Scene()
    const camara = new Object3D()
    scene.add(camara)
    instalarRigDeLuz(scene, camara, rendererFalso())

    expect(luces(camara)).toHaveLength(3)
  })

  it('sin contexto WebGL instala igual las luces y se queda sin environment', () => {
    // Es la degradación esperada, y está fijada acá para que sea una decisión y
    // no un accidente: un arma sin reflejos es aceptable, un arma sin luz no.
    const scene = new Scene()
    const camara = new Object3D()
    scene.add(camara)
    const rig = instalarRigDeLuz(scene, camara, rendererFalso())

    expect(rig.environment).toBeNull()
    expect(scene.environment).toBeNull()
    expect(luces(camara)).toHaveLength(3)
  })

  it('las tres luces apuntan desde direcciones distintas', () => {
    // Tres luces desde el mismo lado iluminan como una sola: el volumen sale de
    // que key, fill y rim NO coincidan.
    const scene = new Scene()
    const camara = new Object3D()
    scene.add(camara)
    instalarRigDeLuz(scene, camara, rendererFalso())

    const posiciones = luces(camara).map((l) => l.position.clone().normalize())
    for (let i = 0; i < posiciones.length; i++) {
      for (let j = i + 1; j < posiciones.length; j++) {
        expect(posiciones[i].dot(posiciones[j])).toBeLessThan(0.9)
      }
    }
  })

  it('hay una luz por delante y otra por detrás del punto de vista', () => {
    // El rim vive en Z negativo (hacia donde mira la cámara) y la key en Z
    // positivo. Que las dos caigan del mismo lado es el error que borra el
    // filo del arma sin romper nada visible en un test de conteo.
    const scene = new Scene()
    const camara = new Object3D()
    scene.add(camara)
    instalarRigDeLuz(scene, camara, rendererFalso())

    const zs = luces(camara).map((l) => l.position.z)
    expect(zs.some((z) => z > 0)).toBe(true)
    expect(zs.some((z) => z < 0)).toBe(true)
  })

  it('dispose sin environment no revienta', () => {
    const scene = new Scene()
    const camara = new Object3D()
    scene.add(camara)
    const rig = instalarRigDeLuz(scene, camara, rendererFalso())
    expect(() => rig.dispose()).not.toThrow()
  })
})
