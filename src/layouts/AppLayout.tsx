import { useState, type ReactNode } from 'react'
import CandleChart from '../components/Chart/CandleChart'
import Toolbar from '../components/Toolbar/Toolbar'
import OrderPanel from '../components/OrderPanel/OrderPanel'
import TradeJournal from '../components/TradeJournal/TradeJournal'
import { useSimStore } from '../store/simStore'

type Props = {
  theme: 'dark' | 'light'
  userPhone: string
  onToggleTheme: () => void
}

type MobilePage = 'chart' | 'order' | 'history'

const mobilePages: Array<{ id: MobilePage; label: string; icon: ReactNode }> = [
  {
    id: 'chart',
    label: 'نمودار',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M7 15l3-4 3 2 4-7" />
        <path d="M7 15h2M10 11h2M13 13h2M17 6h2" />
      </svg>
    ),
  },
  {
    id: 'order',
    label: 'سفارش',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 6h14" />
        <path d="M5 12h14" />
        <path d="M5 18h9" />
        <path d="M16 15l3 3 3-3" />
      </svg>
    ),
  },
  {
    id: 'history',
    label: 'تاریخچه',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6v5h5" />
        <path d="M5.5 15a7 7 0 1 0 .9-7.9L4 11" />
        <path d="M12 8v5l3 2" />
      </svg>
    ),
  },
]

export default function AppLayout({ theme, userPhone, onToggleTheme }: Props) {
  const [mobilePage, setMobilePage] = useState<MobilePage>('chart')
  const symbol = useSimStore(s => s.symbol)
  const symbolLabel = useSimStore(s => s.symbolLabel)
  const timeframe = useSimStore(s => s.timeframe)

  return (
    <div className={`app mobilePage-${mobilePage}`}>
      <header className="header">

        <span className="logo">CSV Trade Simulator</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" style={{fontSize: 10}}>Charts by TradingView</a>
        <span className="pair">{symbolLabel || symbol.replace('_', '/')} · {timeframe.toUpperCase()}</span>
        <button
          type="button"
          className="themeToggle"
          title={theme === 'dark' ? 'تم روشن' : 'تم تاریک'}
          aria-label={theme === 'dark' ? 'تغییر به تم روشن' : 'تغییر به تم تاریک'}
          onClick={onToggleTheme}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
            <path d="M15.899 12.899a4 4 0 0 1-4.797-4.797A4.002 4.002 0 0 0 12 16c1.9 0 3.49-1.325 3.899-3.101z" />
            <path d="M12 5V3M12 21v-2" />
            <path d="M5 12H2h3zM22 12h-3 3zM16.95 7.05L19.07 4.93 16.95 7.05zM4.929 19.071L7.05 16.95 4.93 19.07zM16.95 16.95l2.121 2.121-2.121-2.121zM4.929 4.929L7.05 7.05 4.93 4.93z" />
          </svg>
        </button>
        <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
          {userPhone}
          <button type="button" onClick={() => window.location.assign(window.location.pathname)}>انتخاب CSV جدید</button>
        </span>
      </header>
      <Toolbar />
      <main className={`chartArea mobileView-${mobilePage}`}>
        <div className="workspace">
          <div className="chartPane">
            <CandleChart />
          </div>
          <TradeJournal />
        </div>
        <OrderPanel />
      </main>
      <nav className="mobileNav" aria-label="ناوبری موبایل">
        {mobilePages.map(page => {
          const active = mobilePage === page.id
          return (
            <button
              key={page.id}
              type="button"
              className={`mobileNavButton ${active ? 'mobileNavButtonActive' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => setMobilePage(page.id)}
            >
              <span className="mobileNavIcon">{page.icon}</span>
              <span>{page.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
