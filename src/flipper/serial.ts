import { decodeAvailable, encodeMain, statusName, type MainObject } from './proto'
import {
  RpcError,
  deviceInfoFromPairs,
  type DeviceInfo,
  type FlipperDevice,
  type ProgressFn,
  type StorageEntry,
} from './types'

const FLIPPER_USB = { usbVendorId: 0x0483, usbProductId: 0x5740 }
const RPC_MARKER = 'start_rpc_session\r\n'
const CHUNK = 512
/** How long a command may go without any reply before it is treated as lost. */
const IDLE_TIMEOUT = 8000
/** Listing a folder full of large files can take a while on a slow SD card. */
const LIST_TIMEOUT = 30000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Pending {
  chunks: MainObject[]
  content: string
  resolve: (chunks: MainObject[]) => void
  reject: (e: Error) => void
  onChunk?: (count: number) => void
  timeoutMs: number
  timer: ReturnType<typeof setTimeout>
}

interface CallOptions {
  onChunk?: (count: number) => void
  timeoutMs?: number
}

export const webSerialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator

/**
 * Talks to a Flipper Zero over its USB CDC port using the same protobuf RPC
 * session that qFlipper, the mobile app and lab.flipper.net use.
 */
export class SerialFlipper implements FlipperDevice {
  readonly kind = 'serial' as const
  onDisconnect?: () => void

  private port: SerialPort
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  private writer?: WritableStreamDefaultWriter<Uint8Array>
  private buffer: Uint8Array = new Uint8Array(0)
  private rpcStarted = false
  private markerSeen?: () => void
  private nextId = 1
  private pending = new Map<number, Pending>()
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  private constructor(port: SerialPort) {
    this.port = port
  }

  /** Opens the browser port picker, filtered to Flipper devices. */
  static async request(): Promise<SerialFlipper> {
    const port = await navigator.serial.requestPort({ filters: [FLIPPER_USB] })
    return SerialFlipper.open(port)
  }

  /** Reconnects to a Flipper the user already granted access to, without a picker. */
  static async reconnect(): Promise<SerialFlipper | null> {
    const ports = await navigator.serial.getPorts()
    const port = ports.find((p) => {
      const i = p.getInfo()
      return i.usbVendorId === FLIPPER_USB.usbVendorId && i.usbProductId === FLIPPER_USB.usbProductId
    })
    return port ? SerialFlipper.open(port) : null
  }

  private static async open(port: SerialPort): Promise<SerialFlipper> {
    const device = new SerialFlipper(port)
    await device.start()
    return device
  }

  private async start() {
    // Baud rate is ignored by USB CDC, but the API requires a value.
    await this.port.open({ baudRate: 230400 })
    this.writer = this.port.writable!.getWriter()
    this.reader = this.port.readable!.getReader()
    void this.readLoop()
    navigator.serial.addEventListener('disconnect', this.handleUnplug)

    const marker = new Promise<boolean>((resolve) => {
      this.markerSeen = () => resolve(true)
      setTimeout(() => resolve(false), 2500)
    })
    await this.writeRaw(new TextEncoder().encode('\rstart_rpc_session\r'))
    const seen = await marker
    if (!seen) {
      // The port may still be in an RPC session left open by another tool.
      this.rpcStarted = true
      this.buffer = new Uint8Array(0)
    }
    await this.ping()
  }

  private handleUnplug = (e: Event) => {
    if ((e as Event & { target: SerialPort }).target === this.port) this.teardown('Flipper was disconnected')
  }

  private async readLoop() {
    const reader = this.reader!
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (value?.length) this.ingest(value)
      }
    } catch {
      // Device lost; handled by teardown.
    }
    if (!this.closed) this.teardown('Serial connection closed')
  }

  private ingest(bytes: Uint8Array) {
    const merged = new Uint8Array(this.buffer.length + bytes.length)
    merged.set(this.buffer)
    merged.set(bytes, this.buffer.length)
    this.buffer = merged

    if (!this.rpcStarted) {
      // Before the session starts the CLI echoes text. Skip to the echo of our command.
      const text = new TextDecoder('latin1').decode(this.buffer)
      const at = text.indexOf(RPC_MARKER)
      if (at === -1) {
        if (this.buffer.length > 64 * 1024) this.buffer = new Uint8Array(0)
        return
      }
      this.buffer = this.buffer.slice(at + RPC_MARKER.length)
      this.rpcStarted = true
      this.markerSeen?.()
    }

    const { messages, consumed } = decodeAvailable(this.buffer)
    if (consumed) this.buffer = this.buffer.slice(consumed)
    for (const m of messages) this.dispatch(m)
  }

  private dispatch(message: MainObject) {
    const id = message.commandId ?? 0
    const p = this.pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    if (message.commandStatus) {
      this.pending.delete(id)
      p.reject(new RpcError(statusName(message.commandStatus), p.content))
      return
    }
    if (message.content) p.chunks.push(message[message.content] ?? {})
    p.onChunk?.(p.chunks.length)
    if (message.hasNext) {
      p.timer = this.armTimeout(id, p.timeoutMs)
    } else {
      this.pending.delete(id)
      p.resolve(p.chunks)
    }
  }

  private armTimeout(id: number, ms: number) {
    return setTimeout(() => {
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      p.reject(new RpcError('TIMEOUT', p.content))
    }, ms)
  }

  private async writeRaw(bytes: Uint8Array) {
    if (!this.writer) throw new Error('Not connected')
    await this.writer.write(bytes)
  }

  /** Serialises commands; the Flipper handles one RPC request at a time comfortably. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private expect(id: number, content: string, { onChunk, timeoutMs = IDLE_TIMEOUT }: CallOptions = {}) {
    return new Promise<MainObject[]>((resolve, reject) => {
      this.pending.set(id, { chunks: [], content, resolve, reject, onChunk, timeoutMs, timer: this.armTimeout(id, timeoutMs) })
    })
  }

  private call(content: string, payload: object = {}, options?: CallOptions): Promise<MainObject[]> {
    return this.enqueue(async () => {
      if (this.closed) throw new Error('Not connected')
      const id = this.nextId++
      const response = this.expect(id, content, options)
      await this.writeRaw(encodeMain(id, content, payload))
      return response
    })
  }

  ping() {
    return this.call('systemPingRequest', {})
  }

  async info(): Promise<DeviceInfo> {
    const chunks = await this.call('systemDeviceInfoRequest')
    const raw: Record<string, string> = {}
    for (const c of chunks) if (c.key) raw[c.key] = c.value ?? ''
    return deviceInfoFromPairs(raw)
  }

  async list(path: string, withMd5 = false): Promise<StorageEntry[]> {
    // With include_md5 the Flipper hashes every file before its first reply, so keep it opt-in.
    const chunks = await this.call('storageListRequest', { path, includeMd5: withMd5 }, { timeoutMs: withMd5 ? LIST_TIMEOUT * 4 : LIST_TIMEOUT })
    return chunks.flatMap((c) => (c.file ?? []) as MainObject[]).map(toEntry)
  }

  async stat(path: string): Promise<StorageEntry | null> {
    try {
      const [c] = await this.call('storageStatRequest', { path })
      return c?.file ? toEntry({ ...c.file, name: path.split('/').pop() }) : null
    } catch (e) {
      if (e instanceof RpcError && e.status === 'ERROR_STORAGE_NOT_EXIST') return null
      throw e
    }
  }

  /** Last-modified time in seconds, or null when the firmware predates the timestamp request. */
  async timestamp(path: string): Promise<number | null> {
    try {
      const [c] = await this.call('storageTimestampRequest', { path })
      return c?.timestamp ?? null
    } catch (e) {
      if (e instanceof RpcError && (e.status === 'ERROR_NOT_IMPLEMENTED' || e.status === 'ERROR_DECODE')) return null
      throw e
    }
  }

  async read(path: string, onProgress?: ProgressFn, knownSize?: number): Promise<Uint8Array> {
    const size = onProgress ? (knownSize ?? (await this.stat(path))?.size ?? 0) : 0
    const chunks = await this.call('storageReadRequest', { path }, { onChunk: (n) => onProgress?.(Math.min(n * CHUNK, size), size) })
    const parts = chunks.map((c) => (c.file?.data as Uint8Array | undefined) ?? new Uint8Array(0))
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
    let offset = 0
    for (const p of parts) {
      out.set(p, offset)
      offset += p.length
    }
    return out
  }

  write(path: string, data: Uint8Array, onProgress?: ProgressFn): Promise<void> {
    return this.enqueue(async () => {
      const id = this.nextId++
      const response = this.expect(id, 'storageWriteRequest')
      const total = data.length
      let offset = 0
      do {
        const slice = data.subarray(offset, offset + CHUNK)
        offset += slice.length
        const last = offset >= total
        await this.writeRaw(encodeMain(id, 'storageWriteRequest', { path, file: { data: slice } }, !last))
        onProgress?.(offset, total)
        // Give the Flipper's RPC buffer a moment to drain, like lab.flipper.net does.
        if (!last) await sleep(6)
      } while (offset < total)
      await response
    })
  }

  async remove(path: string, recursive = false) {
    await this.call('storageDeleteRequest', { path, recursive })
  }

  async mkdir(path: string) {
    try {
      await this.call('storageMkdirRequest', { path })
    } catch (e) {
      if (!(e instanceof RpcError && e.status === 'ERROR_STORAGE_EXIST')) throw e
    }
  }

  async rename(from: string, to: string) {
    await this.call('storageRenameRequest', { oldPath: from, newPath: to })
  }

  async close() {
    if (this.closed) return
    try {
      // Hand the port back to the CLI so other tools can use it.
      await this.writeRaw(encodeMain(this.nextId++, 'stopSession', {}))
      await sleep(50)
    } catch {
      /* already gone */
    }
    await this.teardown()
  }

  private async teardown(reason?: string) {
    if (this.closed) return
    this.closed = true
    navigator.serial.removeEventListener('disconnect', this.handleUnplug)
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error(reason ?? 'Disconnected'))
    }
    this.pending.clear()
    try {
      await this.reader?.cancel()
    } catch {
      /* ignore */
    }
    this.reader?.releaseLock()
    try {
      this.writer?.releaseLock()
    } catch {
      /* ignore */
    }
    try {
      await this.port.close()
    } catch {
      /* ignore */
    }
    if (reason) this.onDisconnect?.()
  }
}

function toEntry(f: MainObject): StorageEntry {
  return {
    name: f.name ?? '',
    type: f.type === 1 ? 'dir' : 'file',
    size: f.size ?? 0,
    md5: f.md5sum || undefined,
  }
}
