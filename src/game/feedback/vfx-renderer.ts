/**
 * Sube los efectos de disparo (feedback/vfx.ts) a la GPU. Es el ÚNICO
 * archivo nuevo autorizado a importar three (ver architecture.test.ts): todo
 * lo demás del sistema de VFX es estado puro.
 *
 * CÓMO ESTÁ HECHO Y POR QUÉ
 *
 * Un mesh instanciado por tipo de efecto, y las partículas se animan EN EL
 * SHADER. Cada instancia guarda su momento de spawn; el vertex shader
 * calcula `edad = uTime - spawnTime` y de ahí saca posición, escala y
 * opacidad. La consecuencia es la que importa: el trabajo por frame de CPU
 * es escribir un uniform, no recorrer partículas. Con 96 impactos y 48
 * trazadores vivos el costo de CPU es el mismo que con cero.
 *
 * Los buffers de instancia sólo se re-suben cuando el anillo cambió de
 * versión (o sea, cuando alguien disparó), no cada frame.
 *
 * EL PRESUPUESTO ACÁ ES FILL RATE, NO CPU
 * Las partículas aditivas son overdraw puro y son la forma clásica de
 * fundir un presupuesto de GPU. Las defensas son: quads chicos, vidas
 * cortas, `depthWrite = false` con `depthTest = true` (se ocluyen contra el
 * mundo pero no se pelean entre ellas), y pools con techo duro.
 *
 * TEXTURAS: LO QUE SE BAJA vs LO QUE SE GENERA
 * Se bajan sólo el fulgor de boca y el humo (public/assets/vfx/particles.png,
 * atlas 2x2 en escala de grises armado del Particle Pack de Kenney, CC0):
 * el falloff con púas de un fulgor y el alfa turbulento del humo no se
 * fingen con un gradiente. Trazador, chispa y marca de bala se GENERAN acá
 * con canvas 2D — son gradientes radiales y longitudinales, idénticos a ojo
 * a un PNG de 512px que sería 95% alfa vacío, y pesan cero bytes.
 */

import {
  AdditiveBlending,
  Box3,
  BufferAttribute,
  CanvasTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  NormalBlending,
  type Object3D,
  type Scene,
  ShaderMaterial,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { VFX } from '@/game/feedback/tuning'
import type { VfxRing, VfxState } from '@/game/feedback/vfx'

export interface VfxRenderer {
  /** Escribe los anillos que hayan cambiado y actualiza el reloj de los
   *  shaders. Llamar una vez por frame, antes de render(). */
  sync(state: VfxState, timeS: number): void
  /**
   * Ata el fulgor de boca al pivote animado del arma y calcula dónde queda
   * la boca. Es idempotente: llamarla cada frame no cuesta nada mientras
   * `slug` no cambie. Hay que pasarle el slug porque el pivote es SIEMPRE el
   * mismo objeto (lo que cambia es el modelo colgado abajo), así que
   * comparar por identidad no alcanza para saber que hay que recalcular.
   */
  attachWeapon(weapon: Object3D | null, slug: string | null): void
  /** Estado de cada lote, para diagnosticar por qué un efecto no se ve. */
  info(): Record<string, { enEscena: boolean; visible: boolean; conMapa: boolean; instancias: number; verts: number }>
  dispose(): void
}

/** Atributos por instancia. Se preasignan al tamaño del pool y nunca crecen. */
interface Lote {
  geometria: InstancedBufferGeometry
  malla: Mesh
  material: ShaderMaterial
  pos: Float32Array
  dir: Float32Array
  spawn: Float32Array
  escala: Float32Array
  semilla: Float32Array
  extra: Float32Array
  ultimaVersion: number
}

/**
 * Quad unitario compartido: las esquinas van en el atributo `position`, con
 * xy en [-0.5, 0.5] y z en 0.
 *
 * Tiene que llamarse `position`: Three saca la cantidad de vértices a
 * dibujar de `geometry.attributes.position` cuando la geometría no tiene
 * índice, así que una geometría sin ese atributo se sube sin errores, cuenta
 * como draw call y no dibuja un solo píxel. Es el modo de fallar más
 * silencioso posible -- ni Three ni WebGL avisan nada -- y costó una captura
 * de pantalla vacía descubrirlo.
 */
function atributosDeQuad(geo: InstancedBufferGeometry): void {
  // Dos triángulos, sin índice: son 6 vértices, no vale la pena indexar.
  const position = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0,
    -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ])
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])
  geo.setAttribute('position', new BufferAttribute(position, 3))
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
}

function crearLote(capacidad: number, material: ShaderMaterial): Lote {
  const geometria = new InstancedBufferGeometry()
  atributosDeQuad(geometria)
  geometria.instanceCount = capacidad

  const pos = new Float32Array(capacidad * 3)
  const dir = new Float32Array(capacidad * 3)
  const spawn = new Float32Array(capacidad)
  const escala = new Float32Array(capacidad)
  const semilla = new Float32Array(capacidad)
  const extra = new Float32Array(capacidad)

  // spawn muy negativo = "esta instancia nunca existió": el shader la
  // descarta por edad sin necesitar un flag aparte.
  spawn.fill(-1e9)

  geometria.setAttribute('iPos', new InstancedBufferAttribute(pos, 3))
  geometria.setAttribute('iDir', new InstancedBufferAttribute(dir, 3))
  geometria.setAttribute('iSpawn', new InstancedBufferAttribute(spawn, 1))
  geometria.setAttribute('iEscala', new InstancedBufferAttribute(escala, 1))
  geometria.setAttribute('iSemilla', new InstancedBufferAttribute(semilla, 1))
  geometria.setAttribute('iExtra', new InstancedBufferAttribute(extra, 1))

  const malla = new Mesh(geometria, material)
  // Las posiciones se calculan en el shader, así que la bounding sphere que
  // Three infiere no describe dónde está realmente la partícula: con culling
  // activo el lote entero desaparecería en cuanto la cámara mire para otro
  // lado.
  malla.frustumCulled = false
  malla.matrixAutoUpdate = false

  return {
    geometria,
    malla,
    material,
    pos,
    dir,
    spawn,
    escala,
    semilla,
    extra,
    ultimaVersion: -1,
  }
}

/** Copia un anillo a los arrays de instancia. Sólo si cambió la versión. */
function subirLote(lote: Lote, ring: VfxRing, usarLargo: boolean): void {
  if (lote.ultimaVersion === ring.version) return
  lote.ultimaVersion = ring.version

  for (let i = 0; i < ring.capacidad; i++) {
    const it = ring.items[i]
    if (!it.usada) continue
    const i3 = i * 3
    lote.pos[i3] = it.x
    lote.pos[i3 + 1] = it.y
    lote.pos[i3 + 2] = it.z
    lote.dir[i3] = it.dx
    lote.dir[i3 + 1] = it.dy
    lote.dir[i3 + 2] = it.dz
    lote.spawn[i] = it.spawnTimeS
    lote.escala[i] = it.escala
    lote.semilla[i] = it.semilla
    lote.extra[i] = usarLargo ? it.largo : it.superficie
  }

  lote.geometria.getAttribute('iPos').needsUpdate = true
  lote.geometria.getAttribute('iDir').needsUpdate = true
  lote.geometria.getAttribute('iSpawn').needsUpdate = true
  lote.geometria.getAttribute('iEscala').needsUpdate = true
  lote.geometria.getAttribute('iSemilla').needsUpdate = true
  lote.geometria.getAttribute('iExtra').needsUpdate = true
}

/** Cabecera común: atributos y uniforms que usan todos los shaders. */
const CABECERA = `
  attribute vec3 iPos;
  attribute vec3 iDir;
  attribute float iSpawn;
  attribute float iEscala;
  attribute float iSemilla;
  attribute float iExtra;
  uniform float uTime;
  uniform float uVida;
  varying vec2 vUv;
  varying float vEdad;
  varying float vSemilla;
  varying float vExtra;
`

/** Rota un vec2 en el plano del quad, para que dos partículas seguidas no
 *  salgan con la misma orientación. */
const ROTAR = `
  vec2 rotar(vec2 p, float a) {
    float c = cos(a); float s = sin(a);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  }
`

/** Billboard estándar: el quad se arma en espacio de vista, así siempre
 *  queda de frente a la cámara sin calcular nada en CPU. */
const VS_BILLBOARD = `
  ${CABECERA}
  ${ROTAR}
  void main() {
    vUv = uv;
    vSemilla = iSemilla;
    vExtra = iExtra;
    float edad = uTime - iSpawn;
    vEdad = edad / uVida;

    if (edad < 0.0 || edad > uVida) {
      // Fuera de su vida: colapsar el triángulo a un punto lo saca del
      // rasterizador sin costo de fragmentos.
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }

    float t = vEdad;
    // Expande un poco al nacer: da sensación de golpe en vez de aparición.
    float escala = iEscala * (1.0 + t * 0.8);
    vec2 c = rotar(position.xy * escala, iSemilla * 6.2831);

    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    mv.xy += c;
    gl_Position = projectionMatrix * mv;
  }
`

/**
 * Trazador: cinta estirada a lo largo de la dirección de tiro que además
 * VIAJA. La cabeza avanza a VFX.tracerSpeed y la cola la sigue a
 * VFX.tracerLength de distancia, recortada para no pasarse del punto de
 * impacto (iExtra trae la distancia real hasta el blanco).
 */
const VS_TRAZADOR = `
  ${CABECERA}
  uniform float uVelocidad;
  uniform float uLargo;
  void main() {
    vUv = uv;
    vSemilla = iSemilla;
    vExtra = iExtra;
    float edad = uTime - iSpawn;
    vEdad = edad / uVida;

    if (edad < 0.0 || edad > uVida) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }

    float distTotal = iExtra;
    float cabeza = min(edad * uVelocidad, distTotal);
    float cola = max(cabeza - uLargo, 0.0);

    // position.x en [-0.5, 0.5] recorre el segmento de la cola a la cabeza.
    float a = position.x + 0.5;
    float d = mix(cola, cabeza, a);
    vec3 mundo = iPos + iDir * d;

    // Eje transversal: perpendicular a la dirección de viaje Y a la línea de
    // visión, para que la cinta se vea igual de ancha desde cualquier ángulo.
    vec3 haciaCam = normalize(cameraPosition - mundo);
    vec3 lado = normalize(cross(iDir, haciaCam));
    mundo += lado * position.y * iEscala;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(mundo, 1.0);
  }
`

/** Calcomanía: quad fijo, orientado por la normal de la superficie. */
const VS_CALCOMANIA = `
  ${CABECERA}
  ${ROTAR}
  void main() {
    vUv = uv;
    vSemilla = iSemilla;
    vExtra = iExtra;
    float edad = uTime - iSpawn;
    vEdad = edad / uVida;

    if (edad < 0.0 || edad > uVida) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }

    // Base ortonormal sobre el plano de la pared. El vector auxiliar se
    // elige lejos de la normal para que el producto cruz no degenere cuando
    // la normal apunta casi en +Y (el piso).
    vec3 n = normalize(iDir);
    vec3 aux = abs(n.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 u = normalize(cross(aux, n));
    vec3 v = cross(n, u);

    vec2 c = rotar(position.xy * iEscala, iSemilla * 6.2831);
    vec3 mundo = iPos + u * c.x + v * c.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(mundo, 1.0);
  }
`

/** Fragment del fulgor: toma la mitad superior del atlas (las dos variantes
 *  de fulgor) y elige una según la semilla. */
const FS_FULGOR = `
  uniform sampler2D uMapa;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vEdad;
  varying float vSemilla;
  varying float vExtra;
  void main() {
    // Atlas 2x2: fila de arriba = fulgores. Celda 0 o 1 según semilla.
    float celda = step(0.5, vSemilla);
    vec2 uv = vec2(vUv.x * 0.5 + celda * 0.5, vUv.y * 0.5 + 0.5);
    float m = texture2D(uMapa, uv).r;
    // Se apaga rápido y de forma no lineal: un fulgor lineal se ve a goma.
    float f = 1.0 - vEdad;
    float alfa = m * f * f;
    if (alfa < 0.01) discard;
    gl_FragColor = vec4(uColor * alfa, alfa);
  }
`

/** Fragment del humo: mitad inferior del atlas, alfa normal y gris. */
const FS_HUMO = `
  uniform sampler2D uMapa;
  varying vec2 vUv;
  varying float vEdad;
  varying float vSemilla;
  varying float vExtra;
  void main() {
    float celda = step(0.5, vSemilla);
    vec2 uv = vec2(vUv.x * 0.5 + celda * 0.5, vUv.y * 0.5);
    float m = texture2D(uMapa, uv).r;
    // Entra rápido, sale lento: así se lee como humo y no como destello.
    float entrada = smoothstep(0.0, 0.15, vEdad);
    float salida = 1.0 - smoothstep(0.3, 1.0, vEdad);
    float alfa = m * entrada * salida * 0.5;
    if (alfa < 0.01) discard;
    gl_FragColor = vec4(vec3(0.55, 0.54, 0.5), alfa);
  }
`

/** Fragment de chispa y trazador: textura generada, color por superficie. */
const FS_CHISPA = `
  uniform sampler2D uMapa;
  varying vec2 vUv;
  varying float vEdad;
  varying float vSemilla;
  varying float vExtra;
  void main() {
    float m = texture2D(uMapa, vUv).r;
    // vExtra: 0 = hormigón (chispa naranja), 1 = carne (rojo apagado).
    vec3 color = mix(vec3(1.0, 0.72, 0.32), vec3(0.85, 0.18, 0.14), vExtra);
    float f = 1.0 - vEdad;
    float alfa = m * f * f;
    if (alfa < 0.01) discard;
    gl_FragColor = vec4(color * alfa, alfa);
  }
`

const FS_TRAZADOR = `
  uniform sampler2D uMapa;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vEdad;
  varying float vSemilla;
  varying float vExtra;
  void main() {
    float m = texture2D(uMapa, vUv).r;
    float alfa = m * (1.0 - vEdad);
    if (alfa < 0.01) discard;
    gl_FragColor = vec4(uColor * alfa, alfa);
  }
`

const FS_CALCOMANIA = `
  uniform sampler2D uMapa;
  varying vec2 vUv;
  varying float vEdad;
  varying float vSemilla;
  varying float vExtra;
  uniform float uFade;
  void main() {
    vec4 t = texture2D(uMapa, vUv);
    // Se mantiene opaca casi toda su vida y recién se desvanece al final:
    // desvanecer desde el principio deja marcas fantasma por todos lados.
    float salida = 1.0 - smoothstep(1.0 - uFade, 1.0, vEdad);
    float alfa = t.a * salida;
    if (alfa < 0.01) discard;
    // Núcleo oscuro (el agujero) con anillo de polvo más claro en el borde.
    // Un disco liso oscuro es casi invisible contra el gris azulado del mapa
    // -- el contraste del anillo es lo que hace que la marca se LEA como
    // impacto y no como una mancha de la textura.
    vec3 polvo = vec3(0.46, 0.44, 0.40);
    vec3 agujero = vec3(0.03, 0.028, 0.025);
    vec3 col = mix(polvo, agujero, smoothstep(0.25, 0.75, t.a));
    gl_FragColor = vec4(col, alfa);
  }
`

/** Canvas 2D descartable para generar texturas. Devuelve null fuera del
 *  navegador (tests en node), y el material queda sin mapa: no rompe nada. */
function crearCanvas(lado: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = lado
  c.height = lado
  return c
}

/**
 * Trazador generado: gradiente longitudinal (brillante en la cabeza, apagado
 * en la cola) con caída suave a lo ancho. Esto es literalmente lo que sería
 * un PNG de 512px del pack, con 95% de alfa vacío, en unas pocas líneas.
 */
function generarTexturaTrazador(): Texture | null {
  const c = crearCanvas(64)
  if (!c) return null
  const ctx = c.getContext('2d')
  if (!ctx) return null

  const img = ctx.createImageData(64, 64)
  for (let y = 0; y < 64; y++) {
    // Caída transversal: coseno elevado, borde suave.
    const dy = (y / 63) * 2 - 1
    const across = Math.max(0, 1 - dy * dy)
    const across2 = across * across
    for (let x = 0; x < 64; x++) {
      // Cabeza (x=1) brillante, cola (x=0) apagada.
      const along = Math.pow(x / 63, 2.2)
      const v = Math.round(255 * across2 * along)
      const i = (y * 64 + x) * 4
      img.data[i] = 255
      img.data[i + 1] = 255
      img.data[i + 2] = 255
      img.data[i + 3] = v
    }
  }
  ctx.putImageData(img, 0, 0)
  return new CanvasTexture(c)
}

/** Chispa generada: núcleo radial brillante más unos rayos finos. */
function generarTexturaChispa(): Texture | null {
  const c = crearCanvas(64)
  if (!c) return null
  const ctx = c.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, 64, 64)
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)

  // Rayos: lo que separa una chispa de una bolita difusa.
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1.4
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2
    const largo = i % 2 === 0 ? 30 : 20
    ctx.beginPath()
    ctx.moveTo(32, 32)
    ctx.lineTo(32 + Math.cos(a) * largo, 32 + Math.sin(a) * largo)
    ctx.stroke()
  }
  return new CanvasTexture(c)
}

/**
 * Marca de bala generada: agujero oscuro con borde irregular. El pack de
 * Kenney no trae ninguna (sus "scorch" son estrellas de destello, no
 * impactos), así que generarla no es sólo más barato: es la única opción
 * que da la forma correcta.
 */
function generarTexturaCalcomania(): Texture | null {
  const c = crearCanvas(64)
  if (!c) return null
  const ctx = c.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, 64, 64)
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.42, 'rgba(255,255,255,0.92)')
  g.addColorStop(0.66, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(32, 32, 30, 0, Math.PI * 2)
  ctx.fill()

  // Astillas alrededor: un círculo perfecto se lee como calcomanía pegada.
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + (i % 3) * 0.4
    const r = 14 + (i % 4) * 4
    ctx.beginPath()
    ctx.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 2.4 - (i % 3) * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }
  return new CanvasTexture(c)
}

function crearMaterial(
  vs: string,
  fs: string,
  vida: number,
  aditivo: boolean,
  extras: Record<string, { value: number | Texture | null | Vector3 }> = {},
): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: vs,
    fragmentShader: fs,
    uniforms: {
      uTime: { value: 0 },
      uVida: { value: vida },
      uMapa: { value: null },
      ...extras,
    },
    transparent: true,
    // depthTest sí (las partículas se ocluyen contra el mundo), depthWrite no
    // (no deben taparse entre ellas ni ensuciar el z-buffer del mundo).
    depthTest: true,
    depthWrite: false,
    blending: aditivo ? AdditiveBlending : NormalBlending,
  })
}

export function createVfxRenderer(escena: Scene): VfxRenderer {
  const texTrazador = generarTexturaTrazador()
  const texChispa = generarTexturaChispa()
  const texCalcomania = generarTexturaCalcomania()

  const matFulgor = crearMaterial(VS_BILLBOARD, FS_FULGOR, VFX.muzzleLifeS, true, {
    uColor: { value: new Vector3(1.0, 0.86, 0.6) },
  })
  const matTrazador = crearMaterial(VS_TRAZADOR, FS_TRAZADOR, VFX.tracerLifeS, true, {
    uColor: { value: new Vector3(1.0, 0.85, 0.55) },
    uVelocidad: { value: VFX.tracerSpeed },
    uLargo: { value: VFX.tracerLength },
  })
  const matChispa = crearMaterial(VS_BILLBOARD, FS_CHISPA, VFX.impactLifeS, true)
  const matHumo = crearMaterial(VS_BILLBOARD, FS_HUMO, VFX.impactLifeS * 3, false)
  const matCalcomania = crearMaterial(VS_CALCOMANIA, FS_CALCOMANIA, VFX.decalLifeS, false, {
    uFade: { value: VFX.decalFadeFraction },
  })

  matTrazador.uniforms.uMapa.value = texTrazador
  matChispa.uniforms.uMapa.value = texChispa
  matCalcomania.uniforms.uMapa.value = texCalcomania

  // El atlas (fulgor + humo) es lo único que se baja. Se pide después de
  // construir los materiales porque el callback les escribe el uniform.
  let texAtlas: Texture | null = null
  if (typeof document !== 'undefined') {
    new TextureLoader().load(
      '/assets/vfx/particles.png',
      (t) => {
        texAtlas = t
        matFulgor.uniforms.uMapa.value = t
        matHumo.uniforms.uMapa.value = t
      },
      undefined,
      () => {
        // Sin atlas el resto de los efectos siguen andando: el fulgor
        // simplemente no dibuja (uMapa nulo -> textura negra -> discard).
      },
    )
  }

  const fulgor = crearLote(VFX.muzzlePoolSize, matFulgor)
  const trazadores = crearLote(VFX.tracerPoolSize, matTrazador)
  const chispas = crearLote(VFX.impactPoolSize, matChispa)
  const humos = crearLote(VFX.impactPoolSize, matHumo)
  const calcomanias = crearLote(VFX.decalPoolSize, matCalcomania)

  // El mundo recibe todo menos el fulgor: ése va colgado del arma, que vive
  // en la escena del viewmodel (segunda pasada de render).
  escena.add(trazadores.malla)
  escena.add(chispas.malla)
  escena.add(humos.malla)
  escena.add(calcomanias.malla)

  let armaActual: Object3D | null = null
  let slugActual: string | null = null
  const cajaLocal = new Box3()
  const cajaAux = new Box3()
  const inversaArma = new Matrix4()
  const matrizAux = new Matrix4()
  const puntoBoca = new Vector3()

  /**
   * Punto de la boca del arma en espacio LOCAL del pivote animado. Se
   * recalcula sólo al cambiar de arma, nunca por frame.
   *
   * DOS COSAS QUE PARECEN DE MÁS Y NO LO SON
   *
   * 1. La caja se arma uniendo las cajas de cada geometría YA LLEVADAS a
   *    local, en vez de con Box3.setFromObject: ése devuelve la caja en
   *    MUNDO, y como el arma rota con la mirada, su "min.z" en mundo no es
   *    la punta del cañón sino el punto más al norte de la escena. Con eso
   *    el fulgor salía del medio del arma y encima se movía según hacia
   *    dónde estuviera mirando el jugador.
   *
   * 2. La boca es el frente de la caja en -Z, y no el extremo del eje más
   *    largo. Probé la segunda heurística pensando que sería robusta a la
   *    orientación de cada GLB y sale PEOR: el modelo cuelga del pivote con
   *    un hipOffset.z positivo (weapons/registry.ts), así que su extremo
   *    más lejano al pivote es la CULATA, no el cañón, y el fulgor se iba
   *    para atrás del arma. En el espacio de la cámara del viewmodel el
   *    frente siempre es -Z, y el rotationOffset del registry existe
   *    justamente para dejar cada modelo mirando ahí, así que min.z es el
   *    criterio correcto.
   */
  function recalcularBoca(weapon: Object3D): void {
    weapon.updateWorldMatrix(true, true)
    inversaArma.copy(weapon.matrixWorld).invert()

    cajaLocal.makeEmpty()
    weapon.traverse((o) => {
      const malla = o as Mesh
      if (!malla.isMesh || !malla.geometry) return
      if (!malla.geometry.boundingBox) malla.geometry.computeBoundingBox()
      const bb = malla.geometry.boundingBox
      if (!bb) return
      cajaAux.copy(bb)
      matrizAux.multiplyMatrices(inversaArma, malla.matrixWorld)
      cajaAux.applyMatrix4(matrizAux)
      cajaLocal.union(cajaAux)
    })

    if (cajaLocal.isEmpty()) {
      // Todavía no hay modelo colgado: un valor de relleno razonable delante
      // del pivote, que se corrige en cuanto el GLB se adjunte.
      puntoBoca.set(0, 0, -0.35)
      return
    }

    cajaLocal.getCenter(puntoBoca)
    puntoBoca.z = cajaLocal.min.z
  }

  return {
    attachWeapon(weapon: Object3D | null, slug: string | null): void {
      if (armaActual === weapon && slugActual === slug) return
      if (armaActual && armaActual !== weapon) armaActual.remove(fulgor.malla)
      armaActual = weapon
      slugActual = slug
      if (!weapon) return
      if (fulgor.malla.parent !== weapon) weapon.add(fulgor.malla)
      // Sin modelo adjunto todavía la caja sale vacía y la boca caería en un
      // valor de relleno; se deja para el próximo frame, cuando el GLB ya
      // esté colgado.
      if (slug === null) return
      recalcularBoca(weapon)
      fulgor.malla.position.copy(puntoBoca)
      fulgor.malla.updateMatrix()
    },

    info() {
      const de = (nombre: string, l: Lote) => [nombre, {
        enEscena: l.malla.parent !== null,
        visible: l.malla.visible,
        conMapa: l.material.uniforms.uMapa.value !== null,
        instancias: l.geometria.instanceCount,
        verts: l.geometria.getAttribute('position')?.count ?? -1,
      }] as const
      return Object.fromEntries([
        de('fulgor', fulgor), de('trazadores', trazadores), de('chispas', chispas),
        de('humos', humos), de('calcomanias', calcomanias),
      ])
    },

    sync(state: VfxState, timeS: number): void {
      subirLote(fulgor, state.fulgores, false)
      subirLote(trazadores, state.trazadores, true)
      subirLote(chispas, state.impactos, false)
      subirLote(humos, state.impactos, false)
      subirLote(calcomanias, state.calcomanias, false)

      // El único trabajo garantizado por frame: un puñado de escrituras de
      // uniform. Las vidas se releen de VFX en vez de quedar congeladas en
      // el valor que tenían al construir el material: el resto del proyecto
      // trata los objetos de tuning como mutables en caliente (ver
      // feedback/tuning.ts), y si el shader se queda con una copia, mover
      // VFX.muzzleLifeS desde la consola no hace nada y engaña a quien esté
      // ajustando.
      matFulgor.uniforms.uTime.value = timeS
      matFulgor.uniforms.uVida.value = VFX.muzzleLifeS
      matTrazador.uniforms.uTime.value = timeS
      matTrazador.uniforms.uVida.value = VFX.tracerLifeS
      matTrazador.uniforms.uVelocidad.value = VFX.tracerSpeed
      matTrazador.uniforms.uLargo.value = VFX.tracerLength
      matChispa.uniforms.uTime.value = timeS
      matChispa.uniforms.uVida.value = VFX.impactLifeS
      matHumo.uniforms.uTime.value = timeS
      matHumo.uniforms.uVida.value = VFX.impactLifeS * 3
      matCalcomania.uniforms.uTime.value = timeS
      matCalcomania.uniforms.uVida.value = VFX.decalLifeS
      matCalcomania.uniforms.uFade.value = VFX.decalFadeFraction
    },

    dispose(): void {
      for (const l of [fulgor, trazadores, chispas, humos, calcomanias]) {
        l.geometria.dispose()
        l.material.dispose()
        l.malla.removeFromParent()
      }
      texTrazador?.dispose()
      texChispa?.dispose()
      texCalcomania?.dispose()
      texAtlas?.dispose()
    },
  }
}
