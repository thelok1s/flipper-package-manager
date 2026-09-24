import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App'
import { lastBenchmark, runBenchmark } from './state/benchmark'

// Temporary console hooks for the scan benchmark: `await fpmBenchmark()`.
declare global {
  interface Window {
    fpmBenchmark: typeof runBenchmark
    fpmBenchmarkResults: typeof lastBenchmark
  }
}
window.fpmBenchmark = runBenchmark
window.fpmBenchmarkResults = lastBenchmark

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
