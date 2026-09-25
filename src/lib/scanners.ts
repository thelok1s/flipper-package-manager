/**
 * The two ways to read app manifests.
 *  - listFaps + RPC reads (default): copy every .fap over RPC and parse it here. Works everywhere,
 *    and benchmarked ~8x faster (0.3 s vs 2.3 s per app on a Momentum Flipper).
 *  - runJsScan: parse on the Flipper with its JS engine and stream one line per app.
 */
import type { FlipperDevice } from '../flipper/types'
import { FAST_SCAN_DIR, FAST_SCAN_PATH, buildScanScript, parseFastLine } from './fastScan'
import type { FapInfo } from './fap'
import { APPS_ROOT, joinPath } from './manifests'

/** Firmware-internal folders under /ext/apps that hold settings screens and helpers, not user apps. */
const INTERNAL_FOLDERS = new Set(['assets'])

/**
 * Menu categories carry capitals (Games, GPIO, Sub-GHz, and iButton, which starts lowercase);
 * all-lowercase and dot folders are firmware internals or scratch space.
 */
export function skipTopFolder(name: string, onlyCapital: boolean) {
  if (INTERNAL_FOLDERS.has(name.toLowerCase())) return true
  return onlyCapital && (name.startsWith('.') || !/[A-Z]/.test(name))
}

export async function ensureDir(d: FlipperDevice, dir: string) {
  let current = ''
  for (const p of dir.split('/').filter(Boolean)) {
    current += '/' + p
    if (current === '/ext') continue
    await d.mkdir(current)
  }
}

export interface ListedFap {
  path: string
  size: number
}

/** Walks /ext/apps over RPC. Folders that fail twice are reported, not fatal. */
export async function listFaps(
  d: FlipperDevice,
  opts: { onlyCapital: boolean; limit?: number; onDir?: (path: string) => void },
): Promise<{ files: ListedFap[]; folders: string[]; unlisted: string[] }> {
  const limit = opts.limit ?? Infinity
  const files: ListedFap[] = []
  const folders: string[] = ['']
  const unlisted: string[] = []
  const listDir = async (dir: string) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await d.list(dir)
      } catch (e) {
        if (/not connected|disconnected/i.test((e as Error).message)) throw e
        if (attempt >= 1) {
          unlisted.push(dir.replace('/ext/', ''))
          return []
        }
      }
    }
  }
  const walk = async (dir: string) => {
    for (const e of await listDir(dir)) {
      if (files.length >= limit) return
      const p = joinPath(dir, e.name)
      if (e.type === 'dir') {
        if (dir === APPS_ROOT && skipTopFolder(e.name, opts.onlyCapital)) continue
        folders.push(p.slice(APPS_ROOT.length + 1))
        opts.onDir?.(p)
        await walk(p)
      } else if (e.name.toLowerCase().endsWith('.fap')) {
        files.push({ path: p, size: e.size })
      }
    }
  }
  await walk(APPS_ROOT)
  folders.sort((a, b) => a.localeCompare(b))
  return { files, folders, unlisted }
}

export class FastScanUnsupported extends Error {}

/**
 * Uploads and runs the fast-scan script. Throws FastScanUnsupported when the firmware has no
 * `js` command, or Error when the script fails or stops early.
 */
export async function runJsScan(
  d: FlipperDevice,
  opts: { onlyCapital: boolean; limit?: number; onFile?: (f: { path: string; size: number; info: FapInfo }) => void },
): Promise<{ files: { path: string; size: number; info: FapInfo }[]; folders: string[]; unlisted: string[] }> {
  if (!d.runCli) throw new FastScanUnsupported('this connection cannot run CLI commands')
  const files: { path: string; size: number; info: FapInfo }[] = []
  const folders: string[] = ['']
  const unlisted: string[] = []
  let sawBegin = false
  let sawEnd = false
  let partialLine = ''
  const handle = (line: string) => {
    const parsed = parseFastLine(line)
    if (!parsed) return
    if (parsed.kind === 'begin') sawBegin = true
    else if (parsed.kind === 'end') sawEnd = true
    else if (parsed.kind === 'unlisted') unlisted.push(parsed.path.replace('/ext/', ''))
    else if (parsed.kind === 'dir') folders.push(parsed.path.slice(APPS_ROOT.length + 1))
    else {
      const f = { path: parsed.path, size: parsed.size, info: parsed.info }
      files.push(f)
      opts.onFile?.(f)
    }
  }
  try {
    await ensureDir(d, FAST_SCAN_DIR)
    await d.write(FAST_SCAN_PATH, new TextEncoder().encode(buildScanScript(opts.onlyCapital, opts.limit)))
    const out = await d.runCli(`js ${FAST_SCAN_PATH}`, {
      done: /FPM\|END|---- ERROR ----|\n>: ?$/,
      idleMs: 20000,
      onText: (chunk) => {
        const lines = (partialLine + chunk).split(/\r?\n/)
        partialLine = lines.pop() ?? ''
        lines.forEach(handle)
      },
    })
    if (partialLine) handle(partialLine)
    if (!out.includes('Running script') && !sawBegin) throw new FastScanUnsupported('this firmware has no js command')
    if (out.includes('---- ERROR ----')) {
      const detail = out.slice(out.indexOf('---- ERROR ----') + 15).trim().split(/\r?\n/)[0]
      throw new Error(`the script failed on the Flipper (${detail || 'no details'})`)
    }
    if (!sawEnd) throw new Error('the script stopped before finishing')
    folders.sort((a, b) => a.localeCompare(b))
    return { files, folders, unlisted }
  } finally {
    await d.remove(FAST_SCAN_PATH).catch(() => undefined)
  }
}
