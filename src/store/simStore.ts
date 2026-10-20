import { create } from 'zustand'
import type { Candle, IndicatorConfig, Trade, SimConfig, Drawing, DrawingTool, PendingOrder, ExitReason, OrderDraft, OrderPriceField } from '../types/index.ts'
import type { OrderFieldErrors } from '../lib/orderValidation.ts'
import { DEFAULT_SYMBOL, DEFAULT_TIMEFRAME, calculateSymbolPnl, getDefaultSpreadForSymbol } from '../lib/marketConfig.ts'
import { processPlaybackCandle } from '../lib/playbackEngine.ts'
import { roundSymbolPrice } from '../lib/symbolPrice.ts'

interface TimelineSnapshot {
  trades: Trade[]
  pendingOrders: PendingOrder[]
  balance: number
}

const MAX_CACHED_CANDLES = 5000

interface SimStore {
  candles: Candle[]
  visibleIndex: number
  playing: boolean
  speed: number
  symbol: string
  symbolLabel: string
  timeframe: string
  candleReloadTarget: string | null
  config: SimConfig
  sessionVersion: number
  trades: Trade[]
  pendingOrders: PendingOrder[]
  timelineSnapshots: Record<number, TimelineSnapshot>
  orderDraft: OrderDraft
  activeOrderPriceField: OrderPriceField | null
  orderPriceFieldError: Partial<Record<OrderPriceField, string>>
  balance: number
  indicators: IndicatorConfig
  drawings: Drawing[]
  activeTool: DrawingTool
  setActiveTool: (t: DrawingTool) => void
  addDrawing: (d: Drawing) => void
  removeDrawing: (id: string) => void
  clearDrawings: () => void
  setIndicators: (i: IndicatorConfig) => void
  setCandles: (c: Candle[]) => void
  appendCandles: (c: Candle[]) => void
  prependCandles: (c: Candle[]) => void
  pruneCandlesBefore: (count: number) => number
  setVisibleIndex: (i: number) => void
  setPlaying: (p: boolean) => void
  setSpeed: (s: number) => void
  setMarket: (market: { symbol: string; symbolLabel?: string; timeframe?: string }) => void
  setConfig: (c: SimConfig) => void
  applySessionSettings: (c: SimConfig) => void
  addTrade: (t: Trade) => void
  updateTradeLevels: (id: string, levels: Partial<Pick<Trade, 'sl' | 'tp'>>) => void
  addPendingOrder: (o: PendingOrder) => void
  setOrderDraft: (updates: Partial<OrderDraft>) => void
  setActiveOrderPriceField: (field: OrderPriceField | null) => void
  setOrderPriceFieldError: (field: OrderPriceField, error: string) => void
  setOrderPriceFieldErrors: (errors: OrderFieldErrors) => void
  updatePendingOrder: (id: string, updates: Partial<PendingOrder>) => void
  cancelPendingOrder: (id: string) => void
  fillPendingOrder: (id: string, trade: Trade) => void
  closeTrade: (id: string, closePrice: number, closeTime: string, reason?: ExitReason) => void
  partialCloseTrade: (id: string, closeLots: number, closePrice: number, closeTime: string) => void
}

function snapshotFromState(state: Pick<SimStore, 'trades' | 'pendingOrders' | 'balance'>): TimelineSnapshot {
  return {
    trades: state.trades.map(trade => ({ ...trade })),
    pendingOrders: state.pendingOrders.map(order => ({ ...order })),
    balance: state.balance,
  }
}

function withCurrentSnapshot<T extends SimStore>(state: T, updates: Partial<T>): Partial<T> {
  const nextState = { ...state, ...updates }
  return {
    ...updates,
    timelineSnapshots: {
      ...state.timelineSnapshots,
      [state.visibleIndex]: snapshotFromState(nextState),
    },
  } as Partial<T>
}

function cloneSnapshot(snapshot: TimelineSnapshot) {
  return {
    trades: snapshot.trades.map(trade => ({ ...trade })),
    pendingOrders: snapshot.pendingOrders.map(order => ({ ...order })),
    balance: snapshot.balance,
  }
}

function trimCachedCandles(
  candles: Candle[],
  visibleIndex: number,
  timelineSnapshots: Record<number, TimelineSnapshot>,
) {
  if (candles.length <= MAX_CACHED_CANDLES || visibleIndex < MAX_CACHED_CANDLES * 0.7) {
    return { candles, visibleIndex, timelineSnapshots }
  }

  const removeCount = Math.min(candles.length - MAX_CACHED_CANDLES, Math.max(0, visibleIndex - Math.floor(MAX_CACHED_CANDLES * 0.5)))
  if (removeCount <= 0) return { candles, visibleIndex, timelineSnapshots }

  const shiftedSnapshots = Object.fromEntries(
    Object.entries(timelineSnapshots)
      .map(([index, snapshot]) => [Number(index) - removeCount, snapshot] as const)
      .filter(([index]) => index >= 0)
  ) as Record<number, TimelineSnapshot>

  return {
    candles: candles.slice(removeCount),
    visibleIndex: Math.max(0, visibleIndex - removeCount),
    timelineSnapshots: shiftedSnapshots,
  }
}

function getRestoredSnapshot(
  snapshots: Record<number, TimelineSnapshot>,
  targetIndex: number,
  fallback: TimelineSnapshot,
) {
  if (snapshots[targetIndex]) return cloneSnapshot(snapshots[targetIndex])

  const nearestPastIndex = Object.keys(snapshots)
    .map(Number)
    .filter(index => index <= targetIndex)
    .sort((a, b) => b - a)[0]

  return nearestPastIndex !== undefined
    ? cloneSnapshot(snapshots[nearestPastIndex])
    : cloneSnapshot(fallback)
}

export const useSimStore = create<SimStore>((set) => ({
  candles: [],
  visibleIndex: 0,
  playing: false,
  speed: 1,
  symbol: DEFAULT_SYMBOL,
  symbolLabel: 'EUR/USD',
  timeframe: DEFAULT_TIMEFRAME,
  candleReloadTarget: null,
  config: { balance: 10000, leverage: 100, spread: getDefaultSpreadForSymbol(DEFAULT_SYMBOL), sessionStart: '' },
  sessionVersion: 0,
  trades: [],
  pendingOrders: [],
  timelineSnapshots: {},
  orderDraft: {
    type: 'buy',
    orderKind: 'market',
    entryPrice: '',
    limitPrice: '',
    sl: '',
    tp: '',
    slEnabled: false,
    tpEnabled: false,
    lots: '0.10',
  },
  activeOrderPriceField: null,
  orderPriceFieldError: {},
  balance: 10000,
  indicators: {
    ichimoku: false,
    ichimokuConversion: 9,
    ichimokuBase: 26,
    ichimokuSpanB: 52,
    ichimokuCloudOpacity: 0.18,
    cci: false,
    cciPeriod: 20,
    ma: false,
    maPeriod: 20,
    maType: 'sma',
    bollinger: false,
    bollingerPeriod: 20,
    bollingerStd: 2,
    stochRsi: false,
    stochRsiPeriod: 14,
    stochRsiK: 3,
    stochastic: false,
    stochasticPeriod: 14,
    stochasticK: 3,
    mfi: false,
    mfiPeriod: 14,
  },

  drawings: [],
  activeTool: 'none',
  setActiveTool: (activeTool) => set({ activeTool }),
  addDrawing: (d) => set(s => ({ drawings: [...s.drawings, d] })),
  removeDrawing: (id) => set(s => ({ drawings: s.drawings.filter(d => d.id !== id) })),
  clearDrawings: () => set({ drawings: [] }),

  setIndicators: (indicators) => set({ indicators }),
  setCandles: (candles) =>
    set((s) => {
      const targetTime = s.candleReloadTarget ? new Date(s.candleReloadTarget).getTime() : null
      const targetIndex = targetTime === null
        ? -1
        : candles.findIndex(candle => new Date(candle.ts).getTime() >= targetTime)
      const visibleIndex = targetIndex >= 0
        ? targetIndex + 1
        : Math.min(30, candles.length)
      return {
        candles,
        visibleIndex,
        timelineSnapshots: {
          [visibleIndex]: snapshotFromState({ trades: s.trades, pendingOrders: s.pendingOrders, balance: s.balance }),
        },
      }
    }),
  appendCandles: (candles) =>
    set((s) => {
      if (candles.length === 0) return {}
      const existing = new Set(s.candles.map(candle => candle.ts))
      const nextCandles = candles.filter(candle => !existing.has(candle.ts))
      if (nextCandles.length === 0) return {}
      return trimCachedCandles(
        [...s.candles, ...nextCandles],
        s.visibleIndex,
        s.timelineSnapshots,
      )
    }),
  prependCandles: (candles) =>
    set((s) => {
      if (candles.length === 0) return {}
      const existing = new Set(s.candles.map(candle => candle.ts))
      const nextCandles = candles.filter(candle => !existing.has(candle.ts))
      if (nextCandles.length === 0) return {}
      const shift = nextCandles.length
      const mergedCandles = [...nextCandles, ...s.candles]
      const overflow = Math.max(0, mergedCandles.length - MAX_CACHED_CANDLES)
      const keptCandles = overflow > 0 ? mergedCandles.slice(0, -overflow) : mergedCandles
      const timelineSnapshots = Object.fromEntries(
        Object.entries(s.timelineSnapshots)
          .map(([index, snapshot]) => [Number(index) + shift, snapshot] as const)
          .filter(([index]) => index <= keptCandles.length)
      ) as Record<number, TimelineSnapshot>
      return {
        candles: keptCandles,
        visibleIndex: Math.min(s.visibleIndex + shift, keptCandles.length),
        timelineSnapshots,
      }
    }),
  pruneCandlesBefore: (count) => {
    let removed = 0
    set((s) => {
      const removeCount = Math.min(
        Math.max(0, Math.floor(count)),
        Math.max(0, s.visibleIndex - 1),
      )
      if (removeCount <= 0) return {}
      removed = removeCount
      const timelineSnapshots = Object.fromEntries(
        Object.entries(s.timelineSnapshots)
          .map(([index, snapshot]) => [Number(index) - removeCount, snapshot] as const)
          .filter(([index]) => index >= 0)
      ) as Record<number, TimelineSnapshot>

      return {
        candles: s.candles.slice(removeCount),
        visibleIndex: Math.max(0, s.visibleIndex - removeCount),
        timelineSnapshots,
      }
    })
    return removed
  },
  setVisibleIndex: (visibleIndex) =>
    set((s) => {
      const nextIndex = Math.min(Math.max(0, visibleIndex), s.candles.length)
      const isRewinding = nextIndex < s.visibleIndex
      if (isRewinding) {
        const fallback = {
          trades: [],
          pendingOrders: [],
          balance: s.config.balance,
        }
        const restored = getRestoredSnapshot(s.timelineSnapshots, nextIndex, fallback)
        const timelineSnapshots = Object.fromEntries(
          Object.entries(s.timelineSnapshots)
            .filter(([index]) => Number(index) <= nextIndex)
        ) as Record<number, TimelineSnapshot>

        return {
          visibleIndex: nextIndex,
          playing: false,
          timelineSnapshots: {
            ...timelineSnapshots,
            [nextIndex]: snapshotFromState(restored),
          },
          ...restored,
        }
      }

      if (nextIndex === s.visibleIndex) return {}

      let playbackState = snapshotFromState(s)
      const timelineSnapshots: Record<number, TimelineSnapshot> = {
        ...s.timelineSnapshots,
        [s.visibleIndex]: cloneSnapshot(playbackState),
      }

      for (let candleIndex = s.visibleIndex; candleIndex < nextIndex; candleIndex += 1) {
        const candle = s.candles[candleIndex]
        if (!candle) break
        playbackState = processPlaybackCandle(
          playbackState,
          candle,
          s.symbol,
          s.config.spread,
        )
        timelineSnapshots[candleIndex + 1] = cloneSnapshot(playbackState)
      }

      return {
        visibleIndex: nextIndex,
        timelineSnapshots,
        ...playbackState,
      }
    }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setMarket: ({ symbol, symbolLabel, timeframe }) =>
    set((s) => {
      const nextSymbol = symbol.trim().toUpperCase()
      const nextTimeframe = timeframe ?? s.timeframe
      const changed = nextSymbol !== s.symbol || nextTimeframe !== s.timeframe
      const symbolChanged = nextSymbol !== s.symbol
      const timeframeChanged = nextTimeframe !== s.timeframe
      const currentCandle = s.candles[Math.max(0, Math.min(s.candles.length - 1, s.visibleIndex - 1))]
      const candleReloadTarget = changed && !symbolChanged && timeframeChanged
        ? currentCandle?.ts ?? null
        : null
      const currentDefaultSpread = getDefaultSpreadForSymbol(s.symbol)
      const shouldApplySymbolSpread = symbolChanged ||
        s.config.spread === currentDefaultSpread

      if (!changed && !shouldApplySymbolSpread && (!symbolLabel || symbolLabel === s.symbolLabel)) return {}

      return {
        symbol: nextSymbol,
        symbolLabel: symbolLabel ?? nextSymbol.replace('_', '/'),
        timeframe: nextTimeframe,
        candleReloadTarget,
        config: shouldApplySymbolSpread
          ? { ...s.config, spread: getDefaultSpreadForSymbol(nextSymbol) }
          : s.config,
        candles: changed ? [] : s.candles,
        visibleIndex: changed ? 0 : s.visibleIndex,
        playing: changed ? false : s.playing,
        trades: changed ? [] : s.trades,
        pendingOrders: changed ? [] : s.pendingOrders,
        drawings: symbolChanged ? [] : s.drawings,
        orderDraft: symbolChanged
          ? {
              ...s.orderDraft,
              entryPrice: '',
              limitPrice: '',
              sl: '',
              tp: '',
              slEnabled: false,
              tpEnabled: false,
            }
          : s.orderDraft,
        activeOrderPriceField: symbolChanged ? null : s.activeOrderPriceField,
        orderPriceFieldError: symbolChanged ? {} : s.orderPriceFieldError,
        timelineSnapshots: changed
          ? { 0: { trades: [], pendingOrders: [], balance: s.config.balance } }
          : s.timelineSnapshots,
        sessionVersion: changed ? s.sessionVersion + 1 : s.sessionVersion,
      }
    }),
  setConfig: (config) => set({ config }),
  applySessionSettings: (config) =>
    set((s) => ({
      config: {
        ...config,
        spread: roundSymbolPrice(s.symbol, Math.max(0, config.spread)),
      },
      balance: config.balance,
      trades: [],
      pendingOrders: [],
      timelineSnapshots: {
        0: { trades: [], pendingOrders: [], balance: config.balance },
      },
      orderDraft: {
        type: 'buy',
        orderKind: 'market',
        entryPrice: '',
        limitPrice: '',
        sl: '',
        tp: '',
        slEnabled: false,
        tpEnabled: false,
        lots: '0.10',
      },
      activeOrderPriceField: null,
      orderPriceFieldError: {},
      candles: [],
      candleReloadTarget: null,
      visibleIndex: 0,
      playing: false,
      sessionVersion: s.sessionVersion + 1,
    })),
  addTrade: (t) =>
    set((s) => withCurrentSnapshot(s, { trades: [...s.trades, t] })),
  setOrderDraft: (updates) =>
    set((s) => ({
      orderDraft: { ...s.orderDraft, ...updates },
      orderPriceFieldError: Object.keys(updates).some(key => key === 'type' || key === 'orderKind')
        ? {}
        : Object.keys(updates).reduce(
          (errors, key) => {
            if (key === 'entryPrice' || key === 'limitPrice' || key === 'sl' || key === 'tp') {
              delete errors[key]
            }
            return errors
          },
          { ...s.orderPriceFieldError },
        ),
    })),
  setActiveOrderPriceField: (activeOrderPriceField) =>
    set((s) => ({
      activeOrderPriceField,
      orderPriceFieldError: activeOrderPriceField
        ? { ...s.orderPriceFieldError, [activeOrderPriceField]: '' }
        : s.orderPriceFieldError,
    })),
  setOrderPriceFieldError: (field, error) =>
    set((s) => ({ orderPriceFieldError: { ...s.orderPriceFieldError, [field]: error } })),
  setOrderPriceFieldErrors: (orderPriceFieldError) => set({ orderPriceFieldError }),
  updateTradeLevels: (id, levels) =>
    set((s) => withCurrentSnapshot(s, {
      trades: s.trades.map((t) =>
        t.id === id && t.closePrice === undefined ? { ...t, ...levels } : t
      ),
    })),
  addPendingOrder: (o) =>
    set((s) => withCurrentSnapshot(s, { pendingOrders: [...s.pendingOrders, o] })),
  updatePendingOrder: (id, updates) =>
    set((s) => withCurrentSnapshot(s, {
      pendingOrders: s.pendingOrders.map((o) =>
        o.id === id && o.status === 'pending' ? { ...o, ...updates } : o
      ),
    })),
  cancelPendingOrder: (id) =>
    set((s) => withCurrentSnapshot(s, {
      pendingOrders: s.pendingOrders.map((o) =>
        o.id === id ? { ...o, status: 'cancelled' } : o
      ),
    })),
  fillPendingOrder: (id, trade) =>
    set((s) => withCurrentSnapshot(s, {
      pendingOrders: s.pendingOrders.map((o) =>
        o.id === id ? { ...o, status: 'filled', filledTradeId: trade.id } : o
      ),
      trades: [...s.trades, trade],
    })),
  closeTrade: (id, closePrice, closeTime, reason = 'manual') =>
    set((s) => {
      const target = s.trades.find(t => t.id === id && t.closePrice === undefined)
      if (!target) return {}
      const pnl = calculateSymbolPnl(s.symbol, target.type, target.openPrice, closePrice, target.lots)
      const trades = s.trades.map((t) => {
        if (t.id !== target.id) return t
        return { ...t, closePrice, closeTime, pnl, exitReason: reason }
      })
      return withCurrentSnapshot(s, { trades, balance: s.balance + pnl })
    }),
  partialCloseTrade: (id, closeLots, closePrice, closeTime) =>
    set((s) => {
      const source = s.trades.find(t => t.id === id && t.closePrice === undefined)
      if (!source) return {}
      const normalizedLots = Math.min(Math.max(closeLots, 0), source.lots)
      if (normalizedLots <= 0) return {}

      const pnl = calculateSymbolPnl(s.symbol, source.type, source.openPrice, closePrice, normalizedLots)
      const remainingLots = Math.max(0, parseFloat((source.lots - normalizedLots).toFixed(4)))
      const closedTrade: Trade = {
        ...source,
        id: `${source.id}-partial-${Date.now().toString(36)}`,
        lots: parseFloat(normalizedLots.toFixed(4)),
        closePrice,
        closeTime,
        pnl,
        exitReason: 'manual',
        parentTradeId: source.id,
      }

      const trades = s.trades.flatMap(t => {
        if (t.id !== id || t.closePrice !== undefined) return [t]
        if (remainingLots <= 0) {
          return [{ ...closedTrade, id: source.id, parentTradeId: source.parentTradeId }]
        }
        return [
          { ...t, lots: remainingLots },
          closedTrade,
        ]
      })

      return withCurrentSnapshot(s, { trades, balance: s.balance + pnl })
    }),
}))
