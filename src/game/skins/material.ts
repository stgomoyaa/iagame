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

import {
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from 'three'

/**
 * Materiales a los que este módulo le sabe inyectar el camuflaje.
 *
 * Son dos y no uno porque las armas conviven en dos formatos: las 39 de
 * Source ya salen del pipeline con textura y se dibujan con
 * `MeshStandardMaterial` (iluminadas), y las 40 CC0 siguen viniendo con color
 * por vértice sobre `MeshBasicMaterial`. Los dos exponen los mismos puntos de
 * inyección (`common`, `begin_vertex`, `color_fragment`), así que el shader de
 * camuflaje es literalmente el mismo para ambos.
 *
 * Esto es una costura sensible: `materialOf` devolvía null para todo lo que no
 * fuera `MeshBasicMaterial`, y como `createSkinHandle` trata el null como
 * "esta malla no lleva camuflaje", cambiar el material del arma apagaba los 79
 * camuflajes EN SILENCIO, sin un error ni un warning. Hay un test que fija
 * justamente eso.
 */
export type SkinnableMaterial = MeshBasicMaterial | MeshStandardMaterial
import { CAMO_FAMILY_INDEX, ESCALA_FAMILIA } from '@/game/skins/camo-families'
import type { Skin } from '@/game/skins/generator'
import { PATTERN_INDEX } from '@/game/skins/patterns'
import type { AnimationId } from '@/game/skins/rarity'
import { type CamoTextura, patronUrl } from '@/game/skins/texturas'

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
  uSkinFamily: { value: number }
  /* --- Vía por textura (skins/texturas.ts). Todo lo de abajo sólo se lee
   *     cuando uSkinTexEnabled = 1; con la vía procedural queda inerte. --- */
  /** 1 = camo por textura activo, 0 = vía procedural (familias o clásico). */
  uSkinTexEnabled: { value: number }
  /** El patrón en escala de grises. `null` mientras no cargó: three liga una
   *  textura 1x1 por defecto, así que el sampler nunca queda sin ligar. */
  uSkinPatternMap: { value: Texture | null }
  /** Color de la emisión de la vía por textura (verde 115, cian, etc.). */
  uSkinGlow: { value: Color }
  /** (rugosidad, metalicidad, barniz) del camo por textura. Reemplaza a
   *  `skinSuperficie` cuando la vía por textura está activa. */
  uSkinSurface: { value: Vector3 }
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vSkinObj;
varying vec3 vSkinView;
`

const VERTEX_BODY = /* glsl */ `
vSkinObj = position;
vSkinView = ( modelViewMatrix * vec4( position, 1.0 ) ).xyz;
`

/**
 * Se exporta —y es lo único del GLSL que se exporta— para poder compilar las
 * familias AISLADAS y medirlas: el banco de pruebas arma un shader de quad con
 * este mismo texto y lee de vuelta la máscara de emisivo con readPixels. Es la
 * única forma de verificar la cobertura emisiva sobre el GLSL de verdad y no
 * sobre una reimplementación en TS que podría divergir del shader sin que
 * nadie se entere. No es API para el juego: nadie más lo importa.
 */
export const SKIN_FRAGMENT_PARS = /* glsl */ `
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
/** 0 = ninguna familia (patrón procedural de siempre), 1..6 = las familias. */
uniform int uSkinFamily;
/** Vía por textura: sampler del heightmap gris y sus parámetros. */
uniform float uSkinTexEnabled;
uniform sampler2D uSkinPatternMap;
uniform vec3 uSkinGlow;
uniform vec3 uSkinSurface;
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

/* ================================================================== *
 * LAS SEIS FAMILIAS DE CAMUFLAJE
 *
 * Portadas de scripts/lib/camo-families.ts, que las generó y validó como
 * funciones puras de (u,v) justamente para que este port fuera posible. Se
 * conservan cero bytes de textura: las teselas PNG máster son la REFERENCIA
 * visual contra la que se comparó el resultado, no un asset que el juego
 * cargue. Acá se evalúa la misma matemática por píxel.
 *
 * Las tres cosas que cambian respecto del original, y por qué:
 *
 * 1. **Se tira la teselabilidad.** Todo el aparato de ruido periódico
 *    (fbmP/ridgedP con envoltura modular) existía para que un PNG de 512px
 *    cerrara consigo mismo en los cuatro bordes. Sobre el arma no hay tesela:
 *    se evalúa un campo continuo en espacio de objeto, así que no hay borde
 *    que cerrar. Sacar la periodicidad es la mayor economía del port —el
 *    ruido periódico cuesta bastante más que el común— y no se pierde nada.
 *
 * 2. **Ruido 3D donde la familia es de ruido, proyección 2D sólo donde la
 *    familia es una retícula.** multicam, damasco y cebra salen de campos de
 *    ruido, así que se evalúan directamente en 3D sobre la posición de
 *    objeto: no hay proyección, no hay estiramiento y no hay costura por
 *    ningún lado del arma. filigrana, gema y follaje necesitan una grilla
 *    (celosía, retícula de piedras, celdas de hojas), que es 2D por
 *    definición, y usan el plano ZY —el eje largo del arma por el lateral,
 *    que es la cara grande y la que se mira. Es la advertencia que dejó la
 *    tarea previa: lo que se ve bien en un cuadrado plano puede envolverse
 *    mal, y la verificación es sobre el arma.
 *
 * 3. **Los bucles por elemento se vuelven forma cerrada.** El follaje del
 *    original recorría hasta nueve folíolos por hoja para dibujar la silueta.
 *    Una hoja palmada es radialmente periódica, así que el mismo perfil sale
 *    del ángulo en O(1) (ver skinHoja). Es la diferencia entre decenas de
 *    iteraciones por píxel y ninguna.
 *
 * Sobre el costo: el "switch" de abajo es sobre un UNIFORM, así que todos los
 * fragmentos de una misma llamada de dibujo toman la misma rama. La GPU no
 * paga las seis familias por píxel, paga la que le tocó al arma. Por eso seis
 * familias en un solo programa no cuestan seis veces una.
 * ================================================================== */

/** fbm de 2 octavas: la mitad del costo del de 3, y alcanza para los campos
 *  que sólo aportan deformación, donde el detalle fino no llega a verse. */
float skinFbm2( vec3 p ) {
  return 0.65 * skinNoise( p ) + 0.35 * skinNoise( p * 2.3 );
}

/** Crestas en vez de manchas. Es la base de las volutas de la filigrana. */
float skinRidged( vec3 p ) {
  float a = 1.0 - abs( skinNoise( p ) * 2.0 - 1.0 );
  float b = 1.0 - abs( skinNoise( p * 2.2 + 19.0 ) * 2.0 - 1.0 );
  return a * 0.65 + b * 0.35;
}

/** Vector de deformación de dominio. Tres muestras decorreladas por offset. */
vec3 skinWarp( vec3 p, float k ) {
  return ( vec3(
    skinNoise( p + 11.3 ),
    skinNoise( p + 41.7 ),
    skinNoise( p + 73.1 ) ) - 0.5 ) * k;
}

/** HSV -> RGB. Sólo lo usa la cebra, que ES un barrido de tono. */
vec3 skinHsv( float h, float s, float v ) {
  vec3 k = fract( vec3( h ) + vec3( 1.0, 0.6666667, 0.3333333 ) );
  vec3 c = abs( k * 6.0 - 3.0 );
  return v * mix( vec3( 1.0 ), clamp( c - 1.0, 0.0, 1.0 ), s );
}

/** Hash de celda 2D -> [0,1). Para las retículas (gema, follaje). */
float skinCell( vec2 c, float salt ) {
  return fract( sin( dot( c, vec2( 127.1, 311.7 ) ) + salt * 57.33 ) * 43758.5453 );
}

/**
 * Perfil de una hoja palmada, como rosa polar. Devuelve:
 *   .x = distancia con signo al borde (>0 adentro)
 *   .y = cercanía al eje del folíolo (1 en el nervio, 0 entre folíolos)
 *   .z = avance radial normalizado (0 en el peciolo, 1 en la punta)
 *
 * El EXPONENTE del lóbulo es lo que decide si esto se lee como hoja o como
 * mancha, y va MAYOR que 1. Con exponente menor que 1 (el primer intento, en
 * 0.45) el perfil se aplana cerca del máximo: los folíolos salen anchos, las
 * hendiduras angostas, y la hoja queda casi redonda —sobre el arma se veía
 * como musgo, sin ninguna silueta reconocible—. Con exponente mayor que 1 el
 * pico se afina y el valle se ensancha, que es la proporción real de una hoja
 * palmada: folíolos finos separados por hendiduras profundas.
 */
vec3 skinHoja( vec2 d, float radio, float folios, float giro ) {
  float r = length( d );
  if ( r > radio ) return vec3( -1.0, 0.0, 0.0 );
  float th = atan( d.y, d.x ) + giro;
  float lob = abs( cos( th * folios * 0.5 ) );
  // 1.5 y no 2.2: con el exponente muy alto los folíolos quedan filiformes,
  // la hoja pierde carne y el fondo oscuro se come el patrón. La referencia
  // tiene hojas llenas que tapan ~90% y dejan respirar el fondo en los
  // huecos, no una telaraña.
  float borde = radio * ( 0.22 + 0.78 * pow( lob, 1.5 ) );
  return vec3( borde - r, lob, r / max( borde, 0.0001 ) );
}

/**
 * Color de la familia "fam" en el punto "p", y por "emis" la máscara de
 * emisivo.
 *
 * La máscara es la parte que NO se puede improvisar. De épico para arriba el
 * brillo sube, y tiene que ir en el oro, en las facetas, en las líneas
 * magenta o en el color de la cebra — **nunca en el fondo ni en la franja
 * negra**, que son las que dan legibilidad. Un emisivo que baña el fondo
 * lava el arma entera y le borra la silueta. Por eso cada familia devuelve su
 * máscara desde la misma función que su color, y no desde una textura ni
 * desde el relleno del patrón.
 */
vec3 skinFamilyColor( int fam, vec3 p, float scale, vec3 base, vec3 accent, float tiempo, out float emis ) {
  emis = 0.0;

  /* ---------------- 1. MULTICAM: manchas orgánicas en cuatro tonos -------- */
  if ( fam == 1 ) {
    vec3 q = p * scale * 0.55;
    // Un solo warp compartido por las tres capas. El original usaba uno por
    // capa (seis fbm) para que los bordes no salieran paralelos; acá cada
    // capa muestrea el warp a distinta frecuencia y offset, que ya rompe el
    // paralelismo, y ahorra cuatro fbm por píxel. Importa: multicam vive en
    // raro, que es el 27% de los drops, o sea camino común.
    vec3 w = skinWarp( q * 0.6, 2.0 );
    float f1 = skinFbm( ( q + w ) * 1.00 + 11.0 );
    float f2 = skinFbm( ( q + w ) * 0.86 + 37.0 );
    float f3 = skinFbm( ( q + w ) * 1.13 + 71.0 );

    // Los cuatro tonos salen de la paleta de la skin y no de la del máster:
    // multicam es la familia genérica del sistema y es la que más se repite,
    // así que tiene que llevar el color que le tocó a cada arma.
    vec3 claro = mix( base, vec3( 1.0 ), 0.62 );
    vec3 gris = base;
    vec3 calido = accent;
    vec3 negro = base * 0.20;

    // Capas que se TAPAN, no un campo posterizado en cuatro niveles: el
    // camuflaje impreso se hace así, y por eso las manchas se cruzan en vez
    // de anidarse como curvas de nivel. Umbral casi duro; la transición es
    // sólo antialias.
    vec3 c = claro;
    c = mix( c, gris, smoothstep( 0.452, 0.478, f1 ) );
    c = mix( c, calido, smoothstep( 0.512, 0.538, f2 ) );
    c = mix( c, negro, smoothstep( 0.532, 0.558, f3 ) );
    return c;
  }

  /* ---------------- 2. FOLLAJE: hojas palmadas sobre fondo oscuro -------- */
  if ( fam == 2 ) {
    vec2 uv = vec2( p.z, p.y ) * scale * 0.42;

    vec3 fondoA = mix( base, vec3( 0.18, 0.14, 0.25 ), 0.55 );
    vec3 c = mix( fondoA, fondoA * 0.42, skinFbm( p * scale * 0.5 ) );

    // Vecindario 3x3: con hojas de radio mayor que la celda —que es lo que
    // hace que el follaje se vea denso y superpuesto en vez de punteado— una
    // hoja de celda diagonal sí alcanza al píxel. El descarte por radio de
    // skinHoja hace que las celdas lejanas cuesten sólo un length().
    vec2 gi = floor( uv );
    float mejorZ = -1.0;
    float halo = 0.0;

    for ( int j = -1; j <= 1; j++ ) {
      for ( int i = -1; i <= 1; i++ ) {
        vec2 cel = gi + vec2( float( i ), float( j ) );
        float h1 = skinCell( cel, 1.0 );
        float h2 = skinCell( cel, 2.0 );
        float h3 = skinCell( cel, 3.0 );
        float h4 = skinCell( cel, 4.0 );

        vec2 centro = cel + vec2( 0.12 + 0.76 * h1, 0.12 + 0.76 * h2 );
        // Radio mayor que la celda: las hojas TIENEN que solaparse, y es el
        // solape lo que da la densidad del follaje. Con radio menor que la
        // celda quedan hojas sueltas sobre fondo, que parece papel picado.
        float radio = 0.80 + 0.55 * h3;
        float folios = 5.0 + floor( h4 * 4.0 );
        vec3 hoja = skinHoja( uv - centro, radio, folios, h1 * 6.2831853 );

        if ( hoja.x <= 0.0 ) {
          // Contorno oscuro alrededor de la hoja: es lo que separa hojas
          // superpuestas del mismo verde. Sin esto el follaje se funde en una
          // masa verde ilegible, que es el modo de falla que la tarea previa
          // ya había encontrado.
          halo = max( halo, smoothstep( -0.085, 0.0, hoja.x ) );
          continue;
        }
        // Profundidad por celda: decide qué hoja tapa a cuál. Sin un orden
        // estable, las hojas parpadean al moverse el arma.
        if ( h3 <= mejorZ ) continue;
        mejorZ = h3;

        // Tono angosto (hoja verde, no hoja de cualquier color) pero valor
        // ancho: la profundidad del follaje se lee por diferencia de
        // luminosidad, no de color.
        vec3 verde = skinHsv( 0.245 + h4 * 0.055, 0.55 + h1 * 0.32, 0.30 + h2 * 0.48 );
        verde = mix( verde, accent, 0.30 );

        // Nervadura central clara, borde del folíolo oscuro, punta más clara
        // que la base: da volumen sin normal map.
        float haciaBorde = 1.0 - hoja.y;
        float k = 1.0 - 0.42 * haciaBorde * haciaBorde + 0.14 * hoja.z;
        k += smoothstep( 0.84, 1.0, hoja.y ) * 0.16;
        k += 0.07 * sin( hoja.z * 26.0 + haciaBorde * 9.0 );
        c = verde * clamp( k * 1.05, 0.0, 1.4 );
      }
    }

    c *= 1.0 - halo * 0.52;
    return c;
  }

  /* ---------------- 3. FILIGRANA: ornamento dorado ---------------------- */
  if ( fam == 3 ) {
    vec2 uv = vec2( p.z, p.y ) * scale * 0.5;

    // Celosía a 45 grados. La rotación es de escala uniforme, así que las
    // distancias en (a,b) siguen siendo proporcionales a las reales y una
    // circunferencia en (a,b) sale redonda, no ovalada.
    vec2 ab = vec2( uv.x + uv.y, uv.x - uv.y );
    vec2 s = fract( ab + 0.5 ) - 0.5;
    float rad = length( s );
    float th = atan( s.y, s.x );

    // El fondo se tiñe con la base de la skin pero OSCURECIDA, no con la base
    // tal cual: la filigrana es oro sobre metal oscuro y ése contraste es
    // todo el efecto. Con la base sin oscurecer, una skin de base clara
    // dejaba el ornamento dorado sobre gris claro, o sea invisible.
    vec3 fondo = mix( vec3( 0.20, 0.19, 0.18 ), vec3( 0.075, 0.072, 0.068 ), skinFbm( p * scale * 0.7 ) );
    fondo = mix( fondo, base * 0.30, 0.35 );
    float oro = 0.0;

    // Volutas de relleno: CURVA DE NIVEL del ruido ridged (distancia a un
    // valor), no franja entre dos umbrales. Con la franja el ruido pasa mucho
    // tiempo dentro del rango y el oro inunda la superficie hasta quedar una
    // masa mostaza; la distancia a un valor único da un filamento de ancho
    // controlado, que es lo que es una voluta.
    float vol = skinRidged( p * scale * 1.6 );
    oro = max( oro, smoothstep( 0.036, 0.012, abs( vol - 0.72 ) ) * 0.85 );

    // Los dos haces de diagonales de la celosía.
    oro = max( oro, smoothstep( 0.055, 0.030, abs( s.x ) ) * 0.95 );
    oro = max( oro, smoothstep( 0.055, 0.030, abs( s.y ) ) * 0.95 );

    // Roseta en cada cruce de la celosía.
    if ( rad < 0.34 ) {
      oro = max( oro, smoothstep( 0.022, 0.008, abs( rad - 0.26 ) ) );
      float petalo = 0.15 + 0.065 * cos( th * 8.0 );
      oro = max( oro, smoothstep( 0.026, 0.010, abs( rad - petalo ) ) );
      oro = max( oro, smoothstep( 0.055, 0.040, rad ) );
    }

    // Motivo chico en el centro del rombo.
    vec2 m = fract( ab ) - 0.5;
    float mrad = length( m );
    if ( mrad < 0.18 ) {
      float flor = 0.075 + 0.045 * cos( atan( m.y, m.x ) * 4.0 );
      oro = max( oro, smoothstep( 0.022, 0.009, abs( mrad - flor ) ) );
    }

    oro = clamp( oro, 0.0, 1.0 );
    vec3 c = fondo;
    if ( oro > 0.02 ) {
      // Pan de oro gastado: el oro puro plano se ve a plástico dorado; el
      // desgaste por ruido es lo que lo lleva a "dorado a la hoja".
      float desgaste = skinFbm( p * scale * 3.2 );
      vec3 tono = mix( vec3( 0.82, 0.60, 0.20 ), vec3( 0.98, 0.86, 0.50 ), clamp( desgaste * 1.5 - 0.2, 0.0, 1.0 ) );
      tono = mix( tono, vec3( 0.46, 0.32, 0.09 ), smoothstep( 0.62, 0.85, desgaste ) * 0.8 );
      // Poco acento: el oro tiene que seguir siendo oro. Con 0.25 una skin de
      // acento frío lo empujaba a gris verdoso y dejaba de leerse como metal
      // precioso, que es lo único que justifica la familia en épico.
      tono = mix( tono, accent, 0.12 );
      c = mix( fondo, tono, oro );
    }
    // El brillo va en el ORO y en nada más: el fondo oscuro es lo que hace
    // legible el ornamento.
    emis = oro;
    return c;
  }

  /* ---------------- 4. GEMA: retícula de octógonos facetados ------------ */
  if ( fam == 4 ) {
    vec2 uv = vec2( p.z, p.y ) * scale * 0.5;

    float fy = uv.y;
    float gy = floor( fy );
    // Filas alternas desfasadas media celda: es lo que rompe la grilla
    // cuadrada y hace que se lea como pavé de piedras.
    float desfase = mod( gy, 2.0 ) < 1.0 ? 0.0 : 0.5;
    float fx = uv.x - desfase;
    float gx = floor( fx );

    vec2 pc = vec2( fx - gx, fy - gy ) * 2.0 - 1.0;
    float ax = abs( pc.x );
    float ay = abs( pc.y );
    // SDF de octógono: el max de las cuatro familias de semiplanos.
    float oct = max( max( ax, ay ), ( ax + ay ) * 0.7071 );
    float radio = 0.97;

    // Fondo violeta muy oscuro, teñido con la base oscurecida por el mismo
    // motivo que en filigrana: la piedra tiene que destacar contra el hueco.
    vec3 fondo = mix( vec3( 0.13, 0.04, 0.20 ), vec3( 0.055, 0.015, 0.095 ), skinFbm( p * scale * 1.2 ) );
    fondo = mix( fondo, base * 0.28, 0.35 );
    if ( oct >= radio ) return fondo;

    vec2 cel = vec2( gx, gy );
    float rr = length( pc ) / radio;
    float thn = atan( pc.y, pc.x ) * 0.1591549;
    float giro = skinCell( cel, 2.0 );

    // Talla real, no porciones de torta: un brillante tiene mesa plana en el
    // centro y DOS coronas de facetas hacia el canto. Con un solo abanico
    // radial la piedra se ve como una rueda de quesos.
    //
    // Los dos jitters de abajo no son decoración. Sin ondular el límite entre
    // coronas y sin correr las aristas con el radio, las coronas son
    // circunferencias perfectas y las aristas radios perfectos: la piedra
    // sale como un TABLERO DE DARDOS. Una gema tallada no tiene ninguna
    // arista que cierre un círculo exacto, y esa irregularidad es la que hace
    // leer "cristal" en vez de "pieza torneada".
    // Amplitud generosa y muchos sectores angulares: con jitter chico los
    // límites entre coronas siguen siendo circunferencias reconocibles y la
    // piedra se lee como tablero de dardos. Lo que hace leer "cristal" es que
    // ninguna arista cierre un círculo exacto.
    float ondaAng = ( skinCell( cel, floor( fract( thn + giro ) * 17.0 ) + 7.0 ) - 0.5 ) * 0.28;
    float rj = rr + ondaAng;
    float corona = rj < 0.42 ? 0.0 : ( rj < 0.74 ? 1.0 : 2.0 );
    // Las coronas de afuera llevan más caras, como en una talla real.
    float sectores = ( corona < 0.5 ? 6.0 : ( corona < 1.5 ? 9.0 : 13.0 ) )
      + floor( skinCell( cel, corona + 40.0 ) * 3.0 );
    float corrimiento = ( skinCell( cel, corona * 53.0 + 9.0 ) - 0.5 ) * 0.5;
    float sct = fract( thn + giro + corona * 0.37 + corrimiento * rr ) * sectores;
    float si = floor( sct );
    float sf = sct - si;

    // Rango de brillo ANCHO. Con un rango angosto las caras salen todas
    // parecidas, el ojo no distingue la talla y la gema se lee como un
    // círculo claro. Una piedra tallada tiene caras casi negras al lado de
    // caras que destellan, y ese contraste ES el efecto.
    float k = 0.46 + skinCell( cel, si * 17.0 + corona * 131.0 ) * 0.62;
    // La mesa central siempre es la cara más clara: devuelve la luz de frente.
    if ( corona < 0.5 ) k = 0.86 + skinCell( cel, si * 17.0 ) * 0.26;

    // Aristas: la grieta entre caras y el escalón entre coronas.
    float arista = min( sf, 1.0 - sf );
    k *= 1.0 - smoothstep( 0.045, 0.0, arista ) * 0.5;
    k *= 1.0 - smoothstep( 0.035, 0.0, abs( rj - 0.42 ) ) * 0.45;
    k *= 1.0 - smoothstep( 0.035, 0.0, abs( rj - 0.74 ) ) * 0.45;
    // Bisel del canto medido sobre la distancia al OCTÓGONO y no sobre el
    // radio: con el radio el oscurecimiento es un viñeteo circular y la
    // piedra se lee como perla esférica, justo donde la silueta octogonal
    // tendría que definirse.
    k *= 1.0 - smoothstep( 0.82, 1.0, oct / radio ) * 0.38;

    // Poco acento, por lo mismo que el oro de filigrana: con 0.35 la piedra
    // se iba a gris y el resultado se leía como roca agrietada, no como
    // cristal tallado.
    vec3 lila = skinHsv( 0.76 + ( skinCell( cel, 3.0 ) - 0.5 ) * 0.06, 0.40, 1.0 );
    lila = mix( lila, accent, 0.18 );
    vec3 c = lila * clamp( k, 0.0, 1.2 );
    // Antialias del canto contra el fondo.
    float bordeSuave = smoothstep( radio, radio - 0.03, oct );
    c = mix( fondo, c, bordeSuave );

    // El brillo va en las FACETAS, y sólo en las que destellan: la curva
    // deja fuera las caras oscuras de la talla y todo el fondo. Si emitiera
    // parejo por toda la piedra, se perdería la talla, que es lo único que
    // distingue una gema de un lunar.
    // Umbral calibrado contra la cobertura del máster (0.227): con 0.52 medía
    // 0.284 y encendía facetas de media luz que en la referencia están
    // apagadas, lo que le quitaba contraste a la talla.
    emis = smoothstep( 0.62, 1.08, k ) * bordeSuave;
    return c;
  }

  /* ---------------- 5. DAMASCO: vetas metálicas marmoladas -------------- */
  if ( fam == 5 ) {
    vec3 q = p * scale * 0.5;

    // Warp de DOS pasos (warp del warp). Con uno solo salen ondas suaves; el
    // segundo paso es el que dobla el campo sobre sí mismo y genera los ojos
    // y remolinos que son la firma del damasco.
    vec3 w1 = skinWarp( q, 1.5 );
    vec3 w2 = skinWarp( ( q + w1 ) * 1.5 + 5.0, 1.0 );
    // Campo SUAVE con MUCHAS bandas. Los dos extremos fallan por razones
    // distintas: con campo rugoso el detalle fino pica las curvas de nivel y
    // queda moteado; con pocas bandas quedan islas enormes con contorno, como
    // un mapa. El damasco son curvas de nivel MUY juntas de un terreno MUY
    // liso: la densidad la ponen las bandas y el remolino lo pone el warp.
    float campo = skinFbm2( q + w1 + w2 );
    float c14 = fract( campo * 14.0 );

    vec3 linea = vec3( 0.88, 0.25, 0.60 );
    vec3 relleno = vec3( 0.91, 0.33, 0.16 );
    vec3 campoA = vec3( 0.07, 0.45, 0.41 );
    vec3 campoB = vec3( 0.25, 0.82, 0.54 );
    vec3 campoC = vec3( 0.10, 0.25, 0.56 );

    vec3 c;
    // El ancho de la línea está calibrado contra la cobertura emisiva del
    // máster (0.1173): con 0.050/0.075 medía 0.065, la mitad de lo que pide
    // la referencia, y el contorno magenta casi no se leía sobre el arma.
    float enLinea = 1.0 - smoothstep( 0.090, 0.125, c14 );
    if ( c14 < 0.125 ) {
      // El cálido va SIEMPRE pegado a la línea, nunca suelto: en la
      // referencia el relleno naranja es el interior del contorno.
      c = mix( relleno, linea, smoothstep( 0.125, 0.055, c14 ) * 0.3 );
      c = mix( c, linea, enLinea );
    } else {
      // El campo teal ocupa el ~85% restante. La proporción importa: con la
      // línea y el relleno cubriendo un tercio, el resultado se ve
      // psicodélico en vez de metálico.
      float kk = smoothstep( 0.125, 1.0, c14 );
      c = mix( mix( campoA, campoB, kk ), campoC, smoothstep( 0.55, 0.95, campo ) * 0.5 );
    }
    c = mix( c, accent, 0.20 );

    // Grano pulido direccional: el damasco es metal cepillado, y sin esta
    // veta fina se ve como plástico impreso.
    c *= 1.0 + ( skinNoise( vec3( q.z * 42.0, q.y * 6.0, q.x * 6.0 ) ) - 0.5 ) * 0.18;

    // El brillo va SÓLO en la línea magenta: es el 12% de cobertura de la
    // máscara máster. El campo teal es el 85% de la superficie y encenderlo
    // convertiría el arma en una linterna verde.
    emis = enLinea;
    return c;
  }

  /* ---------------- 6. CEBRA ARCOÍRIS ----------------------------------- */
  if ( fam == 6 ) {
    vec3 q = p * scale;

    // Fase deformada por ruido: es lo que curva las franjas en galones en vez
    // de dejarlas rectas.
    // Amplitud moderada: con warp fuerte (2.8) las franjas se quiebran en
    // galones angulosos y la cebra se lee como cristal roto en vez de como
    // una franja que ondula.
    float w = ( skinFbm2( q * 0.30 ) - 0.5 ) * 1.6 + ( skinNoise( q * 0.85 ) - 0.5 ) * 0.5;
    float fase = ( p.z * scale * 0.85 + p.y * scale * 0.22 ) * 3.1415927 + w * 3.1415927;
    float onda = sin( fase );

    // Umbral VARIABLE. Con un corte fijo todas las franjas tienen el mismo
    // ancho; modulándolo con otro ruido se afinan, se ensanchan y a veces se
    // cortan, que es lo que hace una cebra de verdad.
    float corte = 0.06 + ( skinFbm2( q * 0.5 + 17.0 ) - 0.5 ) * 0.95;
    float negra = smoothstep( corte - 0.12, corte + 0.08, onda );

    // El arcoíris barre a lo largo del arma, y el tiempo lo hace ciclar. Es
    // la única familia donde ciclar el tono ejecuta la idea del patrón en vez
    // de romperle la paleta: por eso es la única con "espectro".
    float tono = p.z * 0.55 + tiempo * 0.06;
    vec3 vivo = skinHsv( tono, 0.78, 0.85 );
    vec3 negro = vec3( 0.045, 0.038, 0.036 );

    // El brillo va en el COLOR, nunca en la franja negra: la franja negra es
    // exactamente lo que hace legible el patrón, y encenderla lo borraría.
    emis = 1.0 - negra;
    return mix( vivo, negro, negra );
  }

  return base;
}

/**
 * Respuesta de superficie por familia: qué tan pulida, qué tan metálica y
 * cuánto barniz tiene cada camuflaje.
 *
 * POR QUÉ ESTO EXISTE. Hasta acá el brillo del arma salía de UN solo número
 * (uSkinMetal) con un exponente especular fijo de 42 para todo. Con eso el
 * oro de la filigrana, la resina de la gema y la tela del multicam
 * reflejaban exactamente igual, y ése es el motivo real de que los camos se
 * leyeran como calcomanías: lo que distingue un oro de una tela en una foto
 * NO es el dibujo, es el tamaño y la dureza del reflejo. Un multicam de
 * dotación tiene un reflejo ancho y apagado; el oro tiene uno chico y
 * durísimo; la gema tiene dos (el del barniz y el del interior).
 *
 * Devuelve (rugosidad, metalicidad, barniz), los tres en 0..1:
 *
 * - rugosidad decide el TAMAÑO del brillo. 0 = espejo (brillo chico y
 *   duro), 1 = mate (brillo ancho y difuso).
 * - metalicidad decide de qué COLOR es el brillo. Un metal tiñe su reflejo
 *   con su propio color (el oro refleja dorado); un dieléctrico lo refleja
 *   blanco. Es la diferencia entre "arma dorada" y "arma blanca con pintura
 *   amarilla".
 * - barniz es una segunda capa pulida ENCIMA del dibujo, siempre blanca.
 *   Es la que produce la profundidad tipo resina de las referencias: el
 *   patrón se ve por debajo y el reflejo corre por arriba sin teñirse.
 *
 * Los valores no son un catálogo de materiales reales: son lo que hace que
 * cada familia se lea como lo que quiere ser cuando el arma gira.
 */
vec4 skinSuperficie( int fam, float metalSkin ) {
  // Multicam y follaje son camuflaje de tela: mate, nada de metal y apenas
  // un velo de barniz. Si brillaran dejarían de leerse como ropa de
  // dotación, que es justo lo que camo-families.ts declara que son.
  if ( fam == 1 || fam == 2 ) return vec4( 0.88, 0.02, 0.06, 0.10 );
  // Filigrana es oro sobre negro: el reflejo tiene que ser chico, duro y
  // DORADO, no blanco. Metalicidad casi 1 es lo que lo consigue.
  if ( fam == 3 ) return vec4( 0.26, 0.92, 0.30, 0.85 );
  // Gema: poco metal y barniz al máximo. Las dos capas separadas son lo que
  // da la lectura de piedra tallada dentro de resina — el interior mate y
  // coloreado, la cáscara pulida y blanca.
  if ( fam == 4 ) return vec4( 0.16, 0.28, 1.00, 1.35 );
  // Damasco es acero: metal casi puro, algo más rugoso que el oro porque el
  // acero damasquinado tiene grano y no espeja como una joya.
  if ( fam == 5 ) return vec4( 0.34, 0.95, 0.22, 1.00 );
  // Cebra arcoíris: laca de color. Ni metal ni tela, con barniz alto para
  // que el barrido de tono se vea a través de una capa brillante.
  if ( fam == 6 ) return vec4( 0.22, 0.45, 0.75, 0.55 );
  // Clásico: sigue gobernado por el metalness de la skin, que es lo que ese
  // camino venía usando. Se mapea a rugosidad de forma inversa para que una
  // skin de metalness alto siga saliendo más pulida que una común gastada.
  return vec4( clamp( 0.92 - 0.62 * metalSkin, 0.10, 0.95 ), metalSkin, 0.10 + 0.35 * metalSkin, 0.45 );
}

/**
 * Fresnel de Schlick. Todo material refleja MUCHO más en los ángulos
 * rasantes: es la razón física por la que en las referencias el brillo
 * blanco corre justo por el canto del riel y del cañón y no por el centro de
 * la cara plana. Sin este término el arma se ve como plástico pintado por
 * más brillo especular que se le agregue.
 */
vec3 skinFresnel( vec3 f0, float cosTheta ) {
  return f0 + ( vec3( 1.0 ) - f0 ) * pow( clamp( 1.0 - cosTheta, 0.0, 1.0 ), 5.0 );
}

/**
 * RELIEVE: perturba la normal usando el propio dibujo del camuflaje como
 * mapa de altura.
 *
 * POR QUÉ ES LA PIEZA QUE FALTABA. El costado de un fusil es esencialmente
 * UN SOLO PLANO: una única normal geométrica para toda la cara. Y como el
 * reflejo, el especular y el fresnel son todos función de la normal, sobre
 * esa cara valen todos lo MISMO en cada píxel. Por eso subir el brillo no
 * arreglaba nada: se puede iluminar un plano cuanto se quiera, va a seguir
 * siendo un plano de color liso. Medido: después de dos rondas de ajustar
 * constantes, el damasco seguía con MENOS variación de luz que antes de
 * empezar (desviación 22.3 contra 24.8).
 *
 * Las armas de las referencias no son planas: el patrón tiene relieve, y por
 * eso el brillo lo RECORRE en vez de bañarlo. Acá el relieve sale gratis del
 * dibujo que ya se calculó — donde el camuflaje es claro la superficie sube,
 * donde es oscuro baja—, así que las celdas de la gema se leen como piedras
 * talladas y las líneas del damasco como grano de acero, sin un byte de
 * normal map y sin tocar la geometría.
 *
 * Es el gradiente de altura en espacio de pantalla llevado a espacio de
 * vista (el mismo método que usa three en perturbNormalArb): con las
 * derivadas de la posición se arma la base del plano y se proyecta el
 * gradiente de la altura sobre ella.
 */
vec3 skinRelieve( vec3 N, float altura, float escala ) {
  vec3 dpx = dFdx( vSkinView );
  vec3 dpy = dFdy( vSkinView );
  float dhx = dFdx( altura );
  float dhy = dFdy( altura );
  vec3 r1 = cross( dpy, N );
  vec3 r2 = cross( N, dpx );
  float det = dot( dpx, r1 );
  // det ~ 0 en triángulos degenerados o de canto: sin este corte la normal
  // sale NaN y el píxel se dibuja negro.
  if ( abs( det ) < 1e-12 ) return N;
  vec3 grad = ( r1 * dhx + r2 * dhy ) / det;
  return normalize( N - escala * grad );
}

/**
 * Entorno de estudio, procedural y baratísimo: cielo arriba, horizonte
 * cálido, piso oscuro. Cero bytes de textura y ningún cubemap que cargar.
 *
 * Se evalúa en ESPACIO DE VISTA, igual que la luz key que ya existía. Eso
 * significa que el "rig" de iluminación viaja pegado a la cámara en vez de
 * estar fijo al mundo, que es exactamente como se ilumina un viewmodel en
 * cualquier shooter: el arma tiene que verse bien en la mano siempre, no
 * apagarse porque el jugador miró al norte. La alternativa (pasar la
 * orientación del mundo como uniform) haría que el arma se apague sola en
 * media escena, que no es lo que muestran las referencias.
 */
vec3 skinEntorno( vec3 R ) {
  float h = R.y * 0.5 + 0.5;
  vec3 piso = vec3( 0.05, 0.05, 0.06 );
  vec3 horizonte = vec3( 0.34, 0.31, 0.29 );
  vec3 cielo = vec3( 0.52, 0.60, 0.78 );
  return h < 0.5
    ? mix( piso, horizonte, smoothstep( 0.0, 0.5, h ) )
    : mix( horizonte, cielo, smoothstep( 0.5, 1.0, h ) );
}

/**
 * Muestreo TRIPLANAR del heightmap gris en espacio de objeto.
 *
 * POR QUÉ TRIPLANAR Y NO UNA PROYECCIÓN PLANA. Las familias que necesitan
 * grilla (filigrana, gema) proyectan sobre el plano ZY y aceptan que la cara
 * de arriba se estire: es un mal menor porque su dibujo es una retícula que el
 * estiramiento no delata tanto. Un patrón de textura arbitrario SÍ se delata
 * —una veta estirada al triple se ve rota—, y encima la costura de la
 * proyección plana caería justo cruzando el arma, que es exactamente la línea
 * que la verificación de teselado existe para evitar. El triplanar muestrea en
 * los tres planos y mezcla por la normal, así ninguna cara se estira y no hay
 * costura de proyección. Cuesta tres samples; se paga una sola vez por arma
 * (un solo viewmodel) y la rama de textura es excluyente con la de familias,
 * así que un arma con camo por textura no paga además el switch de las seis.
 *
 * nObj es la normal en espacio de OBJETO, reconstruida por derivadas igual
 * que la de vista (los GLB no traen NORMAL): es la que decide el peso de cada
 * plano, y tiene que ser la de objeto y no la de vista porque los planos de
 * proyección son del objeto.
 *
 * desliz desplaza las coordenadas a lo largo del eje largo (Z): es lo que
 * hace FLUIR el patrón cuando la animación es flujo. Un remolino que se
 * desplaza mientras la luz real no se mueve es justo lo que una imagen fija no
 * puede dar, y la mitad del motivo de toda esta vía.
 */
float skinPatronTriplanar( vec3 p, float scale, float desliz ) {
  vec3 c = p * scale + vec3( 0.0, 0.0, desliz );
  vec3 nObj = abs( normalize( cross( dFdx( vSkinObj ), dFdy( vSkinObj ) ) ) );
  // Peso muy contrastado (^4) para que las caras oblicuas no promedien tres
  // muestras distintas y emborronen el patrón; normalizado para conservar
  // energía.
  vec3 w = nObj * nObj;
  w *= w;
  w /= max( w.x + w.y + w.z, 0.0001 );
  float gx = texture2D( uSkinPatternMap, c.yz ).r;
  float gy = texture2D( uSkinPatternMap, c.zx ).r;
  float gz = texture2D( uSkinPatternMap, c.xy ).r;
  return gx * w.x + gy * w.y + gz * w.z;
}
`

const FRAGMENT_BODY = /* glsl */ `
// "skinBaked" es el color PROPIO del arma: el que tiene sin camuflaje. De él
// salen la luminancia y la saturación que más abajo deciden qué parte del arma
// se lleva el acento, y por eso hay que sacarlo de la mejor fuente disponible.
//
// Las armas de Source ahora traen TEXTURA (pipeline convert-source-viewmodels),
// y las 40 CC0 siguen trayendo color por vértice: los dos caminos tienen que
// funcionar, así que se eligen por define en vez de asumir uno.
#if defined( USE_MAP )
  // Con textura no hay nada que muestrear acá: <map_fragment> ya corrió —va
  // ANTES de <color_fragment> tanto en el shader basic como en el standard— y
  // dejó el albedo en diffuseColor. Leerlo de ahí sale gratis y además da la
  // anatomía POR PÍXEL en vez de por vértice, que es bastante más fino que lo
  // que jamás dio el horneado.
  vec3 skinBaked = diffuseColor.rgb;
#elif defined( USE_COLOR_ALPHA )
  vec3 skinBaked = vColor.rgb;
  diffuseColor.a *= vColor.a;
#elif defined( USE_COLOR )
  vec3 skinBaked = vColor.rgb;
#else
  vec3 skinBaked = vec3( 0.55 );
#endif

if ( uSkinEnabled < 0.5 ) {

#if defined( USE_MAP )
  // El albedo de la textura YA está en diffuseColor. Multiplicarlo por
  // skinBaked —que acá es él mismo— lo elevaría al cuadrado y dejaría el arma
  // notablemente más oscura sin camuflaje que con él.
#else
  diffuseColor.rgb *= skinBaked;
#endif

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

  vec3 accentColor = uSkinAccent;
  if ( uSkinAnim == 3 ) accentColor = skinHueShift( accentColor, uSkinTime * 0.11 );

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

  // Qué se enciende, y de qué color. Las dos cosas cambian según la vía, así
  // que se resuelven acá y el resto del shader (luz, especular, desgaste,
  // animación) sigue siendo uno solo para los tres caminos.
  vec3 color;
  float mascaraGlow;
  vec3 tintGlow;
  float rampa;
  // Altura del relieve. La vía por textura la toma del heightmap gris directo
  // (ver su rama); las otras dos la derivan del color más abajo. -1 marca "sin
  // fijar todavía".
  float texAltura = -1.0;

  if ( uSkinTexEnabled > 0.5 ) {

    // VÍA POR TEXTURA. El heightmap gris llega por triplanar; el color, la
    // emisión y la respuesta de superficie los pone el motor desde los
    // uniforms del catálogo (skins/texturas.ts). Es la división que hace que
    // un mismo patrón con otra paleta y otra animación sea otro camo.
    //
    // Con flujo, el patrón SE DESPLAZA a lo largo del arma: es el remolino que
    // fluye de Afterlife, y lo que una imagen fija no puede dar.
    float desliz = uSkinAnim == 2 ? uSkinTime * 0.12 : 0.0;
    float g = skinPatronTriplanar( p, uSkinPatternScale, desliz );
    texAltura = g;

    // El glow puede ciclar el tono igual que el acento (espectro): así una
    // nebulosa barre todo el arcoíris en vez de encender siempre el mismo
    // rosa.
    vec3 glowColor = uSkinGlow;
    if ( uSkinAnim == 3 ) glowColor = skinHueShift( glowColor, uSkinTime * 0.11 );

    // Paleta de dos paradas más la punta tirando al color de emisión: el valle
    // del heightmap es la base, la cresta el acento, y los picos más altos
    // arrastran hacia el glow AUNQUE emissive sea 0. Eso da color caro en las
    // crestas incluso a un camo mate, y hace que el mismo patrón se lea
    // distinto sólo cambiando la paleta.
    color = mix( uSkinBase, accentColor, smoothstep( 0.10, 0.72, g ) );
    color = mix( color, glowColor, smoothstep( 0.78, 1.0, g ) * 0.5 );

    // La emisión vive en las CRESTAS del patrón —las vetas de Element 115, no
    // el fondo—: un glow que baña el valle lava el arma, el mismo principio
    // que en las familias. El umbral alto deja fuera el fondo y los medios.
    mascaraGlow = smoothstep( 0.62, 0.95, g );
    tintGlow = glowColor;
    // Rampa suave: el patrón trae su propia estructura de valor, el horneado
    // sólo diferencia las piezas del arma sin imponerle su luminancia.
    rampa = 0.85 + 0.30 * skinLum;

  } else if ( uSkinFamily > 0 ) {

    // Rama de familia. La familia cubre la superficie con su propio dibujo,
    // así que NO se aplica "region" (el acento sobre lo saturado del
    // horneado): taparía el camuflaje con manchas que no son suyas. Lo que sí
    // se conserva es la rampa de luminancia del horneado y el clamp de las
    // zonas oscuras, unas líneas más abajo, que es lo que mantiene legible la
    // silueta del arma y la distinción entre sus piezas.
    float emis = 0.0;
    vec3 fam = skinFamilyColor(
      uSkinFamily, p, uSkinPatternScale, uSkinBase, accentColor, uSkinTime, emis );
    color = fam;
    mascaraGlow = emis;
    // Rampa de luminancia ATENUADA para las familias. La del patrón clásico
    // (0.62 + 0.9*lum) llega a multiplicar por 1.5 en las piezas claras del
    // horneado, y eso le borra el fondo oscuro a filigrana y a gema, que es
    // justo lo que hace legible el ornamento y la talla: en la primera pasada
    // las dos salieron gris claro lavado en vez de oro-sobre-negro y
    // lila-sobre-violeta. Las familias traen su propia estructura de valor y
    // no necesitan que el horneado se la imponga; lo que sí se conserva es
    // que las piezas del arma se sigan diferenciando entre sí.
    rampa = 0.80 + 0.42 * skinLum;
    // El glow se tiñe con el color de la familia EN ESE PÍXEL, no con el
    // acento de la skin: así el oro brilla dorado, la línea del damasco
    // brilla magenta y la cebra brilla del color de su franja. Usar el acento
    // pintaría todos los brillos del mismo color y borraría justo la
    // diferencia que hace cara a cada familia.
    tintGlow = fam;

  } else {

    color = mix( uSkinBase, accentColor, accent );
    mascaraGlow = costura * 1.15 + relleno * 0.14;
    tintGlow = accentColor;
    rampa = 0.62 + 0.9 * skinLum;

  }

  // La luminancia del horneado se reusa como rampa de valor: sin esto todas
  // las piezas del arma quedan del mismo tono plano.
  color *= rampa;

  float dark = 1.0 - smoothstep( 0.035, 0.16, skinLum );
  color = mix( color, color * 0.25, dark );

  // Normal geométrica reconstruida por derivadas (los GLB no traen NORMAL).
  vec3 N = normalize( cross( dFdx( vSkinView ), dFdy( vSkinView ) ) );
  vec3 V = normalize( -vSkinView );
  if ( dot( N, V ) < 0.0 ) N = -N;

  // Parámetros de superficie. La vía por textura los toma tal cual del
  // catálogo (uSkinSurface); las procedurales, de skinSuperficie. El cuarto
  // componente es la fuerza del relieve: 1.2 en la textura porque el heightmap
  // gris tiene relieve REAL —no derivado del color, medido del propio dibujo—,
  // así que aguanta y agradece más relieve que las familias. uSkinMetal sigue
  // mandando en el camino clásico y modula a las familias: dos skins de la
  // misma familia con metalness distinto no salen idénticas.
  vec4 sup = uSkinTexEnabled > 0.5
    ? vec4( uSkinSurface, 1.2 )
    : skinSuperficie( uSkinFamily, uSkinMetal );
  float rugosidad = sup.x;
  float metalico = sup.y;
  float barniz = sup.z;

  // La altura del relieve es la luminancia del propio camuflaje: lo claro
  // del dibujo sobresale y lo oscuro se hunde.
  //
  // Va ACÁ, antes de la luz, y no después: si se perturbara la normal
  // después de calcular el key, el relieve no entraría en el difuso y sólo
  // se vería en el especular. El grueso de la sensación de talla viene del
  // difuso —es el que dibuja el lado iluminado y el lado en sombra de cada
  // celda—, así que perturbar tarde deja el efecto a medias.
  // En la vía por textura la altura es el gris muestreado tal cual: el patrón
  // ES un heightmap, así que su relieve es de verdad y no una lectura del
  // color ya coloreado. En las otras dos se deriva de la luminancia del
  // camuflaje calculado, que es lo único disponible.
  float altura = texAltura >= 0.0 ? texAltura : dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  // El 0.55 está medido, no elegido a ojo: con 0.90 el relieve se ve MÁS
  // marcado pero el detalle fino medido no sube (gradiente local 20.3 contra
  // 20.7) y la saturación baja, porque a esa escala el gradiente da vuelta la
  // normal en los bordes del dibujo y el sombreado empieza a cancelarse solo.
  N = skinRelieve( N, altura, sup.w * 0.55 );

  // Key arriba y adelante, relleno flojo del lado opuesto para que la
  // silueta no se vaya a negro. Dos direcciones fijas en espacio de vista:
  // no son luces de la escena, es sombreado dentro del mismo shader unlit.
  vec3 L = normalize( vec3( 0.40, 0.75, 0.52 ) );
  float key = max( dot( N, L ), 0.0 );
  float relleno2 = max( dot( N, normalize( vec3( -0.55, -0.25, 0.45 ) ) ), 0.0 );

  float NdotV = max( dot( N, V ), 0.0 );
  float NdotL = key;
  // Exposición de canto. No es un término de luz: la usa el desgaste, más
  // abajo, porque el canto de un arma se pela antes que la cara plana.
  float rim = pow( 1.0 - NdotV, 3.5 );

  /**
   * COMPUERTA DE LO OSCURO, y por qué sin ella todo lo de abajo empeora el
   * arma en vez de mejorarla.
   *
   * Todo reflejo es luz que se SUMA, y sumar luz blanca desatura: al medir
   * la primera versión con reflejos, la saturación del damasco y de la gema
   * cayó un 36% y la fracción de píxeles oscuros bajó de 0.34 a 0.26. O sea:
   * el arma brillaba más y se leía peor, que es exactamente contra lo que
   * advierte la cabecera de camo-families.ts —el fondo oscuro (el campo del
   * damasco, el negro de la filigrana, el borde entre gemas) es lo que hace
   * legible el dibujo y la silueta, y encenderlo lava el arma—.
   *
   * dark ya marca las zonas que el horneado quiere oscuras (miras, interior
   * del cañón) y unas líneas más arriba se las multiplica por 0.25. Sin esta
   * compuerta, los reflejos de abajo se las devolvían a encender.
   */
  float noOscuro = 1.0 - dark;

  // El difuso baja donde el material es metálico (un metal casi no tiene
  // difuso: lo que se ve de él es reflejo), pero SÓLO hasta cierto punto.
  //
  // El primer intento aplicaba la extinción física completa (difuso * 0.35)
  // y el resultado, mirado, fue un arma MÁS OSCURA y más plana que antes: el
  // dibujo del camuflaje se apagaba y el reflejo que tenía que reemplazarlo
  // no alcanzaba a compensarlo. Acá el objetivo no es un render físico, es
  // que el camuflaje se lea Y brille, que es lo que muestran las
  // referencias: en ellas el patrón sigue siendo vívido y los reflejos van
  // ENCIMA, no en lugar de él.
  float difuso = 0.38 + 0.62 * NdotL + 0.18 * relleno2;
  // El 0.88 y no 0.78: multiplicar el difuso comprime también su RANGO, y
  // con 0.78 el metal perdía parte del modelado que traía el difuso justo
  // donde el reflejo todavía no lo compensa.
  color *= mix( difuso, difuso * 0.88 + 0.10, metalico );

  // Reflejo especular direccional. El exponente sale de la rugosidad con el
  // mapeo de Blinn-Phong (exp = 2/a^2 - 2, con a = rugosidad^2): es la
  // conversión estándar entre "qué tan áspera es la superficie" y "qué tan
  // concentrado es el brillo", y es lo que hace que la tela del multicam y
  // el oro de la filigrana ya no compartan el mismo destello.
  vec3 H = normalize( L + V );
  // PISO DE RUGOSIDAD, y por qué no es cosmético. La malla no tiene normales
  // propias: la normal se reconstruye por derivadas y sale FACETADA, una por
  // triángulo. Sobre facetas, un lóbulo muy cerrado (rugosidad 0.16 da
  // exponente ~600) no se ve nunca: o la faceta está alineada con el reflejo
  // y se enciende entera, o no lo está y no pasa nada. Se probó sin piso y el
  // arma quedó igual de muerta que antes con el brillo "más físico".
  // Con 0.30 el lóbulo cubre varias facetas y el brillo CORRE por el cañón al
  // girar, que es el efecto de las referencias.
  float a = max( max( rugosidad, 0.30 ), 0.002 );
  a = a * a;
  float expo = 2.0 / ( a * a ) - 2.0;
  float NdotH = max( dot( N, H ), 0.0 );
  // La normalización 1/(a^2) mantiene la ENERGÍA constante al cerrar el
  // lóbulo: sin ella, bajar la rugosidad achica el brillo hasta hacerlo
  // desaparecer en vez de concentrarlo, que fue el primer intento y dejaba
  // la gema más apagada que el multicam.
  float lobulo = pow( NdotH, expo ) / ( 3.14159 * a * a );
  lobulo = min( lobulo, 24.0 );

  // El color del reflejo: blanco en un dieléctrico, teñido con el propio
  // color de la superficie en un metal. Ésta es la línea que separa "arma
  // dorada" de "arma blanca con pintura amarilla".
  //
  // El aclarado hacia blanco no es un error de física, es deliberado: en un
  // metal F0 = albedo, y acá el albedo es el camuflaje, que suele ser
  // OSCURO (el campo teal del damasco, el negro de la filigrana). Con F0
  // literal, un damasco oscuro reflejaba oscuro y el "acero" se veía como
  // plástico sucio. Subir el piso conserva el TINTE del metal —que es lo que
  // distingue el oro del acero— sin heredar lo oscuro del dibujo.
  // El 0.18 salió de mirar: con 0.40 el reflejo salía casi blanco y, sumado
  // sobre toda la superficie, LAVABA el camuflaje —el damasco perdía el
  // campo teal y quedaba gris pálido—. Las referencias hacen lo contrario:
  // el morado sigue morado y saturado, y el brillo va encima. Un piso bajo
  // levanta lo justo para que un dibujo oscuro refleje, sin blanquearlo.
  vec3 f0 = mix( vec3( 0.04 ), mix( max( color, vec3( 0.04 ) ), vec3( 1.0 ), 0.18 ), metalico );
  vec3 F = skinFresnel( f0, max( dot( H, V ), 0.0 ) );
  color += F * lobulo * NdotL * 1.15 * noOscuro;

  // Reflejo del entorno, y ACÁ ESTÁ EL GRUESO DEL EFECTO.
  //
  // En una malla facetada el reflejo del entorno es mejor señal que el
  // lóbulo direccional: cada faceta mira a un lado distinto y por lo tanto
  // toma un color distinto del entorno, así que la pieza se llena sola de
  // variación y las caras planas —donde el brillo direccional no llega
  // nunca— dejan de ser manchas de color plano. Es lo que hace que un arma
  // low-poly se lea como metal pulido en vez de como plástico pintado.
  vec3 R = reflect( -V, N );
  vec3 env = skinEntorno( R );
  vec3 Fenv = skinFresnel( f0, NdotV );

  // El reflejo se TIÑE con el tono de la superficie antes de sumarse. El
  // color se normaliza a máximo 1 para quedarse con el TONO y tirar el
  // brillo: así un damasco teal oscuro refleja teal brillante en vez de
  // blanco. Sumar blanco era lo que desaturaba —un reflejo blanco sobre un
  // campo teal da gris—, y es la diferencia entre el arma lavada de la
  // segunda versión y el morado saturado de las referencias.
  // El teñido llega hasta 0.70, NUNCA hasta 1. Con teñido total (el intento
  // anterior, 0.98 para un metal) el reflejo sale exactamente del mismo tono
  // que lo que hay debajo, así que sube el brillo sin crear CONTRASTE: medido,
  // el damasco quedó con menos variación de luz que antes de tocar nada
  // (desviación 20.6 contra 24.8 del original) aunque se viera más saturado.
  // Dejar algo de blanco es lo que hace que el reflejo se despegue del fondo.
  float pico = max( max( color.r, color.g ), max( color.b, 0.001 ) );
  vec3 tono = color / pico;
  vec3 envTenido = env * mix( vec3( 1.0 ), tono, 0.35 + 0.35 * metalico );

  color += envTenido * Fenv * mix( 0.95, 0.22, rugosidad ) * ( 0.55 + 0.45 * metalico ) * noOscuro;

  // Barniz: segunda capa pulida y SIEMPRE BLANCA encima del dibujo. El
  // patrón queda por debajo y el reflejo corre por arriba sin teñirse, que
  // es exactamente la profundidad tipo resina de las referencias de camos
  // mastery. Su fresnel es el que enciende el canto del riel y del cañón.
  // El exponente 60 —y no 220, que fue el primer intento— por el mismo
  // motivo que el piso de rugosidad: sobre facetas un lóbulo de 220 se
  // enciende en una cara y desaparece en la de al lado, y no llega a leerse
  // como una capa continua de barniz.
  // El barniz SÍ suma blanco —es una capa transparente encima, no tiene
  // color propio—, pero concentrado: el lóbulo sólo donde la faceta apunta a
  // la luz, y el fresnel sólo en el canto. Es el brillo que corre por el
  // riel y el cañón en las referencias, y por ser selectivo no lava el
  // campo entero como lo hacía cuando se sumaba parejo.
  float fresnelBarniz = pow( 1.0 - NdotV, 3.0 );
  float loboBarniz = pow( NdotH, 60.0 );
  color += barniz * noOscuro * ( loboBarniz * 1.25 * NdotL + fresnelBarniz * 0.30
    + env.b * fresnelBarniz * 0.45 );

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
  float glow = uSkinEmissive * mascaraGlow * ( 1.0 - worn * 0.7 );
  color += tintGlow * glow * pulse;

  diffuseColor.rgb = color;

}
`

/**
 * Uniforms por material. WeakMap y no una propiedad en el material: el
 * viewmodel cachea una malla por arma (weapons/viewmodel/renderer.ts) y las
 * descarta con dispose(); con WeakMap, el registro se va con ellas sin que
 * nadie tenga que acordarse de limpiarlo.
 */
const REGISTRY = new WeakMap<SkinnableMaterial, SkinUniforms>()

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
    uSkinFamily: { value: 0 },
    uSkinTexEnabled: { value: 0 },
    uSkinPatternMap: { value: null },
    uSkinGlow: { value: new Color(1, 1, 1) },
    uSkinSurface: { value: new Vector3(0.5, 0.3, 0.3) },
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
function patch(material: SkinnableMaterial): SkinUniforms {
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
      .replace('#include <common>', `#include <common>\n${SKIN_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_BODY)
  }
  // Clave de caché de programas: sin esto, three reusaría el programa
  // compilado de cualquier otro material con los mismos parámetros
  // y el arma saldría sin el código de skin inyectado.
  // v2: entraron las seis familias de camuflaje al mismo programa.
  // v3: el arma de Source pasó a MeshStandardMaterial con textura y el código
  // inyectado cambió con ella (ahora lee el albedo del mapa).
  // v4: entró la vía por textura (sampler2D uSkinPatternMap y su rama), que
  // cambia el código inyectado. Sin bumpear la clave, un material parchado con
  // v3 reusaría su programa viejo y la rama de textura no existiría en él.
  //
  // No hace falta meter el TIPO de material en la clave aunque el mismo código
  // se compile contra dos shaders base distintos: three ya antepone el
  // `shaderID` —'meshbasic' vs 'meshphysical'— al armar la clave de programa
  // (WebGLPrograms.getProgramCacheKey), así que un basic y un standard nunca
  // comparten programa por más que compartan esta cadena.
  material.customProgramCacheKey = () => 'skin-v4'
  material.needsUpdate = true

  return uniforms
}

/** Handle de una malla ya preparada para llevar skins. */
export interface SkinHandle {
  /**
   * Equipa una skin procedural, o la saca con `null` (vuelve al horneado
   * crudo del GLB). No recompila: sólo escribe uniforms. Apaga la vía por
   * textura si estaba activa.
   */
  setSkin(skin: Skin | null): void
  /**
   * Equipa un camuflaje por textura (skins/texturas.ts). `mapa` es el
   * heightmap gris ya cargado (ver `cargarPatron`); con `null` en cualquiera
   * de los dos, vuelve al horneado crudo. Escribe uniforms, no recompila.
   *
   * La textura se pasa aparte del camo a propósito: el catálogo es data pura
   * (no importa three) y la carga es asíncrona y cacheada, así que quien
   * equipa decide CUÁNDO se bajó el patrón. Es lo que mantiene la carga bajo
   * demanda.
   */
  setCamoTextura(camo: CamoTextura | null, mapa: Texture | null): void
  /**
   * Avanza el tiempo de las animaciones. Se llama una vez por frame: es una
   * asignación de número sobre un objeto ya existente, cero asignaciones de
   * memoria. La skin en sí se aplica al cambiar de arma, nunca por frame.
   */
  setTime(seconds: number): void
}

function esSkinnable(material: unknown): material is SkinnableMaterial {
  return material instanceof MeshBasicMaterial || material instanceof MeshStandardMaterial
}

/**
 * TODOS los materiales parchables de una malla, no uno.
 *
 * Devolvía un material suelto y `null` ante un array, y eso dejaba sin
 * camuflaje a las armas de COD con varias primitivas: `isolateParts` las
 * fusiona en una malla con array de materiales (cuerpo, hierros,
 * guardamanos...), así que caían justo en la rama que devolvía `null` y se
 * quedaban con su textura cruda para siempre. No fallaba: simplemente la skin
 * no aparecía.
 *
 * Se filtra lo no parchable en vez de rechazar la malla entera: si una
 * primitiva trajera un material raro, el resto del arma igual lleva camuflaje.
 */
function materialsOf(mesh: Mesh): SkinnableMaterial[] {
  const material = mesh.material
  if (Array.isArray(material)) return material.filter(esSkinnable)
  return esSkinnable(material) ? [material] : []
}

/**
 * Prepara una malla para llevar skins y devuelve su handle, o null si no tiene
 * ningún material inyectable (el arma se sigue viendo con su material crudo en
 * vez de reventar).
 *
 * Parcha TODOS los materiales de la malla, no el primero: un arma de COD
 * fusionada trae uno por pieza y hay que escribirles los uniforms a todos, o
 * el camuflaje entraría sólo en el cuerpo y los hierros quedarían del color de
 * fábrica — que es peor que no tener camuflaje, porque se ve como un error de
 * render y no como una decisión.
 *
 * `uSkinExtent` se calcula UNA vez sobre la malla ya fusionada y se copia al
 * uniform de cada material: es el tamaño del arma ENTERA, y es lo que hace que
 * el patrón tenga la misma escala en todas sus piezas. Calculado por pieza,
 * los hierros saldrían con el camuflaje ampliado como si fueran un arma
 * completa del tamaño de un dedo.
 */
export function createSkinHandle(mesh: Mesh): SkinHandle | null {
  const materiales = materialsOf(mesh)
  if (materiales.length === 0) return null

  const todos = materiales.map((m) => patch(m))
  const extent = new Vector3()
  fillExtent(mesh, extent)
  for (const u of todos) u.uSkinExtent.value.copy(extent)

  return {
    setSkin(skin: Skin | null): void {
      for (const uniforms of todos) {
        // Las dos vías son excluyentes: equipar una skin procedural apaga la
        // de textura. Sin esto, un arma que tuvo un camo por textura y después
        // recibe una skin procedural seguiría muestreando el patrón viejo.
        uniforms.uSkinTexEnabled.value = 0
        if (!skin) {
          uniforms.uSkinEnabled.value = 0
          continue
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
        uniforms.uSkinFamily.value = CAMO_FAMILY_INDEX[skin.family]
        // La escala de la familia se premultiplica acá y no en el shader: una
        // familia puede caer sobre patrones anfitriones con rangos de escala muy
        // distintos (hidrografico va de 2.5 a 6, degradado de 0.8 a 1.6), y sin
        // corregir saldría con cuatro veces más repeticiones en un anfitrión que
        // en otro. Como familia y patrón clásico son excluyentes por skin, el
        // mismo uniform sirve para los dos sin ambigüedad.
        uniforms.uSkinPatternScale.value = skin.patternScale * ESCALA_FAMILIA[skin.family]
        uniforms.uSkinWear.value = skin.wear
        uniforms.uSkinMetal.value = skin.metalness
        uniforms.uSkinEmissive.value = skin.emissive
        uniforms.uSkinAnim.value = ANIMATION_INDEX[skin.animation]
      }
    },

    setCamoTextura(camo: CamoTextura | null, mapa: Texture | null): void {
      for (const uniforms of todos) {
        // Hace falta el camo Y su textura: un camo sin patrón cargado dibujaría
        // sobre la textura 1x1 por defecto de three, que se ve como un color
        // plano. Mejor caer al horneado crudo hasta que el patrón esté.
        if (!camo || !mapa) {
          uniforms.uSkinTexEnabled.value = 0
          uniforms.uSkinEnabled.value = 0
          continue
        }
        uniforms.uSkinEnabled.value = 1
        uniforms.uSkinTexEnabled.value = 1
        uniforms.uSkinPatternMap.value = mapa
        // Hex sRGB a lineal, igual que las paletas procedurales.
        uniforms.uSkinBase.value.set(camo.base).convertSRGBToLinear()
        uniforms.uSkinAccent.value.set(camo.accent).convertSRGBToLinear()
        uniforms.uSkinGlow.value.set(camo.glow).convertSRGBToLinear()
        uniforms.uSkinSurface.value.set(camo.rugosidad, camo.metal, camo.barniz)
        uniforms.uSkinPatternScale.value = camo.escala
        uniforms.uSkinEmissive.value = camo.emissive
        uniforms.uSkinMetal.value = camo.metal
        uniforms.uSkinAnim.value = ANIMATION_INDEX[camo.animation]
        // El desgaste no aplica a la vía por textura: un mastery camo no se
        // pela. Se pone en cero para que un arma que venía con una skin
        // procedural gastada no arrastre su wear al camo nuevo.
        uniforms.uSkinWear.value = 0
      }
    },

    // Se llama una vez por frame. El bucle recorre un array ya existente y
    // escribe un número en cada uno: cero asignaciones, igual que antes. En
    // el 80% del arsenal el array tiene un solo elemento.
    setTime(seconds: number): void {
      for (const uniforms of todos) uniforms.uSkinTime.value = seconds
    },
  }
}

/**
 * Carga un patrón de camuflaje en gris bajo demanda, cacheado por URL.
 *
 * ES EL PUNTO QUE MANTIENE LA CARGA BAJO DEMANDA. El catálogo (texturas.ts) no
 * baja nada al importarse; esta función baja el PNG recién cuando alguien va a
 * mostrar el camo, y la promesa se cachea, así que dos armas con el mismo
 * patrón lo descargan una sola vez. Entrar al juego no gasta un byte de
 * textura de camo.
 *
 * La textura se configura como corresponde para un HEIGHTMAP, no para un color:
 *
 * - `RepeatWrapping`: el patrón tesela (por eso existe la verificación de
 *   scripts/verificar-teselado.ts), y el triplanar lo repite sobre el arma.
 * - `NoColorSpace`: el gris es un DATO de altura, no un color. Con la decodi-
 *   ficación sRGB por defecto, el 0.5 del archivo llegaría al shader como
 *   ~0.21 y el patrón saldría aplastado hacia lo oscuro. Sin conversión, el
 *   byte/255 es exactamente la altura que se quiso.
 * - Mipmaps con filtrado trilineal: sin ellos, el patrón repetido muchas veces
 *   a lo largo del cañón chisporrotea (aliasing) al girar el arma.
 */
const CACHE_PATRONES = new Map<string, Promise<Texture>>()

export function cargarPatron(camo: CamoTextura): Promise<Texture> {
  const url = patronUrl(camo)
  const cacheada = CACHE_PATRONES.get(url)
  if (cacheada) return cacheada

  const promesa = new Promise<Texture>((resolve, reject) => {
    new TextureLoader().load(
      url,
      (tex) => {
        tex.wrapS = RepeatWrapping
        tex.wrapT = RepeatWrapping
        tex.colorSpace = NoColorSpace
        tex.magFilter = LinearFilter
        tex.minFilter = LinearMipmapLinearFilter
        tex.generateMipmaps = true
        tex.needsUpdate = true
        resolve(tex)
      },
      undefined,
      () => reject(new Error(`no se pudo cargar el patrón de camo "${url}"`)),
    )
  })
  CACHE_PATRONES.set(url, promesa)
  return promesa
}
