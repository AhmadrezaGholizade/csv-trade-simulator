import test from 'node:test'
import assert from 'node:assert/strict'
import { processPlaybackCandle } from '../src/lib/playbackEngine.ts'
import { useSimStore } from '../src/store/simStore.ts'

function candle(index, { open = 100, high = 100, low = 100, close = 100 } = {}) {
  return {
    ts: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    open,
    high,
    low,
    close,
    volume: 1,
  }
}

function pending(overrides = {}) {
  return {
    id: 'pending-1',
    type: 'buy',
    orderKind: 'stop',
    entryPrice: 101,
    sl: 99,
    tp: 103,
    lots: 0.1,
    createdTime: candle(0).ts,
    status: 'pending',
    ...overrides,
  }
}

test('a pending order filled in a skipped candle can close on a later skipped candle', () => {
  const first = processPlaybackCandle(
    { trades: [], pendingOrders: [pending()], balance: 10_000 },
    candle(1, { open: 100, high: 101.5, low: 100, close: 101 }),
    'XAU_USD',
    0,
  )
  assert.equal(first.pendingOrders[0].status, 'filled')
  assert.equal(first.trades.length, 1)
  assert.equal(first.trades[0].closePrice, undefined)

  const second = processPlaybackCandle(
    first,
    candle(2, { open: 101, high: 103.5, low: 100.5, close: 103 }),
    'XAU_USD',
    0,
  )
  assert.equal(second.trades[0].closePrice, 103)
  assert.equal(second.trades[0].exitReason, 'tp')
  assert.equal(second.trades[0].closeTime, candle(2).ts)
  assert.equal(second.balance, 10_200)
})

test('SL has deterministic priority when both SL and TP are crossed in one candle', () => {
  const result = processPlaybackCandle(
    {
      trades: [{
        id: 'trade-1',
        type: 'buy',
        openPrice: 100,
        sl: 98,
        tp: 105,
        lots: 0.1,
        openTime: candle(0).ts,
      }],
      pendingOrders: [],
      balance: 10_000,
    },
    candle(1, { open: 100, high: 106, low: 97, close: 101 }),
    'XAU_USD',
    0,
  )

  assert.equal(result.trades[0].closePrice, 98)
  assert.equal(result.trades[0].exitReason, 'sl')
  assert.equal(result.balance, 9_800)
})

test('sell exits are evaluated against ask prices including spread', () => {
  const result = processPlaybackCandle(
    {
      trades: [{
        id: 'trade-1',
        type: 'sell',
        openPrice: 100,
        sl: 102,
        tp: 98,
        lots: 0.1,
        openTime: candle(0).ts,
      }],
      pendingOrders: [],
      balance: 10_000,
    },
    candle(1, { open: 100, high: 101.2, low: 99.5, close: 100 }),
    'XAU_USD',
    1,
  )

  assert.equal(result.trades[0].closePrice, 102)
  assert.equal(result.trades[0].exitReason, 'sl')
})

test('a triggered stop-limit remains active and fills on a later skipped candle', () => {
  const first = processPlaybackCandle(
    {
      trades: [],
      pendingOrders: [pending({
        orderKind: 'stop-limit',
        entryPrice: 105,
        limitPrice: 105,
        sl: undefined,
        tp: undefined,
      })],
      balance: 10_000,
    },
    candle(1, { open: 105.6, high: 106, low: 105.5, close: 105.8 }),
    'XAU_USD',
    0,
  )
  assert.equal(first.pendingOrders[0].status, 'pending')
  assert.equal(first.pendingOrders[0].stopLimitTriggered, true)

  const second = processPlaybackCandle(
    first,
    candle(2, { open: 105.2, high: 105.4, low: 104.9, close: 105 }),
    'XAU_USD',
    0,
  )
  assert.equal(second.pendingOrders[0].status, 'filled')
  assert.equal(second.trades[0].openPrice, 105)
})

test('setVisibleIndex processes every intermediate candle and snapshots rewind safely', () => {
  const candles = [
    candle(0),
    candle(1, { open: 100, high: 101.5, low: 100, close: 101 }),
    candle(2, { open: 101, high: 102, low: 100.5, close: 101.5 }),
    candle(3, { open: 101.5, high: 103.5, low: 101, close: 103 }),
  ]
  const order = pending()

  useSimStore.setState({
    candles,
    visibleIndex: 1,
    playing: false,
    symbol: 'XAU_USD',
    config: {
      balance: 10_000,
      leverage: 100,
      spread: 0,
      sessionStart: candles[0].ts,
    },
    trades: [],
    pendingOrders: [order],
    balance: 10_000,
    timelineSnapshots: {
      1: { trades: [], pendingOrders: [order], balance: 10_000 },
    },
  })

  useSimStore.getState().setVisibleIndex(4)
  let state = useSimStore.getState()
  assert.equal(state.visibleIndex, 4)
  assert.deepEqual(Object.keys(state.timelineSnapshots).map(Number).sort(), [1, 2, 3, 4])
  assert.equal(state.trades[0].exitReason, 'tp')
  assert.equal(state.balance, 10_200)

  state.setVisibleIndex(3)
  state = useSimStore.getState()
  assert.equal(state.visibleIndex, 3)
  assert.equal(state.trades[0].closePrice, undefined)
  assert.equal(state.balance, 10_000)

  state.setVisibleIndex(4)
  state = useSimStore.getState()
  assert.equal(state.trades[0].exitReason, 'tp')
  assert.equal(state.balance, 10_200)
})
