/**
 * Builds minimal but valid FAP-shaped ELF files. Used by tests, so the real parser runs against the same byte layout fbt produces.
 */
import { FAP_MANIFEST_MAGIC, ICON_SIZE } from './fap'

export interface FapSpec {
  name: string
  apiMajor: number
  apiMinor: number
  target?: number
  versionMajor?: number
  versionMinor?: number
  stackSize?: number
  icon?: boolean[] | null
  compressIcon?: boolean
  strings?: string[]
  padding?: number
}

/** Greedy heatshrink encoder (window 8, lookahead 4). */
export function heatshrinkEncode(data: Uint8Array): Uint8Array {
  const bits: number[] = []
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1)
  }
  let i = 0
  while (i < data.length) {
    let bestLen = 0
    let bestOff = 0
    for (let off = 1; off <= Math.min(256, i); off++) {
      let len = 0
      while (len < 16 && i + len < data.length && data[i + len] === data[i - off + len]) len++
      if (len > bestLen) {
        bestLen = len
        bestOff = off
      }
    }
    if (bestLen >= 2) {
      push(0, 1)
      push(bestOff - 1, 8)
      push(bestLen - 1, 4)
      i += bestLen
    } else {
      push(1, 1)
      push(data[i], 8)
      i++
    }
  }
  const out = new Uint8Array(Math.ceil(bits.length / 8))
  bits.forEach((b, idx) => {
    if (b) out[idx >> 3] |= 0x80 >> (idx & 7)
  })
  return out
}

export function encodeIcon(pixels: boolean[], compress = false): Uint8Array {
  const stride = Math.ceil(ICON_SIZE / 8)
  const bitmap = new Uint8Array(stride * ICON_SIZE)
  pixels.forEach((on, idx) => {
    if (!on) return
    const x = idx % ICON_SIZE
    const y = Math.floor(idx / ICON_SIZE)
    bitmap[y * stride + (x >> 3)] |= 1 << (x & 7)
  })
  if (compress) {
    const enc = heatshrinkEncode(bitmap)
    return Uint8Array.from([0x01, 0x00, enc.length & 0xff, enc.length >> 8, ...enc])
  }
  return Uint8Array.from([0x00, ...bitmap])
}

export function buildManifest(spec: FapSpec): Uint8Array {
  const meta = new Uint8Array(85)
  const v = new DataView(meta.buffer)
  v.setUint32(0, FAP_MANIFEST_MAGIC, true)
  v.setUint32(4, 1, true)
  v.setUint16(8, spec.apiMinor, true)
  v.setUint16(10, spec.apiMajor, true)
  v.setUint16(12, spec.target ?? 7, true)
  v.setUint16(14, spec.stackSize ?? 2048, true)
  v.setUint32(16, (((spec.versionMajor ?? 1) & 0xffff) << 16) | ((spec.versionMinor ?? 0) & 0xffff), true)
  meta.set(new TextEncoder().encode(spec.name.slice(0, 31)), 20)
  if (spec.icon) {
    const icon = encodeIcon(spec.icon, spec.compressIcon)
    if (icon.length <= 32) {
      meta[52] = 1
      meta.set(icon, 53)
    }
  }
  return meta
}

export function buildFap(spec: FapSpec): Uint8Array {
  const enc = new TextEncoder()
  const meta = buildManifest(spec)
  const rodata = enc.encode((spec.strings ?? []).join('\0') + '\0')
  const code = new Uint8Array(spec.padding ?? 256).map((_, i) => (i * 37 + 11) & 0xff)
  const names = ['', '.text', '.rodata', '.fapmeta', '.shstrtab']
  const shstr = enc.encode(names.join('\0') + '\0')
  const nameOffsets = names.map((_, i) => names.slice(0, i).reduce((s, n) => s + n.length + 1, 0))

  const blobs = [code, rodata, meta, shstr]
  let offset = 52
  const placed = blobs.map((b) => {
    const at = offset
    offset += b.length
    return at
  })
  const shoff = (offset + 3) & ~3
  const total = shoff + names.length * 40
  const out = new Uint8Array(total)
  const v = new DataView(out.buffer)
  out.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1], 0)
  v.setUint16(16, 1, true) // ET_REL, as fbt produces
  v.setUint16(18, 40, true) // EM_ARM
  v.setUint32(20, 1, true)
  v.setUint32(0x20, shoff, true)
  v.setUint16(0x28, 52, true)
  v.setUint16(0x2e, 40, true)
  v.setUint16(0x30, names.length, true)
  v.setUint16(0x32, names.length - 1, true)
  blobs.forEach((b, i) => out.set(b, placed[i]))
  for (let i = 1; i < names.length; i++) {
    const base = shoff + i * 40
    v.setUint32(base, nameOffsets[i], true)
    v.setUint32(base + 4, i === names.length - 1 ? 3 : 1, true)
    v.setUint32(base + 16, placed[i - 1], true)
    v.setUint32(base + 20, blobs[i - 1].length, true)
  }
  return out
}
