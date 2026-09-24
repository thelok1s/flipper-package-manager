import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from './ui'

interface Request {
  title: string
  body: ReactNode
  confirmLabel: string
  tone: 'primary' | 'danger'
  resolve: (ok: boolean) => void
}

let current: Request | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((s) => s())

/** Promise-based confirmation dialog: `if (await ask({...})) doIt()`. */
export function ask(o: Omit<Request, 'resolve' | 'tone'> & { tone?: Request['tone'] }): Promise<boolean> {
  return new Promise((resolve) => {
    current = { tone: 'primary', ...o, resolve }
    emit()
  })
}

function close(ok: boolean) {
  current?.resolve(ok)
  current = null
  emit()
}

export function ConfirmHost() {
  const req = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => current,
  )
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!req) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])

  return (
    <AnimatePresence>
      {req && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[rgb(10_11_13/0.45)] p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => close(false)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="w-full max-w-md rounded-lg border border-line bg-surface p-5 shadow-panel"
            initial={{ y: 12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-title" className="text-base font-semibold text-ink">
              {req.title}
            </h2>
            <div className="mt-2 text-sm leading-relaxed text-muted">{req.body}</div>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => close(false)}>Cancel</Button>
              <Button ref={confirmRef} tone={req.tone} onClick={() => close(true)}>
                {req.confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
