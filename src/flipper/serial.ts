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
/** SD reads can stall for a while on a busy or fragmented card. */
const READ_TIMEOUT = 20000
/** After a timeout, the line must be silent this long before the next command is sent. */
const QUIET_MS = 1500
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
  /** While set, the port is in text CLI mode and every received chunk goes here. */
  private cliSink?: (text: string) => void
  private nextId = 1
  private pending = new Map<number, Pending>()
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private lastRx = 0
  /**
   * Set when a command times out. The Flipper answers commands strictly in order, so it may still be
   * streaming the abandoned reply; sending more requests on top of it makes every later command time
   * out and can overflow the device. The next command waits for silence and a ping first.
   */
  private needsResync = false

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
    // If no marker arrives the port may still be in a session left open by another tool.
    await this.enterRpc()
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
        if (value?.length) {
          this.lastRx = Date.now()
          this.ingest(value)
        }
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

    if (!this.rpcStarted && this.cliSink) {
      this.cliSink(new TextDecoder('latin1').decode(this.buffer))
      this.buffer = new Uint8Array(0)
      return
    }

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

    let decoded: ReturnType<typeof decodeAvailable>
    try {
      decoded = decodeAvailable(this.buffer)
    } catch {
      // Garbage on the line: drop it and let the next command resynchronise.
      this.buffer = new Uint8Array(0)
      this.needsResync = true
      return
    }
    const { messages, consumed } = decoded
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
      this.needsResync = true
      p.reject(new RpcError('TIMEOUT', p.content))
    }, ms)
  }

  private async writeRaw(bytes: Uint8Array) {
    if (!this.writer) throw new Error('Not connected')
    await this.writer.write(bytes)
  }

  /** Waits until the Flipper has finished any abandoned reply, then checks it still answers. */
  /** Pings without going through the queue; for use inside queued tasks. */
  private async pingDirect(timeoutMs = 5000) {
    const id = this.nextId++
    const response = this.expect(id, 'systemPingRequest', { timeoutMs })
    await this.writeRaw(encodeMain(id, 'systemPingRequest', {}))
    await response
  }

  /** Starts an RPC session from the CLI prompt; tolerates a session that is already running. */
  private async enterRpc() {
    this.buffer = new Uint8Array(0)
    this.rpcStarted = false
    const marker = new Promise<boolean>((resolve) => {
      this.markerSeen = () => resolve(true)
      setTimeout(() => resolve(false), 2500)
    })
    await this.writeRaw(new TextEncoder().encode('\rstart_rpc_session\r'))
    if (!(await marker)) {
      // No echo: the port may already be in an RPC session left open by another tool.
      this.rpcStarted = true
      this.buffer = new Uint8Array(0)
    }
    await this.pingDirect()
  }

  /**
   * Leaves the RPC session, runs one CLI command, streams its output and returns to RPC.
   * Resolves with the full output once `done` matches, or rejects after `idleMs` of silence.
   */
  runCli(command: string, opts: { done: RegExp; idleMs: number; onText?: (chunk: string) => void }): Promise<string> {
    return this.enqueue(async () => {
      if (this.closed) throw new Error('Not connected')
      let out = ''
      let last = Date.now()
      const enc = new TextEncoder()
      // Stop the session; the CLI shell resumes on the same port.
      await this.writeRaw(encodeMain(this.nextId++, 'stopSession', {}))
      this.rpcStarted = false
      this.buffer = new Uint8Array(0)
      this.cliSink = (t) => {
        out += t
        last = Date.now()
      }
      await sleep(300)
      await this.writeRaw(enc.encode('\r'))
      const promptBy = Date.now() + 3000
      while (!out.includes('>:') && Date.now() < promptBy) await sleep(50)

      out = ''
      this.cliSink = (t) => {
        out += t
        last = Date.now()
        opts.onText?.(t)
      }
      last = Date.now()
      await this.writeRaw(enc.encode(command + '\r'))
      let timedOut = false
      while (!opts.done.test(out)) {
        if (this.closed) throw new Error('Not connected')
        if (Date.now() - last > opts.idleMs) {
          timedOut = true
          // Ctrl+C stops a running script.
          await this.writeRaw(Uint8Array.of(3))
          await sleep(500)
          break
        }
        await sleep(40)
      }
      await sleep(150) // let the prompt arrive before switching modes
      this.cliSink = undefined
      await this.enterRpc()
      if (timedOut) throw new RpcError('TIMEOUT', command.split(' ')[0])
      return out
    })
  }

  private async resync() {
    const deadline = Date.now() + 60000
    while (Date.now() - this.lastRx < QUIET_MS) {
      if (this.closed) throw new Error('Not connected')
      if (Date.now() > deadline) throw new RpcError('DEVICE_BUSY', 'resync')
      await sleep(200)
    }
    this.buffer = new Uint8Array(0)
    await this.pingDirect()
    this.needsResync = false
  }

  /** Serialises commands; the Flipper handles one RPC request at a time. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const task = async () => {
      if (this.needsResync) await this.resync()
      return fn()
    }
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
    const chunks = await this.call('storageReadRequest', { path }, { timeoutMs: READ_TIMEOUT, onChunk: (n) => onProgress?.(Math.min(n * CHUNK, size), size) })
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
