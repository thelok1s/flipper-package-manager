import { describe, expect, it } from 'vitest'
import { buildRecord } from './analyze'
import { buildFap } from './fapBuilder'
import { parseFap } from './fap'
import { officialFromManifest, untarFile } from './official'
import { parseResourcesManifest } from './manifests'

function tarEntry(name: string, body: string) {
  const data = new TextEncoder().encode(body)
  const header = new Uint8Array(512)
  header.set(new TextEncoder().encode(name), 0)
  header.set(new TextEncoder().encode(data.length.toString(8).padStart(11, '0') + '\0'), 124)
  header[156] = 0x30
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512)
  padded.set(data)
  return [...header, ...padded]
}

const OFFICIAL_MANIFEST = [
  'V:0',
  'T:1764963226',
  'D:apps/NFC',
  'F:aaaa:1000:apps/NFC/nfc.fap',
  'F:bbbb:1000:apps/GPIO/gpio.fap',
  'F:cccc:10:subghz/assets/keeloq_mfcodes',
].join('\n')

describe('official apps', () => {
  it('finds resources/Manifest in a tar and keeps only .fap entries', () => {
    const tar = Uint8Array.from([...tarEntry('resources/dolphin/manifest.txt', 'nope'), ...tarEntry('resources/Manifest', OFFICIAL_MANIFEST), ...new Uint8Array(1024)])
    const file = untarFile(tar, (n) => n === 'resources/Manifest')
    expect(new TextDecoder().decode(file!)).toBe(OFFICIAL_MANIFEST)
    const o = officialFromManifest('1.4.3', OFFICIAL_MANIFEST)
    expect(o.paths.sort()).toEqual(['/ext/apps/gpio/gpio.fap', '/ext/apps/nfc/nfc.fap'])
    expect(o.fileNames.sort()).toEqual(['gpio.fap', 'nfc.fap'])
  })

  it('splits official, firmware, catalog and sideloaded apps', () => {
    const o = officialFromManifest('1.4.3', OFFICIAL_MANIFEST)
    const device = parseResourcesManifest(
      ['F:1:1:apps/NFC/nfc.fap', 'F:1:1:apps/Main/gpio.fap', 'F:1:1:apps/Tools/mntm_extra.fap'].join('\n'),
    )
    const ctx = {
      device: null,
      systemPaths: device,
      official: { paths: new Set(o.paths), fileNames: new Set(o.fileNames) },
      fims: [{ file: 'counter.fim', uid: '', versionUid: '', fullName: '', buildApi: '', path: '/ext/apps/Tools/counter.fap', iconBase64: '', devCatalog: false }],
      catalog: null,
      catalogByName: null,
    }
    const info = parseFap(buildFap({ name: 'X', apiMajor: 87, apiMinor: 1 }))
    const origin = (path: string) => buildRecord({ path, size: 1 }, info, ctx).origin
    expect(origin('/ext/apps/NFC/nfc.fap')).toBe('official')
    expect(origin('/ext/apps/Main/gpio.fap')).toBe('official') // moved by a fork, still listed by its firmware
    expect(origin('/ext/apps/Downloads/gpio.fap')).toBe('sideloaded') // same name, but not from any firmware
    expect(origin('/ext/apps/Tools/mntm_extra.fap')).toBe('firmware')
    expect(origin('/ext/apps/Tools/counter.fap')).toBe('market')
    expect(origin('/ext/apps/Tools/other.fap')).toBe('sideloaded')
  })
})
