# Prompt para el loop

Pegar esto después de `/loop` (sin intervalo, para que se auto-marque el ritmo).

---

Continuá construyendo este FPS hasta que sea un juego terminado y jugable. Trabajás solo,
sin nadie a quien preguntarle: tomá las decisiones de alcance vos y dejá registrado el porqué.

## Línea de llegada

El juego está terminado cuando **Santiago puede abrirlo, elegir un loadout, jugar una partida
a muerte contra bots en cualquiera de tres mapas, ganar o perder RR, y querer jugar otra**.
Cada pieza se verifica corriendo el juego en un navegador real, no leyendo el código.

No está terminado porque los tests pasen. Los tests son el piso.

## Dónde está el estado

- `docs/superpowers/specs/2026-07-18-arcade-fps-design.md` — el diseño. Manda. Si el código y
  el spec discrepan, decidí cuál está bien y **corregí el otro**.
- `.superpowers/sdd/progress.md` — la bitácora. **Leela al empezar cada iteración.** Lo que
  figura como completo, está completo.
- `docs/QA-PENDIENTE.md` — lo que sólo Santiago puede cerrar. No lo toques.
- Rama de trabajo: creá una `feat/<scope>` por bloque y mergeá a `master` al cerrarlo.

## Lo que ya está hecho y no hay que rehacer

Fases 0 y 1 mergeadas a `master`, 563 tests:

- **Movimiento completo**: sprint, slide, slide-cancel, bunny hop, mantle, sobre colisión de
  cápsula propia, loop de timestep fijo a 128Hz con render interpolado.
- **Combate**: hitscan con BVH, hitboxes con multiplicadores, curvas de daño por distancia,
  retroceso determinista aplicado a la cámara con forma tipo CS, dispersión, ADS con sus tres
  efectos (FOV, sensibilidad, velocidad).
- **Feedback**: hitmarkers de cuatro niveles con audio generado por Web Audio, números de
  daño, punch de cámara, viñeta direccional, shake, latido bajo 30 de vida. Dianas.
- **Viewmodel procedural** de seis capas, idéntico a 120 y 240Hz.
- **Pipeline de assets** FBX a GLB, 14 armas CC0 convertidas, 1 draw call cada una.
- **10 arquetipos** de estadísticas con TTK entre 300 y 400ms, sin dominancia estricta.
- **HUD con timing real de CPU y GPU**, presupuesto 2.5ms.
- **Catalogador del Workshop** de GMod con guard de publicación.

## Backlog, en orden

Una cosa por iteración. Terminala de verdad antes de pasar a la siguiente.

### 1. Fase 2 — bots y partida

Es la pieza más grande que queda y **la que convierte esto en un juego**. Sola es comparable
a las fases 0 y 1 juntas, así que partila en sub-piezas y cerrá cada una.

- **Modelos de bots**: no existen todavía. Quaternius Ultimate Modular Men (CC0, glTF) y la
  Universal Animation Library (CC0, GLB, 120+ animaciones con combate) están identificados y
  sin bajar. Ojo con el presupuesto: las mallas skinneadas van a ser el costo de CPU más alto
  de la escena, y hay que limitar la frecuencia de los mixers por distancia.
- **Máquina de estados**: patrullar, rotar, enfrentar, reposicionar, retirarse.
- **Percepción**: cono de visión con raycast de línea de vista, más radio de audición en los
  disparos. Un bot no reacciona a lo que no puede ver ni oír.
- **Apuntado**: velocidad angular limitada más un cono de error que se cierra durante el
  tiempo de reacción. **Nunca snap instantáneo**, que es lo que hace que un bot se sienta
  tramposo.
- **Dificultad**: tres números y nada más. Reacción 400 a 120ms, cono de error 6 a 0.7 grados,
  calidad de reposicionamiento 0 a 1.
- **Navegación**: navgrid horneada del mapa, A* con caché, a 15Hz escalonado entre bots.
- **Modos**: TDM y deathmatch libre, con respawn, killfeed, scoreboard y fin de partida.

Criterio de salida: **una partida de 6 minutos es entretenida**, y el presupuesto de 2.5ms se
cumple con 10 bots. Medí CPU **y GPU**: el HUD muestra los dos y la GPU es la mitad que está
más cerca del límite.

### 2. Fase 3 — contenido

**Dos fuentes de armas con reglas distintas.** Confundirlas es el error más caro de esta fase:
leé `docs/WORKSHOP.md` antes de tocar assets.

**Fuente A, CC0 (Quaternius): se commitea y se puede publicar.** Faltan 26 de 40. La carpeta
de Drive limita el acceso anónimo por cantidad de archivos: bajá en tandas y cacheá. El
pipeline fusiona `index.json` en vez de pisarlo, así que re-correrlo es seguro.

**Fuente B, Workshop de GMod: local, nunca se publica.** Santiago la eligió sabiendo que la
mayoría de esos packs son ports no autorizados de CS y Call of Duty. Viven en
`workshop-assets/`, gitignoreado, y hay un test que falla si alguno queda trackeado, incluso
forzado con `git add -f`. **No debilites ese guard por ninguna razón.**

De esos modelos se usa **sólo la malla**: el viewmodel ya anima por código con seis capas.
Packs elegidos, metadata verificada:

| Item | Id | Peso | Para qué |
|---|---|---|---|
| CS:GO Weapons | 2180833718 | 382MB | **Prioridad uno.** De ahí salen AK, M4 y Deagle |
| Modern Wokefare Base | 2459720887 | 1.0GB | El lado Call of Duty |
| CS:GO Knives | 506283460 | 389MB | Cuchillos, sólo si hay slot de melee |

**No bajes `110871780` ("Hit Numbers")**: pesa 0MB porque es Lua de GMod, no tiene modelos, y
los números de daño ya están construidos.

**Empezá convirtiendo un solo archivo y verificalo en pantalla** antes de procesar 382MB. La
cadena no está probada: bajar necesita SteamCMD y convertir `.mdl` necesita Blender con
SourceIO, ninguno instalado. **Blender son ~1GB: pedí permiso antes de instalarlo.**

Además: generador de skins determinista, armería, loadout.

**Tres mapas, escritos en código, no importados.** El actual son cajas AABB declarativas en
`src/game/map/arena.ts`. Los otros dos igual: uno más vertical, uno más cerrado, que **jueguen
distinto en vez de ser reskins**. Cada uno con sus spawns y su navgrid, validados con el test
de alcanzabilidad que ya existe.

**No importes mapas BSP.** La colisión es cápsula contra AABB; geometría arbitraria de Source
exige mesh colliders con costo real contra los 2.5ms. Usá el catalogador con `fy` y `dm` para
**mirar layouts de referencia**, no para ingerir.

### 3. Fase 4 — progresión

Rangos de Hierro a Radiante con RR, 5 colocaciones, dificultad de bots derivada del rango, XP,
desbloqueos, drop de skin al terminar la partida, y los menús.

Hay un comp de UI ya auditado en el proyecto de Claude Design "Strike Protocol UI System" (8
pantallas), y el conversor de sensibilidad está construido en `src/game/settings/` pero **el
juego no lo llama**. Conectalo.

### 4. Fase 5 — pulido

Audio real de disparos (Sonniss GDC + SnakeF8, royalty-free), VFX del Kenney Particle Pack, y
dos cosas que quedaron flojas y están anotadas: **el punch de cámara casi no se ve**, y las
dianas son esferas azules sin silueta humanoide.

## Lo que no se negocia

- **Presupuesto de 2.5ms**, CPU y GPU. Medí al cerrar cada pieza, no al final.
- **Cero asignaciones por frame.** Hay guards automáticos; no los debilites para que pase algo.
- `src/game/**` no importa `react`, `next` ni `three` fuera del allowlist.
- Todos los tests verdes antes de cada commit. Nunca `--no-verify`, nunca `git add .` (usá
  `committer`).
- Commiteá cada pieza por separado y **anotá en `.superpowers/sdd/progress.md`**.

## Cómo trabajar (esto salió caro de aprender)

- **Los bugs viven en las costuras entre mecánicas, no adentro de una.** Los peores de este
  proyecto fueron interacciones: crouch más soft cap dio velocidad infinita, crouch mantenido
  hizo el slide eterno, y el orden dentro del frame hizo que mantener R nunca recargara.
  Ningún test por mecánica los encontró.
- **Verificá el ciclo completo, no que el código exista.** Los overrides de tuning se cargaban
  bien y el panel mostraba valores viejos porque fotografiaba el registro antes de que
  resolviera el fetch. El feature "existía" y no servía para nada.
- **Medí antes de arreglar.** Un reporte de "el audio llega 2 segundos tarde" resultó ser
  1 milisegundo medido. Se arregló un bug real distinto, y decirlo fue más útil que fingir que
  se había reproducido.
- **No optimices el proxy medible en vez del objetivo.** Pedir "que no se corte en ningún
  borde" dio un arma flotando en el centro; pedir "que se lea como sostenida" dio cinco armas
  de perfil. **Si el objetivo es visual, mirá la captura.**
- **Arreglá en la fuente, no con un parche río abajo.**
- **Un test que no puede fallar es peor que ningún test.** Antes de confiar en un guard,
  rompé el código a propósito y confirmá que lo detecta.
- Cuando un test falle, primero preguntate si el defecto está en el test. En este proyecto
  pasó cuatro veces y reportarlo fue lo correcto.

## Cuándo parar y preguntar

Pará y dejá la pregunta escrita si: hay que gastar plata, hay que instalar algo pesado como
Blender, hay que decidir nombres de armas o cualquier cosa con riesgo de marca, el spec y el
código discrepan sin que esté claro cuál está bien, o algo requiere criterio de gusto que sólo
Santiago puede dar.

No pares para pedir permiso de seguir. No resumas el avance obvio. Cerrá el alcance de cada
pieza en vez de iterarla infinito: cuando algo esté suficientemente bueno para shippear,
decilo y pasá a lo siguiente.
