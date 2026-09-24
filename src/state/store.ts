import { useSyncExternalStore } from 'react'
import type { DeviceInfo, FlipperDevice } from '../flipper/types'
import { emptyFilters, type AppRecord, type Filters, type SortKey } from '../lib/analyze'
import type { CatalogApp } from '../lib/catalog'
import type { HistoryEntry } from '../lib/db'
import type { FapInfo } from '../lib/fap'
import type { Fim } from '../lib/manifests'

export interface ScannedFile {
  path: string
  size: number
  md5?: string
  mtime?: number | null
  info: FapInfo
}

/** A .fap found while listing whose manifest has not been read yet. */
export interface PendingFile {
  path: string
  size: number
}

export interface ScanProgress {
  phase: string
  done: number
  total: number
  current?: string
  bytesDone?: number
  bytesTotal?: number
  /** Seconds left for the reading phase, once there is enough data to estimate. */
  etaSec?: number
}

export type Tab = 'apps' | 'folders' | 'duplicates' | 'history'
export type ViewMode = 'grid' | 'list' | 'grouped'
export type Theme = 'system' | 'light' | 'dark'

export interface Prefs {
  view: ViewMode
  sort: SortKey
  sortDir: 1 | -1
  protectSystem: boolean
  /** Skip top-level folders in /ext/apps that don't start with a capital letter. */
  onlyCapitalFolders: boolean
  /** Parse manifests on the Flipper with its JS engine when available. */
  fastScan: boolean
  theme: Theme
}

export interface Toast {
  id: number
  tone: 'info' | 'success' | 'error'
  text: string
}

export interface State {
  device: FlipperDevice | null
  deviceInfo: DeviceInfo | null
  status: 'disconnected' | 'connecting' | 'scanning' | 'ready'
  error: string | null
  scan: ScanProgress | null
  scanned: ScannedFile[]
  pending: PendingFile[]
  folders: string[]
  systemPaths: Map<string, string>
  fims: Fim[]
  apps: AppRecord[]
  duplicates: Map<string, AppRecord[]>
  catalog: {
    status: 'idle' | 'loading' | 'ready' | 'error'
    error?: string
    byAlias: Map<string, CatalogApp>
    byName: Map<string, CatalogApp>
    categories: Map<string, string>
  }
  official: {
    status: 'idle' | 'loading' | 'ready' | 'error'
    version?: string
    error?: string
    paths: Set<string>
    fileNames: Set<string>
  }
  /** Session-only: official apps can be deleted or moved. Never persisted. */
  allowOfficialRemoval: boolean
  /** Whether the connected Flipper can run the JS fast scan; reset on every connection. */
  jsScan: 'unknown' | 'available' | 'unavailable'
  history: HistoryEntry[]
  notes: Map<string, string>
  op: { label: string; done: number; total: number } | null
  toasts: Toast[]
  selected: string | null
  checked: Set<string>
  tab: Tab
  explorerFolder: string
  prefs: Prefs
  filters: Filters
}

const PREFS_KEY = 'fpm.prefs.v1'
const FILTERS_KEY = 'fpm.filters.v1'
const defaultPrefs: Prefs = { view: 'grid', sort: 'name', sortDir: 1, protectSystem: true, onlyCapitalFolders: true, fastScan: true, theme: 'system' }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

const ORIGINS = ['official', 'firmware', 'market', 'sideloaded']

/** Drops stored values from older versions, e.g. the former 'system' origin. */
function sanitizeFilters(f: Filters): Filters {
  const origins = f.origins.map((o) => ((o as string) === 'system' ? 'firmware' : o)).filter((o) => ORIGINS.includes(o))
  return { ...f, query: '', origins: [...new Set(origins)] }
}

let state: State = {
  device: null,
  deviceInfo: null,
  status: 'disconnected',
  error: null,
  scan: null,
  scanned: [],
  pending: [],
  folders: [],
  systemPaths: new Map(),
  fims: [],
  apps: [],
  duplicates: new Map(),
  catalog: { status: 'idle', byAlias: new Map(), byName: new Map(), categories: new Map() },
  official: { status: 'idle', paths: new Set(), fileNames: new Set() },
  allowOfficialRemoval: false,
  jsScan: 'unknown',
  history: [],
  notes: new Map(),
  op: null,
  toasts: [],
  selected: null,
  checked: new Set(),
  tab: 'apps',
  explorerFolder: '',
  prefs: load(PREFS_KEY, defaultPrefs),
  filters: sanitizeFilters(load(FILTERS_KEY, emptyFilters)),
}

const listeners = new Set<() => void>()

export function getState() {
  return state
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const next = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...next }
  if ('prefs' in next) localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs))
  if ('filters' in next) localStorage.setItem(FILTERS_KEY, JSON.stringify({ ...state.filters, query: '' }))
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

let toastId = 0
export function toast(text: string, tone: Toast['tone'] = 'info') {
  const id = ++toastId
  setState((s) => ({ toasts: [...s.toasts, { id, tone, text }] }))
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 7000 : 4000)
}
