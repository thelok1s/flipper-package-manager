import { ArrowSquareOutIcon, ArrowsClockwiseIcon, CheckIcon, GithubLogoIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { linkState, type AppRecord } from '../lib/analyze'
import { CATALOG_CONTRIBUTE_URL, labAppUrl, type CatalogApp, type CatalogCategory, type CatalogDetail } from '../lib/catalog'
import { installFromCatalog, isProtected, linkToCatalog, loadCatalog, resolveCatalogSource, updateAll } from '../state/actions'
import { getState, setState, useStore } from '../state/store'
import { OriginBadge } from './AppBadges'
import { AppIcon } from './AppIcon'
import { ask } from './Confirm'
import { Button, Hint } from './ui'

type Sort = 'updated' | 'created' | 'downloads' | 'name'
const SORTS: { id: Sort; label: string }[] = [
  { id: 'updated', label: 'New updates' },
  { id: 'created', label: 'New releases' },
  { id: 'downloads', label: 'Most downloaded' },
  { id: 'name', label: 'Name' },
]
const PAGE = 48
const INK = '#1b1a19'

/** Installed copies per catalog app id, catalog installs first. */
function useInstalledIndex() {
  const apps = useStore((s) => s.apps)
  return useMemo(() => {
    const m = new Map<string, AppRecord[]>()
    for (const a of apps) {
      if (!a.catalog) continue
      m.set(a.catalog.id, [...(m.get(a.catalog.id) ?? []), a])
    }
    for (const list of m.values()) list.sort((a, b) => (a.origin === 'market' ? 0 : 1) - (b.origin === 'market' ? 0 : 1))
    return m
  }, [apps])
}

/** The screenshot in Flipper Lab's frame: orange LCD, black bezel, pixelated. */
function Screen({ src, alt, className = '' }: { src?: string; alt: string; className?: string }) {
  return (
    <div className={`aspect-[2/1] overflow-hidden rounded-md border-2 bg-lcd p-1 ${className}`} style={{ borderColor: INK }}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" className="pixelated h-full w-full object-contain mix-blend-multiply" />
      ) : (
        <div className="grid h-full place-items-center text-xs font-medium" style={{ color: INK }}>
          No screenshot
        </div>
      )}
    </div>
  )
}

function CategoryLabel({ cat }: { cat?: CatalogCategory }) {
  if (!cat) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
      <img src={cat.iconUri} alt="" className="size-3.5 dark:invert" loading="lazy" />
      {cat.name}
    </span>
  )
}

/** Install / Update / Installed, with progress while this app's operation runs. */
function ActionButton({ cat, copies, size = 'sm' }: { cat: CatalogApp; copies: AppRecord[]; size?: 'sm' | 'md' }) {
  const op = useStore((s) => s.op)
  const connected = useStore((s) => !!s.device)
  const scanning = useStore((s) => s.status === 'scanning')
  const busy = !!op || scanning || !connected
  const why = !connected ? 'Connect a Flipper first' : scanning ? 'Wait for the scan to finish' : op ? 'Wait for the current operation to finish' : null
  if (op?.key === cat.id) {
    const pct = op.total ? Math.round((op.done / op.total) * 100) : 0
    return (
      <Button size={size} tone="primary" disabled className="min-w-24">
        {pct ? `${pct}%` : 'Working'}
      </Button>
    )
  }
  const best = copies[0]
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  if (!best) {
    return (
      <Hint reason={why}>
        <Button size={size} tone="primary" disabled={busy} className="min-w-24" onClick={(e) => (stop(e), void installFromCatalog(cat))}>
          Install
        </Button>
      </Hint>
    )
  }
  if (best.updateAvailable && !isProtected(best)) {
    return (
      <Hint reason={why}>
        <Button size={size} tone="primary" disabled={busy} className="min-w-24" onClick={(e) => (stop(e), void installFromCatalog(cat, best.path))}>
          {best.origin === 'market' ? 'Update' : 'Replace'}
        </Button>
      </Hint>
    )
  }
  const where = best.path.replace('/ext/', '')
  const how =
    best.origin === 'market' ? 'as a catalog install' : best.origin === 'sideloaded' ? 'as a sideloaded copy' : 'by the firmware'
  return (
    <Hint reason={`On this Flipper at ${where}, ${how}. Installing another copy is blocked.`}>
      <span className={`inline-flex min-w-24 items-center justify-center gap-1.5 rounded-lg border border-line text-muted ${size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm'}`}>
        <CheckIcon size={14} weight="bold" aria-hidden />
        Installed
      </span>
    </Hint>
  )
}

function AppCard({ cat, category, copies, onOpen }: { cat: CatalogApp; category?: CatalogCategory; copies: AppRecord[]; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="flex cursor-pointer flex-col gap-2.5 rounded-lg p-3 transition-colors hover:bg-surface"
    >
      <Screen src={cat.screenshots[0]} alt={`${cat.name} screenshot`} />
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink" title={cat.name}>
          {cat.name}
        </h3>
        <CategoryLabel cat={category} />
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="line-clamp-2 min-h-[2lh] text-[13px] leading-snug text-muted">{cat.shortDescription}</p>
        <ActionButton cat={cat} copies={copies} />
      </div>
    </div>
  )
}

/** Tiny, safe Markdown subset for catalog descriptions: headings, bullets, links. */
function Markdown({ text }: { text: string }) {
  const inline = (line: string, key: number): ReactNode[] => {
    const out: ReactNode[] = []
    const re = /\[([^\]]+)\]\((https?:[^)\s]+)\)|(https?:\/\/[^\s)]+)/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      out.push(line.slice(last, m.index))
      const href = m[2] ?? m[3]
      out.push(
        <a key={`${key}-${m.index}`} href={href} target="_blank" rel="noreferrer" className="break-all text-accent-ink hover:underline">
          {m[1] ?? m[3]}
        </a>,
      )
      last = m.index + m[0].length
    }
    out.push(line.slice(last))
    return out.map((p) => (typeof p === 'string' ? p.replace(/\*\*|__|`/g, '') : p))
  }
  const blocks: ReactNode[] = []
  let list: ReactNode[] = []
  const flush = () => {
    if (list.length) blocks.push(<ul key={`ul-${blocks.length}`} className="ml-4 list-disc space-y-1">{list}</ul>)
    list = []
  }
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trimEnd()
    if (/^\s*[-*]\s+/.test(line)) {
      list.push(<li key={i}>{inline(line.replace(/^\s*[-*]\s+/, ''), i)}</li>)
      return
    }
    flush()
    if (!line.trim()) return
    const h = line.match(/^#{1,6}\s+(.*)/)
    if (h) blocks.push(<h4 key={i} className="mt-3 text-sm font-semibold text-ink">{inline(h[1], i)}</h4>)
    else if (line.startsWith('|')) blocks.push(<pre key={i} className="overflow-x-auto font-mono text-[11px]">{line}</pre>)
    else blocks.push(<p key={i}>{inline(line, i)}</p>)
  })
  flush()
  return <div className="space-y-2 text-[13px] leading-relaxed text-muted">{blocks}</div>
}

function DetailModal({ cat, category, copies, onClose }: { cat: CatalogApp; category?: CatalogCategory; copies: AppRecord[]; onClose: () => void }) {
  const [detail, setDetail] = useState<CatalogDetail | null | undefined>(undefined)
  const [shot, setShot] = useState(0)
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    // The modal is keyed by app id, so state starts fresh for every app.
    let live = true
    resolveCatalogSource(cat.alias).then((d) => live && setDetail(d))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      live = false
      window.removeEventListener('keydown', onKey)
    }
  }, [cat.alias, onClose])

  const showInstalled = (path: string) => setState({ tab: 'apps', selected: path })

  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[rgb(10_11_13/0.5)] p-4 md:p-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={cat.name}
        className="relative w-full max-w-4xl rounded-lg border border-line bg-surface p-5 shadow-panel md:p-7"
        initial={{ y: 16 }}
        animate={{ y: 0 }}
        exit={{ y: 8, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-4 top-4 text-muted hover:text-ink">
          <XIcon size={18} />
        </button>
        <div className="grid gap-6 md:grid-cols-[1.1fr_1fr]">
          <div>
            <Screen src={cat.screenshots[shot]} alt={`${cat.name} screenshot ${shot + 1}`} />
            {cat.screenshots.length > 1 && (
              <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {cat.screenshots.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    aria-label={`Screenshot ${i + 1}`}
                    onClick={() => setShot(i)}
                    className={`rounded-md ${i === shot ? 'ring-2 ring-accent' : 'opacity-70 hover:opacity-100'}`}
                  >
                    <Screen src={s} alt="" className="border" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div>
              <h2 className="pr-6 text-2xl font-semibold tracking-tight text-ink">{cat.name}</h2>
              <p className="mt-1 text-[13px] text-muted">by {cat.author}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
              <CategoryLabel cat={category} />
              <span>
                Version <span className="font-mono text-ink">{cat.version}</span>
              </span>
              {cat.buildApi && (
                <span>
                  Built for API <span className="font-mono text-ink">{cat.buildApi}</span>
                </span>
              )}
              <span>Updated {new Date(cat.updatedAt * 1000).toLocaleDateString()}</span>
            </div>
            <p className="text-sm leading-relaxed text-ink">{cat.shortDescription}</p>
            <div>
              <ActionButton cat={cat} copies={copies} size="md" />
            </div>
            {copies.length > 0 && (
              <div className="rounded-lg bg-surface-2 p-3">
                <h3 className="mb-1.5 text-xs font-medium text-muted">On this Flipper</h3>
                <ul className="flex flex-col gap-1.5">
                  {copies.map((c) => (
                    <li key={c.path} className="flex flex-wrap items-center gap-2 text-[13px]">
                      <button type="button" className="truncate font-mono text-xs text-ink hover:underline" onClick={() => showInstalled(c.path)}>
                        {c.path.replace('/ext/', '')}
                      </button>
                      <span className="font-mono text-xs text-muted">v{c.version || '?'}</span>
                      <OriginBadge app={c} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              <a href={labAppUrl(cat.alias)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-ink hover:underline">
                Flipper Lab <ArrowSquareOutIcon size={12} aria-hidden />
              </a>
              {detail?.sourceUrl && (
                <a href={detail.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-ink hover:underline">
                  Source code <ArrowSquareOutIcon size={12} aria-hidden />
                </a>
              )}
              {detail?.manifestUrl && (
                <a href={detail.manifestUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-ink hover:underline">
                  Manifest <ArrowSquareOutIcon size={12} aria-hidden />
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="mt-6 border-t border-line pt-5">
          {detail === undefined ? (
            <div className="space-y-2" aria-hidden>
              {[90, 75, 82, 60].map((w) => (
                <div key={w} className="h-3 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : detail ? (
            <>
              <Markdown text={detail.description} />
              {detail.changelog && (
                <div className="mt-5">
                  <button type="button" className="text-sm font-medium text-ink hover:underline" onClick={() => setShowLog((v) => !v)}>
                    {showLog ? 'Hide changelog' : 'Show changelog'}
                  </button>
                  {showLog && (
                    <div className="mt-2">
                      <Markdown text={detail.changelog} />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">Could not load the full description.</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function UpdatesList({ onOpen }: { onOpen: (cat: CatalogApp) => void }) {
  const apps = useStore((s) => s.apps)
  const busy = useStore((s) => !!s.op || s.status === 'scanning')
  const updatable = useMemo(() => apps.filter((a) => a.catalog && a.updateAvailable).sort((a, b) => a.name.localeCompare(b.name)), [apps])
  const allowed = updatable.filter((a) => !isProtected(a))

  const runAll = async () => {
    const ok = await ask({
      title: `Update ${allowed.length} app${allowed.length === 1 ? '' : 's'}?`,
      body: 'Each app is replaced with the catalog build for this firmware, one at a time. Previous versions are kept in History.',
      confirmLabel: 'Update all',
    })
    if (ok) await updateAll(allowed.map((a) => a.path))
  }

  if (!updatable.length)
    return (
      <div className="flex flex-col items-start gap-2 px-6 py-16 md:px-12">
        <h2 className="text-xl font-semibold tracking-tight text-ink">Everything is up to date</h2>
        <p className="max-w-[52ch] text-sm leading-relaxed text-muted">
          Apps installed from the catalog, and sideloaded apps that match a catalog listing, are checked against the latest build for this firmware.
        </p>
      </div>
    )

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted">
          <span className="font-mono text-ink">{updatable.length}</span> app{updatable.length === 1 ? ' has' : 's have'} a newer compatible build
        </p>
        <Button className="ml-auto" tone="primary" size="sm" icon={ArrowsClockwiseIcon} disabled={busy || !allowed.length} onClick={runAll}>
          Update all
        </Button>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {updatable.map((a) => (
          <li key={a.path} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-3">
            <AppIcon pixels={a.info.manifest?.icon} size={40} />
            <button type="button" className="min-w-0 text-left" onClick={() => onOpen(a.catalog!)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{a.name}</span>
                <OriginBadge app={a} />
              </div>
              <div className="mt-0.5 truncate font-mono text-xs text-muted">
                {a.version || '?'} to {a.catalog!.version}, {a.path.replace('/ext/', '')}
              </div>
            </button>
            <ActionButton cat={a.catalog!} copies={[a]} />
          </li>
        ))}
      </ul>
    </div>
  )
}

const MATCH_LABEL = { fim: 'Catalog manifest', alias: 'File name', name: 'App name' } as const

/** Installed apps that match a catalog listing, with the option to link them via a .fim. */
function OnFlipperList({ onOpen }: { onOpen: (cat: CatalogApp) => void }) {
  const apps = useStore((s) => s.apps)
  const fims = useStore((s) => s.fims)
  const busy = useStore((s) => !!s.op || s.status === 'scanning')
  const fimNames = useMemo(() => new Set(fims.map((f) => f.file.toLowerCase())), [fims])
  const rows = useMemo(
    () =>
      apps
        .filter((a) => a.catalog)
        .map((a) => ({ app: a, link: linkState(a, fimNames) }))
        .sort((x, y) => Number(y.link.ok) - Number(x.link.ok) || x.app.name.localeCompare(y.app.name)),
    [apps, fimNames],
  )
  const eligible = rows.filter((r) => r.link.ok)
  const linked = rows.filter((r) => r.app.origin === 'market').length

  const linkAll = async () => {
    const ok = await ask({
      title: `Link ${eligible.length} app${eligible.length === 1 ? '' : 's'} to the catalog?`,
      body: 'Writes a .fim manifest for each, the file lab.flipper.net and the mobile app use to track catalog installs. Nothing is downloaded and the apps are not changed. Older builds will show an update.',
      confirmLabel: 'Link apps',
    })
    if (ok) await linkToCatalog(eligible.map((r) => r.app.path))
  }

  if (!rows.length)
    return (
      <div className="flex flex-col items-start gap-2 px-6 py-16 md:px-12">
        <h2 className="text-xl font-semibold tracking-tight text-ink">No installed app matches the catalog</h2>
        <p className="max-w-[52ch] text-sm leading-relaxed text-muted">Apps are matched by their catalog manifest, file name or app name.</p>
      </div>
    )

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="max-w-[70ch] text-sm text-muted">
          <span className="font-mono text-ink">{rows.length}</span> apps on this Flipper are in the catalog,{' '}
          <span className="font-mono text-ink">{linked}</span> linked. Linking writes the .fim that lab.flipper.net would have written, so updates
          and the mobile app recognise the app.
        </p>
        <Hint reason={!eligible.length ? 'No app can be linked right now' : busy ? 'Wait for the current operation to finish' : null} className="ml-auto">
          <Button tone="primary" size="sm" disabled={busy || !eligible.length} onClick={linkAll}>
            Link {eligible.length} eligible
          </Button>
        </Hint>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {rows.map(({ app: a, link }) => (
          <li key={a.path} className="grid grid-cols-[40px_1fr] items-center gap-3 px-4 py-3 md:grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <AppIcon pixels={a.info.manifest?.icon} size={40} />
            <button type="button" className="min-w-0 text-left" onClick={() => onOpen(a.catalog!)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{a.name}</span>
                <OriginBadge app={a} />
              </div>
              <div className="mt-0.5 truncate font-mono text-xs text-muted">{a.path.replace('/ext/', '')}</div>
            </button>
            <div className="col-span-2 min-w-0 text-xs text-muted md:col-span-1">
              <div>
                <span className="font-mono text-ink">{a.version || '?'}</span> installed, <span className="font-mono text-ink">{a.catalog!.version}</span> in
                catalog
              </div>
              <div className="mt-0.5">Matched by {MATCH_LABEL[a.catalogMatch ?? 'name'].toLowerCase()}</div>
            </div>
            <div className="col-span-2 md:col-span-1">
              {a.origin === 'market' ? (
                <span className="text-xs text-muted">Linked</span>
              ) : (
                <Hint reason={!link.ok ? link.reason : busy ? 'Wait for the current operation to finish' : link.reason}>
                  <Button size="sm" disabled={!link.ok || busy} onClick={() => linkToCatalog([a.path])}>
                    Link
                  </Button>
                </Hint>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CatalogView() {
  const catalog = useStore((s) => s.catalog)
  const updates = useStore((s) => s.apps.filter((a) => a.catalog && a.updateAvailable).length)
  const installed = useInstalledIndex()
  const [mode, setMode] = useState<'browse' | 'device' | 'updates'>('browse')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('updated')
  // Cards render in pages; the page count resets whenever the filter changes.
  const filterKey = `${query}|${category}|${sort}`
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE })
  const limit = paging.key === filterKey ? paging.limit : PAGE
  const [openId, setOpenId] = useState<string | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const closeDetail = useCallback(() => setOpenId(null), [])

  useEffect(() => {
    void loadCatalog()
  }, [])

  const categories = useMemo(() => new Map(catalog.categoryList.map((c) => [c.id, c])), [catalog.categoryList])
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of catalog.apps) m.set(a.categoryId, (m.get(a.categoryId) ?? 0) + 1)
    return m
  }, [catalog.apps])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = catalog.apps.filter(
      (a) =>
        (!category || a.categoryId === category) &&
        (!q || `${a.name} ${a.alias} ${a.author} ${a.shortDescription}`.toLowerCase().includes(q)),
    )
    const by: Record<Sort, (a: CatalogApp, b: CatalogApp) => number> = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      created: (a, b) => b.createdAt - a.createdAt,
      downloads: (a, b) => b.downloads - a.downloads,
      name: (a, b) => a.name.localeCompare(b.name),
    }
    return list.sort(by[sort])
  }, [catalog.apps, query, category, sort])

  // Render more cards as the end of the grid scrolls into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setPaging((p) => ({ key: filterKey, limit: (p.key === filterKey ? p.limit : PAGE) + PAGE }))
      },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown.length, mode, filterKey, limit])

  const open = openId ? getState().catalog.byId.get(openId) : undefined

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Catalog view">
            {(['browse', 'device', 'updates'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`h-7 rounded-md px-3 text-[13px] transition-colors ${mode === m ? 'bg-surface font-medium text-ink shadow-panel' : 'text-muted hover:text-ink'}`}
              >
                {m === 'browse' ? 'Browse' : m === 'device' ? 'On this Flipper' : `Updates${updates ? ` (${updates})` : ''}`}
              </button>
            ))}
          </div>
          {mode === 'browse' && (
            <>
              <label className="relative ml-auto w-full sm:w-72">
                <span className="sr-only">Search the catalog</span>
                <MagnifyingGlassIcon size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search apps"
                  className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </label>
              <label className="sr-only" htmlFor="catalog-sort">
                Sort
              </label>
              <select
                id="catalog-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink"
              >
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <a
            href={CATALOG_CONTRIBUTE_URL}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-ink ${mode !== 'browse' ? 'ml-auto' : ''}`}
          >
            <GithubLogoIcon size={16} aria-hidden /> Contribute
          </a>
        </div>
        {mode === 'browse' && catalog.categoryList.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={!category}
              onClick={() => setCategory(null)}
              className={`inline-flex h-8 items-center rounded-full px-3 text-[13px] transition-shadow ${!category ? 'bg-ink text-bg' : 'bg-surface-2 text-ink hover:ring-1 hover:ring-line'}`}
            >
              All apps <span className="ml-1.5 font-mono text-[11px] opacity-70">{catalog.apps.length}</span>
            </button>
            {catalog.categoryList.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(category === c.id ? null : c.id)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-shadow ${category === c.id ? 'ring-2 ring-ink ring-offset-1 ring-offset-bg' : 'hover:brightness-95'}`}
                style={{ backgroundColor: `#${c.color}`, color: INK }}
              >
                <img src={c.iconUri} alt="" className="size-3.5" />
                {c.name}
                <span className="font-mono text-[11px] opacity-60">{counts.get(c.id) ?? 0}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === 'updates' ? (
        <UpdatesList onOpen={(c) => setOpenId(c.id)} />
      ) : mode === 'device' ? (
        <OnFlipperList onOpen={(c) => setOpenId(c.id)} />
      ) : catalog.status === 'error' ? (
        <div className="flex flex-col items-start gap-3 px-6 py-16 md:px-12">
          <h2 className="text-xl font-semibold tracking-tight text-ink">The catalog did not load</h2>
          <p className="text-sm text-muted">{catalog.error}</p>
          <Button onClick={() => loadCatalog(true)}>Try again</Button>
        </div>
      ) : catalog.status !== 'ready' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 p-4" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2.5 p-3">
              <div className="aspect-[2/1] animate-pulse rounded-md bg-surface-2" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-6 py-16 md:px-12">
          <h2 className="text-xl font-semibold tracking-tight text-ink">No apps match</h2>
          <Button
            onClick={() => {
              setQuery('')
              setCategory(null)
            }}
          >
            Clear search
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2 p-3 md:gap-4 md:p-4">
            {shown.slice(0, limit).map((a) => (
              <AppCard key={a.id} cat={a} category={categories.get(a.categoryId)} copies={installed.get(a.id) ?? []} onOpen={() => setOpenId(a.id)} />
            ))}
          </div>
          {limit < shown.length && <div ref={sentinel} className="h-10" />}
        </>
      )}

      <AnimatePresence>
        {open && (
          <DetailModal
            key={open.id}
            cat={open}
            category={categories.get(open.categoryId)}
            copies={installed.get(open.id) ?? []}
            onClose={closeDetail}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
