import type { CandlestickData, LineData, Time } from 'lightweight-charts'

export interface IndicatorPoint extends LineData<Time> {
  color?: string
}

export interface IchimokuCloudPoint {
  time: Time
  spanA: number
  spanB: number
  color?: string
}

export interface IchimokuResult {
  tenkan: IndicatorPoint[]
  kijun: IndicatorPoint[]
  senkouA: IndicatorPoint[]
  senkouB: IndicatorPoint[]
  chikou: IndicatorPoint[]
  cloud: IchimokuCloudPoint[]
}

type NullableNumber = number | null
type IndicatorCandle = CandlestickData<Time> & { volume?: number }

const asFinite = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const next = Number(value)
  return Number.isFinite(next) ? next : null
}

const validPeriod = (period: number) => {
  const next = Math.trunc(period)
  if (!Number.isFinite(period) || next < 1) throw new RangeError('Indicator period must be a positive integer')
  return next
}

export const closeValues = (data: readonly IndicatorCandle[]) => data.map(item => Number(item.close))
export const highValues = (data: readonly IndicatorCandle[]) => data.map(item => Number(item.high))
export const lowValues = (data: readonly IndicatorCandle[]) => data.map(item => Number(item.low))
export const volumeValues = (data: readonly IndicatorCandle[]) => data.map(item => Number(item.volume ?? 0))
export const typicalPrice = (item: IndicatorCandle) => (Number(item.high) + Number(item.low) + Number(item.close)) / 3

export function toLine(
  data: readonly IndicatorCandle[],
  values: readonly (number | null | undefined)[],
): IndicatorPoint[] {
  const result: IndicatorPoint[] = []
  const length = Math.min(data.length, values.length)
  for (let index = 0; index < length; index += 1) {
    const value = asFinite(values[index])
    if (value !== null) result.push({ time: data[index].time, value })
  }
  return result
}

export function smaValues(values: readonly (number | null | undefined)[], period: number): NullableNumber[] {
  const length = validPeriod(period)
  const output: NullableNumber[] = Array(values.length).fill(null)
  let sum = 0
  let invalid = 0

  for (let index = 0; index < values.length; index += 1) {
    const value = asFinite(values[index])
    if (value === null) invalid += 1
    else sum += value

    if (index >= length) {
      const removed = asFinite(values[index - length])
      if (removed === null) invalid -= 1
      else sum -= removed
    }

    if (index >= length - 1 && invalid === 0) output[index] = sum / length
  }

  return output
}

export function emaValues(values: readonly (number | null | undefined)[], period: number): NullableNumber[] {
  const length = validPeriod(period)
  const output: NullableNumber[] = Array(values.length).fill(null)
  const multiplier = 2 / (length + 1)
  let seed: number[] = []
  let ema: number | null = null

  values.forEach((candidate, index) => {
    const value = asFinite(candidate)
    if (value === null) {
      seed = []
      ema = null
      return
    }

    if (ema === null) {
      seed.push(value)
      if (seed.length < length) return
      if (seed.length > length) seed.shift()
      ema = seed.reduce((sum, item) => sum + item, 0) / length
    } else {
      ema += multiplier * (value - ema)
    }
    output[index] = ema
  })

  return output
}

export function rmaValues(values: readonly (number | null | undefined)[], period: number): NullableNumber[] {
  const length = validPeriod(period)
  const output: NullableNumber[] = Array(values.length).fill(null)
  let seed: number[] = []
  let average: number | null = null

  values.forEach((candidate, index) => {
    const value = asFinite(candidate)
    if (value === null) {
      seed = []
      average = null
      return
    }

    if (average === null) {
      seed.push(value)
      if (seed.length < length) return
      if (seed.length > length) seed.shift()
      average = seed.reduce((sum, item) => sum + item, 0) / length
    } else {
      average = (average * (length - 1) + value) / length
    }
    output[index] = average
  })

  return output
}

export function wmaValues(values: readonly (number | null | undefined)[], period: number): NullableNumber[] {
  const length = validPeriod(period)
  const denominator = length * (length + 1) / 2
  return values.map((_, index) => {
    if (index < length - 1) return null
    let weighted = 0
    for (let offset = 0; offset < length; offset += 1) {
      const value = asFinite(values[index - length + 1 + offset])
      if (value === null) return null
      weighted += value * (offset + 1)
    }
    return weighted / denominator
  })
}

const rollingMidpoint = (
  highs: readonly number[],
  lows: readonly number[],
  period: number,
): NullableNumber[] => {
  const length = validPeriod(period)
  return highs.map((_, index) => {
    if (index < length - 1) return null
    let highest = -Infinity
    let lowest = Infinity
    for (let cursor = index - length + 1; cursor <= index; cursor += 1) {
      highest = Math.max(highest, highs[cursor])
      lowest = Math.min(lowest, lows[cursor])
    }
    return (highest + lowest) / 2
  })
}

const timeToUnixSeconds = (time: Time): number | null => {
  if (typeof time === 'number') return Number.isFinite(time) ? time : null
  if (typeof time === 'string') {
    const milliseconds = Date.parse(time)
    return Number.isFinite(milliseconds) ? milliseconds / 1000 : null
  }
  const milliseconds = Date.UTC(time.year, time.month - 1, time.day)
  return Number.isFinite(milliseconds) ? milliseconds / 1000 : null
}

const estimateBarInterval = (data: readonly IndicatorCandle[]) => {
  const intervals: number[] = []
  const start = Math.max(1, data.length - 200)
  for (let index = start; index < data.length; index += 1) {
    const previous = timeToUnixSeconds(data[index - 1].time)
    const current = timeToUnixSeconds(data[index].time)
    if (previous !== null && current !== null && current > previous) intervals.push(current - previous)
  }
  if (intervals.length === 0) return 60
  intervals.sort((left, right) => left - right)
  return intervals[Math.floor(intervals.length / 2)]
}

const addTime = (time: Time, seconds: number): Time => {
  if (typeof time === 'number') return (time + seconds) as Time
  const unix = timeToUnixSeconds(time)
  if (unix === null) return time
  const date = new Date((unix + seconds) * 1000)
  if (typeof time === 'string') return date.toISOString().slice(0, 10)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

const shiftedTime = (
  data: readonly IndicatorCandle[],
  sourceIndex: number,
  displacement: number,
  interval: number,
): Time | null => {
  const targetIndex = sourceIndex + displacement
  if (targetIndex < 0 || data.length === 0) return null
  if (targetIndex < data.length) return data[targetIndex].time
  return addTime(data[data.length - 1].time, (targetIndex - data.length + 1) * interval)
}

const shiftedLine = (
  data: readonly IndicatorCandle[],
  values: readonly (number | null | undefined)[],
  displacement: number,
): IndicatorPoint[] => {
  const result: IndicatorPoint[] = []
  const interval = estimateBarInterval(data)
  values.forEach((candidate, sourceIndex) => {
    const value = asFinite(candidate)
    if (value === null) return
    const time = shiftedTime(data, sourceIndex, displacement, interval)
    if (time !== null) result.push({ time, value })
  })
  return result
}

export function calcSMA(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  return toLine(data, smaValues(closeValues(data), period))
}

export function calcEMA(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  return toLine(data, emaValues(closeValues(data), period))
}

export function calcWMA(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  return toLine(data, wmaValues(closeValues(data), period))
}

export function calcHMA(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  const length = validPeriod(period)
  const values = closeValues(data)
  const half = Math.max(1, Math.floor(length / 2))
  const squareRoot = Math.max(1, Math.round(Math.sqrt(length)))
  const halfWma = wmaValues(values, half)
  const fullWma = wmaValues(values, length)
  const difference = values.map((_, index) => (
    halfWma[index] === null || fullWma[index] === null
      ? null
      : 2 * halfWma[index] - fullWma[index]
  ))
  return toLine(data, wmaValues(difference, squareRoot))
}

export function calcVWMA(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  const length = validPeriod(period)
  const closes = closeValues(data)
  const volumes = volumeValues(data)
  return toLine(data, closes.map((_, index) => {
    if (index < length - 1) return null
    let priceVolume = 0
    let totalVolume = 0
    for (let cursor = index - length + 1; cursor <= index; cursor += 1) {
      priceVolume += closes[cursor] * volumes[cursor]
      totalVolume += volumes[cursor]
    }
    return totalVolume === 0 ? null : priceVolume / totalVolume
  }))
}

const sessionKey = (time: Time) => {
  if (typeof time === 'string') return time.slice(0, 10)
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10)
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
}

export function calcVWAP(data: readonly IndicatorCandle[]): IndicatorPoint[] {
  let currentSession = ''
  let priceVolume = 0
  let totalVolume = 0
  const values = data.map(item => {
    const nextSession = sessionKey(item.time)
    if (nextSession !== currentSession) {
      currentSession = nextSession
      priceVolume = 0
      totalVolume = 0
    }
    const itemVolume = Number(item.volume ?? 0)
    priceVolume += typicalPrice(item) * itemVolume
    totalVolume += itemVolume
    return totalVolume === 0 ? null : priceVolume / totalVolume
  })
  return toLine(data, values)
}

export function calcBollingerBands(
  data: readonly IndicatorCandle[],
  period: number,
  multiplier: number,
): IndicatorPoint[][] {
  const length = validPeriod(period)
  const values = closeValues(data)
  const middle = smaValues(values, length)
  const deviation = values.map((_, index) => {
    if (index < length - 1 || middle[index] === null) return null
    const mean = middle[index]
    let squaredDifference = 0
    for (let cursor = index - length + 1; cursor <= index; cursor += 1) {
      squaredDifference += (values[cursor] - mean) ** 2
    }
    return Math.sqrt(squaredDifference / length)
  })
  const upper = middle.map((value, index) => value === null || deviation[index] === null ? null : value + multiplier * deviation[index])
  const lower = middle.map((value, index) => value === null || deviation[index] === null ? null : value - multiplier * deviation[index])
  return [toLine(data, upper), toLine(data, middle), toLine(data, lower)]
}

export function calcBollingerWidth(
  data: readonly IndicatorCandle[],
  period: number,
  multiplier: number,
): IndicatorPoint[] {
  const [upper, middle, lower] = calcBollingerBands(data, period, multiplier)
  const upperByTime = new Map(upper.map(item => [item.time, item.value]))
  const lowerByTime = new Map(lower.map(item => [item.time, item.value]))
  return middle.flatMap(item => {
    const upperValue = upperByTime.get(item.time)
    const lowerValue = lowerByTime.get(item.time)
    return upperValue === undefined || lowerValue === undefined || item.value === 0
      ? []
      : [{ time: item.time, value: ((upperValue - lowerValue) / item.value) * 100 }]
  })
}

export function trueRangeValues(data: readonly IndicatorCandle[]): number[] {
  return data.map((item, index) => {
    const itemHigh = Number(item.high)
    const itemLow = Number(item.low)
    if (index === 0) return itemHigh - itemLow
    const previousClose = Number(data[index - 1].close)
    return Math.max(itemHigh - itemLow, Math.abs(itemHigh - previousClose), Math.abs(itemLow - previousClose))
  })
}

export function calcATR(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  return toLine(data, rmaValues(trueRangeValues(data), period))
}

export function calcKeltnerChannels(
  data: readonly IndicatorCandle[],
  period: number,
  multiplier: number,
): IndicatorPoint[][] {
  const middle = emaValues(closeValues(data), period)
  const range = emaValues(trueRangeValues(data), period)
  const upper = middle.map((value, index) => value === null || range[index] === null ? null : value + multiplier * range[index])
  const lower = middle.map((value, index) => value === null || range[index] === null ? null : value - multiplier * range[index])
  return [toLine(data, upper), toLine(data, middle), toLine(data, lower)]
}

export function calcDonchianChannels(data: readonly IndicatorCandle[], period: number): IndicatorPoint[][] {
  const length = validPeriod(period)
  const highs = highValues(data)
  const lows = lowValues(data)
  const upper = highs.map((_, index) => index < length - 1 ? null : Math.max(...highs.slice(index - length + 1, index + 1)))
  const lower = lows.map((_, index) => index < length - 1 ? null : Math.min(...lows.slice(index - length + 1, index + 1)))
  const middle = upper.map((value, index) => value === null || lower[index] === null ? null : (value + lower[index]) / 2)
  return [toLine(data, upper), toLine(data, middle), toLine(data, lower)]
}

export function calcIchimoku(
  data: readonly IndicatorCandle[],
  conversionPeriod = 9,
  basePeriod = 26,
  spanBPeriod = 52,
  displacement = 26,
): IchimokuResult {
  const highs = highValues(data)
  const lows = lowValues(data)
  const tenkanValues = rollingMidpoint(highs, lows, conversionPeriod)
  const kijunValues = rollingMidpoint(highs, lows, basePeriod)
  const spanAValues = tenkanValues.map((value, index) => (
    value === null || kijunValues[index] === null ? null : (value + kijunValues[index]) / 2
  ))
  const spanBValues = rollingMidpoint(highs, lows, spanBPeriod)
  const interval = estimateBarInterval(data)
  const cloud: IchimokuCloudPoint[] = []

  spanAValues.forEach((spanA, sourceIndex) => {
    const spanB = spanBValues[sourceIndex]
    if (spanA === null || spanB === null) return
    const time = shiftedTime(data, sourceIndex, displacement, interval)
    if (time !== null) cloud.push({ time, spanA, spanB })
  })

  return {
    tenkan: toLine(data, tenkanValues),
    kijun: toLine(data, kijunValues),
    senkouA: shiftedLine(data, spanAValues, displacement),
    senkouB: shiftedLine(data, spanBValues, displacement),
    chikou: shiftedLine(data, closeValues(data), -displacement),
    cloud,
  }
}

export function calcParabolicSAR(
  data: readonly IndicatorCandle[],
  step = 0.02,
  maximum = 0.2,
): IndicatorPoint[] {
  if (data.length < 2) return []
  const values: NullableNumber[] = Array(data.length).fill(null)
  let rising = Number(data[1].close) >= Number(data[0].close)
  let acceleration = step
  let extreme = rising ? Number(data[0].high) : Number(data[0].low)
  let sar = rising ? Number(data[0].low) : Number(data[0].high)

  for (let index = 1; index < data.length; index += 1) {
    sar += acceleration * (extreme - sar)
    if (rising) {
      sar = Math.min(sar, Number(data[index - 1].low))
      if (index > 1) sar = Math.min(sar, Number(data[index - 2].low))
      if (Number(data[index].low) < sar) {
        rising = false
        sar = extreme
        extreme = Number(data[index].low)
        acceleration = step
      } else if (Number(data[index].high) > extreme) {
        extreme = Number(data[index].high)
        acceleration = Math.min(maximum, acceleration + step)
      }
    } else {
      sar = Math.max(sar, Number(data[index - 1].high))
      if (index > 1) sar = Math.max(sar, Number(data[index - 2].high))
      if (Number(data[index].high) > sar) {
        rising = true
        sar = extreme
        extreme = Number(data[index].high)
        acceleration = step
      } else if (Number(data[index].low) < extreme) {
        extreme = Number(data[index].low)
        acceleration = Math.min(maximum, acceleration + step)
      }
    }
    values[index] = sar
  }

  return toLine(data, values)
}

export function calcSupertrend(data: readonly IndicatorCandle[], period: number, multiplier: number): IndicatorPoint[] {
  const atr = rmaValues(trueRangeValues(data), period)
  const values: NullableNumber[] = Array(data.length).fill(null)
  let finalUpper: number | null = null
  let finalLower: number | null = null
  let supertrend: number | null = null

  data.forEach((item, index) => {
    if (atr[index] === null) return
    const midpoint = (Number(item.high) + Number(item.low)) / 2
    const basicUpper = midpoint + multiplier * atr[index]
    const basicLower = midpoint - multiplier * atr[index]

    if (finalUpper === null || finalLower === null || supertrend === null) {
      finalUpper = basicUpper
      finalLower = basicLower
      supertrend = finalUpper
      values[index] = supertrend
      return
    }

    const previousUpper = finalUpper
    const previousLower = finalLower
    const previousTrend = supertrend
    const previousClose = Number(data[index - 1].close)
    finalUpper = basicUpper < previousUpper || previousClose > previousUpper ? basicUpper : previousUpper
    finalLower = basicLower > previousLower || previousClose < previousLower ? basicLower : previousLower

    if (previousTrend === previousUpper) {
      supertrend = Number(item.close) <= finalUpper ? finalUpper : finalLower
    } else {
      supertrend = Number(item.close) >= finalLower ? finalLower : finalUpper
    }
    values[index] = supertrend
  })

  const closeByTime = new Map(data.map(item => [item.time, Number(item.close)]))
  return toLine(data, values).map(point => ({
    ...point,
    color: point.value <= (closeByTime.get(point.time) ?? point.value) ? '#089981' : '#f23645',
  }))
}

export function calcRSI(data: readonly IndicatorCandle[], period = 14): IndicatorPoint[] {
  const closes = closeValues(data)
  const gains: NullableNumber[] = [null]
  const losses: NullableNumber[] = [null]
  for (let index = 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1]
    gains.push(Math.max(change, 0))
    losses.push(Math.max(-change, 0))
  }
  const averageGain = rmaValues(gains, period)
  const averageLoss = rmaValues(losses, period)
  const values = averageGain.map((gain, index) => {
    const loss = averageLoss[index]
    if (gain === null || loss === null) return null
    if (gain === 0 && loss === 0) return 50
    if (loss === 0) return 100
    if (gain === 0) return 0
    return 100 - 100 / (1 + gain / loss)
  })
  return toLine(data, values)
}

export function calcStochastic(
  data: readonly IndicatorCandle[],
  period: number,
  smoothK: number,
  smoothD = 3,
): IndicatorPoint[][] {
  const length = validPeriod(period)
  const highs = highValues(data)
  const lows = lowValues(data)
  const closes = closeValues(data)
  const rawK = closes.map((value, index) => {
    if (index < length - 1) return null
    const highest = Math.max(...highs.slice(index - length + 1, index + 1))
    const lowest = Math.min(...lows.slice(index - length + 1, index + 1))
    return highest === lowest ? 50 : ((value - lowest) / (highest - lowest)) * 100
  })
  const k = smaValues(rawK, smoothK)
  const d = smaValues(k, smoothD)
  return [toLine(data, k), toLine(data, d)]
}

export function calcStochasticRSI(
  data: readonly IndicatorCandle[],
  rsiPeriod: number,
  stochasticPeriod: number,
  smoothK: number,
  smoothD = 3,
): IndicatorPoint[][] {
  const rsiLine = calcRSI(data, rsiPeriod)
  const rsiByTime = new Map(rsiLine.map(item => [item.time, item.value]))
  const rsiValues = data.map(item => rsiByTime.get(item.time) ?? null)
  const length = validPeriod(stochasticPeriod)
  const raw = rsiValues.map((value, index) => {
    if (value === null || index < length - 1) return null
    const window = rsiValues.slice(index - length + 1, index + 1)
    if (window.some(item => item === null)) return null
    const finiteWindow = window as number[]
    const highest = Math.max(...finiteWindow)
    const lowest = Math.min(...finiteWindow)
    return highest === lowest ? 50 : ((value - lowest) / (highest - lowest)) * 100
  })
  const k = smaValues(raw, smoothK)
  const d = smaValues(k, smoothD)
  return [toLine(data, k), toLine(data, d)]
}

export function calcMACD(
  data: readonly IndicatorCandle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: IndicatorPoint[]; signal: IndicatorPoint[]; hist: IndicatorPoint[] } {
  const values = closeValues(data)
  const fast = emaValues(values, fastPeriod)
  const slow = emaValues(values, slowPeriod)
  const macdValues = values.map((_, index) => fast[index] === null || slow[index] === null ? null : fast[index] - slow[index])
  const signalValues = emaValues(macdValues, signalPeriod)
  const histogramValues = macdValues.map((value, index) => value === null || signalValues[index] === null ? null : value - signalValues[index])
  const histogram = toLine(data, histogramValues).map(item => ({
    ...item,
    color: item.value >= 0 ? 'rgba(8,153,129,0.4)' : 'rgba(242,54,69,0.4)',
  }))
  return { macd: toLine(data, macdValues), signal: toLine(data, signalValues), hist: histogram }
}

export function calcADX(data: readonly IndicatorCandle[], period: number): IndicatorPoint[][] {
  const trueRange: NullableNumber[] = [null]
  const plusMovement: NullableNumber[] = [null]
  const minusMovement: NullableNumber[] = [null]
  for (let index = 1; index < data.length; index += 1) {
    const upward = Number(data[index].high) - Number(data[index - 1].high)
    const downward = Number(data[index - 1].low) - Number(data[index].low)
    const previousClose = Number(data[index - 1].close)
    const itemHigh = Number(data[index].high)
    const itemLow = Number(data[index].low)
    trueRange.push(Math.max(itemHigh - itemLow, Math.abs(itemHigh - previousClose), Math.abs(itemLow - previousClose)))
    plusMovement.push(upward > downward && upward > 0 ? upward : 0)
    minusMovement.push(downward > upward && downward > 0 ? downward : 0)
  }

  const smoothedRange = rmaValues(trueRange, period)
  const smoothedPlus = rmaValues(plusMovement, period)
  const smoothedMinus = rmaValues(minusMovement, period)
  const plus = smoothedRange.map((range, index) => range === null || range === 0 || smoothedPlus[index] === null
    ? null
    : 100 * smoothedPlus[index] / range)
  const minus = smoothedRange.map((range, index) => range === null || range === 0 || smoothedMinus[index] === null
    ? null
    : 100 * smoothedMinus[index] / range)
  const directionalIndex = plus.map((value, index) => {
    if (value === null || minus[index] === null) return null
    const sum = value + minus[index]
    return sum === 0 ? 0 : 100 * Math.abs(value - minus[index]) / sum
  })
  const adx = rmaValues(directionalIndex, period)
  return [toLine(data, adx), toLine(data, plus), toLine(data, minus)]
}

export function calcCCI(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  const length = validPeriod(period)
  const prices = data.map(typicalPrice)
  const average = smaValues(prices, length)
  const values = prices.map((price, index) => {
    if (index < length - 1 || average[index] === null) return null
    const mean = average[index]
    const deviation = prices.slice(index - length + 1, index + 1)
      .reduce((sum, item) => sum + Math.abs(item - mean), 0) / length
    return deviation === 0 ? 0 : (price - mean) / (0.015 * deviation)
  })
  return toLine(data, values)
}

export function calcWilliamsR(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  const length = validPeriod(period)
  const highs = highValues(data)
  const lows = lowValues(data)
  const closes = closeValues(data)
  return toLine(data, closes.map((value, index) => {
    if (index < length - 1) return null
    const highest = Math.max(...highs.slice(index - length + 1, index + 1))
    const lowest = Math.min(...lows.slice(index - length + 1, index + 1))
    return highest === lowest ? 0 : -100 * (highest - value) / (highest - lowest)
  }))
}

export function calcROC(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  const length = validPeriod(period)
  const values = closeValues(data)
  return toLine(data, values.map((value, index) => (
    index < length || values[index - length] === 0 ? null : 100 * (value / values[index - length] - 1)
  )))
}

export function calcMomentum(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  const length = validPeriod(period)
  const values = closeValues(data)
  return toLine(data, values.map((value, index) => index < length ? null : value - values[index - length]))
}

export function calcMFI(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  const length = validPeriod(period)
  const prices = data.map(typicalPrice)
  const volumes = volumeValues(data)
  const flows = prices.map((price, index) => price * volumes[index])
  const values = prices.map((_, index) => {
    if (index < length) return null
    let positive = 0
    let negative = 0
    for (let cursor = index - length + 1; cursor <= index; cursor += 1) {
      if (prices[cursor] > prices[cursor - 1]) positive += flows[cursor]
      else if (prices[cursor] < prices[cursor - 1]) negative += flows[cursor]
    }
    if (positive === 0 && negative === 0) return 50
    if (negative === 0) return 100
    if (positive === 0) return 0
    return 100 - 100 / (1 + positive / negative)
  })
  return toLine(data, values)
}

export function calcOBV(data: readonly IndicatorCandle[]): IndicatorPoint[] {
  const volumes = volumeValues(data)
  let value = 0
  return toLine(data, data.map((item, index) => {
    if (index === 0) return value
    if (Number(item.close) > Number(data[index - 1].close)) value += volumes[index]
    else if (Number(item.close) < Number(data[index - 1].close)) value -= volumes[index]
    return value
  }))
}

export function calcAccumulationDistribution(data: readonly IndicatorCandle[]): IndicatorPoint[] {
  const volumes = volumeValues(data)
  let accumulation = 0
  return toLine(data, data.map((item, index) => {
    const itemHigh = Number(item.high)
    const itemLow = Number(item.low)
    const multiplier = itemHigh === itemLow
      ? 0
      : ((Number(item.close) - itemLow) - (itemHigh - Number(item.close))) / (itemHigh - itemLow)
    accumulation += multiplier * volumes[index]
    return accumulation
  }))
}

export function calcChaikinOscillator(data: readonly IndicatorCandle[]): IndicatorPoint[] {
  const line = calcAccumulationDistribution(data)
  const byTime = new Map(line.map(item => [item.time, item.value]))
  const values = data.map(item => byTime.get(item.time) ?? null)
  const fast = emaValues(values, 3)
  const slow = emaValues(values, 10)
  return toLine(data, values.map((_, index) => fast[index] === null || slow[index] === null ? null : fast[index] - slow[index]))
}

export function calcCMF(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  const length = validPeriod(period)
  const volumes = volumeValues(data)
  const flowVolume = data.map((item, index) => {
    const itemHigh = Number(item.high)
    const itemLow = Number(item.low)
    const multiplier = itemHigh === itemLow
      ? 0
      : ((Number(item.close) - itemLow) - (itemHigh - Number(item.close))) / (itemHigh - itemLow)
    return multiplier * volumes[index]
  })
  return toLine(data, data.map((_, index) => {
    if (index < length - 1) return null
    const start = index - length + 1
    const flow = flowVolume.slice(start, index + 1).reduce((sum, value) => sum + value, 0)
    const totalVolume = volumes.slice(start, index + 1).reduce((sum, value) => sum + value, 0)
    return totalVolume === 0 ? 0 : flow / totalVolume
  }))
}

export function calcVolume(data: readonly IndicatorCandle[]): IndicatorPoint[] {
  return data.map(item => ({
    time: item.time,
    value: Math.max(0, Number(item.volume ?? 0)),
    color: Number(item.close) >= Number(item.open) ? 'rgba(8,153,129,0.4)' : 'rgba(242,54,69,0.4)',
  }))
}

export function calcVolumeOscillator(data: readonly IndicatorCandle[], shortPeriod: number, longPeriod: number): IndicatorPoint[] {
  const values = volumeValues(data)
  const short = emaValues(values, shortPeriod)
  const long = emaValues(values, longPeriod)
  return toLine(data, values.map((_, index) => (
    short[index] === null || long[index] === null || long[index] === 0
      ? null
      : 100 * (short[index] - long[index]) / long[index]
  )))
}

export function calcAwesomeOscillator(data: readonly IndicatorCandle[]): IndicatorPoint[] {
  const median = data.map(item => (Number(item.high) + Number(item.low)) / 2)
  const fast = smaValues(median, 5)
  const slow = smaValues(median, 34)
  const values = median.map((_, index) => fast[index] === null || slow[index] === null ? null : fast[index] - slow[index])
  let previous: number | null = null
  return toLine(data, values).map(item => {
    const color = previous === null || item.value >= previous ? 'rgba(8,153,129,0.4)' : 'rgba(242,54,69,0.4)'
    previous = item.value
    return { ...item, color }
  })
}

export function calcTRIX(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  const first = emaValues(closeValues(data), period)
  const second = emaValues(first, period)
  const third = emaValues(second, period)
  return toLine(data, third.map((value, index) => {
    const previous = index > 0 ? third[index - 1] : null
    if (value === null || previous === null || previous === 0) return null
    return 100 * (value / previous - 1)
  }))
}

export function calcDPO(data: readonly IndicatorCandle[], period: number): IndicatorPoint[] {
  const length = validPeriod(period)
  const values = closeValues(data)
  const average = smaValues(values, length)
  const displacement = Math.floor(length / 2) + 1
  return toLine(data, values.map((_, index) => (
    index < displacement || average[index] === null ? null : values[index - displacement] - average[index]
  )))
}

export function calcPPO(
  data: readonly IndicatorCandle[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
): IndicatorPoint[][] {
  const values = closeValues(data)
  const fast = emaValues(values, fastPeriod)
  const slow = emaValues(values, slowPeriod)
  const oscillator = values.map((_, index) => (
    fast[index] === null || slow[index] === null || slow[index] === 0
      ? null
      : 100 * (fast[index] - slow[index]) / slow[index]
  ))
  const signal = emaValues(oscillator, signalPeriod)
  return [toLine(data, oscillator), toLine(data, signal)]
}

export function calcAroon(data: readonly IndicatorCandle[], period: number): IndicatorPoint[][] {
  const length = validPeriod(period)
  const highs = highValues(data)
  const lows = lowValues(data)
  const up = highs.map((_, index) => {
    if (index < length) return null
    const window = highs.slice(index - length, index + 1)
    const periodsSince = window.length - 1 - window.lastIndexOf(Math.max(...window))
    return 100 * (length - periodsSince) / length
  })
  const down = lows.map((_, index) => {
    if (index < length) return null
    const window = lows.slice(index - length, index + 1)
    const periodsSince = window.length - 1 - window.lastIndexOf(Math.min(...window))
    return 100 * (length - periodsSince) / length
  })
  return [toLine(data, up), toLine(data, down)]
}

export function calcUltimateOscillator(data: readonly IndicatorCandle[]): IndicatorPoint[] {
  const buyingPressure = data.map((item, index) => {
    const previousClose = index > 0 ? Number(data[index - 1].close) : Number(item.close)
    return Number(item.close) - Math.min(Number(item.low), previousClose)
  })
  const trueRange = data.map((item, index) => {
    const previousClose = index > 0 ? Number(data[index - 1].close) : Number(item.close)
    return Math.max(Number(item.high), previousClose) - Math.min(Number(item.low), previousClose)
  })
  const average = (index: number, period: number) => {
    const start = index - period + 1
    const pressure = buyingPressure.slice(start, index + 1).reduce((sum, value) => sum + value, 0)
    const range = trueRange.slice(start, index + 1).reduce((sum, value) => sum + value, 0)
    return range === 0 ? 0 : pressure / range
  }
  return toLine(data, data.map((_, index) => (
    index < 27 ? null : 100 * (4 * average(index, 7) + 2 * average(index, 14) + average(index, 28)) / 7
  )))
}
