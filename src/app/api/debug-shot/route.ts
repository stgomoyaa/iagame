/**
 * Endpoint de captura de pantalla para DEBUG. Recibe un PNG (data URL) desde
 * el cliente y lo guarda en `debug-shots/` en la raíz del proyecto, con un
 * nombre con timestamp. Sirve para que el dueño (que juega desde otra máquina
 * de la LAN) deje capturas en el árbol del proyecto y así se puedan mirar acá.
 *
 * Por qué el server escribe a disco y no el navegador: el navegador sólo puede
 * bajar el archivo a la carpeta de Descargas de SU máquina, no al árbol del
 * proyecto que vive donde corre el server. Un POST al server sí llega al disco
 * correcto.
 *
 * Es una herramienta de desarrollo. No maneja auth ni límites porque corre en
 * la LAN local del dueño, no expuesto a internet.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NextResponse } from 'next/server'

/** Carpeta de salida, en la raíz del proyecto (gitignored). */
const DIR = join(process.cwd(), 'debug-shots')

export async function POST(req: Request): Promise<NextResponse> {
  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ error: 'json inválido' }, { status: 400 })
  }

  const dataUrl =
    typeof cuerpo === 'object' && cuerpo !== null && 'data' in cuerpo
      ? (cuerpo as { data: unknown }).data
      : null
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    return NextResponse.json({ error: 'se esperaba un data URL PNG en `data`' }, { status: 400 })
  }

  const base64 = dataUrl.slice('data:image/png;base64,'.length)
  const bytes = Buffer.from(base64, 'base64')

  // Nombre con timestamp legible: fecha y hora hasta el segundo, más los
  // milisegundos para no pisar dos capturas del mismo segundo.
  const ahora = new Date()
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  const nombre =
    `shot-${ahora.getFullYear()}${pad(ahora.getMonth() + 1)}${pad(ahora.getDate())}` +
    `-${pad(ahora.getHours())}${pad(ahora.getMinutes())}${pad(ahora.getSeconds())}` +
    `-${pad(ahora.getMilliseconds(), 3)}.png`

  try {
    await mkdir(DIR, { recursive: true })
    await writeFile(join(DIR, nombre), bytes)
  } catch (e) {
    return NextResponse.json(
      { error: `no se pudo guardar: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, archivo: `debug-shots/${nombre}`, bytes: bytes.length })
}
