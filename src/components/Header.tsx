import {
  ArrowsClockwiseIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  DesktopIcon,
  FolderSimpleIcon,
  MoonIcon,
  PlugIcon,
  SquaresFourIcon,
  SunIcon,
} from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { disconnect, scan } from '../state/actions'
import { setState, useStore, type Tab, type Theme } from '../state/store'
import { IconButton } from './ui'

const TABS: { id: Tab; label: string; icon: typeof SquaresFourIcon }[] = [
  { id: 'apps', label: 'Apps', icon: SquaresFourIcon },
  { id: 'folders', label: 'Folders', icon: FolderSimpleIcon },
  { id: 'duplicates', label: 'Duplicates', icon: CopyIcon },
  { id: 'history', label: 'History', icon: ClockCounterClockwiseIcon },
]

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_ICON = { system: DesktopIcon, light: SunIcon, dark: MoonIcon }

export function Header() {
  const info = useStore((s) => s.deviceInfo)
  const device = useStore((s) => s.device)
  const status = useStore((s) => s.status)
  const tab = useStore((s) => s.tab)
  const dupCount = useStore((s) => s.duplicates.size)
  const histCount = useStore((s) => s.history.length)
  const theme = useStore((s) => s.prefs.theme)
  const counts: Partial<Record<Tab, number>> = { duplicates: dupCount, history: histCount }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-accent">
            <span className="h-3 w-4 rounded-[3px] bg-lcd-pixel" />
          </span>
          <span className="hidden text-[15px] font-semibold tracking-tight text-ink sm:block">Flipper App Manager</span>
        </div>

        <nav aria-label="Sections" className="ml-2 flex items-center gap-0.5 overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setState({ tab: t.id })}
                aria-current={active ? 'page' : undefined}
                className={`relative flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors ${
                  active ? 'text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-lg bg-surface-2"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <t.icon size={16} weight={active ? 'bold' : 'regular'} className="relative" aria-hidden />
                <span className="relative hidden md:inline">{t.label}</span>
                {!!counts[t.id] && <span className="relative font-mono text-[11px] text-muted">{counts[t.id]}</span>}
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          {info && (
            <div className="mr-1 hidden items-center gap-3 rounded-lg border border-line px-3 py-1 text-[13px] lg:flex">
              <span className="font-medium text-ink">{info.name}</span>
              <span className="text-muted">
                {info.firmwareVersion || 'unknown'} {device?.kind === 'demo' ? '(demo)' : ''}
              </span>
              <span className="font-mono text-xs text-muted" title="Firmware API version apps are checked against">
                API {info.apiMajor}.{info.apiMinor}
              </span>
            </div>
          )}
          {device && (
            <>
              <IconButton icon={ArrowsClockwiseIcon} label="Scan again" onClick={() => scan()} disabled={status === 'scanning'} />
              <IconButton icon={PlugIcon} label="Disconnect" onClick={() => disconnect()} />
            </>
          )}
          <IconButton
            icon={THEME_ICON[theme]}
            label={`Theme: ${theme}`}
            onClick={() => setState((s) => ({ prefs: { ...s.prefs, theme: NEXT_THEME[theme] } }))}
          />
        </div>
      </div>
    </header>
  )
}
