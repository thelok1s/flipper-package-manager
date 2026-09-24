import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  FolderSimpleIcon,
  ListBulletsIcon,
  RowsIcon,
  SquaresFourIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { useMemo, type MouseEvent } from 'react'
import { applyFilters, sortApps, type AppRecord, type SortKey } from '../lib/analyze'
import { deleteApps, isProtected, moveApps } from '../state/actions'
import { getState, setState, useStore, type ViewMode } from '../state/store'
import { AppBadges } from './AppBadges'
import { AppIcon } from './AppIcon'
import { ask } from './Confirm'
import { Button, IconButton, formatEta, formatSize } from './ui'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'folder', label: 'Folder' },
  { id: 'status', label: 'Compatibility' },
  { id: 'version', label: 'App version' },
  { id: 'api', label: 'API version' },
  { id: 'size', label: 'Size' },
]

const VIEWS: { id: ViewMode; label: string; icon: typeof RowsIcon }[] = [
  { id: 'grid', label: 'Icons', icon: SquaresFourIcon },
  { id: 'list', label: 'Details', icon: ListBulletsIcon },
  { id: 'grouped', label: 'By folder', icon: RowsIcon },
]

export async function confirmDelete(paths: string[]) {
  const apps = getState().apps.filter((a) => paths.includes(a.path))
  const protectedCount = apps.filter(isProtected).length
  const n = apps.length - protectedCount
  if (!n) {
    await ask({ title: 'Nothing to delete', body: 'These are protected system apps. Turn off protection in the sidebar first.', confirmLabel: 'OK' })
    return
  }
  const ok = await ask({
    title: n === 1 ? `Delete ${apps.find((a) => !isProtected(a))!.name}?` : `Delete ${n} apps?`,
    body: (
      <>
        A copy of each .fap is kept in this browser, so you can restore it from History.
        {protectedCount > 0 && ` ${protectedCount} protected system app${protectedCount === 1 ? '' : 's'} will be skipped.`}
      </>
    ),
    confirmLabel: 'Delete',
    tone: 'danger',
  })
  if (ok) await deleteApps(paths)
}

function useToggleCheck() {
  return (path: string, e?: MouseEvent) => {
    e?.stopPropagation()
    setState((s) => {
      const checked = new Set(s.checked)
      if (checked.has(path)) checked.delete(path)
      else checked.add(path)
      return { checked }
    })
  }
}

function Checkbox({ checked, onClick, label }: { checked: boolean; onClick: (e: MouseEvent) => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={`grid size-5 place-items-center rounded-md border transition-colors ${
        checked ? 'border-accent bg-accent text-[#1b1206]' : 'border-line bg-surface text-transparent hover:border-muted'
      }`}
    >
      <CheckIcon size={12} weight="bold" aria-hidden />
    </button>
  )
}

function Toolbar({ shown, total }: { shown: AppRecord[]; total: number }) {
  const prefs = useStore((s) => s.prefs)
  const checked = useStore((s) => s.checked)
  const folders = useStore((s) => s.folders)
  const setPrefs = (p: Partial<typeof prefs>) => setState((s) => ({ prefs: { ...s.prefs, ...p } }))
  const allChecked = shown.length > 0 && shown.every((a) => checked.has(a.path))

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
      <Checkbox
        checked={allChecked}
        label={allChecked ? 'Clear selection' : 'Select all shown'}
        onClick={() => setState({ checked: allChecked ? new Set() : new Set(shown.map((a) => a.path)) })}
      />
      {checked.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink">{checked.size} selected</span>
          <label className="sr-only" htmlFor="bulk-move">
            Move selected to folder
          </label>
          <select
            id="bulk-move"
            value=""
            onChange={(e) => e.target.value !== '' && moveApps([...checked], e.target.value === '.' ? '' : e.target.value)}
            className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink"
          >
            <option value="">Move to…</option>
            {folders.map((f) => (
              <option key={f || '.'} value={f || '.'}>
                {f || 'apps root'}
              </option>
            ))}
          </select>
          <Button size="sm" tone="danger" icon={TrashIcon} onClick={() => confirmDelete([...checked])}>
            Delete
          </Button>
          <Button size="sm" tone="ghost" onClick={() => setState({ checked: new Set() })}>
            Clear
          </Button>
        </div>
      ) : (
        <span className="text-sm text-muted">
          <span className="font-mono text-ink">{shown.length}</span> of {total} apps
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <label htmlFor="sort" className="sr-only">
          Sort by
        </label>
        <select
          id="sort"
          value={prefs.sort}
          onChange={(e) => setPrefs({ sort: e.target.value as SortKey })}
          className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <IconButton
          icon={prefs.sortDir === 1 ? ArrowUpIcon : ArrowDownIcon}
          label={prefs.sortDir === 1 ? 'Ascending' : 'Descending'}
          onClick={() => setPrefs({ sortDir: prefs.sortDir === 1 ? -1 : 1 })}
        />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {VIEWS.map((v) => (
          <IconButton key={v.id} icon={v.icon} label={v.label} active={prefs.view === v.id} onClick={() => setPrefs({ view: v.id })} />
        ))}
      </div>
    </div>
  )
}

function GridItem({ app, index }: { app: AppRecord; index: number }) {
  const selected = useStore((s) => s.selected === app.path)
  const isChecked = useStore((s) => s.checked.has(app.path))
  const api = useStore((s) => (s.deviceInfo ? `${s.deviceInfo.apiMajor}.${s.deviceInfo.apiMinor}` : undefined))
  const reduce = useReducedMotion()
  const toggle = useToggleCheck()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 24) * 0.015, ease: [0.16, 1, 0.3, 1] }}
      className={`group relative flex cursor-pointer flex-col gap-2.5 rounded-lg border p-3 transition-colors ${
        selected ? 'border-accent bg-accent-soft/40' : 'border-transparent hover:border-line hover:bg-surface'
      }`}
      onClick={() => setState({ selected: app.path })}
    >
      <div className={`absolute right-2 top-2 ${isChecked ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
        <Checkbox checked={isChecked} label={`Select ${app.name}`} onClick={(e) => toggle(app.path, e)} />
      </div>
      <AppIcon pixels={app.info.manifest?.icon} size={52} />
      <div className="min-w-0">
        <button type="button" className="block w-full truncate text-left text-sm font-medium text-ink" title={app.name}>
          {app.name}
        </button>
        <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
          <FolderSimpleIcon size={12} aria-hidden />
          <span className="truncate">{app.folder || 'apps root'}</span>
          {app.version && <span className="font-mono">v{app.version}</span>}
        </div>
      </div>
      <AppBadges app={app} device={api} compact />
    </motion.div>
  )
}

function ListRow({ app, showFolder = true }: { app: AppRecord; showFolder?: boolean }) {
  const selected = useStore((s) => s.selected === app.path)
  const isChecked = useStore((s) => s.checked.has(app.path))
  const api = useStore((s) => (s.deviceInfo ? `${s.deviceInfo.apiMajor}.${s.deviceInfo.apiMinor}` : undefined))
  const toggle = useToggleCheck()
  return (
    <div
      role="row"
      onClick={() => setState({ selected: app.path })}
      className={`grid cursor-pointer grid-cols-[20px_32px_1fr_auto] items-center gap-3 px-4 py-2 md:grid-cols-[20px_32px_minmax(0,2fr)_minmax(0,1fr)_64px_64px_72px] ${
        selected ? 'bg-accent-soft/50' : 'hover:bg-surface'
      }`}
    >
      <Checkbox checked={isChecked} label={`Select ${app.name}`} onClick={(e) => toggle(app.path, e)} />
      <AppIcon pixels={app.info.manifest?.icon} size={32} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">{app.name}</div>
        <div className="mt-0.5">
          <AppBadges app={app} device={api} />
        </div>
      </div>
      <div className="hidden truncate text-[13px] text-muted md:block">{showFolder ? app.folder || 'apps root' : app.fileName}</div>
      <div className="hidden font-mono text-xs text-muted md:block">{app.version && `v${app.version}`}</div>
      <div className={`hidden font-mono text-xs md:block ${app.compat === 'ok' ? 'text-muted' : 'text-danger'}`}>{app.api}</div>
      <div className="text-right font-mono text-xs text-muted">{formatSize(app.size)}</div>
    </div>
  )
}

function ListHeader({ folderLabel = 'Folder' }: { folderLabel?: string }) {
  return (
    <div className="sticky top-0 z-10 hidden grid-cols-[20px_32px_minmax(0,2fr)_minmax(0,1fr)_64px_64px_72px] gap-3 border-b border-line bg-bg/95 px-4 py-2 text-xs font-medium text-muted backdrop-blur md:grid">
      <span />
      <span />
      <span>Name</span>
      <span>{folderLabel}</span>
      <span>Version</span>
      <span>API</span>
      <span className="text-right">Size</span>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 p-4" aria-hidden>
      {Array.from({ length: 18 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5 p-3">
          <div className="size-[52px] animate-pulse rounded-lg bg-surface-2" />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  )
}

/** Placeholders for files found on the card whose manifests are still being read. */
function usePending() {
  const pending = useStore((s) => s.pending)
  const folders = useStore((s) => s.filters.folders)
  return useMemo(
    () =>
      pending
        .map((p) => {
          const rel = p.path.slice('/ext/apps/'.length)
          const cut = rel.lastIndexOf('/')
          return { ...p, folder: cut === -1 ? '' : rel.slice(0, cut), fileName: rel.slice(cut + 1) }
        })
        .filter((p) => !folders.length || folders.includes(p.folder)),
    [pending, folders],
  )
}

function PendingCard({ fileName, folder }: { fileName: string; folder: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-transparent p-3" aria-hidden>
      <div className="size-[52px] animate-pulse rounded-lg bg-surface-2" />
      <div className="min-w-0">
        <div className="truncate font-mono text-[13px] text-muted">{fileName}</div>
        <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
          <FolderSimpleIcon size={12} aria-hidden />
          <span className="truncate">{folder || 'apps root'}</span>
        </div>
      </div>
      <div className="h-4 w-16 animate-pulse rounded-full bg-surface-2" />
    </div>
  )
}

function PendingRow({ fileName, folder }: { fileName: string; folder: string }) {
  return (
    <div className="grid grid-cols-[20px_32px_1fr_auto] items-center gap-3 px-4 py-2 md:grid-cols-[20px_32px_minmax(0,2fr)_minmax(0,1fr)_64px_64px_72px]" aria-hidden>
      <span />
      <div className="size-8 animate-pulse rounded-lg bg-surface-2" />
      <div className="truncate font-mono text-[13px] text-muted">{fileName}</div>
      <div className="hidden truncate text-[13px] text-muted md:block">{folder || 'apps root'}</div>
      <div className="hidden h-3 w-8 animate-pulse rounded bg-surface-2 md:block" />
      <div className="hidden h-3 w-8 animate-pulse rounded bg-surface-2 md:block" />
      <div className="h-3 w-12 animate-pulse justify-self-end rounded bg-surface-2" />
    </div>
  )
}

function ScanNotice() {
  const scan = useStore((s) => s.scan)
  const pending = useStore((s) => s.pending.length)
  const found = useStore((s) => s.apps.length + s.pending.length)
  if (!scan || !pending) return null
  const reading = scan.phase === 'Reading apps'
  return (
    <div role="status" className="mx-3 mt-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
      <p className="text-ink">
        {reading ? (
          <>
            Reading app <span className="font-mono">{scan.done + 1}</span> of <span className="font-mono">{scan.total}</span>
            {scan.etaSec !== undefined && <span className="text-muted">, {formatEta(scan.etaSec)}</span>}
          </>
        ) : (
          <>
            Found <span className="font-mono">{found}</span> apps. Checking which ones changed since the last scan.
          </>
        )}
      </p>
      <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-muted">
        The first scan copies every .fap over USB to read its manifest, which can take a few minutes. Apps appear as they are read, and later scans only read files that changed.
      </p>
    </div>
  )
}

export function AppsView() {
  const apps = useStore((s) => s.apps)
  const filters = useStore((s) => s.filters)
  const prefs = useStore((s) => s.prefs)
  const pending = usePending()
  const listing = useStore((s) => s.status === 'scanning' && s.apps.length === 0 && s.pending.length === 0)
  const shown = useMemo(() => sortApps(applyFilters(apps, filters), prefs.sort, prefs.sortDir), [apps, filters, prefs.sort, prefs.sortDir])
  const grouped = useMemo(() => {
    const m = new Map<string, AppRecord[]>()
    for (const a of shown) m.set(a.folder, [...(m.get(a.folder) ?? []), a])
    return [...m].sort((a, b) => a[0].localeCompare(b[0]))
  }, [shown])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar shown={shown} total={apps.length} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" role={prefs.view === 'grid' ? undefined : 'table'}>
        <ScanNotice />
        {listing ? (
          <SkeletonGrid />
        ) : shown.length === 0 && pending.length === 0 ? (
          <div className="flex h-full flex-col items-start justify-center gap-3 px-8 py-16 md:px-16">
            <h2 className="text-xl font-semibold tracking-tight text-ink">{apps.length ? 'No apps match these filters' : 'No apps found in /ext/apps'}</h2>
            <p className="max-w-[48ch] text-sm leading-relaxed text-muted">
              {apps.length
                ? 'Loosen the filters in the sidebar, or clear them to see everything again.'
                : 'Install apps from lab.flipper.net or copy .fap files onto the SD card, then scan again.'}
            </p>
            {apps.length > 0 && (
              <Button onClick={() => setState((s) => ({ filters: { ...s.filters, query: '', origins: [], onlyOutdated: false, onlyDuplicates: false, onlyUpdates: false, hideModuleApps: false, modules: [], folders: [] } }))}>
                Clear filters
              </Button>
            )}
          </div>
        ) : prefs.view === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-1 p-3">
            {shown.map((a, i) => (
              <GridItem key={a.path} app={a} index={i} />
            ))}
            {pending.map((p) => (
              <PendingCard key={p.path} fileName={p.fileName} folder={p.folder} />
            ))}
          </div>
        ) : prefs.view === 'list' ? (
          <>
            <ListHeader />
            {shown.map((a) => (
              <ListRow key={a.path} app={a} />
            ))}
            {pending.map((p) => (
              <PendingRow key={p.path} fileName={p.fileName} folder={p.folder} />
            ))}
          </>
        ) : (
          <>
            <ListHeader folderLabel="File" />
            {grouped.map(([folder, list]) => (
              <section key={folder || '.'} aria-label={folder || 'apps root'}>
                <h2 className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-4 py-1.5 text-[13px] font-medium text-ink">
                  <FolderSimpleIcon size={14} aria-hidden />
                  {folder ? `apps/${folder}` : 'apps'}
                  <span className="font-mono text-[11px] text-muted">{list.length}</span>
                </h2>
                {list.map((a) => (
                  <ListRow key={a.path} app={a} showFolder={false} />
                ))}
              </section>
            ))}
            {pending.length > 0 && (
              <section aria-label="Still reading">
                <h2 className="border-b border-line bg-surface-2/60 px-4 py-1.5 text-[13px] font-medium text-muted">
                  Still reading <span className="font-mono text-[11px]">{pending.length}</span>
                </h2>
                {pending.map((p) => (
                  <PendingRow key={p.path} fileName={p.fileName} folder={p.folder} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
