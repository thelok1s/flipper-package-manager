import { ArrowsClockwiseIcon, CopyIcon, DesktopIcon, MoonIcon, SunIcon } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { disconnect, scan } from '../state/actions'
import { setState, useStore, type Tab, type Theme } from '../state/store'
import { LabIcon, type LabIconId } from './LabIcon'
import { Logo } from './Logo'
import { IconButton } from './ui'

// Lab icons where Flipper Lab has one; duplicates has no Lab equivalent.
const TABS: { id: Tab; label: string; lab?: LabIconId }[] = [
  { id: 'apps', label: 'Apps', lab: 'apps' },
  { id: 'folders', label: 'Folders', lab: 'files' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'history', label: 'History', lab: 'logs' },
]

/** Connection pill in Flipper Lab's visual language. */
function ConnectionStatus() {
  const status = useStore((s) => s.status)
  const info = useStore((s) => s.deviceInfo)
  const icon: LabIconId = status === 'ready' ? 'connected' : status === 'disconnected' ? 'connect' : 'switch'
  const text = status === 'ready' ? 'Connected' : status === 'scanning' ? 'Scanning' : status === 'connecting' ? 'Connecting' : 'Not connected'
  return (
    <div className="flex items-center gap-2.5 text-[13px]" role="status" aria-live="polite">
      <LabIcon id={icon} size={20} />
      <span className="flex flex-col leading-tight">
        <span className="font-medium text-ink">{info?.name ?? text}</span>
        {info ? (
          <span className="text-[11px] text-muted">
            {text}, {info.firmwareVersion || 'unknown firmware'}, <span className="font-mono">API {info.apiMajor}.{info.apiMinor}</span>
          </span>
        ) : null}
      </span>
    </div>
  )
}

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_ICON = { system: DesktopIcon, light: SunIcon, dark: MoonIcon }

export function Header() {
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
          <Logo size={32} />
          <span className="hidden text-[15px] font-semibold tracking-tight text-ink sm:block">Flipper Package Manager</span>
        </div>

        {device && (
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
                  {t.lab ? (
                  <LabIcon id={t.lab} size={16} className="relative" />
                ) : (
                  <CopyIcon size={16} weight={active ? 'bold' : 'regular'} className="relative" aria-hidden />
                )}
                  <span className="relative hidden md:inline">{t.label}</span>
                  {!!counts[t.id] && <span className="relative font-mono text-[11px] text-muted">{counts[t.id]}</span>}
                </button>
              )
            })}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <div className="mr-2 hidden sm:block">
            <ConnectionStatus />
          </div>
          {device && (
            <>
              <IconButton icon={ArrowsClockwiseIcon} label="Scan again" onClick={() => scan()} disabled={status === 'scanning'} />
              <button
                type="button"
                onClick={() => disconnect()}
                aria-label="Disconnect"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[13px] text-ink transition-colors hover:bg-surface-2 active:scale-[0.98]"
              >
                <LabIcon id="disconnect" size={14} />
                <span className="hidden md:inline">Disconnect</span>
              </button>
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
