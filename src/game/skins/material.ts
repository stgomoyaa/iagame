/**
 * Aplicación de una skin sobre la malla de un arma.
 *
 * El problema, y por qué esto no es "cambiar el color del material":
 *
 * Las 40 armas salen del pipeline (sección 6.3 del spec) como **una sola
 * llamada de dibujo**: una primitiva, un `MeshBasicMaterial` unlit, y los
 * colores de los materiales originales horneados en el atributo `COLOR_0`
 * de la geometría. No hay texturas, no hay luces, no hay segundo material.
 * Una skin tiene que respetar eso: cero descargas por skin, cero llamadas de
 * dibujo extra, sin pasar a un material con iluminación. Cambiarle el
 * `color` al material multiplicaría todo el arma por un tinte plano y se
 * vería como un arma pintada con rodillo, porque perdería la distinción
 * entre partes que hoy hace el horneado.
 *
 * La solución: **el horneado es la señal, no el enemigo**. `COLOR_0` ya
 * separa metal, madera y polímero, y esa separación es gratis y está en
 * todos los modelos. El shader la lee y la reinterpreta:
 *
 * 1. **Regiones por saturación.** Lo saturado del horneado (maderas,
 *    empuñaduras, partes de color) se pinta con el color de acento de la
 *    skin; lo gris (metal, polímero) con el color base. La skin respeta la
 *    anatomía del arma en vez de taparla.
 * 2. **Detalle por luminancia.** La luminancia relativa del horneado se
 *    reusa como rampa de valor sobre el color nuevo, así las piezas siguen
 *    diferenciándose entre sí. Las zonas casi negras (miras, interior del
 *    cañón) se quedan oscuras: son las que hacen legible la silueta.
 * 3. **Normal por derivadas.** Los GLB traen POSITION y COLOR_0 y nada más:
 *    no hay atributo NORMAL. La normal geométrica se reconstruye en el
 *    fragment shader con `cross(dFdx(P), dFdy(P))` sobre la posición en
 *    espacio de vista. Sale facetada, que en mallas de ~1.200 triángulos es
 *    justo el look correcto, y habilita luz de key fija, brillo especular y
 *    realce de canto **sin material iluminado**: es sombreado calculado
 *    dentro del mismo shader unlit, no una luz de la escena.
 * 4. **Patrón y desgaste procedurales** desde la posición en espacio de
 *    objeto. Cero bytes de textura, y estables cuando el arma se mueve.
 *
 * Y la parte que hace que cambiar de skin sea gratis: **un solo programa
 * para todas las skins**. Patrón y animación son uniforms enteros con un
 * `switch` adentro del shader, no permutaciones de `#define`. Equipar una
 * skin escribe uniforms; no recompila nada, no vuelve a subir geometría, no
 * agrega materiales. `material.needsUpdate` se toca una sola vez por malla,
 * la primera vez que se la parcha.
 *
 * Éste es uno de los archivos de src/game autorizados a importar three (ver
 * architecture.test.ts): es el borde entre el generador, que es matemática
 * pura (skins/generator.ts), y la escena.
 */

import { Color, type Mesh, MeshBasicMaterial, SRGBColorSpace, Vector3 } from 'three'
import type { Skin } from '@/game/skins/generator'
import { PATTERN_INDEX } from '@/game/skins/patterns'
import type { AnimationId } from '@/game/skins/rarity'

/** Índice de animación que consume el shader. Contrato con el `switch` del GLSL. */
const ANIMATION_INDEX: Record<AnimationId, number> = {
  ninguna: 0,
  pulso: 1,
  flujo: 2,
  espectro: 3,
}

interface SkinUniforms {
  uSkinEnabled: { value: number }
  uSkinBase: { value: Color }
  uSkinAccent: { value: Color }
  uSkinPattern: { value: number }
  uSkinPatternScale: { value: number }
  uSkinWear: { value: number }
  uSkinMetal: { value: number }
  uSkinEmissive: { value: number }
  uSkinAnim: { value: number }
  uSkinTime: { value: number }
  /** Semiejes del bounding box del arma. Normaliza el patrón por tamaño. */
  uSkinExtent: { value: Vector3 }
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vSkinObj;
varying vec3 vSkinView;
`

const VERTEX_BODY = /* glsl */ `
vSkinObj = position;
vSkinView = ( modelViewMatrix * vec4( position, 1.0 ) ).xyz;
`

const FRAGMENT_PARS = /* glsl */ `
uniform float uSkinEnabled;
uniform vec3 uSkinBase;
uniform vec3 uSkinAccent;
uniform int uSkinPattern;
uniform float uSkinPatternScale;
uniform float uSkinWear;
uniform float uSkinMetal;
uniform float uSkinEmissive;
uniform int uSkinAnim;
uniform float uSkinTime;
uniform vec3 uSkinExtent;
varying vec3 vSkinObj;
varying vec3 vSkinView;

float skinHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.71, 0.113, 0.419 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

float skinNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix(
      mix( skinHash( i + vec3( 0.0, 0.0, 0.0 ) ), skinHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ),
      mix( skinHash( i + vec3( 0.0, 1.0, 0.0 ) ), skinHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ),
      f.y ),
    mix(
      mix( skinHash( i + vec3( 0.0, 0.0, 1.0 ) ), skinHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ),
      mix( skinHash( i + vec3( 0.0, 1.0, 1.0 ) ), skinHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ),
      f.y ),
    f.z );
}

float skinFbm( vec3 p ) {
  return 0.55 * skinNoise( p ) + 0.30 * skinNoise( p * 2.1 ) + 0.15 * skinNoise( p * 4.3 );
}

/**
 * Campo continuo del patrón, en ~0..1, con el umbral de relleno en 0.5.
 *
 * Que devuelva un campo continuo y no un booleano es lo que permite sacar
 * dos cosas del mismo cálculo: el relleno (dónde va el acento) y la
 * **costura** (la línea fina donde el campo cruza el umbral). La costura es
 * la que lleva el emisivo en las rarezas altas: un arma oscura con paneles
 * de color y las juntas encendidas se lee como una skin cara. Emitir sobre
 * todo el relleno, en cambio, lava el arma entera hasta dejarla de un solo
 * color plano.
 *
 * p llega normalizado por el bounding box del arma (uSkinExtent), no en
 * metros: una pistola de 20cm y un fusil de 85cm tienen que mostrar la misma
 * cantidad de patrón. Con coordenadas en metros, la pistola salía de un solo
 * color porque el patrón entero le entraba en media repetición.
 *
 * El eje largo del arma es Z: las bandas, el degradado y el flujo corren por
 * ahí, que es como se leen en un arma real.
 */
float skinPatternField( int mode, vec3 p, float scale ) {
  if ( mode == 1 ) {
    return 0.5 + 0.5 * sin( p.z * scale * 3.1415927 );
  }
  if ( mode == 2 ) {
    return skinFbm( p * scale * 1.6 );
  }
  if ( mode == 3 ) {
    vec3 cell = floor( p * scale * 1.4 );
    return skinNoise( cell * 0.41 );
  }
  if ( mode == 4 ) {
    float warp = skinNoise( p * scale * 0.5 ) * 1.8;
    float a = floor( dot( p.xy, vec2( 0.86, 0.51 ) ) * scale + warp );
    float b = floor( dot( p.zy, vec2( 0.64, -0.77 ) ) * scale * 0.8 );
    return skinNoise( vec3( a, b, 0.5 ) * 0.53 );
  }
  if ( mode == 5 ) {
    float veta = skinFbm( p * scale * 0.8 ) * 2.4;
    return 1.0 - smoothstep( 0.0, 0.55, abs( sin( ( p.z * scale + veta ) * 1.5707963 ) ) );
  }
  if ( mode == 6 ) {
    return clamp( p.z * scale * 0.5 + 0.5, 0.0, 1.0 );
  }
  return 0.0;
}

vec3 skinHueShift( vec3 c, float amount ) {
  const vec3 k = vec3( 0.57735027 );
  float ang = amount * 6.2831853;
  float ca = cos( ang );
  return c * ca + cross( k, c ) * sin( ang ) + k * dot( k, c ) * ( 1.0 - ca );
}
`

const FRAGMENT_BODY = /* glsl */ `
#if defined( USE_COLOR_ALPHA )
  vec3 skinBaked = vColor.rgb;
  diffuseColor.a *= vColor.a;
#elif defined( USE_COLOR )
  vec3 skinBaked = vColor.rgb;
#else
  vec3 skinBaked = vec3( 0.55 );
#endif

if ( uSkinEnabled < 0.5 ) {

  diffuseColor.rgb *= skinBaked;

} else {

  float skinLum = dot( skinBaked, vec3( 0.299, 0.587, 0.114 ) );
  float skinMax = max( skinBaked.r, max( skinBaked.g, skinBaked.b ) );
  float skinMin = min( skinBaked.r, min( skinBaked.g, skinBaked.b ) );
  float skinSat = skinMax > 0.0001 ? ( skinMax - skinMin ) / skinMax : 0.0;

  // Posición normalizada por el bounding box: el patrón se ve igual en una
  // pistola que en una LMG.
  vec3 p = vSkinObj / max( uSkinExtent, vec3( 0.001 ) );

  // Región horneada: lo saturado del GLB (maderas, empuñaduras, cachas) se
  // lleva el acento siempre, con patrón o sin él. Es lo que hace que la
  // skin respete la anatomía del arma en vez de taparla.
  float region = smoothstep( 0.18, 0.45, skinSat );

  float campo = skinPatternField( uSkinPattern, p, uSkinPatternScale );
  // El degradado (modo 6) es el único que NO se umbraliza: su gracia es el
  // desvanecido a lo largo del arma, y pasarlo por el mismo smoothstep que
  // al resto lo convierte en un corte de dos tonos, que ya es lo que hace
  // "bandas".
  // campo * campo en el degradado: con la rampa lineal el acento se come
  // el arma entera, porque a mitad de camino ya va mezclado al 50%. Al
  // cuadrado, el color base se sostiene y el acento se concentra donde el
  // desvanecido termina.
  float relleno = uSkinPattern == 0 ? 0.0
    : uSkinPattern == 6 ? campo * campo
    : smoothstep( 0.47, 0.55, campo );
  // Sin costura no hay dónde poner el emisivo, así que el degradado la
  // reemplaza por el propio extremo caliente del desvanecido: la punta
  // encendida en vez de juntas encendidas.
  float costura = uSkinPattern == 0 ? 0.0
    : uSkinPattern == 6 ? campo * campo * 0.55
    : 1.0 - smoothstep( 0.0, 0.045, abs( campo - 0.51 ) );

  float accent = clamp( max( region, relleno ), 0.0, 1.0 );

  vec3 accentColor = uSkinAccent;
  if ( uSkinAnim == 3 ) accentColor = skinHueShift( accentColor, uSkinTime * 0.11 );

  // La luminancia del horneado se reusa como rampa de valor: sin esto todas
  // las piezas del arma quedan del mismo tono plano.
  vec3 color = mix( uSkinBase, accentColor, accent ) * ( 0.62 + 0.9 * skinLum );

  float dark = 1.0 - smoothstep( 0.035, 0.16, skinLum );
  color = mix( color, color * 0.25, dark );

  // Normal geométrica reconstruida por derivadas (los GLB no traen NORMAL).
  vec3 N = normalize( cross( dFdx( vSkinView ), dFdy( vSkinView ) ) );
  vec3 V = normalize( -vSkinView );
  if ( dot( N, V ) < 0.0 ) N = -N;

  // Key arriba y adelante, relleno flojo del lado opuesto para que la
  // silueta no se vaya a negro. Dos direcciones fijas en espacio de vista:
  // no son luces de la escena, es sombreado dentro del mismo shader unlit.
  vec3 L = normalize( vec3( 0.40, 0.75, 0.52 ) );
  float key = max( dot( N, L ), 0.0 );
  float relleno2 = max( dot( N, normalize( vec3( -0.55, -0.25, 0.45 ) ) ), 0.0 );
  float rim = pow( 1.0 - max( dot( N, V ), 0.0 ), 3.5 );

  color *= 0.38 + 0.62 * key + 0.18 * relleno2;

  float spec = pow( max( dot( reflect( -L, N ), V ), 0.0 ), 42.0 );
  color += uSkinMetal * ( spec * 0.85 + rim * 0.14 ) * mix( vec3( 1.0 ), accentColor, 0.3 );

  // Desgaste: rayones finos más erosión de canto, que descubren metal
  // desnudo. El canto se desgasta antes que la cara plana, igual que en un
  // arma real.
  float scratch = skinFbm( p * 26.0 );
  float worn = uSkinWear * smoothstep( 0.48, 0.92, scratch * 0.55 + rim * 0.8 );
  color = mix( color, vec3( 0.34, 0.33, 0.30 ) * ( 0.55 + 0.9 * skinLum ), worn );

  float pulse = 1.0;
  if ( uSkinAnim == 1 ) {
    pulse = 0.60 + 0.40 * sin( uSkinTime * 3.0 );
  } else if ( uSkinAnim == 2 ) {
    pulse = 0.25 + 0.85 * smoothstep( 0.55, 1.0, fract( p.z * 0.5 - uSkinTime * 0.28 ) );
  } else if ( uSkinAnim == 3 ) {
    pulse = 0.72 + 0.28 * sin( uSkinTime * 2.0 );
  }

  // El emisivo va sobre todo en la COSTURA, no sobre el relleno: juntas
  // encendidas sobre un arma oscura. Bañar el relleno entero lo único que
  // logra es un arma de un solo color lavado.
  float glow = uSkinEmissive * ( costura * 1.15 + relleno * 0.14 ) * ( 1.0 - worn * 0.7 );
  color += accentColor * glow * pulse;

  diffuseColor.rgb = color;

}
`

/**
 * Uniforms por material. WeakMap y no una propiedad en el material: el
 * viewmodel cachea una malla por arma (weapons/viewmodel/renderer.ts) y las
 * descarta con dispose(); con WeakMap, el registro se va con ellas sin que
 * nadie tenga que acordarse de limpiarlo.
 */
const REGISTRY = new WeakMap<MeshBasicMaterial, SkinUniforms>()

function createUniforms(): SkinUniforms {
  return {
    uSkinEnabled: { value: 0 },
    uSkinBase: { value: new Color(0, 0, 0) },
    uSkinAccent: { value: new Color(1, 1, 1) },
    uSkinPattern: { value: 0 },
    uSkinPatternScale: { value: 1 },
    uSkinWear: { value: 0 },
    uSkinMetal: { value: 0 },
    uSkinEmissive: { value: 0 },
    uSkinAnim: { value: 0 },
    uSkinTime: { value: 0 },
    uSkinExtent: { value: new Vector3(1, 1, 1) },
  }
}

/**
 * Semiejes del bounding box de la malla. El patrón se evalúa en esta escala
 * y no en metros: sin esto, un patrón calibrado para un fusil de 85cm le
 * entra media repetición a una pistola de 20cm y la deja de un solo color.
 */
function fillExtent(mesh: Mesh, out: Vector3): void {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox
  if (!box) {
    out.set(1, 1, 1)
    return
  }
  out.set(
    Math.max(Math.abs(box.min.x), Math.abs(box.max.x), 0.001),
    Math.max(Math.abs(box.min.y), Math.abs(box.max.y), 0.001),
    Math.max(Math.abs(box.min.z), Math.abs(box.max.z), 0.001),
  )
}

/**
 * Parcha el material una única vez. La segunda llamada devuelve los uniforms
 * ya creados sin volver a marcar `needsUpdate`: recompilar el shader en cada
 * cambio de arma es un tirón visible, y todo el diseño de este archivo
 * existe para no tener que hacerlo.
 */
function patch(material: MeshBasicMaterial): SkinUniforms {
  const existing = REGISTRY.get(material)
  if (existing) return existing

  const uniforms = createUniforms()
  REGISTRY.set(material, uniforms)

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_BODY)
  }
  // Clave de caché de programas: sin esto, three reusaría el programa
  // compilado de cualquier otro MeshBasicMaterial con los mismos parámetros
  // y el arma saldría sin el código de skin inyectado.
  material.customProgramCacheKey = () => 'skin-v1'
  material.needsUpdate = true

  return uniforms
}

/** Handle de una malla ya preparada para llevar skins. */
export interface SkinHandle {
  /**
   * Equipa una skin, o la saca con `null` (vuelve al horneado crudo del
   * GLB). No recompila: sólo escribe uniforms.
   */
  setSkin(skin: Skin | null): void
  /**
   * Avanza el tiempo de las animaciones. Se llama una vez por frame: es una
   * asignación de número sobre un objeto ya existente, cero asignaciones de
   * memoria. La skin en sí se aplica al cambiar de arma, nunca por frame.
   */
  setTime(seconds: number): void
}

function materialOf(mesh: Mesh): MeshBasicMaterial | null {
  const material = mesh.material
  if (Array.isArray(material)) return null
  return material instanceof MeshBasicMaterial ? material : null
}

/**
 * Prepara una malla para llevar skins y devuelve su handle, o null si la
 * malla no tiene un `MeshBasicMaterial` único (nunca debería pasar con el
 * pipeline actual, que produce exactamente eso; si pasara, el arma se sigue
 * viendo con su material crudo en vez de reventar).
 */
export function createSkinHandle(mesh: Mesh): SkinHandle | null {
  const material = materialOf(mesh)
  if (!material) return null

  const uniforms = patch(material)
  fillExtent(mesh, uniforms.uSkinExtent.value)

  return {
    setSkin(skin: Skin | null): void {
      if (!skin) {
        uniforms.uSkinEnabled.value = 0
        return
      }
      uniforms.uSkinEnabled.value = 1
      // setRGB con SRGBColorSpace: las paletas se escriben en hex sRGB
      // (skins/palettes.ts) y el render trabaja en lineal. Sin la
      // conversión, todas las skins salen lavadas.
      uniforms.uSkinBase.value.setRGB(
        skin.colorBase.r,
        skin.colorBase.g,
        skin.colorBase.b,
        SRGBColorSpace,
      )
      uniforms.uSkinAccent.value.setRGB(
        skin.colorAccent.r,
        skin.colorAccent.g,
        skin.colorAccent.b,
        SRGBColorSpace,
      )
      uniforms.uSkinPattern.value = PATTERN_INDEX[skin.pattern]
      uniforms.uSkinPatternScale.value = skin.patternScale
      uniforms.uSkinWear.value = skin.wear
      uniforms.uSkinMetal.value = skin.metalness
      uniforms.uSkinEmissive.value = skin.emissive
      uniforms.uSkinAnim.value = ANIMATION_INDEX[skin.animation]
    },

    setTime(seconds: number): void {
      uniforms.uSkinTime.value = seconds
    },
  }
}
