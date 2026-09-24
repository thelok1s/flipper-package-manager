import { ArrowUpIcon, CaretRightIcon, FolderOpenIcon, FolderPlusIcon, FolderSimpleIcon, LockSimpleIcon, TrashIcon } from '@phosphor-icons/react'
import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { createFolder, isProtected, moveApps, removeFolder } from '../state/actions'
import { getState, setState, useStore } from '../state/store'
import type { AppRecord } from '../lib/analyze'
import { AppIcon } from './AppIcon'
import { CompatBadge } from './AppBadges'
import { ask } from './Confirm'
import { Button } from './ui'

const MIME = 'application/x-fpm-paths'
const parentOf = (f: string) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '')
const leaf = (f: string) => f.slice(f.lastIndexOf('/') + 1)

/** Shared drop-target behaviour: highlights while an app hovers, moves on drop. */
function useDrop(folder: string) {
  const [over, setOver] = useState(false)
  const props = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setOver(true)
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      setOver(false)
      const raw = e.dataTransfer.getData(MIME)
      if (!raw) return
      e.preventDefault()
      void moveApps(JSON.parse(raw) as string[], folder)
    },
  }
  return { over, props }
}

function TreeNode({ folder, depth, children, count }: { folder: string; depth: number; children?: ReactNode; count: number }) {
  const current = useStore((s) => s.explorerFolder)
  const { over, props } = useDrop(folder)
  const active = current === folder
  return (
    <li>
      <button
        type="button"
        {...props}
        onClick={() => setState({ explorerFolder: folder })}
        aria-current={active ? 'true' : undefined}
        className={`flex h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-[13px] transition-colors ${
          over ? 'bg-accent-soft ring-2 ring-accent' : active ? 'bg-surface-2 text-ink' : 'text-ink hover:bg-surface-2'
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {active ? <FolderOpenIcon size={15} weight="bold" aria-hidden /> : <FolderSimpleIcon size={15} aria-hidden />}
        <span className="truncate">{folder ? leaf(folder) : 'apps'}</span>
        <span className="ml-auto font-mono text-[11px] text-muted">{count}</span>
      </button>
      {children}
    </li>
  )
}

function FolderTile({ folder, label, icon, count }: { folder: string; label: string; icon: ReactNode; count?: number }) {
  const { over, props } = useDrop(folder)
  return (
    <button
      type="button"
      {...props}
      onDoubleClick={() => setState({ explorerFolder: folder })}
      onKeyDown={(e) => e.key === 'Enter' && setState({ explorerFolder: folder })}
      title="Double-click to open, or drop apps here"
      className={`flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors ${
        over ? 'border-accent bg-accent-soft' : 'border-dashed border-line hover:bg-surface'
      }`}
    >
      <span className="grid size-[52px] place-items-center rounded-lg bg-surface-2 text-muted">{icon}</span>
      <span className="w-full truncate text-sm font-medium text-ink">{label}</span>
      {count !== undefined && <span className="-mt-1.5 text-xs text-muted">{count} items</span>}
    </button>
  )
}

function AppTile({ app }: { app: AppRecord }) {
  const locked = useStore(() => isProtected(app))
  const checked = useStore((s) => s.checked.has(app.path))
  const [dragging, setDragging] = useState(false)
  return (
    <div
      draggable={!locked}
      onDragStart={(e) => {
        const sel = getState().checked
        const paths = sel.has(app.path) ? [...sel] : [app.path]
        e.dataTransfer.setData(MIME, JSON.stringify(paths))
        e.dataTransfer.effectAllowed = 'move'
        setDragging(true)
      }}
      onDragEnd={() => setDragging(false)}
      onClick={() => setState({ selected: app.path })}
      title={locked ? `Protected ${app.origin} app, cannot be moved` : 'Drag onto a folder to move'}
      className={`group relative flex cursor-pointer flex-col items-start gap-2 rounded-lg border p-3 transition-[opacity,background-color] ${
        dragging ? 'opacity-40' : ''
      } ${checked ? 'border-accent bg-accent-soft/40' : 'border-transparent hover:border-line hover:bg-surface'} ${locked ? '' : 'active:cursor-grabbing'}`}
    >
      <AppIcon pixels={app.info.manifest?.icon} size={52} />
      <span className="flex w-full items-center gap-1 text-sm font-medium text-ink">
        {locked && <LockSimpleIcon size={12} className="shrink-0 text-muted" aria-label="Protected" />}
        <span className="truncate">{app.name}</span>
      </span>
      <span className="-mt-1.5 w-full truncate font-mono text-[11px] text-muted">{app.fileName}</span>
      <CompatBadge app={app} />
    </div>
  )
}

export function FoldersView() {
  const folders = useStore((s) => s.folders)
  const apps = useStore((s) => s.apps)
  const current = useStore((s) => s.explorerFolder)
  const [newName, setNewName] = useState('')
  const [naming, setNaming] = useState(false)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of folders) m.set(f, 0)
    for (const a of apps) m.set(a.folder, (m.get(a.folder) ?? 0) + 1)
    for (const f of folders) if (f) m.set(parentOf(f), (m.get(parentOf(f)) ?? 0) + 1)
    return m
  }, [folders, apps])

  const valid = folders.includes(current) ? current : ''
  const subfolders = folders.filter((f) => f && parentOf(f) === valid)
  const here = apps.filter((a) => a.folder === valid).sort((a, b) => a.name.localeCompare(b.name))
  const crumbs = valid ? valid.split('/') : []

  const renderTree = (parent: string, depth: number): ReactNode => {
    const kids = folders.filter((f) => f && parentOf(f) === parent)
    if (!kids.length) return null
    return (
      <ul>
        {kids.map((f) => (
          <TreeNode key={f} folder={f} depth={depth} count={counts.get(f) ?? 0}>
            {renderTree(f, depth + 1)}
          </TreeNode>
        ))}
      </ul>
    )
  }

  const onDeleteFolder = async () => {
    if ((counts.get(valid) ?? 0) > 0) {
      await ask({ title: 'Folder is not empty', body: 'Move or delete the apps inside first. Only empty folders can be removed here.', confirmLabel: 'OK' })
      return
    }
    if (await ask({ title: `Remove apps/${valid}?`, body: 'The folder is empty.', confirmLabel: 'Remove', tone: 'danger' })) await removeFolder(valid)
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[240px_1fr]">
      <nav aria-label="Folder tree" className="scroll-thin hidden overflow-y-auto border-r border-line p-2 md:block">
        <ul>
          <TreeNode folder="" depth={0} count={counts.get('') ?? 0}>
            {renderTree('', 1)}
          </TreeNode>
        </ul>
      </nav>

      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
            <button type="button" className="text-muted hover:text-ink" onClick={() => setState({ explorerFolder: '' })}>
              /ext/apps
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <CaretRightIcon size={12} className="text-muted" aria-hidden />
                <button
                  type="button"
                  className={i === crumbs.length - 1 ? 'font-medium text-ink' : 'text-muted hover:text-ink'}
                  onClick={() => setState({ explorerFolder: crumbs.slice(0, i + 1).join('/') })}
                >
                  {c}
                </button>
              </span>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {naming ? (
              <form
                className="flex items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  await createFolder(valid, newName)
                  setNewName('')
                  setNaming(false)
                }}
              >
                <label htmlFor="new-folder" className="sr-only">
                  New folder name
                </label>
                <input
                  id="new-folder"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
                  placeholder="Folder name"
                  className="h-8 w-40 rounded-lg border border-line bg-bg px-2.5 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                />
                <Button size="sm" type="submit" tone="primary" disabled={!newName.trim()}>
                  Create
                </Button>
              </form>
            ) : (
              <Button size="sm" icon={FolderPlusIcon} onClick={() => setNaming(true)}>
                New folder
              </Button>
            )}
            {valid && (
              <Button size="sm" tone="ghost" icon={TrashIcon} onClick={onDeleteFolder}>
                Remove folder
              </Button>
            )}
          </div>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <p className="px-4 pt-3 text-xs text-muted">Drag apps onto a folder, the tree, or the parent tile. Selected apps move together.</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1 p-3">
            {valid && <FolderTile folder={parentOf(valid)} label={parentOf(valid) ? `.. (${leaf(parentOf(valid))})` : '.. (apps)'} icon={<ArrowUpIcon size={22} aria-hidden />} />}
            {subfolders.map((f) => (
              <FolderTile key={f} folder={f} label={leaf(f)} count={counts.get(f)} icon={<FolderSimpleIcon size={24} aria-hidden />} />
            ))}
            {here.map((a) => (
              <AppTile key={a.path} app={a} />
            ))}
          </div>
          {!subfolders.length && !here.length && <p className="px-4 pb-8 text-sm text-muted">This folder is empty. Drop apps here from the tree, or remove it.</p>}
        </div>
      </div>
    </div>
  )
}
