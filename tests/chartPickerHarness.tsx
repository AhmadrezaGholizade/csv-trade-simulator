import { createRoot } from 'react-dom/client'
import CandleChart from '../src/components/Chart/CandleChart'
import OrderPanel from '../src/components/OrderPanel/OrderPanel'
import Toolbar from '../src/components/Toolbar/Toolbar'
import { useSimStore } from '../src/store/simStore'
import '../src/index.css'
import '../src/App.css'

const start = Date.UTC(2026, 0, 1)
const candles = Array.from({ length: 180 }, (_, index) => {
  const center = 100 + Math.sin(index / 9) * 1.4
  const close = center + Math.sin(index / 3) * 0.25
  const open = center - Math.cos(index / 4) * 0.2
  return {
    ts: new Date(start + index * 5 * 60_000).toISOString(),
    open,
    high: Math.max(open, close) + 0.35,
    low: Math.min(open, close) - 0.35,
    close,
    volume: 100 + index,
  }
})

useSimStore.setState(state => ({
  ...state,
  candles,
  visibleIndex: candles.length,
  symbol: 'XAU_USD',
  symbolLabel: 'XAU/USD',
  timeframe: '5m',
  config: {
    ...state.config,
    spread: 0.2,
    sessionStart: candles[0].ts,
  },
  orderDraft: {
    ...state.orderDraft,
    type: 'buy',
    orderKind: 'limit',
    entryPrice: '',
  },
  activeOrderPriceField: 'entryPrice',
}))

createRoot(document.getElementById('root')!).render(
  <main style={{
    display: 'flex',
    flexDirection: 'column',
    width: '100vw',
    height: '100vh',
    background: 'var(--surface-0)',
    overflow: 'hidden',
  }}>
    <style>{'[class*="_modalBackdrop_"] { display: none !important; }'}</style>
    <Toolbar />
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <section style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <CandleChart />
      </section>
      <OrderPanel />
    </div>
  </main>,
)
