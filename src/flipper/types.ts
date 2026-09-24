export interface StorageEntry {
  name: string
  type: 'file' | 'dir'
  size: number
  md5?: string
}

export interface DeviceInfo {
  name: string
  apiMajor: number
  apiMinor: number
  /** Hardware target, 7 for every Flipper Zero sold so far. */
  target: number
  firmwareVersion: string
  firmwareBranch: string
  firmwareOrigin: string
  raw: Record<string, string>
}

export type ProgressFn = (done: number, total: number) => void

/** Everything the app needs from a connected Flipper. */
export interface FlipperDevice {
  readonly kind: 'serial'
  info(): Promise<DeviceInfo>
  list(path: string, withMd5?: boolean): Promise<StorageEntry[]>
  stat(path: string): Promise<StorageEntry | null>
  timestamp(path: string): Promise<number | null>
  read(path: string, onProgress?: ProgressFn, knownSize?: number): Promise<Uint8Array>
  write(path: string, data: Uint8Array, onProgress?: ProgressFn): Promise<void>
  remove(path: string, recursive?: boolean): Promise<void>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** Runs a CLI command outside the RPC session (used for the on-device JS fast scan). */
  runCli?(command: string, opts: { done: RegExp; idleMs: number; onText?: (chunk: string) => void }): Promise<string>
  close(): Promise<void>
  onDisconnect?: () => void
}

export class RpcError extends Error {
  readonly status: string
  constructor(status: string, context?: string) {
    super(context ? `${context}: ${status}` : status)
    this.status = status
  }
}

export function deviceInfoFromPairs(raw: Record<string, string>): DeviceInfo {
  // Older firmware uses underscores, newer property API uses dots.
  const get = (k: string) => raw[k] ?? raw[k.replaceAll('_', '.')] ?? ''
  return {
    name: get('hardware_name') || 'Flipper',
    apiMajor: Number(get('firmware_api_major')) || 0,
    apiMinor: Number(get('firmware_api_minor')) || 0,
    target: Number(get('firmware_target')) || 7,
    firmwareVersion: get('firmware_version'),
    firmwareBranch: get('firmware_branch'),
    firmwareOrigin: get('firmware_origin_fork'),
    raw,
  }
}
