import type { DeviceInfo } from '../flipper/types'
import type { CatalogApp } from './catalog'
import { compareVersions } from './catalog'
import type { FapInfo, FapManifest } from './fap'
import type { Fim } from './manifests'
import { APPS_ROOT, basename, dirname } from './manifests'

export type Compat = 'ok' | 'too-old' | 'too-new' | 'newer-minor' | 'target' | 'unknown'
export type Origin = 'system' | 'market' | 'sideloaded'

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

export const isOutdated = (c: Compat) => c === 'too-old' || c === 'too-new' || c === 'target'

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
  fims: Fim[]
  catalog: Map<string, CatalogApp> | null
  catalogByName: Map<string, CatalogApp> | null
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
  const origin: Origin = ctx.systemPaths.has(lower) ? 'system' : fim ? 'market' : 'sideloaded'
  const version = m ? `${m.versionMajor}.${m.versionMinor}` : ''
  const catalog = ctx.catalog?.get(appId.toLowerCase()) ?? ctx.catalogByName?.get(normalizeName(name))
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
    updateAvailable: !!(catalog && version && compareVersions(catalog.version, version) > 0),
  }
}

const ORIGIN_RANK: Record<Origin, number> = { system: 0, market: 1, sideloaded: 2 }
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
