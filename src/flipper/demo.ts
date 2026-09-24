import { buildFap, type FapSpec } from '../lib/fapBuilder'
import { buildFim } from '../lib/manifests'
import { RpcError, type DeviceInfo, type FlipperDevice, type StorageEntry } from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Deterministic 10x10 symmetric glyph from a name, so demo icons are stable between visits. */
function glyph(seed: string): boolean[] {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const px: boolean[] = []
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const mx = x < 5 ? x : 9 - x
      const border = y === 0 || y === 9 || x === 0 || x === 9
      h = Math.imul(h ^ (mx * 31 + y), 2246822507) >>> 0
      px.push(!border && y > 0 && ((h >> 7) & 3) === 0 ? true : border && (x + y) % 3 === 0)
    }
  }
  return px
}

type DemoApp = [folder: string, file: string, spec: Partial<FapSpec> & { name: string }, flags?: { system?: boolean; market?: string }]

const API: [number, number] = [87, 1]

const DEMO_APPS: DemoApp[] = [
  ['Games', 'snake_game.fap', { name: 'Snake Game', versionMajor: 1, versionMinor: 0 }, { system: true }],
  ['Games', 'tetris_game.fap', { name: 'Tetris', versionMajor: 1, versionMinor: 2 }, { market: 'tetris_game' }],
  ['Games', 'flappy_bird.fap', { name: 'Flappy Bird', versionMajor: 1, versionMinor: 1 }, { market: 'flappy_bird' }],
  ['Games', 'doom.fap', { name: 'DOOM', versionMajor: 0, versionMinor: 9, apiMajor: 78, apiMinor: 1 }],
  ['Games', 'arkanoid_game.fap', { name: 'Arkanoid', versionMajor: 1, versionMinor: 0 }, { system: true }],
  ['Games', 'solitaire.fap', { name: 'Solitaire', versionMajor: 1, versionMinor: 3 }],
  ['GPIO', 'ld2450_radar.fap', { name: '[LD2450] Motion tracker', versionMajor: 0, versionMinor: 4, strings: ['https://github.com/thelok1s/fz-ld2450-radar'] }],
  ['GPIO', 'esp32_wifi_marauder.fap', { name: '[ESP32] WiFi Marauder', versionMajor: 0, versionMinor: 13, strings: ['https://github.com/0xchocolate/flipperzero-wifi-marauder'] }],
  ['GPIO', 'nrf24_sniffer.fap', { name: '[NRF24] Sniffer', versionMajor: 1, versionMinor: 0, apiMajor: 79, apiMinor: 3 }],
  ['GPIO', 'dht_monitor.fap', { name: '[DHT] Temp Monitor', versionMajor: 1, versionMinor: 1 }, { market: 'dht_monitor' }],
  ['GPIO', 'gpio_reader.fap', { name: 'GPIO Reader', versionMajor: 1, versionMinor: 0 }],
  ['GPIO', 'signal_generator.fap', { name: 'Signal Generator', versionMajor: 1, versionMinor: 0 }, { system: true }],
  ['GPIO', 'uart_echo.fap', { name: 'UART Echo', versionMajor: 1, versionMinor: 0 }, { system: true }],
  ['Tools', 'counter.fap', { name: 'Counter', versionMajor: 1, versionMinor: 0 }, { market: 'counter' }],
  ['Tools', 'metronome.fap', { name: 'Metronome', versionMajor: 1, versionMinor: 2 }],
  ['Tools', 'qrcode.fap', { name: 'QR Code', versionMajor: 2, versionMinor: 0, apiMajor: 87, apiMinor: 4 }],
  ['Tools', 'clock.fap', { name: 'Clock', versionMajor: 1, versionMinor: 0 }, { system: true }],
  ['NFC', 'nfc_magic.fap', { name: 'NFC Magic', versionMajor: 1, versionMinor: 9 }, { system: true }],
  ['NFC', 'picopass.fap', { name: 'PicoPass', versionMajor: 1, versionMinor: 16 }, { system: true }],
  ['NFC', 'mifare_nested.fap', { name: 'Mifare Nested', versionMajor: 1, versionMinor: 5, apiMajor: 72, apiMinor: 1 }],
  ['Sub-GHz', 'weather_station.fap', { name: 'Weather Station', versionMajor: 1, versionMinor: 1 }, { system: true }],
  ['Sub-GHz', 'pocsag_pager.fap', { name: 'POCSAG Pager', versionMajor: 1, versionMinor: 0 }, { market: 'pocsag_pager' }],
  ['Sub-GHz', 'spectrum_analyzer.fap', { name: 'Spectrum Analyzer', versionMajor: 1, versionMinor: 1 }],
  ['Bluetooth', 'bt_trigger.fap', { name: 'BT Camera Remote', versionMajor: 1, versionMinor: 0 }],
  ['Media', 'music_player.fap', { name: 'Music Player', versionMajor: 1, versionMinor: 0 }, { system: true }],
  ['Media', 'dtmf_dolphin.fap', { name: 'DTMF Dolphin', versionMajor: 1, versionMinor: 0 }],
  ['USB', 'mass_storage.fap', { name: 'Mass Storage', versionMajor: 1, versionMinor: 0 }, { system: true }],
  ['Infrared', 'ir_remote.fap', { name: 'IR Remote', versionMajor: 1, versionMinor: 1 }],
  ['iButton', 'ibtn_fuzzer.fap', { name: 'iButton Fuzzer', versionMajor: 1, versionMinor: 0, apiMajor: 50, apiMinor: 0 }],
  // Copies in other folders, the kind that pile up after manual installs.
  ['Downloads', 'flappy_bird.fap', { name: 'Flappy Bird', versionMajor: 0, versionMinor: 8, apiMajor: 79, apiMinor: 3 }],
  ['Downloads', 'ld2450_radar.fap', { name: '[LD2450] Motion tracker', versionMajor: 0, versionMinor: 2, apiMajor: 86, apiMinor: 0 }],
  ['Downloads', 'metronome_v2.fap', { name: 'Metronome', versionMajor: 1, versionMinor: 4 }],
  ['', 'counter.fap', { name: 'Counter', versionMajor: 1, versionMinor: 0 }],
  ['', 'wav_player.fap', { name: 'WAV Player', versionMajor: 1, versionMinor: 0, apiMajor: 86, apiMinor: 2 }],
]

/** An in-memory Flipper so the whole UI can be tried without hardware. */
export class DemoFlipper implements FlipperDevice {
  readonly kind = 'demo' as const
  onDisconnect?: () => void
  private files = new Map<string, Uint8Array>()
  private dirs = new Set<string>(['/ext', '/ext/apps', '/ext/apps_manifests', '/ext/apps_data'])

  constructor() {
    const manifestLines = ['V:0', `T:${Math.floor(Date.now() / 1000)}`]
    const enc = new TextEncoder()
    for (const [folder, file, spec, flags] of DEMO_APPS) {
      const dir = folder ? `/ext/apps/${folder}` : '/ext/apps'
      this.dirs.add(dir)
      const path = `${dir}/${file}`
      const bytes = buildFap({
        apiMajor: API[0],
        apiMinor: API[1],
        icon: glyph(spec.name),
        compressIcon: file.length % 2 === 0,
        padding: 4000 + ((file.length * 997) % 30000),
        ...spec,
      })
      this.files.set(path, bytes)
      if (flags?.system) {
        manifestLines.push(`D:apps/${folder}`, `F:${'0'.repeat(32)}:${bytes.length}:apps/${folder}/${file}`)
      }
      if (flags?.market) {
        const fim = buildFim({ name: spec.name, iconBase64: '', api: `${API[0]}.${API[1]}`, uid: `demo-${flags.market}`, versionUid: `demo-v-${flags.market}`, path })
        this.files.set(`/ext/apps_manifests/${flags.market}.fim`, enc.encode(fim))
      }
    }
    this.files.set('/ext/Manifest', enc.encode(manifestLines.join('\n') + '\n'))
  }

  async info(): Promise<DeviceInfo> {
    await sleep(120)
    return {
      name: 'Demo',
      apiMajor: API[0],
      apiMinor: API[1],
      target: 7,
      firmwareVersion: '1.4.1',
      firmwareBranch: 'release',
      firmwareOrigin: 'Official',
      raw: {},
    }
  }

  async list(path: string): Promise<StorageEntry[]> {
    await sleep(25)
    if (!this.dirs.has(path)) throw new RpcError('ERROR_STORAGE_NOT_EXIST', 'storageListRequest')
    const prefix = path + '/'
    const out: StorageEntry[] = []
    for (const d of this.dirs) {
      if (d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) out.push({ name: d.slice(prefix.length), type: 'dir', size: 0 })
    }
    for (const [p, data] of this.files) {
      if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) out.push({ name: p.slice(prefix.length), type: 'file', size: data.length })
    }
    return out
  }

  async stat(path: string): Promise<StorageEntry | null> {
    const name = path.split('/').pop() ?? ''
    if (this.dirs.has(path)) return { name, type: 'dir', size: 0 }
    const f = this.files.get(path)
    return f ? { name, type: 'file', size: f.length } : null
  }

  async read(path: string, onProgress?: (d: number, t: number) => void): Promise<Uint8Array> {
    const f = this.files.get(path)
    if (!f) throw new RpcError('ERROR_STORAGE_NOT_EXIST', 'storageReadRequest')
    // Roughly the speed of a real RPC read, so progress UI can be seen.
    for (let done = 0; done < f.length; done += 8192) {
      onProgress?.(done, f.length)
      await sleep(8)
    }
    onProgress?.(f.length, f.length)
    return f.slice()
  }

  async write(path: string, data: Uint8Array, onProgress?: (d: number, t: number) => void) {
    const parent = path.slice(0, path.lastIndexOf('/'))
    if (!this.dirs.has(parent)) throw new RpcError('ERROR_STORAGE_NOT_EXIST', 'storageWriteRequest')
    for (let done = 0; done < data.length; done += 8192) {
      onProgress?.(done, data.length)
      await sleep(10)
    }
    this.files.set(path, data.slice())
    onProgress?.(data.length, data.length)
  }

  async remove(path: string, recursive = false) {
    await sleep(40)
    if (this.files.delete(path)) return
    if (!this.dirs.has(path)) throw new RpcError('ERROR_STORAGE_NOT_EXIST', 'storageDeleteRequest')
    const prefix = path + '/'
    const children = [...this.files.keys(), ...this.dirs].filter((p) => p.startsWith(prefix))
    if (children.length && !recursive) throw new RpcError('ERROR_STORAGE_DIR_NOT_EMPTY', 'storageDeleteRequest')
    for (const c of children) {
      this.files.delete(c)
      this.dirs.delete(c)
    }
    this.dirs.delete(path)
  }

  async mkdir(path: string) {
    await sleep(30)
    this.dirs.add(path)
  }

  async rename(from: string, to: string) {
    await sleep(40)
    if (this.files.has(to) || this.dirs.has(to)) throw new RpcError('ERROR_STORAGE_EXIST', 'storageRenameRequest')
    const f = this.files.get(from)
    if (f) {
      this.files.delete(from)
      this.files.set(to, f)
      return
    }
    if (!this.dirs.has(from)) throw new RpcError('ERROR_STORAGE_NOT_EXIST', 'storageRenameRequest')
    const prefix = from + '/'
    for (const d of [...this.dirs]) {
      if (d !== from && !d.startsWith(prefix)) continue
      this.dirs.delete(d)
      this.dirs.add(to + d.slice(from.length))
    }
    for (const [p, data] of [...this.files]) {
      if (!p.startsWith(prefix)) continue
      this.files.delete(p)
      this.files.set(to + p.slice(from.length), data)
    }
  }

  async close() {}
}
