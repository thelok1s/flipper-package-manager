import { setState, useStore } from '../state/store'

type Method = 'rpc' | 'js'

const LABEL: Record<Method, string> = { rpc: 'Full read', js: 'On-device JS' }

/**
 * Full read is the default: measured on a Momentum Flipper it took ~0.3 s per app against ~2.3 s
 * for the on-device JS scan, because the Flipper's JS engine is far slower than copying the file.
 */
export function ScanMethodPicker() {
  const method = useStore((s) => s.prefs.scanMethod)
  const jsScan = useStore((s) => s.jsScan)
  const scanning = useStore((s) => s.status === 'scanning')
  return (
    <div>
      <div className="mb-1.5 text-sm text-ink">Scan method</div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Scan method">
        {(['rpc', 'js'] as Method[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            disabled={scanning}
            onClick={() => setState((s) => ({ prefs: { ...s.prefs, scanMethod: m } }))}
            className={`h-7 rounded-md text-[12px] transition-colors ${method === m ? 'bg-surface font-medium text-ink shadow-panel' : 'text-muted hover:text-ink'}`}
          >
            {LABEL[m]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs leading-snug text-muted">
        {method === 'rpc'
          ? 'Copies each app over USB and reads it here. About 8x faster.'
          : jsScan === 'unavailable'
            ? 'No JS engine on this firmware, so scans use full read.'
            : 'Parses apps on the Flipper itself. Only faster if the computer you are using is a toaster.'}
      </p>
    </div>
  )
}
