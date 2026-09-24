/**
 * Temporary benchmark: compares the JS fast scan with full RPC reads on the first 10, the first
 * 100 and all apps, cold (no cache). The faster method on the largest completed size becomes the
 * default scan method. Start it from the `?bench` panel or from the console: `await fpmBenchmark()`.
 */
import { parseFap } from '../lib/fap'
import { listFaps, runJsScan } from '../lib/scanners'
import { getState, setState, toast } from './store'

export type BenchMethod = 'js' | 'rpc'
export type BenchSize = 10 | 100 | 'all'

export interface BenchRow {
  method: BenchMethod
  size: BenchSize
  apps: number
  ms: number
  /** Bytes copied over USB for .fap data (RPC only; the JS scan sends ~200 bytes of text per app). */
  bytes: number
  error?: string
}

export interface BenchReport {
  at: number
  firmware: string
  api: string
  rows: BenchRow[]
  fastest?: BenchMethod
}

const KEY = 'fpm.benchmark.v1'
export const METHOD_LABEL: Record<BenchMethod, string> = { js: 'On-device JS', rpc: 'Full read (RPC)' }

export const lastBenchmark = (): BenchReport | null => getState().benchReport

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function measure(method: BenchMethod, size: BenchSize): Promise<BenchRow> {
  const d = getState().device
  if (!d) throw new Error('Flipper disconnected')
  const onlyCapital = getState().prefs.onlyCapitalFolders
  const limit = size === 'all' ? undefined : size
  const row: BenchRow = { method, size, apps: 0, ms: 0, bytes: 0 }
  const started = performance.now()
  try {
    if (method === 'js') {
      const r = await runJsScan(d, { onlyCapital, limit })
      row.apps = r.files.length
    } else {
      const { files } = await listFaps(d, { onlyCapital, limit })
      for (const f of files) {
        const data = await d.read(f.path)
        parseFap(data)
        row.bytes += data.length
        row.apps++
      }
    }
  } catch (e) {
    if (!getState().device) throw e
    row.error = errorText(e)
  }
  row.ms = Math.round(performance.now() - started)
  return row
}

export async function runBenchmark(
  opts: { sizes?: BenchSize[]; methods?: BenchMethod[] } = {},
): Promise<BenchReport> {
  const s = getState()
  if (!s.device || !s.deviceInfo) throw new Error('Connect a Flipper first')
  if (s.benchmark?.running) throw new Error('A benchmark is already running')
  if (s.status === 'scanning' || s.op) throw new Error('Wait for the current scan or operation to finish')
  const sizes = opts.sizes ?? [10, 100, 'all']
  const methods = opts.methods ?? ['js', 'rpc']
  const report: BenchReport = {
    at: Date.now(),
    firmware: s.deviceInfo.firmwareVersion,
    api: `${s.deviceInfo.apiMajor}.${s.deviceInfo.apiMinor}`,
    rows: [],
  }
  setState({ benchmark: { running: true, step: 'Starting', rows: [] } })
  try {
    for (const [i, size] of sizes.entries()) {
      // Alternate the order so neither method always runs on a warm SD card.
      const order = i % 2 === 0 ? methods : [...methods].reverse()
      for (const method of order) {
        setState({ benchmark: { running: true, step: `${METHOD_LABEL[method]}, ${size === 'all' ? 'all apps' : `${size} apps`}`, rows: [...report.rows] } })
        report.rows.push(await measure(method, size))
      }
    }
    // Decide on the largest size where every method finished.
    for (const size of [...sizes].reverse()) {
      const rows = report.rows.filter((r) => r.size === size && !r.error && r.apps > 0)
      if (rows.length === methods.length) {
        report.fastest = rows.reduce((a, b) => (b.ms / b.apps < a.ms / a.apps ? b : a)).method
        break
      }
    }
    if (!report.fastest) {
      const ok = report.rows.filter((r) => !r.error)
      if (ok.length) report.fastest = ok[0].method
    }
    if (report.fastest) {
      setState((st) => ({ prefs: { ...st.prefs, scanMethod: report.fastest! }, jsScan: report.fastest === 'js' ? 'available' : st.jsScan }))
      toast(`Benchmark done. ${METHOD_LABEL[report.fastest]} is now the default scan method.`, 'success')
    }
    setState({ benchReport: report })
    try {
      localStorage.setItem(KEY, JSON.stringify(report))
    } catch {
      /* private mode */
    }
    console.table(
      report.rows.map((r) => ({
        method: METHOD_LABEL[r.method],
        size: r.size,
        apps: r.apps,
        seconds: +(r.ms / 1000).toFixed(2),
        'ms per app': r.apps ? Math.round(r.ms / r.apps) : null,
        'KB over USB': r.bytes ? Math.round(r.bytes / 1024) : null,
        error: r.error ?? '',
      })),
    )
    return report
  } finally {
    setState({ benchmark: { running: false, step: '', rows: [...report.rows] } })
  }
}
