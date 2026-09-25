import { SerialFlipper } from '../flipper/serial'
import type { FlipperDevice } from '../flipper/types'
import { buildRecord, markDuplicates, normalizeName, type AppRecord } from '../lib/analyze'
import { downloadBuild, fetchCatalog, fetchDetail, fetchIconBase64 } from '../lib/catalog'
import { fapCache, history, newId, sourceNotes, type HistoryEntry } from '../lib/db'
import { parseFap } from '../lib/fap'
import { loadOfficialApps } from '../lib/official'
import { ensureDir, listFaps, runJsScan } from '../lib/scanners'

export { skipTopFolder } from '../lib/scanners'
import {
  APPS_ROOT,
  FIM_DIR,
  RESOURCES_MANIFEST,
  basename,
  buildFim,
  dirname,
  joinPath,
  parseFim,
  parseResourcesManifest,
  type Fim,
} from '../lib/manifests'
import { getState, setState, toast, type PendingFile, type ScannedFile } from './store'

const text = new TextDecoder()
const enc = new TextEncoder()

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function requireDevice(): FlipperDevice {
  const d = getState().device
  if (!d) throw new Error('Connect a Flipper first')
  return d
}

export const folderPath = (folder: string) => (folder ? joinPath(APPS_ROOT, folder) : APPS_ROOT)

/** Rebuilds derived app records after anything they depend on changes. */
function rebuild(patch: Partial<ReturnType<typeof getState>> = {}) {
  setState((s) => {
    const next = { ...s, ...patch }
    const ctx = {
      device: next.deviceInfo,
      systemPaths: next.systemPaths,
      official: next.official.status === 'ready' ? next.official : null,
      fims: next.fims,
      catalog: next.catalog.status === 'ready' ? next.catalog.byAlias : null,
      catalogByName: next.catalog.status === 'ready' ? next.catalog.byName : null,
    }
    const apps = next.scanned.map((f) => buildRecord(f, f.info, ctx))
    const duplicates = markDuplicates(apps)
    const paths = new Set(apps.map((a) => a.path))
    const checked = new Set([...next.checked].filter((p) => paths.has(p)))
    const selected = next.selected && paths.has(next.selected) ? next.selected : null
    return { ...patch, apps, duplicates, checked, selected }
  })
}

export async function loadHistory() {
  const [entries, notes] = await Promise.all([history.all(), sourceNotes.all()])
  setState({ history: entries, notes })
}

export async function connect(silent = false) {
  if (getState().status === 'connecting') return
  setState({ status: 'connecting', error: null })
  try {
    const device: FlipperDevice | null = silent ? await SerialFlipper.reconnect() : await SerialFlipper.request()
    if (!device) {
      setState({ status: 'disconnected' })
      return
    }
    device.onDisconnect = () => {
      setState({ device: null, status: 'disconnected', scan: null, op: null })
      toast('Flipper disconnected', 'error')
    }
    const deviceInfo = await device.info()
    setState({ device, deviceInfo, jsScan: 'unknown', allowOfficialRemoval: false })
    void loadCatalog()
    void loadOfficial(deviceInfo.target)
    await scan()
  } catch (e) {
    const msg = errorText(e)
    // Closing the picker is not an error worth showing.
    const cancelled = /No port selected|NotFoundError/i.test(msg)
    setState({ status: 'disconnected', device: null, error: cancelled ? null : friendlyConnectError(msg) })
  }
}

function friendlyConnectError(msg: string) {
  if (/Failed to open|already open|NetworkError/i.test(msg)) {
    return 'The port is busy. Close qFlipper, lab.flipper.net and any serial terminal, then try again.'
  }
  return msg
}

export async function disconnect() {
  const d = getState().device
  setState({ device: null, deviceInfo: null, status: 'disconnected', scan: null, scanned: [], pending: [], apps: [], duplicates: new Map(), folders: [] })
  await d?.close()
}

export async function loadCatalog(force = false) {
  const { catalog } = getState()
  if (!force && (catalog.status === 'loading' || catalog.status === 'ready')) return
  setState((s) => ({ catalog: { ...s.catalog, status: 'loading', error: undefined } }))
  try {
    const { apps, categories } = await fetchCatalog()
    const byAlias = new Map(apps.map((a) => [a.alias.toLowerCase(), a]))
    const byName = new Map(apps.map((a) => [normalizeName(a.name), a]))
    rebuild({ catalog: { status: 'ready', byAlias, byName, categories: new Map(categories.map((c) => [c.id, c.name])) } })
  } catch (e) {
    setState((s) => ({ catalog: { ...s.catalog, status: 'error', error: errorText(e) } }))
  }
}

async function readFims(d: FlipperDevice): Promise<Fim[]> {
  const entries = await d.list(FIM_DIR).catch(() => [])
  const fims: Fim[] = []
  for (const e of entries) {
    if (e.type !== 'file' || !e.name.endsWith('.fim')) continue
    try {
      fims.push(parseFim(text.decode(await d.read(joinPath(FIM_DIR, e.name))), e.name))
    } catch {
      /* unreadable manifest, ignore */
    }
  }
  return fims
}

/** How often the app list re-renders while apps stream in. Rendering competes with serial reads. */
const FLUSH_MS = 1000

/** Consecutive unreadable files before the scan stops instead of hammering a struggling device. */
const MAX_FAILURES_IN_A_ROW = 3

export async function scan() {
  const d = requireDevice()
  setState({ status: 'scanning', pending: [], scan: { phase: 'Reading firmware resource list', done: 0, total: 0 } })
  const scanned: ScannedFile[] = []
  let pending: PendingFile[] = []
  let lastFlush = 0
  // Re-render at most a few times a second while apps stream in.
  const flush = (force = false) => {
    if (!force && Date.now() - lastFlush < FLUSH_MS) return
    lastFlush = Date.now()
    rebuild({ scanned: [...scanned], pending })
  }

  try {
    let systemPaths = new Map<string, string>()
    try {
      systemPaths = parseResourcesManifest(text.decode(await d.read(RESOURCES_MANIFEST)))
    } catch {
      toast('No /ext/Manifest found, so system apps cannot be identified', 'info')
    }

    setState({ scan: { phase: 'Reading catalog install manifests', done: 0, total: 0 } })
    const fims = await readFims(d)

    const onlyCapital = getState().prefs.onlyCapitalFolders

    // Fast path: let the Flipper parse manifests itself with its JS engine.
    const s0 = getState()
    if (s0.prefs.scanMethod === 'js' && d.runCli && s0.jsScan !== 'unavailable') {
      setState({ scan: { phase: 'Starting fast scan on the Flipper', done: 0, total: 0 } })
      // Seed the context now so streamed apps are classified correctly.
      rebuild({ systemPaths, fims })
      try {
        const fast = await runJsScan(d, {
          onlyCapital,
          onFile: (f) => {
            scanned.push(f)
            setState({ scan: { phase: 'Fast scan on the Flipper', done: scanned.length, total: 0, current: f.path } })
            flush()
          },
        })
        if (fast.unlisted.length) toast(`Could not list ${fast.unlisted.join(', ')}. Scan again to retry.`, 'error')
        setState({ jsScan: 'available' })
        rebuild({ scanned, pending: [], folders: fast.folders, systemPaths, fims, status: 'ready', scan: null })
        return
      } catch (e) {
        if (!getState().device) throw e
        // Remember for this connection so later rescans go straight to the standard scan.
        setState({ jsScan: 'unavailable' })
        toast(`Fast scan unavailable: ${errorText(e)}. Using the standard scan.`, 'info')
        scanned.length = 0
      }
    }

    // Phase 1: list every folder. Cheap, and gives the full file count up front.
    setState({ scan: { phase: 'Listing folders', done: 0, total: 0 } })
    const listed = await listFaps(d, {
      onlyCapital,
      onDir: (p) => setState({ scan: { phase: 'Listing folders', done: 0, total: 0, current: p } }),
    })
    const { files, folders, unlisted } = listed
    if (unlisted.length) toast(`Could not list ${unlisted.join(', ')}. Scan again to retry.`, 'error')
    pending = files
    rebuild({ scanned: [], pending, folders, systemPaths, fims })

    // Phase 2: reuse cached manifests for files that have not changed.
    let hasTimestamps = true
    const toRead: (PendingFile & { key: string; mtime: number | null })[] = []
    for (const [i, f] of files.entries()) {
      setState({ scan: { phase: 'Checking for changes', done: i, total: files.length, current: f.path } })
      const mtime = hasTimestamps ? await d.timestamp(f.path).catch(() => null) : null
      if (mtime === null) hasTimestamps = false
      const key = fapCache.key(f.path, f.size, mtime)
      const info = await fapCache.get(key).catch(() => undefined)
      if (info) {
        scanned.push({ ...f, mtime, info })
        pending = pending.filter((p) => p.path !== f.path)
        flush()
      } else {
        toRead.push({ ...f, key, mtime })
      }
    }
    flush(true)

    // Phase 3: read the rest. RPC has no partial reads, so each .fap comes over whole.
    const bytesTotal = toRead.reduce((s, f) => s + f.size, 0)
    let bytesDone = 0
    const started = Date.now()
    let lastProgress = 0
    const progress = (i: number, f: PendingFile, inFile: number) => {
      if (Date.now() - lastProgress < 300 && inFile) return
      lastProgress = Date.now()
      const done = bytesDone + inFile
      const elapsed = (Date.now() - started) / 1000
      const etaSec = elapsed > 2 && done > 0 ? Math.round(((bytesTotal - done) / done) * elapsed) : undefined
      setState({
        scan: { phase: 'Reading apps', done: i, total: toRead.length, current: f.path, bytesDone: done, bytesTotal, etaSec },
      })
    }
    let failuresInARow = 0
    for (const [i, f] of toRead.entries()) {
      progress(i, f, 0)
      let info
      for (let attempt = 0; !info; attempt++) {
        try {
          info = parseFap(await d.read(f.path, (n) => progress(i, f, n), f.size))
          await fapCache.put(f.key, info).catch(() => undefined)
          failuresInARow = 0
        } catch (e) {
          if (!getState().device) throw e
          // One retry: the transport waits for the line to go quiet before sending it.
          if (attempt === 0) continue
          info = { manifest: null, urls: [], sections: [], error: `Could not read: ${errorText(e)}` }
          if (++failuresInARow >= MAX_FAILURES_IN_A_ROW) {
            throw new Error(`the Flipper stopped answering after ${scanned.length} apps. Reconnect it and scan again; apps already read are cached`)
          }
        }
      }
      bytesDone += f.size
      scanned.push({ path: f.path, size: f.size, mtime: f.mtime, info })
      pending = pending.filter((p) => p.path !== f.path)
      flush()
    }
    rebuild({ scanned, pending: [], status: 'ready', scan: null })
  } catch (e) {
    // Keep whatever was read before the failure.
    rebuild({ scanned, pending: [], status: getState().device ? 'ready' : 'disconnected', scan: null })
    toast(`Scan stopped: ${errorText(e)}`, 'error')
  }
}

export async function loadOfficial(target: number) {
  setState((s) => ({ official: { ...s.official, status: 'loading', error: undefined } }))
  try {
    const o = await loadOfficialApps(target)
    rebuild({ official: { status: 'ready', version: o.version, paths: new Set(o.paths), fileNames: new Set(o.fileNames) } })
  } catch (e) {
    setState((s) => ({ official: { ...s.official, status: 'error', error: errorText(e) } }))
  }
}

/** Official apps need the session-only override; firmware apps follow the sidebar switch. */
export function isProtected(app: AppRecord) {
  const s = getState()
  if (app.origin === 'official') return !s.allowOfficialRemoval
  return app.origin === 'firmware' && s.prefs.protectSystem
}

async function record(entry: Omit<HistoryEntry, 'id' | 'ts'>) {
  const full: HistoryEntry = { ...entry, id: newId(), ts: Date.now() }
  await history.put(full)
  setState((s) => ({ history: [full, ...s.history] }))
  return full
}

function snapshot(app: AppRecord) {
  return {
    appId: app.appId,
    name: app.name,
    version: app.version,
    api: app.api,
    iconPixels: app.info.manifest?.icon ?? null,
    urls: [getState().notes.get(app.appId), ...app.info.urls].filter((u): u is string => !!u),
    labAlias: app.catalog?.alias,
  }
}

async function withOp<T>(label: string, total: number, fn: (step: (label?: string) => void) => Promise<T>) {
  let done = 0
  setState({ op: { label, done, total } })
  try {
    return await fn((l) => setState({ op: { label: l ?? label, done: ++done, total } }))
  } finally {
    setState({ op: null })
  }
}

export async function deleteApps(paths: string[]) {
  const d = requireDevice()
  const apps = getState().apps.filter((a) => paths.includes(a.path))
  const allowed = apps.filter((a) => !isProtected(a))
  const skipped = apps.length - allowed.length
  let removed = 0
  await withOp(`Deleting ${allowed.length} app${allowed.length === 1 ? '' : 's'}`, allowed.length, async (step) => {
    for (const app of allowed) {
      try {
        // Keep the binary so the app can be restored even without the original source.
        const backup = await d.read(app.path)
        let fimText: string | undefined
        if (app.fim) {
          const fimPath = joinPath(FIM_DIR, app.fim.file)
          fimText = text.decode(await d.read(fimPath).catch(() => new Uint8Array()))
          await d.remove(fimPath).catch(() => undefined)
        }
        await d.remove(app.path)
        await record({ kind: 'delete', path: app.path, ...snapshot(app), backup, fimText })
        removed++
        rebuild({
          scanned: getState().scanned.filter((f) => f.path !== app.path),
          fims: getState().fims.filter((f) => f !== app.fim),
        })
      } catch (e) {
        toast(`Could not delete ${app.name}: ${errorText(e)}`, 'error')
      }
      step(`Deleted ${app.name}`)
    }
  })
  if (removed) toast(removed === 1 ? 'Deleted 1 app. You can restore it from History.' : `Deleted ${removed} apps. You can restore them from History.`, 'success')
  if (skipped) toast(`${skipped} protected app${skipped === 1 ? ' was' : 's were'} skipped. Change protection in the sidebar.`, 'info')
}

export async function moveApps(paths: string[], folder: string) {
  const d = requireDevice()
  const target = folderPath(folder)
  const apps = getState().apps.filter((a) => paths.includes(a.path) && a.dir !== target)
  const blocked = apps.filter(isProtected)
  if (blocked.length) toast(`Protected apps stay where the firmware put them (${blocked.map((a) => a.name).join(', ')})`, 'info')
  const movable = apps.filter((a) => !isProtected(a))
  for (const app of movable) {
    const to = joinPath(target, app.fileName)
    if (getState().scanned.some((f) => f.path.toLowerCase() === to.toLowerCase())) {
      toast(`${folder || 'apps'} already has ${app.fileName}`, 'error')
      continue
    }
    try {
      await d.rename(app.path, to)
      let fims = getState().fims
      if (app.fim) {
        // Keep the market manifest pointing at the new location so updates keep working.
        const fimPath = joinPath(FIM_DIR, app.fim.file)
        const raw = text.decode(await d.read(fimPath))
        await d.write(fimPath, enc.encode(raw.replace(/^Path: .*$/m, `Path: ${to}`)))
        fims = fims.map((f) => (f === app.fim ? { ...f, path: to } : f))
      }
      await record({ kind: 'move', path: app.path, toPath: to, ...snapshot(app) })
      const selected = getState().selected === app.path ? to : getState().selected
      rebuild({
        scanned: getState().scanned.map((f) => (f.path === app.path ? { ...f, path: to } : f)),
        fims,
        selected,
      })
    } catch (e) {
      toast(`Could not move ${app.name}: ${errorText(e)}`, 'error')
    }
  }
  if (movable.length) toast(`Moved ${movable.length === 1 ? movable[0].name : `${movable.length} apps`} to ${folder || 'apps'}`, 'success')
}

export async function createFolder(parent: string, name: string) {
  const d = requireDevice()
  const clean = name.trim().replace(/[\\/:*?"<>|]/g, '')
  if (!clean) return
  const rel = parent ? `${parent}/${clean}` : clean
  if (getState().folders.includes(rel)) {
    toast(`${rel} already exists`, 'error')
    return
  }
  try {
    await d.mkdir(folderPath(rel))
    setState((s) => ({ folders: [...s.folders, rel].sort((a, b) => a.localeCompare(b)) }))
  } catch (e) {
    toast(`Could not create folder: ${errorText(e)}`, 'error')
  }
}

export async function removeFolder(folder: string) {
  const d = requireDevice()
  try {
    await d.remove(folderPath(folder))
    setState((s) => ({ folders: s.folders.filter((f) => f !== folder), explorerFolder: s.explorerFolder === folder ? dirname('/' + folder).slice(1) : s.explorerFolder }))
  } catch (e) {
    toast(`Folder is not empty or could not be removed: ${errorText(e)}`, 'error')
  }
}

/** Reads a whole .fap for the parts the fast scan skips (embedded web links). */
export async function loadFullInfo(path: string) {
  const d = getState().device
  const entry = getState().scanned.find((f) => f.path === path)
  if (!d || !entry?.info.partial) return
  try {
    const info = parseFap(await d.read(path))
    rebuild({ scanned: getState().scanned.map((f) => (f.path === path ? { ...f, info } : f)) })
  } catch {
    rebuild({ scanned: getState().scanned.map((f) => (f.path === path ? { ...f, info: { ...f.info, partial: false } } : f)) })
  }
}


export async function restore(entry: HistoryEntry) {
  const d = requireDevice()
  if (!entry.backup) {
    toast('No backup stored for this entry. Use the source links instead.', 'info')
    return
  }
  const backup = entry.backup
  const path = entry.path
  await withOp(`Restoring ${entry.name}`, backup.length, async () => {
    try {
      await ensureDir(d, dirname(path))
      await d.write(path, backup, (done, total) => setState({ op: { label: `Restoring ${entry.name}`, done, total } }))
      let fims = getState().fims
      if (entry.kind === 'delete' && entry.fimText?.startsWith('Filetype: Flipper Application Installation Manifest')) {
        const fim = parseFim(entry.fimText, `${basename(path).replace(/\.fap$/i, '')}.fim`)
        await ensureDir(d, FIM_DIR)
        await d.write(joinPath(FIM_DIR, fim.file), enc.encode(entry.fimText))
        fims = [...fims.filter((f) => f.file !== fim.file), fim]
      }
      const updated: HistoryEntry = { ...entry, restoredAt: Date.now() }
      await history.put(updated)
      setState((s) => ({ history: s.history.map((h) => (h.id === entry.id ? updated : h)) }))
      await record({ kind: 'restore', path, appId: entry.appId, name: entry.name, version: entry.version, api: entry.api, iconPixels: entry.iconPixels, urls: entry.urls, labAlias: entry.labAlias })
      const info = parseFap(backup)
      const folder = dirname(path).slice(APPS_ROOT.length + 1)
      rebuild({
        scanned: [...getState().scanned.filter((f) => f.path !== path), { path, size: backup.length, info }],
        fims,
        folders: getState().folders.includes(folder) ? getState().folders : [...getState().folders, folder].sort(),
      })
      toast(`Restored ${entry.name}`, 'success')
    } catch (e) {
      toast(`Restore failed: ${errorText(e)}`, 'error')
    }
  })
}

export async function forgetHistory(entry: HistoryEntry) {
  await history.remove(entry.id)
  setState((s) => ({ history: s.history.filter((h) => h.id !== entry.id) }))
}

/**
 * Swaps a sideloaded .fap for the catalog build that matches this firmware, installed the way
 * lab.flipper.net does it: /ext/apps/<Category>/<alias>.fap plus a .fim manifest.
 */
export async function replaceWithMarket(path: string) {
  const d = requireDevice()
  const s = getState()
  const app = s.apps.find((a) => a.path === path)
  const info = s.deviceInfo
  if (!app?.catalog || !info) return
  const cat = app.catalog
  const category = s.catalog.categories.get(cat.categoryId) ?? 'Tools'
  const target = `${APPS_ROOT}/${category}/${cat.alias}.fap`
  const api = `${info.apiMajor}.${info.apiMinor}`
  await withOp(`Installing ${cat.name} from the catalog`, 1, async () => {
    try {
      const [build, iconBase64, backup] = await Promise.all([
        downloadBuild(cat.versionId, info.target, api),
        fetchIconBase64(cat.iconUri).catch(() => ''),
        d.read(path),
      ])
      await ensureDir(d, dirname(target))
      await ensureDir(d, FIM_DIR)
      await d.write(target, build, (done, total) => setState({ op: { label: `Writing ${cat.name}`, done, total } }))
      const fimText = buildFim({ name: cat.name, iconBase64, api, uid: cat.id, versionUid: cat.versionId, path: target })
      await d.write(joinPath(FIM_DIR, `${cat.alias}.fim`), enc.encode(fimText))
      if (target.toLowerCase() !== path.toLowerCase()) await d.remove(path)
      await record({ kind: 'replace', path, toPath: target, ...snapshot(app), backup })
      const fim = parseFim(fimText, `${cat.alias}.fim`)
      const folder = dirname(target).slice(APPS_ROOT.length + 1)
      rebuild({
        scanned: [
          ...getState().scanned.filter((f) => f.path !== path && f.path.toLowerCase() !== target.toLowerCase()),
          { path: target, size: build.length, info: parseFap(build) },
        ],
        fims: [...getState().fims.filter((f) => f.file !== fim.file), fim],
        folders: getState().folders.includes(folder) ? getState().folders : [...getState().folders, folder].sort(),
        selected: target,
      })
      toast(`${cat.name} is now managed by the Flipper catalog`, 'success')
    } catch (e) {
      toast(`Could not install from the catalog: ${errorText(e)}`, 'error')
    }
  })
}

export async function setSourceNote(appId: string, url: string) {
  await sourceNotes.put(appId, url.trim())
  setState((s) => {
    const notes = new Map(s.notes)
    if (url.trim()) notes.set(appId, url.trim())
    else notes.delete(appId)
    return { notes }
  })
}

export async function resolveCatalogSource(alias: string) {
  try {
    return await fetchDetail(alias)
  } catch {
    return null
  }
}
