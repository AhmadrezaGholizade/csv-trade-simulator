import type { Candle, PendingOrder, Trade } from '../types/index.ts'
import { calculateSymbolPnl } from './marketConfig.ts'
import { evaluatePendingOrder } from './orderExecution.ts'

export type PlaybackTradeState = {
  trades: Trade[]
  pendingOrders: PendingOrder[]
  balance: number
}

function getTradeExit(
  trade: Trade,
  candle: Candle,
  spread: number,
): { price: number; reason: 'sl' | 'tp' } | null {
  if (trade.type === 'buy') {
    if (trade.sl !== undefined && candle.low <= trade.sl) {
      return { price: trade.sl, reason: 'sl' }
    }
    if (trade.tp !== undefined && candle.high >= trade.tp) {
      return { price: trade.tp, reason: 'tp' }
    }
    return null
  }

  const askHigh = candle.high + spread
  const askLow = candle.low + spread
  if (trade.sl !== undefined && askHigh >= trade.sl) {
    return { price: trade.sl, reason: 'sl' }
  }
  if (trade.tp !== undefined && askLow <= trade.tp) {
    return { price: trade.tp, reason: 'tp' }
  }
  return null
}

export function processPlaybackCandle(
  state: PlaybackTradeState,
  candle: Candle,
  symbol: string,
  spread: number,
): PlaybackTradeState {
  // A trade filled during this candle becomes eligible for SL/TP from the next
  // candle, matching the simulator's existing deterministic intrabar policy.
  const openTradeIdsAtCandleStart = new Set(
    state.trades
      .filter(trade => trade.closePrice === undefined)
      .map(trade => trade.id),
  )
  const filledTrades: Trade[] = []

  const pendingOrders = state.pendingOrders.map(order => {
    if (order.status !== 'pending') return order

    const evaluation = evaluatePendingOrder(order, candle, spread)
    if (!evaluation.fillable) {
      return evaluation.triggered && !order.stopLimitTriggered
        ? { ...order, stopLimitTriggered: true }
        : order
    }

    const trade: Trade = {
      id: `${order.id}-t`,
      type: order.type,
      orderKind: order.orderKind,
      openPrice: order.orderKind === 'stop-limit'
        ? (order.limitPrice ?? order.entryPrice)
        : order.entryPrice,
      sl: order.sl,
      tp: order.tp,
      lots: order.lots,
      openTime: candle.ts,
      sourceOrderId: order.id,
    }
    filledTrades.push(trade)
    return {
      ...order,
      status: 'filled' as const,
      filledTradeId: trade.id,
    }
  })

  let balance = state.balance
  const trades = [...state.trades, ...filledTrades].map(trade => {
    if (
      trade.closePrice !== undefined ||
      !openTradeIdsAtCandleStart.has(trade.id)
    ) {
      return trade
    }

    const exit = getTradeExit(trade, candle, spread)
    if (!exit) return trade

    const pnl = calculateSymbolPnl(
      symbol,
      trade.type,
      trade.openPrice,
      exit.price,
      trade.lots,
    )
    balance += pnl
    return {
      ...trade,
      closePrice: exit.price,
      closeTime: candle.ts,
      pnl,
      exitReason: exit.reason,
    }
  })

  return { trades, pendingOrders, balance }
}
