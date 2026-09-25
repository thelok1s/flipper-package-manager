import { CpuIcon, LockSimpleIcon, ShieldCheckIcon, StorefrontIcon, WarningIcon } from '@phosphor-icons/react'
import { COMPAT_LABEL, type AppRecord } from '../lib/analyze'
import { useStore } from '../state/store'
import { Badge } from './ui'

/** Fallback when the catalog (which defines the GPIO category colour) has not loaded. */
const GPIO_FALLBACK = 'A5E5F5'

export function CompatBadge({ app, device }: { app: AppRecord; device?: string }) {
  if (app.compat === 'ok') return null
  const title = {
    'too-old': `Built for API ${app.api}, this Flipper runs ${device}. Usually still opens and works; some apps crash if they use functions that changed.`,
    'too-new': `Built for API ${app.api}, newer than this firmware (${device}). It may not open until the firmware is updated.`,
    'newer-minor': `Built for API ${app.api}, slightly newer than ${device}. It may fail if it uses functions this firmware lacks.`,
    target: 'Built for different Flipper hardware.',
    unknown: app.info.error ?? 'The manifest could not be read.',
  }[app.compat]
  return (
    <Badge tone="danger" title={title}>
      <WarningIcon size={11} weight="bold" aria-hidden />
      {COMPAT_LABEL[app.compat]}
    </Badge>
  )
}

/**
 * Severity, highest first. System and Firmware use Flipper orange (solid, then tinted) to show
 * they belong to the firmware; Catalog and Sideloaded stay neutral.
 */
export function OriginBadge({ app }: { app: AppRecord }) {
  if (app.origin === 'official')
    return (
      <Badge tone="strong" title="Ships with official Flipper firmware. Removing it needs Allow removing system apps.">
        <ShieldCheckIcon size={11} weight="bold" aria-hidden />
        System
      </Badge>
    )
  if (app.origin === 'firmware')
    return (
      <Badge tone="accent" title="Installed by this device's firmware (listed in /ext/Manifest)">
        <LockSimpleIcon size={11} weight="bold" aria-hidden />
        Firmware
      </Badge>
    )
  if (app.origin === 'market')
    return (
      <Badge title="Installed from the Flipper catalog (lab.flipper.net, the mobile app or FPM)">
        <StorefrontIcon size={11} weight="bold" aria-hidden />
        Catalog
      </Badge>
    )
  return <Badge title="Copied to the SD card by hand or by another tool">Sideloaded</Badge>
}

/** Apps that use the GPIO header: named add-on boards, the GPIO folder, or the catalog's GPIO category. */
export function usesGpio(app: AppRecord, gpioCategoryId?: string) {
  return app.modules.length > 0 || app.folder.toLowerCase() === 'gpio' || (!!gpioCategoryId && app.catalog?.categoryId === gpioCategoryId)
}

export function GpioBadge({ app }: { app: AppRecord }) {
  const gpio = useStore((s) => s.catalog.categoryList.find((c) => c.name.toLowerCase() === 'gpio'))
  if (!usesGpio(app, gpio?.id)) return null
  const color = `#${gpio?.color ?? GPIO_FALLBACK}`
  return (
    <span
      title={app.modules.length ? `Needs an add-on board: ${app.modules.join(', ')}` : 'Uses the GPIO header'}
      className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium"
      style={{ backgroundColor: color, color: '#1b1a19' }}
    >
      <CpuIcon size={11} weight="bold" aria-hidden />
      {app.modules.length ? <span className="font-mono">{app.modules.join(' ')}</span> : 'GPIO'}
    </span>
  )
}

export function AppBadges({ app, device, compact = false }: { app: AppRecord; device?: string; compact?: boolean }) {
  const showGpio = useStore((s) => s.prefs.showGpioBadge)
  const showSource = useStore((s) => !compact || s.prefs.showSourceOnCards)
  return (
    <span className="flex flex-wrap items-center gap-1">
      <CompatBadge app={app} device={device} />
      {showSource && (app.origin === 'official' || app.origin === 'firmware' || !compact) && <OriginBadge app={app} />}
      {showGpio && <GpioBadge app={app} />}
      {app.duplicateGroup && app.duplicateRank! > 0 && <Badge title="Another copy of this app is a better fit">Older copy</Badge>}
      {app.updateAvailable && <Badge tone="accent">Update {app.catalog?.version}</Badge>}
      {!showGpio && !compact && app.modules.map((m) => <Badge key={m}><span className="font-mono">{m}</span></Badge>)}
    </span>
  )
}
