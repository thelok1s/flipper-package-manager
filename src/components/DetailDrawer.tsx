import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  FolderSimpleIcon,
  LinkSimpleIcon,
  StorefrontIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { COMPAT_LABEL, linkState } from '../lib/analyze'
import { labAppUrl, type CatalogDetail } from '../lib/catalog'
import { isProtected, linkToCatalog, loadFullInfo, moveApps, replaceWithMarket, resolveCatalogSource, setSourceNote } from '../state/actions'
import { setState, useStore } from '../state/store'
import { AppBadges } from './AppBadges'
import { AppIcon } from './AppIcon'
import { LabIcon } from './LabIcon'
import { confirmDelete } from './AppsView'
import { ask } from './Confirm'
import { LINK_EXPLAINED, REPLACE_EXPLAINED } from './copy'
import { Button, Hint, IconButton, formatSize } from './ui'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  )
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-accent-ink hover:underline">
      {children}
      <ArrowSquareOutIcon size={12} className="shrink-0" aria-hidden />
    </a>
  )
}

export function DetailDrawer() {
  const selected = useStore((s) => s.selected)
  const app = useStore((s) => s.apps.find((a) => a.path === s.selected))
  const info = useStore((s) => s.deviceInfo)
  const folders = useStore((s) => s.folders)
  const note = useStore((s) => (app ? s.notes.get(app.appId) : undefined))
  const busy = useStore((s) => !!s.op)
  const category = useStore((s) => (app?.catalog ? (s.catalog.categories.get(app.catalog.categoryId) ?? 'Tools') : ''))
  const [detail, setDetail] = useState<CatalogDetail | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setDetail(null)
    setDraft(note ?? '')
    if (app?.catalog) {
      let live = true
      resolveCatalogSource(app.catalog.alias).then((d) => live && setDetail(d))
      return () => {
        live = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.path, app?.catalog?.alias])

  // The fast scan skips embedded links; read the whole file once the details are opened.
  useEffect(() => {
    if (app?.info.partial) void loadFullInfo(app.path)
  }, [app?.path, app?.info.partial])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setState({ selected: null })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const deviceApi = info ? `${info.apiMajor}.${info.apiMinor}` : undefined
  const locked = useStore(() => (app ? isProtected(app) : false))
  const lockReason = app?.origin === 'official' ? 'System app. Turn on Allow removing system apps in Settings first.' : 'Firmware app. Turn off Protect firmware apps in Settings first.'
  const busyReason = busy ? 'Wait for the current operation to finish' : null
  const fims = useStore((s) => s.fims)
  const fimNames = useMemo(() => new Set(fims.map((f) => f.file.toLowerCase())), [fims])
  const link = app ? linkState(app, fimNames) : null

  const onReplace = async () => {
    if (!app?.catalog || !info) return
    const ok = await ask({
      title: `Install ${app.catalog.name} from the catalog?`,
      body: `Downloads version ${app.catalog.version} built for API ${deviceApi}, saves it as apps/${category}/${app.catalog.alias}.fap with a catalog manifest, and removes this copy. The current file is kept in History.`,
      confirmLabel: app.origin === 'market' ? 'Update' : 'Replace',
    })
    if (ok) await replaceWithMarket(app.path)
  }

  return (
    <AnimatePresence>
      {selected && app && (
        <motion.aside
          key="drawer"
          aria-label={`${app.name} details`}
          className="scroll-thin absolute inset-y-0 right-0 z-30 flex w-full max-w-[400px] flex-col overflow-y-auto border-l border-line bg-surface shadow-panel"
          initial={{ x: 32, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 32, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 34 }}
        >
          <div className="flex items-start gap-4 p-5">
            <AppIcon pixels={app.info.manifest?.icon} size={72} />
            <div className="min-w-0 flex-1 pt-1">
              <h2 className="text-lg font-semibold leading-tight tracking-tight text-ink">{app.name}</h2>
              <p className="mt-1 truncate font-mono text-xs text-muted" title={app.path}>
                {app.path}
              </p>
            </div>
            <IconButton icon={XIcon} label="Close details" onClick={() => setState({ selected: null })} />
          </div>

          <div className="px-5">
            <AppBadges app={app} device={deviceApi} />
          </div>

          {app.compat !== 'ok' && app.compat !== 'unknown' && (
            <p className="mx-5 mt-4 flex gap-3 rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] leading-relaxed text-ink">
              <LabIcon id="fw-conflict-icon" size={28} />
              <span>
                <span className="font-medium text-danger">{COMPAT_LABEL[app.compat]}.</span> Built against API {app.api}, this Flipper runs {deviceApi}.
                {app.compat === 'too-old' && ' Older apps usually still open and work, but some crash if they use functions that changed.'}
                {app.catalog ? ' The catalog has a build for this firmware.' : ''}
              </span>
            </p>
          )}
          {app.info.error && <p className="mx-5 mt-4 rounded-lg bg-danger-soft px-3 py-2.5 text-[13px] text-danger">Could not read manifest: {app.info.error}</p>}

          <div className="mt-4 flex flex-wrap gap-2 px-5">
            {app.catalog && (app.origin !== 'market' || app.updateAvailable || app.compat !== 'ok') && app.origin !== 'official' && app.origin !== 'firmware' && (
              <Hint reason={busyReason ?? (app.origin === 'market' ? undefined : REPLACE_EXPLAINED)}>
                <Button tone="primary" icon={DownloadSimpleIcon} disabled={busy} onClick={onReplace}>
                  {app.origin === 'market' ? 'Update from catalog' : 'Replace with catalog'}
                </Button>
              </Hint>
            )}
            <Hint reason={locked ? lockReason : busyReason}>
              <Button tone="danger" icon={TrashIcon} disabled={locked || busy} onClick={() => confirmDelete([app.path])}>
                Delete
              </Button>
            </Hint>
          </div>

          <dl className="mt-5 border-t border-line px-5 py-3">
            <Row label="App version">{app.version ? <span className="font-mono">{app.version}</span> : 'unknown'}</Row>
            <Row label="Built for API">
              <span className={`font-mono ${app.compat === 'ok' ? '' : 'text-danger'}`}>{app.api || 'unknown'}</span>
              {deviceApi && <span className="text-muted"> (device {deviceApi})</span>}
            </Row>
            <Row label="Target">
              <span className="font-mono">f{app.info.manifest?.hardwareTarget ?? '?'}</span>
            </Row>
            <Row label="Stack size">
              <span className="font-mono">{app.info.manifest ? formatSize(app.info.manifest.stackSize) : '?'}</span>
            </Row>
            <Row label="File size">
              <span className="font-mono">{formatSize(app.size)}</span>
            </Row>
            {app.md5 && (
              <Row label="MD5">
                <span className="font-mono text-xs">{app.md5}</span>
              </Row>
            )}
            <Row label="Folder">
              <label htmlFor="move-select" className="sr-only">
                Move to folder
              </label>
              <Hint reason={locked ? lockReason.replace('Turn', 'To move it, turn') : busyReason} className="w-full">
              <div className="flex w-full items-center gap-2">
                <FolderSimpleIcon size={14} className="text-muted" aria-hidden />
                <select
                  id="move-select"
                  value={app.folder || '.'}
                  disabled={locked || busy}
                  onChange={(e) => moveApps([app.path], e.target.value === '.' ? '' : e.target.value)}
                  className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-1.5 text-[13px] text-ink disabled:opacity-60"
                >
                  {folders.map((f) => (
                    <option key={f || '.'} value={f || '.'}>
                      {f || 'apps root'}
                    </option>
                  ))}
                </select>
              </div>
              </Hint>
            </Row>
          </dl>

          <section className="border-t border-line px-5 py-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <StorefrontIcon size={14} aria-hidden /> Flipper catalog
            </h3>
            {app.catalog ? (
              <dl>
                <Row label="Listing">
                  <ExternalLink href={labAppUrl(app.catalog.alias)}>lab.flipper.net/apps/{app.catalog.alias}</ExternalLink>
                </Row>
                <Row label="Latest">
                  <span className="font-mono">{app.catalog.version}</span>
                  {app.catalog.buildApi && <span className="text-muted"> for API {app.catalog.buildApi}</span>}
                </Row>
                <Row label="Author">{app.catalog.author}</Row>
                {detail?.sourceUrl && (
                  <Row label="Source">
                    <ExternalLink href={detail.sourceUrl}>{detail.sourceUrl.replace(/^https?:\/\//, '')}</ExternalLink>
                  </Row>
                )}
                {app.catalog.shortDescription && <p className="mt-2 text-[13px] leading-relaxed text-muted">{app.catalog.shortDescription}</p>}
                <Row label="Matched by">
                  {app.catalogMatch === 'fim' ? 'Catalog manifest (.fim)' : app.catalogMatch === 'alias' ? 'File name' : 'App name'}
                </Row>
                {app.origin !== 'market' && link && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Hint reason={!link.ok ? link.reason : busyReason}>
                      <Button size="sm" disabled={!link.ok || busy} onClick={() => linkToCatalog([app.path])}>
                        Link to catalog
                      </Button>
                    </Hint>
                    <span className="text-xs leading-snug text-muted">
                      {link.ok ? `${LINK_EXPLAINED} ${link.reason}.` : link.reason}
                    </span>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted">Not found in the catalog. This app is only available from its own source.</p>
            )}
          </section>

          <section className="border-t border-line px-5 py-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <LinkSimpleIcon size={14} aria-hidden /> Links inside the app
            </h3>
            <p className="mb-2 text-xs leading-relaxed text-muted">
              Web addresses written inside the app file, usually the author's repository shown on an About screen. FPM finds them by searching the
              binary.
            </p>
            {app.info.partial ? (
              <p className="animate-pulse text-[13px] text-muted">Reading the app file for links</p>
            ) : app.info.urls.length ? (
              <ul className="flex flex-col gap-1 text-[13px]">
                {app.info.urls.slice(0, 5).map((u) => (
                  <li key={u}>
                    <ExternalLink href={u}>{u.replace(/^https?:\/\//, '')}</ExternalLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">The binary has no embedded web links.</p>
            )}
            <form
              className="mt-3 flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                void setSourceNote(app.appId, draft)
              }}
            >
              <label htmlFor="source-note" className="text-xs font-medium text-ink">
                Your source link
              </label>
              <p className="text-xs leading-relaxed text-muted">
                A .fap does not carry its project URL (fap_weburl lives in the build manifest, not the binary). Save one here to keep it with this
                app. It stays in this browser and is shown in History if you delete the app.
              </p>
              <div className="flex gap-2">
                <input
                  id="source-note"
                  type="url"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="https://github.com/…"
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                />
                <Button size="sm" type="submit" disabled={draft === (note ?? '')}>
                  Save
                </Button>
              </div>
            </form>
          </section>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
