# Workshop de GMod: catalogador y política de assets

Este documento cubre tres cosas: cómo conseguir y guardar la API key de
Steam, cómo correr el catalogador (`scripts/workshop-catalog.ts`), y la
política de dos niveles que separa lo que se puede publicar de lo que no.

## Por qué existe esto

La mayoría de los packs de armas del Workshop de GMod son ports no
autorizados de contenido de Counter-Strike y Call of Duty. Sirven para
prototipar rápido con mallas de calidad AAA, pero el juego **nunca** puede
publicarse cargando esos assets. Esta carpeta de docs y el pipeline que
describe existen para que esa separación quede garantizada por el repo, no
por acordarse de no hacer algo.

## 1. API key de Steam

1. Andá a <https://steamcommunity.com/dev/apikey> y generá una key gratis
   (pide un dominio; alcanza con poner cualquiera que controles, ej.
   `purafama.cl`).
2. Copiala a `.env.local` en la raíz del repo:
   ```
   STEAM_API_KEY=tu_key_acá
   ```
   Ese archivo ya existe (vacío) y ya está en `.gitignore`. Nunca se
   commitea.
3. **Nunca** peguen la key en un chat, un log, o un archivo que no sea
   `.env.local`. Si se expuso una vez (transcript, chat, screenshot),
   regenerarla desde la misma página del punto 1 invalida la anterior al
   instante — toma 30 segundos y es la única forma de estar seguro después
   de una exposición.

## 2. Correr el catalogador

`scripts/workshop-catalog.ts` **sólo cataloga**. No descarga nada del
Workshop: eso es un paso futuro separado (sección 6).

```bash
node --env-file=.env.local scripts/workshop-catalog.ts "mw2019" "css weapons" "arccw" \
  --tags Weapon --min-subs 5000
```

- Cada término entre comillas corre como una búsqueda independiente contra
  `IPublishedFileService/QueryFiles`; los resultados de todos los términos
  se fusionan y deduplican por `publishedfileid`.
- `--tags TagA,TagB` filtra por tags del Workshop (por defecto, alcanza con
  tener al menos uno; `--match-all-tags` exige tenerlos todos).
- `--min-score`, `--min-votes`, `--min-subs` sobreescriben los tres
  umbrales default (0.8, 50, 2000). Los tres se piden a la vez; **subscribers
  es la señal más honesta** de las tres: un pack 5 estrellas con 4 votos no
  dice nada, y nadie se suscribe a un addon roto.
- La key sale únicamente de `process.env.STEAM_API_KEY`. Nunca se pasa como
  argumento (quedaría en el historial de la shell). Si falta, el script
  imprime estos mismos pasos y sale con código distinto de cero — no
  intenta ninguna llamada a la red sin key.
- Cada corrida **fusiona** con `workshop-catalog.json`/`.csv` existentes en
  vez de reescribirlos: se puede catalogar en varias sesiones sin perder la
  curación de las anteriores (mismo patrón que `scripts/lib/merge-index.ts`
  usa para el índice de conversión de armas).
- Ante un error de la API (rate limit, key inválida, respuesta con forma
  inesperada), el script corta con un mensaje legible. Nunca escribe un
  catálogo parcial que aparente estar completo.

Salida: `workshop-catalog.csv` (para abrir en una planilla y curar a mano)
y `workshop-catalog.json` (misma data, para consumir por código más
adelante), ambos en la raíz del repo, ordenados por subscribers
descendente. Los dos están en `.gitignore`: no tienen contenido con
copyright (es sólo metadata pública del listado del Workshop: título,
autor, contadores, tags, URL), pero igual quedan fuera del repo porque todo
este flujo es de uso local.

**Nota sobre el campo `author`:** es el SteamID64 del creador, no su nombre
para mostrar. `QueryFiles` no devuelve el nombre; conseguirlo pediría un
segundo llamado a `ISteamUser/GetPlayerSummaries`, que no se implementó acá
(no era parte del contrato pedido y agregar un segundo endpoint sin poder
probarlo en vivo era más riesgo que valor).

## 3. Política de dos niveles

| | `public/assets/weapons/` | `workshop-assets/` | `public/assets/maps/` | `public/assets/weapons-local/` |
|---|---|---|---|---|
| Origen | Packs CC0 (Quaternius y similares) | Steam Workshop de GMod | Derivado de `workshop-assets/` | Derivado de `workshop-assets/` |
| Licencia | CC0, uso libre | En su mayoría no autorizada (ports de CS/CoD) | La del Workshop | La del Workshop |
| ¿Se commitea? | Sí | **Nunca** | **Nunca** | **Nunca** |
| ¿Se puede publicar? | Sí | **Nunca** | **Nunca** | **Nunca** |
| Formato | `.glb` normalizado por `scripts/convert-weapons.ts` | Lo que sea (mallas extraídas, GLBs intermedios) | `.json` de colisión + `.glb` texturizado | `.glb` normalizado por `scripts/convert-source-weapons.ts` |

A esas cuatro se suma **`public/assets/audio/weapons-local/`** (sonidos de
disparo por arma, sección 6): mismo origen, misma licencia, nunca se
commitea, nunca se publica; formato `.ogg` (Opus mono 48 kHz) producido por
`scripts/prepare-weapon-sounds.ts`.

`public/assets/maps/`, `public/assets/weapons-local/` y
`public/assets/audio/weapons-local/` son la excepción incómoda: el navegador
sólo puede bajar archivos servidos desde `/public`, así que lo convertido
tiene que estar ahí. Estar en una carpeta que el resto del repo sí publica
**no** los convierte en publicables. Por eso están gitignoreadas y por eso
`scripts/workshop-guard.test.ts` chequea las CUATRO carpetas contra el índice
de git, no sólo `workshop-assets/`.

La de audio tiene un filo extra: es la única que vive DENTRO de una carpeta
cuyo contenido sí se commitea (`public/assets/audio/`, donde están los 11
samples por clase que hacen de fallback). El `.gitignore` apunta a la
subcarpeta, no a la padre, y hay un test que falla si alguien lo "arregla"
ignorando la padre — eso dejaría al juego sin fallback y con todas las armas
mudas en un checkout limpio.

En las armas esa separación además hace de interruptor: el catálogo del juego
carga siempre el índice CC0 y sólo *intenta* el local, así que un build
publicado —que no tiene esos archivos— se queda con sus 40 armas CC0 sin
error visible. No hay una bandera de "publicar sí/no" que se pueda dejar mal
puesta, porque lo que no está no se puede filtrar (ver `registry.ts`).

`workshop-assets/` está en `.gitignore`, pero **eso solo no alcanza**:
`git add -f` ignora `.gitignore` a propósito, y ese es exactamente el
accidente que hay que atajar. La garantía real es
`scripts/workshop-guard.test.ts`, que corre en `pnpm test` (por lo tanto en
cualquier corrida normal de tests) y lee el índice real de git
(`git ls-files -- workshop-assets`), no el archivo `.gitignore`. Si algún
día un archivo de `workshop-assets/` o del catálogo termina trackeado por
git —por el motivo que sea—, ese test falla y lo dice.

Esa garantía se probó de verdad, no se asumió: se forzó un archivo dummy a
`workshop-assets/` con `git add -f`, se confirmó que el test fallaba, se
lo sacó del índice y del disco, y se confirmó que el test volvía a pasar.
El detalle completo (comandos y salida) está en el reporte de esta tarea.

## 4. Mapas de Source: del `.bsp` al juego

Un mapa importado son **dos archivos** que el juego baja por HTTP, y los dos
salen de un `.bsp` del Workshop. Todo el proceso es offline y manual a
propósito: parsear 47 MB de `.bsp` en el navegador sería absurdo, y los
archivos derivados siguen siendo contenido del Workshop.

```bash
W=workshop-assets
BSP=$W/maps/nuketown/maps/dm_nuketown.bsp

# 1. Colisión (JSON) + malla sin texturas (GLB)
node scripts/bsp-convert.ts $BSP $W/maps-convertidos

# 2. Texturas del pakfile del propio .bsp, a PNG + index.json
node scripts/extract-textures.ts $BSP $W/texturas/nuketown

# 3. Pegarle las texturas a la malla -> GLB autocontenido
node scripts/map-textures.ts \
  $W/maps-convertidos/dm_nuketown.glb \
  $W/texturas/nuketown \
  $W/maps-convertidos/dm_nuketown-tex.glb

# 4. PASO MANUAL: copiar a /public para que el navegador pueda bajarlos.
#    public/assets/maps/ también está gitignoreado (ver la tabla de abajo).
mkdir -p public/assets/maps
cp $W/maps-convertidos/dm_nuketown.json     public/assets/maps/dm_nuketown.json
cp $W/maps-convertidos/dm_nuketown-tex.glb  public/assets/maps/dm_nuketown.glb
```

El nombre del mapa y las dos rutas se declaran en `MAPAS_EXTERNOS`
(`src/game/map/registry.ts`). Con eso aparece en el desplegable del panel de
tuning (tecla M) y en `?map=<nombre>`. Si los archivos no están, elegir ese
mapa **cae al mapa por defecto** con un error en consola: la copia es
manual, así que faltar es el caso esperable, no un bug.

Hoy hay dos mapas declarados: `nuketown` (`dm_nuketown`) y `lasertag`
(`gm_lasertag_arena`). El segundo se usó para verificar la orientación de
las UV contra un cartel con texto legible ("DO NOT BLOCK / FIRE EXIT"), que
es la única forma de comprobar que las texturas no salen dadas vuelta.

Limitaciones conocidas del pipeline:

- Los **displacements** (terreno esculpido) no se convierten: sus caras se
  descartan. nuketown tiene 6.
- Los **props estáticos** (`prop_static`) no entran: la malla sale de los
  brushes del mapa, no del lump de props. Los muebles, autos y cercas de
  nuketown no están.
- Los materiales que apuntan a texturas del juego base y no van empacados en
  el `.bsp` se quedan con un color plano (10 de 43 en nuketown).
- Los brushes `CONTENTS_PLAYERCLIP` (los muros invisibles que Source usa
  para acotar al jugador) **no** se importan: sólo entra `CONTENTS_SOLID`.

## 5. Armas de Source: del `.glb` convertido al catálogo

Mismo patrón que los mapas, y por el mismo motivo: los `.glb` de armas
derivadas del Workshop viven fuera del repo, y el navegador sólo puede bajar
lo que está en `/public`, así que hay un **paso manual de copia** que nadie
puede hacer por accidente.

```bash
# 1. Normalizar: orienta, escala por clase, hornea la textura en COLOR_0 y
#    mide la línea de puntería de cada arma. Lee el catálogo de
#    src/game/weapons/source-catalog.ts, no el directorio: un .glb sin fila
#    en esa tabla se ignora (no tiene nombre genérico ni arquetipo).
node scripts/convert-source-weapons.ts \
  workshop-assets/glb \
  public/assets/weapons-local

# 2. Listo: el script YA escribe en public/assets/weapons-local/, que está
#    gitignoreado. No hay un segundo paso de copia como con los mapas.
```

Con eso, `pnpm dev` levanta con **79 armas** (40 CC0 + 39 locales). Sin eso
—o en cualquier checkout limpio— levanta con **40**, sin ningún error: el
registry (`src/game/weapons/registry.ts`) carga siempre el índice CC0 y sólo
*intenta* el local; un 404 ahí es el caso normal, no una falla.

**Por qué son 39 y no los 42 `.glb` que hay.** Tres modelos (`elite`,
`deagle_dual`, `mac10_dual`) son de puño doble: medidos, no son un arma ancha
sino DOS armas acostadas en el mismo plano y espejadas entre sí, así que no
existe una rotación que las deje a las dos derechas y el rig de viewmodel
—que anima un arma— no las puede posar. Entrarían visiblemente rotas. El
razonamiento completo está en el encabezado de `source-catalog.ts`.

**El cargador viaja separado.** Los `.mdl` de Source traen el cargador como
una malla aparte (`w_ak47_mag.smd` junto a `w_ak47.smd`). El conversor de
Blender lo preserva como un nodo propio llamado `weapon_mag` —todo lo demás,
incluidos silenciador y visor, se une en `weapon_body`— y
`convert-source-weapons.ts` lo mantiene separado usando `join({ keepNamed:
true })`. Sin ese flag el join fusiona las dos partes y el cargador deja de
existir como cosa animable: verificado, con `keepNamed: false` el índice sale
con **0 de 39** armas con cargador, y con él, **35 de 39**.

Las 4 que no lo tienen son las que no tienen cargador extraíble de verdad:
`revolver`, `nova`, `sawedoff` y `xm1014`. Para ésas —y para las 40 CC0, que
son modelos de una pieza— la recarga cae a la coreografía procedural sola
(`src/game/weapons/viewmodel/reload.ts`), que se lee igual como una recarga
porque no depende de la geometría: el arma rola para mostrar el pozo del
cargador y acentúa los dos eventos.

Cuesta **un draw call más** por arma equipada que tenga cargador (medido: 8
draws con un arma CC0, 9 con el AK-47), y ninguno para las que no. Durante el
tramo en que el cargador viejo ya cayó y el nuevo todavía no entró, el nodo se
oculta y vuelve a costar 8.

**Nombres.** El slug interno es el nombre del archivo de origen (`ak47`,
`awp`) y nunca se muestra; lo que ve el jugador es el nombre genérico de la
tabla ("Cárpato", "Lanza"). `source-catalog.test.ts` verifica contra una
lista negra explícita que ninguna marca se filtre a un nombre mostrado, y
chequea también el catálogo CC0 para que la regla valga para todo el arsenal.

**Estadísticas.** Ningún arquetipo nuevo: las 39 mapean a los 10 arquetipos
ya calibrados (`archetypes.ts`), por clase. El modelo cambia cómo se ve el
arma, no cómo se juega.

**Por qué estas armas se trajeron: el ADS.** Los 40 modelos CC0 no tienen
mira modelada —son siluetas con un riel vacío arriba— y por eso todos los
intentos de arreglar el ADS moviendo offsets fallaron: no se puede alinear
una geometría que no existe. Los modelos de Source sí traen alza y punto de
mira, así que `scripts/lib/sight.ts` los MIDE y `seed.ts` usa esa medición
para poner la línea de puntería sobre el eje de la cámara. Las 40 CC0 no
cambian de comportamiento: la rama nueva sólo corre si la entrada del índice
trae `sightHeight`, que es lo que el pipeline viejo no produce.

Verificado en el navegador (que es el único criterio que vale acá) sobre un
fusil, un subfusil, una pistola y el francotirador: mira centrada en la
cruceta con una desviación de ±1 px sobre 1280, y ningún cuerpo de arma
tapando el punto al que se apunta. En el francotirador la cruceta cae dentro
del tubo del visor, no sobre su techo.

## 6. Sonidos de disparo por arma

Tercer pipeline con el mismo patrón y el mismo paso manual de copia. Antes
había **7 samples de disparo para 79 armas** (uno por clase), así que todas
las armas de una familia sonaban idéntico; ahora cada arma tiene el suyo.

```bash
# 1. Preparar: recorta el disparo de cada arma de los tres packs, lo pasa a
#    Opus/Ogg mono 48 kHz y escribe un index.json con la asignación
#    arma -> fuente. La tabla de asignación es A MANO y vive en
#    scripts/lib/weapon-sounds.ts (ASIGNACION).
node scripts/prepare-weapon-sounds.ts

# 2. PASO MANUAL: copiar a /public para que el navegador pueda bajarlos.
#    public/assets/audio/weapons-local/ está gitignoreado (ver la tabla de
#    la sección 3). Ojo con la barra final del origen: se copia el CONTENIDO.
mkdir -p public/assets/audio/weapons-local
cp -R workshop-assets/weapon-sounds/. public/assets/audio/weapons-local/
```

Resultado: **79/79 armas cubiertas, 73 fuentes distintas, 130 archivos, 1,8
MB**. 16 armas tienen varias grabaciones del mismo disparo, que el juego rota
para que el fuego sostenido no suene a un bucle de una sola muestra.

**Ojo con la carpeta.** Es la primera carpeta local-only que vive DENTRO de
una que sí se commitea: `public/assets/audio/` tiene los **11 samples por
clase** que son el fallback del juego. Ignorar la carpeta padre en vez de la
subcarpeta dejaría al juego sin ese fallback, que es peor que el bug
original. `scripts/workshop-guard.test.ts` chequea las dos mitades: que no
haya nada trackeado bajo `weapons-local/` y que los 11 por clase **sigan**
trackeados.

**Qué pasa sin los assets.** Exactamente lo mismo que con los mapas y las
armas: el índice da 404 y el juego cae a los 7 samples por clase, sin ningún
error visible. Un checkout limpio suena como sonaba antes de esta tarea, que
es un estado perfectamente jugable. Ningún arma queda muda nunca.

**Estrategia de carga (por qué no se bajan los 130 al arranque).** Se bajan
los 11 por clase (~120 KB) y el índice (~15 KB); los `.ogg` van **por arma**,
cuando el juego equipa un arma o arma el escuadrón de bots. Bajar 1,8 MB al
inicio sería pedir ~10x de lo que una partida usa —se juega con dos armas
propias y N de bots, no con 79— y competiría con los GLB y el mapa justo
cuando la latencia importa. La carga perezosa no cuesta el tirón habitual
porque el sample por clase ya está listo: lo peor que pasa es que **un** tiro
suene genérico mientras llega el bueno. El detalle está en el encabezado de
`src/game/feedback/gun-audio.ts`.

**Formato: Opus en Ogg, sin fallback AAC.** Safari soporta Opus-en-Ogg recién
desde 18.4 (marzo 2025). En un Safari anterior falla el `decodeAudioData`, el
buffer nunca entra y el disparo cae al sample de la clase — o sea, el mismo
desenlace que un checkout sin los assets. Duplicar los 130 archivos a AAC (el
preparador lo soporta con `--formato aac`, verificado) costaría el doble de
disco y un segundo pipeline para comprar una degradación que ya está cubierta
y es silenciosa. Si algún día el fallback por clase desaparece, hay que
revisar esta decisión.

## 7. Lo que NO está construido (ingesta más allá del catálogo)

Esto es deliberadamente honesto sobre lo que falta. Nada de esto se probó:

- **SteamCMD** para descargar el contenido de un `publishedfileid` una vez
  curado en el catálogo. No está instalado. El comando típico es
  `steamcmd +login anonymous +workshop_download_item 4000 <id> +quit`, pero
  eso no se corrió ni se verificó acá.
- **Blender + SourceIO o Plumber** para convertir el `.mdl` de Source
  (formato de modelo de GMod) a algo que `scripts/convert-weapons.ts` pueda
  consumir. Ninguna de las dos herramientas está instalada ni se probó
  contra un `.mdl` real.
- La malla que salga de ese proceso debería, en teoría, poder pasar por el
  mismo pipeline de normalización que ya existe
  (`scripts/convert-weapons.ts`) una vez convertida a un formato que
  `@gltf-transform` pueda leer (glTF/GLB). Pero esa costura —.mdl
  convertido por Blender entrando al pipeline existente— nunca se ejecutó,
  así que no hay garantía de que encaje sin ajustes.
- Los viewmodels del Workshop traen esqueleto y animaciones: ambos se
  descartan. Sólo interesa la malla estática, igual que con los modelos de
  Quaternius: el sistema procedural de animación en 6 capas
  (`src/game/weapons/viewmodel/rig.ts`) ya cubre eso y es independiente de
  framerate.

Quien retome esto: tratar cada paso de esta sección como no verificado
hasta que alguien lo corra una vez de punta a punta con un pack real.
