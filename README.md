# Flipper App Manager

A browser app for cleaning up the apps on a Flipper Zero. It connects over USB (Web Serial), goes through every folder under `/ext/apps`, and reads each `.fap` manifest directly from the ELF `.fapmeta` section.

```bash
npm install
npm run dev      # http://localhost:5173 (Chrome, Edge or another Chromium browser)
npm test         # parser tests (vitest)
npm run build
```

## Deploy

Import the GitHub repo in Vercel. The framework (Vite), build command and output directory are set in `vercel.json`, and nothing else needs configuring. Web Serial needs HTTPS, which Vercel provides.

## What it does

| Feature | How |
| --- | --- |
| Recursive app list, icons, manifests | Protobuf RPC (`storage_list` / `storage_read`), ELF section parse, 10x10 icon decode (raw or heatshrink) |
| Won't-launch detection | App API major vs device `firmware_api_major`, the same rule as `flipper_application_manifest_is_too_old/new`. Target mismatch and newer-minor warnings too |
| Add-on module filter | `[TAG]` in the manifest name, e.g. `[LD2450] Motion tracker` |
| Duplicates | Grouped by file name or manifest name across folders. Best copy = loads on this firmware, then highest version, then catalog-managed |
| System app protection | Anything listed in `/ext/Manifest` (written by firmware updates) is locked from delete or move |
| Folder explorer | Drag apps onto folders, the tree or the `..` tile. Create or remove empty folders |
| Catalog vs sideloaded | Catalog installs carry a `.fim` in `/ext/apps_manifests` (as lab.flipper.net writes them). Sideloaded apps are matched to the catalog by alias or name and can be replaced with the catalog build for your API |
| History and restore | IndexedDB keeps every delete, move and replace, including the original `.fap` bytes, so deleted apps can be restored. Links: Flipper Lab page, repo links found inside the binary, and your own saved source URL |
| Views | Icons, details list, grouped by folder. Sort by name, folder, compatibility, version, API or size. Prefs and filters persist in localStorage |

## Notes

- **`fap_weburl` is not in the .fap.** fbt only embeds name, version, API, target, stack size and icon in `.fapmeta`. Source links come from the catalog (`links.source_code`), URLs embedded in the binary's strings, or a link you save per app.
- **Catalog CORS:** `catalog.flipperzero.one` only allows `lab.flipper.net`, so requests go through a same-origin `/catalog-api` proxy: `vite.config.ts` in dev and `vite preview`, and a rewrite in `vercel.json` in production. On other hosts, proxy `/catalog-api/*` to `https://catalog.flipperzero.one/api/v0/*`, or set `VITE_CATALOG_BASE`.
- Close qFlipper and lab.flipper.net before connecting. Only one program can hold the serial port.
- Protobuf definitions in `src/proto` are vendored from `flipperdevices/flipperzero-protobuf` at commit `1c84fa4`.
