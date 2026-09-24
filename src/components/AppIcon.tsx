import { memo, useMemo } from 'react'
import { ICON_SIZE } from '../lib/fap'

const cache = new Map<string, string>()

/** Paints the 10x10 manifest icon the way the Flipper screen shows it: dark pixels on orange. */
function render(pixels: boolean[] | null | undefined, lcd: string, ink: string): string {
  const key = `${lcd}|${ink}|${pixels ? pixels.map((p) => (p ? 1 : 0)).join('') : 'none'}`
  const hit = cache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = lcd
  ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE)
  ctx.fillStyle = ink
  if (pixels) {
    pixels.forEach((on, i) => on && ctx.fillRect(i % ICON_SIZE, Math.floor(i / ICON_SIZE), 1, 1))
  } else {
    // No icon in the manifest: the firmware shows a generic app glyph, a hollow square here.
    ctx.strokeStyle = ink
    ctx.strokeRect(2.5, 2.5, 5, 5)
  }
  const url = canvas.toDataURL()
  cache.set(key, url)
  return url
}

export const AppIcon = memo(function AppIcon({
  pixels,
  size = 40,
  dim = false,
  className = '',
}: {
  pixels: boolean[] | null | undefined
  size?: number
  dim?: boolean
  className?: string
}) {
  const src = useMemo(() => render(pixels, '#ff8c2e', '#1b1a19'), [pixels])
  const pad = Math.round(size * 0.16)
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-lcd ${dim ? 'opacity-55 grayscale-[0.6]' : ''} ${className}`}
      style={{ width: size, height: size, padding: pad }}
      aria-hidden
    >
      <img src={src} alt="" className="pixelated h-full w-full" draggable={false} />
    </span>
  )
})
