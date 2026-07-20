import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARAS } from '../../../scripts/lib/skybox.ts'
import {
  CARAS_SKYBOX,
  COMANDO_GENERAR_SKYBOX,
  mensajeSkyboxFaltante,
  RUTA_SKYBOX,
} from '@/game/engine/skybox'

const RAIZ = process.cwd()

describe('skybox: contrato con el generador', () => {
  /**
   * El test que de verdad importa de este archivo. Consumidor y productor
   * viven en árboles distintos (src/ contra scripts/) y nada más los ata:
   * el generador escribe `${cara}.png` recorriendo su propio CARAS, y el
   * renderer pide esta lista. Si alguien reordena una de las dos, el juego
   * NO se rompe -- carga seis PNG válidos en el orden equivocado y muestra
   * un cielo rotado y espejado. Este es el único lugar donde eso se cae.
   */
  it('pide las caras en el mismo orden en que el generador las escribe', () => {
    expect(CARAS_SKYBOX).toEqual(CARAS.map((c) => `${c}.png`))
  })

  it('ese orden es el contrato de Three (+X, -X, +Y, -Y, +Z, -Z)', () => {
    // Anclado a literales a propósito, y no derivado de CARAS: el test de
    // arriba prueba que las dos listas COINCIDEN, pero si las dos se
    // reordenaran a la vez seguiría pasando. Éste dice cuál es el orden
    // correcto en términos absolutos, que es lo que exige CubeTextureLoader.
    expect(CARAS_SKYBOX).toEqual(['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png'])
  })

  it('la ruta que pide el renderer es la que hornea el generador', () => {
    const cli = readFileSync(join(RAIZ, 'scripts/generate-skybox.ts'), 'utf8')
    // RUTA_SKYBOX es URL servida ('/assets/...'); la del generador es ruta
    // de disco bajo public/. Se comparan por la parte común.
    const relativa = RUTA_SKYBOX.replace(/^\//, '').replace(/\/$/, '')
    expect(cli).toContain(`public/${relativa}`)
  })
})

describe('skybox: el aviso de asset faltante', () => {
  /**
   * El asset está gitignoreado, así que "faltante" es un estado alcanzable
   * con un checkout limpio. El modo de falla es silencioso (cielo negro,
   * juego andando), y estos tests existen para que el aviso siga siendo
   * accionable y no se degrade a un "algo falló".
   */
  it('dice el comando exacto que hay que correr', () => {
    expect(mensajeSkyboxFaltante('/x/px.png')).toContain(COMANDO_GENERAR_SKYBOX)
  })

  it('nombra el archivo que no cargó', () => {
    expect(mensajeSkyboxFaltante('/assets/skybox/galaxia-purpura/px.png')).toContain(
      '/assets/skybox/galaxia-purpura/px.png',
    )
  })

  it('el comando que nombra es un script que existe de verdad', () => {
    // Un mensaje de error que manda a correr un script inexistente es peor
    // que no tener mensaje: manda a perder tiempo.
    const script = COMANDO_GENERAR_SKYBOX.replace(/^node\s+/, '')
    expect(() => readFileSync(join(RAIZ, script), 'utf8')).not.toThrow()
  })

  it('package.json corre el generador antes de dev y de build', () => {
    // La otra mitad de la solución al asset gitignoreado: que el aviso no
    // haga falta casi nunca. pnpm 10 sí ejecuta pre<script> (verificado, no
    // asumido), y npm también.
    const pkg: unknown = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'))
    const scripts = (pkg as { scripts: Record<string, string> }).scripts
    expect(scripts.prebuild).toContain(COMANDO_GENERAR_SKYBOX)
    expect(scripts.predev).toContain(COMANDO_GENERAR_SKYBOX)
  })
})

/**
 * Saca comentarios de bloque y de línea.
 *
 * NO es cosmético: sin esto, los guards de más abajo leen el código MUERTO
 * como si estuviera vivo. Se descubrió rompiendo la implementación a
 * propósito -- comentar `cielo.colorSpace = SRGBColorSpace` dejaba pasar el
 * test, porque el texto seguía ahí. Comentar la línea es justo la forma más
 * probable de que esto se rompa (alguien depurando "¿y si saco esto?").
 */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('skybox: el presupuesto de legibilidad no se rompe al integrar', () => {
  const renderer = sinComentarios(readFileSync(join(RAIZ, 'src/game/engine/renderer.ts'), 'utf8'))

  /**
   * Estos dos son guards sobre el TEXTO del renderer, que normalmente sería
   * una mala idea. Se justifican porque lo que protegen no se puede observar
   * sin una GPU real: el cielo se diseñó dentro de una ventana estrecha de
   * luminancia (0.22-0.45, docs/SKYBOX.md) para que una silueta oscura se
   * recorte contra él, y cualquiera de estas dos cosas la corre entera sin
   * romper nada visible en un test de Node.
   */
  it('cuelga el cubemap de la escena', () => {
    // La línea sin la cual no hay cielo en absoluto. Se cargaría el asset,
    // se pagaría la descarga, y no se vería nada -- indistinguible del
    // estado previo a esta tarea. Salió de romper la implementación a
    // propósito: era el único mutante que sobrevivía a todo lo demás.
    expect(renderer).toMatch(/scene\.background\s*=\s*cielo/)
  })

  it('marca el cubemap como sRGB', () => {
    // Sin esto Three trata los bytes como luz lineal y la salida los vuelve
    // a codificar: el cielo sale lavado, por encima del techo de luminancia,
    // y los colores de equipo claros dejan de destacarse contra él.
    //
    // Desde que el renderer aplica tone mapping, esta línea protege ADEMÁS
    // otra cosa, y es la razón por la que este test pasó a ser el más
    // importante de los tres: `WebGLBackground.js` decide si el fondo se
    // tonemapea mirando justamente el color space del background --
    //
    //   boxMesh.material.toneMapped =
    //     ColorManagement.getTransfer( background.colorSpace ) !== SRGBTransfer
    //
    // -- así que mientras el cubemap esté marcado sRGB, el cielo queda FUERA
    // del tone mapper y su ventana de luminancia (0.22-0.45) es inmune a la
    // exposición. Si alguien lo cambia por un HDR/lineal para "mejorar la
    // iluminación", el fondo entra al tone mapper y el piso de 0.22 se
    // rompe sin que falle nada más. Ver el comentario de EXPOSICION_TONEMAP.
    expect(renderer).toMatch(/colorSpace\s*=\s*SRGBColorSpace/)
  })

  /**
   * Este test REEMPLAZA a uno que prohibía el tone mapping por completo.
   * Aquel decía, textual, que si algún día hacía falta uno había que "volver
   * a medir el contraste silueta/cielo antes de borrar este test". Se midió,
   * con `gl.readPixels` sobre capturas del render real en arena, misma pose y
   * misma ventana de 488k píxeles de cielo:
   *
   *   cielo antes de la tarea:   mín erosionado 0.2363   media 0.2626
   *   cielo después (ACES 2.5):  mín erosionado 0.2363   media 0.2626
   *
   * Idéntico a cuatro decimales, porque el fondo no pasa por el tone mapper
   * (ver el test de arriba). El miedo que motivaba la prohibición -- que el
   * tone mapper levantara las sombras hasta borrar la silueta -- además va al
   * revés con ACES: hunde el oscuro (0x1a1a1a pasa de 0.1020 a 0.0595), así
   * que el contraste silueta/cielo SUBE de 0.1245 a 0.1783 contra la media
   * del cielo. Muy por encima del 0.12 de diseño.
   *
   * Lo que queda por proteger no es "que no haya tone mapping", es que si lo
   * hay venga con exposición explícita: ACES con la exposición 1.0 por
   * defecto oscurece el mundo casi a la mitad, y ESO sí rompería la lectura.
   */
  it('si aplica tone mapping, fija también la exposición', () => {
    const usaToneMapping = /toneMapping\s*=/.test(renderer)
    if (!usaToneMapping) return
    expect(renderer).toMatch(/toneMappingExposure\s*=/)
    // La exposición sale de una constante derivada y documentada, no de un
    // número mágico suelto en la llamada.
    expect(renderer).toMatch(/toneMappingExposure\s*=\s*EXPOSICION_TONEMAP/)
  })

  it('el rig de luces no se instala sobre un mapa con luz horneada', () => {
    // Un mapa importado de Source trae lightmap y se dibuja unlit. Agregarle
    // luces no cambia un píxel (three no le pasa luces a MeshBasicMaterial)
    // pero sí paga el shadow map: medido en nuketown, 2.09 ms sin rig contra
    // 4.06 ms con rig y sombras. Este guard es sobre el TEXTO por el mismo
    // motivo que los de arriba -- el costo sólo se observa con GPU real.
    expect(renderer).toMatch(/const\s+usaRig\s*=\s*mallaImportada\s*===\s*null/)
    expect(renderer).toMatch(/renderer\.shadowMap\.enabled\s*=\s*usaRig/)
  })
})
