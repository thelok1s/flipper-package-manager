import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlipperDevice, StorageEntry } from '../flipper/types'
import { buildRecord } from '../lib/analyze'
import type { CatalogApp } from '../lib/catalog'
import { buildFap } from '../lib/fapBuilder'
import { parseFap } from '../lib/fap'
import { parseFim } from '../lib/manifests'
import { installFromCatalog } from './actions'
import { getState, setState } from './store'

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} } as unknown as Storage

const device = { name: 'T', apiMajor: 87, apiMinor: 1, target: 7, firmwareVersion: 'mntm-dev', firmwareBranch: '', firmwareOrigin: '', raw: {} }

const cat: CatalogApp = {
  id: 'app-id',
  alias: 'bounce',
  author: 'someone',
  categoryId: 'games-id',
  versionId: 'v2-id',
  name: 'Bounce',
  version: '1.2',
  shortDescription: '',
  iconUri: 'https://catalog.flipperzero.one/api/v0/application/version/assets/icon',
  screenshots: [],
  buildApi: '87.1',
  createdAt: 0,
  updatedAt: 0,
  downloads: 0,
}

const fim = (versionUid: string, buildApi: string) =>
  parseFim(
    `Filetype: Flipper Application Installation Manifest\nVersion: 1\nFull Name: Bounce\nIcon: \nVersion Build API: ${buildApi}\nUID: app-id\nVersion UID: ${versionUid}\nPath: /ext/apps/Games/bounce.fap`,
    'bounce.fim',
  )

describe('catalog updates', () => {
  const info = parseFap(buildFap({ name: 'Bounce', apiMajor: 87, apiMinor: 1, versionMajor: 1, versionMinor: 2 }))
  const ctx = (f: ReturnType<typeof fim>) => ({
    device,
    systemPaths: new Map(),
    official: null,
    fims: [f],
    catalog: new Map([['bounce', cat]]),
    catalogByName: null,
    catalogById: new Map([[cat.id, cat]]),
  })
  const record = (f: ReturnType<typeof fim>) => buildRecord({ path: '/ext/apps/Games/bounce.fap', size: 1 }, info, ctx(f))

  it('follows the Flipper Lab rule for catalog installs', () => {
    expect(record(fim('v2-id', '87.1')).updateAvailable).toBe(false)
    expect(record(fim('v1-id', '87.1')).updateAvailable).toBe(true) // newer version in the catalog
    expect(record(fim('v2-id', '86.0')).updateAvailable).toBe(true) // built for another API
  })
})

describe('installFromCatalog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('installs the catalog build like Flipper Lab and replaces a sideloaded copy', async () => {
    const files = new Map<string, Uint8Array>([['/ext/apps/Downloads/bounce_old.fap', buildFap({ name: 'Bounce', apiMajor: 86, apiMinor: 0 })]])
    const removed: string[] = []
    const d: FlipperDevice = {
      kind: 'serial',
      info: async () => device,
      list: async () => [] as StorageEntry[],
      stat: async () => null,
      timestamp: async () => null,
      read: async (p) => files.get(p) ?? new Uint8Array(),
      write: async (p, data) => void files.set(p, data),
      remove: async (p) => void (removed.push(p), files.delete(p)),
      mkdir: async () => {},
      rename: async () => {},
      close: async () => {},
    }
    const build = buildFap({ name: 'Bounce', apiMajor: 87, apiMinor: 1, versionMajor: 1, versionMinor: 2 })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/build/compatible')) {
        expect(url).toContain('target=f7&api=87.1')
        return new Response(build.slice().buffer)
      }
      return new Response(new Uint8Array([1, 2, 3]))
    })
    vi.stubGlobal('fetch', fetchMock)

    const oldInfo = parseFap(files.get('/ext/apps/Downloads/bounce_old.fap')!)
    const oldFile = { path: '/ext/apps/Downloads/bounce_old.fap', size: 10 }
    const oldRecord = buildRecord(oldFile, oldInfo, {
      device,
      systemPaths: new Map(),
      official: null,
      fims: [],
      catalog: null,
      catalogByName: null,
    })
    setState({
      device: d,
      deviceInfo: device,
      op: null,
      status: 'ready',
      scanned: [{ ...oldFile, info: oldInfo }],
      apps: [oldRecord],
      fims: [],
      folders: ['', 'Downloads'],
      history: [],
      catalog: {
        ...getState().catalog,
        status: 'ready',
        apps: [cat],
        byAlias: new Map([['bounce', cat]]),
        byName: new Map(),
        byId: new Map([[cat.id, cat]]),
        categories: new Map([['games-id', 'Games']]),
      },
    })
    const ok = await installFromCatalog(cat, '/ext/apps/Downloads/bounce_old.fap')
    expect(ok).toBe(true)
    expect(files.get('/ext/apps/Games/bounce.fap')).toEqual(build)
    const fimText = new TextDecoder().decode(files.get('/ext/apps_manifests/bounce.fim'))
    expect(parseFim(fimText, 'bounce.fim')).toMatchObject({ uid: 'app-id', versionUid: 'v2-id', buildApi: '87.1', path: '/ext/apps/Games/bounce.fap' })
    expect(removed).toContain('/ext/apps/Downloads/bounce_old.fap')

    const s = getState()
    expect(s.apps.map((a) => [a.path, a.origin, a.updateAvailable])).toEqual([['/ext/apps/Games/bounce.fap', 'market', false]])
    expect(s.folders).toContain('Games')
    expect(s.history[0]).toMatchObject({ kind: 'replace', path: '/ext/apps/Downloads/bounce_old.fap', toPath: '/ext/apps/Games/bounce.fap' })
    expect(s.history[0].backup?.length).toBeGreaterThan(0)
    expect(s.op).toBeNull()
  })
})
