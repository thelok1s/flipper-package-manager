/**
 * Client for the Flipper Application Catalog (the backend behind lab.flipper.net and the mobile app).
 * JSON requests go through the `/catalog-api` proxy in vite.config.ts / vercel.json because the
 * catalog only allows lab.flipper.net as a CORS origin. Images are plain <img> loads and need no proxy.
 */
const BASE = (import.meta.env.VITE_CATALOG_BASE as string | undefined) ?? '/catalog-api'
const ORIGIN = 'https://catalog.flipperzero.one/api/v0'

export const labAppUrl = (alias: string) => `https://lab.flipper.net/apps/${alias}`
export const CATALOG_CONTRIBUTE_URL = 'https://github.com/flipperdevices/flipper-application-catalog'

export interface CatalogApp {
  id: string
  alias: string
  author: string
  categoryId: string
  versionId: string
  name: string
  version: string
  shortDescription: string
  iconUri: string
  screenshots: string[]
  /** SDK API of the build the catalog serves for this firmware (or the latest release). */
  buildApi: string
  /** SHA-256 of that build's .fap, as served by /build/compatible. Lets a local copy be proven identical. */
  fapHash: string
  createdAt: number
  updatedAt: number
  downloads: number
}

export interface CatalogCategory {
  id: string
  name: string
  /** Hex without '#', as the catalog sends it. */
  color: string
  iconUri: string
  priority: number
}

export interface CatalogDetail {
  sourceUrl?: string
  manifestUrl?: string
  description: string
  changelog: string
}

/** Rewrites absolute catalog URLs (icons, bundles) so fetch() calls also go through the proxy. */
export const proxied = (url: string) => (url.startsWith(ORIGIN) ? BASE + url.slice(ORIGIN.length) : url)

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path)
  if (!res.ok) throw new Error(`Catalog ${res.status} on ${path}`)
  return res.json() as Promise<T>
}

interface RawApp {
  _id: string
  alias: string
  author: string
  category_id: string
  created_at: number
  updated_at: number
  downloads: number
  current_version: {
    _id: string
    name: string
    version: string
    short_description: string
    icon_uri: string
    screenshots?: string[]
    current_build?: { sdk?: { api?: string }; fap_hash?: string }
  }
}

export interface Compat {
  api: string
  target: number
}

/**
 * Loads the whole catalog (a few hundred apps). With `compat`, each app's current version is the
 * latest one that has a build for this firmware, as lab.flipper.net does; without it, the latest release.
 */
export async function fetchCatalog(compat?: Compat): Promise<{ apps: CatalogApp[]; categories: CatalogCategory[] }> {
  const pageSize = 500
  const filter = compat ? `api=${compat.api}&target=f${compat.target}` : 'is_latest_release_version=true'
  const apps: CatalogApp[] = []
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const page = await getJson<RawApp[]>(`/0/application?limit=${pageSize}&offset=${offset}&${filter}&sort_by=updated_at&sort_order=-1`)
    for (const a of page) {
      apps.push({
        id: a._id,
        alias: a.alias,
        author: a.author,
        categoryId: a.category_id,
        versionId: a.current_version._id,
        name: a.current_version.name,
        version: a.current_version.version,
        shortDescription: a.current_version.short_description,
        iconUri: a.current_version.icon_uri,
        screenshots: a.current_version.screenshots ?? [],
        buildApi: a.current_version.current_build?.sdk?.api ?? '',
        fapHash: a.current_version.current_build?.fap_hash ?? '',
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        downloads: a.downloads ?? 0,
      })
    }
    if (page.length < pageSize) break
  }
  const rawCategories = await getJson<{ _id: string; name: string; color: string; icon_uri: string; priority: number }[]>(
    `/0/category${compat ? `?api=${compat.api}&target=f${compat.target}` : ''}`,
  )
  const categories = rawCategories
    .map((c) => ({ id: c._id, name: c.name, color: c.color, iconUri: c.icon_uri, priority: c.priority }))
    .sort((a, b) => a.priority - b.priority)
  return { apps, categories }
}

export async function fetchDetail(alias: string, compat?: Compat): Promise<CatalogDetail> {
  const q = compat ? `?api=${compat.api}&target=f${compat.target}` : ''
  const d = await getJson<{
    current_version: {
      description?: string
      changelog?: string
      links?: { manifest_uri?: string; source_code?: { uri?: string } }
    }
  }>(`/application/${encodeURIComponent(alias)}${q}`)
  return {
    sourceUrl: d.current_version.links?.source_code?.uri,
    manifestUrl: d.current_version.links?.manifest_uri,
    description: d.current_version.description ?? '',
    changelog: d.current_version.changelog ?? '',
  }
}

/** Downloads the .fap built for this exact firmware API and target. */
export async function downloadBuild(versionId: string, target: number, api: string): Promise<Uint8Array> {
  const res = await fetch(`${BASE}/application/version/${versionId}/build/compatible?target=f${target}&api=${api}`)
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json())?.detail?.details ?? ''
    } catch {
      /* not json */
    }
    throw new Error(detail || `No compatible build (HTTP ${res.status})`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

export async function fetchIconBase64(iconUri: string): Promise<string> {
  const res = await fetch(proxied(iconUri))
  if (!res.ok) return ''
  const bytes = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** Compares dotted versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}
