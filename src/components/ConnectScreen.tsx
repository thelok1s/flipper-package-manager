import { UsbIcon, WarningIcon } from '@phosphor-icons/react'
import { motion, useReducedMotion } from 'motion/react'
import { webSerialSupported } from '../flipper/serial'
import { connect } from '../state/actions'
import { useStore } from '../state/store'
import { Button } from './ui'

const STEPS = [
  { title: 'Plug in the Flipper over USB', body: 'Unlock it and leave it on the desktop screen.' },
  { title: 'Close anything else using the port', body: 'qFlipper, lab.flipper.net and serial terminals hold the port open.' },
  { title: 'Pick "Flipper" in the browser prompt', body: 'The app reads /ext/apps over the same RPC channel Flipper Lab uses.' },
]

export function ConnectScreen() {
  const status = useStore((s) => s.status)
  const error = useStore((s) => s.error)
  const reduce = useReducedMotion()
  const supported = webSerialSupported()
  const busy = status === 'connecting'

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-12 md:px-8 md:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-start"
        >
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tighter text-ink md:text-5xl">
            Sort out every app on your Flipper.
          </h1>
          <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-muted">
            Find apps that won't launch on your firmware, duplicate copies and sideloaded builds, then clean them up safely.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button tone="primary" icon={UsbIcon} disabled={!supported || busy} onClick={() => connect()} className="h-11 px-5 text-[15px]">
              {busy ? 'Connecting' : 'Connect Flipper'}
            </Button>
          </div>
          {!supported && (
            <p className="mt-4 flex max-w-[52ch] items-start gap-2 text-sm text-danger">
              <WarningIcon size={16} className="mt-0.5 shrink-0" aria-hidden />
              This browser has no Web Serial. Use Chrome, Edge, Opera or another Chromium browser on desktop.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 flex max-w-[52ch] items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              <WarningIcon size={16} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </motion.div>

        <ol className="flex flex-col gap-3 self-center">
          {STEPS.map((s, i) => (
            <motion.li
              key={s.title}
              initial={reduce ? false : { opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.12 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="grid grid-cols-[36px_1fr] gap-3 rounded-lg border border-line bg-surface p-4"
            >
              <span className="grid size-9 place-items-center rounded-lg bg-lcd font-mono text-sm font-semibold text-lcd-pixel">{i + 1}</span>
              <span>
                <span className="block text-sm font-medium text-ink">{s.title}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{s.body}</span>
              </span>
            </motion.li>
          ))}
        </ol>
      </div>
    </div>
  )
}
