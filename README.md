This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Modos y parámetros de URL (`/play`)

La partida se configura por query string. Todo esto es opcional: sin nada,
`/play` arranca una partida normal con los valores de `match/tuning.ts`.

| Parámetro | Qué hace |
|---|---|
| `?practica=1` | **Modo práctica.** Puebla el corredor de la arena con las cuatro dianas de plinkeo y, salvo que pidas bots explícitamente, arranca sin ninguno. Fuera de este modo NO hay dianas en ningún mapa. Acepta `1`, `true`, `si`, `sí`; cualquier otra cosa (incluido `practica=0`) es partida normal. |
| `?bots=N` | Cantidad de bots, 0 a 20. Default: `MATCH.botCount`, o 0 en modo práctica. |
| `?mode=tdm\|ffa` | Modo de partida. |
| `?map=NOMBRE` | Mapa. Gana sobre lo elegido en el panel de tuning (tecla M). |
| `?difficulty=0..1` | Dificultad pareja para todos los bots. |
| `?timeLimit=S` / `?scoreLimit=N` | Overrides de duración y límite de puntaje. |
| `?debug=1` | Panel de tuning de armas y hook `window.__combatDebug()`. |

**Por qué las dianas quedaron detrás de un modo:** se construyeron en la fase 1,
cuando todavía no había bots, y hasta ahora aparecían durante las partidas —
esferas azules sin silueta humanoide mezcladas con los bots, que ensucian la
lectura de a qué se le puede disparar. Ver `src/game/targets/practica.ts`.

## Sensibilidad

El conversor vive en la armería (`/armory`). Poné la sensibilidad que usás en
CS, Valorant, Apex, Overwatch, Call of Duty o Quake más tu DPI, y la traduce a
la escala de este juego manteniendo los cm/360, así que la puntería se
transfiere tal cual. Se guarda en `localStorage` y la próxima partida arranca
con ella. Sin nada guardado, el juego usa exactamente la sensibilidad que tuvo
siempre (0.0022 rad por conteo de mouse; ver `SENS_POR_DEFECTO` en
`src/game/settings/store.ts`).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
