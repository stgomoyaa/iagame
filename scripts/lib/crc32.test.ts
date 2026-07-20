import { describe, expect, it } from 'vitest'
import { crc32 } from './crc32.ts'

describe('crc32', () => {
  it('coincide con el vector de prueba estándar de CRC-32 ("123456789" -> 0xCBF43926)', () => {
    const data = Buffer.from('123456789', 'ascii')
    expect(crc32(data).toString(16)).toBe('cbf43926')
  })

  it('el CRC de un buffer vacío es 0', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })

  it('un solo byte distinto cambia el CRC (detecta que no es una constante hardcodeada)', () => {
    const a = crc32(Buffer.from('IHDR', 'ascii'))
    const b = crc32(Buffer.from('IHDS', 'ascii'))
    expect(a).not.toBe(b)
  })
})
