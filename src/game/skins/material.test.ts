import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial } from 'three'
import { generateSkin } from '@/game/skins/generator'
import { createSkinHandle } from '@/game/skins/material'
import { PATTERN_INDEX } from '@/game/skins/patterns'

/** Malla mínima con el mismo perfil que sale del pipeline: una primitiva,
 *  un material unlit, colores horneados en COLOR_0. */
function mallaDeArma(): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    // Eje largo en Z, como salen las armas del pipeline.
    new BufferAttribute(new Float32Array([-0.02, -0.1, -0.4, 0.02, 0.1, 0.4, 0, 0, 0]), 3),
  )
  geometry.setAttribute(
    'color',
    new BufferAttribute(new Float32Array([0.2, 0.2, 0.2, 0.5, 0.3, 0.1, 0.1, 0.1, 0.1]), 3),
  )
  return new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }))
}

/** Corre el onBeforeCompile del material y devuelve el shader resultante. */
function compilar(material: MeshBasicMaterial): {
  vertexShader: string
  fragmentShader: string
  uniforms: Record<string, { value: unknown }>
} {
  const shader = {
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
    fragmentShader:
      '#include <common>\nvoid main() {\nvec4 diffuseColor = vec4(1.0);\n#include <color_fragment>\n}',
    uniforms: {} as Record<string, { value: unknown }>,
  }
  // El tipo de onBeforeCompile de three pide un WebGLRenderer como segundo
  // argumento; acá no hay contexto WebGL y la función no lo usa.
  ;(material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader)
  return shader
}

describe('material de skin', () => {
  it('no agrega materiales: sigue habiendo uno solo por malla', () => {
    // La restricción dura del sistema (ver la cabecera de material.ts): una
    // llamada de dibujo por arma. Dos materiales serían dos llamadas.
    const mesh = mallaDeArma()
    const antes = mesh.material
    createSkinHandle(mesh)?.setSkin(generateSkin('drop:1'))
    expect(mesh.material).toBe(antes)
    expect(Array.isArray(mesh.material)).toBe(false)
  })

  it('sigue siendo un material unlit', () => {
    const mesh = mallaDeArma()
    createSkinHandle(mesh)?.setSkin(generateSkin('drop:1'))
    expect(mesh.material).toBeInstanceOf(MeshBasicMaterial)
  })

  it('no toca la geometría', () => {
    const mesh = mallaDeArma()
    const posiciones = mesh.geometry.getAttribute('position').array.slice()
    const colores = mesh.geometry.getAttribute('color').array.slice()
    createSkinHandle(mesh)?.setSkin(generateSkin('drop:7'))
    expect(mesh.geometry.getAttribute('position').array).toEqual(posiciones)
    expect(mesh.geometry.getAttribute('color').array).toEqual(colores)
  })

  it('inyecta el shader de skin en los dos stages', () => {
    const mesh = mallaDeArma()
    createSkinHandle(mesh)
    const shader = compilar(mesh.material as MeshBasicMaterial)
    expect(shader.vertexShader).toContain('vSkinObj')
    expect(shader.vertexShader).toContain('modelViewMatrix')
    expect(shader.fragmentShader).toContain('skinPatternField')
    // La normal reconstruida por derivadas es lo que reemplaza al atributo
    // NORMAL que los GLB no traen.
    expect(shader.fragmentShader).toContain('dFdx')
    // El chunk original queda reemplazado, no duplicado: si sobreviviera,
    // el color de skin se multiplicaría otra vez por el horneado.
    expect(shader.fragmentShader).not.toContain('#include <color_fragment>')
  })

  it('cambiar de skin escribe uniforms y no recompila', () => {
    // Equipar una skin no puede costar una recompilación de shader: es un
    // tirón visible en el cambio de arma.
    const mesh = mallaDeArma()
    const material = mesh.material as MeshBasicMaterial
    const handle = createSkinHandle(mesh)!
    const shader = compilar(material)

    // material.needsUpdate es sólo escritura en three; lo que se puede leer
    // es `version`, que el setter incrementa. Si equipar una skin
    // recompilara, esta versión subiría.
    const version = material.version
    handle.setSkin(generateSkin('drop:1'))
    handle.setSkin(generateSkin('drop:2'))
    handle.setTime(12.5)

    expect(material.version).toBe(version)
    expect(shader.uniforms.uSkinTime.value).toBe(12.5)
  })

  it('los uniforms reflejan la skin equipada', () => {
    const mesh = mallaDeArma()
    const handle = createSkinHandle(mesh)!
    const shader = compilar(mesh.material as MeshBasicMaterial)
    const skin = generateSkin('inicial:24')

    handle.setSkin(skin)
    expect(shader.uniforms.uSkinEnabled.value).toBe(1)
    expect(shader.uniforms.uSkinPattern.value).toBe(PATTERN_INDEX[skin.pattern])
    expect(shader.uniforms.uSkinWear.value).toBe(skin.wear)
    expect(shader.uniforms.uSkinEmissive.value).toBe(skin.emissive)
    expect(shader.uniforms.uSkinAccent.value).toBeInstanceOf(Color)

    handle.setSkin(null)
    expect(shader.uniforms.uSkinEnabled.value).toBe(0)
  })

  it('el patrón se normaliza por el tamaño del arma', () => {
    // Sin esto, una pistola de 20cm recibe media repetición del patrón y
    // sale de un solo color mientras un fusil de 85cm sale bien.
    const mesh = mallaDeArma()
    createSkinHandle(mesh)
    const shader = compilar(mesh.material as MeshBasicMaterial)
    const extent = shader.uniforms.uSkinExtent.value as { x: number; z: number }
    expect(extent.z).toBeCloseTo(0.4, 5)
    expect(extent.x).toBeCloseTo(0.02, 4)
  })

  it('dos mallas distintas no comparten uniforms', () => {
    // La primaria y la secundaria se ven a la vez en la armería: si
    // compartieran uniforms, equipar una skin cambiaría las dos.
    const a = mallaDeArma()
    const b = mallaDeArma()
    const handleA = createSkinHandle(a)!
    const handleB = createSkinHandle(b)!
    const shaderA = compilar(a.material as MeshBasicMaterial)
    const shaderB = compilar(b.material as MeshBasicMaterial)

    handleA.setSkin(generateSkin('inicial:24'))
    handleB.setSkin(null)

    expect(shaderA.uniforms.uSkinEnabled.value).toBe(1)
    expect(shaderB.uniforms.uSkinEnabled.value).toBe(0)
  })

  it('devuelve null si la malla no tiene un material unlit único', () => {
    const mesh = mallaDeArma()
    mesh.material = [new MeshBasicMaterial(), new MeshBasicMaterial()]
    expect(createSkinHandle(mesh)).toBeNull()
  })

  /**
   * Los tres de acá abajo cubren la dirección INVERSA de la que motivó
   * `customProgramCacheKey`: que la skin del arma no se derrame sobre un
   * material del MAPA.
   *
   * El reporte original era "equipar una skin verde tiñe las paredes de
   * nuketown". Medido en el navegador, no pasa: con y sin skin, la zona del
   * mapa de la captura sale idéntica byte a byte, y three compila un solo
   * programa con la clave `skin-v1` usado por un solo material. Estos tests
   * fijan las tres condiciones de las que depende eso, porque ninguna es
   * evidente leyendo el código:
   *
   * 1. Parchar un material no toca ningún otro material equivalente.
   * 2. La clave de caché de programas de un material sin parchar NO es
   *    `skin-v1`, así que three no puede darle el programa con el shader de
   *    skin inyectado (three CONCATENA customProgramCacheKey al resto de los
   *    parámetros: sólo puede separar programas, nunca fusionarlos).
   * 3. El material del mapa no queda registrado en el WeakMap de uniforms.
   */
  describe('aislamiento contra materiales que no son del arma', () => {
    /** Un material del mapa importado: unlit, texturizado, SIN vertexColors
     *  (así salen los 47 materiales de nuketown, ver map-textures.ts). */
    function materialDeMapa(): MeshBasicMaterial {
      return new MeshBasicMaterial({ vertexColors: false })
    }

    it('parchar el arma no toca el material del mapa', () => {
      const mapa = materialDeMapa()
      const onBeforeCompileOriginal = mapa.onBeforeCompile
      const claveOriginal = mapa.customProgramCacheKey()

      const mesh = mallaDeArma()
      createSkinHandle(mesh)?.setSkin(generateSkin('inicial:4'))

      expect(mapa.onBeforeCompile).toBe(onBeforeCompileOriginal)
      expect(mapa.customProgramCacheKey()).toBe(claveOriginal)
    })

    it('un material sin parchar nunca comparte la clave de programa del arma', () => {
      const mapa = materialDeMapa()
      const mesh = mallaDeArma()
      createSkinHandle(mesh)

      const arma = mesh.material as MeshBasicMaterial
      expect(arma.customProgramCacheKey()).toBe('skin-v1')
      expect(mapa.customProgramCacheKey()).not.toBe(arma.customProgramCacheKey())
    })

    it('el shader del mapa no recibe los uniforms de skin', () => {
      // Si el material del mapa terminara con el código de skin inyectado,
      // compilar() le dejaría los uSkin* puestos. Que salga vacío es lo que
      // garantiza que un uniform verde del arma no pueda pintarle la pared.
      const mapa = materialDeMapa()
      const mesh = mallaDeArma()
      createSkinHandle(mesh)?.setSkin(generateSkin('inicial:4'))

      const shaderMapa = compilar(mapa)
      expect(shaderMapa.uniforms.uSkinEnabled).toBeUndefined()
      expect(shaderMapa.uniforms.uSkinAccent).toBeUndefined()
      expect(shaderMapa.fragmentShader).not.toContain('uSkinAccent')
    })
  })
})
