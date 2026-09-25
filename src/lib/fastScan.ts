/**
 * Fast scan: a small script runs on the Flipper's own JS engine (mJS, `js` CLI command, present
 * in official 1.x and Momentum). It walks /ext/apps and reads only each app's ELF header,
 * section table and .fapmeta (about 1 KB of SD reads) instead of copying whole files over RPC.
 *
 * mJS is a restricted dialect: no closures (functions only see globals and arguments), no `new`,
 * no exceptions, `let` only. Keep the script to plain loops and helper functions, and never read
 * in "binary" mode (see the note inside the script).
 */
import { parseManifest, type FapInfo } from './fap'

export const FAST_SCAN_DIR = '/ext/.tmp/fpm'
export const FAST_SCAN_PATH = `${FAST_SCAN_DIR}/scan.js`

/** `limit` stops after that many apps. */
export function buildScanScript(onlyCapital: boolean, limit = 1000000): string {
  return `// Flipper Package Manager fast scan. Safe to delete.
// Reads use "ascii" strings on purpose: this mJS never frees ArrayBuffers ("binary" reads) until
// the script ends, which runs the Flipper out of memory after ~100 apps. Strings are collected,
// and charCodeAt returns the raw byte. Reads stay small because they land on an 8 KB stack.
let storage = require("storage");
let ONLY_CAP = ${onlyCapital ? 'true' : 'false'};
let LIMIT = ${Math.max(0, Math.floor(limit))};
let COUNT = 0;
let META = ".fapmeta";
let HEX = "0123456789abcdef";

function b(s, i) { return s.charCodeAt(i); }
function u16(s, o) { return b(s, o) + b(s, o + 1) * 256; }
function u32(s, o) { return b(s, o) + b(s, o + 1) * 256 + b(s, o + 2) * 65536 + b(s, o + 3) * 16777216; }

function hex(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    let v = b(s, i);
    // mJS maps at() to charCodeAt(), so take the digit with slice().
    out = out + HEX.slice(v >> 4, (v >> 4) + 1) + HEX.slice(v & 15, (v & 15) + 1);
  }
  return out;
}

function rd(file, off, n) {
  file.seekAbsolute(off);
  return file.read("ascii", n);
}

function isMeta(names, at) {
  if (at + 9 > names.length) { return false; }
  for (let i = 0; i < 8; i++) {
    if (b(names, at + i) !== b(META, i)) { return false; }
  }
  return b(names, at + 8) === 0;
}

function meta(path) {
  let file = storage.openFile(path, "r", "open_existing");
  if (file === undefined) { return "E:open"; }
  let result = "E:nometa";
  let h = rd(file, 0, 52);
  if (h.length < 52 || b(h, 0) !== 127 || b(h, 1) !== 69 || b(h, 2) !== 76 || b(h, 3) !== 70) {
    result = "E:notelf";
  } else {
    let shoff = u32(h, 32);
    let shent = u16(h, 46);
    let shnum = u16(h, 48);
    let shstr = u16(h, 50);
    let st = rd(file, shoff + shstr * shent, 24);
    if (shstr >= shnum || st.length < 24) {
      result = "E:table";
    } else {
      let nsize = u32(st, 20);
      if (nsize > 256) { nsize = 256; }
      let names = rd(file, u32(st, 16), nsize);
      for (let i = 0; i < shnum && result === "E:nometa"; i++) {
        let e = rd(file, shoff + i * shent, 24);
        if (e.length === 24 && isMeta(names, u32(e, 0))) {
          let size = u32(e, 20);
          if (size > 128) { size = 128; }
          result = "M:" + hex(rd(file, u32(e, 16), size));
        }
      }
    }
  }
  file.close();
  return result;
}

function hasUpper(name) {
  for (let i = 0; i < name.length; i++) {
    let c = name.charCodeAt(i);
    if (c >= 65 && c <= 90) { return true; }
  }
  return false;
}

function skipTop(name) {
  if (name.toLowerCase() === "assets") { return true; }
  if (!ONLY_CAP) { return false; }
  if (name.charCodeAt(0) === 46) { return true; }
  return !hasUpper(name);
}

function isFap(name) {
  let n = name.length;
  return n > 4 && name.slice(n - 4, n).toLowerCase() === ".fap";
}

function num(x) {
  if (x === undefined) { return "0"; }
  return x.toString();
}

function walk(dir, top) {
  let entries = storage.readDirectory(dir);
  if (entries === undefined) {
    print("FPM|X|" + dir);
    return;
  }
  for (let i = 0; i < entries.length && COUNT < LIMIT; i++) {
    let e = entries[i];
    let p = dir + "/" + e.path;
    if (e.isDirectory) {
      if (!(top && skipTop(e.path))) {
        print("FPM|D|" + p);
        walk(p, false);
      }
    } else if (isFap(e.path)) {
      COUNT = COUNT + 1;
      print("FPM|F|" + p + "|" + num(e.size) + "|" + meta(p));
    }
  }
}

print("FPM|BEGIN");
walk("/ext/apps", true);
print("FPM|END");
`
}

export type FastLine =
  | { kind: 'dir'; path: string }
  | { kind: 'file'; path: string; size: number; info: FapInfo }
  | { kind: 'unlisted'; path: string }
  | { kind: 'begin' }
  | { kind: 'end' }

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16))

const ERRORS: Record<string, string> = {
  'E:open': 'Could not open the file',
  'E:notelf': 'Not an ELF file',
  'E:table': 'Truncated section table',
  'E:nometa': 'No .fapmeta section',
}

/** Parses one line of script output. Returns null for anything that isn't ours (echo, prompts). */
export function parseFastLine(line: string): FastLine | null {
  const at = line.indexOf('FPM|')
  if (at === -1) return null
  const parts = line.slice(at).trim().split('|')
  switch (parts[1]) {
    case 'BEGIN':
      return { kind: 'begin' }
    case 'END':
      return { kind: 'end' }
    case 'D':
      return { kind: 'dir', path: parts[2] }
    case 'X':
      return { kind: 'unlisted', path: parts[2] }
    case 'F': {
      // Paths cannot contain '|' on FAT, so the last two fields are always size and result.
      const result = parts[parts.length - 1]
      const size = Number(parts[parts.length - 2]) || 0
      const path = parts.slice(2, parts.length - 2).join('|')
      let info: FapInfo
      if (result.startsWith('M:')) {
        try {
          info = { manifest: parseManifest(hexToBytes(result.slice(2))), urls: [], sections: ['.fapmeta'], partial: true }
        } catch (e) {
          info = { manifest: null, urls: [], sections: [], error: (e as Error).message }
        }
      } else {
        info = { manifest: null, urls: [], sections: [], error: ERRORS[result] ?? result }
      }
      return { kind: 'file', path, size, info }
    }
    default:
      return null
  }
}
