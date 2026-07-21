# Ópticas (miras) — fase cosmética del sistema de accesorios

Primer accesorio nativo de las armas de COD: montar una **mira** sobre el arma
al subir su nivel. Esta fase es **puramente cosmética** — la óptica se ve, pero
**no toca ninguna estadística** (daño, retroceso, ADS, zoom). El efecto en
stats es una fase futura.

## Qué hay

- **6 ópticas** convertidas del pack ARC9 Modern Warfare Classic: 2 red dot
  (`optic_reddot_m68`, `optic_reflex_mw3`), 2 holográficas (`optic_holo_eotech`,
  `optic_holo_cod4`) y 2 magnificadas (`optic_acog`, `optic_hamr`).
- **5 armas de COD** con ancla llena y verificada: `cod4_ak47`, `mw2e_acr`,
  `mw3e_m4a1`, `mw3e_scarl`, `mw2e_scar`.
- **Retícula por código** (el punto rojo): un quad aditivo con textura de canvas,
  a escala de mundo fija (independiente del FOV). Ningún pack la hornea —
  ARC9/ArcCW/TFA la dibujan por código, y nosotros también.
- **Desbloqueo por nivel de arma**: cada óptica se desbloquea en un nivel (2..5)
  de la barra de XP por arma que ya existía (`progression/weapon-xp.ts`).

## Archivos

| Archivo | Qué hace |
|---|---|
| `scripts/convert-opticas.ts` | Convierte los `.mdl` de óptica a GLB (reusa el Blender de las armas). |
| `scripts/capturar-opticas.mjs` | Captura el banco para el entregable (Chrome aislado por CDP). |
| `src/app/optics-harness/page.tsx` | Banco visual: arma + óptica, para afinar anclas y sacar capturas. |
| `src/game/weapons/attachments/optics-catalog.ts` | **Dato puro**: catálogo, anclas por arma, desbloqueo. Sin three. |
| `src/game/weapons/attachments/mount.ts` | **Borde con la GPU**: arma la malla montada y dibuja la retícula. |
| `src/game/weapons/viewmodel/renderer.ts` | `setOptic(id)`: monta la óptica sobre el cuerpo del arma equipada. |
| `docs/opticas-capturas/` | Capturas del entregable (5 armas + 6 ópticas). |

Los GLB de óptica viven en `public/assets/weapons-local/optic_*.glb` (local,
gitignoreado, igual que las armas de COD). No se commitean nunca.

## Los dos espacios de coordenadas (esto es lo que se hace mal)

El GLB del **arma** (normalizado por `convert-source-weapons.ts`) y el de la
**óptica** (crudo de `mdl-to-glb.py`) NO están en el mismo frame:

- **Arma normalizada**: adelante `-Z`, arriba `+Y`, ancho `X`. Un rifle mide
  0,85 m sobre `Z` (todas las clases se reescalan a un largo canónico).
- **Óptica cruda**: adelante `+X` (objetivo), arriba `+Y`, ancho `Z`. En metros
  reales (un red dot mide ~9 cm sobre `X`).

Por eso el ancla lleva una **rotación base de +90° sobre Y** (mapea óptica `+X`
→ arma `-Z`) y una **escala ~1.0** para rifles (la óptica en metros reales cae
casi a escala del arma reescalada a 0,85 m).

## Cómo agregar el ancla de un arma nueva (llenado incremental)

**El costo real de esta capa es llenar los datos para las 69 armas de COD**: no
es código, es medir + ajustar a ojo, un arma por vez. Por eso se dejaron 5
armas de ejemplo y el resto queda como llenado incremental. Un arma sin ancla
simplemente no puede montar óptica todavía (`anclaDe` devuelve `null`), que es
honesto: mejor sin mira que con una flotando.

Para agregar un arma:

1. Sacá su `sightHeight` del índice
   (`public/assets/weapons-local/index.json`): es el techo de la silueta.
   Valor de arranque para la Y del ancla: **~0,62 × sightHeight** (el riel/tapa
   está por debajo de la punta de los hierros).
2. Agregá una fila a `ANCLAS` en `optics-catalog.ts`:
   `slug: { pos: [x, y, z], rot: [0, BASE_YAW, 0], escala: 1.0 }`
   (`x` ≈ `sightLateral` ≈ 0, `z` ≈ +0,03..+0,05 para caer sobre la caja).
3. Afiná en el banco:
   ```
   node scripts/convert-opticas.ts workshop-assets/cod-arc9/repo workshop-assets/cod-arc9/glb-opticas   # sólo si faltan GLBs
   cp workshop-assets/cod-arc9/glb-opticas/optic_*.glb public/assets/weapons-local/
   pnpm dev -p 3230   # y en otra terminal:
   node scripts/capturar-opticas.mjs http://localhost:3230 docs/opticas-capturas
   ```
   Mirá la captura: la mira tiene que quedar **asentada sobre el riel** (no
   flotando ni atravesando) y el **punto rojo visible**. Subí/bajá la Y, corré
   la Z. El juez es la captura, no un test verde.

Cámaras y overrides en vivo: `window.__opticsHarness.mostrar(arma, optica, { pos, rot, escala, lente, camPos, camTarget })`.

## Cómo agregar una óptica nueva

1. Agregá el `.mdl` al mapa `OPTICAS` de `scripts/convert-opticas.ts` (slug →
   ruta relativa a `models/weapons/arc9/atts/`).
2. Corré la conversión y copiá el GLB (ver arriba).
3. Agregá su `OpticaDef` a `OPTICAS` en `optics-catalog.ts`: categoría,
   retícula (`punto`/`holo`/`chevron`, color, tamaño), `lente` (centro de la
   lente en espacio de la óptica, del centro geométrico medido) y
   `nivelDesbloqueo`.
4. Verificá en el banco.

## Desbloqueo por nivel de arma

Se apoya en la curva ya calibrada de `weapon-xp.ts` (5 niveles, ascensos en
2..5). Cada óptica tiene un `nivelDesbloqueo`; `opticasDesbloqueadas(xpDeArma)`
devuelve las disponibles. Reparto actual:

| Nivel | XP acumulada | Ópticas que se suman |
|---|---|---|
| 2 | 600 | `optic_reddot_m68`, `optic_reflex_mw3` |
| 3 | 1800 | `optic_holo_eotech`, `optic_holo_cod4` |
| 4 | 3600 | `optic_acog` |
| 5 | 6000 | `optic_hamr` |

No se rediseñó la progresión: hasta ahora el nivel de arma sólo pagaba camos de
maestría porque **no existía sistema de accesorios**; ahora paga también
ópticas.

## Lo que esta fase NO hace / qué queda pendiente

- **No toca stats.** Ni daño, ni retroceso, ni ADS, ni zoom (la ACOG "debería"
  magnificar: en esta fase es sólo el cuerpo + la retícula, sin zoom real).
- **Sólo 5 de 69 armas** tienen ancla. El resto es llenado incremental (arriba).
- **UI de equipar**: `renderer.setOptic(id)` está cableado y probado, pero no hay
  todavía pantalla que lo llame (elegir mira en la armería). Es el siguiente
  paso de integración.
- **Lente translúcida**: la retícula se dibuja sin test de profundidad, así que
  se ve siempre; no depende de que la lente del pack quede perfectamente
  translúcida.
