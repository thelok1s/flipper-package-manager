import { createStore, del, entries, get, set, values } from 'idb-keyval'
import type { FapInfo } from './fap'

// idb-keyval keeps one object store per database, so each concern gets its own database.
const historyStore = createStore('fpm-history', 'entries')
const cacheStore = createStore('fpm-fap-cache', 'entries')
const notesStore = createStore('fpm-notes', 'entries')

export type HistoryKind = 'delete' | 'move' | 'replace' | 'install' | 'restore' | 'mkdir'

export interface HistoryEntry {
  id: string
  ts: number
  kind: HistoryKind
  path: string
  toPath?: string
  appId: string
  name: string
  version?: string
  api?: string
  iconPixels?: boolean[] | null
  urls: string[]
  labAlias?: string
  /** Original .fap bytes, kept for deletes and replacements so they can be restored offline. */
  backup?: Uint8Array
  restoredAt?: number
  /** Text of the market .fim manifest, so a deleted market app can be restored as managed. */
  fimText?: string
}

export const history = {
  all: async () => (await values<HistoryEntry>(historyStore)).sort((a, b) => b.ts - a.ts),
  put: (e: HistoryEntry) => set(e.id, e, historyStore),
  remove: (id: string) => del(id, historyStore),
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Parsed .fap results keyed by path + size + modified time, so rescans only read changed files. */
export const fapCache = {
  key: (path: string, size: number, stamp?: string | number | null) => `${path.toLowerCase()}|${size}|${stamp ?? ''}`,
  get: (key: string) => get<FapInfo>(key, cacheStore),
  put: (key: string, info: FapInfo) => set(key, info, cacheStore),
}

/** Per-app source links the user typed in, keyed by app id. */
export const sourceNotes = {
  get: (appId: string) => get<string>(appId, notesStore),
  put: (appId: string, url: string) => (url ? set(appId, url, notesStore) : del(appId, notesStore)),
  all: async () => new Map(await entries<string, string>(notesStore)),
}
