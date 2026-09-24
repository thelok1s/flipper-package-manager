/** Parsers for the plain-text manifests Flipper keeps on the SD card. */

export const APPS_ROOT = '/ext/apps'
export const FIM_DIR = '/ext/apps_manifests'
export const RESOURCES_MANIFEST = '/ext/Manifest'

/**
 * /ext/Manifest is written by every firmware update and lists each resource file it installed,
 * as `F:<md5>:<size>:<relative path>`. Any .fap listed there shipped with the firmware.
 */
export function parseResourcesManifest(text: string): Map<string, string> {
  const files = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('F:')) continue
    const [, md5, , ...rest] = line.split(':')
    const rel = rest.join(':')
    if (rel.toLowerCase().endsWith('.fap')) files.set(`/ext/${rel}`.toLowerCase(), md5)
  }
  return files
}

/** Flipper Application Installation Manifest, written by lab.flipper.net and the mobile app. */
export interface Fim {
  file: string
  uid: string
  versionUid: string
  fullName: string
  buildApi: string
  path: string
  iconBase64: string
  devCatalog: boolean
}

export function parseFim(text: string, file: string): Fim {
  const fim: Fim = { file, uid: '', versionUid: '', fullName: '', buildApi: '', path: '', iconBase64: '', devCatalog: false }
  for (const raw of text.replaceAll('\r', '').split('\n')) {
    const i = raw.indexOf(': ')
    if (i === -1) continue
    const key = raw.slice(0, i)
    const value = raw.slice(i + 2)
    if (key === 'UID') fim.uid = value
    else if (key === 'Version UID') fim.versionUid = value
    else if (key === 'Full Name') fim.fullName = value
    else if (key === 'Version Build API') fim.buildApi = value
    else if (key === 'Path') fim.path = value
    else if (key === 'Icon') fim.iconBase64 = value
    else if (key === 'DevCatalog') fim.devCatalog = value === 'true'
  }
  return fim
}

export function buildFim(o: { name: string; iconBase64: string; api: string; uid: string; versionUid: string; path: string }) {
  return (
    'Filetype: Flipper Application Installation Manifest\nVersion: 1\n' +
    `Full Name: ${o.name}\nIcon: ${o.iconBase64}\nVersion Build API: ${o.api}\n` +
    `UID: ${o.uid}\nVersion UID: ${o.versionUid}\nPath: ${o.path}`
  )
}

export const dirname = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
export const joinPath = (dir: string, name: string) => `${dir.replace(/\/$/, '')}/${name}`
