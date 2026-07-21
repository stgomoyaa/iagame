import { describe, expect, it } from 'vitest'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Texture,
  Vector3,
} from 'three'
import { CAMO_FAMILY_INDEX, ESCALA_FAMILIA } from '@/game/skins/camo-families'
import { generateSkin } from '@/game/skins/generator'
import { createSkinHandle } from '@/game/skins/material'
import { PATTERN_INDEX } from '@/game/skins/patterns'
import { rarityRank } from '@/game/skins/rarity'
import { CATALOGO_CAMOS, type CamoTextura } from '@/game/skins/texturas'

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
function compilar(material: MeshBasicMaterial | MeshStandardMaterial): {
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

  describe('familias de camuflaje', () => {
    it('el uniform de familia sale de la skin', () => {
      const mesh = mallaDeArma()
      const handle = createSkinHandle(mesh)!
      const shader = compilar(mesh.material as MeshBasicMaterial)

      for (const fam of ['multicam', 'gema', 'damasco', 'cebra', 'clasico'] as const) {
        handle.setSkin({ ...generateSkin('drop:1'), family: fam })
        expect(shader.uniforms.uSkinFamily.value, fam).toBe(CAMO_FAMILY_INDEX[fam])
      }
    })

    it('la escala se premultiplica por la de la familia', () => {
      // Una familia cae sobre patrones anfitriones con rangos de escala muy
      // distintos; sin esta corrección sale con cuatro veces más
      // repeticiones en un anfitrión que en otro.
      const mesh = mallaDeArma()
      const handle = createSkinHandle(mesh)!
      const shader = compilar(mesh.material as MeshBasicMaterial)
      const skin = generateSkin('drop:1')

      handle.setSkin({ ...skin, family: 'clasico' })
      expect(shader.uniforms.uSkinPatternScale.value).toBeCloseTo(skin.patternScale, 9)

      handle.setSkin({ ...skin, family: 'gema' })
      expect(shader.uniforms.uSkinPatternScale.value).toBeCloseTo(
        skin.patternScale * ESCALA_FAMILIA.gema,
        9,
      )
    })

    it('cambiar de familia no recompila el shader', () => {
      // Todo el sistema existe para que equipar una skin escriba uniforms y
      // nada más. Seis familias en un solo programa, no seis programas.
      const mesh = mallaDeArma()
      const material = mesh.material as MeshBasicMaterial
      const handle = createSkinHandle(mesh)!
      compilar(material)
      const version = material.version

      for (const fam of ['multicam', 'follaje', 'filigrana', 'gema', 'damasco', 'cebra'] as const) {
        handle.setSkin({ ...generateSkin('drop:1'), family: fam })
      }
      expect(material.version).toBe(version)
    })

    it('las seis familias están en el GLSL, en un solo switch por uniform', () => {
      // Si el switch fuera sobre otra cosa que un uniform, los fragmentos de
      // una misma llamada de dibujo podrían divergir y la GPU pagaría varias
      // familias por píxel en vez de una.
      const mesh = mallaDeArma()
      createSkinHandle(mesh)
      const shader = compilar(mesh.material as MeshBasicMaterial)
      const fs = shader.fragmentShader

      expect(fs).toContain('uniform int uSkinFamily;')
      expect(fs).toContain('skinFamilyColor')
      for (let i = 1; i <= 6; i++) {
        expect(fs, `falta la rama de la familia ${i}`).toContain(`fam == ${i}`)
      }
      // Las tres piezas que la máscara de emisivo necesita para no bañar el
      // fondo: cada familia emisiva escribe `emis` desde su propio elemento.
      expect(fs).toContain('emis = oro')
      expect(fs).toContain('emis = enLinea')
      expect(fs).toContain('emis = 1.0 - negra')
    })

    it('el emisivo de la familia se tiñe con la familia, no con el acento', () => {
      // El oro tiene que brillar dorado y la línea del damasco magenta. Si el
      // glow usara el acento de la skin, todos los brillos saldrían del mismo
      // color y se perdería lo que distingue a cada familia.
      const mesh = mallaDeArma()
      createSkinHandle(mesh)
      const fs = compilar(mesh.material as MeshBasicMaterial).fragmentShader
      expect(fs).toContain('tintGlow = fam;')
      expect(fs).toContain('color += tintGlow * glow * pulse;')
    })
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

  // Este test afirmaba lo contrario —que un array de materiales devolvía
  // `null`— y esa afirmación ERA el bug: las armas de COD con varias
  // primitivas se fusionan en una malla con array de materiales, así que
  // caían justo en esa rama y se quedaban sin camuflaje sin ningún error.
  it('parcha TODOS los materiales de una malla fusionada, no sólo el primero', () => {
    const mesh = mallaDeArma()
    const cuerpo = new MeshBasicMaterial()
    const hierros = new MeshBasicMaterial()
    mesh.material = [cuerpo, hierros]

    const handle = createSkinHandle(mesh)
    expect(handle).not.toBeNull()

    const shaderCuerpo = compilar(cuerpo)
    const shaderHierros = compilar(hierros)
    handle!.setSkin(generateSkin('fusionada:7'))

    // Las dos piezas encendidas: si sólo se parchara la primera, los hierros
    // quedarían del color de fábrica al lado de un cuerpo camuflado.
    expect(shaderCuerpo.uniforms.uSkinEnabled.value).toBe(1)
    expect(shaderHierros.uniforms.uSkinEnabled.value).toBe(1)
    // Y con el MISMO patrón y la misma escala, o el camuflaje no se
    // continuaría de una pieza a la otra.
    expect(shaderHierros.uniforms.uSkinPattern.value).toBe(
      shaderCuerpo.uniforms.uSkinPattern.value,
    )
    expect(shaderHierros.uniforms.uSkinPatternScale.value).toBe(
      shaderCuerpo.uniforms.uSkinPatternScale.value,
    )
    // uSkinExtent es el tamaño del arma ENTERA, igual en las dos: medido por
    // pieza, los hierros llevarían el patrón ampliado como si fueran un arma
    // completa del tamaño de un dedo.
    // El tipo del uniform es `unknown` porque el shader de three no está
    // tipado por uniform; se estrecha acá en vez de castear en la aserción,
    // así el fallo es "no es un Vector3" y no un error de tipos ilegible.
    const extentHierros = shaderHierros.uniforms.uSkinExtent.value as Vector3
    const extentCuerpo = shaderCuerpo.uniforms.uSkinExtent.value as Vector3
    expect(extentHierros.toArray()).toEqual(extentCuerpo.toArray())

    handle!.setTime(1.5)
    expect(shaderHierros.uniforms.uSkinTime.value).toBe(1.5)
  })

  it('devuelve null si la malla no tiene ningún material inyectable', () => {
    const mesh = mallaDeArma()
    mesh.material = new MeshDepthMaterial()
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
      // Se afirma el prefijo y no la versión exacta: lo que este test protege
      // es que la clave del arma sea propia y distinta de la de cualquier otro
      // material, no en qué versión va el shader. Fijar 'skin-v1' hacía que
      // cambiar el shader rompiera un test que no habla del shader.
      expect(arma.customProgramCacheKey()).toMatch(/^skin-v\d+$/)
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

  /**
   * La VÍA POR TEXTURA (skins/texturas.ts): un heightmap gris que el motor
   * viste con paleta, emisión, superficie y animación. Corre sobre el mismo
   * programa que las procedurales, elegida por el uniform uSkinTexEnabled.
   */
  describe('vía por textura', () => {
    const camo: CamoTextura = CATALOGO_CAMOS[0]

    it('el GLSL trae el muestreo triplanar y su rama, detrás de un uniform', () => {
      const mesh = mallaDeArma()
      createSkinHandle(mesh)
      const fs = compilar(mesh.material as MeshBasicMaterial).fragmentShader
      // El sampler y la función de muestreo del heightmap.
      expect(fs).toContain('uniform sampler2D uSkinPatternMap;')
      expect(fs).toContain('skinPatronTriplanar')
      // Tres samples: uno por plano. Menos de tres sería una proyección plana,
      // que mete costura cruzando el arma.
      const samples = fs.match(/texture2D\( uSkinPatternMap/g) ?? []
      expect(samples.length).toBe(3)
      // La rama es sobre un uniform, igual que la de familias: así todos los
      // fragmentos de la llamada de dibujo toman la misma y la GPU no paga las
      // dos vías por píxel.
      expect(fs).toContain('if ( uSkinTexEnabled > 0.5 )')
    })

    it('equipar un camo por textura enciende la vía y escribe sus uniforms', () => {
      const mesh = mallaDeArma()
      const handle = createSkinHandle(mesh)!
      const shader = compilar(mesh.material as MeshBasicMaterial)
      const tex = new Texture()

      handle.setCamoTextura(camo, tex)
      expect(shader.uniforms.uSkinEnabled.value).toBe(1)
      expect(shader.uniforms.uSkinTexEnabled.value).toBe(1)
      expect(shader.uniforms.uSkinPatternMap.value).toBe(tex)
      expect(shader.uniforms.uSkinPatternScale.value).toBe(camo.escala)
      expect(shader.uniforms.uSkinEmissive.value).toBe(camo.emissive)
      // La superficie viaja como (rugosidad, metalicidad, barniz).
      const sup = shader.uniforms.uSkinSurface.value as Vector3
      expect(sup.toArray()).toEqual([camo.rugosidad, camo.metal, camo.barniz])
      // Rareza normalizada 0..1 y niveles del heightmap: los dos uniforms nuevos
      // que hacen el escalado de brillo por rareza y el neón sobre negro.
      expect(shader.uniforms.uSkinRarity.value).toBe(rarityRank(camo.rarity) / 4)
      const niveles = shader.uniforms.uSkinLevels.value as { toArray(): number[] }
      expect(niveles.toArray()).toEqual([camo.nivelBajo, camo.nivelAlto])
    })

    it('sin la textura cargada NO enciende: cae al horneado, no a un color plano', () => {
      // Un camo sin su patrón dibujaría sobre la textura 1x1 por defecto de
      // three y saldría de un solo color. Mejor mostrar el arma cruda hasta que
      // el patrón baje.
      const mesh = mallaDeArma()
      const handle = createSkinHandle(mesh)!
      const shader = compilar(mesh.material as MeshBasicMaterial)

      handle.setCamoTextura(camo, null)
      expect(shader.uniforms.uSkinEnabled.value).toBe(0)
      expect(shader.uniforms.uSkinTexEnabled.value).toBe(0)
    })

    it('las dos vías son excluyentes: una skin procedural apaga la textura', () => {
      const mesh = mallaDeArma()
      const handle = createSkinHandle(mesh)!
      const shader = compilar(mesh.material as MeshBasicMaterial)

      handle.setCamoTextura(camo, new Texture())
      expect(shader.uniforms.uSkinTexEnabled.value).toBe(1)

      // Equipar una skin procedural encima tiene que apagar la textura, o el
      // arma seguiría muestreando el patrón viejo debajo del camuflaje nuevo.
      handle.setSkin(generateSkin('drop:9'))
      expect(shader.uniforms.uSkinTexEnabled.value).toBe(0)
      expect(shader.uniforms.uSkinEnabled.value).toBe(1)
    })

    it('cambiar de camo por textura no recompila el shader', () => {
      const mesh = mallaDeArma()
      const material = mesh.material as MeshBasicMaterial
      const handle = createSkinHandle(mesh)!
      compilar(material)
      const version = material.version

      for (const c of CATALOGO_CAMOS) handle.setCamoTextura(c, new Texture())
      expect(material.version).toBe(version)
    })

    it('la clave de caché de programa subió a v5 con el neón por rareza', () => {
      // Sin bumpear la clave, un material parchado con una versión previa
      // reusaría su programa viejo y el código nuevo (niveles, rareza, la rama
      // de textura neón) no existiría en él.
      const mesh = mallaDeArma()
      createSkinHandle(mesh)
      const material = mesh.material as MeshBasicMaterial
      expect(material.customProgramCacheKey?.()).toBe('skin-v5')
    })
  })
})

/**
 * Las armas de Source pasaron a `MeshStandardMaterial` con textura para poder
 * recibir luz. Este bloque cubre esa costura, que es de las peligrosas del
 * proyecto: `materialOf` devolvía null para todo lo que no fuera
 * `MeshBasicMaterial`, y `createSkinHandle` traduce null como "esta malla no
 * lleva camuflaje". O sea que cambiar el material apagaba los 79 camuflajes
 * sin un error, sin un warning y sin que ningún test existente se enterara.
 */
describe('material de skin sobre MeshStandardMaterial', () => {
  function mallaEstandarConTextura(): Mesh {
    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    )
    geometry.setAttribute('uv', new BufferAttribute(Float32Array.from([0, 0, 1, 0, 0, 1]), 2))
    return new Mesh(geometry, new MeshStandardMaterial())
  }

  it('devuelve un handle en vez de null: el camuflaje NO se apaga al cambiar de material', () => {
    expect(createSkinHandle(mallaEstandarConTextura())).not.toBeNull()
  })

  it('inyecta los uniforms del camuflaje en el shader standard', () => {
    const mesh = mallaEstandarConTextura()
    const handle = createSkinHandle(mesh)
    expect(handle).not.toBeNull()
    const shader = compilar(mesh.material as MeshStandardMaterial)
    expect(shader.uniforms.uSkinEnabled).toBeDefined()
    expect(shader.uniforms.uSkinFamily).toBeDefined()
    expect(shader.fragmentShader).toContain('uSkinEnabled')
  })

  it('equipar y sacar una skin mueve uSkinEnabled igual que en el basic', () => {
    const mesh = mallaEstandarConTextura()
    const handle = createSkinHandle(mesh)!
    const shader = compilar(mesh.material as MeshStandardMaterial)

    handle.setSkin(generateSkin('estandar:3'))
    expect(shader.uniforms.uSkinEnabled.value).toBe(1)
    handle.setSkin(null)
    expect(shader.uniforms.uSkinEnabled.value).toBe(0)
  })

  it('con textura, el camino sin camuflaje no vuelve a multiplicar el albedo', () => {
    // Con USE_MAP el albedo YA está en diffuseColor cuando corre este bloque.
    // Multiplicarlo otra vez por sí mismo lo elevaría al cuadrado y dejaría el
    // arma más oscura SIN camuflaje que con él: un bug que no lanza nada y que
    // sólo se ve comparando dos capturas.
    const mesh = mallaEstandarConTextura()
    createSkinHandle(mesh)
    const shader = compilar(mesh.material as MeshStandardMaterial)

    const cuerpo = shader.fragmentShader
    const usaMapa = cuerpo.indexOf('#if defined( USE_MAP )')
    expect(usaMapa).toBeGreaterThanOrEqual(0)
    // La multiplicación tiene que estar detrás de un #else, nunca suelta.
    const multiplicacion = cuerpo.indexOf('diffuseColor.rgb *= skinBaked')
    expect(multiplicacion).toBeGreaterThan(usaMapa)
    const elseAntes = cuerpo.lastIndexOf('#else', multiplicacion)
    expect(elseAntes).toBeGreaterThan(usaMapa)
  })

  it('el camuflaje sigue leyendo la anatomía del arma, ahora por píxel', () => {
    // skinBaked sale de diffuseColor cuando hay mapa: es lo que conserva la
    // regla de "lo saturado del arma se lleva el acento" al pasar de color por
    // vértice a textura.
    const mesh = mallaEstandarConTextura()
    createSkinHandle(mesh)
    const shader = compilar(mesh.material as MeshStandardMaterial)
    expect(shader.fragmentShader).toContain('vec3 skinBaked = diffuseColor.rgb')
  })
})
