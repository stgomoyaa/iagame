# Cómo generar patrones de camuflaje para el motor

Esta hoja es autosuficiente. Con esto generás patrones en otra instancia (Higgsfield u otro generador de imágenes) y el motor los convierte en camuflajes. No necesitás leer código.

## La idea en una línea

El generador de imágenes aporta **solo el patrón, en escala de grises**. El motor le pone el color, el brillo, el metal, la animación y la respuesta a la luz. Vos generás un dibujo en blanco y negro; el arma lo muestra teñido, con relieve, reflejando y animándose.

### Por qué la imagen NO trae color ni brillo

Un mastery camo (Element 115, Afterlife, Dark Matter) es hermoso por cosas que **no pueden venir pintadas en una imagen fija**:

- Element 115: las vetas verdes **emiten luz**. Eso lo pone el motor, no el dibujo.
- Afterlife: el remolino **fluye** y cicla el tono. Movimiento, no imagen fija.
- Dark Matter: el patrón base es simple; la magia es el **reflejo que corre** cuando el arma gira.

Si generás la imagen con el brillo y el reflejo ya pintados, en el motor se ve como una calcomanía: el brillo pintado se queda quieto mientras la luz real se mueve, y encima pelea contra el reflejo del material. Por eso la imagen tiene que ser **plana, en gris, sin luz**. El gris es un mapa de altura: lo claro sube (y es lo que el motor enciende y colorea de acento), lo oscuro es el fondo (que se queda oscuro para que la silueta del arma siga siendo legible).

## La especificación (esto es lo que el motor acepta de verdad)

| Campo | Valor |
|---|---|
| **Resolución** | **1024 × 1024** (recomendado). 512 × 512 también sirve y pesa la cuarta parte, pero a 1024 el patrón se ve más fino sobre el arma. Cuadrada siempre. |
| **Formato** | **PNG**, 8 bits. Idealmente escala de grises de 1 canal; RGB con los tres canales iguales también se acepta. |
| **Color** | **Ninguno.** Blanco y negro puro. El verificador rechaza cualquier tinte (croma > 6). |
| **Teselable** | **Obligatorio.** El patrón se repite sobre el arma: si no cierra sin costura, aparece una línea recta cruzando el arma. Los generadores de imágenes NO producen esto de forma confiable, así que **hay que medirlo** (ver más abajo). |
| **Contraste** | Rango tonal completo, de casi negro a casi blanco. Un gris parejo no da dibujo. |

### Qué DEBE contener la imagen

- El patrón, plano, iluminado de forma **uniforme** (como un escaneo o una fotocopia), sin ninguna dirección de luz.
- Lo **claro** = donde querés que el arma emita luz y lleve el color de acento (las vetas, las grietas, las facetas, las crestas).
- Lo **oscuro** = el fondo, que se queda apagado y sostiene la legibilidad.
- Bordes que **cierran con el lado opuesto** (seamless / tileable en los cuatro lados).

### Qué NO debe contener (esto arruina el resultado)

- **Color.** Nada de tintes, ni siquiera sutiles.
- **Luz pintada:** brillos, reflejos especulares, highlights, sombras proyectadas, oclusión. El motor pone toda la luz.
- **Sensación de metal, oro, cristal o resina ya pintada.** Eso lo decide el motor por camo.
- **Degradados que implican una fuente de luz** (un lado claro y el otro oscuro como si le pegara el sol).
- **Viñeteo, marcos, bordes.** Rompen el teselado y meten costura.
- **Texto, marcas de agua, firmas.**
- **El arma.** Es solo el patrón, como una tela infinita.

### Frase para pegar al final de cualquier prompt

Sumá esto siempre, en inglés (los generadores obedecen mejor en inglés):

```
seamless tileable texture, grayscale heightmap, flat even lighting, no color,
no shadows, no highlights, no metallic sheen, no vignette, no border, no text,
top-down orthographic, repeating pattern
```

## Verificá ANTES de integrar (paso que se salta y cuesta caro)

Una tesela con costura se ve **perfecta** mirando el cuadrado suelto; la costura solo aparece al repetirla sobre el arma. Por eso no confíes en el ojo: medí. Desde la raíz del repo:

```
node scripts/verificar-teselado.ts mis-patrones/*.png
```

Devuelve un número por archivo (la razón de costura) y un veredicto. Regla:

- **razón ≤ 1.8** → tesela, sirve.
- **razón > 1.8** → tiene costura, **descartá la imagen y volvé a generarla** (o pedile al generador "seamless" con más énfasis, o probá otra semilla).
- **croma > 6** → el generador metió color aunque le pediste gris; descartala.
- **desviación < 12** → el patrón tiene poco contraste, va a salir plano sobre el arma.

El verificador es honesto: se puede probar con `--control <archivo>` pasándole a propósito uno que sabés que NO tesela, y tiene que marcarlo como fallado. Si el control pasa, la medición está rota.

Si querés patrones de arranque para probar el flujo sin generar nada, `node scripts/patrones-camo-prueba.ts` produce tres (vetas, celdas, nube) que teselan por construcción.

## Cuánto pesan (por qué esto no rompe el "cero bytes")

Los camuflajes procedurales del juego pesan **cero bytes** (son matemática en el shader). Las texturas rompen eso, así que:

- Un patrón gris comprimido pesa **~40 a 105 KB a 512 px**, **~85 a 290 KB a 1024 px** (medido sobre los tres de prueba; un patrón orgánico denso tira al techo del rango).
- **Se cargan bajo demanda:** entrar al juego descarga **0 bytes** de camo. Un patrón se baja recién cuando alguien equipa o previsualiza ese camo, y queda cacheado.
- **Un mismo patrón sirve para varios camos** (otra paleta, otra animación = otro camo). El peso del catálogo es el de los patrones ÚNICOS, no el de los camos.

Catálogo de 50 camos, estimado:

| | 512 px | 1024 px |
|---|---|---|
| 50 patrones únicos (peor caso) | ~3.6 MB | ~9.5 MB |
| reúso 2× (≈25 patrones únicos) | ~1.8 MB | ~4.8 MB |
| **al entrar al juego** | **0 MB** | **0 MB** |
| **al equipar un camo** | ~73 KB | ~195 KB |

Comparado con bajar el camo terminado (RGBA con la luz horneada, 1–3 MB cada uno), el gris es 4 a 10 veces más liviano **y** deja que el motor lo re-ilumine. Esa es toda la ventaja de la división.

## Los prompts (listos para pegar)

Doce patrones distintos. Cada uno es el prompt en inglés más una nota de para qué sirve. **Pegá siempre la frase de cierre de arriba al final.** Generá, verificá el teselado, y recién ahí integralo.

### Orgánicos (vetas, nubes, humo)

**1. Vetas de energía (tipo Element 115 / Afterlife)**
```
organic branching veins network, thin glowing filaments over dark background,
electric energy tendrils, high contrast white veins on black, marbled flow
```
Nota: las vetas blancas se encienden con el color de emisión. Fondo negro = arma oscura con vetas de luz.

**2. Nebulosa / gas estelar**
```
cosmic nebula gas clouds, soft billowing smoke, wispy cloud formations,
high dynamic range value, bright cores fading to dark voids
```
Nota: con la animación de espectro, el motor barre el tono y se lee como gas que cambia de color.

**3. Humo / niebla táctica**
```
dense rolling smoke, soft fog banks, subtle tonal variation, muted midtones,
low frequency organic noise
```
Nota: patrón suave y apagado, para un camo mate de dotación. El piso contra el que se miden los caros.

**4. Lava agrietada**
```
cracked molten lava surface, glowing cracks between dark cooled rock plates,
bright fissures forming a network, hardened basalt texture
```
Nota: las grietas claras emiten; las placas oscuras son el fondo.

### Geométricos (duros, con bordes rectos)

**5. Panal hexagonal**
```
hexagonal honeycomb grid, tessellated hexagon cells with hard edges,
raised cell centers and recessed borders, mechanical precision
```
Nota: bordes rectos. Es el patrón que delata si la proyección estira, así que un panal limpio confirma que el motor lo envuelve bien.

**6. Circuito digital**
```
printed circuit board traces, technological grid pattern, orthogonal and
diagonal lines, connection nodes, sharp geometric detail
```
Nota: las líneas y nodos claros se encienden como un circuito reactivo.

**7. Facetas de cristal**
```
faceted crystal surface, angular polygon shards, gem cut facets with sharp
ridges, low poly crystalline structure, bright facets and dark grooves
```
Nota: con metal y barniz altos en el motor, se lee como cristal tallado.

**8. Escamas / malla**
```
overlapping dragon scales, armored fish scale pattern, layered plates,
tessellated scale grid, raised scale bodies with dark separation lines
```
Nota: las escamas dan relieve; van bien con oro o metal.

### Fluidos y marmolados

**9. Acero de Damasco**
```
damascus steel folded pattern, swirling contour lines, marbled metal grain,
tight parallel bands warping into eyes and whorls, high contrast lines
```
Nota: las líneas finas se encienden; el motor lo lee como acero cepillado.

**10. Mármol veteado**
```
veined marble slab, flowing mineral veins through stone, organic crack lines,
polished stone surface, thin bright veins on mid gray
```
Nota: veta fina sobre gris medio; queda elegante con barniz alto.

**11. Fractura / vidrio roto**
```
shattered glass fracture pattern, radiating cracks from impact points,
angular splinter lines, sharp fracture network, bright cracks on dark
```
Nota: las grietas claras emiten y dan un look agresivo.

**12. Curvas de nivel topográficas**
```
topographic contour map lines, concentric elevation rings, nested closed
loops, cartographic line pattern, thin bright contours on dark
```
Nota: líneas concéntricas finas; con espectro barre el tono como un mapa de calor.

### Extras si querés más variedad

**13. Circuitería fina / trama**
```
woven carbon fiber weave, tight interlaced threads, technical fabric grid,
subtle over-under pattern, fine repeating weave
```

**14. Flujo de fluido / mercurio**
```
liquid mercury flow, metallic fluid ripples, smooth flowing blobs merging,
soft organic metaball shapes, bright rounded forms on dark
```

## Después de generar

1. Poné los PNG en `public/assets/camos/` (esa carpeta es local, no se sube al repo).
2. Verificá el teselado con el comando de arriba. **Descartá y regenerá los que no pasen.**
3. Para dar de alta un camo nuevo, se agrega una entrada al catálogo en `src/game/skins/texturas.ts` (nombre del patrón + paleta + color de emisión + parámetros de superficie + animación). Un mismo patrón puede aparecer varias veces con distinta paleta y animación: cada combinación es un camo distinto sin bajar un byte más.

El paso 3 lo hace quien toque el código; los pasos 1 y 2 los podés hacer vos con esta hoja y el verificador, sin leer nada más.
