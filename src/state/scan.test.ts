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
