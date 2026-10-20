import type { SimConfig, Trade } from '../types'
import { DEFAULT_SYMBOL, calculateSymbolPnl } from './marketConfig'

export type ReportTrade = Trade & {
  status: 'open' | 'closed'
  displayPnl: number
  durationMinutes?: number
  rMultiple?: number
}

export type BalancePoint = {
  label: string
  value: number
}

export type ReportBreakdown = {
  label: string
  count: number
  wins: number
  losses: number
  net: number
  winRate: number
  avgPnl: number
  profitFactor: number
}

export type TradeReportData = {
  symbol: string
  exportedAt: string
  config: SimConfig
  balance: number
  floating: number
  equity: number
  trades: ReportTrade[]
  balanceCurve: BalancePoint[]
  breakdowns: {
    bySide: ReportBreakdown[]
    byOrderKind: ReportBreakdown[]
    byExitReason: ReportBreakdown[]
    byWeekday: ReportBreakdown[]
    byHour: ReportBreakdown[]
  }
  metrics: {
    total: number
    open: number
    closed: number
    wins: number
    losses: number
    breakeven: number
    winRate: number
    net: number
    grossWin: number
    grossLoss: number
    profitFactor: number
    avgWin: number
    avgLoss: number
    avgTrade: number
    expectancy: number
    payoffRatio: number
    recoveryFactor: number
    best: number
    worst: number
    initialBalance: number
    finalBalance: number
    growthPercent: number
    maxDrawdown: number
    maxDrawdownPercent: number
    currentDrawdown: number
    avgRMultiple: number
    avgDurationMinutes: number
    longestWinStreak: number
    longestLossStreak: number
    buyCount: number
    sellCount: number
    plannedExitCount: number
    manualExitCount: number
    tradesWithSl: number
    tradesWithTp: number
    slCoveragePercent: number
    tpCoveragePercent: number
    avgPlannedRiskReward: number
  }
}

type BuildInput = {
  trades: Trade[]
  balance: number
  config: SimConfig
  bidPrice: number
  askPrice: number
  symbol?: string
}

function diffMinutes(from?: string, to?: string) {
  if (!from || !to) return undefined
  const start = new Date(from).getTime()
  const end = new Date(to).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined
  return Math.max(0, Math.round((end - start) / 60000))
}

function calcRMultiple(symbol: string, trade: Trade, pnl: number) {
  if (trade.sl === undefined) return undefined
  const riskPerLot = Math.abs(calculateSymbolPnl(symbol, trade.type, trade.openPrice, trade.sl, trade.lots))
  if (!riskPerLot) return undefined
  return pnl / riskPerLot
}

function longestStreak(values: number[], isMatch: (value: number) => boolean) {
  let current = 0
  let longest = 0
  values.forEach(value => {
    if (isMatch(value)) {
      current += 1
      longest = Math.max(longest, current)
    } else {
      current = 0
    }
  })
  return longest
}

function maxDrawdownFromCurve(points: BalancePoint[]) {
  let peak = points[0]?.value ?? 0
  let maxDrawdown = 0
  let maxDrawdownPercent = 0

  points.forEach(point => {
    peak = Math.max(peak, point.value)
    const drawdown = peak - point.value
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
      maxDrawdownPercent = peak ? drawdown / peak * 100 : 0
    }
  })

  const lastValue = points.at(-1)?.value ?? peak
  const currentDrawdown = Math.max(0, peak - lastValue)
  return { maxDrawdown, maxDrawdownPercent, currentDrawdown }
}

function calcPlannedRiskReward(trade: ReportTrade) {
  if (trade.sl === undefined || trade.tp === undefined) return undefined
  const risk = Math.abs(trade.openPrice - trade.sl)
  const reward = Math.abs(trade.tp - trade.openPrice)
  if (!risk) return undefined
  return reward / risk
}

function makeBreakdown<T extends ReportTrade>(
  trades: T[],
  getKey: (trade: T) => string,
) {
  const groups = new Map<string, T[]>()
  trades.forEach(trade => {
    const key = getKey(trade)
    groups.set(key, [...(groups.get(key) ?? []), trade])
  })

  return Array.from(groups.entries())
    .map(([label, group]): ReportBreakdown => {
      const pnls = group.map(trade => trade.displayPnl)
      const wins = pnls.filter(pnl => pnl > 0)
      const losses = pnls.filter(pnl => pnl < 0)
      const grossWin = wins.reduce((sum, pnl) => sum + pnl, 0)
      const grossLoss = Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0))
      const net = pnls.reduce((sum, pnl) => sum + pnl, 0)
      return {
        label,
        count: group.length,
        wins: wins.length,
        losses: losses.length,
        net,
        winRate: group.length ? wins.length / group.length * 100 : 0,
        avgPnl: group.length ? net / group.length : 0,
        profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      }
    })
    .sort((a, b) => b.net - a.net)
}

const weekdayLabels = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

export function buildTradeReport({ trades, balance, config, bidPrice, askPrice, symbol = DEFAULT_SYMBOL }: BuildInput): TradeReportData {
  const reportTrades = trades.map((trade): ReportTrade => {
    if (trade.closePrice !== undefined) {
      const displayPnl = trade.pnl ?? 0
      return {
        ...trade,
        status: 'closed',
        displayPnl,
        durationMinutes: diffMinutes(trade.openTime, trade.closeTime),
        rMultiple: calcRMultiple(symbol, trade, displayPnl),
      }
    }

    const exitPrice = trade.type === 'buy' ? bidPrice : askPrice
    const displayPnl = bidPrice
      ? calculateSymbolPnl(symbol, trade.type, trade.openPrice, exitPrice, trade.lots)
      : 0

    return {
      ...trade,
      status: 'open',
      displayPnl,
      durationMinutes: undefined,
      rMultiple: calcRMultiple(symbol, trade, displayPnl),
    }
  })

  const closed = reportTrades.filter(trade => trade.status === 'closed')
  const open = reportTrades.filter(trade => trade.status === 'open')
  const closedByTime = [...closed].sort((a, b) => (a.closeTime ?? '').localeCompare(b.closeTime ?? ''))
  const pnls = closedByTime.map(trade => trade.displayPnl)
  const wins = pnls.filter(pnl => pnl > 0)
  const losses = pnls.filter(pnl => pnl < 0)
  const breakeven = pnls.filter(pnl => pnl === 0)
  const net = pnls.reduce((sum, pnl) => sum + pnl, 0)
  const grossWin = wins.reduce((sum, pnl) => sum + pnl, 0)
  const grossLoss = Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0))
  const floating = open.reduce((sum, trade) => sum + trade.displayPnl, 0)

  let curveBalance = config.balance
  const balanceCurve: BalancePoint[] = [{ label: 'شروع', value: curveBalance }]
  closedByTime.forEach((trade, index) => {
    curveBalance += trade.displayPnl
    balanceCurve.push({
      label: trade.closeTime?.slice(0, 10) ?? `#${index + 1}`,
      value: curveBalance,
    })
  })

  const drawdown = maxDrawdownFromCurve(balanceCurve)
  const rMultiples = reportTrades.map(trade => trade.rMultiple).filter((value): value is number => value !== undefined)
  const durations = closed.map(trade => trade.durationMinutes).filter((value): value is number => value !== undefined)
  const plannedRiskRewards = reportTrades.map(calcPlannedRiskReward).filter((value): value is number => value !== undefined)
  const finalBalance = balanceCurve.at(-1)?.value ?? balance
  const avgWin = wins.length ? grossWin / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  const avgTrade = closed.length ? net / closed.length : 0
  const winRateDecimal = closed.length ? wins.length / closed.length : 0
  const lossRateDecimal = closed.length ? losses.length / closed.length : 0

  return {
    symbol,
    exportedAt: new Date().toISOString(),
    config,
    balance,
    floating,
    equity: balance + floating,
    trades: reportTrades,
    balanceCurve,
    breakdowns: {
      bySide: makeBreakdown(closed, trade => trade.type),
      byOrderKind: makeBreakdown(closed, trade => trade.orderKind ?? 'market'),
      byExitReason: makeBreakdown(closed, trade => trade.exitReason ?? 'unknown'),
      byWeekday: makeBreakdown(closed, trade => {
        const day = new Date(trade.openTime).getDay()
        return weekdayLabels[day] ?? 'نامشخص'
      }),
      byHour: makeBreakdown(closed, trade => {
        const hour = new Date(trade.openTime).getHours()
        return Number.isFinite(hour) ? `${hour.toString().padStart(2, '0')}:00` : 'نامشخص'
      }),
    },
    metrics: {
      total: reportTrades.length,
      open: open.length,
      closed: closed.length,
      wins: wins.length,
      losses: losses.length,
      breakeven: breakeven.length,
      winRate: closed.length ? wins.length / closed.length * 100 : 0,
      net,
      grossWin,
      grossLoss,
      profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      avgWin,
      avgLoss,
      avgTrade,
      expectancy: winRateDecimal * avgWin - lossRateDecimal * avgLoss,
      payoffRatio: avgLoss ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
      recoveryFactor: drawdown.maxDrawdown ? net / drawdown.maxDrawdown : net > 0 ? Infinity : 0,
      best: pnls.length ? Math.max(...pnls) : 0,
      worst: pnls.length ? Math.min(...pnls) : 0,
      initialBalance: config.balance,
      finalBalance,
      growthPercent: config.balance ? (finalBalance - config.balance) / config.balance * 100 : 0,
      maxDrawdown: drawdown.maxDrawdown,
      maxDrawdownPercent: drawdown.maxDrawdownPercent,
      currentDrawdown: drawdown.currentDrawdown,
      avgRMultiple: rMultiples.length ? rMultiples.reduce((sum, value) => sum + value, 0) / rMultiples.length : 0,
      avgDurationMinutes: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
      longestWinStreak: longestStreak(pnls, value => value > 0),
      longestLossStreak: longestStreak(pnls, value => value < 0),
      buyCount: reportTrades.filter(trade => trade.type === 'buy').length,
      sellCount: reportTrades.filter(trade => trade.type === 'sell').length,
      plannedExitCount: closed.filter(trade => trade.exitReason === 'sl' || trade.exitReason === 'tp').length,
      manualExitCount: closed.filter(trade => trade.exitReason === 'manual').length,
      tradesWithSl: reportTrades.filter(trade => trade.sl !== undefined).length,
      tradesWithTp: reportTrades.filter(trade => trade.tp !== undefined).length,
      slCoveragePercent: reportTrades.length ? reportTrades.filter(trade => trade.sl !== undefined).length / reportTrades.length * 100 : 0,
      tpCoveragePercent: reportTrades.length ? reportTrades.filter(trade => trade.tp !== undefined).length / reportTrades.length * 100 : 0,
      avgPlannedRiskReward: plannedRiskRewards.length ? plannedRiskRewards.reduce((sum, value) => sum + value, 0) / plannedRiskRewards.length : 0,
    },
  }
}

export function encodeReport(data: TradeReportData) {
  const json = JSON.stringify(data)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeReport(value: string): TradeReportData | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as TradeReportData
    return { ...parsed, symbol: parsed.symbol ?? DEFAULT_SYMBOL }
  } catch {
    return null
  }
}
