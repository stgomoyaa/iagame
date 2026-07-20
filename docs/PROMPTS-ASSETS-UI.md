# Prompts para Higgsfield y Claude Design

Para la capa de progresión del FPS. Copiar y pegar tal cual.

---

## 1. Higgsfield — iconos de rango (estilo Valorant)

**Especificación compartida.** Ponerla en todos los prompts de esta sección:

> Game rank insignia icon, centered on transparent background, square 1:1 composition.
> Flat vector-adjacent 3D render, sharp edges, high contrast, no photorealism.
> Dark technical sci-fi aesthetic. Metallic base with a single dominant accent color.
> The silhouette must be readable and distinct at 64x64 pixels. No text, no numbers, no letters.
> Clean rim light, subtle inner glow, no background elements, no shadow on ground.

**Los nueve rangos.** Un prompt por rango, sumando la especificación de arriba:

| Rango | Prompt específico |
|---|---|
| Hierro | `rough unpolished iron chevron, dark grey metal, pitted surface, single downward wedge` |
| Bronce | `bronze laurel-flanked shield, warm brown metal, two small chevrons` |
| Plata | `polished silver angular badge, cool grey, three stacked chevrons, faceted edges` |
| Oro | `gold winged crest, warm yellow metal, radiant center gem, four chevrons` |
| Platino | `platinum hexagonal core with orbiting ring, pale cyan glow, crystalline facets` |
| Diamante | `diamond prism cluster, deep blue and white refraction, sharp geometric spikes` |
| Master | `ascending arrow enclosed in a broken ring, emerald green energy, upward motion` |
| Grand Master | `obsidian-black angular crown, crimson core gem, jagged asymmetric silhouette, sharpest of the set before the top tier` |
| Deidad | `radiant starburst core with layered halo, white-gold with magenta edge glow, most complex silhouette of the set, unmistakable at any size` |

**Regla de silueta, y es la que más importa:** cada rango tiene que distinguirse **por forma**, no
por color. A 64 píxeles y en movimiento, dos insignias que sólo difieren en tono son la misma
insignia. La complejidad del contorno tiene que crecer de Hierro a Deidad.

---

## 2. Higgsfield — insignias de prestigio (estilo Call of Duty)

**Especificación compartida:**

> Military prestige emblem, centered on transparent background, square 1:1.
> Circular badge with layered concentric rings, dark gunmetal base.
> Flat 3D render with hard edges, no photorealism, no text, no numbers, no roman numerals.
> Readable silhouette at 64x64. Single accent color per tier.

**Diez niveles, con complejidad creciente:**

1. `single plain ring, one small star at top, muted steel accent`
2. `double ring, two stars, bronze accent`
3. `ring with two crossed swords behind, brass accent`
4. `ring with laurel wreath half-frame, copper accent`
5. `ring with full laurel wreath, three stars, silver accent`
6. `ring with upward wings flanking, four stars, pale gold accent`
7. `ring with spread eagle wings, five stars, gold accent`
8. `ring with flaming crown above, red-orange accent`
9. `ring with skull centerpiece and wings, deep crimson accent`
10. `ornate ring with radiant halo, crown, wings and central gem, violet and gold, most elaborate of the set`

---

## 3. Higgsfield — medallas de gesta

**Especificación compartida:**

> Combat medal icon, centered on transparent background, square 1:1.
> Bold simple pictogram inside a shield or hexagon frame, dark base, one accent color.
> Flat 3D, hard edges, no text, no numbers. Must read instantly at 64x64 during gameplay.

**Las quince:**

**El nombre de archivo va en la tabla y no se deriva del nombre visible.** El juego
pide los iconos por su *slug*, que no siempre coincide con cómo se lee la medalla:
"Racha de 5" es `racha-de-5`, no `racha-5`. Cuando no coinciden, el archivo existe,
se ve bien en la carpeta, y el juego igual recibe un 404 que en un `<img>` no rompe
nada: sólo deja el hueco. Ya pasó con tres de quince. Usá la columna de archivo tal
cual está escrita.

| Medalla | Archivo | Prompt específico |
|---|---|---|
| Primera sangre | `medalla-primera-sangre.png` | `single droplet pierced by a downward blade, crimson accent` |
| Doble baja | `medalla-doble-baja.png` | `two overlapping skull outlines, orange accent` |
| Triple baja | `medalla-triple-baja.png` | `three ascending skull outlines in a fan, deep orange accent` |
| Masacre | `medalla-masacre.png` | `five-point burst with skull center, red accent` |
| Headshot | `medalla-headshot.png` | `crosshair centered on a skull forehead, white accent` |
| Racha de 5 | `medalla-racha-de-5.png` | `five vertical tally bars with flame tip, amber accent` |
| Racha de 10 | `medalla-racha-de-10.png` | `ten tally bars forming a rising wave, hot orange accent` |
| Clutch | `medalla-clutch.png` | `clenched fist inside a cracked circle, electric blue accent` |
| Venganza | `medalla-venganza.png` | `broken chain link reforged, violet accent` |
| Salvada | `medalla-salvada.png` | `shield deflecting an arrow, teal accent` |
| Tiro largo | `medalla-tiro-largo.png` | `sniper reticle with a long horizontal trajectory line, pale green accent` |
| A quemarropa | `medalla-a-quemarropa.png` | `stylized four-point star burst symbol, radiating short spikes, yellow accent, no human figures` |
| Última bala | `medalla-ultima-bala.png` | `single cartridge standing upright with a spark, gold accent` |
| Sin morir | `medalla-sin-morir.png` | `hexagon frame enclosing a small crown above an unbroken ring, white-gold accent` |
| Dominación | `medalla-dominacion.png` | `laurel wreath enclosing a filled circle, emerald accent` |

---

## 4. Formato de entrega (para las tres secciones)

- **PNG con fondo transparente**, cuadrado.
- **Dos tamaños: 256×256** (galería y pantallas de progresión) **y 64×64** (HUD y listas).
  Si Higgsfield sólo da un tamaño, generar en 1024 y reducir.
- **Nombre de archivo en kebab-case**, sin espacios: `rango-deidad.png`,
  `prestigio-07.png`, `medalla-headshot.png`.
- Guardar en `public/assets/ui/` (esa carpeta **sí se commitea**: es arte generado, no
  contenido del Workshop).

**Chequeo antes de dar una tanda por buena:** poné las imágenes en fila a 64 píxeles y miralas
en escala de grises. Si dos se confunden sin color, la silueta no alcanza y hay que rehacerlas.

---

## 5. Claude Design — pantallas de progresión

**Contexto para pegar en el brief:**

> FPS arcade en navegador (Three.js, motor propio). Estética dark-técnica: HUD de combate con
> mono verde fosforescente sobre negro, cielo de galaxia púrpura, mapas importados de Source.
> El HUD de combate **ya está resuelto y no se rediseña**: munición, vida, reloj, marcador,
> killfeed, scoreboard y menú de pausa funcionan y no cuestan frames.
>
> Lo que falta es la **capa de progresión**, que hoy no existe visualmente aunque el sistema
> está implementado y funcionando: rangos de Hierro a Deidad (9 tiers, 25 rangos) con RR y 5 colocaciones, XP y
> nivel de cuenta, desbloqueo de armas por nivel, y drop de skin al terminar la partida.
>
> Se suma progresión estilo Call of Duty: prestigios (10 niveles) y medallas de gesta (15).
>
> El catálogo tiene 79 armas con nombre real y etiqueta de juego de origen: `AK-47 (CS)`,
> `M4A1 (COD)`. Esa etiqueta es información de jugabilidad, no decorativa: el jugador elige
> estilo de juego eligiendo el origen del arma.

**Pantallas pedidas, en orden de prioridad:**

1. **Carrera / Rango.** Rango actual con su insignia, RR y progreso al siguiente, historial de
   las últimas partidas, y el estado de las colocaciones si no están completas. Es la pantalla
   que el jugador abre para ver "cómo voy".
2. **Resumen de fin de partida.** Marcador final, tu línea de estadísticas, XP ganada con su
   desglose, medallas conseguidas en esa partida, cambio de RR, y el drop de skin si lo hubo.
   Es el momento de mayor dopamina del ciclo: tiene que sentirse como una recompensa.
3. **Galería de medallas.** Las 15, con las conseguidas en color y las pendientes en silueta
   apagada, con contador de cuántas veces. Progreso visible.
4. **Prestigio.** Los 10 niveles como una escalera, el actual destacado, y qué desbloquea cada
   uno.
5. **Desbloqueos por nivel.** Qué arma se abre a qué nivel de cuenta, con la etiqueta de juego
   de origen visible.

**Restricciones que no son negociables:**

- **Cero datos inventados.** Nada de "el 92% de los jugadores" ni estadísticas de relleno.
  Todo número que aparezca tiene que salir del sistema real.
- **Español neutro chileno, con tú.** Nada de voseo. Términos técnicos en inglés (headshot,
  clutch, loadout).
- **Sin em-dashes** en el texto visible.
- Tiene que **leerse rápido**: son pantallas entre partidas, no una web para explorar.
- Responsive de 1280 a 1920. El juego se juega en desktop.

**Lo que ya existe y hay que respetar, no rehacer:** `src/ui/Armoury.tsx` (armería con 79 armas,
skins y loadout), `src/ui/Career.tsx`, `src/ui/MatchSummary.tsx`, `src/ui/SensitivitySettings.tsx`.
Si el rediseño los reemplaza, tiene que conservar sus rutas y su comportamiento.
