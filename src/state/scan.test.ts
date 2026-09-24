import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { FlipperDevice, StorageEntry } from '../flipper/types'
import { RpcError } from '../flipper/types'
import { buildFap } from '../lib/fapBuilder'
import { scan } from './actions'
import { getState, setState } from './store'

// localStorage is only touched for prefs; a no-op stub keeps the store happy in node.
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} } as unknown as Storage

function fakeDevice(files: Record<string, Uint8Array>, opts: { flakyDir?: string; brokenFile?: string } = {}) {
  const calls: { list: { path: string; md5?: boolean }[]; reads: string[] } = { list: [], reads: [] }
  let flaked = false
  const dirs = new Set<string>(['/ext/apps'])
  for (const p of Object.keys(files)) {
    let d = p.slice(0, p.lastIndexOf('/'))
    while (d.startsWith('/ext/apps')) (dirs.add(d), (d = d.slice(0, d.lastIndexOf('/'))))
  }
  const device: FlipperDevice = {
    kind: 'serial',
    info: async () => ({ name: 'T', apiMajor: 87, apiMinor: 1, target: 7, firmwareVersion: '1', firmwareBranch: '', firmwareOrigin: '', raw: {} }),
    async list(path, withMd5) {
      calls.list.push({ path, md5: withMd5 })
      if (path === opts.flakyDir && !flaked) {
        flaked = true
        throw new RpcError('TIMEOUT', 'storageListRequest')
      }
      if (!dirs.has(path)) throw new RpcError('ERROR_STORAGE_NOT_EXIST')
      const out: StorageEntry[] = []
      for (const d of dirs) if (d.startsWith(path + '/') && !d.slice(path.length + 1).includes('/')) out.push({ name: d.slice(path.length + 1), type: 'dir', size: 0 })
      for (const [p, b] of Object.entries(files)) if (p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')) out.push({ name: p.slice(path.length + 1), type: 'file', size: b.length })
      return out
    },
    stat: async () => null,
    timestamp: async () => 1700000000,
    async read(path) {
      calls.reads.push(path)
      if (path === opts.brokenFile) throw new RpcError('ERROR_STORAGE_INTERNAL')
      const f = files[path]
      if (!f) throw new RpcError('ERROR_STORAGE_NOT_EXIST')
      await new Promise((r) => setTimeout(r, 5))
      return f
    },
    write: async () => {},
    remove: async () => {},
    mkdir: async () => {},
    rename: async () => {},
    close: async () => {},
  }
  return { device, calls }
}

const fap = (name: string, apiMajor = 87) => buildFap({ name, apiMajor, apiMinor: 1 })

describe('scan', () => {
  it('lists without md5, retries a slow folder, streams apps and survives an unreadable file', async () => {
    const files = {
      '/ext/apps/Games/snake.fap': fap('Snake'),
      '/ext/apps/GPIO/radar.fap': fap('[LD2450] Motion tracker', 86),
      '/ext/apps/GPIO/broken.fap': fap('Broken'),
      '/ext/apps/root.fap': fap('Root app'),
    }
    const { device, calls } = fakeDevice(files, { flakyDir: '/ext/apps/GPIO', brokenFile: '/ext/apps/GPIO/broken.fap' })
    setState({ device, deviceInfo: await device.info() })

    let sawPending = 0
    const probe = setInterval(() => (sawPending = Math.max(sawPending, getState().pending.length)), 1)
    await scan()
    clearInterval(probe)

    const s = getState()
    expect(calls.list.every((c) => !c.md5)).toBe(true)
    expect(calls.list.filter((c) => c.path === '/ext/apps/GPIO')).toHaveLength(2)
    expect(sawPending).toBeGreaterThan(0)
    expect(s.status).toBe('ready')
    expect(s.pending).toEqual([])
    expect(s.apps.map((a) => a.name).sort()).toEqual(['Root app', 'Snake', '[LD2450] Motion tracker', 'broken'])
    expect(s.apps.find((a) => a.appId === 'broken')?.info.error).toMatch(/Could not read/)
    expect(s.apps.find((a) => a.appId === 'radar')?.compat).toBe('too-old')

    // Each unreadable file is retried once.
    expect(calls.reads.filter((p) => p.endsWith('broken.fap'))).toHaveLength(2)

    // Second scan hits the cache: only the file that failed last time is read again.
    calls.reads.length = 0
    await scan()
    expect(new Set(calls.reads.filter((p) => p.endsWith('.fap')))).toEqual(new Set(['/ext/apps/GPIO/broken.fap']))
  })

  it('stops after three unreadable files in a row and keeps what it read', async () => {
    const files = {
      '/ext/apps/a.fap': fap('Alpha'),
      '/ext/apps/b.fap': fap('Bravo'),
      '/ext/apps/c.fap': fap('Charlie'),
      '/ext/apps/d.fap': fap('Delta'),
      '/ext/apps/e.fap': fap('Echo'),
    }
    const { device } = fakeDevice(files)
    const read = device.read.bind(device)
    device.read = async (path, ...rest) => (/[bcd]\.fap$/.test(path) ? Promise.reject(new RpcError('TIMEOUT', 'storageReadRequest')) : read(path, ...rest))
    setState({ device, deviceInfo: await device.info(), toasts: [] })
    await scan()
    const s = getState()
    expect(s.status).toBe('ready')
    expect(s.apps.map((a) => a.name)).toEqual(['Alpha', 'b', 'c'])
    expect(s.toasts.some((t) => /stopped answering/.test(t.text))).toBe(true)
  })
})

describe('folder filtering', () => {
  it('always skips assets and, by default, lowercase top-level folders', async () => {
    const { skipTopFolder } = await import('./actions')
    expect(skipTopFolder('assets', false)).toBe(true)
    expect(skipTopFolder('Games', true)).toBe(false)
    expect(skipTopFolder('GPIO', true)).toBe(false)
    expect(skipTopFolder('Sub-GHz', true)).toBe(false)
    expect(skipTopFolder('iButton', true)).toBe(false)
    expect(skipTopFolder('downloads', true)).toBe(true)
    expect(skipTopFolder('.cache', true)).toBe(true)
    expect(skipTopFolder('downloads', false)).toBe(false)
  })
})

describe('fast scan', () => {
  function jsDevice(files: Record<string, Uint8Array>, jsAvailable: boolean) {
    const base = fakeDevice(files)
    const written: Record<string, Uint8Array> = {}
    let reads = 0
    const device: FlipperDevice = {
      ...base.device,
      write: async (path, data) => {
        written[path] = data
      },
      read: async (path, ...rest) => {
        if (path.endsWith('.fap')) reads++
        return base.device.read(path, ...rest)
      },
      async runCli(command, opts) {
        if (!jsAvailable) {
          const out = `${command}\r\n\`js\` command not found\r\n>: `
          opts.onText?.(out)
          return out
        }
        const script = new TextDecoder().decode(written[command.split(' ')[1]])
        const lines: string[] = []
        const storage = {
          openFile(path: string) {
            const bytes = files[path]
            let pos = 0
            return bytes && {
              seekAbsolute: (o: number) => ((pos = o), true),
              read: (_m: string, n: number) => {
                const out = bytes.slice(pos, pos + n)
                pos += out.length
                return out.buffer
              },
              close: () => true,
            }
          },
          readDirectory: async () => undefined,
        }
        // Directory listing comes from the same fake as the RPC path.
        const listings = new Map<string, { path: string; isDirectory: boolean; size: number }[]>()
        const collect = async (dir: string) => {
          const entries = await base.device.list(dir).catch(() => undefined)
          if (!entries) return
          listings.set(dir, entries.map((e) => ({ path: e.name, isDirectory: e.type === 'dir', size: e.size })))
          for (const e of entries) if (e.type === 'dir') await collect(`${dir}/${e.name}`)
        }
        await collect('/ext/apps')
        storage.readDirectory = ((dir: string) => listings.get(dir)) as never
        new Function('require', 'print', 'Uint8Array', script)(
          () => storage,
          (...a: unknown[]) => lines.push(a.join(' ')),
          (x: ArrayBuffer) => new Uint8Array(x),
        )
        const out = `${command}\r\nRunning script ${command.split(' ')[1]}, press CTRL+C to stop\r\n${lines.join('\r\n')}\r\nScript done!\r\n>: `
        // Deliver in awkward chunks, as serial does.
        for (let i = 0; i < out.length; i += 37) opts.onText?.(out.slice(i, i + 37))
        return out
      },
    }
    return { device, reads: () => reads }
  }

  const files = {
    '/ext/apps/Games/snake.fap': fap('Snake'),
    '/ext/apps/GPIO/radar.fap': fap('[LD2450] Motion tracker', 86),
    '/ext/apps/assets/about.fap': fap('About'),
  }

  it('uses the on-device script when js is available and reads no .fap over RPC', async () => {
    const { device, reads } = jsDevice(files, true)
    setState({ device, deviceInfo: await device.info(), jsScan: 'unknown', toasts: [], prefs: { ...getState().prefs, fastScan: true } })
    await scan()
    const s = getState()
    expect(s.jsScan).toBe('available')
    expect(reads()).toBe(0)
    expect(s.apps.map((a) => a.name).sort()).toEqual(['Snake', '[LD2450] Motion tracker'])
    expect(s.apps.every((a) => a.info.partial)).toBe(true)
    expect(s.apps.find((a) => a.appId === 'radar')?.compat).toBe('too-old')
    expect(s.folders).toEqual(['', 'Games', 'GPIO'])
  })

  it('falls back to the standard scan when the firmware has no js command', async () => {
    const { device } = jsDevice(files, false)
    setState({ device, deviceInfo: await device.info(), jsScan: 'unknown', toasts: [], prefs: { ...getState().prefs, fastScan: true } })
    await scan()
    const s = getState()
    expect(s.jsScan).toBe('unavailable')
    expect(s.toasts.some((t) => /Fast scan unavailable/.test(t.text))).toBe(true)
    expect(s.apps.map((a) => a.name).sort()).toEqual(['Snake', '[LD2450] Motion tracker'])
    expect(s.apps.some((a) => a.info.partial)).toBe(false)
  })
})
