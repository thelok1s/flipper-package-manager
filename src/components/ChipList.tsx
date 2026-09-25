import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const ROW = 28 // chip height (h-7)
const GAP = 6 // gap-1.5

/** Wrapping chip list that shows `rows` rows and a "Show N more" toggle for the rest. */
export function ChipList({ children, rows = 2 }: { children: ReactNode; rows?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(0)
  const max = rows * ROW + (rows - 1) * GAP

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const top = el.getBoundingClientRect().top
      setHidden([...el.children].filter((c) => c.getBoundingClientRect().top - top >= max).length)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [children, max])

  return (
    <div>
      <div ref={ref} className="flex flex-wrap gap-1.5 overflow-hidden" style={open ? undefined : { maxHeight: max }}>
        {children}
      </div>
      {(hidden > 0 || open) && (
        <button type="button" className="mt-1.5 text-xs text-accent-ink hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : `Show ${hidden} more`}
        </button>
      )}
    </div>
  )
}
