import { describe, expect, it } from 'vitest'
import { buildFap } from './fapBuilder'
import { buildScanScript, parseFastLine } from './fastScan'

/**
 * Runs the on-device script in Node with shims for the Flipper JS runtime: `require("storage")`,
 * `print`, and mJS's `Uint8Array(buffer)` called without `new`.
 */
function runScript(files: Record<string, Uint8Array>, onlyCapital = true) {
  const dirs = new Set<string>()
  for (const p of Object.keys(files)) {
    let d = p.slice(0, p.lastIndexOf('/'))
    while (d.length > 1) {
      dirs.add(d)
      d = d.slice(0, d.lastIndexOf('/'))
    }
  }
  const storage = {
    openFile(path: string) {
      const bytes = files[path]
      if (!bytes) return undefined
      let pos = 0
      return {
        seekAbsolute: (o: number) => ((pos = o), true),
        read: (_mode: string, n: number) => {
          const out = bytes.slice(pos, pos + n)
          pos += out.length
          return out.buffer
        },
        close: () => true,
      }
    },
    readDirectory(dir: string) {
      if (!dirs.has(dir)) return undefined
      const out: { path: string; isDirectory: boolean; size: number }[] = []
      for (const d of dirs) if (d.startsWith(dir + '/') && !d.slice(dir.length + 1).includes('/')) out.push({ path: d.slice(dir.length + 1), isDirectory: true, size: 0 })
      for (const [p, b] of Object.entries(files))
        if (p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/')) out.push({ path: p.slice(dir.length + 1), isDirectory: false, size: b.length })
      return out
    },
  }
  const lines: string[] = []
  const U8 = (x: ArrayBuffer | number[]) => new Uint8Array(x as ArrayBuffer)
  new Function('require', 'print', 'Uint8Array', buildScanScript(onlyCapital))(
    () => storage,
    (...a: unknown[]) => lines.push(a.join(' ')),
    U8,
  )
  return lines
}

const icon = Array.from({ length: 100 }, (_, i) => i % 3 === 0)

describe('fast scan script', () => {
  it('walks apps, skips internal folders and reports manifests', () => {
    const lines = runScript({
      '/ext/apps/GPIO/radar.fap': buildFap({ name: '[LD2450] Motion tracker', apiMajor: 86, apiMinor: 0, versionMajor: 0, versionMinor: 4, icon, compressIcon: true, padding: 5000 }),
      '/ext/apps/iButton/ibtn.fap': buildFap({ name: 'iButton', apiMajor: 87, apiMinor: 1 }),
      '/ext/apps/root.fap': buildFap({ name: 'Root', apiMajor: 87, apiMinor: 1 }),
      '/ext/apps/assets/about.fap': buildFap({ name: 'About', apiMajor: 87, apiMinor: 1 }),
      '/ext/apps/downloads/junk.fap': buildFap({ name: 'Junk', apiMajor: 87, apiMinor: 1 }),
      '/ext/apps/Tools/broken.fap': new TextEncoder().encode('not an elf at all, just text padding to fifty-two bytes....'),
      '/ext/apps/Tools/readme.txt': new TextEncoder().encode('hi'),
    })
    expect(lines[0]).toBe('FPM|BEGIN')
    expect(lines.at(-1)).toBe('FPM|END')
    const parsed = lines.map(parseFastLine)
    const files = parsed.flatMap((l) => (l?.kind === 'file' ? [l] : []))
    expect(files.map((f) => f.path).sort()).toEqual(['/ext/apps/GPIO/radar.fap', '/ext/apps/Tools/broken.fap', '/ext/apps/iButton/ibtn.fap', '/ext/apps/root.fap'])
    const radar = files.find((f) => f.path.endsWith('radar.fap'))!
    expect(radar.info.partial).toBe(true)
    expect(radar.info.manifest).toMatchObject({ name: '[LD2450] Motion tracker', apiMajor: 86, apiMinor: 0, versionMajor: 0, versionMinor: 4 })
    expect(radar.info.manifest?.icon).toEqual(icon)
    expect(files.find((f) => f.path.endsWith('broken.fap'))!.info.error).toBe('Not an ELF file')
    expect(parsed.filter((l) => l?.kind === 'dir').map((l) => (l as { path: string }).path).sort()).toEqual(['/ext/apps/GPIO', '/ext/apps/Tools', '/ext/apps/iButton'])
  })

  it('includes lowercase folders when the filter is off, but never assets', () => {
    const lines = runScript(
      { '/ext/apps/downloads/junk.fap': buildFap({ name: 'Junk', apiMajor: 87, apiMinor: 1 }), '/ext/apps/assets/a.fap': buildFap({ name: 'A', apiMajor: 87, apiMinor: 1 }) },
      false,
    )
    expect(lines).toContain('FPM|D|/ext/apps/downloads')
    expect(lines.some((l) => l.includes('assets'))).toBe(false)
  })

  it('ignores CLI noise around the output', () => {
    expect(parseFastLine('>: js /ext/.tmp/fpm/scan.js')).toBeNull()
    expect(parseFastLine('Running script /ext/.tmp/fpm/scan.js, press CTRL+C to stop')).toBeNull()
    expect(parseFastLine('FPM|END\r')).toEqual({ kind: 'end' })
  })
})
