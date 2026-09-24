import rawSprite from '../assets/lab-icons.svg?raw'

/**
 * Icons from lab.flipper.net, supplied by the project owner. The sprite is inlined once so the
 * clip paths inside it resolve; ids are prefixed to stay clear of the page's own ids.
 */
const sprite = rawSprite
  .replace(/id="([^"]+)"/g, 'id="lab-$1"')
  .replace(/url\(#([^)]+)\)/g, 'url(#lab-$1)')
  .replace('<svg ', '<svg aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden" ')

export type LabIconId =
  | 'device'
  | 'apps'
  | 'files'
  | 'logs'
  | 'disconnect'
  | 'connect'
  | 'connected'
  | 'switch'
  | 'delete'
  | 'installed'
  | 'arrow-up'
  | 'link'
  | 'info-small'
  | 'fw-conflict-icon'
  | 'sdcard-memory'

/** Aspect ratios of the non-square symbols (width / height). */
const WIDE: Partial<Record<LabIconId, number>> = { connect: 42 / 20, connected: 42 / 20, switch: 42 / 24 }

export function LabSprite() {
  return <div dangerouslySetInnerHTML={{ __html: sprite }} />
}

export function LabIcon({ id, size = 16, className = '', label }: { id: LabIconId; size?: number; className?: string; label?: string }) {
  const ratio = WIDE[id] ?? 1
  return (
    <svg
      width={Math.round(size * ratio)}
      height={size}
      fill="currentColor"
      className={`shrink-0 ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <use href={`#lab-${id}`} />
    </svg>
  )
}
