import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parsePrice,
  validateOrderPriceField,
  validateOrderLots,
} from '../src/lib/orderValidation.ts'
import { evaluatePendingOrder } from '../src/lib/orderExecution.ts'
import {
  formatSymbolPrice,
  isSymbolPriceAligned,
  roundSymbolPrice,
} from '../src/lib/symbolPrice.ts'
import { getSymbolPricePrecision } from '../src/lib/marketConfig.ts'
import { fromFarsi } from '../src/lib/farsi.ts'

const BID = 100
const SPREAD = 2
const SYMBOL = 'XAU_USD'

function draft(overrides = {}) {
  return {
    type: 'buy',
    orderKind: 'market',
    entryPrice: '',
    limitPrice: '',
    sl: '',
    tp: '',
    slEnabled: false,
    tpEnabled: false,
    lots: '0.10',
    ...overrides,
  }
}

function error(field, price, overrides = {}) {
  return validateOrderPriceField(field, price, draft(overrides), BID, SPREAD, SYMBOL)
}

test('price parsing is strict and never accepts a numeric prefix with junk', () => {
  assert.equal(parsePrice('1.2500'), 1.25)
  assert.equal(parsePrice('.5'), 0.5)
  assert.equal(parsePrice('1.'), 1)
  assert.equal(parsePrice('1.2.3'), undefined)
  assert.equal(parsePrice('1abc'), undefined)
  assert.equal(parsePrice('Infinity'), undefined)
  assert.equal(parsePrice(''), undefined)
  assert.equal(fromFarsi('۱۲۳٫۴۵'), '123.45')
  assert.equal(fromFarsi('١٢٣٫٤٥'), '123.45')
})

test('lot size is positive, at least 0.01 and aligned to its 0.01 step', () => {
  assert.equal(validateOrderLots('0.01'), '')
  assert.equal(validateOrderLots('1.20'), '')
  assert.match(validateOrderLots('0'), /معتبر نیست/)
  assert.match(validateOrderLots('0.001'), /حداقل/)
  assert.match(validateOrderLots('0.015'), /دو رقم اعشار/)
})

test('symbol precision and rounding cover every configured market family', () => {
  const symbolsByPrecision = {
    2: ['BTC_USDT', 'ETH_USDT', 'BNB_USDT', 'SOL_USDT', 'LTC_USDT'],
    3: [
      'USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_JPY', 'CAD_JPY',
      'XAU_USD', 'XAG_USD', 'XPT_USD',
      'LINK_USDT', 'AVAX_USDT', 'TON_USDT', 'DOT_USDT',
    ],
    4: ['XRP_USDT', 'ADA_USDT', 'SUI_USDT', 'TRX_USDT'],
    5: [
      'EUR_USD', 'GBP_USD', 'AUD_USD', 'USD_CAD', 'USD_CHF',
      'NZD_USD', 'EUR_GBP', 'USD_CNH', 'EUR_AUD', 'EUR_CHF',
      'GBP_AUD', 'AUD_NZD', 'AUD_CAD', 'USD_MXN', 'USD_ZAR',
      'USD_TRY', 'DOGE_USDT',
    ],
    8: ['SHIB_USDT', 'PEPE_USDT'],
  }

  for (const [precision, symbols] of Object.entries(symbolsByPrecision)) {
    for (const symbol of symbols) {
      assert.equal(getSymbolPricePrecision(symbol), Number(precision), symbol)
    }
  }

  assert.equal(roundSymbolPrice('EUR_USD', 1.123456), 1.12346)
  assert.equal(formatSymbolPrice('USD_JPY', 152.1), '152.100')
  assert.equal(isSymbolPriceAligned('EUR_USD', 1.12345), true)
  assert.equal(isSymbolPriceAligned('EUR_USD', 1.123456), false)
})

test('manual prices that exceed the symbol tick precision are rejected', () => {
  const result = validateOrderPriceField(
    'entryPrice',
    1.123456,
    draft({ type: 'buy', orderKind: 'limit' }),
    1.2,
    0.0001,
    'EUR_USD',
  )
  assert.match(result, /5 رقم اعشار/)
})

test('limit entries are validated against their executable quote side', () => {
  assert.equal(error('entryPrice', 101, { type: 'buy', orderKind: 'limit' }), '')
  assert.match(error('entryPrice', 102, { type: 'buy', orderKind: 'limit' }), /Ask/)
  assert.equal(error('entryPrice', 101, { type: 'sell', orderKind: 'limit' }), '')
  assert.match(error('entryPrice', 100, { type: 'sell', orderKind: 'limit' }), /Bid/)
})

test('stop entries must be beyond the current executable quote', () => {
  assert.equal(error('entryPrice', 102.01, { type: 'buy', orderKind: 'stop' }), '')
  assert.match(error('entryPrice', 102, { type: 'buy', orderKind: 'stop' }), /Ask/)
  assert.equal(error('entryPrice', 99.99, { type: 'sell', orderKind: 'stop' }), '')
  assert.match(error('entryPrice', 100, { type: 'sell', orderKind: 'stop' }), /Bid/)
})

test('stop-limit trigger and limit prices preserve the side relationship', () => {
  assert.equal(error('entryPrice', 103, {
    type: 'buy',
    orderKind: 'stop-limit',
    entryPrice: '',
    limitPrice: '',
  }), '')
  assert.match(error('entryPrice', 103, {
    type: 'buy',
    orderKind: 'stop-limit',
    limitPrice: '102.99',
  }), /برابر یا بالاتر/)
  assert.equal(error('limitPrice', 103, {
    type: 'buy',
    orderKind: 'stop-limit',
    entryPrice: '103',
  }), '')
  assert.match(error('limitPrice', 102.99, {
    type: 'buy',
    orderKind: 'stop-limit',
    entryPrice: '103',
  }), /برابر یا بالاتر/)

  assert.equal(error('limitPrice', 99, {
    type: 'sell',
    orderKind: 'stop-limit',
    entryPrice: '99',
  }), '')
  assert.match(error('limitPrice', 99.01, {
    type: 'sell',
    orderKind: 'stop-limit',
    entryPrice: '99',
  }), /برابر یا پایین‌تر/)
})

test('protective levels cannot be immediately executable or loss-side targets', () => {
  assert.equal(error('sl', 99.99, { type: 'buy', orderKind: 'market' }), '')
  assert.match(error('sl', 100, { type: 'buy', orderKind: 'market' }), /Bid/)
  assert.equal(error('tp', 102.01, { type: 'buy', orderKind: 'market' }), '')
  assert.match(error('tp', 102, { type: 'buy', orderKind: 'market' }), /قیمت ورود/)

  assert.equal(error('sl', 102.01, { type: 'sell', orderKind: 'market' }), '')
  assert.match(error('sl', 102, { type: 'sell', orderKind: 'market' }), /Ask/)
  assert.equal(error('tp', 99.99, { type: 'sell', orderKind: 'market' }), '')
  assert.match(error('tp', 100, { type: 'sell', orderKind: 'market' }), /قیمت ورود/)
})

test('pending buy orders use ask OHLC while sell orders use bid OHLC', () => {
  const candle = {
    ts: '2026-01-01T00:00:00Z',
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 1,
  }
  const baseOrder = {
    id: 'o1',
    type: 'buy',
    orderKind: 'limit',
    entryPrice: 101.4,
    lots: 0.1,
    createdTime: candle.ts,
    status: 'pending',
  }

  assert.equal(evaluatePendingOrder(baseOrder, candle, SPREAD).fillable, false)
  assert.equal(evaluatePendingOrder({ ...baseOrder, entryPrice: 101.5 }, candle, SPREAD).fillable, true)
  assert.equal(evaluatePendingOrder({
    ...baseOrder,
    type: 'sell',
    entryPrice: 100.5,
  }, candle, SPREAD).fillable, true)
  assert.equal(evaluatePendingOrder({
    ...baseOrder,
    orderKind: 'stop',
    entryPrice: 102.51,
  }, candle, SPREAD).fillable, false)
})
