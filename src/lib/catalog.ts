/**
 * Client for the Flipper Application Catalog (the backend behind lab.flipper.net and the mobile app).
 * Requests go through the `/catalog-api` proxy in vite.config.ts because the catalog only
 * allows lab.flipper.net as a CORS origin.
 */
const BASE = (import.meta.env.VITE_CATALOG_BASE as string | undefined) ?? '/catalog-api'
const ORIGIN = 'https://catalog.flipperzero.one/api/v0'

export const labAppUrl = (alias: string) => `https://lab.flipper.net/apps/${alias}`

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
  buildApi: string
}

export interface CatalogCategory {
  id: string
  name: string
  color: string
}

export interface CatalogDetail {
  sourceUrl?: string
  manifestUrl?: string
  description: string
}

/** Rewrites absolute catalog URLs (icons, bundles) so they also go through the proxy. */
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
  current_version: {
    _id: string
    name: string
    version: string
    short_description: string
    icon_uri: string
    current_build?: { sdk?: { api?: string } }
  }
}

export async function fetchCatalog(): Promise<{ apps: CatalogApp[]; categories: CatalogCategory[] }> {
  const pageSize = 500
  const apps: CatalogApp[] = []
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const page = await getJson<RawApp[]>(`/0/application?limit=${pageSize}&offset=${offset}&is_latest_release_version=true`)
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
        buildApi: a.current_version.current_build?.sdk?.api ?? '',
      })
    }
    if (page.length < pageSize) break
  }
  const rawCategories = await getJson<{ _id: string; name: string; color: string }[]>('/0/category')
  return { apps, categories: rawCategories.map((c) => ({ id: c._id, name: c.name, color: c.color })) }
}

export async function fetchDetail(alias: string): Promise<CatalogDetail> {
  const d = await getJson<{
    current_version: {
      description?: string
      links?: { manifest_uri?: string; source_code?: { uri?: string } }
    }
  }>(`/application/${encodeURIComponent(alias)}`)
  return {
    sourceUrl: d.current_version.links?.source_code?.uri,
    manifestUrl: d.current_version.links?.manifest_uri,
    description: d.current_version.description ?? '',
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
