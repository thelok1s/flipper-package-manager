import type { DeviceInfo } from '../flipper/types'
import type { CatalogApp } from './catalog'
import { compareVersions } from './catalog'
import type { FapInfo, FapManifest } from './fap'
import type { Fim } from './manifests'
import { APPS_ROOT, basename, dirname } from './manifests'

export type Compat = 'ok' | 'too-old' | 'too-new' | 'newer-minor' | 'target' | 'unknown'
/**
 * official: ships with official Flipper firmware (per the release resources manifest).
 * firmware: installed by the firmware on this device (its /ext/Manifest), e.g. extras a fork adds.
 * market: installed from the Flipper catalog (has a .fim).
 * sideloaded: anything else.
 */
export type Origin = 'official' | 'firmware' | 'market' | 'sideloaded'

export interface AppRecord {
  path: string
  dir: string
  /** Folder relative to /ext/apps, '' for the root. */
  folder: string
  fileName: string
  /** File name without .fap. Market installs name the file after the catalog alias. */
  appId: string
  size: number
  md5?: string
  info: FapInfo
  name: string
  version: string
  api: string
  compat: Compat
  origin: Origin
  fim?: Fim
  modules: string[]
  catalog?: CatalogApp
  /** How the catalog listing was found: the .fim's UID, the file name (alias) or the manifest name. */
  catalogMatch?: 'fim' | 'alias' | 'name'
  updateAvailable: boolean
  duplicateGroup?: string
  duplicateRank?: number
}

export function checkCompat(m: FapManifest | null, device: DeviceInfo | null): Compat {
  if (!m || !device) return 'unknown'
  if (m.hardwareTarget !== device.target) return 'target'
  // Same rules the firmware applies in flipper_application_manifest_is_too_old / _too_new.
  if (m.apiMajor < device.apiMajor) return 'too-old'
  if (m.apiMajor > device.apiMajor) return 'too-new'
  if (m.apiMinor > device.apiMinor) return 'newer-minor'
  return 'ok'
}

export const COMPAT_LABEL: Record<Compat, string> = {
  ok: 'Compatible',
  'too-old': 'Older API',
  'too-new': 'Newer API',
  'newer-minor': 'Newer API',
  target: 'Other hardware',
  unknown: 'Unreadable',
}

/** Any API or hardware mismatch, as flagged by the red badge. */
export const isOutdated = (c: Compat) => c !== 'ok' && c !== 'unknown'

/** "[LD2450] Motion tracker" -> ["LD2450"]. Community apps tag required add-on boards this way. */
export function moduleTags(name: string): string[] {
  return [...name.matchAll(/\[([^\]]{1,24})\]/g)].map((m) => m[1].trim()).filter(Boolean)
}

export const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]/g, '')

interface BuildContext {
  device: DeviceInfo | null
  systemPaths: Map<string, string>
  official: { paths: Set<string>; fileNames: Set<string> } | null
  fims: Fim[]
  catalog: Map<string, CatalogApp> | null
  catalogByName: Map<string, CatalogApp> | null
  catalogById?: Map<string, CatalogApp> | null
}

/**
 * Catalog installs carry a .fim with the exact version they came from, so they follow the rule
 * lab.flipper.net uses: update when the catalog's latest compatible version differs, or when the
 * build was made for another API. Other apps can only be compared by version number.
 */
function needsUpdate(catalog: CatalogApp, fim: Fim | undefined, byUid: boolean, version: string, device: DeviceInfo | null) {
  if (fim && byUid) {
    const deviceApi = device ? `${device.apiMajor}.${device.apiMinor}` : ''
    return fim.versionUid !== catalog.versionId || (!!deviceApi && !!fim.buildApi && fim.buildApi !== deviceApi)
  }
  return !!version && compareVersions(catalog.version, version) > 0
}

export function buildRecord(
  file: { path: string; size: number; md5?: string },
  info: FapInfo,
  ctx: BuildContext,
): AppRecord {
  const fileName = basename(file.path)
  const appId = fileName.replace(/\.fap$/i, '')
  const dir = dirname(file.path)
  const m = info.manifest
  const name = m?.name || appId
  const lower = file.path.toLowerCase()
  const fim = ctx.fims.find((f) => f.path.toLowerCase() === lower)
  const onDevice = ctx.systemPaths.has(lower)
  // A fork may move an official app to another folder; its firmware manifest still lists it.
  const official = !!ctx.official && (ctx.official.paths.has(lower) || (onDevice && ctx.official.fileNames.has(fileName.toLowerCase())))
  // A .fim means the catalog manages the file now (Lab and the mobile app treat it as installed),
  // even when the firmware originally put a copy at the same path.
  const origin: Origin = official ? 'official' : fim ? 'market' : onDevice ? 'firmware' : 'sideloaded'
  const version = m ? `${m.versionMajor}.${m.versionMinor}` : ''
  const byUid = fim ? ctx.catalogById?.get(fim.uid) : undefined
  const byAlias = byUid ? undefined : ctx.catalog?.get(appId.toLowerCase())
  const byName = byUid || byAlias ? undefined : ctx.catalogByName?.get(normalizeName(name))
  const catalog = byUid ?? byAlias ?? byName
  const catalogMatch = byUid ? 'fim' : byAlias ? 'alias' : byName ? 'name' : undefined
  return {
    path: file.path,
    dir,
    folder: dir === APPS_ROOT ? '' : dir.slice(APPS_ROOT.length + 1),
    fileName,
    appId,
    size: file.size,
    md5: file.md5,
    info,
    name,
    version,
    api: m ? `${m.apiMajor}.${m.apiMinor}` : '',
    compat: checkCompat(m, ctx.device),
    origin,
    fim,
    modules: moduleTags(name),
    catalog,
    catalogMatch,
    updateAvailable: !!catalog && needsUpdate(catalog, fim, !!byUid, version, ctx.device),
  }
}

const ORIGIN_RANK: Record<Origin, number> = { official: 0, firmware: 1, market: 2, sideloaded: 3 }
const COMPAT_RANK: Record<Compat, number> = { ok: 0, 'newer-minor': 1, unknown: 2, target: 3, 'too-new': 3, 'too-old': 4 }

/** Best copy first: loads on this firmware, newest version, managed install, newest API. */
export function compareCopies(a: AppRecord, b: AppRecord) {
  return (
    COMPAT_RANK[a.compat] - COMPAT_RANK[b.compat] ||
    compareVersions(b.version, a.version) ||
    ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] ||
    compareVersions(b.api, a.api) ||
    a.path.localeCompare(b.path)
  )
}

/**
 * Groups copies of the same app across folders. Two files are the same app when they share
 * a file name (app id) or a manifest name, joined transitively.
 */
export function markDuplicates(apps: AppRecord[]): Map<string, AppRecord[]> {
  const parent = apps.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const byKey = new Map<string, number>()
  apps.forEach((a, i) => {
    for (const key of [`id:${a.appId.toLowerCase()}`, `name:${normalizeName(a.name)}`]) {
      if (key.endsWith(':')) continue
      const j = byKey.get(key)
      if (j === undefined) byKey.set(key, i)
      else parent[find(i)] = find(j)
    }
  })
  const groups = new Map<number, AppRecord[]>()
  apps.forEach((a, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), a])
  })
  const result = new Map<string, AppRecord[]>()
  for (const copies of groups.values()) {
    if (copies.length < 2) continue
    copies.sort(compareCopies)
    const id = copies[0].path
    copies.forEach((c, rank) => {
      c.duplicateGroup = id
      c.duplicateRank = rank
    })
    result.set(id, copies)
  }
  return result
}

export type SortKey = 'name' | 'folder' | 'size' | 'version' | 'api' | 'status'

export function sortApps(apps: AppRecord[], key: SortKey, dir: 1 | -1) {
  const cmp: Record<SortKey, (a: AppRecord, b: AppRecord) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    folder: (a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name),
    size: (a, b) => a.size - b.size,
    version: (a, b) => compareVersions(a.version, b.version),
    api: (a, b) => compareVersions(a.api, b.api),
    status: (a, b) => COMPAT_RANK[b.compat] - COMPAT_RANK[a.compat] || a.name.localeCompare(b.name),
  }
  return [...apps].sort((a, b) => cmp[key](a, b) * dir)
}

export interface Filters {
  query: string
  origins: Origin[]
  onlyOutdated: boolean
  onlyDuplicates: boolean
  onlyUpdates: boolean
  hideModuleApps: boolean
  modules: string[]
  folders: string[]
}

export const emptyFilters: Filters = {
  query: '',
  origins: [],
  onlyOutdated: false,
  onlyDuplicates: false,
  onlyUpdates: false,
  hideModuleApps: false,
  modules: [],
  folders: [],
}

export function applyFilters(apps: AppRecord[], f: Filters) {
  const q = f.query.trim().toLowerCase()
  return apps.filter((a) => {
    if (q && !`${a.name} ${a.path} ${a.catalog?.author ?? ''}`.toLowerCase().includes(q)) return false
    if (f.origins.length && !f.origins.includes(a.origin)) return false
    if (f.onlyOutdated && !isOutdated(a.compat)) return false
    if (f.onlyDuplicates && !a.duplicateGroup) return false
    if (f.onlyUpdates && !a.updateAvailable) return false
    if (f.hideModuleApps && a.modules.length) return false
    if (f.modules.length && !a.modules.some((m) => f.modules.includes(m))) return false
    if (f.folders.length && !f.folders.includes(a.folder)) return false
    return true
  })
}

export interface LinkState {
  ok: boolean
  /** Why the app can or cannot be linked, in plain words. */
  reason: string
  /** Version UID to write into the .fim. An older build gets a placeholder so an update is offered. */
  versionUid?: string
}

export const OLDER_THAN_CATALOG = 'fpm-linked-older'

/**
 * Whether a copy on the Flipper can be registered as a catalog install by writing a .fim for it,
 * the way lab.flipper.net would after installing it. `fimNames` are the .fim files already present.
 */
export function linkState(app: AppRecord, fimNames: Set<string>): LinkState {
  const cat = app.catalog
  if (!cat) return { ok: false, reason: 'Not in the catalog' }
  if (app.origin === 'market') return { ok: false, reason: 'Already linked to the catalog' }
  if (app.origin === 'official' || app.origin === 'firmware') return { ok: false, reason: 'Installed by the firmware, which manages it' }
  if (!app.info.manifest) return { ok: false, reason: 'Its manifest could not be read' }
  if (app.compat === 'target') return { ok: false, reason: 'Built for different hardware' }
  if (fimNames.has(`${cat.alias}.fim`.toLowerCase())) return { ok: false, reason: 'Another copy is already linked to this listing' }
  const cmp = compareVersions(app.version, cat.version)
  if (cmp > 0) return { ok: false, reason: `Newer than the catalog (${app.version} vs ${cat.version})` }
  if (cmp < 0) return { ok: true, reason: `Older than the catalog (${app.version} vs ${cat.version}); an update will be offered`, versionUid: OLDER_THAN_CATALOG }
  return { ok: true, reason: `Same version as the catalog (${cat.version})`, versionUid: cat.versionId }
}

/** A catalog install as Flipper Lab and the mobile app see it: one per .fim in /ext/apps_manifests. */
export interface CatalogInstall {
  fim: Fim
  catalog?: CatalogApp
  /** The scanned file at the .fim's path, if the scan found it. */
  app?: AppRecord
  updateAvailable: boolean
  /** Why Lab would not list it, when it would not. */
  hiddenInLab?: string
}

/**
 * Mirrors lab.flipper.net's installed-apps logic (entities/Apps/model/stores.ts): start from the
 * .fim files, look each UID up in the catalog's latest compatible builds, and flag an update when
 * the version UID or the build API differs. Files do not need to exist for Lab to list them.
 */
export function catalogInstalls(fims: Fim[], apps: AppRecord[], byId: Map<string, CatalogApp> | null, device: DeviceInfo | null): CatalogInstall[] {
  const deviceApi = device ? `${device.apiMajor}.${device.apiMinor}` : ''
  const byPath = new Map(apps.map((a) => [a.path.toLowerCase(), a]))
  return fims.map((fim) => {
    const catalog = byId?.get(fim.uid)
    const hiddenInLab = fim.devCatalog
      ? 'Installed from the development catalog'
      : !fim.uid || !fim.versionUid || !fim.fullName || !fim.iconBase64 || !fim.buildApi || !fim.path
        ? 'Its .fim is missing a field (Lab skips incomplete manifests)'
        : undefined
    return {
      fim,
      catalog,
      app: byPath.get(fim.path.toLowerCase()),
      updateAvailable: !!catalog && !hiddenInLab && (fim.versionUid !== catalog.versionId || (!!deviceApi && fim.buildApi !== deviceApi)),
      hiddenInLab,
    }
  })
}
