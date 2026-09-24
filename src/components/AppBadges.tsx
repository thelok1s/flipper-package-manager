import { LockSimpleIcon, StorefrontIcon, WarningIcon } from '@phosphor-icons/react'
import { COMPAT_LABEL, type AppRecord } from '../lib/analyze'
import { Badge } from './ui'

export function CompatBadge({ app, device }: { app: AppRecord; device?: string }) {
  if (app.compat === 'ok') return null
  const title = {
    'too-old': `Built for API ${app.api}, this Flipper runs ${device}. Usually still opens and works; some apps crash if they use functions that changed.`,
    'too-new': `Built for API ${app.api}, newer than this firmware (${device}). It may not open until the firmware is updated.`,
    'newer-minor': `Built for API ${app.api}, slightly newer than ${device}. It may fail if it uses functions this firmware lacks.`,
    target: 'Built for different Flipper hardware.',
    unknown: app.info.error ?? 'The manifest could not be read.',
  }[app.compat]
  const serious = app.compat === 'target' || app.compat === 'unknown'
  return (
    <Badge tone={serious ? 'danger' : 'neutral'} title={title}>
      <WarningIcon size={11} weight="bold" aria-hidden />
      {COMPAT_LABEL[app.compat]}
    </Badge>
  )
}

export function OriginBadge({ app }: { app: AppRecord }) {
  if (app.origin === 'system')
    return (
      <Badge title="Shipped with the firmware (listed in /ext/Manifest)">
        <LockSimpleIcon size={11} weight="bold" aria-hidden />
        System
      </Badge>
    )
  if (app.origin === 'market')
    return (
      <Badge tone="accent" title="Installed from the Flipper catalog (lab.flipper.net or the mobile app)">
        <StorefrontIcon size={11} weight="bold" aria-hidden />
        Catalog
      </Badge>
    )
  return <Badge title="Copied to the SD card by hand or by another tool">Sideloaded</Badge>
}

export function AppBadges({ app, device, compact = false }: { app: AppRecord; device?: string; compact?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <CompatBadge app={app} device={device} />
      {!compact && <OriginBadge app={app} />}
      {app.duplicateGroup && app.duplicateRank! > 0 && <Badge title="Another copy of this app is a better fit">Older copy</Badge>}
      {app.updateAvailable && <Badge tone="accent">Update {app.catalog?.version}</Badge>}
      {!compact && app.modules.map((m) => <Badge key={m}><span className="font-mono">{m}</span></Badge>)}
    </span>
  )
}
