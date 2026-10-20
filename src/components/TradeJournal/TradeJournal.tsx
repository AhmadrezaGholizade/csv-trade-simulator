import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSimStore } from '../../store/simStore'
import styles from './TradeJournal.module.css'
import { toFarsi } from '../../lib/farsi'
import { buildTradeReport, encodeReport } from '../../lib/tradeReport'
import { formatSymbolPrice } from '../../lib/symbolPrice'


function formatMoney(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

function csvEscape(value: string | number | undefined) {
  const text = value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function TradeJournal() {
  const navigate = useNavigate()
  const { candles, visibleIndex, trades, balance, config, symbol } = useSimStore()

  const currentCandle = candles[visibleIndex - 1]
  const bidPrice = currentCandle?.close ?? 0
  const askPrice = bidPrice + config.spread

  const report = useMemo(() => buildTradeReport({ trades, balance, config, bidPrice, askPrice, symbol }), [askPrice, balance, bidPrice, config, symbol, trades])
  const rows = useMemo(() => [...report.trades].reverse(), [report.trades])
  const stats = report.metrics

  function exportCsv() {
    const headers = ['id', 'status', 'side', 'lots', 'openTime', 'openPrice', 'closeTime', 'closePrice', 'sl', 'tp', 'pnl']
    const lines = rows.slice().reverse().map(row => [
      row.id,
      row.status,
      row.type,
      row.lots,
      row.openTime,
      row.openPrice,
      row.closeTime,
      row.closePrice,
      row.sl,
      row.tp,
      row.displayPnl.toFixed(2),
    ].map(csvEscape).join(','))

    downloadFile('simtrade-journal.csv', [headers.join(','), ...lines].join('\n'), 'text/csv')
  }

  function exportJson() {
    downloadFile(
      'simtrade-journal.json',
      JSON.stringify(report, null, 2),
      'application/json',
    )
  }

  function openReport() {
    const encoded = encodeReport(report)
    navigate(`/app/report?report=${encoded}`)
  }

  function formatLevel(value?: number) {
    return value === undefined ? '-' : formatSymbolPrice(symbol, value)
  }

  return (
    <section className={styles.journal}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>دفتر معاملات</div>
          <div className={styles.subtitle}>{stats.closed} بسته · {stats.open} باز</div>
        </div>
        <div className={styles.actions}>
          <button className={styles.reportBtn} onClick={openReport} disabled={trades.length === 0} title="گزارش معاملات">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 19.5V4.5C4 3.67 4.67 3 5.5 3h13c.83 0 1.5.67 1.5 1.5v15c0 .83-.67 1.5-1.5 1.5h-13c-.83 0-1.5-.67-1.5-1.5Z" />
              <path d="M8 8h8M8 12h8M8 16h4" />
            </svg>
            گزارش
          </button>
          <button className={styles.exportBtn} onClick={exportCsv} disabled={trades.length === 0}>CSV</button>
          <button className={styles.exportBtn} onClick={exportJson} disabled={trades.length === 0}>JSON</button>
        </div>
      </div>

      <div className={styles.stats}>
        <Stat label="سود/زیان خالص" value={toFarsi(formatMoney(stats.net))} tone={stats.net >= 0 ? 'pos' : 'neg'} />
        <Stat label="شناور" value={toFarsi(formatMoney(report.floating))} tone={report.floating >= 0 ? 'pos' : 'neg'} />
        <Stat label="ارزش خالص" value={toFarsi(`$${report.equity.toFixed(2)}`)} />
        <Stat label="درصد موفقیت" value={toFarsi(`${formatNumber(stats.winRate)}%`)} />
        <Stat label="ضریب سود" value={toFarsi(stats.profitFactor === Infinity ? '∞' : formatNumber(stats.profitFactor))} />
        <Stat label="میانگین سود / زیان" value={toFarsi(`${formatNumber(stats.avgWin)} / ${formatNumber(stats.avgLoss)}`)} />
        <Stat label="بهترین" value={toFarsi(formatMoney(stats.best))} tone={stats.best >= 0 ? 'pos' : 'neg'} />
        <Stat label="بدترین" value={toFarsi(formatMoney(stats.worst))} tone={stats.worst >= 0 ? 'pos' : 'neg'} />
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>وضعیت</th>
              <th>جهت</th>
              <th>حجم</th>
              <th>زمان ورود</th>
              <th>ورود</th>
              <th>زمان خروج</th>
              <th>خروج</th>
              <th>ح.ض / هدف</th>
              <th>سود/زیان</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className={styles.empty} colSpan={9}>هنوز معامله‌ای ثبت نشده</td>
              </tr>
            )}
            {rows.map(row => (
              <tr key={row.id}>
                <td><span className={`${styles.status} ${row.status === 'open' ? styles.open : styles.closed}`}>{row.status}</span></td>
                <td><span className={`${styles.side} ${row.type === 'buy' ? styles.buy : styles.sell}`}>{row.type}</span></td>
                <td>{toFarsi(row.lots.toFixed(2))}</td>
                <td>{toFarsi(row.openTime.slice(0, 16))}</td>
                <td>{toFarsi(formatSymbolPrice(symbol, row.openPrice))}</td>
                <td>{toFarsi(row.closeTime?.slice(0, 16) ?? '-')}</td>
                <td>{toFarsi(row.closePrice === undefined ? '-' : formatSymbolPrice(symbol, row.closePrice))}</td>
                <td>{toFarsi(formatLevel(row.sl))} / {toFarsi(formatLevel(row.tp))}</td>
                <td className={row.displayPnl >= 0 ? styles.pnlPos : styles.pnlNeg}>{formatMoney(row.displayPnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={`${styles.statValue} ${tone === 'pos' ? styles.pnlPos : tone === 'neg' ? styles.pnlNeg : ''}`}>{value}</div>
    </div>
  )
}
