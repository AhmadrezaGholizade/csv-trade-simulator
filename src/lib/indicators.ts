import type { Candle } from '../types'

function sma(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null
    const slice = values.slice(i - period + 1, i + 1)
    return slice.reduce((sum, value) => sum + value, 0) / period
  })
}

export function calcEMA(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1)
  const out: (number | null)[] = []
  let ema: number | null = null

  for (const value of values) {
    ema = ema === null ? value : value * k + ema * (1 - k)
    out.push(out.length < period - 1 ? null : ema)
  }

  return out
}

export function calcMA(values: number[], period: number, type: 'sma' | 'ema'): (number | null)[] {
  return type === 'ema' ? calcEMA(values, period) : sma(values, period)
}

export function calcBollinger(values: number[], period: number, stdMult: number) {
  return values.map((_, i) => {
    if (i < period - 1) return null
    const slice = values.slice(i - period + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period)
    return { mid: mean, upper: mean + stdMult * std, lower: mean - stdMult * std }
  })
}

export function calcIchimoku(candles: Candle[], conversionPeriod: number, basePeriod: number, spanBPeriod: number) {
  const midpoint = (i: number, period: number) => {
    if (i < period - 1) return null
    const slice = candles.slice(i - period + 1, i + 1)
    const high = Math.max(...slice.map(c => c.high))
    const low = Math.min(...slice.map(c => c.low))
    return (high + low) / 2
  }

  const conversion = candles.map((_, i) => midpoint(i, conversionPeriod))
  const base = candles.map((_, i) => midpoint(i, basePeriod))
  const spanA = candles.map((_, i) => {
    const c = conversion[i]
    const b = base[i]
    return c !== null && b !== null ? (c + b) / 2 : null
  })
  const spanB = candles.map((_, i) => midpoint(i, spanBPeriod))

  return { conversion, base, spanA, spanB }
}

export function calcCCI(candles: Candle[], period: number): (number | null)[] {
  const typical = candles.map(c => (c.high + c.low + c.close) / 3)

  return typical.map((tp, i) => {
    if (i < period - 1) return null
    const slice = typical.slice(i - period + 1, i + 1)
    const mean = slice.reduce((sum, value) => sum + value, 0) / period
    const meanDev = slice.reduce((sum, value) => sum + Math.abs(value - mean), 0) / period
    return meanDev === 0 ? 0 : (tp - mean) / (0.015 * meanDev)
  })
}

export function calcStochastic(candles: Candle[], period: number, smoothK: number) {
  const rawK = candles.map((c, i) => {
    if (i < period - 1) return null
    const slice = candles.slice(i - period + 1, i + 1)
    const high = Math.max(...slice.map(item => item.high))
    const low = Math.min(...slice.map(item => item.low))
    return high === low ? 50 : ((c.close - low) / (high - low)) * 100
  })
  const k = smoothNullable(rawK, smoothK)
  const d = smoothNullable(k, 3)
  return { k, d }
}

export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null]
  let avgGain = 0
  let avgLoss = 0

  for (let i = 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1]
    const gain = delta > 0 ? delta : 0
    const loss = delta < 0 ? -delta : 0

    if (i <= period) {
      avgGain += gain / period
      avgLoss += loss / period
      out.push(i < period ? null : 100 - 100 / (1 + avgGain / (avgLoss || 1e-10)))
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
      out.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)))
    }
  }

  return out
}

export function calcStochasticRSI(closes: number[], period: number, smoothK: number) {
  const rsi = calcRSI(closes, period)
  const raw = rsi.map((value, i) => {
    if (value === null || i < period * 2 - 1) return null
    const slice = rsi.slice(i - period + 1, i + 1).filter((v): v is number => v !== null)
    const high = Math.max(...slice)
    const low = Math.min(...slice)
    return high === low ? 50 : ((value - low) / (high - low)) * 100
  })
  const k = smoothNullable(raw, smoothK)
  const d = smoothNullable(k, 3)
  return { k, d }
}

export function calcMFI(candles: Candle[], period: number): (number | null)[] {
  const typical = candles.map(c => (c.high + c.low + c.close) / 3)
  const flows = candles.map((c, i) => typical[i] * c.volume)

  return candles.map((_, i) => {
    if (i < period) return null
    let positive = 0
    let negative = 0

    for (let j = i - period + 1; j <= i; j++) {
      if (typical[j] > typical[j - 1]) positive += flows[j]
      if (typical[j] < typical[j - 1]) negative += flows[j]
    }

    if (negative === 0) return 100
    const ratio = positive / negative
    return 100 - 100 / (1 + ratio)
  })
}

function smoothNullable(values: (number | null)[], period: number): (number | null)[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - period + 1), i + 1)
    if (slice.length < period || slice.some(value => value === null)) return null
    return (slice as number[]).reduce((sum, value) => sum + value, 0) / period
  })
}
