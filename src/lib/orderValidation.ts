import type { OrderDraft, OrderPriceField, TradeSide } from '../types/index.ts'
import {
  getOrderLevelStep,
  getSymbolMinMove,
  getSymbolPricePrecision,
} from './marketConfig.ts'
import { isSymbolPriceAligned } from './symbolPrice.ts'

export type OrderFieldErrors = Partial<Record<OrderPriceField, string>>

export function parsePrice(value: string) {
  const normalized = value.trim()
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function validateOrderLots(value: string) {
  const lots = parsePrice(value)
  if (lots === undefined || lots <= 0) return 'حجم معامله معتبر نیست'
  if (lots < 0.01) return 'حداقل حجم معامله ۰٫۰۱ لات است'
  if (Math.abs(lots * 100 - Math.round(lots * 100)) > 1e-8) {
    return 'حجم معامله حداکثر دو رقم اعشار دارد'
  }
  return ''
}

export function getAskPrice(bidPrice: number, spread: number) {
  return bidPrice + spread
}

export function getDefaultEntryPrice(draft: OrderDraft, bidPrice: number, spread: number, symbol = '') {
  const askPrice = getAskPrice(bidPrice, spread)
  const fillPrice = draft.type === 'buy' ? askPrice : bidPrice
  const entryStep = symbol ? getOrderLevelStep(symbol, spread, 5) : Math.max(spread * 5, 0.05)

  if (draft.orderKind === 'market') return fillPrice
  if (draft.type === 'buy') {
    return draft.orderKind === 'limit'
      ? bidPrice - entryStep
      : askPrice + entryStep
  }
  return draft.orderKind === 'limit'
    ? askPrice + entryStep
    : bidPrice - entryStep
}

export function getDraftEntryPrice(draft: OrderDraft, bidPrice: number, spread: number, symbol = '') {
  return parsePrice(draft.entryPrice) ?? getDefaultEntryPrice(draft, bidPrice, spread, symbol)
}

export function getDraftLimitPrice(draft: OrderDraft, bidPrice: number, spread: number, symbol = '') {
  const entryPrice = getDraftEntryPrice(draft, bidPrice, spread, symbol)
  return parsePrice(draft.limitPrice) ?? entryPrice
}

export function getPlannedOpenPrice(draft: OrderDraft, bidPrice: number, spread: number, symbol = '') {
  if (draft.orderKind === 'market') {
    return draft.type === 'buy' ? getAskPrice(bidPrice, spread) : bidPrice
  }
  if (draft.orderKind === 'stop-limit') {
    return getDraftLimitPrice(draft, bidPrice, spread, symbol)
  }
  return getDraftEntryPrice(draft, bidPrice, spread, symbol)
}

function sideName(side: TradeSide) {
  return side === 'buy' ? 'خرید' : 'فروش'
}

function isAtOrAbove(price: number, boundary: number, tolerance: number) {
  return price > boundary || Math.abs(price - boundary) <= tolerance
}

function isAtOrBelow(price: number, boundary: number, tolerance: number) {
  return price < boundary || Math.abs(price - boundary) <= tolerance
}

export function validateOrderPriceField(
  field: OrderPriceField,
  price: number,
  draft: OrderDraft,
  bidPrice: number,
  spread: number,
  symbol = '',
) {
  if (!Number.isFinite(price) || price <= 0) return 'قیمت معتبر نیست'
  if (!Number.isFinite(bidPrice) || bidPrice <= 0) return 'قیمت فعلی بازار در دسترس نیست'
  if (!Number.isFinite(spread) || spread < 0) return 'اسپرد بازار معتبر نیست'
  if (symbol && !isSymbolPriceAligned(symbol, price)) {
    return `قیمت ${symbol.replace('_', '/')} حداکثر ${getSymbolPricePrecision(symbol)} رقم اعشار دارد`
  }

  const askPrice = getAskPrice(bidPrice, spread)
  const candidateDraft = field === 'entryPrice'
    ? { ...draft, entryPrice: String(price) }
    : field === 'limitPrice'
      ? { ...draft, limitPrice: String(price) }
      : draft
  const entryPrice = getDraftEntryPrice(candidateDraft, bidPrice, spread, symbol)
  const limitPrice = getDraftLimitPrice(candidateDraft, bidPrice, spread, symbol)
  const plannedOpenPrice = getPlannedOpenPrice(candidateDraft, bidPrice, spread, symbol)
  const minMove = symbol ? getSymbolMinMove(symbol) : 0
  const tolerance = minMove > 0 ? minMove / 1000 : 1e-10

  if (field === 'entryPrice') {
    if (draft.orderKind === 'market') return 'سفارش بازار قیمت ورود دستی ندارد'

    if (draft.orderKind === 'limit') {
      if (draft.type === 'buy' && isAtOrAbove(price, askPrice, tolerance)) return 'لیمیت خرید باید پایین‌تر از قیمت فعلی Ask باشد'
      if (draft.type === 'sell' && isAtOrBelow(price, bidPrice, tolerance)) return 'لیمیت فروش باید بالاتر از قیمت فعلی Bid باشد'
    }

    if (draft.orderKind === 'stop' || draft.orderKind === 'stop-limit') {
      if (draft.type === 'buy' && isAtOrBelow(price, askPrice, tolerance)) return 'استاپ خرید باید بالاتر از قیمت فعلی Ask باشد'
      if (draft.type === 'sell' && isAtOrAbove(price, bidPrice, tolerance)) return 'استاپ فروش باید پایین‌تر از قیمت فعلی Bid باشد'
    }

    if (draft.orderKind === 'stop-limit') {
      if (draft.type === 'buy' && limitPrice < entryPrice - tolerance) return 'در استاپ لیمیت خرید، لیمیت باید برابر یا بالاتر از استاپ باشد'
      if (draft.type === 'sell' && limitPrice > entryPrice + tolerance) return 'در استاپ لیمیت فروش، لیمیت باید برابر یا پایین‌تر از استاپ باشد'
    }
  }

  if (field === 'limitPrice') {
    if (draft.orderKind !== 'stop-limit') return 'فیلد لیمیت فقط برای استاپ لیمیت است'
    if (draft.type === 'buy' && limitPrice < entryPrice - tolerance) return 'در استاپ لیمیت خرید، لیمیت باید برابر یا بالاتر از استاپ باشد'
    if (draft.type === 'sell' && limitPrice > entryPrice + tolerance) return 'در استاپ لیمیت فروش، لیمیت باید برابر یا پایین‌تر از استاپ باشد'
  }

  if (field === 'sl') {
    const exitQuoteAtOpen = draft.type === 'buy'
      ? plannedOpenPrice - spread
      : plannedOpenPrice + spread
    if (draft.type === 'buy' && isAtOrAbove(price, exitQuoteAtOpen, tolerance)) return `حد ضرر ${sideName(draft.type)} باید پایین‌تر از Bid متناظر با ورود باشد`
    if (draft.type === 'sell' && isAtOrBelow(price, exitQuoteAtOpen, tolerance)) return `حد ضرر ${sideName(draft.type)} باید بالاتر از Ask متناظر با ورود باشد`
  }

  if (field === 'tp') {
    if (draft.type === 'buy' && isAtOrBelow(price, plannedOpenPrice, tolerance)) return `هدف ${sideName(draft.type)} باید بالاتر از قیمت ورود باشد`
    if (draft.type === 'sell' && isAtOrAbove(price, plannedOpenPrice, tolerance)) return `هدف ${sideName(draft.type)} باید پایین‌تر از قیمت ورود باشد`
  }

  return ''
}

export function validateOrderDraft(draft: OrderDraft, bidPrice: number, spread: number, symbol = '') {
  const errors: OrderFieldErrors = {}

  if (draft.orderKind !== 'market') {
    const entryPrice = getDraftEntryPrice(draft, bidPrice, spread, symbol)
    errors.entryPrice = validateOrderPriceField('entryPrice', entryPrice, draft, bidPrice, spread, symbol)
  }

  if (draft.orderKind === 'stop-limit') {
    const limitPrice = getDraftLimitPrice(draft, bidPrice, spread, symbol)
    errors.limitPrice = validateOrderPriceField('limitPrice', limitPrice, draft, bidPrice, spread, symbol)
  }

  const sl = parsePrice(draft.sl)
  if (draft.slEnabled) {
    errors.sl = sl === undefined
      ? 'حد ضرر فعال است؛ قیمت معتبر وارد کنید'
      : validateOrderPriceField('sl', sl, draft, bidPrice, spread, symbol)
  }

  const tp = parsePrice(draft.tp)
  if (draft.tpEnabled) {
    errors.tp = tp === undefined
      ? 'هدف فعال است؛ قیمت معتبر وارد کنید'
      : validateOrderPriceField('tp', tp, draft, bidPrice, spread, symbol)
  }

  return Object.fromEntries(
    Object.entries(errors).filter(([, error]) => Boolean(error)),
  ) as OrderFieldErrors
}
