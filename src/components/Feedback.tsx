import { CheckCircleIcon, InfoIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { setState, useStore } from '../state/store'
import { formatEta } from './ui'

/** Thin progress strip for scans and device operations, shown under the header. */
export function ProgressStrip() {
  const scan = useStore((s) => s.scan)
  const op = useStore((s) => s.op)
  const job = op ?? scan
  const eta = !op && scan?.etaSec !== undefined ? `, ${formatEta(scan.etaSec)}` : ''
  const label = op ? op.label : scan ? `${scan.phase}${scan.total ? ` ${Math.min(scan.done + 1, scan.total)} of ${scan.total}` : ''}${eta}` : ''
  const fraction = op
    ? op.total ? Math.min(1, op.done / op.total) : null
    : scan?.bytesTotal
      ? Math.min(1, (scan.bytesDone ?? 0) / scan.bytesTotal)
      : scan?.total
        ? Math.min(1, scan.done / scan.total)
        : null
  const detail = scan && !op ? scan.current?.replace('/ext/', '') : undefined

  return (
    <AnimatePresence>
      {job && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="relative border-b border-line bg-surface px-4 py-1.5"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3 text-xs">
            <span className="font-medium text-ink">{label}</span>
            {detail && <span className="truncate font-mono text-muted">{detail}</span>}
          </div>
          <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
            {fraction === null ? (
              <motion.div
                className="h-full w-1/3 bg-accent"
                animate={{ x: ['-100%', '300%'] }}
                transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
              />
            ) : (
              <motion.div className="h-full origin-left bg-accent" animate={{ scaleX: fraction }} transition={{ type: 'spring', stiffness: 120, damping: 24 }} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const ICON = { info: InfoIcon, success: CheckCircleIcon, error: WarningCircleIcon }

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON[t.tone]
          return (
            <motion.button
              key={t.id}
              type="button"
              layout
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              onClick={() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))}
              className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-left text-sm text-ink shadow-panel"
            >
              <Icon size={18} weight="bold" className={`mt-px shrink-0 ${t.tone === 'error' ? 'text-danger' : t.tone === 'success' ? 'text-accent' : 'text-muted'}`} aria-hidden />
              <span className="leading-snug">{t.text}</span>
            </motion.button>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
