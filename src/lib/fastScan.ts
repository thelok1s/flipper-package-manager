/**
 * Fast scan: a small script runs on the Flipper's own JS engine (mJS, `js` CLI command, present
 * in official 1.x and Momentum). It walks /ext/apps and reads only each app's ELF header,
 * section table and .fapmeta (about 1 KB of SD reads) instead of copying whole files over RPC.
 *
 * mJS is a restricted dialect: no closures (functions only see globals and arguments), no `new`,
 * no exceptions, `let` only. Keep the script to plain loops and helper functions.
 */
import { parseManifest, type FapInfo } from './fap'

export const FAST_SCAN_DIR = '/ext/.tmp/fpm'
export const FAST_SCAN_PATH = `${FAST_SCAN_DIR}/scan.js`

export function buildScanScript(onlyCapital: boolean): string {
  return `// Flipper Package Manager fast scan. Safe to delete.
let storage = require("storage");
let ONLY_CAP = ${onlyCapital ? 'true' : 'false'};
let META = [46, 102, 97, 112, 109, 101, 116, 97, 0];

function u16(u, o) { return u[o] + u[o + 1] * 256; }
function u32(u, o) { return u[o] + u[o + 1] * 256 + u[o + 2] * 65536 + u[o + 3] * 16777216; }

function hex(u, n) {
  let s = "";
  for (let i = 0; i < n; i++) {
    let b = u[i];
    if (b < 16) { s = s + "0"; }
    s = s + b.toString(16);
  }
  return s;
}

function readAt(file, off, n) {
  file.seekAbsolute(off);
  return file.read("binary", n);
}

function isMeta(names, at, len) {
  if (at + 9 > len) { return false; }
  for (let i = 0; i < 9; i++) {
    if (names[at + i] !== META[i]) { return false; }
  }
  return true;
}

function meta(path) {
  let file = storage.openFile(path, "r", "open_existing");
  if (file === undefined) { return "E:open"; }
  let result = "E:nometa";
  let hb = readAt(file, 0, 52);
  let h = Uint8Array(hb);
  if (hb.byteLength < 52 || h[0] !== 127 || h[1] !== 69 || h[2] !== 76 || h[3] !== 70) {
    result = "E:notelf";
  } else {
    let shoff = u32(h, 32);
    let shent = u16(h, 46);
    let shnum = u16(h, 48);
    let shstr = u16(h, 50);
    let tb = readAt(file, shoff, shent * shnum);
    if (tb.byteLength < shent * shnum || shstr >= shnum) {
      result = "E:table";
    } else {
      let t = Uint8Array(tb);
      let nb = readAt(file, u32(t, shstr * shent + 16), u32(t, shstr * shent + 20));
      let names = Uint8Array(nb);
      for (let i = 0; i < shnum; i++) {
        if (isMeta(names, u32(t, i * shent), nb.byteLength)) {
          let size = u32(t, i * shent + 20);
          if (size > 128) { size = 128; }
          let mb = readAt(file, u32(t, i * shent + 16), size);
          result = "M:" + hex(Uint8Array(mb), mb.byteLength);
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
  for (let i = 0; i < entries.length; i++) {
    let e = entries[i];
    let p = dir + "/" + e.path;
    if (e.isDirectory) {
      if (!(top && skipTop(e.path))) {
        print("FPM|D|" + p);
        walk(p, false);
      }
    } else if (isFap(e.path)) {
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
