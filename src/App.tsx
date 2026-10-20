import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import TradeReportPage from './pages/TradeReportPage'
import { parseCsv } from './lib/csv'
import { setDataset } from './api/market'
import { useSimStore } from './store/simStore'
import './App.css'
import './import.css'

export default function App() {
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [file, setFile] = useState<File | null>(null)
  const [symbol, setSymbol] = useState('EUR_USD')
  const [minutes, setMinutes] = useState(5)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  async function start() {
    if (!file) { setError('یک فایل CSV انتخاب کنید.'); return }
    if (!/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(symbol) || ![5, 10, 15].includes(minutes)) { setError('نماد و تایم‌فریم را درست وارد کنید.'); return }
    setBusy(true); setError('')
    try {
      const candles = parseCsv(await file.text())
      setDataset(candles, symbol, minutes)
      const state = useSimStore.getState()
      state.setMarket({ symbol, symbolLabel: symbol.replace('_', '/'), timeframe: `${minutes}m` })
      state.applySessionSettings({ ...useSimStore.getState().config, sessionStart: '' })
      setReady(true)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <HashRouter><Routes>
    <Route path="/app/report" element={<TradeReportPage />} />
    <Route path="/app" element={ready ? <AppLayout theme={theme} userPhone={file?.name ?? ''} onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} /> : <main className="csvImport" dir="rtl">
      <h1>شبیه‌ساز ترید با CSV</h1><p>فایل فقط در مرورگر شما خوانده می‌شود و جایی آپلود نمی‌شود.</p>
      <label>فایل کندل‌ها<input type="file" accept=".csv,.tsv,.txt" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
      <label>نماد (مثل EUR_USD یا BTC_USDT)<input dir="ltr" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase().trim())} /></label>
      <label>تایم‌فریم هر ردیف، به دقیقه<select value={minutes} onChange={e => setMinutes(Number(e.target.value))}>{[5, 10, 15].map(value => <option key={value} value={value}>{value} دقیقه</option>)}</select></label>
      <p>فقط CSV با کندل‌های ۵، ۱۰ یا ۱۵ دقیقه‌ای پذیرفته می‌شود. نمودار فقط به تایم‌فریم برابر یا بالاتر که مضرب تایم‌فریم فایل باشد تبدیل می‌شود؛ مثلاً ۱۰ به ۱۵ قابل تبدیل نیست.</p><p dir="ltr">timestamp,open,high,low,close,volume</p><p>زمان بدون منطقهٔ زمانی، UTC محسوب می‌شود. ستون volume اختیاری است.</p>
      <p><a href="./examples/sample.csv" download>دانلود CSV نمونهٔ ساختگی</a></p>
      {error && <p role="alert">{error}</p>}<button disabled={busy} onClick={() => void start()}>{busy ? 'در حال خواندن…' : 'شروع شبیه‌سازی'}</button>
    </main>} />
    <Route path="*" element={<Navigate to="/app" replace />} />
  </Routes></HashRouter>
}
