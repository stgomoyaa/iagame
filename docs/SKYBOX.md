# Skybox "galaxia púrpura"

Cubemap procedural que reemplaza el vacío negro que hoy ocupa media pantalla.
Es **nuestro**: sale de un generador determinista, no de un asset descargado,
así que se puede publicar, versionar por semilla y regenerar en otra paleta.

**Integrado.** Está aplicado a los cuatro mapas (arena, torre, búnker y
nuketown) desde `src/game/engine/renderer.ts`. Lo de abajo describe el asset
y las razones de diseño; la sección "Cómo se aplica" quedó como registro de
la receta y de las trampas que tiene.

---

## Qué se entrega

| Qué | Dónde |
|---|---|
| Generador (lógica pura + análisis) | `scripts/lib/skybox.ts` |
| Tests del generador | `scripts/lib/skybox.test.ts` (21 tests) |
| CLI de horneado | `scripts/generate-skybox.ts` |
| Asset horneado | `public/assets/skybox/galaxia-purpura/{px,nx,py,ny,pz,nz}.png` |

El asset **no se commitea** (`.gitignore`): es salida determinista de un script
que sí está commiteado. Se regenera con

```
node scripts/generate-skybox.ts
```

en ~4.5 s, byte por byte idéntico mientras no cambien semilla ni paleta
(verificado con `shasum`, no asumido). **Un deploy tiene que correr ese comando
antes del build**, o el juego pide seis PNG que no existen.

Formato: 6 PNG de 1024x1024, RGBA8, **1.1 MB en total**. Los consume
`THREE.CubeTextureLoader` sin ninguna librería extra.

---

## Camino elegido: generación procedural (no CC0 descargado)

Se generó en vez de bajar un skybox CC0, por tres razones concretas:

1. **La restricción de legibilidad no se puede tercerizar.** Un skybox CC0 de
   galaxia viene con el contraste que le pareció bien a su autor, casi siempre
   negro profundo con núcleo brillante. Este juego necesita lo contrario (ver
   abajo), y "oscurecer un poco el PNG en Photoshop" no arregla un cielo cuyo
   rango dinámico ya está horneado. Generándolo, el presupuesto de legibilidad
   es un parámetro y hay un test que lo verifica.
2. **Regenerable con otra paleta.** Cambiar `PALETA_GALAXIA_PURPURA` da el
   mismo cielo en verde o ámbar. Cambiar `--semilla` da otra galaxia. Un mapa
   nuevo puede tener su propio cielo sin conseguir otro asset.
3. **Publicable sin dudas de licencia**, a diferencia de todo lo que viene del
   Workshop.

Costo: ~350 líneas de generador. A cambio, el asset pesa 1.1 MB y no hay que
auditar la licencia de nadie.

---

## La restricción que definió el diseño

El requisito era de **jugabilidad, no estético**: el jugador tiene que
distinguir la silueta de un enemigo recortada contra el cielo. Eso choca de
frente con lo que uno dibujaría si le piden "galaxia":

> Una galaxia de verdad es negra con puntos brillantes. Un cielo negro y un
> enemigo a contraluz son los dos oscuros: la silueta desaparece.

De ahí salen dos números, los dos verificados por tests:

- **`LUMINANCIA_PISO = 0.22`** — ninguna dirección del cielo baja de ahí. Una
  silueta oscura está cerca de 0.10 sRGB; 0.12 de diferencia son ~30 niveles de
  255, muy por encima del umbral de un borde grande, y aguanta un monitor mal
  calibrado.
- **`LUMINANCIA_TECHO = 0.45`** — el cielo sin estrellas no se pasa de ahí, así
  los colores de equipo claros (`0xffd21e`) siguen destacándose *contra* el
  cielo, no sólo las siluetas oscuras.

El cielo entero vive entonces entre **0.226 y 0.313** de luminancia: un rango
de 0.09 sobre 1. Eso es lo que obligó al hallazgo central del diseño:

> **La riqueza visual es de TONO, no de brillo.** El ojo separa magenta de
> índigo aunque los dos tengan la misma luminancia, y la detección de siluetas
> es un problema de bordes, que corre casi todo por el canal de luminancia. La
> galaxia se lee por color; el enemigo se lee por brillo. Cada uno usa un canal
> distinto y no se pisan.

Por eso el cenit es índigo, el núcleo de la banda es magenta y los bordes son
azules, todos dentro de 0.05 de luminancia entre sí.

Corolario que costó una iteración: **la luminancia de un púrpura hay que
calcularla, no juzgarla mirando.** Rec.709 pesa el verde 0.7152 y es justo el
canal que un púrpura no tiene. La primera paleta usaba un violeta que se veía
idéntico al actual y daba 0.215 — bajo el piso. Lo cazó el test, no el ojo.

---

## Costo de GPU (medido, no estimado)

Medido con `EXT_disjoint_timer_query_webgl2` sobre Chrome real, **Apple M1 Pro
(ANGLE Metal)**, alternando configuraciones muestra a muestra (A/B/A/B) para
que la deriva térmica no se le cargue a una sola. 60 muestras por configuración,
dos corridas completas.

| Config | 1920x1080 | 3840x2160 |
|---|---|---|
| Escena sin skybox | 0.137 / 0.146 ms | 0.318 / 0.318 ms |
| **Delta del skybox 1024** | **+0.112 / +0.127 ms** | +0.211 / +0.138 ms |

**Conclusión: el skybox cuesta ~0.12 ms a 1080p, ~5% del presupuesto de
2.5 ms.** Es un pase fullscreen con una lectura de textura por píxel, y el
patrón de acceso es perfectamente coherente (píxeles vecinos leen texels
vecinos), así que la caché lo absorbe casi entero.

### Sobre la resolución del cubemap: 512 vs 1024 vs 2048

Se midieron las tres. **Las diferencias entre ellas quedaron por debajo del
ruido**: entre las dos corridas el orden se da vuelta (a 1080p, 1024 salió más
barato que 512 en una corrida y más caro en la otra). Sería deshonesto decir
que 2048 "cuesta medible­mente más" en este GPU.

Entonces 1024 **no** se eligió por tiempo de GPU, sino por lo que sí es
medible:

- **VRAM**: 1024 son 25 MB con mips; 2048 son 100 MB. En una GPU integrada con
  memoria compartida eso sí importa, aunque en un M1 Pro no se note.
- **Descarga**: 1.1 MB contra 3.0 MB.
- **Densidad de muestreo**: una cara cubre 90° en 1024 texels = 0.088°/texel.
  La pantalla, con FOV 90 sobre 1920 px, da 0.047°/px. O sea 1024 ya está a 1.9x
  de magnificación; 2048 agregaría detalle que la pantalla no puede mostrar.
  512, en cambio, estaría a 3.7x y las estrellas saldrían borrosas.

**Advertencia honesta:** todo esto se midió en un M1 Pro, que es una GPU fuerte.
En una integrada vieja el costo de fill rate puede ser varias veces mayor, y
ahí 0.12 ms podrían ser 0.5 ms. Si aparece un reporte de frames caídos en
hardware modesto, **bajar a 512 es la primera palanca** y cuesta un comando.

---

## Cómo se aplica

Ya está hecho, en `src/game/engine/renderer.ts` junto a `const scene = new
Scene()`. La lista de caras y el mensaje de error viven aparte, en
`src/game/engine/skybox.ts`, que es puro y NO importa three — así el orden de
las caras se puede testear contra el generador sin WebGL y sin ampliar la
lista de `architecture.test.ts`. El esqueleto es éste:

```ts
import { CubeTextureLoader, SRGBColorSpace } from 'three'

const cielo = new CubeTextureLoader()
  .setPath('/assets/skybox/galaxia-purpura/')
  // El orden es contrato de Three: +X, -X, +Y, -Y, +Z, -Z. Cambiarlo deja el
  // cielo rotado y espejado.
  .load(['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png'])

// OBLIGATORIO. Sin esto Three trata los bytes como luz lineal y los vuelve a
// codificar a sRGB en la salida: el cielo sale lavado, con la luminancia muy
// por encima de la que se diseñó, y el presupuesto de legibilidad deja de
// valer. Es el error más fácil de cometer acá.
cielo.colorSpace = SRGBColorSpace

scene.background = cielo
```

Tres cosas a tener en cuenta al integrar:

1. **`renderer.autoClear` está en `false`** en este proyecto (el viewmodel hace
   una segunda pasada). `scene.background` se dibuja igual dentro de
   `renderer.render()`, así que no hay que tocar nada — pero conviene mirar la
   captura después del cambio, porque ése es exactamente el tipo de costura
   donde este proyecto ya se comió bugs.
2. **Los mapas escritos en código no tienen techo.** Con cielo puesto se va a
   ver el skybox por arriba de las paredes de arena/torre/búnker. Es lo
   buscado, pero cambia cómo se leen esos mapas y vale una pasada de QA.
3. **El asset tiene que existir.** Si el deploy no corre el generador, los seis
   PNG dan 404 y el cielo vuelve a ser negro sin romper el juego. **Resuelto
   por los dos lados** (ver la sección siguiente): `package.json` hornea el
   asset en `predev` y `prebuild`, y si aun así falta, el renderer lo grita
   por consola con el comando exacto en vez de quedarse en negro callado.

### Asset generado contra build: por qué `prebuild` y no versionar

Había dos salidas para el asset gitignoreado. Se eligió **que el build lo
genere** (`predev` + `prebuild` en `package.json`), no versionar los 1.1 MB:

- **Versionar reintroduce el problema que el `.gitignore` evita.** El PNG es
  salida determinista de un script commiteado (verificado de nuevo acá: se
  borró la carpeta, se regeneró y los seis `shasum` dieron idénticos). Con el
  asset versionado, cada retoque de paleta o de semilla mete 1.1 MB de blobs
  nuevos en la historia para siempre, y aparece un estado imposible de
  detectar: PNG commiteados que ya no corresponden al generador commiteado.
  Nada avisaría de esa desincronización.
- **El costo real de generar es bajo**: 4.5 s, una vez, al arrancar `dev` o
  `build`. Contra eso, `git clone` baja 1.1 MB menos.
- **pnpm 10 sí corre `pre<script>`** — verificado a mano, no asumido, porque
  pnpm los tuvo desactivados por default durante varias versiones mayores y
  eso habría hecho que `prebuild` no corriera nunca sin ningún error. Hay un
  test (`src/game/engine/skybox.test.ts`) que ancla los dos scripts en
  `package.json`.

Como la generación automática puede saltearse igual (un deploy que corra
`next build` directo, sin pasar por el script de npm), **el fallo se hizo
ruidoso**: `renderer.ts` engancha el `onError` del `CubeTextureLoader` y saca
por `console.error` un mensaje con el comando a correr, una sola vez y no seis
(el loader dispara un `onError` por cara). Verificado escondiendo el asset y
recargando el juego.

### Verificar que quedó bien

```
node scripts/generate-skybox.ts    # imprime el presupuesto de legibilidad
```

Sale con código 1 si el cielo viola el piso de luminancia, el techo o el
contraste local. Es un gate real: durante el desarrollo se disparó dos veces y
las dos veces tenía razón.

---

## Cómo está construido

Todo el color sale de `colorDelCielo(dir)`, una función pura del vector unitario
que apunta a ese texel. Las caras **no** se generan independientes: cada texel se
convierte primero a su dirección en el mundo y recién ahí se evalúa el color.
Eso hace las costuras entre caras imposibles por construcción — dos texels de
caras distintas que miran casi al mismo lado dan casi el mismo color. Medido:
la diferencia sobre la arista compartida es 0.0054, contra 0.0439 entre aristas
opuestas de la misma cara. Un factor 8.

Capas, en orden:

```
base    = degradado vertical horizonte/cenit/nadir   (siempre >= piso)
banda   = pertenencia a un gran círculo inclinado 38 grados, ondulado con fBm
polvo   = fBm que MULTIPLICA el aporte de la banda (nunca al base)
color   = base + banda * (1-polvo) * paleta + estrellas
```

El detalle que sostiene el piso de luminancia: **el polvo multiplica el aporte
de la nebulosa en vez de restarse del total.** Restándolo — que es como se
consiguen normalmente las vetas oscuras de la Vía Láctea — las vetas abren
agujeros por debajo del piso. Multiplicando, el peor caso del polvo es dejar el
base intacto: el piso no se puede violar, y no hace falta ningún clamp final
que lo rescate.

Las estrellas son una grilla 3D de puntos característicos evaluada desde la
dirección, no salpicaduras sobre las caras: así una estrella sobre una arista
se ve igual desde las dos caras y la densidad por ángulo sólido queda pareja.
Son ~1600 en todo el domo, del orden de las ~3000 que se ven a ojo desnudo.

---

## Sobre la métrica de contraste local

La métrica que decide si el cielo compite con las siluetas **no** es la
desviación estándar en una ventana, que fue la primera versión y estaba mal:
la desviación estándar es ciega a la escala, así que una estrella de 2 texels y
un grumo de nebulosa que llena media ventana dan lo mismo. Esa versión terminaba
dominada por las estrellas — medía densidad estelar disfrazada de contraste y
disparaba el gate por lo único que no molesta.

La métrica real es un pasa-banda centrado en el tamaño de la silueta:

```
contraste local = |media(ventana W) - media(ventana 3W)|
```

o sea cuánto se despega un parche del tamaño de un enemigo respecto del fondo
que lo rodea. Una estrella se diluye en las dos medias (4 texels contra 1600).
Un degradado suave de horizonte a cenit da ~0, porque las dos ventanas están
centradas en el mismo punto. Un grumo a escala de silueta salta. Hay un test
para cada uno de esos tres casos.

`VENTANA_SILUETA_TEXELS = 32` sale de: enemigo de 1.8 m a 30 m subtiende 3.4°,
y a 1024 texels por cara son 0.088°/texel, o sea 39 texels; se redondea para
abajo, que es el lado conservador.

Valor actual: **0.0389**, contra un techo de 0.05.

---

## Resultado

Números del asset horneado:

```
mínima                0.226   (piso 0.22)
media                 0.256
máxima sin estrellas  0.313   (techo 0.45)
contraste local p99.9 0.0389  (ventana 32 texels)
texels de estrella    0.122%
```

Verificado además **en el render real** (Three.js, 1920x1080, leyendo el
framebuffer con `gl.readPixels`):

| Zona | Luminancia medida |
|---|---|
| Cielo limpio (mínimo sobre ~700k píxeles) | 0.2455 |
| Cielo junto a la silueta | 0.249 |
| **Silueta oscura (`0x1a1a1a`)** | **0.102** |
| Equipo púrpura (`0xb44cff`), el peor caso | 0.435 |

**Contraste silueta/cielo: 0.147**, por encima del 0.12 de diseño. El color de
equipo púrpura sobre cielo púrpura — la preocupación obvia — se lee sin
problema: 0.435 contra 0.249, porque el cielo es desaturado y el color de
equipo es vívido. La separación es de brillo, no de tono.

### Re-medido después de integrar (3840x2160, `gl.readPixels`)

El presupuesto se volvió a medir **sobre el renderer ya integrado**, que es lo
único que prueba que la integración no lo rompió. Un cuerpo `0x1a1a1a` y uno
`0xb44cff` contra el cielo, en tres mapas:

| Mapa | Cielo limpio (mín) | Cielo (media) | Silueta | Contraste silueta/cielo |
|---|---|---|---|---|
| arena | 0.2346 | 0.2568 | 0.102 | **0.1327** |
| torre | 0.2310 | 0.2550 | 0.102 | **0.1290** |
| búnker | 0.2310 | 0.2540 | 0.102 | **0.1290** |

El púrpura de equipo midió 0.4354 en los tres, o sea +0.18 sobre el cielo.
Todo por encima del piso 0.22 y del contraste 0.12 de diseño.

**Detalle de método que cambia el resultado:** el mínimo del cielo hay que
tomarlo sobre el cielo *erosionado*. Con `antialias: true`, el borde de cada
cuerpo son píxeles MEZCLA de cuerpo y cielo; contarlos como cielo daba un
mínimo de 0.1765 y hacía parecer que el piso de luminancia se violaba cuando
no. Descartando todo píxel de cielo con un vecino no-cielo a 3 px, el mínimo
sube a 0.2346, que es el número honesto.
