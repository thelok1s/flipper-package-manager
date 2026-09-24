import { TimerIcon, XIcon } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { runBenchmark, type BenchMethod, type BenchRow } from '../state/benchmark'
import { setState, toast, useStore } from '../state/store'
import { Button } from './ui'

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** Sidebar control: the benchmark winner is the default, the other method the alternative. */
export function ScanMethodPicker() {
  const method = useStore((s) => s.prefs.scanMethod)
  const jsScan = useStore((s) => s.jsScan)
  const running = useStore((s) => s.benchmark?.running ?? false)
  const report = useStore((s) => s.benchReport)
  const all = report?.rows.filter((r) => r.size === 'all' && !r.error)
  const options: BenchMethod[] = report?.fastest === 'rpc' ? ['rpc', 'js'] : ['js', 'rpc']
  return (
    <div>
      <div className="mb-1.5 text-sm text-ink">Scan method</div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Scan method">
        {options.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            disabled={running}
            onClick={() => setState((s) => ({ prefs: { ...s.prefs, scanMethod: m } }))}
            className={`h-7 rounded-md text-[12px] transition-colors ${method === m ? 'bg-surface font-medium text-ink shadow-panel' : 'text-muted hover:text-ink'}`}
          >
            {m === 'js' ? 'On-device JS' : 'Full read'}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs leading-snug text-muted">
        {method === 'js' && jsScan === 'unavailable'
          ? 'No JS engine on this firmware, so scans use full reads.'
          : all?.length
            ? `Benchmark, ${all[0].apps} apps: ${all.map((r) => `${r.method === 'js' ? 'JS' : 'full read'} ${seconds(r.ms)}`).join(', ')}.`
            : 'On-device JS reads only each manifest; full read copies every app over USB.'}
      </p>
    </div>
  )
}

function ResultsTable({ rows, fastest }: { rows: BenchRow[]; fastest?: BenchMethod }) {
  if (!rows.length) return null
  return (
    <table className="mt-3 w-full text-left text-[12px]">
      <thead className="text-muted">
        <tr>
          <th className="py-1 font-medium">Run</th>
          <th className="py-1 font-medium">Method</th>
          <th className="py-1 font-medium">Apps</th>
          <th className="py-1 text-right font-medium">Time</th>
          <th className="py-1 text-right font-medium">Per app</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {rows.map((r, i) => (
          <tr key={i} className={r.method === fastest ? 'text-ink' : 'text-muted'}>
            <td className="py-0.5 font-sans">{r.size === 'all' ? 'All' : `First ${r.size}`}</td>
            <td className="py-0.5 font-sans">{r.method === 'js' ? 'JS' : 'Full read'}</td>
            <td className="py-0.5">{r.error ? '-' : r.apps}</td>
            <td className="py-0.5 text-right">{r.error ? <span className="font-sans text-danger" title={r.error}>failed</span> : seconds(r.ms)}</td>
            <td className="py-0.5 text-right">{r.error || !r.apps ? '' : `${Math.round(r.ms / r.apps)} ms`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Temporary benchmark UI. The panel appears with `?bench` in the URL; the blocking overlay appears
 * whenever a benchmark runs, including one started from the console with `fpmBenchmark()`.
 */
export function BenchmarkPanel() {
  const bench = useStore((s) => s.benchmark)
  const connected = useStore((s) => s.status === 'ready')
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has('bench'))
  const report = useStore((s) => s.benchReport)

  const start = async () => {
    try {
      await runBenchmark()
    } catch (e) {
      toast(`Benchmark failed: ${(e as Error).message}`, 'error')
    }
  }

  return (
    <>
      {open && !bench?.running && (
        <div className="fixed bottom-4 left-4 z-30 w-[320px] rounded-lg border border-line bg-surface p-4 shadow-panel">
          <div className="flex items-center gap-2">
            <TimerIcon size={16} className="text-accent-ink" aria-hidden />
            <h2 className="text-sm font-semibold text-ink">Scan benchmark</h2>
            <button type="button" aria-label="Hide benchmark" className="ml-auto text-muted hover:text-ink" onClick={() => setOpen(false)}>
              <XIcon size={14} />
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Times both scan methods on 10, 100 and all apps without the cache. The faster one becomes the default.
          </p>
          <ResultsTable rows={report?.rows ?? []} fastest={report?.fastest} />
          <Button className="mt-3 w-full" tone="primary" size="sm" disabled={!connected} onClick={start}>
            {connected ? 'Run benchmark' : 'Connect and finish scanning first'}
          </Button>
        </div>
      )}
      <AnimatePresence>
        {bench?.running && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(10_11_13/0.6)] p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="alertdialog"
            aria-modal="true"
            aria-label="Benchmark running"
          >
            <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-5 shadow-panel">
              <h2 className="text-base font-semibold text-ink">Benchmarking scan methods</h2>
              <p className="mt-1 text-sm text-muted">The app is paused until this finishes. Keep the Flipper connected.</p>
              <p className="mt-3 animate-pulse text-sm text-ink">{bench.step}</p>
              <ResultsTable rows={bench.rows} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
