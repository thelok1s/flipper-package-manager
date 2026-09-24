import { describe, expect, it } from 'vitest'
import { decodeIcon, parseFap } from './fap'
import { buildFap, encodeIcon, heatshrinkEncode } from './fapBuilder'
import { heatshrinkDecode } from './heatshrink'

const icon = Array.from({ length: 100 }, (_, i) => (i % 10 === 0 || i < 10 || i % 7 === 3))

describe('heatshrink', () => {
  it('round-trips literals and back references', () => {
    const data = Uint8Array.from([1, 2, 3, 1, 2, 3, 1, 2, 3, 0, 0, 0, 0, 0, 0, 9, 255, 255])
    expect([...heatshrinkDecode(heatshrinkEncode(data))]).toEqual([...data])
  })
})

describe('icons', () => {
  it('decodes raw and compressed icons identically', () => {
    expect(decodeIcon(encodeIcon(icon, false))).toEqual(icon)
    expect(decodeIcon(encodeIcon(icon, true))).toEqual(icon)
  })
})

describe('parseFap', () => {
  it('reads the .fapmeta manifest', () => {
    const bytes = buildFap({
      name: '[LD2450] Motion tracker',
      apiMajor: 86,
      apiMinor: 0,
      versionMajor: 1,
      versionMinor: 4,
      stackSize: 4096,
      icon,
      compressIcon: true,
      strings: ['About', 'https://github.com/thelok1s/fz-ld2450-radar.', 'http://example.org/x'],
    })
    const info = parseFap(bytes)
    expect(info.error).toBeUndefined()
    expect(info.manifest).toMatchObject({
      name: '[LD2450] Motion tracker',
      apiMajor: 86,
      apiMinor: 0,
      versionMajor: 1,
      versionMinor: 4,
      stackSize: 4096,
      hardwareTarget: 7,
    })
    expect(info.manifest?.icon).toEqual(icon)
    expect(info.urls[0]).toBe('https://github.com/thelok1s/fz-ld2450-radar')
  })

  it('reports garbage without throwing', () => {
    expect(parseFap(new Uint8Array([1, 2, 3])).error).toBeTruthy()
  })
})
