# Prompt para el loop

Pegar esto después de `/loop` (sin intervalo, para que se auto-marque el ritmo).

---

Continuá construyendo este FPS hasta que sea un juego terminado y jugable. Trabajás
solo, sin nadie a quien preguntarle: tomá las decisiones de alcance vos y dejá
registrado el porqué.

## Línea de llegada

El juego está terminado cuando **Santiago puede abrirlo, elegir un loadout, jugar una
partida a muerte contra bots en cualquiera de tres mapas, ganar o perder RR, y querer
jugar otra**. Nada de eso es opinable: cada pieza se verifica corriendo el juego en un
navegador real, no leyendo el código.

No está terminado porque los tests pasen. Los tests son el piso.

## Dónde está el estado

- `docs/superpowers/specs/2026-07-18-arcade-fps-design.md` — el diseño. Manda.
  Si el código y el spec discrepan, decidí cuál está bien y **corregí el otro**.
- `.superpowers/sdd/progress.md` — la bitácora de lo hecho y lo que encontró cada review.
  **Leela al empezar cada iteración.** Si algo figura como completo, está completo.
- `docs/QA-PENDIENTE.md` — lo que sólo Santiago puede cerrar (feel con mouse). No lo toques.
- Rama actual: `feat/armas-viewmodel`. 279 tests verdes.

## Backlog, en orden

Hacé una cosa por iteración. Terminala de verdad antes de pasar a la siguiente.

### 1. Deuda del QA profundo (antes que contenido nuevo)

- **El sway está roto.** El delta del mouse entra en píxeles crudos sin dividir por `dt`,
  así que a 240Hz recibís la mitad que a 120Hz. Y está saturado: `swayScale` 0.6 m/px
  contra un tope de 0.05m significa que todo lo que pase de 0.084 px/frame clava el tope,
  cuando apuntar de verdad son cientos de px/s. El test lo tapa porque varía framerate e
  input a la vez. Arreglá los dos ejes y hacé un test que use magnitudes reales.
- **Se puede subir a la cobertura alta de 2.2m.** El ápice de salto es 0.9349m y el mantle
  necesita 1.0m, pero las cajas mantleables de 1.0m quedan a un salto de los separadores y
  regalan el metro que falta. Repro en 1.02s desde el spawn. Arreglalo moviendo geometría o
  ajustando el salto, y fijá el margen con un test.
- **Recarga:** mantener la tecla la deja trabada para siempre sin emitir eventos, y cambiar
  de arma no la cancela. Los dos se disparan en cuanto la recarga se cablee a una tecla real.
- **Unidades del retroceso.** Leídos como radianes (lo que declara el archivo), el AR sube
  92° y el francotirador 183°, más que el rango completo de pitch. Y el patrón hace wrap con
  saltos de hasta 110°, en un sistema que el spec pide que sea aprendible. Definí la unidad,
  reescalá y hacé que `magazine % patternLength === 0`.
- **`frameDt = NaN` mata el viewmodel para siempre.** El loop fijo está blindado, la ruta del
  arma usa sólo un clamp y el clamp no filtra NaN.
- Menores: el guard de arquitectura no atrapa `three/subpath`; `slideMaxSpeed` se desincroniza
  de `bhopSoftCap` al mover el slider; un fetch de GLB fallido deja el arma anterior con las
  correcciones de la nueva aplicadas.

### 2. Fase 1 — disparar se tiene que sentir bien

Hitscan con BVH, hitboxes con multiplicadores (cabeza 1.8, torso 1.0, extremidades 0.85),
retroceso aplicado a la cámara, ADS cableado de verdad (FOV, sensibilidad, velocidad),
dianas para practicar, y **el sistema de feedback completo**: hitmarkers con sonido por
nivel, números de daño, punch de cámara, viñeta direccional al recibir.

Criterio de salida: **pegarle a una diana da gusto sin que haya enemigos.** Si no lo da,
no avances.

### 3. Fase 2 — bots y partida

FSM de bots (Idle, rotar, enfrentar, reposicionar, retirarse), percepción por cono de visión
con raycast y radio de audición, apuntado con velocidad angular limitada y cono de error que
se cierra (**nunca snap instantáneo**), navgrid horneada, IA a 15Hz escalonada.

Modo a muerte por equipos, respawn, killfeed, scoreboard, fin de partida.

Criterio de salida: **una partida de 6 minutos es entretenida**, y el presupuesto de 2.5ms
se cumple con 10 bots. Medí CPU **y GPU** (el HUD ya muestra los dos).

### 4. Fase 3 — contenido

- Bajar las 26 armas que faltan. La carpeta de Drive limita el acceso anónimo por cantidad
  de archivos: bajá en tandas y cacheá. El pipeline ya fusiona `index.json` en vez de
  pisarlo, así que correrlo de nuevo es seguro.
- **Nombres de las armas: decisión de Santiago, no la tomes vos.** AK-47 y M4 son
  designaciones reales y se usan sin problema. "Desert Eagle" es marca registrada de Magnum
  Research, y los nombres y skins específicos de CS y COD son de Valve y Activision. Si vas
  a inventar nombres evocativos en vez de copiar, escribí la lista y **dejala anotada para
  que él la apruebe**, no la shippees.
- Generador de skins determinista, armería, loadout.
- **Tres mapas.** El actual es una arena de 3 carriles. Los otros dos tienen que jugar
  distinto, no ser reskins: probá una planta más vertical y una más cerrada. Cada mapa
  necesita su navgrid y sus spawns validados con el mismo test de alcanzabilidad que ya
  existe.

### 5. Fase 4 — progresión

Rangos de Hierro a Radiante con RR, 5 partidas de colocación, dificultad de bots derivada
del rango, XP, desbloqueos, drop de skin al terminar la partida, y los menús.

Hay un comp de UI ya auditado en el proyecto de Claude Design "Strike Protocol UI System"
(8 pantallas) y el conversor de sensibilidad ya está construido en `src/game/settings/`
pero **no tiene UI y el juego no lo llama**. Conectalo.

### 6. Pulido

Audio (Sonniss GDC + SnakeF8, ambos royalty-free), VFX del Kenney Particle Pack, y sacar
el boilerplate de `create-next-app` de `src/app/page.tsx`, que hoy es lo primero que se ve
y ni siquiera linkea a `/play`.

## Lo que no se negocia

- **Presupuesto de 2.5ms**, CPU y GPU. El HUD mide los dos. Medí al cerrar cada pieza, no
  al final. Si algo lo rompe, arreglalo ahí.
- **Cero asignaciones por frame.** Hay guards automáticos; no los debilites para que pase algo.
- `src/game/**` no importa `react`, `next` ni `three` fuera del allowlist.
- Todos los tests verdes antes de cada commit. Nunca `--no-verify`, nunca `git add .`
  (usá `committer`).
- Commiteá cada pieza terminada por separado y **anotá en `.superpowers/sdd/progress.md`**
  qué hiciste. Es tu mapa de recuperación si perdés contexto.

## Cómo trabajar (esto salió caro de aprender)

- **Los bugs viven en las costuras entre mecánicas, no adentro de una.** Los tres peores de
  este proyecto fueron interacciones: crouch + soft cap dio velocidad infinita, crouch
  mantenido hizo el slide eterno, y salto + mantle + una caja auxiliar rompió el diseño del
  mapa. Ningún test por mecánica los encontró.
- **No optimices el proxy medible en vez del objetivo.** Pasó dos veces acá: pedí "que no se
  corte en ningún borde" y salió un arma flotando en el centro; pedí "que se lea como
  sostenida" y salieron cinco armas de perfil. Las dos veces el criterio se cumplió y el
  resultado estaba mal. **Si el objetivo es visual, mirá la captura.**
- **Arreglá en la fuente, no con un parche río abajo.** Un GLB con la transformación de nodo
  sucia se arregla en el pipeline, no descartándola en el renderer.
- **Un test que no puede fallar es peor que ningún test.** Antes de confiar en un guard,
  rompé el código a propósito y confirmá que lo detecta.
- Cuando un test falle, primero preguntate si el defecto está en el test. En este proyecto
  pasó tres veces y reportarlo fue lo correcto.

## Cuándo parar y preguntar

Pará y dejá la pregunta escrita si: hay que gastar plata, hay que decidir nombres de armas
o cualquier cosa con riesgo de marca, el spec y el código discrepan de una forma donde no
está claro cuál está bien, o algo requiere criterio de gusto que sólo Santiago puede dar
(el feel del movimiento ya está en `docs/QA-PENDIENTE.md`).

No pares para pedir permiso de seguir. No resumas el avance obvio. Cerrá el alcance de cada
pieza en vez de iterarla infinito: cuando algo esté suficientemente bueno para shippear,
decilo y pasá a lo siguiente.
