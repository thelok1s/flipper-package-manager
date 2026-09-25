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
  fapHash: '',
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

describe('linking and reclaiming', () => {
  const rec = (version: string, origin: 'sideloaded' | 'market' | 'firmware' = 'sideloaded') => {
    const [maj, min] = version.split('.').map(Number)
    const info = parseFap(buildFap({ name: 'Bounce', apiMajor: 87, apiMinor: 1, versionMajor: maj, versionMinor: min }))
    const r = buildRecord({ path: '/ext/apps/Games/bounce.fap', size: 1 }, info, {
      device,
      systemPaths: origin === 'firmware' ? new Map([['/ext/apps/games/bounce.fap', '']]) : new Map(),
      official: null,
      fims: origin === 'market' ? [fim('v2-id', '87.1')] : [],
      catalog: new Map([['bounce', cat]]),
      catalogByName: null,
      catalogById: new Map([[cat.id, cat]]),
    })
    return r
  }

  it('links only copies the catalog can vouch for', async () => {
    const { linkState, OLDER_THAN_CATALOG } = await import('../lib/analyze')
    const none = new Set<string>()
    expect(linkState(rec('1.2'), none)).toMatchObject({ ok: true, versionUid: 'v2-id' })
    expect(linkState(rec('1.0'), none)).toMatchObject({ ok: true, versionUid: OLDER_THAN_CATALOG })
    expect(linkState(rec('2.0'), none).ok).toBe(false) // newer than the catalog
    expect(linkState(rec('1.2', 'market'), none).ok).toBe(false) // already linked
    expect(linkState(rec('1.2', 'firmware'), none).ok).toBe(false) // the firmware manages it
    expect(linkState(rec('1.2'), new Set(['bounce.fim'])).ok).toBe(false) // another copy is linked
    expect(rec('1.2').catalogMatch).toBe('alias')
  })

  it('refuses to install a second copy', async () => {
    setState({ device: { kind: 'serial' } as FlipperDevice, deviceInfo: device, op: null, apps: [rec('1.2')], toasts: [] })
    expect(await installFromCatalog(cat)).toBe(false)
    expect(getState().toasts.at(-1)?.text).toMatch(/already on the Flipper/)
  })

  it('reclaims only backups the catalog can replace', async () => {
    const { reclaimSpace, catalogFor } = await import('./actions')
    const base = { ts: 1, kind: 'delete' as const, path: '/ext/apps/Games/bounce.fap', appId: 'bounce', name: 'Bounce', urls: [], backup: new Uint8Array(100) }
    setState({
      device: null,
      history: [
        { ...base, id: 'same', version: '1.2', catalogId: cat.id },
        { ...base, id: 'newer', version: '9.0', catalogId: cat.id },
        { ...base, id: 'unknown', version: '1.0' },
      ],
    })
    expect(catalogFor(getState().history[0])).toBe(cat)
    const r = await reclaimSpace()
    expect(r).toMatchObject({ entries: 1, bytes: 100 })
    const byId = new Map(getState().history.map((h) => [h.id, h]))
    expect(byId.get('same')).toMatchObject({ backup: undefined, reinstallFromCatalog: true })
    expect(byId.get('newer')?.backup).toBeDefined()
    expect(byId.get('unknown')?.backup).toBeDefined()
  })
})

describe('catalog installs match Flipper Lab', () => {
  it('lists every .fim, flags updates like Lab and skips manifests Lab ignores', async () => {
    const { catalogInstalls } = await import('../lib/analyze')
    const withIcon = (f: ReturnType<typeof fim>) => ({ ...f, iconBase64: 'aWNvbg==' })
    const upToDate = withIcon(fim('v2-id', '87.1'))
    const older = { ...withIcon(fim('v1-id', '87.1')), file: 'b.fim' }
    const otherApi = { ...withIcon(fim('v2-id', '86.0')), file: 'c.fim' }
    const noIcon = { ...fim('v1-id', '87.1'), file: 'd.fim' }
    const dev = { ...withIcon(fim('v1-id', '87.1')), file: 'e.fim', devCatalog: true }
    const list = catalogInstalls([upToDate, older, otherApi, noIcon, dev], [], new Map([[cat.id, cat]]), device)
    expect(list.map((i) => [i.fim.file, i.updateAvailable, !!i.hiddenInLab])).toEqual([
      ['bounce.fim', false, false],
      ['b.fim', true, false], // newer version, even though no file was scanned
      ['c.fim', true, false], // built for another API
      ['d.fim', false, true], // Lab skips a .fim without an icon
      ['e.fim', false, true], // development catalog
    ])
  })

  it('treats a .fim on a firmware-listed path as a catalog install', () => {
    const info = parseFap(buildFap({ name: 'Nfc Magic', apiMajor: 87, apiMinor: 1 }))
    const r = buildRecord({ path: '/ext/apps/Games/bounce.fap', size: 1 }, info, {
      device,
      systemPaths: new Map([['/ext/apps/games/bounce.fap', '']]),
      official: null,
      fims: [fim('v2-id', '87.1')],
      catalog: null,
      catalogByName: null,
      catalogById: new Map([[cat.id, cat]]),
    })
    expect(r.origin).toBe('market')
  })
})

describe('replace validates before downloading', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('recognises the same app by hash or by version and API', async () => {
    const { sameAsCatalog } = await import('../lib/analyze')
    const { sha256Hex } = await import('../lib/fap')
    const bytes = buildFap({ name: 'Bounce', apiMajor: 87, apiMinor: 1, versionMajor: 1, versionMinor: 0 })
    const hashed = { ...cat, fapHash: await sha256Hex(bytes) }
    const ctx = { device, systemPaths: new Map(), official: null, fims: [], catalog: new Map([['bounce', hashed]]), catalogByName: null, catalogById: null }
    const info = { ...parseFap(bytes), sha256: await sha256Hex(bytes) }
    expect(sameAsCatalog(buildRecord({ path: '/ext/apps/Games/bounce.fap', size: 1 }, info, ctx))).toEqual({ same: true, how: 'hash' })
    const sameVersion = parseFap(buildFap({ name: 'Bounce', apiMajor: 87, apiMinor: 1, versionMajor: 1, versionMinor: 2 }))
    expect(sameAsCatalog(buildRecord({ path: '/ext/apps/Games/bounce.fap', size: 1 }, sameVersion, { ...ctx, catalog: new Map([['bounce', cat]]) }))).toEqual({
      same: true,
      how: 'version',
    })
    const older = parseFap(buildFap({ name: 'Bounce', apiMajor: 86, apiMinor: 0, versionMajor: 1, versionMinor: 0 }))
    expect(sameAsCatalog(buildRecord({ path: '/ext/apps/Games/bounce.fap', size: 1 }, older, { ...ctx, catalog: new Map([['bounce', cat]]) })).same).toBe(false)
  })

  it('links an identical sideloaded copy instead of replacing it', async () => {
    const { sha256Hex } = await import('../lib/fap')
    const path = '/ext/apps/Downloads/bounce.fap'
    const bytes = buildFap({ name: 'Bounce', apiMajor: 87, apiMinor: 1, versionMajor: 1, versionMinor: 2 })
    const hashed = { ...cat, fapHash: await sha256Hex(bytes) }
    const files = new Map<string, Uint8Array>([[path, bytes]])
    const writes: string[] = []
    const removed: string[] = []
    const d: FlipperDevice = {
      kind: 'serial',
      info: async () => device,
      list: async () => [],
      stat: async () => null,
      timestamp: async () => null,
      read: async (p) => files.get(p) ?? new Uint8Array(),
      write: async (p, data) => void (writes.push(p), files.set(p, data)),
      remove: async (p) => void removed.push(p),
      mkdir: async () => {},
      rename: async () => {},
      close: async () => {},
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/build/compatible')) throw new Error('must not download')
      return new Response(new Uint8Array([1, 2, 3]).buffer)
    })
    vi.stubGlobal('fetch', fetchMock)
    // Scanned without a hash, as the fast scan or an old cache would leave it.
    const info = parseFap(bytes)
    const ctx = { device, systemPaths: new Map(), official: null, fims: [], catalog: new Map([['bounce', hashed]]), catalogByName: null, catalogById: new Map([[cat.id, hashed]]) }
    setState({
      device: d,
      deviceInfo: device,
      op: null,
      scanned: [{ path, size: bytes.length, info }],
      apps: [buildRecord({ path, size: bytes.length }, info, ctx)],
      fims: [],
      catalog: { ...getState().catalog, status: 'ready', apps: [hashed], byAlias: new Map([['bounce', hashed]]), byId: new Map([[cat.id, hashed]]), categories: new Map([['games-id', 'Games']]) },
    })
    expect(await installFromCatalog(hashed, path)).toBe(true)
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/build/compatible'))).toBe(false)
    expect(writes).toEqual(['/ext/apps_manifests/bounce.fim'])
    expect(removed).toEqual([])
    const fimText = new TextDecoder().decode(files.get('/ext/apps_manifests/bounce.fim'))
    expect(parseFim(fimText, 'bounce.fim')).toMatchObject({ versionUid: 'v2-id', buildApi: '87.1', path })
    const s = getState()
    expect(s.apps[0]).toMatchObject({ path, origin: 'market', updateAvailable: false })
    expect(s.catalogInstalls[0]).toMatchObject({ updateAvailable: false })
  })
})
