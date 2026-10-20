import { Link, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useSimStore } from '../store/simStore'
import { buildTradeReport, decodeReport, encodeReport, type BalancePoint, type ReportBreakdown, type TradeReportData } from '../lib/tradeReport'
import { toFarsi } from '../lib/farsi'
import { DEFAULT_SYMBOL } from '../lib/marketConfig'
import { formatSymbolPrice } from '../lib/symbolPrice'
import './TradeReportPage.css'

function money(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function num(value: number | null | undefined, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '0.00'
}

function excelNum(value: number | null | undefined, digits = 2) {
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : ''
}

function formatDuration(minutes?: number) {
  if (minutes === undefined) return '-'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours}h ${rest}m`
}

function htmlEscape(value: string | number | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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

function buildExcelHtml(report: TradeReportData) {
  const metrics = report.metrics
  const summaryRows = [
    ['Generated At', report.exportedAt],
    ['Initial Balance', metrics.initialBalance],
    ['Final Balance', metrics.finalBalance],
    ['Equity', report.equity],
    ['Net PnL', metrics.net],
    ['Floating PnL', report.floating],
    ['Growth %', metrics.growthPercent],
    ['Total Trades', metrics.total],
    ['Closed Trades', metrics.closed],
    ['Open Trades', metrics.open],
    ['Wins', metrics.wins],
    ['Losses', metrics.losses],
    ['Breakeven', metrics.breakeven],
    ['Win Rate %', metrics.winRate],
    ['Profit Factor', metrics.profitFactor === Infinity ? 'Infinity' : metrics.profitFactor],
    ['Expectancy', metrics.expectancy],
    ['Payoff Ratio', metrics.payoffRatio === Infinity ? 'Infinity' : metrics.payoffRatio],
    ['Recovery Factor', metrics.recoveryFactor === Infinity ? 'Infinity' : metrics.recoveryFactor],
    ['Max Drawdown', metrics.maxDrawdown],
    ['Max Drawdown %', metrics.maxDrawdownPercent],
    ['Average R', metrics.avgRMultiple],
    ['Average Planned R/R', metrics.avgPlannedRiskReward],
  ]

  const breakdownTable = (title: string, rows: ReportBreakdown[]) => `
    <h2>${htmlEscape(title)}</h2>
    <table>
      <tr><th>Label</th><th>Count</th><th>Wins</th><th>Losses</th><th>Net</th><th>Win Rate %</th><th>Avg PnL</th><th>Profit Factor</th></tr>
      ${rows.map(row => `
        <tr>
          <td>${htmlEscape(row.label)}</td>
          <td>${row.count}</td>
          <td>${row.wins}</td>
          <td>${row.losses}</td>
          <td>${excelNum(row.net)}</td>
          <td>${excelNum(row.winRate)}</td>
          <td>${excelNum(row.avgPnl)}</td>
          <td>${excelNum(row.profitFactor)}</td>
        </tr>
      `).join('')}
    </table>
  `

  return `
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body, table { font-family: Vazirmatn, Tahoma, Arial, sans-serif; direction: rtl; }
          table { border-collapse: collapse; margin-bottom: 22px; width: 100%; }
          th, td { border: 1px solid #DBD3D8; padding: 6px 8px; text-align: right; }
          th { background: #223843; color: #EFF1F3; }
          h1, h2 { color: #223843; }
        </style>
      </head>
      <body>
        <h1>Trade History Report</h1>
        <h2>Summary</h2>
        <table>${summaryRows.map(row => `<tr><th>${htmlEscape(row[0])}</th><td>${htmlEscape(row[1])}</td></tr>`).join('')}</table>

        <h2>Balance Curve</h2>
        <table>
          <tr><th>Index</th><th>Label</th><th>Balance</th></tr>
          ${report.balanceCurve.map((point, index) => `<tr><td>${index}</td><td>${htmlEscape(point.label)}</td><td>${excelNum(point.value)}</td></tr>`).join('')}
        </table>

        ${breakdownTable('By Side', report.breakdowns.bySide)}
        ${breakdownTable('By Order Kind', report.breakdowns.byOrderKind)}
        ${breakdownTable('By Exit Reason', report.breakdowns.byExitReason)}
        ${breakdownTable('By Weekday', report.breakdowns.byWeekday)}
        ${breakdownTable('By Hour', report.breakdowns.byHour)}

        <h2>Trades</h2>
        <table>
          <tr>
            <th>ID</th><th>Status</th><th>Side</th><th>Order Kind</th><th>Lots</th><th>Open Time</th><th>Open Price</th>
            <th>Close Time</th><th>Close Price</th><th>SL</th><th>TP</th><th>Exit Reason</th><th>Duration Minutes</th><th>R</th><th>PnL</th>
          </tr>
          ${report.trades.map(trade => `
            <tr>
              <td>${htmlEscape(trade.id)}</td>
              <td>${htmlEscape(trade.status)}</td>
              <td>${htmlEscape(trade.type)}</td>
              <td>${htmlEscape(trade.orderKind ?? 'market')}</td>
              <td>${trade.lots}</td>
              <td>${htmlEscape(trade.openTime)}</td>
              <td>${trade.openPrice}</td>
              <td>${htmlEscape(trade.closeTime ?? '')}</td>
              <td>${trade.closePrice ?? ''}</td>
              <td>${trade.sl ?? ''}</td>
              <td>${trade.tp ?? ''}</td>
              <td>${htmlEscape(trade.exitReason ?? '')}</td>
              <td>${trade.durationMinutes ?? ''}</td>
              <td>${excelNum(trade.rMultiple)}</td>
              <td>${excelNum(trade.displayPnl)}</td>
            </tr>
          `).join('')}
        </table>
      </body>
    </html>
  `
}

export default function TradeReportPage() {
  const [searchParams] = useSearchParams()
  const [copied, setCopied] = useState(false)
  const { candles, visibleIndex, trades, balance, config, symbol } = useSimStore()

  const currentCandle = candles[visibleIndex - 1]
  const bidPrice = currentCandle?.close ?? 0
  const askPrice = bidPrice + config.spread
  const sharedReport = useMemo(() => {
    const encoded = searchParams.get('report')
    return encoded ? decodeReport(encoded) : null
  }, [searchParams])

  const liveReport = useMemo(
    () => buildTradeReport({ trades, balance, config, bidPrice, askPrice, symbol }),
    [askPrice, balance, bidPrice, config, symbol, trades],
  )
  const report = sharedReport ?? liveReport
  const reportSymbol = report.symbol ?? symbol ?? DEFAULT_SYMBOL
  const metrics = report.metrics
  const rows = [...report.trades].sort((a, b) => (b.openTime ?? '').localeCompare(a.openTime ?? ''))

  async function shareReport() {
    const url = `${window.location.origin}${window.location.pathname}#/app/report?report=${encodeReport(report)}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  function exportExcel() {
    downloadFile(
      `trade-report-${new Date().toISOString().slice(0, 10)}.xls`,
      buildExcelHtml(report),
      'application/vnd.ms-excel;charset=utf-8',
    )
  }

  return (
    <main className="reportPage">
      <header className="reportTopbar">
        <div>
          <div className="reportKicker">گزارش معاملات</div>
          <h1>Trade History Report</h1>
          <p>{toFarsi(metrics.total.toString())} معامله · ساخته‌شده در {toFarsi(report.exportedAt.slice(0, 16).replace('T', ' '))}</p>
        </div>
        <div className="reportActions">
          <Link className="reportGhostBtn" to="/app">بازگشت به نمودار</Link>
          <button className="reportActionBtn" type="button" onClick={shareReport}>
            {copied ? 'لینک کپی شد' : 'اشتراک با لینک'}
          </button>
          <button className="reportActionBtn" type="button" onClick={exportExcel}>
            خروجی Excel
          </button>
          <button className="reportActionBtn primary" type="button" onClick={() => window.print()}>
            ذخیره PDF
          </button>
        </div>
      </header>

      <section className="reportHero">
        <MetricCard label="سود/زیان خالص" value={toFarsi(money(metrics.net))} tone={metrics.net >= 0 ? 'pos' : 'neg'} />
        <MetricCard label="ارزش خالص" value={toFarsi(`$${report.equity.toFixed(2)}`)} />
        <MetricCard label="درصد موفقیت" value={toFarsi(`${num(metrics.winRate)}%`)} />
        <MetricCard label="ضریب سود" value={toFarsi(metrics.profitFactor === Infinity ? '∞' : num(metrics.profitFactor))} />
        <MetricCard label="Expectancy" value={toFarsi(money(metrics.expectancy))} tone={metrics.expectancy >= 0 ? 'pos' : 'neg'} />
        <MetricCard label="Payoff Ratio" value={toFarsi(metrics.payoffRatio === Infinity ? '∞' : num(metrics.payoffRatio))} />
      </section>

      <section className="reportGrid">
        <div className="reportPanel chartPanel">
          <div className="panelHeader">
            <h2>نمودار Balance</h2>
            <span>{toFarsi(`شروع $${metrics.initialBalance.toFixed(2)} · پایان $${metrics.finalBalance.toFixed(2)}`)}</span>
          </div>
          <BalanceChart points={report.balanceCurve} />
        </div>

        <div className="reportPanel">
          <div className="panelHeader">
            <h2>کیفیت عملکرد</h2>
          </div>
          <div className="metricList">
            <InlineMetric label="رشد حساب" value={`${num(metrics.growthPercent)}%`} tone={metrics.growthPercent >= 0 ? 'pos' : 'neg'} />
            <InlineMetric label="بیشترین افت سرمایه" value={`${money(-metrics.maxDrawdown)} (${num(metrics.maxDrawdownPercent)}%)`} tone="neg" />
            <InlineMetric label="افت فعلی" value={money(-metrics.currentDrawdown)} tone={metrics.currentDrawdown > 0 ? 'neg' : undefined} />
            <InlineMetric label="میانگین R" value={num(metrics.avgRMultiple)} tone={metrics.avgRMultiple >= 0 ? 'pos' : 'neg'} />
            <InlineMetric label="میانگین R/R پلن‌شده" value={num(metrics.avgPlannedRiskReward)} />
            <InlineMetric label="Recovery Factor" value={metrics.recoveryFactor === Infinity ? '∞' : num(metrics.recoveryFactor)} tone={metrics.recoveryFactor >= 0 ? 'pos' : 'neg'} />
            <InlineMetric label="میانگین زمان معامله" value={formatDuration(metrics.avgDurationMinutes)} />
          </div>
        </div>
      </section>

      <section className="reportGrid">
        <div className="reportPanel">
          <div className="panelHeader">
            <h2>برد و باخت</h2>
          </div>
          <div className="metricList">
            <InlineMetric label="برد / باخت / سربه‌سر" value={`${metrics.wins} / ${metrics.losses} / ${metrics.breakeven}`} />
            <InlineMetric label="میانگین سود" value={money(metrics.avgWin)} tone="pos" />
            <InlineMetric label="میانگین ضرر" value={money(-metrics.avgLoss)} tone="neg" />
            <InlineMetric label="بهترین معامله" value={money(metrics.best)} tone={metrics.best >= 0 ? 'pos' : 'neg'} />
            <InlineMetric label="بدترین معامله" value={money(metrics.worst)} tone="neg" />
            <InlineMetric label="بیشترین برد/باخت متوالی" value={`${metrics.longestWinStreak} / ${metrics.longestLossStreak}`} />
          </div>
        </div>

        <div className="reportPanel">
          <div className="panelHeader">
            <h2>رفتار و مدیریت ریسک</h2>
          </div>
          <div className="metricList">
            <InlineMetric label="معاملات باز / بسته" value={`${metrics.open} / ${metrics.closed}`} />
            <InlineMetric label="خرید / فروش" value={`${metrics.buyCount} / ${metrics.sellCount}`} />
            <InlineMetric label="خروج طبق پلن / دستی" value={`${metrics.plannedExitCount} / ${metrics.manualExitCount}`} />
            <InlineMetric label="معاملات دارای SL" value={`${metrics.tradesWithSl} از ${metrics.total}`} />
            <InlineMetric label="معاملات دارای TP" value={`${metrics.tradesWithTp} از ${metrics.total}`} />
            <InlineMetric label="پوشش SL / TP" value={`${num(metrics.slCoveragePercent)}% / ${num(metrics.tpCoveragePercent)}%`} />
          </div>
        </div>
      </section>

      <section className="reportGrid reportGridThree">
        <BreakdownPanel title="عملکرد بر اساس نوع سفارش" rows={report.breakdowns.byOrderKind} />
        <BreakdownPanel title="عملکرد بر اساس دلیل خروج" rows={report.breakdowns.byExitReason} />
        <BreakdownPanel title="عملکرد بر اساس جهت معامله" rows={report.breakdowns.bySide} />
      </section>

      <section className="reportGrid">
        <BreakdownPanel title="بهترین/بدترین روزهای هفته" rows={report.breakdowns.byWeekday} />
        <BreakdownPanel title="عملکرد بر اساس ساعت ورود" rows={report.breakdowns.byHour} compact />
      </section>

      <section className="reportPanel tablePanel">
        <div className="panelHeader">
          <h2>جزئیات معاملات</h2>
          <span>{toFarsi(`${rows.length} ردیف`)}</span>
        </div>
        <div className="reportTableWrap">
          <table className="reportTable">
            <thead>
              <tr>
                <th>وضعیت</th>
                <th>جهت</th>
                <th>نوع سفارش</th>
                <th>حجم</th>
                <th>ورود</th>
                <th>خروج</th>
                <th>SL / TP</th>
                <th>دلیل خروج</th>
                <th>زمان</th>
                <th>R</th>
                <th>سود/زیان</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="reportEmpty">هنوز معامله‌ای برای گزارش وجود ندارد</td>
                </tr>
              )}
              {rows.map(row => (
                <tr key={row.id}>
                  <td><span className={`reportPill ${row.status}`}>{row.status}</span></td>
                  <td><span className={`reportPill ${row.type}`}>{row.type}</span></td>
                  <td>{row.orderKind ?? 'market'}</td>
                  <td>{toFarsi(row.lots.toFixed(2))}</td>
                  <td>{toFarsi(`${formatSymbolPrice(reportSymbol, row.openPrice)} · ${row.openTime.slice(0, 16)}`)}</td>
                  <td>{toFarsi(row.closePrice !== undefined ? `${formatSymbolPrice(reportSymbol, row.closePrice)} · ${row.closeTime?.slice(0, 16) ?? '-'}` : '-')}</td>
                  <td>{toFarsi(`${row.sl === undefined ? '-' : formatSymbolPrice(reportSymbol, row.sl)} / ${row.tp === undefined ? '-' : formatSymbolPrice(reportSymbol, row.tp)}`)}</td>
                  <td>{row.exitReason ?? '-'}</td>
                  <td>{toFarsi(formatDuration(row.durationMinutes))}</td>
                  <td>{toFarsi(row.rMultiple !== undefined ? num(row.rMultiple) : '-')}</td>
                  <td className={row.displayPnl >= 0 ? 'reportPos' : 'reportNeg'}>{toFarsi(money(row.displayPnl))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="metricCard">
      <span>{label}</span>
      <strong className={tone === 'pos' ? 'reportPos' : tone === 'neg' ? 'reportNeg' : ''}>{value}</strong>
    </div>
  )
}

function InlineMetric({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="inlineMetric">
      <span>{label}</span>
      <strong className={tone === 'pos' ? 'reportPos' : tone === 'neg' ? 'reportNeg' : ''}>{toFarsi(value)}</strong>
    </div>
  )
}

function BreakdownPanel({ title, rows, compact = false }: { title: string; rows: ReportBreakdown[]; compact?: boolean }) {
  const visibleRows = compact ? rows.slice(0, 8) : rows
  return (
    <div className="reportPanel">
      <div className="panelHeader">
        <h2>{title}</h2>
        <span>{toFarsi(`${rows.length} گروه`)}</span>
      </div>
      <div className="miniTableWrap">
        <table className="miniTable">
          <thead>
            <tr>
              <th>گروه</th>
              <th>تعداد</th>
              <th>Win%</th>
              <th>Avg</th>
              <th>Net</th>
              <th>PF</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr><td colSpan={6} className="reportEmpty">داده‌ای وجود ندارد</td></tr>
            )}
            {visibleRows.map(row => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{toFarsi(row.count.toString())}</td>
                <td>{toFarsi(`${num(row.winRate)}%`)}</td>
                <td className={row.avgPnl >= 0 ? 'reportPos' : 'reportNeg'}>{toFarsi(money(row.avgPnl))}</td>
                <td className={row.net >= 0 ? 'reportPos' : 'reportNeg'}>{toFarsi(money(row.net))}</td>
                <td>{toFarsi(row.profitFactor === Infinity ? '∞' : num(row.profitFactor))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BalanceChart({ points }: { points: BalancePoint[] }) {
  const width = 860
  const height = 260
  const pad = 28
  const values = points.length ? points.map(point => point.value) : [0]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const xStep = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0
  const coords = points.map((point, index) => {
    const x = pad + index * xStep
    const y = height - pad - ((point.value - min) / range) * (height - pad * 2)
    return { x, y, point }
  })
  const path = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`).join(' ')
  const fillPath = coords.length ? `${path} L ${coords.at(-1)!.x.toFixed(1)} ${height - pad} L ${coords[0].x.toFixed(1)} ${height - pad} Z` : ''
  const last = coords.at(-1)

  return (
    <div className="balanceChart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="نمودار تغییرات بالانس">
        <defs>
          <linearGradient id="balanceFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--palette-coral)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--palette-sand)" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map(line => {
          const y = pad + line * ((height - pad * 2) / 3)
          return <line key={line} x1={pad} x2={width - pad} y1={y} y2={y} className="chartGridLine" />
        })}
        {fillPath && <path d={fillPath} fill="url(#balanceFill)" />}
        {path && <path d={path} className="balanceLine" />}
        {coords.map((coord, index) => (
          <circle key={`${coord.point.label}-${index}`} cx={coord.x} cy={coord.y} r={index === coords.length - 1 ? 4 : 2.5} className="balanceDot" />
        ))}
        <text x={pad} y={18} className="chartAxisText">{toFarsi(`max ${max.toFixed(2)}`)}</text>
        <text x={pad} y={height - 8} className="chartAxisText">{toFarsi(`min ${min.toFixed(2)}`)}</text>
        {last && (
          <text x={Math.min(width - 136, last.x + 10)} y={Math.max(22, last.y - 10)} className="chartLastText">
            {toFarsi(`$${last.point.value.toFixed(2)}`)}
          </text>
        )}
      </svg>
    </div>
  )
}
