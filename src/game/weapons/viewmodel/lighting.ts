/**
 * Rig de iluminación del VIEWMODEL.
 *
 * POR QUÉ HACE FALTA UNO PROPIO
 * =============================
 * El viewmodel se dibuja en su PROPIA `Scene` (ver `renderer.ts`), separada de
 * la del mundo, para que el arma nunca se meta dentro de una pared ni la
 * recorte el z-buffer del nivel. El precio de esa separación es que ni las
 * luces del mapa ni su `scene.environment` llegan hasta acá: sin un rig
 * propio, un arma con material iluminado sale NEGRA, y un arma con material
 * unlit sale plana. Las dos versiones de "parece de plástico".
 *
 * CÓMO ESTÁ ARMADO
 * ================
 * Tres luces direccionales, que es el esquema clásico de estudio, más un
 * environment para el especular:
 *
 *   - KEY: arriba, adelante y a la izquierda. Es la que "modela" el arma y la
 *     que define de dónde parece venir la luz.
 *   - FILL: abajo y a la derecha, fría y floja. Levanta las sombras para que
 *     la mitad de abajo del arma no sea un bloque negro. No produce especular
 *     apreciable a propósito: si compitiera con la key, el arma se vería
 *     lavada.
 *   - RIM: detrás y arriba. Es LA luz de este rig: pega en los cantos
 *     superiores —riel, guardamanos, cañón— y es la que dibuja esa línea de
 *     brillo que corre a lo largo del arma cuando girás la vista. Sin rim, el
 *     arma tiene volumen pero no tiene filo.
 *
 * Las luces cuelgan de la CÁMARA y no de la escena. En este renderer la cámara
 * está fija en el origen, así que hoy da lo mismo; colgarlas de la cámara es
 * lo que hace que siga dando lo mismo si algún día la cámara del viewmodel se
 * mueve (retroceso, inspección del arma), en vez de que el arma se apague sola
 * al rotar.
 *
 * EL ENVIRONMENT, Y POR QUÉ NO ES UN ARCHIVO
 * ==========================================
 * El metal necesita algo que reflejar: en metallic-roughness, una superficie
 * metálica sin environment se ve NEGRA, porque toda su respuesta es especular
 * y no hay nada alrededor de dónde sacarla. El environment se genera en
 * código —un degradado de cielo a suelo con un lucernario más brillante— y se
 * pasa por PMREM una sola vez al arrancar. Cero bytes de textura en disco y
 * cero peticiones de red, igual que el sistema de camuflajes.
 */

import {
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  FloatType,
  type Object3D,
  PMREMGenerator,
  RGBAFormat,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three'

/**
 * Intensidades. Están en la relación 1 : 0.35 : 0.55 (key : fill : rim), que
 * es la que deja el arma leíble sin lavarla: la key manda, el fill sólo evita
 * el negro y el rim aporta filo sin volverse la luz principal.
 */
const INTENSIDAD_KEY = 2.6
const INTENSIDAD_FILL = 0.9
const INTENSIDAD_RIM = 1.45

/**
 * Cuánto contribuye el environment al difuso y al especular.
 *
 * Por debajo de 1 a propósito: el environment está para que el metal tenga
 * algo que reflejar, no para iluminar la escena. Subirlo lava el arma y le
 * roba el contraste que le dan las tres direccionales.
 */
const INTENSIDAD_ENVIRONMENT = 0.55

/** Lado del equirectangular procedural, antes del PMREM. */
const LADO_ENV = 64

/**
 * Genera el equirectangular que alimenta el PMREM.
 *
 * Es deliberadamente simple: un degradado vertical de cielo (arriba, claro y
 * levemente azulado) a suelo (abajo, oscuro y cálido), más una zona más
 * brillante al frente que hace de lucernario. Esa asimetría es lo que hace que
 * el reflejo en el metal CAMBIE al girar el arma; con un environment uniforme
 * el metal reflejaría lo mismo en todas las direcciones y volveríamos a tener
 * una superficie de color plano, que es el problema que veníamos a resolver.
 */
function crearEquirectangular(): DataTexture {
  const ancho = LADO_ENV * 2
  const alto = LADO_ENV
  const datos = new Float32Array(ancho * alto * 4)

  for (let y = 0; y < alto; y++) {
    // v va de 0 (cenit) a 1 (nadir).
    const v = y / (alto - 1)
    // Cielo -> horizonte -> suelo. El horizonte se aclara un poco: es lo que
    // en un reflejo se lee como "hay un ambiente acá afuera".
    const cielo = 1 - Math.min(1, v * 1.6)
    const suelo = Math.max(0, v * 1.6 - 0.6)
    for (let x = 0; x < ancho; x++) {
      const u = x / ancho
      // Lucernario: un lóbulo suave centrado al frente de la escena.
      const angulo = Math.abs(((u + 0.75) % 1) - 0.5) * 2
      const ventana = Math.pow(Math.max(0, 1 - angulo * 1.7), 3) * (1 - v) * 2.2

      const base = 0.16 + cielo * 0.55 + ventana
      const i = (y * ancho + x) * 4
      datos[i] = base * (1 - suelo * 0.55) + suelo * 0.1
      datos[i + 1] = base * (1 - suelo * 0.45) + suelo * 0.085
      datos[i + 2] = base * (1 - suelo * 0.25) * 1.06 + suelo * 0.07
      datos[i + 3] = 1
    }
  }

  const textura = new DataTexture(datos, ancho, alto, RGBAFormat, FloatType)
  textura.mapping = EquirectangularReflectionMapping
  textura.needsUpdate = true
  return textura
}

export interface RigDeLuz {
  /**
   * El environment ya pasado por PMREM, o null si no se pudo generar (ver
   * `puedeGenerarEnvironment`). Null significa "arma iluminada por las tres
   * direccionales, pero sin reflejos en el metal", no "arma rota".
   */
  readonly environment: Texture | null
  /** Suelta la textura del environment. */
  dispose(): void
}

/**
 * Si este renderer puede generar el environment.
 *
 * `PMREMGenerator` no es un cálculo en CPU: renderiza el equirectangular a un
 * render target y compila shaders, así que necesita un contexto WebGL VIVO. En
 * los tests el renderer compartido es un doble mínimo (`clearDepth` y
 * `render`), y en esas condiciones pedirle un PMREM revienta.
 *
 * La comprobación es por capacidad y no por "¿estoy en un test?" a propósito:
 * lo que importa no es quién llama sino si hay GL detrás, y la degradación
 * —luces sí, reflejos no— es la misma en los dos casos. Las luces se instalan
 * SIEMPRE, que es lo que garantiza que un viewmodel nunca se quede sin
 * iluminación por este camino.
 */
function puedeGenerarEnvironment(renderer: WebGLRenderer): boolean {
  return typeof renderer.getRenderTarget === 'function'
}

/**
 * Instala luces y environment en la escena del viewmodel.
 *
 * `padre` es el nodo del que cuelgan las luces —en la práctica, la cámara del
 * viewmodel— y `scene` es donde se asigna el environment.
 */
export function instalarRigDeLuz(
  scene: Scene,
  padre: Object3D,
  renderer: WebGLRenderer,
): RigDeLuz {
  // Las posiciones son direcciones en espacio de cámara: -Z es "hacia donde
  // mira la cámara", así que un Z positivo deja la luz DETRÁS del punto de
  // vista, del lado del jugador.
  const key = new DirectionalLight(0xfff2e0, INTENSIDAD_KEY)
  key.position.set(-0.6, 1.0, 0.55)
  padre.add(key)
  padre.add(key.target)

  const fill = new DirectionalLight(0xc8d8ff, INTENSIDAD_FILL)
  fill.position.set(0.85, -0.5, 0.4)
  padre.add(fill)
  padre.add(fill.target)

  // El rim va al frente-arriba (Z negativo) para pegarle a los cantos que
  // miran EN CONTRA del jugador, que son los que dibujan el filo del arma.
  const rim = new DirectionalLight(0xdce8ff, INTENSIDAD_RIM)
  rim.position.set(0.25, 0.8, -0.9)
  padre.add(rim)
  padre.add(rim.target)

  if (!puedeGenerarEnvironment(renderer)) {
    return { environment: null, dispose(): void {} }
  }

  const pmrem = new PMREMGenerator(renderer)
  const equirect = crearEquirectangular()
  const objetivo = pmrem.fromEquirectangular(equirect)
  // El equirectangular crudo ya no hace falta: lo que se usa es el cubemap
  // filtrado. El PMREMGenerator también se suelta acá porque este rig se arma
  // una sola vez y no se vuelve a generar nada.
  equirect.dispose()
  pmrem.dispose()

  scene.environment = objetivo.texture
  scene.environmentIntensity = INTENSIDAD_ENVIRONMENT

  return {
    environment: objetivo.texture,
    dispose(): void {
      objetivo.texture.dispose()
    },
  }
}
