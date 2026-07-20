/**
 * Parser mínimo de VMT (el formato KeyValues de Source): sólo lo necesario
 * para llegar a $basetexture, siguiendo "patch"/"include" si hace falta. No
 * es un parser general de KeyValues (no hace falta leer shaders, proxies, ni
 * nada más que esta única cadena para el pipeline de texturas).
 */

export type VmtValue = string | VmtBlock
export interface VmtBlock {
  [key: string]: VmtValue
}

/**
 * Tokeniza VMT: comentarios "// hasta fin de línea", strings entre comillas
 * (sin soporte de escapes: no aparecen en archivos reales de Source), llaves
 * sueltas, y palabras sin comillas (VMT las permite para keys/values
 * simples como $bumpmap sin espacios).
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '{' || ch === '}') {
      tokens.push(ch)
      i++
      continue
    }
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j++
      tokens.push(text.slice(i + 1, j))
      i = j + 1
      continue
    }

    let j = i
    while (j < text.length && !/[\s{}]/.test(text[j])) j++
    tokens.push(text.slice(i, j))
    i = j
  }
  return tokens
}

/**
 * Parsea el árbol completo de un VMT. La raíz nunca está envuelta en llaves
 * propias (el archivo entero ES el contenido de un bloque implícito), así
 * que parseBlock() arranca en pos=0 y termina naturalmente al agotar los
 * tokens en vez de toparse con un '}' de cierre.
 */
export function parseVmt(text: string): VmtBlock {
  const tokens = tokenize(text)
  let pos = 0

  function parseBlock(): VmtBlock {
    const block: VmtBlock = {}
    while (pos < tokens.length && tokens[pos] !== '}') {
      const key = tokens[pos]
      pos++
      if (pos >= tokens.length) break

      if (tokens[pos] === '{') {
        pos++
        const nested = parseBlock()
        if (tokens[pos] === '}') pos++
        block[key.toLowerCase()] = nested
      } else {
        block[key.toLowerCase()] = tokens[pos]
        pos++
      }
    }
    return block
  }

  return parseBlock()
}

/** Un include circular (A incluye B, B incluye A) no debe colgar el proceso; con 3 alcanza para los patches reales de Source. */
const MAX_PATCH_DEPTH = 3

export interface VmtIncludeResolver {
  /** Devuelve el texto crudo de un .vmt incluido, o undefined si no está en el pakfile. */
  readVmt(path: string): string | undefined
}

/**
 * Resuelve $basetexture de un VMT ya parseado. Si la raíz es un bloque
 * "patch", sigue "include" (recursivamente, hasta MAX_PATCH_DEPTH) y aplica
 * el override de "replace" si trae $basetexture propio.
 */
export function resolveBaseTexture(block: VmtBlock, resolver: VmtIncludeResolver, depth = 0): string | undefined {
  const rootKey = Object.keys(block)[0]
  if (rootKey === undefined) return undefined
  const rootValue = block[rootKey]
  if (typeof rootValue === 'string') return undefined

  if (rootKey === 'patch') {
    if (depth >= MAX_PATCH_DEPTH) return undefined

    let baseFromInclude: string | undefined
    const includePath = rootValue['include']
    if (typeof includePath === 'string') {
      const includedText = resolver.readVmt(includePath)
      if (includedText !== undefined) {
        baseFromInclude = resolveBaseTexture(parseVmt(includedText), resolver, depth + 1)
      }
    }

    const replaceBlock = rootValue['replace']
    if (typeof replaceBlock === 'object') {
      const override = replaceBlock['$basetexture']
      if (typeof override === 'string') return override
    }
    return baseFromInclude
  }

  const basetexture = rootValue['$basetexture']
  return typeof basetexture === 'string' ? basetexture : undefined
}
