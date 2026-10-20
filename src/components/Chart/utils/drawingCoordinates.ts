import type { IChartApi, Logical, Time } from 'lightweight-charts'
import type { Candle } from '../../../types'

type TimeCandle = Pick<Candle, 'ts'>

type TimeLikePoint = {
  time: number | null
  logical?: Logical
  x?: number
}

export function candleUnixTime(candle: TimeCandle) {
  return Math.floor(new Date(candle.ts).getTime() / 1000)
}

function getBarSpacing(chart: IChartApi) {
  const zero = chart.timeScale().logicalToCoordinate(0 as Logical)
  const one = chart.timeScale().logicalToCoordinate(1 as Logical)
  if (zero != null && one != null) {
    const spacing = one - zero
    if (Number.isFinite(spacing) && Math.abs(spacing) > 0.001) return spacing
  }
  return null
}

function getMedianStepSeconds(candles: TimeCandle[]) {
  if (candles.length < 2) return null

  const steps: number[] = []
  for (let i = 1; i < candles.length; i += 1) {
    const step = candleUnixTime(candles[i]) - candleUnixTime(candles[i - 1])
    if (Number.isFinite(step) && step > 0) steps.push(step)
  }

  if (!steps.length) return null
  steps.sort((a, b) => a - b)
  return steps[Math.floor(steps.length / 2)]
}

export function timeToAnchoredCoordinate(
  chart: IChartApi | null,
  candles: TimeCandle[],
  point: TimeLikePoint,
) {
  if (!chart) return point.x ?? null

  if (point.time != null) {
    const direct = chart.timeScale().timeToCoordinate(point.time as Time)
    if (direct != null) return direct

    if (candles.length) {
      const target = Number(point.time)
      const firstTime = candleUnixTime(candles[0])
      const lastTime = candleUnixTime(candles[candles.length - 1])
      const firstX = chart.timeScale().timeToCoordinate(firstTime as Time)
      const lastX = chart.timeScale().timeToCoordinate(lastTime as Time)

      if (Number.isFinite(target) && firstX != null && lastX != null) {
        if (target <= firstTime && candles.length >= 2) {
          const spacing = getBarSpacing(chart)
          const step = getMedianStepSeconds(candles)
          if (spacing != null && step != null) {
            return firstX + ((target - firstTime) / step) * spacing
          }
        }

        if (target >= lastTime && candles.length >= 2) {
          const spacing = getBarSpacing(chart)
          const step = getMedianStepSeconds(candles)
          if (spacing != null && step != null) {
            return lastX + ((target - lastTime) / step) * spacing
          }
        }

        for (let i = 1; i < candles.length; i += 1) {
          const prevTime = candleUnixTime(candles[i - 1])
          const nextTime = candleUnixTime(candles[i])
          if (target < prevTime || target > nextTime || nextTime === prevTime) continue

          const prevX = chart.timeScale().timeToCoordinate(prevTime as Time)
          const nextX = chart.timeScale().timeToCoordinate(nextTime as Time)
          if (prevX == null || nextX == null) continue

          const ratio = (target - prevTime) / (nextTime - prevTime)
          return prevX + (nextX - prevX) * ratio
        }
      }
    }
  }

  if (point.logical != null) {
    const logicalX = chart.timeScale().logicalToCoordinate(point.logical as Logical)
    if (logicalX != null) return logicalX
  }

  return point.x ?? null
}

export function coordinateToAnchoredTime(
  chart: IChartApi | null,
  candles: TimeCandle[],
  x: number,
) {
  if (!chart) return null

  if (candles.length >= 2) {
    const firstTime = candleUnixTime(candles[0])
    const lastTime = candleUnixTime(candles[candles.length - 1])
    const firstX = chart.timeScale().timeToCoordinate(firstTime as Time)
    const lastX = chart.timeScale().timeToCoordinate(lastTime as Time)
    const spacing = getBarSpacing(chart)
    const step = getMedianStepSeconds(candles)

    if (firstX != null && lastX != null && spacing != null && step != null) {
      if (x <= firstX) return Math.round(firstTime + ((x - firstX) / spacing) * step)
      if (x >= lastX) return Math.round(lastTime + ((x - lastX) / spacing) * step)

      for (let i = 1; i < candles.length; i += 1) {
        const prevTime = candleUnixTime(candles[i - 1])
        const nextTime = candleUnixTime(candles[i])
        const prevX = chart.timeScale().timeToCoordinate(prevTime as Time)
        const nextX = chart.timeScale().timeToCoordinate(nextTime as Time)
        if (prevX == null || nextX == null || nextX === prevX) continue
        const left = Math.min(prevX, nextX)
        const right = Math.max(prevX, nextX)
        if (x < left || x > right) continue

        const ratio = (x - prevX) / (nextX - prevX)
        return Math.round(prevTime + (nextTime - prevTime) * ratio)
      }
    }
  }

  const direct = chart.timeScale().coordinateToTime(x)
  return typeof direct === 'number' ? direct : null
}
