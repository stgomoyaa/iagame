/**
 * Material de personaje: unlit + tinte de equipo por máscara de vértice.
 *
 * El problema que resuelve. Con cápsulas, distinguir amigo de enemigo era
 * gratis: la cápsula ENTERA era roja o azul. Un modelo humano realista
 * empeora eso, no lo mejora -- si se pinta entero de rojo deja de leerse
 * como persona y volvimos a la cápsula, y si se deja con sus colores de
 * autor (un SWAT negro, un obrero marrón) a 40 m no se distingue de nadie.
 *
 * La solución es una máscara horneada en el canal ALPHA de COLOR_0 por
 * scripts/convert-characters.ts:
 *
 *   alpha = 0  -> piel y ojos: NUNCA se tiñen. La cara sigue siendo humana.
 *   alpha = 1  -> ropa, chaleco, botas, casco: superficie de equipo.
 *
 * El fragment shader reemplaza el color de la ropa por el del equipo
 * MODULADO POR SU PROPIA LUMINANCIA, no por un plano liso: una bota oscura
 * queda rojo oscuro y un chaleco claro rojo brillante. Así el tinte no
 * aplana el modelo -- conserva los pliegues y el sombreado direccional que
 * el pipeline ya horneó en el RGB -- y aun así el 80% de la silueta es el
 * color del equipo, que es lo que se lee de reojo a distancia.
 *
 * Este archivo y bots/renderer.ts son los dos únicos de src/game/bots
 * autorizados a importar three (ver architecture.test.ts): la lógica de
 * bots sigue siendo matemática pura, y esto es sólo el borde contra la
 * escena, mismo criterio que skins/material.ts para las armas.
 */

import { Color, MeshBasicMaterial } from 'three'

/**
 * Colores por equipo. Índice 0 y 1 son los dos equipos de TDM; del 2 en
 * adelante sólo aparecen en FFA, donde cada participante es su propio
 * equipo. Rojo y azul primero porque son el par con mayor separación de
 * matiz que además sobrevive al daltonismo rojo-verde (el azul no se
 * confunde con el rojo en ninguna de las tres formas comunes).
 */
const COLORES_EQUIPO: readonly number[] = [
  0xff2e2e, 0x2e8bff, 0xffd21e, 0x25d366, 0xb44cff, 0xff8c1a, 0x00d0d0, 0xff5fa8,
]

export function teamColor(team: number): Color {
  return new Color(COLORES_EQUIPO[team % COLORES_EQUIPO.length])
}

/**
 * Crea el material de un equipo. Se comparte entre todos los bots de ese
 * equipo: el skinning obliga a una malla (y por lo tanto un draw call) por
 * bot, pero NO a un material por bot -- compartirlo evita recompilar el
 * shader y mantiene el conteo de programas en 2 para una partida de TDM.
 */
export function createCharacterMaterial(team: number): MeshBasicMaterial {
  const color = teamColor(team)
  const material = new MeshBasicMaterial({ vertexColors: true })

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uColorEquipo = { value: color }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uColorEquipo;\nvoid main() {')
      // El chunk original hace `diffuseColor *= vColor`, que con COLOR_0 de
      // cuatro canales multiplicaría también el ALPHA: la piel (máscara 0)
      // saldría transparente. Acá el alpha se usa como máscara y nunca
      // toca la opacidad.
      .replace(
        '#include <color_fragment>',
        `
        #ifdef USE_COLOR_ALPHA
          float lum = dot( vColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
          vec3 equipo = uColorEquipo * ( 0.30 + 0.95 * lum );
          diffuseColor.rgb *= mix( vColor.rgb, equipo, vColor.a );
        #else
          diffuseColor.rgb *= vColor.rgb;
        #endif
        `,
      )
  }
  // Sin esto three reusa el mismo programa compilado para los dos equipos y
  // el segundo material hereda el uniform del primero: los dos bandos
  // saldrían del mismo color.
  material.customProgramCacheKey = () => `personaje-equipo-${team}`

  return material
}
