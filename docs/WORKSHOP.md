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
Workshop: eso es un paso futuro separado (sección 4).

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

| | `public/assets/weapons/` | `workshop-assets/` |
|---|---|---|
| Origen | Packs CC0 (Quaternius y similares) | Steam Workshop de GMod |
| Licencia | CC0, uso libre | En su mayoría no autorizada (ports de CS/CoD) |
| ¿Se commitea? | Sí | **Nunca** |
| ¿Se puede publicar? | Sí | **Nunca** |
| Formato | `.glb` normalizado por `scripts/convert-weapons.ts` | Lo que sea (mallas extraídas, GLBs intermedios) |

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

## 4. Lo que NO está construido (ingesta más allá del catálogo)

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
