import { createStore, get, set } from 'idb-keyval'
import { parseResourcesManifest } from './manifests'

/**
 * The list of apps that ship with the official Flipper firmware. Each release publishes a
 * resources archive whose `resources/Manifest` names every .fap it installs to the SD card.
 * update.flipperzero.one sends CORS headers, so this works straight from the browser.
 */
const DIRECTORY_URL = 'https://update.flipperzero.one/firmware/directory.json'
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const cacheStore = createStore('fpm-official', 'entries')

export interface OfficialApps {
  version: string
  fetchedAt: number
  /** Lower-cased absolute paths, e.g. /ext/apps/nfc/nfc.fap */
  paths: string[]
  /** Lower-cased file names, to recognise official apps that a fork moved to another folder. */
  fileNames: string[]
}

interface Directory {
  channels: { id: string; versions: { version: string; files: { type: string; target: string; url: string }[] }[] }[]
}

/** Minimal ustar reader: returns the contents of the first entry whose name matches. */
export function untarFile(tar: Uint8Array, match: (name: string) => boolean): Uint8Array | null {
  const text = new TextDecoder()
  const field = (off: number, len: number) => {
    const bytes = tar.subarray(off, off + len)
    const end = bytes.indexOf(0)
    return text.decode(end === -1 ? bytes : bytes.subarray(0, end))
  }
  let pos = 0
  while (pos + 512 <= tar.length) {
    const name = field(pos, 100)
    if (!name) break // two zero blocks end the archive
    const prefix = field(pos + 345, 155)
    const size = parseInt(field(pos + 124, 12).trim() || '0', 8)
    const full = prefix ? `${prefix}/${name}` : name
    const body = pos + 512
    if (match(full.replace(/^\.\//, ''))) return tar.subarray(body, body + size)
    pos = body + Math.ceil(size / 512) * 512
  }
  return null
}

async function gunzip(bytes: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function officialFromManifest(version: string, manifestText: string): OfficialApps {
  const paths = [...parseResourcesManifest(manifestText).keys()]
  return {
    version,
    fetchedAt: Date.now(),
    paths,
    fileNames: [...new Set(paths.map((p) => p.slice(p.lastIndexOf('/') + 1)))],
  }
}

async function download(target: number): Promise<OfficialApps> {
  const dirRes = await fetch(DIRECTORY_URL)
  if (!dirRes.ok) throw new Error(`update server ${dirRes.status}`)
  const directory = (await dirRes.json()) as Directory
  const release = directory.channels.find((c) => c.id === 'release')?.versions[0]
  const file = release?.files.find((f) => f.type === 'resources_tgz' && f.target === `f${target}`)
  if (!release || !file) throw new Error('no release resources for this hardware')
  const archive = await fetch(file.url)
  if (!archive.ok) throw new Error(`resources download ${archive.status}`)
  const tar = await gunzip(await archive.arrayBuffer())
  const manifest = untarFile(tar, (n) => n === 'resources/Manifest' || n === 'Manifest')
  if (!manifest) throw new Error('Manifest missing from resources archive')
  return officialFromManifest(release.version, new TextDecoder().decode(manifest))
}

/** Cached for a day; a stale copy is used when the update server cannot be reached. */
export async function loadOfficialApps(target: number): Promise<OfficialApps> {
  const key = `release-f${target}`
  const cached = await get<OfficialApps>(key, cacheStore).catch(() => undefined)
  if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) return cached
  try {
    const fresh = await download(target)
    await set(key, fresh, cacheStore).catch(() => undefined)
    return fresh
  } catch (e) {
    if (cached) return cached
    throw e
  }
}
