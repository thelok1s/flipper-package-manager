/**
 * Heatshrink decoder (LZSS) with the parameters Flipper uses for icons:
 * window 2^8, lookahead 2^4. Literal tokens start with a 1 bit,
 * back references with a 0 bit followed by index and count.
 */
export function heatshrinkDecode(input: Uint8Array, windowBits = 8, lookaheadBits = 4, maxOut = 4096): Uint8Array {
  const out: number[] = []
  let bytePos = 0
  let bitPos = 0 // bits consumed in the current byte, MSB first

  const bitsLeft = () => (input.length - bytePos) * 8 - bitPos
  const read = (count: number) => {
    let value = 0
    for (let i = 0; i < count; i++) {
      const bit = (input[bytePos] >> (7 - bitPos)) & 1
      value = (value << 1) | bit
      if (++bitPos === 8) {
        bitPos = 0
        bytePos++
      }
    }
    return value
  }

  while (out.length < maxOut) {
    if (bitsLeft() < 1) break
    const tag = read(1)
    if (tag === 1) {
      if (bitsLeft() < 8) break
      out.push(read(8))
    } else {
      if (bitsLeft() < windowBits + lookaheadBits) break
      const offset = read(windowBits) + 1
      const count = read(lookaheadBits) + 1
      for (let i = 0; i < count; i++) {
        const src = out.length - offset
        out.push(src >= 0 ? out[src] : 0)
      }
    }
  }
  return Uint8Array.from(out)
}
