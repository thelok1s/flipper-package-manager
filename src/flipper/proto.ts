import { Root, parse, type Type } from 'protobufjs'

// Protobuf definitions vendored from github.com/flipperdevices/flipperzero-protobuf.
const sources = import.meta.glob('../proto/*.proto', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const root = new Root()
for (const source of Object.values(sources)) parse(source, root, { keepCase: false })
root.resolveAll()

export const Main: Type = root.lookupType('PB.Main')
const commandStatus = root.lookupEnum('PB.CommandStatus')

export function statusName(code: number): string {
  return commandStatus.valuesById[code] ?? `STATUS_${code}`
}

// Loosely typed on purpose: the oneof payload differs for every request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MainObject = { commandId?: number; commandStatus?: number; hasNext?: boolean; content?: string } & Record<string, any>

export function encodeMain(commandId: number, content: string, payload: object, hasNext = false): Uint8Array {
  const message = Main.fromObject({ commandId, hasNext, [content]: payload })
  return Main.encodeDelimited(message).finish()
}

/**
 * Pulls every complete length-delimited message off the front of `buffer`.
 * Returns the decoded messages and how many bytes they consumed. Frames are only decoded once
 * fully received, so partial data never costs a failed decode.
 */
export function decodeAvailable(buffer: Uint8Array): { messages: MainObject[]; consumed: number } {
  const messages: MainObject[] = []
  let pos = 0
  while (pos < buffer.length) {
    // Varint length prefix.
    let len = 0
    let shift = 0
    let p = pos
    for (;;) {
      if (p >= buffer.length) return { messages, consumed: pos }
      const b = buffer[p++]
      len += (b & 0x7f) * 2 ** shift
      if (!(b & 0x80)) break
      shift += 7
      if (shift > 35) throw new Error('Corrupt RPC frame')
    }
    if (p + len > buffer.length) break
    const message = Main.decode(buffer.subarray(p, p + len))
    messages.push(Main.toObject(message, { longs: Number, enums: Number, oneofs: true }) as MainObject)
    pos = p + len
  }
  return { messages, consumed: pos }
}
