import { FunnelSimpleIcon, SidebarSimpleIcon } from '@phosphor-icons/react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { AppsView } from './components/AppsView'
import { CatalogView } from './components/CatalogView'
import { ConfirmHost } from './components/Confirm'
import { ConnectScreen } from './components/ConnectScreen'
import { DetailDrawer } from './components/DetailDrawer'
import { DuplicatesView } from './components/DuplicatesView'
import { ProgressStrip, Toasts } from './components/Feedback'
import { FoldersView } from './components/FoldersView'
import { Header } from './components/Header'
import { LabSprite } from './components/LabIcon'
import { HistoryView } from './components/HistoryView'
import { Sidebar } from './components/Sidebar'
import { webSerialSupported } from './flipper/serial'
import { connect, loadHistory } from './state/actions'
import { setState, useStore } from './state/store'

function useTheme() {
  const theme = useStore((s) => s.prefs.theme)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

export default function App() {
  useTheme()
  const tab = useStore((s) => s.tab)
  const connected = useStore((s) => !!s.device)
  const sidebarCollapsed = useStore((s) => s.prefs.sidebarCollapsed)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    void loadHistory()
    // Reattach to a Flipper this site was already granted, without showing the picker.
    if (webSerialSupported()) void connect(true)
  }, [])

  const needsDevice = !connected

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col">
        <Header />
        <ProgressStrip />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {needsDevice ? (
            <ConnectScreen />
          ) : tab === 'apps' ? (
            <div className={`grid h-full grid-cols-1 ${sidebarCollapsed ? 'lg:grid-cols-[44px_1fr]' : 'lg:grid-cols-[272px_1fr]'}`}>
              <div className="hidden min-h-0 lg:block">
                {sidebarCollapsed ? (
                  <div className="flex h-full flex-col items-center border-r border-line bg-surface py-3">
                    <button
                      type="button"
                      aria-label="Show filters and settings"
                      title="Show filters and settings"
                      onClick={() => setState((s) => ({ prefs: { ...s.prefs, sidebarCollapsed: false } }))}
                      className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
                    >
                      <SidebarSimpleIcon size={17} aria-hidden />
                    </button>
                  </div>
                ) : (
                  <Sidebar collapsible />
                )}
              </div>
              <div className="min-h-0">
                <AppsView />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="fixed bottom-4 right-4 z-20 inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-[#1b1206] shadow-panel lg:hidden"
              >
                <FunnelSimpleIcon size={17} weight="bold" aria-hidden /> Filters
              </button>
              <AnimatePresence>
                {filtersOpen && (
                  <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <button type="button" aria-label="Close filters" className="absolute inset-0 bg-[rgb(10_11_13/0.45)]" onClick={() => setFiltersOpen(false)} />
                    <motion.div
                      className="absolute inset-y-0 left-0 w-[min(88vw,320px)]"
                      initial={{ x: -40 }}
                      animate={{ x: 0 }}
                      exit={{ x: -40, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 34 }}
                    >
                      <Sidebar />
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : tab === 'catalog' ? (
            <CatalogView />
          ) : tab === 'folders' ? (
            <FoldersView />
          ) : tab === 'duplicates' ? (
            <DuplicatesView />
          ) : (
            <HistoryView />
          )}
          {connected && <DetailDrawer />}
        </main>
      </div>
      <LabSprite />
      <ConfirmHost />
      <Toasts />
    </MotionConfig>
  )
}
