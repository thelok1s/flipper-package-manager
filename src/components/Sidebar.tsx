import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { emptyFilters, isOutdated, type Filters, type Origin } from '../lib/analyze'
import { loadCatalog, loadOfficial, scan } from '../state/actions'
import { setState, useStore } from '../state/store'
import { ask } from './Confirm'
import { Chip, SectionLabel, Switch } from './ui'

const ORIGINS: { id: Origin; label: string }[] = [
  { id: 'official', label: 'Official' },
  { id: 'firmware', label: 'Firmware' },
  { id: 'market', label: 'Catalog' },
  { id: 'sideloaded', label: 'Sideloaded' },
]

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function Sidebar() {
  const apps = useStore((s) => s.apps)
  const filters = useStore((s) => s.filters)
  const protectSystem = useStore((s) => s.prefs.protectSystem)
  const onlyCapital = useStore((s) => s.prefs.onlyCapitalFolders)
  const fastScan = useStore((s) => s.prefs.fastScan)
  const jsScan = useStore((s) => s.jsScan)
  const scanning = useStore((s) => s.status === 'scanning')
  const catalog = useStore((s) => s.catalog)
  const official = useStore((s) => s.official)
  const allowOfficial = useStore((s) => s.allowOfficialRemoval)
  const target = useStore((s) => s.deviceInfo?.target ?? 7)

  const toggleOfficial = async (on: boolean) => {
    if (!on) return setState({ allowOfficialRemoval: false })
    const ok = await ask({
      title: 'Allow removing official apps?',
      body: (
        <>
          Official apps such as NFC, Sub-GHz, Infrared and Bad USB are core Flipper features. Without them the matching menu entries stop working
          until you reinstall the firmware or restore them from History. This override lasts until you reload the page.
        </>
      ),
      confirmLabel: 'Allow removal',
      tone: 'danger',
    })
    if (ok) setState({ allowOfficialRemoval: true })
  }
  const set = (patch: Partial<Filters>) => setState((s) => ({ filters: { ...s.filters, ...patch } }))

  const stats = useMemo(() => {
    const origins: Record<Origin, number> = { official: 0, firmware: 0, market: 0, sideloaded: 0 }
    const modules = new Map<string, number>()
    const folders = new Map<string, number>()
    let outdated = 0
    let dups = 0
    let updates = 0
    let moduleApps = 0
    for (const a of apps) {
      origins[a.origin]++
      if (isOutdated(a.compat)) outdated++
      if (a.duplicateGroup) dups++
      if (a.updateAvailable) updates++
      if (a.modules.length) moduleApps++
      for (const m of a.modules) modules.set(m, (modules.get(m) ?? 0) + 1)
      folders.set(a.folder, (folders.get(a.folder) ?? 0) + 1)
    }
    return {
      origins,
      outdated,
      dups,
      updates,
      moduleApps,
      modules: [...modules].sort((a, b) => a[0].localeCompare(b[0])),
      folders: [...folders].sort((a, b) => a[0].localeCompare(b[0])),
    }
  }, [apps])

  const active = JSON.stringify({ ...filters, query: '' }) !== JSON.stringify(emptyFilters) || !!filters.query

  return (
    <aside className="scroll-thin flex h-full flex-col gap-6 overflow-y-auto border-r border-line bg-surface p-4" aria-label="Filters">
      <div className="flex flex-col gap-2">
        <label htmlFor="search" className="text-xs font-medium text-muted">
          Search
        </label>
        <div className="relative">
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id="search"
            type="search"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            className="h-9 w-full rounded-lg border border-line bg-bg pl-8 pr-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            placeholder="Name, path or author"
          />
        </div>
      </div>

      <div>
        <SectionLabel>Source</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {ORIGINS.map((o) => (
            <Chip key={o.id} active={filters.origins.includes(o.id)} count={stats.origins[o.id]} onClick={() => set({ origins: toggle(filters.origins, o.id) })}>
              {o.label}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>Needs attention</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filters.onlyOutdated} count={stats.outdated} onClick={() => set({ onlyOutdated: !filters.onlyOutdated })}>
            API mismatch
          </Chip>
          <Chip active={filters.onlyDuplicates} count={stats.dups} onClick={() => set({ onlyDuplicates: !filters.onlyDuplicates })}>
            Duplicates
          </Chip>
          <Chip active={filters.onlyUpdates} count={stats.updates} onClick={() => set({ onlyUpdates: !filters.onlyUpdates })}>
            Catalog update
          </Chip>
        </div>
      </div>

      <div>
        <SectionLabel>Add-on modules</SectionLabel>
        <Switch
          checked={filters.hideModuleApps}
          onChange={(v) => set({ hideModuleApps: v, modules: v ? [] : filters.modules })}
          label="Hide apps that need a module"
          hint={`${stats.moduleApps} apps name a board in brackets, like [LD2450]`}
        />
        {!filters.hideModuleApps && stats.modules.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {stats.modules.map(([m, n]) => (
              <Chip key={m} active={filters.modules.includes(m)} count={n} onClick={() => set({ modules: toggle(filters.modules, m) })}>
                <span className="font-mono text-xs">{m}</span>
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionLabel>Folder</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {stats.folders.map(([f, n]) => (
            <Chip key={f || '.'} active={filters.folders.includes(f)} count={n} onClick={() => set({ folders: toggle(filters.folders, f) })}>
              {f || 'apps root'}
            </Chip>
          ))}
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <Switch
          checked={onlyCapital}
          onChange={(v) => {
            if (scanning) return
            setState((s) => ({ prefs: { ...s.prefs, onlyCapitalFolders: v } }))
            void scan()
          }}
          label="Hide non-app assets"
          hint="Skips internal and lowercase folders in /ext/apps."
        />
        <div className="mt-3">
          <Switch
            checked={fastScan}
            onChange={(v) => setState((s) => ({ prefs: { ...s.prefs, fastScan: v } }))}
            label="Fast scan"
            hint={
              jsScan === 'unavailable'
                ? 'Not available on this firmware, using the standard scan.'
                : jsScan === 'available'
                  ? 'Reading manifests on the Flipper with its JS engine.'
                  : 'Reads manifests on the Flipper with its JS engine when it has one.'
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <Switch
          checked={protectSystem}
          onChange={(v) => setState((s) => ({ prefs: { ...s.prefs, protectSystem: v } }))}
          label="Protect firmware apps"
          hint="Installed by this device's firmware update (listed in /ext/Manifest). Protected apps can't be deleted or moved."
        />
        <div className={allowOfficial ? 'rounded-lg bg-danger-soft p-2 -m-2' : ''}>
          <Switch
            checked={allowOfficial}
            onChange={toggleOfficial}
            label="Allow removing official apps"
            hint={
              official.status === 'ready'
                ? `Core apps from official firmware ${official.version} (${official.paths.size}). Off again after a reload.`
                : official.status === 'loading'
                  ? 'Loading the official app list'
                  : 'Official app list unavailable, so no app is marked official.'
            }
          />
          {official.status === 'error' && (
            <button type="button" className="text-xs text-accent-ink underline" onClick={() => loadOfficial(target)}>
              Retry loading the list
            </button>
          )}
        </div>
      </div>

      <div className="mt-auto text-xs leading-relaxed text-muted">
        {catalog.status === 'ready' && `Catalog loaded: ${catalog.byAlias.size} apps`}
        {catalog.status === 'loading' && 'Loading the app catalog'}
        {catalog.status === 'error' && (
          <span>
            Catalog unavailable ({catalog.error}).{' '}
            <button type="button" className="text-accent-ink underline" onClick={() => loadCatalog(true)}>
              Retry
            </button>
          </span>
        )}
      </div>

      {active && (
        <button
          type="button"
          onClick={() => setState({ filters: emptyFilters })}
          className="-mt-3 inline-flex items-center gap-1 self-start text-xs text-accent-ink hover:underline"
        >
          <XIcon size={12} aria-hidden /> Clear filters
        </button>
      )}
    </aside>
  )
}
