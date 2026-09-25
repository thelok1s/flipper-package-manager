import { heatshrinkDecode } from './heatshrink'

export const FAP_MANIFEST_MAGIC = 0x52474448
export const ICON_SIZE = 10

/** Mirrors FlipperApplicationManifestV1 from lib/flipper_application/application_manifest.h */
export interface FapManifest {
  manifestVersion: number
  apiMajor: number
  apiMinor: number
  hardwareTarget: number
  stackSize: number
  versionMajor: number
  versionMinor: number
  name: string
  /** 10x10 1-bit icon, row-major, true = lit (dark) pixel. Null when the app ships none. */
  icon: boolean[] | null
}

export interface FapInfo {
  manifest: FapManifest | null
  /** Web links found inside the binary's string data (about screens, credits). */
  urls: string[]
  sections: string[]
  error?: string
  /** Read by the fast scan: manifest only, embedded links not read yet. */
  partial?: boolean
  /** SHA-256 of the whole file, when it was read in full. Compared with the catalog's fap_hash. */
  sha256?: string
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Parses a whole .fap and records its hash. */
export async function parseFapHashed(bytes: Uint8Array): Promise<FapInfo> {
  return { ...parseFap(bytes), sha256: await sha256Hex(bytes) }
}

interface Section {
  name: string
  offset: number
  size: number
}

function readSections(bytes: Uint8Array): Section[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 52 || view.getUint32(0, false) !== 0x7f454c46) throw new Error('Not an ELF file')
  if (bytes[4] !== 1) throw new Error('Not a 32-bit ELF')
  const le = bytes[5] === 1
  const shoff = view.getUint32(0x20, le)
  const shentsize = view.getUint16(0x2e, le)
  const shnum = view.getUint16(0x30, le)
  const shstrndx = view.getUint16(0x32, le)
  if (!shoff || shoff + shnum * shentsize > bytes.length) throw new Error('Truncated section table')

  const header = (i: number) => {
    const base = shoff + i * shentsize
    return {
      nameOffset: view.getUint32(base, le),
      offset: view.getUint32(base + 16, le),
      size: view.getUint32(base + 20, le),
    }
  }
  const strtab = header(shstrndx)
  const decoder = new TextDecoder()
  const nameAt = (off: number) => {
    const start = strtab.offset + off
    let end = start
    while (end < bytes.length && bytes[end] !== 0) end++
    return decoder.decode(bytes.subarray(start, end))
  }

  const sections: Section[] = []
  for (let i = 0; i < shnum; i++) {
    const h = header(i)
    sections.push({ name: nameAt(h.nameOffset), offset: h.offset, size: h.size })
  }
  return sections
}

function cString(bytes: Uint8Array) {
  const end = bytes.indexOf(0)
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end)).trim()
}

/** Decodes a Flipper compressed image blob into width*height pixels. */
export function decodeIcon(data: Uint8Array, width = ICON_SIZE, height = ICON_SIZE): boolean[] | null {
  if (!data.length) return null
  let bitmap: Uint8Array
  if (data[0] === 0x00) {
    bitmap = data.subarray(1)
  } else if (data[0] === 0x01) {
    // [0x01, 0x00, size lo, size hi, heatshrink stream...]
    const size = data[2] | (data[3] << 8)
    bitmap = heatshrinkDecode(data.subarray(4, 4 + size))
  } else {
    return null
  }
  const stride = Math.ceil(width / 8)
  if (bitmap.length < stride * height) return null
  const pixels: boolean[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // XBM order: least significant bit is the leftmost pixel.
      pixels.push(((bitmap[y * stride + (x >> 3)] >> (x & 7)) & 1) === 1)
    }
  }
  return pixels
}

export function parseManifest(meta: Uint8Array): FapManifest {
  const view = new DataView(meta.buffer, meta.byteOffset, meta.byteLength)
  if (meta.length < 14) throw new Error('Manifest too short')
  if (view.getUint32(0, true) !== FAP_MANIFEST_MAGIC) throw new Error('Bad manifest magic')
  const manifestVersion = view.getUint32(4, true)
  const base = {
    manifestVersion,
    apiMinor: view.getUint16(8, true),
    apiMajor: view.getUint16(10, true),
    hardwareTarget: view.getUint16(12, true),
  }
  if (manifestVersion !== 1 || meta.length < 14 + 2 + 4 + 32 + 1) {
    return { ...base, stackSize: 0, versionMajor: 0, versionMinor: 0, name: '', icon: null }
  }
  const appVersion = view.getUint32(16, true)
  const hasIcon = meta[52] !== 0
  return {
    ...base,
    stackSize: view.getUint16(14, true),
    versionMajor: appVersion >>> 16,
    versionMinor: appVersion & 0xffff,
    name: cString(meta.subarray(20, 52)),
    icon: hasIcon ? decodeIcon(meta.subarray(53, 53 + 32)) : null,
  }
}

const URL_RE = /https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[A-Za-z0-9._~%/#?=&+:@!-]*)?/g

/** Finds printable http(s) links in the binary. Apps often embed their repo in an About screen. */
export function extractUrls(bytes: Uint8Array): string[] {
  const found = new Set<string>()
  const latin = new TextDecoder('latin1').decode(bytes)
  for (const m of latin.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,:;)!?]+$/, '')
    if (url.length > 12 && url.length < 200) found.add(url)
  }
  // Repository hosts first; they are the most useful "where did this come from" link.
  const rank = (u: string) => (/github\.com|gitlab\.com|codeberg\.org|bitbucket\.org/.test(u) ? 0 : 1)
  return [...found].sort((a, b) => rank(a) - rank(b))
}

export function parseFap(bytes: Uint8Array): FapInfo {
  try {
    const sections = readSections(bytes)
    const meta = sections.find((s) => s.name === '.fapmeta')
    const manifest = meta ? parseManifest(bytes.subarray(meta.offset, meta.offset + meta.size)) : null
    return {
      manifest,
      urls: extractUrls(bytes),
      sections: sections.map((s) => s.name).filter(Boolean),
      error: meta ? undefined : 'No .fapmeta section',
    }
  } catch (e) {
    return { manifest: null, urls: [], sections: [], error: (e as Error).message }
  }
}

export const formatVersion = (m: Pick<FapManifest, 'versionMajor' | 'versionMinor'>) => `${m.versionMajor}.${m.versionMinor}`
export const formatApi = (m: Pick<FapManifest, 'apiMajor' | 'apiMinor'>) => `${m.apiMajor}.${m.apiMinor}`
