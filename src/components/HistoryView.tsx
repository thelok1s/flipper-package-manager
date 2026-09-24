import { ArrowCounterClockwiseIcon, ArrowSquareOutIcon, ClockCounterClockwiseIcon, XIcon } from '@phosphor-icons/react'
import { labAppUrl } from '../lib/catalog'
import type { HistoryEntry, HistoryKind } from '../lib/db'
import { forgetHistory, restore } from '../state/actions'
import { useStore } from '../state/store'
import { AppIcon } from './AppIcon'
import { Badge, Button, IconButton, formatDate, formatSize } from './ui'

const KIND: Record<HistoryKind, string> = {
  delete: 'Deleted',
  move: 'Moved',
  replace: 'Replaced with catalog build',
  restore: 'Restored',
  mkdir: 'Folder created',
}

function Entry({ e }: { e: HistoryEntry }) {
  const connected = useStore((s) => !!s.device)
  const busy = useStore((s) => !!s.op)
  const exists = useStore((s) => s.apps.some((a) => a.path.toLowerCase() === e.path.toLowerCase()))
  const canRestore = (e.kind === 'delete' || e.kind === 'replace') && !!e.backup
  const links = [...new Set(e.urls)]

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
          {e.version && ` · v${e.version}`}
          {e.api && `, API ${e.api}`}
          {e.backup && `, backup ${formatSize(e.backup.length)}`}
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
          <Button
            size="sm"
            icon={ArrowCounterClockwiseIcon}
            disabled={!connected || busy || exists}
            title={!connected ? 'Connect the Flipper to restore' : exists ? 'A file already exists at this path' : undefined}
            onClick={() => restore(e)}
          >
            Restore
          </Button>
        )}
        <IconButton icon={XIcon} label="Remove from history" onClick={() => forgetHistory(e)} />
      </div>
    </li>
  )
}

export function HistoryView() {
  const entries = useStore((s) => s.history)
  if (!entries.length)
    return (
      <div className="flex h-full flex-col items-start justify-center gap-2 px-8 md:px-16">
        <ClockCounterClockwiseIcon size={28} className="text-muted" aria-hidden />
        <h2 className="text-xl font-semibold tracking-tight text-ink">Nothing here yet</h2>
        <p className="max-w-[52ch] text-sm leading-relaxed text-muted">
          Deletes, moves and catalog replacements are recorded in this browser. Deleted apps keep a copy of their .fap so you can put them back.
        </p>
      </div>
    )
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <p className="border-b border-line px-4 py-3 text-sm text-muted">Stored in this browser's IndexedDB. Clearing site data removes it.</p>
      <ul className="divide-y divide-line">
        {entries.map((e) => (
          <Entry key={e.id} e={e} />
        ))}
      </ul>
    </div>
  )
}
