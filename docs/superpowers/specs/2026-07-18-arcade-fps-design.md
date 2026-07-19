# Arcade FPS en navegador — Diseño

Fecha: 2026-07-18
Estado: aprobado pendiente de revisión de Santiago

## 1. Qué es

Un shooter en primera persona, arcade y rápido, que corre en el navegador sin instalar nada.
Partidas cortas contra bots, movimiento de alta movilidad tipo Combat Master (sprint, slide,
slide-cancel, bunny hop), un arsenal grande con skins, y una escalera competitiva con rangos
tipo Valorant donde la dificultad de los bots escala con tu rango.

Referencias de feel: Combat Master (movilidad y TTK), Call of Duty (arsenal y progresión),
Valorant (patrones de retroceso deterministas y sistema de rangos), Quake (aceleración aérea).

### Objetivos

1. **Rendimiento por encima de todo.** Presupuesto duro de 2.5ms de tiempo de frame.
2. El movimiento se siente rápido y responsivo antes de que exista un solo enemigo.
3. Cada disparo que impacta genera feedback inmediato y satisfactorio.
4. Arsenal grande (40 armas) con skins generadas, sin costo de arte.
5. Una escalera de rango que da razón para jugar otra partida.

### No objetivos

- Multiplayer real. No hay netcode, no hay servidores, no hay matchmaking. Solo bots.
- Cuentas de usuario. El progreso vive en el navegador.
- Monetización. Es un proyecto personal.
- Realismo. Es arcade: gravedad exagerada, TTK corto, movilidad alta.
- Mapas múltiples en el MVP. Una arena bien diseñada primero.

## 2. Restricción de rendimiento

Esta es la restricción que define la arquitectura, no una fase de optimización posterior.

### El objetivo honesto

Santiago pidió 400 FPS. `requestAnimationFrame` está limitado por el refresh del monitor:
el navegador entrega un frame por frame del compositor y no se puede exceder.

Hardware objetivo real:

| Máquina | Refresh | Presupuesto de frame | Holgura con 2.5ms |
|---|---|---|---|
| Escritorio | 240Hz | 4.16ms | 1.66x |
| MacBook | 120Hz | 8.33ms | 3.3x |

En ninguna de las dos se pueden dibujar 400 FPS. Por eso el objetivo se expresa como
**tiempo de frame, no como FPS**:

**Presupuesto: 2.5ms por frame (CPU + GPU), medido con 10 bots activos en combate.**

El valor de ese presupuesto no es un número grande de FPS: es **240 FPS clavados sin una sola
caída**, incluso en el frame más pesado de la partida. Un juego que promedia 240 pero cae a 180
cuando explota todo se siente peor que uno que nunca se mueve. La holgura de 1.66x es el margen
que absorbe los picos.

El modo benchmark reporta el throughput crudo del motor (midiendo N pasadas de render seguidas
dentro de un frame) como diagnóstico, independiente del refresh del panel.

### Desglose del presupuesto

| Componente | Presupuesto |
|---|---|
| Tick de simulación (amortizado) | 0.4ms |
| IA de bots (15Hz escalonado, amortizado) | 0.2ms |
| Submit de render (JS) | 0.5ms |
| GPU | 1.2ms |
| Holgura | 0.2ms |

Presupuestos secundarios: **≤50 draw calls**, **≤150k triángulos visibles**,
**cero asignaciones por frame**.

### Decisiones que derivan de esto

| Decisión | Razón |
|---|---|
| Iluminación horneada en lightmap + `MeshBasicMaterial` | PBR cuesta caro por píxel. La arena es estática: el costo de iluminación en runtime baja a cero. |
| Sin shadow maps, sin post-procesado | Bloom y SSAO se comen el presupuesto entero. Las sombras van horneadas. |
| Cero asignaciones en el loop | Objetos scratch preasignados. Una pausa de GC arruina el frame time más que cualquier draw call. |
| Geometría estática fusionada, props instanciados | Mantiene los draw calls bajo 50. |
| Decals en un ring buffer instanciado único | Cantidad fija, un solo draw call, sin crecimiento. |
| Raycast propio sobre BVH (`three-mesh-bvh`) | El `Raycaster` de Three asigna memoria y recorre el grafo de escena. |
| IA de bots a 15Hz escalonada | Los bots no piensan a la velocidad del render. Time-slicing entre frames. |
| Tick fijo 128Hz + interpolación de render | Física determinista e independiente del framerate, input responsivo, render libre. |
| Partículas movidas por shader | Un instanced mesh, posición calculada en GPU desde el tiempo. Cero CPU por partícula. |
| WebGL2, no WebGPU | WebGPU tiene mejor techo pero suma riesgo. Esta complejidad de escena entra en WebGL2 con holgura. |
| `AnimationMixer` de bots limitado por distancia | Las mallas skinneadas son el costo de CPU más alto de la escena. LOD de frecuencia de animación. |
| React nunca corre en el frame | Un `setState` a 400Hz mata el framerate. |

### Verificación

- HUD de rendimiento en desarrollo: ms de CPU, ms de GPU, draw calls, triángulos, delta de heap.
- Modo benchmark que renderiza sin esperar al vsync, para medir throughput crudo del motor
  independiente del refresh del monitor.
- El presupuesto se mide al cerrar **cada fase**, no al final. Si una fase lo rompe, se arregla
  en esa fase antes de avanzar.

## 3. Arquitectura

Separación dura entre React y el game loop. React renderiza menús y overlays de baja frecuencia.
Nunca corre dentro del frame.

```
src/
  app/               Next.js App Router: /, /play, /armory, /career
  ui/                React: menús, armería, carrera, scoreboard, killfeed
  game/              TypeScript puro. Cero React, cero Next, cero DOM salvo el canvas.
    engine/          renderer, loop de tick fijo, input, audio, pools de objetos
    physics/         character controller kinemático (cápsula vs AABB barrido)
    movement/        el feel: accel, fricción, air-strafe, sprint, slide, bhop, mantle
    combat/          hitscan, hitboxes, patrones de retroceso, curvas de daño
    weapons/         registry data-driven, carga de meshes, viewmodel
    skins/           generador determinista seed → parámetros de material
    bots/            FSM, percepción, apuntado, navegación
    map/             definición declarativa de la arena, spawns, cobertura, navgrid
    match/           máquina de estados del modo, score, respawn, fin de partida
    feedback/        hitmarkers, números de daño, efectos de pantalla, audio de combate, popups de XP
    progression/     rango, RR, XP, desbloqueos
```

### Límites entre módulos

Cada módulo expone una interfaz chica y no conoce las internas de los otros.

- **`engine`** no sabe nada del juego. Da un loop, input, audio y pools.
- **`physics`** recibe una posición, un delta de movimiento y la geometría del mapa; devuelve
  la posición resuelta y qué tocó. No sabe qué es un jugador.
- **`movement`** convierte input + estado en un vector de velocidad. Es la única fuente de
  verdad del feel. Toda constante tuneable vive acá, en un solo archivo.
- **`combat`** recibe un origen, una dirección y un arma; devuelve un resultado de impacto.
  No dibuja nada y no reproduce sonidos.
- **`feedback`** escucha eventos de combate y match. Es el único que dibuja efectos y suena.
  Nada más en el código emite juice, así el feel se tunea en un solo lugar.
- **`bots`** consume percepción y produce intención (mover, apuntar, disparar). Reusa el mismo
  `movement` y `combat` que el jugador, así los bots están sujetos a las mismas reglas.
- **`progression`** es matemática pura detrás de una interfaz `ProgressStore`. Implementación
  actual: `localStorage`. Cambiarla por Neon después no toca la lógica de rangos.

El bus de eventos entre `combat`/`match` y `feedback`/`ui` es un emisor tipado y sin asignaciones
(handlers preregistrados, payloads en objetos reusados).

## 4. Movimiento

El sistema más importante del juego. Si esto no se siente bien, nada más importa.

Todas las constantes viven en un solo archivo y son ajustables en vivo desde un panel de debug.
Los valores de abajo son el punto de partida, no la verdad final; se tunean jugando.

| Parámetro | Valor inicial |
|---|---|
| Velocidad base / caminar | 5.0 m/s |
| Sprint | 8.0 m/s |
| ADS | 3.5 m/s |
| Agachado | 3.0 m/s |
| Aceleración en suelo | 60 m/s² |
| Fricción en suelo | 8.0 |
| Aceleración aérea (Quake) | 100, proyección limitada a 30 |
| Velocidad de salto | 6.5 m/s |
| Gravedad | 22 m/s² (arcade, más snappy que la real) |
| Coyote time | 100ms |

### Slide

Entrada con boost de 1.35x la velocidad actual, duración 0.7s, decay hasta 0.6x.
Cancelable con salto en cualquier momento, y ese cancel conserva la velocidad: eso es lo que
permite encadenar movimiento.

### Bunny hop

- Salto automático manteniendo espacio (jump buffering, ventana de 120ms).
- Sin fricción de aterrizaje si el siguiente salto ocurre dentro de 80ms de tocar el suelo.
- La ganancia de velocidad viene de la aceleración aérea al girar el mouse mientras strafeás,
  igual que Quake y Source.
- **Tope suave a 1.8x la velocidad de sprint (~14.4 m/s).** Por encima del tope la ganancia aérea
  decae suavemente en vez de cortarse, para que no se sienta como un muro.

  El tope se mide contra el **sprint (8.0 m/s), no contra la caminata**. Contra la caminata daría
  9 m/s, apenas por encima del sprint, y encadenar saltos no se sentiría como recompensa. A 14.4
  m/s el bhop es claramente más rápido que correr, que es el punto de aprenderlo.

### Mantle

Subida automática a repisas de hasta 1.2m cuando saltás contra ellas mirando hacia arriba.

## 5. Combate

### Modelo de daño

Vida 100, sin armadura. Multiplicadores por hitbox: cabeza 1.8, torso 1.0, extremidades 0.85.

Cada arma define una curva de daño por distancia: daño completo hasta el rango óptimo,
caída lineal hasta el rango máximo, y un piso porcentual más allá.

TTK objetivo en rango óptimo: **250-400ms**. Es el rango arcade. Ejemplos:

| Clase | Daño torso | Cadencia | Disparos para matar | TTK |
|---|---|---|---|---|
| AR | 24 | 600 RPM | 5 | 400ms |
| SMG | 18 | 850 RPM | 6 | 353ms |
| Francotirador | 110 | — | 1 | instantáneo |
| Escopeta | 8 pellets × 14 | — | 1 a quemarropa | — |

### Retroceso

Patrón **determinista** estilo Valorant/CS: cada arma tiene un array de offsets `{x, y}`
indexado por número de disparo. El spray se puede aprender y contrarrestar, que es lo que hace
que dominar un arma se sienta como habilidad y no como suerte.

Encima va un cono de dispersión aleatorio chico que crece con fuego sostenido y se cierra al
soltar el gatillo. La recuperación devuelve la cámara hacia el origen con una curva suave.

### ADS

Cambio de FOV, multiplicador de sensibilidad, reducción de dispersión, penalización de velocidad
de movimiento, y tiempo de transición **por arma**. Los tiempos de ADS por arma son lo que
diferencia mecánicamente una SMG de un francotirador. Los francotiradores llevan overlay de mira.

### Hitscan

Raycast contra un BVH del mapa y contra las hitboxes de los bots. Sin proyectiles con viaje en
el MVP, sin penetración de materiales.

## 6. Armas

**Corregido el 2026-07-18.** La versión original de esta sección decía "40 arquetipos".
Estaba mal: 40 sets de estadísticas distintos son imposibles de balancear e
indistinguibles jugando. La separación correcta es:

- **10 arquetipos de estadísticas.** Son las reglas de juego: daño, cadencia,
  retroceso, tiempos. Es lo que se balancea.
- **40 modelos cosméticos.** Cada uno mapea a un arquetipo. Varios modelos comparten
  arquetipo. El modelo no cambia cómo se juega, sólo cómo se ve.

Esto es lo que hacen los shooters reales, y hace que el arsenal grande sea contenido
en vez de deuda de balance.

Un arma es un objeto de datos puro más una referencia a un mesh.

```ts
interface WeaponSpec {
  id: string
  class: 'smg' | 'ar' | 'sniper' | 'shotgun' | 'lmg' | 'pistol' | 'marksman'
  damage: { base: number; optimalRange: number; maxRange: number; minMultiplier: number }
  fireRate: number          // RPM
  fireMode: 'auto' | 'semi' | 'burst'
  magazine: number
  reload: { tactical: number; empty: number }   // segundos
  ads: { time: number; fovScale: number; sensScale: number; speedScale: number }
  recoil: { pattern: Array<[number, number]>; recovery: number; spread: SpreadCurve }
  mesh: string              // clave en el registry de assets
}
```

Las armas se desbloquean por nivel de cuenta. El loadout permite un arma primaria y una secundaria.

### 6.1 Viewmodel

**Agregado el 2026-07-18.** Toda la animación del viewmodel es **procedural**, compuesta
como capas de transformación aditivas evaluadas por frame con cero asignaciones. No hay
animación hecha a mano por arma: 40 armas × 5 animaciones sería trabajo de arte que no
tenemos, y es justo lo que este enfoque evita.

Capas, en orden determinista de composición:

| Capa | Qué hace |
|---|---|
| `sway` | Retardo respecto al movimiento del mouse, con resorte amortiguado |
| `bob` | Figura de ocho según velocidad, se desvanece en el aire y en ADS |
| `adsLayer` | Interpola de `hipOffset` a `adsOffset` en `adsTime`; también mueve el FOV y el multiplicador de sensibilidad |
| `shootKick` | Impulso atrás, arriba y con roll leve, con retorno elástico; magnitud por arma |
| `reloadLayer` | Secuencia por código: baja, inclina, pausa de cargador afuera, vuelve. Emite eventos en `magOut` y `magIn` para munición y audio |
| `drawLayer` | Sube desde abajo al cambiar de arma |

El núcleo de composición de capas es **matemática pura, sin objetos de Three.js**, para
que sea testeable con Vitest en milisegundos. La conversión al grafo de escena ocurre en
el borde, igual que con el resto del juego.

Configuración visual por arma, separada de las estadísticas del arquetipo:

```ts
interface WeaponVisual {
  slug: string
  archetype: string
  hipOffset: Transform
  adsOffset: Transform
  adsTime: number
  drawTime: number
  reloadTime: number
  kickMagnitude: number
  scaleAdjust: number
}
```

`adsOffset` se siembra con una heurística (centro del bounding box alineado al eje de
cámara, altura estimada de miras) para que las 40 armas sean usables antes de tunear
nada a mano. El ajuste fino se hace con el panel en vivo, no en código.

### 6.2 `ModelSource`

**Agregado el 2026-07-18.** No existía en la versión original de este spec.

Costura para que el origen del mesh no filtre al resto del sistema: `procedural | glb`.
Hoy sólo se implementa `glb`. La variante `procedural` queda declarada porque fue la
propuesta original de armas y sigue siendo la salida si algún arquetipo no encuentra
modelo CC0 decente. **No hay soporte de `.mdl`** y no está planificado.

### 6.3 Pipeline de assets

**Agregado el 2026-07-18.** Los packs CC0 llegan en FBX, no en glTF.

Conversión con **FBX2glTF** (binario suelto de ~20MB) y normalización con
**`@gltf-transform/core`** en Node. Se descartó Blender headless: son ~1GB de
dependencia y dejaría el script en Python, separado del stack del proyecto.

El script normaliza escala a tamaño real (una SMG mide ~0.6m), orienta con +Y arriba y
el cañón hacia -Z, reduce los materiales a un slot básico (el spec prohíbe el costo de
PBR, ver sección 2) y escribe `public/assets/weapons/index.json` con slug, nombre, conteo
de triángulos y bounding box.

**Riesgo conocido:** detectar la orientación del cañón por bounding box acierta en la
mayoría y falla en armas de silueta atípica (escopetas, revólveres, cualquier cosa con
bípode). Se presupuesta corrección manual para 5 a 10 modelos, y por eso el panel de
tuning necesita sliders de **rotación**, no sólo de posición y escala.

Los FBX de origen **nunca se commitean**: sólo los GLB convertidos (CC0, seguros) y el
script. El directorio de descarga va al `.gitignore`.

### 6.4 Panel de tuning de armas

**Agregado el 2026-07-18.** Overlay de debug detrás de `?debug=1`, DOM plano, sin React.

Selector de las 40 armas, sliders en vivo de `hipOffset`, `adsOffset`, rotación,
`scaleAdjust`, `adsTime` y `kickMagnitude`, más atajos para probar ADS, culatazo y
recarga. Un botón exporta `weapons_tuning.json`, que el juego carga al arrancar pisando
los valores heurísticos.

Es el multiplicador de velocidad de todo el sistema: tunear un arma pasa de un ciclo de
compilación a uno o dos minutos sin rebuild.

## 7. Skins

Generador determinista: una seed produce siempre la misma skin.

```
seed → hash → { colorBase, colorAcento, patrón, desgaste, metalness, emisivo, animación }
```

Se aplican como override de material sobre el mesh del arma, sin tocar la geometría.
Costo en bytes de descarga: cero.

Tiers de rareza (Común, Raro, Épico, Legendario, Exótico) que controlan cuántos parámetros
exóticos se habilitan. Solo las rarezas altas desbloquean emisivos y shaders animados,
así una legendaria se distingue de una común de un vistazo.

El generador es determinista y eso se verifica con test: la misma seed produce el mismo output
siempre, para que una skin guardada en `localStorage` se vea igual después de recargar.

## 8. Bots

Lo que hace que el rango signifique algo. Los bots usan el mismo `movement` y el mismo `combat`
que el jugador, sujetos a las mismas reglas físicas.

### Máquina de estados

`Idle → Rotar → Enfrentar → Reposicionar → Retirarse`

### Percepción

Cono de visión con verificación de línea de vista por raycast, más un radio de audición que se
dispara con los disparos. Un bot no reacciona a lo que no puede ver ni oír.

### Apuntado

La mira gira hacia el objetivo con **velocidad angular limitada**, más un cono de error que se
cierra progresivamente durante el tiempo de reacción. Nunca hay snap instantáneo, que es lo que
hace que un bot se sienta tramposo.

### Dificultad

La dificultad escala tres números y nada más:

| Nivel | Tiempo de reacción | Cono de error | Calidad de reposicionamiento |
|---|---|---|---|
| Hierro | 400ms | 6.0° | 0.0 |
| Radiante | 120ms | 0.7° | 1.0 |

Los tiers intermedios interpolan. Esto conecta directo con el sistema de rango: la dificultad de
los bots se deriva del rango actual del jugador.

### Navegación

Navgrid horneado desde la definición del mapa. Pathfinding A* con caché, ejecutado en el tick de
IA a 15Hz, no por frame.

## 9. Rangos y progresión

### Escalera

9 tiers: Hierro, Bronce, Plata, Oro, Platino, Diamante, Ascendente, Inmortal, Radiante.
3 divisiones cada uno excepto Radiante. **25 rangos totales.** RR de 0 a 100 dentro de cada uno.

### Cálculo de RR

```
combatScore = f(kills, deaths, daño, % headshot, racha)
expected    = combatScore esperado para la dificultad de bots de ese rango
delta       = combatScore - expected

rrChange = base(victoria: +18, derrota: -16) + escala(delta)
rrChange = clamp(rrChange, victoria: [5, 35], derrota: [-30, -5])
```

Promoción al superar 100 RR, descenso al bajar de 0. Hay un colchón de 10 RR en el piso de cada
división para que un mal partido no te haga bajar de tier inmediatamente.

**5 partidas de colocación** para sembrar el rango inicial.

### Progresión paralela

Nivel de cuenta por XP, que desbloquea armas. Al terminar cada partida cae una skin
(el momento de dopamina más fuerte del ciclo, ver sección 10).

## 10. Feedback y dopamina

**Esto es un sistema de primera clase, no pulido final.** Va en la fase 1, antes de que existan
los bots, porque es lo que hace que disparar se sienta bien. Todo el juice vive en `feedback/`
y en ningún otro lado, así se tunea en un solo archivo.

### Al impactar

- Hitmarker que escala de tamaño con el daño.
- Sonidos por nivel: impacto normal / headshot agudo / kill grave y pesado / headshot kill.
- Números de daño flotantes que se apagan hacia arriba.
- Punch sutil de cámara al disparar.

### Al matar

- Hitmarker expandido con una X marcada.
- Killfeed con ícono de arma.
- Popups de XP apilables (+100 KILL, +50 HEADSHOT, +25 ASSIST).
- Escalada de rachas con tono ascendente.
- Cámara lenta en la última muerte de la partida.

### Al recibir daño

- Viñeta roja direccional que indica de dónde vino.
- Screen shake proporcional al daño.
- Latido y desaturación bajo 30 de vida.

### Fuera del combate

- Barra de XP que se llena con animación al terminar la partida.
- Ceremonia de subida de rango.
- **Drop de skin al final de partida**, presentado con animación de apertura.

Todos los efectos salen de pools preasignados. El juice no puede costar frames.

## 11. Assets

Todo CC0, costo cero, sin obligación de atribución. Verificado descargando los archivos.

| Categoría | Fuente | Licencia |
|---|---|---|
| Armas (40, silueta realista) | [Quaternius Ultimate Guns](https://quaternius.com/packs/ultimategun.html) | CC0 |
| Armas animadas (6) | [Quaternius Animated Guns](https://quaternius.com/packs/animatedguns.html) | CC0 |
| Relleno de arquetipos faltantes | [chilly_durango Low Poly Firearms](https://chilly-durango.itch.io/low-poly-firearms) | CC0 |
| Cuerpos de bots | [Quaternius Ultimate Modular Men](https://quaternius.com/packs/ultimatemodularcharacters.html) | CC0 |
| Animaciones (120+, incluye combate y armas) | [Quaternius Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) | CC0 |
| VFX (muzzle flash, humo, chispas, quemaduras) | [Kenney Particle Pack](https://www.kenney.nl/assets/particle-pack) | CC0 |
| Audio de armas | [Sonniss GDC 2026](https://gdc.sonniss.com/) + [SnakeF8](https://f8studios.itch.io/snakes-authentic-gun-sounds) | Royalty-free, comercial permitido |
| Audio de UI e hitmarkers | [Kronbits 200 Free SFX](https://kronbits.itch.io/freesfx) | CC0 |

### Viewmodel sin brazos

No existe un pack gratis de brazos en primera persona rigged **y animados**. Las opciones
verificadas (WRAD ARMS, OpenGameArt FPS Arms, Sketchfab) son rigs sin animaciones, y las
animaciones son el grueso del trabajo.

**El viewmodel muestra solo el arma**, como DOOM (2016) y la mayoría de los shooters de arena.
Elimina la dependencia de arte más cara del proyecto. El feel lo dan el sway, el bob, el
retroceso y el ADS.

### Fuentes descartadas

- **Delthor FREE Weapons Pack**: CC BY-NC-ND, no comercial y sin derivados.
- **OpenGameArt**: mezcla GPL con CC0 en el mismo listado, y la procedencia del audio no está
  verificada.
- **Mixamo**: la cláusula de redistribución de archivos crudos no se pudo verificar, y para un
  juego en navegador que sirve GLB abiertos es justo la que importa. Quaternius lo reemplaza sin
  ambigüedad legal.
- **Freesound sin filtrar**: tiene CC-BY-NC.

### Pipeline

Casi todo CC0 llega en FBX, no glTF. Se necesita **un script de export batch a GLB en Blender**,
escrito una vez y reusado. Excepciones que ya vienen en GLB: Kenney Particle Pack y la Universal
Animation Library.

**Se generan por código, no se descargan:** tracers (quad estirado con gradiente longitudinal),
glows y light cookies (`createRadialGradient` sobre canvas). Los PNG de 512px para eso son 95%
alpha vacío. Se descargan solo muzzle flashes, humo y flipbooks de explosión, donde el falloff
no se puede falsear.

## 12. Stack

- **Next.js 16** App Router, **TypeScript strict**, **Tailwind** para menús y HUD de baja frecuencia.
- **Three.js** en WebGL2 para el render, manejado imperativamente. Sin React Three Fiber:
  el reconciliador de React no puede estar en el camino de un presupuesto de 2.5ms.
- **`three-mesh-bvh`** para raycasts rápidos.
- **`localStorage`** detrás de la interfaz `ProgressStore`.
- **Vitest** para lógica pura.
- Deploy en **Vercel**. Es estático, sin backend.

## 13. Testing

Los módulos de lógica pura llevan tests unitarios:

- Curvas de daño por distancia y multiplicadores de hitbox.
- Determinismo del patrón de retroceso.
- Matemática de RR: promoción, descenso, clamps, colchón de división.
- Determinismo del generador de skins (misma seed → mismo output).
- Transiciones del FSM de bots.
- Resolución de colisiones del character controller en casos borde (esquinas, rampas, techos).
- **Test de asignaciones**: mide el delta de heap sobre N ticks de simulación y falla si crece.

El feel del movimiento y la calidad del juice se verifican jugando. No hay test que te diga si
un slide se siente rico.

## 14. Fases

Cada fase cierra midiendo el presupuesto de 2.5ms. Si una fase lo rompe, se arregla ahí.

| Fase | Entrega | Criterio de salida |
|---|---|---|
| **0** | Arena, render, movimiento completo con bhop, HUD de rendimiento, modo benchmark | Se siente rápido sin disparar nada. Presupuesto cumplido en escena vacía. |
| **1** | Disparo, ADS, 1 arma, **sistema de feedback completo**, dianas | Pegarle a una diana ya da gusto sin que haya enemigos. |
| **2** | Bots, TDM, HUD de combate, killfeed | Una partida de 6 minutos es entretenida. Presupuesto cumplido con 10 bots. |
| **3** | 40 armas, generador de skins, armería, loadout | Hay razón real para cambiar de arma. |
| **4** | Rangos, RR, colocaciones, XP, drop de skins, menús | Da ganas de jugar otra. |
| **5** | *Opcional*: modelos rigged de bots, audio final, pulido | Se ve terminado. |

**No hay fase 6.** Las fases son 0 a 5 y la 5 es opcional. Cualquier trabajo que se
describa como "fase 6" está fuera de este spec.

**Sistema de armas y viewmodel (secciones 6.1 a 6.4):** cubre el alcance de viewmodel de
las fases 1 y 3, y se construye como bloque propio **después de cerrar la fase 0**. El
motivo es de dependencias, no de preferencia: el rig del viewmodel se parenta a la cámara,
que se crea en la fase 0, y el panel de tuning de armas reusa la infraestructura de sliders
en vivo que también se construye ahí. Arrancarlo antes sería construir contra aire.

Dentro de la fase 1 queda el disparo, el ADS y el sistema de feedback; el viewmodel de esa
fase lo aporta este bloque. Dentro de la fase 3 quedan las skins, la armería y el loadout;
los 40 modelos y su pipeline los aporta este bloque.

**Definition of done del MVP: fin de la fase 4.** La fase 5 es explícitamente opcional.

**Regla de corte:** si al terminar la fase 2 la partida no es entretenida, se para y se arregla
el core en vez de seguir agregando armas. Contenido sobre un core que no se siente bien es
tiempo perdido.

## 15. Riesgos

| Riesgo | Mitigación |
|---|---|
| El movimiento no se siente bien y se descubre tarde | Es la fase 0. Se prueba antes que exista nada más. |
| El presupuesto de 2.5ms no se alcanza con bots skinneados | Se mide al cerrar la fase 2. LOD de frecuencia de animación por distancia. Si no alcanza, se recorta ahí. |
| Los bots se sienten tramposos o tontos | Velocidad angular limitada y cono de error que se cierra, nunca snap. Se tunea con los tres números de dificultad. |
| El pipeline FBX→GLB se vuelve un pozo de tiempo | Se escribe el script en la fase 3 con un arma sola antes de procesar las 40. |
| Scope creep hacia multiplayer | Está en no objetivos. No hay netcode en este spec. |
