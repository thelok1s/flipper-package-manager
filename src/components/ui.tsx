import { useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Icon } from '@phosphor-icons/react'

/** Radius system: 8px on controls and panels, full pill on chips and badges. */

type Tone = 'primary' | 'secondary' | 'ghost' | 'danger'

const TONES: Record<Tone, string> = {
  primary: 'bg-accent text-[#1b1206] hover:brightness-105 border border-transparent font-medium',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-ink border border-transparent hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger border border-transparent hover:brightness-95 font-medium',
}

export function Button({
  tone = 'secondary',
  icon: IconCmp,
  size = 'md',
  className = '',
  children,
  ...rest
}: ComponentProps<'button'> & { tone?: Tone; icon?: Icon; size?: 'sm' | 'md' }) {
  const pad = size === 'sm' ? 'h-8 px-2.5 text-[13px] gap-1.5' : 'h-9 px-3.5 text-sm gap-2'
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg transition-[transform,background-color,filter] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${pad} ${TONES[tone]} ${className}`}
      {...rest}
    >
      {IconCmp && <IconCmp size={size === 'sm' ? 15 : 17} weight="bold" aria-hidden />}
      {children}
    </button>
  )
}

export function IconButton({
  icon: IconCmp,
  label,
  active,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: Icon; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors active:scale-[0.96] disabled:opacity-40 ${
        active ? 'bg-surface-2 text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'
      } ${className}`}
      {...rest}
    >
      <IconCmp size={17} weight={active ? 'bold' : 'regular'} aria-hidden />
    </button>
  )
}

export function Chip({
  active,
  count,
  children,
  onClick,
}: {
  active: boolean
  count?: number
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors ${
        active ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-ink hover:bg-surface-2'
      }`}
    >
      {children}
      {count !== undefined && <span className="font-mono text-[11px] text-muted">{count}</span>}
    </button>
  )
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1">
      <span className="flex flex-col">
        <span className="text-sm text-ink">{label}</span>
        {hint && <span className="text-xs leading-snug text-muted">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-surface-2 ring-1 ring-line transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent" />
        <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  )
}

export function Badge({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'accent' | 'danger' | 'strong'; children: ReactNode; title?: string }) {
  const cls = {
    strong: 'bg-accent text-[#1b1206]',
    neutral: 'bg-surface-2 text-muted',
    accent: 'bg-accent-soft text-accent-ink',
    danger: 'bg-danger-soft text-danger',
  }[tone]
  return (
    <span title={title} className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-medium text-muted">{children}</h3>
}

export const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`

export const formatDate = (ts: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ts)

export const formatEta = (sec?: number) =>
  sec === undefined ? '' : sec < 60 ? `about ${Math.max(5, Math.ceil(sec / 5) * 5)} s left` : `about ${Math.ceil(sec / 60)} min left`

/**
 * Explains why a control is unavailable. Disabled buttons receive no pointer events, so the tip
 * lives on this wrapper and shows on hover or keyboard focus. It renders in a portal with fixed
 * positioning so scrolling panels cannot clip it.
 */
export function Hint({ reason, children, className = '' }: { reason?: string | false | null; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)
  if (!reason) return <>{children}</>
  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const below = r.top < 80
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140), y: below ? r.bottom + 8 : r.top - 8, below })
  }
  return (
    <span
      ref={ref}
      className={`relative inline-flex ${className}`}
      tabIndex={0}
      aria-label={reason}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      onFocus={show}
      onBlur={() => setPos(null)}
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[70] w-max max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-xs leading-snug text-bg shadow-panel"
            style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.below ? '0' : '-100%'})` }}
          >
            {reason}
          </span>,
          document.body,
        )}
    </span>
  )
}
