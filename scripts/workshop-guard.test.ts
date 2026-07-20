/**
 * Guardia estructural: nada derivado del Steam Workshop puede terminar
 * trackeado por git. "Nunca se publica" tiene que estar garantizado por el
 * repo, no por memoria.
 *
 * No alcanza con chequear .gitignore: `git add -f` lo ignora a propósito, y
 * ese es exactamente el accidente que hay que atajar. Por eso este test lee
 * el índice real de git (`git ls-files`) en vez de sólo el archivo
 * .gitignore. Modelado sobre src/game/architecture.test.ts, que también
 * recorre el estado real (el filesystem, ahí) en vez de confiar en una
 * convención.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = process.cwd()

/** Directorio local-only para assets derivados del Workshop. Ver docs/WORKSHOP.md. */
const WORKSHOP_ASSETS_DIR = 'workshop-assets'

/** Copia servible de los mapas convertidos. Local-only por el mismo motivo. */
const PUBLIC_MAPS_DIR = 'public/assets/maps'

/** Armas derivadas del Workshop, servibles por HTTP. Tercera puerta al mismo
 *  problema que public/assets/maps/: ver el test más abajo. */
const PUBLIC_LOCAL_WEAPONS_DIR = 'public/assets/weapons-local'

const WORKSHOP_CATALOG_FILES = ['workshop-catalog.csv', 'workshop-catalog.json']

function gitTrackedFiles(pathspec: string): string[] {
  const out = execFileSync('git', ['ls-files', '--', pathspec], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return out.split('\n').filter((line) => line.length > 0)
}

describe('guardia de publicación: assets del Workshop', () => {
  it('git ls-files no encuentra ningún archivo trackeado dentro de workshop-assets/', () => {
    const tracked = gitTrackedFiles(WORKSHOP_ASSETS_DIR)
    expect(
      tracked,
      `estos archivos de ${WORKSHOP_ASSETS_DIR}/ están en el índice de git y no deberían: ${tracked.join(', ')}. ` +
        `Si se agregaron con "git add -f", sacarlos con "git rm --cached <archivo>".`,
    ).toEqual([])
  })

  // La integración de mapas de Source abrió una segunda puerta: el
  // navegador sólo puede bajar archivos que estén bajo /public, así que los
  // mapas convertidos se COPIAN ahí. Son los mismos bytes derivados del
  // Workshop, sólo que en una carpeta que el resto del repo sí publica --
  // exactamente el accidente que este guard existe para atajar.
  it('git ls-files no encuentra ningún mapa importado dentro de public/assets/maps/', () => {
    const tracked = gitTrackedFiles(PUBLIC_MAPS_DIR)
    expect(
      tracked,
      `estos archivos de ${PUBLIC_MAPS_DIR}/ están en el índice de git y no deberían: ${tracked.join(', ')}.`,
    ).toEqual([])
  })

  // Tercera puerta, abierta por la ingesta de armas de Source: mismo
  // razonamiento que los mapas, con un agravante propio. Las armas no son un
  // mapa que se elige a mano desde un menú de debug -- entran al CATÁLOGO,
  // que es lo que el juego recorre para armar la armería y para elegir con
  // qué se spawnea. Si un .glb de acá se cuela al índice de git, el build
  // publicado no sólo lo CONTIENE: lo sirve por HTTP y lo pone en pantalla
  // como una de sus armas. Es el caso con más consecuencias de los tres, y
  // por eso el guard lo cubre igual que a los otros dos: leyendo el índice
  // real de git, que es lo único que `git add -f` no puede esquivar.
  it('git ls-files no encuentra ningún arma local dentro de public/assets/weapons-local/', () => {
    const tracked = gitTrackedFiles(PUBLIC_LOCAL_WEAPONS_DIR)
    expect(
      tracked,
      `estos archivos de ${PUBLIC_LOCAL_WEAPONS_DIR}/ están en el índice de git y no deberían: ${tracked.join(', ')}. ` +
        `Sacarlos con "git rm --cached <archivo>".`,
    ).toEqual([])
  })

  it('.gitignore declara public/assets/weapons-local/ como ignorado', () => {
    const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^\/public\/assets\/weapons-local\/$/m)
  })

  it('.gitignore declara public/assets/maps/ como ignorado', () => {
    const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^\/public\/assets\/maps\/$/m)
  })

  it('el catálogo del Workshop (csv/json) tampoco está trackeado', () => {
    for (const file of WORKSHOP_CATALOG_FILES) {
      const tracked = gitTrackedFiles(file)
      expect(tracked, `${file} está trackeado por git y no debería`).toEqual([])
    }
  })

  it('.gitignore declara workshop-assets/ como ignorado', () => {
    const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^workshop-assets\/$/m)
  })

  it('.gitignore declara el catálogo del Workshop como ignorado', () => {
    const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^\/workshop-catalog\.csv$/m)
    expect(gitignore).toMatch(/^\/workshop-catalog\.json$/m)
  })
})
