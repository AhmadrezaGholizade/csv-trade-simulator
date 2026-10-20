export interface Candle {
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface MarketMeta {
  symbol: string
  category: string
  native_timeframe: string
  total_candles: number
  start: string | null
  end: string | null
}

export interface CandleResponse {
  symbol: string
  timeframe: string
  count: number
  candles: Candle[]
}

export interface MarketSymbol {
  symbol: string
  category: string
  label: string
}

export interface Timeframe {
  id: string
  minutes: number
}

export interface SimConfig {
  balance: number
  leverage: number
  spread: number
  sessionStart: string
}

export type TradeSide = 'buy' | 'sell'
export type OrderKind = 'market' | 'limit' | 'stop' | 'stop-limit'
export type ExitReason = 'manual' | 'sl' | 'tp' | 'trigger'

export interface Trade {
  id: string
  type: TradeSide
  orderKind?: OrderKind
  openPrice: number
  closePrice?: number
  sl?: number
  tp?: number
  lots: number
  openTime: string
  closeTime?: string
  pnl?: number
  exitReason?: ExitReason
  sourceOrderId?: string
  parentTradeId?: string
}

export interface PendingOrder {
  id: string
  type: TradeSide
  orderKind: Exclude<OrderKind, 'market'>
  entryPrice: number
  limitPrice?: number
  sl?: number
  tp?: number
  lots: number
  createdTime: string
  status: 'pending' | 'filled' | 'cancelled'
  stopLimitTriggered?: boolean
  filledTradeId?: string
}

export interface OrderDraft {
  type: TradeSide
  orderKind: OrderKind
  entryPrice: string
  limitPrice: string
  sl: string
  tp: string
  slEnabled: boolean
  tpEnabled: boolean
  lots: string
}

export type OrderPriceField = 'entryPrice' | 'limitPrice' | 'sl' | 'tp'

export interface IndicatorConfig {
  ichimoku: boolean
  ichimokuConversion: number
  ichimokuBase: number
  ichimokuSpanB: number
  ichimokuCloudOpacity: number
  cci: boolean
  cciPeriod: number
  ma: boolean
  maPeriod: number
  maType: 'sma' | 'ema'
  bollinger: boolean
  bollingerPeriod: number
  bollingerStd: number
  stochRsi: boolean
  stochRsiPeriod: number
  stochRsiK: number
  stochastic: boolean
  stochasticPeriod: number
  stochasticK: number
  mfi: boolean
  mfiPeriod: number
}

export type DrawingTool = 'none' | 'hline' | 'trendline' | 'fibonacci' | 'rectangle' | 'pitchfork'

export interface Point {
  time: number // unix timestamp
  price: number
}

export interface Drawing {
  id: string
  tool: DrawingTool
  points: Point[]
  color?: string
}
