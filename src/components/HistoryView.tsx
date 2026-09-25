import { ArrowCounterClockwiseIcon, ArrowSquareOutIcon, BroomIcon, ClockCounterClockwiseIcon, EraserIcon, XIcon } from '@phosphor-icons/react'
import { labAppUrl } from '../lib/catalog'
import type { HistoryEntry, HistoryKind } from '../lib/db'
import { catalogFor, clearBackups, forgetHistory, reclaimSpace, restore } from '../state/actions'
import { toast, useStore } from '../state/store'
import { AppIcon } from './AppIcon'
import { ask } from './Confirm'
import { Badge, Button, Hint, IconButton, formatDate, formatSize } from './ui'

const KIND: Record<HistoryKind, string> = {
  delete: 'Deleted',
  move: 'Moved',
  replace: 'Replaced with catalog build',
  install: 'Installed from catalog',
  restore: 'Restored',
  mkdir: 'Folder created',
}

function Entry({ e }: { e: HistoryEntry }) {
  const connected = useStore((s) => !!s.device)
  const busy = useStore((s) => !!s.op)
  const exists = useStore((s) => s.apps.some((a) => a.path.toLowerCase() === e.path.toLowerCase()))
  // Subscribing to the catalog keeps the reinstall option current once it loads.
  const cat = useStore((s) => (s.catalog.status === 'ready' ? catalogFor(e) : undefined))
  const removable = e.kind === 'delete' || e.kind === 'replace'
  const canRestore = removable && (!!e.backup || !!cat)
  const links = [...new Set(e.urls)]
  const why = !connected ? 'Connect the Flipper first' : busy ? 'Wait for the current operation to finish' : exists ? 'A file already exists at this path' : null

  const dropBackup = async () => {
    const ok = await ask({
      title: `Remove the stored copy of ${e.name}?`,
      body: cat
        ? `Frees ${formatSize(e.backup!.length)}. The entry stays; Restore will reinstall version ${cat.version} from the catalog instead.`
        : `Frees ${formatSize(e.backup!.length)}. The entry stays, but this app can no longer be restored from here.`,
      confirmLabel: 'Remove copy',
      tone: 'danger',
    })
    if (ok) await clearBackups([e])
  }

  return (
    <li className="grid grid-cols-[40px_1fr] gap-3 px-4 py-3 md:grid-cols-[40px_1fr_auto]">
      <AppIcon pixels={e.iconPixels} size={40} dim={e.kind === 'delete' && !e.restoredAt} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{e.name}</span>
          <Badge tone={e.kind === 'delete' ? 'danger' : e.kind === 'restore' ? 'accent' : 'neutral'}>{KIND[e.kind]}</Badge>
          {e.restoredAt && <Badge tone="accent">Restored {formatDate(e.restoredAt)}</Badge>}
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted">
          {e.path.replace('/ext/', '')}
          {e.toPath && ` → ${e.toPath.replace('/ext/', '')}`}
        </p>
        <p className="mt-1 text-xs text-muted">
          {formatDate(e.ts)}
          {e.version && `, v${e.version}`}
          {e.api && `, API ${e.api}`}
          {e.backup
            ? `, backup ${formatSize(e.backup.length)}`
            : removable && (cat ? `, reinstallable from the catalog (v${cat.version})` : ', no stored copy')}
        </p>
        {(links.length > 0 || e.labAlias) && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {e.labAlias && (
              <a className="inline-flex items-center gap-1 text-accent-ink hover:underline" href={labAppUrl(e.labAlias)} target="_blank" rel="noreferrer">
                Flipper Lab <ArrowSquareOutIcon size={11} aria-hidden />
              </a>
            )}
            {links.slice(0, 3).map((u) => (
              <a key={u} className="inline-flex items-center gap-1 break-all text-accent-ink hover:underline" href={u} target="_blank" rel="noreferrer">
                {u.replace(/^https?:\/\//, '')} <ArrowSquareOutIcon size={11} className="shrink-0" aria-hidden />
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="col-span-2 flex items-center gap-1 md:col-span-1">
        {canRestore && !(e.restoredAt && exists) && (
          <Hint reason={why}>
            <Button size="sm" icon={ArrowCounterClockwiseIcon} disabled={!!why} onClick={() => restore(e)}>
              {e.backup ? 'Restore' : 'Reinstall'}
            </Button>
          </Hint>
        )}
        {e.backup && <IconButton icon={EraserIcon} label="Remove the stored copy, keep the entry" onClick={dropBackup} />}
        <IconButton icon={XIcon} label="Remove from history" onClick={() => forgetHistory(e)} />
      </div>
    </li>
  )
}

export function HistoryView() {
  const entries = useStore((s) => s.history)
  const busy = useStore((s) => !!s.op)
  const withBackup = entries.filter((e) => e.backup)
  const stored = withBackup.reduce((n, e) => n + (e.backup?.length ?? 0), 0)

  const onReclaim = async () => {
    const ok = await ask({
      title: 'Reclaim space?',
      body: (
        <>
          Removes stored copies of apps the catalog still offers at the same or a newer version; Restore reinstalls those from the catalog instead.
          Also clears cached manifests of files no longer on the Flipper. Entries stay, and copies of apps the catalog cannot replace are kept.
        </>
      ),
      confirmLabel: 'Reclaim space',
    })
    if (!ok) return
    const r = await reclaimSpace()
    toast(
      r.entries || r.cacheEntries
        ? `Freed ${formatSize(r.bytes)} from ${r.entries} backup${r.entries === 1 ? '' : 's'}${r.cacheEntries ? ` and ${r.cacheEntries} cached manifests` : ''}`
        : 'Nothing to reclaim: no stored copy can be replaced by the catalog',
      r.entries ? 'success' : 'info',
    )
  }

  const onClearAll = async () => {
    const ok = await ask({
      title: `Remove all ${withBackup.length} stored copies?`,
      body: `Frees ${formatSize(stored)}. The history entries stay, but apps that are not in the catalog can no longer be restored.`,
      confirmLabel: 'Remove all copies',
      tone: 'danger',
    })
    if (ok) {
      const n = await clearBackups(withBackup)
      toast(`Removed ${n} stored cop${n === 1 ? 'y' : 'ies'}`, 'success')
    }
  }

  if (!entries.length)
    return (
      <div className="flex h-full flex-col items-start justify-center gap-2 px-8 md:px-16">
        <ClockCounterClockwiseIcon size={28} className="text-muted" aria-hidden />
        <h2 className="text-xl font-semibold tracking-tight text-ink">Nothing here yet</h2>
        <p className="max-w-[52ch] text-sm leading-relaxed text-muted">
          Deletes, moves and catalog installs are recorded in this browser. Deleted apps keep a copy of their .fap so you can put them back.
        </p>
      </div>
    )
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <p className="text-sm text-muted">
          {entries.length} entries, <span className="font-mono text-ink">{formatSize(stored)}</span> of app copies stored in this browser
        </p>
        <div className="ml-auto flex gap-2">
          <Hint reason={busy ? 'Wait for the current operation to finish' : null}>
            <Button size="sm" icon={BroomIcon} disabled={busy} onClick={onReclaim}>
              Reclaim space
            </Button>
          </Hint>
          <Hint reason={!withBackup.length ? 'No stored copies' : null}>
            <Button size="sm" tone="danger" icon={EraserIcon} disabled={!withBackup.length} onClick={onClearAll}>
              Clear copies
            </Button>
          </Hint>
        </div>
      </div>
      <ul className="divide-y divide-line">
        {entries.map((e) => (
          <Entry key={e.id} e={e} />
        ))}
      </ul>
    </div>
  )
}
