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
