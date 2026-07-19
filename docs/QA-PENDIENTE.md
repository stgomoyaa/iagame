# QA pendiente de Santiago

Cosas que ningún test ni ningún agente puede cerrar. Necesitan una mano en un mouse.

## Fase 0 — sesión de feel (bloquea el cierre real de la fase)

Correr `pnpm dev`, abrir `http://localhost:3000/play`, hacer clic en el canvas para tomar
el pointer lock. La tecla `` ` `` abre el panel de sliders.

### Lo que nunca ejecutó un humano

Estas tres mecánicas están cubiertas por tests unitarios pero jamás por una mano. El
pointer lock no funciona en navegadores de automatización, y el bunny hop en particular
**no se puede ejercitar sin mouse**: saltar en línea recta no gana nada (8.00 m/s clavado),
toda la ganancia viene de girar el mouse mientras strafeás.

- [ ] **Mouse-look.** ¿La sensibilidad se siente bien? ¿El pitch topa antes de darse vuelta?
      ¿Hay algún tirón o aceleración rara?
- [ ] **Bunny hop.** Mantener espacio y girar el mouse mientras strafeás. ¿Se puede
      *encontrar* la técnica, o hay que adivinarla? La simulación converge a 14.4 m/s contra
      8.0 de sprint. ¿Llegás vos a esa velocidad?
- [ ] **Mantle.** Correr contra las cajas de 1.0m y contra los escalones de 1.1m saltando.
      ¿Sube limpio o se siente como que te traba?

### Lo verificado en navegador, pero no *sentido*

- [ ] **Slide y slide-cancel.** Ctrl corriendo, después espacio. ¿El cancel conserva
      velocidad de forma que invite a encadenar?
- [ ] **Salto.** Ápice de 0.96m contra cajas de 1.0m. ¿Se lee como "casi la hago" o como
      "el juego me robó"? Si es lo segundo, subir `jumpVelocity` o bajar la cobertura baja.
- [ ] **Altura de cámara al agachar.** Interpola en 120ms (`eyeHeightLerpTime`). ¿Se siente
      natural o lento?
- [ ] **240Hz en el escritorio.** Sólo se probó a 120Hz en la MacBook. Confirmar que el
      contador se clava en 240 sin caídas.

### Cómo tunear

Todo número de feel está en `src/game/movement/tuning.ts` y el panel escribe sobre él en
vivo, sin recompilar. Mové el slider hasta que se sienta bien, anotá el valor, y decímelo
para dejarlo fijo en el archivo.

Los sliders que más mueven la aguja, en orden: `groundAccel`, `airAccel`, `gravity`,
`jumpVelocity`, `slideBoost`.

## Seguridad

- [ ] **Regenerar la API key de Steam** en https://steamcommunity.com/dev/apikey. La que
      está en `.env.local` volvió a quedar expuesta en un transcript persistente (esta vez
      al probar `process.loadEnvFile` mientras se construía el catalogador del Workshop).
      Ya van dos veces. Toma 30 segundos e invalida la anterior.
