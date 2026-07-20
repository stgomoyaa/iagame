/**
 * CRC-32 (polinomio IEEE 802.3, el mismo que usan PNG y ZIP) implementado a
 * mano porque es la única pieza no trivial de escribir un PNG sin
 * dependencias. Va en su propio archivo para poder probarlo contra el
 * vector de prueba estándar ("123456789" -> 0xCBF43926) en vez de confiar a
 * ciegas en que el resto del encoder "se ve bien".
 */

const POLYNOMIAL = 0xedb88320

function buildTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? POLYNOMIAL ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
}

const TABLE = buildTable()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
