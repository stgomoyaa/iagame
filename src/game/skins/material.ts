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
import { CAMO_FAMILY_INDEX, ESCALA_FAMILIA } from '@/game/skins/camo-families'
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
  uSkinFamily: { value: number }
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

  // Qué se enciende, y de qué color. Las dos cosas cambian según haya familia
  // o no, así que se resuelven acá y el resto del shader (luz, especular,
  // desgaste, animación) sigue siendo uno solo para los dos caminos.
  vec3 color;
  float mascaraGlow;
  vec3 tintGlow;
  float rampa;

  if ( uSkinFamily > 0 ) {

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
    uSkinFamily: { value: 0 },
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
      .replace('#include <common>', `#include <common>\n${SKIN_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_BODY)
  }
  // Clave de caché de programas: sin esto, three reusaría el programa
  // compilado de cualquier otro MeshBasicMaterial con los mismos parámetros
  // y el arma saldría sin el código de skin inyectado.
  // v2: entraron las seis familias de camuflaje al mismo programa.
  material.customProgramCacheKey = () => 'skin-v2'
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
    },

    setTime(seconds: number): void {
      uniforms.uSkinTime.value = seconds
    },
  }
}
