/**
 * Bloom (postprocesado) sobre el resultado COMBINADO de mundo + viewmodel.
 *
 *
 * QUÉ HACE Y POR QUÉ ASÍ (la decisión de arquitectura de esta feature)
 *
 * El motor dibuja el frame en DOS pasadas sobre el mismo WebGLRenderer, las
 * dos contra el canvas (el framebuffer por defecto): primero el mundo
 * (engine/renderer.ts, con su clear completo) y encima el arma en primera
 * persona (weapons/viewmodel/renderer.ts, limpiando sólo profundidad). Recién
 * DESPUÉS de esas dos pasadas el canvas tiene la imagen final, ya con el
 * tonemapping ACES aplicado por el propio renderer.
 *
 * El bloom que quiere el dueño -- el derrame de luz de los camos neón, los
 * fogonazos y el punto rojo, como en Call of Duty -- es un efecto full-screen:
 * umbral de luminancia -> desenfoque gaussiano en varios niveles -> composite
 * aditivo. Para que el arma TAMBIÉN brille hay que correrlo sobre el resultado
 * de las dos pasadas juntas, no sobre una sola.
 *
 * El camino elegido es **bloom DESPUÉS del tonemap, como un overlay aditivo
 * sobre la imagen ya mostrada**, y no un EffectComposer con RenderPass +
 * OutputPass. La razón es dura y medida, no de gusto:
 *
 *   El cielo NO pasa por el tonemapping (engine/renderer.ts lo explica en
 *   detalle: `WebGLBackground` apaga `toneMapped` en fondos sRGB, y el
 *   presupuesto de legibilidad del cielo -- piso 0.22, contraste silueta 0.12
 *   de docs/SKYBOX.md -- se calibró con el cielo SIN tonemapear). Un
 *   EffectComposer clásico renderiza la escena a un render target (donde Three
 *   fuerza NoToneMapping) y reaplica ACES al final con OutputPass sobre TODO,
 *   incluido el cielo. A exposición 2.5 eso subiría el cielo violeta de ~0.26
 *   a ~0.42 sRGB: rompería el piso y el contraste en silencio. Inaceptable.
 *
 * Haciendo el bloom como overlay aditivo sobre el canvas ya tonemapeado, la
 * imagen base queda IDÉNTICA a la de hoy (byte por byte): el cielo, el mundo y
 * el arma se dibujan exactamente igual, y el bloom sólo AGREGA luz encima. De
 * ahí salen gratis dos invariantes que la tarea exige:
 *
 *   1. En `off` el pipeline se saltea entero: cero render targets, cero
 *      pasadas, mismo costo de GPU que antes de esta feature (verificable).
 *   2. En `bajo`/`alto` un blend aditivo NUNCA puede oscurecer ni desplazar la
 *      base -- sólo suma-- así que "prendido = hoy + brillo" es cierto por
 *      construcción, no por calibración.
 *
 * El trade-off honesto: físicamente, el bloom "correcto" va ANTES del tonemap,
 * en luz lineal, donde un highlight cuatro veces más brillante derrama cuatro
 * veces más. Ese camino exige re-derivar a mano toda la imagen tonemapeada en
 * un shader (con riesgo de que la base cambie entre off y on) y excluir el
 * cielo por profundidad. Para neón sobre casi-negro -- que es exactamente el
 * caso de estos camos-- el bloom post-tonemap se ve igual de bien y es mucho
 * menos riesgoso. Es, además, lo que hacen muchos motores que shippean.
 *
 *
 * EL PIPELINE, PASO A PASO (todo a media resolución salvo la copia)
 *
 *   1. `copyFramebufferToTexture` copia el canvas (LDR, ya tonemapeado) a una
 *      textura. Un blit de GPU, sin re-dibujar geometría.
 *   2. Bright pass: baja a media resolución y deja sólo lo que supera el
 *      umbral de luminancia (soft-knee), en color.
 *   3. Blur separable: gaussiano horizontal + vertical, N iteraciones con
 *      radio creciente, en ping-pong entre dos targets de media resolución.
 *      El radio creciente aproxima el derrame ancho tipo COD sin una pirámide
 *      de mips completa.
 *   4. Composite: dibuja el bloom desenfocado ENCIMA del canvas con blending
 *      aditivo. La base no se limpia (autoClear está en false en el renderer),
 *      así que el resultado es base + bloom.
 *
 * Media resolución ("half-res es lo normal") porque el bloom es difuso: el ojo
 * no distingue el borde de un halo desenfocado, y bajar a la mitad cuadruplica
 * el margen de fill-rate, que es lo que decide si entra en el presupuesto.
 *
 *
 * CERO ASIGNACIONES POR FRAME (regla dura de AGENTS.md)
 *
 * Todos los render targets, la textura de copia, el quad full-screen, los tres
 * materiales y el Vector2 de dirección se crean UNA vez -- en `createPostFx` y
 * en `resize` (que corre al redimensionar, no por frame). `render()` sólo
 * copia el framebuffer, muta valores de uniform (números y un Vector2 in
 * place) y llama a `renderer.render`: no crea un solo objeto. Con `off`,
 * `render()` retorna antes de tocar la GPU.
 *
 * Éste es uno de los pocos archivos de src/game autorizados a importar three
 * (ver architecture.test.ts): es el borde de esta feature contra la escena.
 * El catálogo de calidades y la persistencia son puros y viven aparte, en
 * settings/video.ts.
 */

import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  FramebufferTexture,
  LinearFilter,
  NoBlending,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import type { BloomQuality } from '@/game/settings/video'

/**
 * Parámetros de una calidad de bloom. No son físicos: son lo que hace que el
 * derrame se lea bien mirando el arma con un camo neón en movimiento (el único
 * juez válido, ver el entregable de la tarea).
 */
interface BloomConfig {
  /** Divisor de resolución de los targets de bloom respecto del drawing
   *  buffer. 2 = media resolución. */
  divisor: number
  /** Umbral de luminancia [0,1]: por debajo, un píxel no derrama. El fondo
   *  casi-negro de los camos (~0.02) queda muy por debajo; el núcleo de la
   *  veta neón (~0.9+) lo supera con holgura. */
  threshold: number
  /** Ancho del suavizado del umbral (soft-knee): evita el borde duro entre
   *  "derrama" y "no derrama". */
  knee: number
  /** Fuerza del composite aditivo: cuánta luz se suma a la base. */
  strength: number
  /** Pasadas de blur separable (cada una es horizontal + vertical). Más
   *  iteraciones = halo más ancho y suave, más costo. */
  iterations: number
  /** Radio base del gaussiano, en texels de media resolución. Cada iteración
   *  lo ensancha, para un derrame ancho barato. */
  spread: number
}

/**
 * Las dos calidades encendidas. `off` no está acá: es la ausencia de pipeline
 * (ver `render`), no una config.
 *
 * `bajo` (default): media resolución, umbral alto y desenfoque moderado. El
 * derrame neón se lee y el costo es chico -- pensado para GPUs modestas.
 * `alto`: misma resolución (media) pero más iteraciones y radio más ancho, y
 * umbral un poco más bajo para que más píxeles contribuyan. El look lujoso
 * para quien tiene GPU de sobra. Se mantiene a media resolución a propósito:
 * subir a resolución completa multiplica el fill-rate por cuatro y es el
 * primer lugar donde el presupuesto de 2,5 ms se cae (ver la tarea).
 */
const CONFIG_POR_CALIDAD: Record<Exclude<BloomQuality, 'off'>, BloomConfig> = {
  bajo: { divisor: 2, threshold: 0.72, knee: 0.28, strength: 0.85, iterations: 2, spread: 1.0 },
  // Alto NO es "más blanco", es más ANCHO: más iteraciones y radio mayor dan un
  // halo grande y suave (el derrame lujoso de COD), con la fuerza apenas por
  // encima de `bajo` para que el neón derrame su COLOR sin lavarse a blanco. Un
  // strength alto sobre un núcleo ya cerca de 1.0 clampea a blanco y se ve
  // quemado en vez de premium -- medido mirando el arma (ver el entregable).
  alto: { divisor: 2, threshold: 0.66, knee: 0.32, strength: 0.95, iterations: 4, spread: 1.6 },
}

/**
 * Vertex shader compartido por las tres pasadas. FullScreenQuad usa un
 * triángulo full-screen cuyas posiciones YA están en espacio de clip
 * (-1..3), así que se pasan directo sin matrices de cámara. `vUv` recorre
 * 0..1 sobre la pantalla.
 */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`

/**
 * Bright pass: deja pasar sólo la energía por encima del umbral, con un
 * suavizado soft-knee (el prefiltro clásico de Unity/COD). Devuelve el color
 * escalado para que quede sólo la parte que supera el umbral, conservando el
 * tinte (el neón derrama de su color, no blanco).
 */
const BRIGHT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uKnee;
void main() {
  vec3 c = texture2D( tDiffuse, vUv ).rgb;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  float k = uKnee + 1e-4;
  float x = l - uThreshold;
  float soft = clamp( x + k, 0.0, 2.0 * k );
  soft = soft * soft / ( 4.0 * k );
  float contrib = max( soft, x );
  contrib = max( contrib, 0.0 );
  float mul = contrib / max( l, 1e-4 );
  gl_FragColor = vec4( c * mul, 1.0 );
}
`

/**
 * Blur separable gaussiano de 9 taps. Se corre dos veces por iteración
 * (horizontal y vertical) reusando este mismo material: `uDirection` lleva el
 * paso de texel por el eje y el radio de la iteración.
 */
const BLUR_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uDirection;
void main() {
  vec3 sum = texture2D( tDiffuse, vUv ).rgb * 0.227027;
  sum += texture2D( tDiffuse, vUv + uDirection * 1.0 ).rgb * 0.1945946;
  sum += texture2D( tDiffuse, vUv - uDirection * 1.0 ).rgb * 0.1945946;
  sum += texture2D( tDiffuse, vUv + uDirection * 2.0 ).rgb * 0.1216216;
  sum += texture2D( tDiffuse, vUv - uDirection * 2.0 ).rgb * 0.1216216;
  sum += texture2D( tDiffuse, vUv + uDirection * 3.0 ).rgb * 0.0540540;
  sum += texture2D( tDiffuse, vUv - uDirection * 3.0 ).rgb * 0.0540540;
  sum += texture2D( tDiffuse, vUv + uDirection * 4.0 ).rgb * 0.0162162;
  sum += texture2D( tDiffuse, vUv - uDirection * 4.0 ).rgb * 0.0162162;
  gl_FragColor = vec4( sum, 1.0 );
}
`

/**
 * Composite: emite el bloom escalado por la fuerza. El blending aditivo del
 * material hace `canvas += bloom * strength` -- de ahí que sólo pueda SUMAR
 * luz, nunca cambiar la base.
 */
const COMPOSITE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uStrength;
void main() {
  gl_FragColor = vec4( texture2D( tDiffuse, vUv ).rgb * uStrength, 1.0 );
}
`

export interface PostFx {
  /** Cambia la calidad. `off` apaga el pipeline entero. Barato: sólo cambia un
   *  flag y unos uniforms; no recompila shaders ni recrea targets. */
  setQuality(quality: BloomQuality): void
  /** Calidad vigente. */
  readonly quality: BloomQuality
  /** Reasigna los render targets al tamaño del drawing buffer actual. Se llama
   *  al redimensionar (mismo momento que gfx.resize), NO por frame. */
  resize(): void
  /** Corre el bloom sobre el canvas ya dibujado. No-op instantáneo con `off`.
   *  Deja el render target en null (canvas) al salir, como estaba. */
  render(): void
  dispose(): void
}

/**
 * `renderer` es el WebGLRenderer compartido (el mismo del mundo y del
 * viewmodel). El bloom trabaja sobre lo que ese renderer dejó en el canvas, así
 * que tiene que ser el mismo contexto.
 */
export function createPostFx(renderer: WebGLRenderer): PostFx {
  let quality: BloomQuality = 'off'
  let config: BloomConfig | null = null

  // Quad full-screen reutilizado por las tres pasadas: se le reasigna el
  // material y se lo vuelve a dibujar (patrón recomendado de FullScreenQuad).
  const quad = new FullScreenQuad()

  const brightMat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: BRIGHT_FRAG,
    uniforms: {
      tDiffuse: { value: null },
      uThreshold: { value: 0.72 },
      uKnee: { value: 0.28 },
    },
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  })

  const blurMat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: BLUR_FRAG,
    uniforms: {
      tDiffuse: { value: null },
      // Vector2 persistente: cada pasada lo muta in place (cero asignaciones).
      uDirection: { value: new Vector2() },
    },
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  })

  const compositeMat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: COMPOSITE_FRAG,
    uniforms: {
      tDiffuse: { value: null },
      uStrength: { value: 0.85 },
    },
    depthTest: false,
    depthWrite: false,
    // Aditivo: canvas += bloom. Es lo que hace la base intocable.
    blending: AdditiveBlending,
    transparent: true,
  })

  // Copia del canvas (LDR, tonemapeado). Tamaño = drawing buffer completo:
  // copyFramebufferToTexture copia la región (0,0,texW,texH) del framebuffer,
  // así que si fuera más chica copiaría sólo una esquina, no una versión
  // reducida. Se baja a media resolución recién en el bright pass.
  let sceneCopy: FramebufferTexture | null = null
  // Ping-pong de media resolución: bright escribe en A; el blur alterna A<->B.
  let rtA: WebGLRenderTarget | null = null
  let rtB: WebGLRenderTarget | null = null
  // Ancho/alto actuales del drawing buffer y de los targets de bloom, y el
  // paso de texel de media resolución. Se recalculan en resize.
  let bufW = 0
  let bufH = 0
  let bloomW = 0
  let bloomH = 0
  const texel = new Vector2()
  // Scratch para leer el tamaño del drawing buffer sin asignar en resize.
  const dbSize = new Vector2()

  /** Crea un render target de bloom (media res, LDR: el bloom vive en el mismo
   *  espacio de display que la base, no necesita HDR). */
  function nuevoTarget(w: number, h: number): WebGLRenderTarget {
    const rt = new WebGLRenderTarget(w, h, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    })
    // Sin conversión de color: se trabaja en el mismo espacio de bytes del
    // canvas (valores de display), y los shaders custom escriben gl_FragColor
    // directo, así que Three no debe decodificar ni recodificar.
    rt.texture.colorSpace = NoColorSpace
    return rt
  }

  function liberarTargets(): void {
    sceneCopy?.dispose()
    rtA?.dispose()
    rtB?.dispose()
    sceneCopy = null
    rtA = null
    rtB = null
  }

  function resize(): void {
    // `off`: sin pipeline, sin targets, sin VRAM. La ausencia de asignación es
    // parte de "off = costo de hoy": ni siquiera se reserva memoria de GPU.
    if (config === null) return

    renderer.getDrawingBufferSize(dbSize)
    const w = Math.max(1, Math.floor(dbSize.x))
    const h = Math.max(1, Math.floor(dbSize.y))
    const bw = Math.max(1, Math.floor(w / config.divisor))
    const bh = Math.max(1, Math.floor(h / config.divisor))
    // Sin cambios reales: no recrear nada (evita liberar/alocar VRAM al
    // arrastrar una ventana que en verdad no cambió el drawing buffer).
    if (w === bufW && h === bufH && bw === bloomW && bh === bloomH && sceneCopy !== null) return

    bufW = w
    bufH = h
    bloomW = bw
    bloomH = bh
    texel.set(1 / bloomW, 1 / bloomH)

    liberarTargets()
    const copia = new FramebufferTexture(w, h)
    copia.minFilter = LinearFilter
    copia.magFilter = LinearFilter
    copia.colorSpace = NoColorSpace
    sceneCopy = copia
    rtA = nuevoTarget(bloomW, bloomH)
    rtB = nuevoTarget(bloomW, bloomH)
  }

  function render(): void {
    // `off`, o todavía sin targets (canvas de tamaño 0 al arrancar): cero
    // trabajo de GPU. Éste es el camino que hace que "off = costo de hoy".
    if (config === null || sceneCopy === null || rtA === null || rtB === null) return

    // 1) Copiar el canvas ya dibujado (mundo + viewmodel + tonemap) a textura.
    //    El render target actual es null (canvas), que es de donde copia.
    renderer.copyFramebufferToTexture(sceneCopy)

    // 2) Bright pass: umbral + baja a media resolución. Escribe en rtA.
    brightMat.uniforms.tDiffuse.value = sceneCopy
    brightMat.uniforms.uThreshold.value = config.threshold
    brightMat.uniforms.uKnee.value = config.knee
    renderer.setRenderTarget(rtA)
    quad.material = brightMat
    quad.render(renderer)

    // 3) Blur separable en ping-pong. Cada iteración ensancha el radio, para un
    //    derrame ancho sin pirámide de mips. Empieza leyendo rtA.
    quad.material = blurMat
    let leer = rtA
    let escribir = rtB
    const dir = blurMat.uniforms.uDirection.value as Vector2
    for (let i = 0; i < config.iterations; i++) {
      const radio = config.spread * (i + 1)
      // Horizontal
      dir.set(texel.x * radio, 0)
      blurMat.uniforms.tDiffuse.value = leer.texture
      renderer.setRenderTarget(escribir)
      quad.render(renderer)
      let tmp = leer
      leer = escribir
      escribir = tmp
      // Vertical
      dir.set(0, texel.y * radio)
      blurMat.uniforms.tDiffuse.value = leer.texture
      renderer.setRenderTarget(escribir)
      quad.render(renderer)
      tmp = leer
      leer = escribir
      escribir = tmp
    }

    // 4) Composite aditivo sobre el canvas. `leer` tiene el bloom final.
    compositeMat.uniforms.tDiffuse.value = leer.texture
    compositeMat.uniforms.uStrength.value = config.strength
    renderer.setRenderTarget(null)
    quad.material = compositeMat
    quad.render(renderer)

    // Deja el render target en null, como lo encontró: la próxima pasada del
    // frame siguiente (gfx.render) asume que el target actual es el canvas.
  }

  return {
    setQuality(next: BloomQuality): void {
      if (next === quality) return
      quality = next
      if (next === 'off') {
        // Apagar libera la VRAM de los targets y resetea el tamaño cacheado,
        // así un encendido posterior los vuelve a crear. En `off` no queda
        // rastro del pipeline.
        config = null
        liberarTargets()
        bufW = 0
        bufH = 0
        return
      }
      config = CONFIG_POR_CALIDAD[next]
      // Crea (o redimensiona) los targets para la config nueva. `bajo` y `alto`
      // comparten divisor, así que alternar entre ellos no recrea nada:
      // resize() detecta que el tamaño no cambió y sólo el próximo render()
      // usa el umbral/fuerza/iteraciones nuevos.
      resize()
    },

    get quality(): BloomQuality {
      return quality
    },

    resize,
    render,

    dispose(): void {
      liberarTargets()
      quad.dispose()
      brightMat.dispose()
      blurMat.dispose()
      compositeMat.dispose()
    },
  }
}
