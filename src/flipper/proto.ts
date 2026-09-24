import { Root, parse, Reader, type Type } from 'protobufjs'

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
 * Returns the decoded messages and how many bytes they consumed.
 */
export function decodeAvailable(buffer: Uint8Array): { messages: MainObject[]; consumed: number } {
  const reader = Reader.create(buffer)
  const messages: MainObject[] = []
  let consumed = 0
  while (reader.pos < reader.len) {
    try {
      const message = Main.decodeDelimited(reader)
      consumed = reader.pos
      messages.push(Main.toObject(message, { longs: Number, enums: Number, oneofs: true }) as MainObject)
    } catch {
      // A partial frame; wait for more bytes.
      break
    }
  }
  return { messages, consumed }
}
