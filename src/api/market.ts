import type { Candle, MarketMeta, MarketSymbol, Timeframe } from '../types'
import { aggregateCandles } from '../lib/csv'
export { DEFAULT_SYMBOL, DEFAULT_TIMEFRAME } from '../lib/marketConfig'
let source: Candle[] = []
let activeSymbol = 'EUR_USD'
let nativeMinutes = 5
const cache = new Map<string, Candle[]>()
export function isTimeframeAvailable(timeframe: string) {
  const match = /^(\d+)(m|h|d|w)$/.exec(timeframe)
  if (!match) return false
  const minutes = Number(match[1]) * ({ m: 1, h: 60, d: 1440, w: 10080 }[match[2]] ?? 1)
  return minutes >= nativeMinutes && minutes % nativeMinutes === 0
}
export function setDataset(candles: Candle[], symbol: string, minutes: number) {
  if (![5, 10, 15].includes(minutes)) throw new Error('فقط تایم‌فریم‌های ۵، ۱۰ و ۱۵ دقیقه مجاز است.')
  const interval = minutes * 60000
  if (candles.some((candle, i) => i > 0 && (Date.parse(candle.ts) - Date.parse(candles[i - 1].ts)) % interval !== 0)) throw new Error('فاصلهٔ زمانی ردیف‌های CSV با تایم‌فریم انتخاب‌شده سازگار نیست.')
  source = candles; activeSymbol = symbol; nativeMinutes = minutes; cache.clear() }
function data(timeframe: string) {
  const match = /^(\d+)(m|h|d|w)$/.exec(timeframe)
  if (!match) throw new Error('Unsupported timeframe')
  const minutes = Number(match[1]) * ({ m: 1, h: 60, d: 1440, w: 10080 }[match[2]] ?? 1)
  if (minutes < nativeMinutes || minutes % nativeMinutes !== 0) throw new Error('تایم‌فریم باید برابر یا مضربی از تایم‌فریم CSV باشد.')
  if (!cache.has(timeframe)) cache.set(timeframe, minutes === nativeMinutes ? source : aggregateCandles(source, minutes))
  return cache.get(timeframe)!
}
export async function fetchCandles({ timeframe = `${nativeMinutes}m`, from_ts, before_ts, to_ts, limit = 500 }: { symbol?: string; timeframe?: string; from_ts?: string; before_ts?: string; to_ts?: string; limit?: number }): Promise<Candle[]> {
  let candles = data(timeframe)
  if (from_ts) candles = candles.filter(c => Date.parse(c.ts) >= Date.parse(from_ts))
  if (before_ts) candles = candles.filter(c => Date.parse(c.ts) < Date.parse(before_ts))
  if (to_ts) candles = candles.filter(c => Date.parse(c.ts) <= Date.parse(to_ts))
  return before_ts ? candles.slice(-limit) : candles.slice(0, limit)
}
export async function fetchMeta(symbol = activeSymbol): Promise<MarketMeta> { return { symbol, category: 'local', native_timeframe: `${nativeMinutes}m`, total_candles: source.length, start: source[0]?.ts ?? null, end: source.at(-1)?.ts ?? null } }
export async function fetchSymbols(): Promise<MarketSymbol[]> { return [{ symbol: activeSymbol, label: activeSymbol.replace('_', '/'), category: 'local' }] }
export async function fetchTimeframes(): Promise<Timeframe[]> { return [{ id: `${nativeMinutes}m`, minutes: nativeMinutes }] }
