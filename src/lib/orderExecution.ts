import type { Candle, PendingOrder } from '../types/index.ts'

export type PendingOrderEvaluation = {
  triggered: boolean
  fillable: boolean
}

export function evaluatePendingOrder(
  order: PendingOrder,
  candle: Candle,
  spread: number,
): PendingOrderEvaluation {
  const quoteHigh = order.type === 'buy' ? candle.high + spread : candle.high
  const quoteLow = order.type === 'buy' ? candle.low + spread : candle.low

  if (order.orderKind === 'limit') {
    return {
      triggered: false,
      fillable: order.type === 'buy'
        ? quoteLow <= order.entryPrice
        : quoteHigh >= order.entryPrice,
    }
  }

  if (order.orderKind === 'stop') {
    const triggered = order.type === 'buy'
      ? quoteHigh >= order.entryPrice
      : quoteLow <= order.entryPrice
    return { triggered, fillable: triggered }
  }

  const triggered = Boolean(order.stopLimitTriggered) || (
    order.type === 'buy'
      ? quoteHigh >= order.entryPrice
      : quoteLow <= order.entryPrice
  )
  if (!triggered) return { triggered: false, fillable: false }

  const limitPrice = order.limitPrice ?? order.entryPrice
  return {
    triggered: true,
    fillable: order.type === 'buy'
      ? quoteLow <= limitPrice
      : quoteHigh >= limitPrice,
  }
}
