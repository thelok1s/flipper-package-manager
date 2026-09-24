import { CheckCircleIcon, TrashIcon } from '@phosphor-icons/react'
import { deleteApps, isProtected } from '../state/actions'
import { setState, useStore } from '../state/store'
import { AppIcon } from './AppIcon'
import { AppBadges } from './AppBadges'
import { confirmDelete } from './AppsView'
import { ask } from './Confirm'
import { Button, formatSize } from './ui'

export function DuplicatesView() {
  const groups = useStore((s) => s.duplicates)
  const api = useStore((s) => (s.deviceInfo ? `${s.deviceInfo.apiMajor}.${s.deviceInfo.apiMinor}` : undefined))
  const busy = useStore((s) => !!s.op)
  const list = [...groups.values()].sort((a, b) => a[0].name.localeCompare(b[0].name))

  if (!list.length)
    return (
      <div className="flex h-full flex-col items-start justify-center gap-2 px-8 md:px-16">
        <CheckCircleIcon size={28} className="text-accent" aria-hidden />
        <h2 className="text-xl font-semibold tracking-tight text-ink">No duplicate apps</h2>
        <p className="max-w-[52ch] text-sm leading-relaxed text-muted">
          Copies are matched by file name and by the name in the app manifest, in any folder.
        </p>
      </div>
    )

  const cleanAll = async () => {
    const extra = list.flatMap((g) => g.slice(1)).filter((a) => !isProtected(a))
    const ok = await ask({
      title: `Delete ${extra.length} older copies?`,
      body: 'In each group the first copy is kept: the one that loads on this firmware with the highest version. Deleted copies stay restorable from History.',
      confirmLabel: 'Delete copies',
      tone: 'danger',
    })
    if (ok) await deleteApps(extra.map((a) => a.path))
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <p className="text-sm text-muted">
          <span className="font-mono text-ink">{list.length}</span> apps have more than one copy. The recommended copy is listed first.
        </p>
        <Button className="ml-auto" size="sm" tone="danger" icon={TrashIcon} disabled={busy} onClick={cleanAll}>
          Keep best of each
        </Button>
      </div>
      <div className="flex flex-col gap-4 p-4">
        {list.map((copies) => (
          <section key={copies[0].path} className="rounded-lg border border-line bg-surface" aria-label={copies[0].name}>
            <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
              <AppIcon pixels={copies[0].info.manifest?.icon} size={28} />
              <h3 className="text-sm font-semibold text-ink">{copies[0].name}</h3>
              <span className="font-mono text-xs text-muted">{copies.length} copies</span>
              <Button className="ml-auto" size="sm" disabled={busy} onClick={() => confirmDelete(copies.slice(1).map((c) => c.path))}>
                Keep first only
              </Button>
            </header>
            <ol>
              {copies.map((c, i) => (
                <li
                  key={c.path}
                  className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60 md:grid-cols-[minmax(0,2fr)_72px_80px_72px_88px]"
                  onClick={() => setState({ selected: c.path })}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {i === 0 && <span className="text-xs font-medium text-accent-ink">Keep</span>}
                      <span className="truncate font-mono text-[13px] text-ink">{c.path.replace('/ext/', '')}</span>
                    </div>
                    <div className="mt-1">
                      <AppBadges app={c} device={api} />
                    </div>
                  </div>
                  <span className="hidden font-mono text-xs text-muted md:block">v{c.version || '?'}</span>
                  <span className={`hidden font-mono text-xs md:block ${c.compat === 'ok' ? 'text-muted' : 'text-danger'}`}>API {c.api || '?'}</span>
                  <span className="hidden font-mono text-xs text-muted md:block">{formatSize(c.size)}</span>
                  {i > 0 && !isProtected(c) ? (
                    <Button
                      size="sm"
                      tone="ghost"
                      icon={TrashIcon}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        void confirmDelete([c.path])
                      }}
                    >
                      Delete
                    </Button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  )
}
