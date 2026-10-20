import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcADX,
  calcATR,
  calcAccumulationDistribution,
  calcAroon,
  calcAwesomeOscillator,
  calcBollingerBands,
  calcBollingerWidth,
  calcCCI,
  calcCMF,
  calcChaikinOscillator,
  calcDPO,
  calcDonchianChannels,
  calcEMA,
  calcHMA,
  calcIchimoku,
  calcKeltnerChannels,
  calcMACD,
  calcMFI,
  calcMomentum,
  calcOBV,
  calcPPO,
  calcParabolicSAR,
  calcROC,
  calcRSI,
  calcSMA,
  calcStochastic,
  calcStochasticRSI,
  calcSupertrend,
  calcTRIX,
  calcUltimateOscillator,
  calcVWAP,
  calcVWMA,
  calcVolume,
  calcVolumeOscillator,
  calcWMA,
  calcWilliamsR,
  emaValues,
  rmaValues,
} from '../src/components/Chart/indicatorCalculations.ts'

const START = 1_700_000_000

function candles(count, valueAt = index => index + 10) {
  return Array.from({ length: count }, (_, index) => {
    const close = valueAt(index)
    return {
      time: START + index * 60,
      open: close - 0.25,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100 + index,
    }
  })
}

function atIndex(points, index) {
  return points.find(point => point.time === START + index * 60)?.value
}

function assertClose(actual, expected, tolerance = 1e-10) {
  assert.notEqual(actual, undefined)
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`)
}

function assertFiniteSeries(series) {
  let previousTime = -Infinity
  for (const point of series) {
    assert.ok(Number.isFinite(point.value), 'indicator emitted a non-finite value')
    assert.ok(Number(point.time) > previousTime, 'indicator times must be strictly increasing')
    previousTime = Number(point.time)
  }
}

test('SMA, EMA, RMA, WMA and HMA use canonical warm-up and seeds', () => {
  assert.deepEqual(emaValues([1, 2, 3, 4], 3), [null, null, 2, 3])
  assert.deepEqual(rmaValues([1, 2, 3, 4], 3), [null, null, 2, 8 / 3])

  const data = candles(60, index => index + 1)
  assertClose(atIndex(calcSMA(data, 3), 2), 2)
  assertClose(atIndex(calcEMA(data, 3), 2), 2)
  assertClose(atIndex(calcWMA(data, 3), 2), 14 / 6)
  assert.equal(calcHMA(data, 20)[0].time, START + 22 * 60)
})

test('Ichimoku displaces Senkou spans forward and Chikou backward by 26 bars', () => {
  const data = Array.from({ length: 90 }, (_, index) => ({
    time: START + index * 60,
    open: index + 5,
    high: index + 10,
    low: index,
    close: index + 5,
    volume: 100,
  }))
  const result = calcIchimoku(data)

  assert.equal(result.tenkan[0].time, START + 8 * 60)
  assert.equal(result.kijun[0].time, START + 25 * 60)
  assert.equal(result.senkouA[0].time, START + 51 * 60)
  assert.equal(result.senkouB[0].time, START + 77 * 60)
  assert.equal(result.chikou[0].time, START)
  assertClose(result.chikou[0].value, 31)
  assert.equal(result.cloud[0].time, START + 77 * 60)
  assertClose(result.cloud[0].spanA, 47.75)
  assertClose(result.cloud[0].spanB, 30.5)

  const shortProjection = calcIchimoku(data.slice(0, 60))
  assert.equal(shortProjection.senkouB[0].time, START + 77 * 60)
})

test('ATR, RSI and ADX use Wilder smoothing and correct neutral values', () => {
  const rising = candles(80, index => index + 10)
  const flat = candles(40, () => 10)

  assert.equal(calcATR(rising, 14)[0].time, START + 13 * 60)
  assertClose(calcATR(rising, 14)[0].value, 2)
  assert.equal(calcRSI(rising, 14)[0].time, START + 14 * 60)
  assertClose(calcRSI(rising, 14)[0].value, 100)
  assertClose(calcRSI(flat, 14)[0].value, 50)

  const firstSupertrend = calcSupertrend(rising, 10, 3)[0]
  assert.equal(firstSupertrend.time, START + 9 * 60)
  assert.ok(firstSupertrend.value > rising[9].close)
  assert.equal(firstSupertrend.color, '#f23645')

  const [adx, plus, minus] = calcADX(rising, 14)
  assert.equal(adx[0].time, START + 27 * 60)
  assertClose(adx[0].value, 100)
  assert.ok(plus[0].value > 0)
  assertClose(minus[0].value, 0)
})

test('stochastic, Stoch RSI, MACD, PPO and TRIX do not seed from synthetic zeros', () => {
  const data = candles(100, index => index + Math.sin(index / 3) * 2 + 20)
  const [stochasticK, stochasticD] = calcStochastic(data, 14, 3, 3)
  const [stochRsiK, stochRsiD] = calcStochasticRSI(data, 14, 14, 3, 3)
  const macd = calcMACD(data)
  const [, ppoSignal] = calcPPO(data, 12, 26, 9)

  assert.equal(stochasticK[0].time, START + 15 * 60)
  assert.equal(stochasticD[0].time, START + 17 * 60)
  assert.equal(stochRsiK[0].time, START + 29 * 60)
  assert.equal(stochRsiD[0].time, START + 31 * 60)
  assert.equal(macd.macd[0].time, START + 25 * 60)
  assert.equal(macd.signal[0].time, START + 33 * 60)
  assert.equal(macd.hist[0].time, START + 33 * 60)
  assert.equal(ppoSignal[0].time, START + 33 * 60)
  assert.equal(calcTRIX(data, 15)[0].time, START + 43 * 60)
})

test('VWAP resets each UTC session and volume retains candle-direction colors', () => {
  const data = [
    { time: 1_704_067_200, open: 9, high: 11, low: 9, close: 10, volume: 10 },
    { time: 1_704_067_260, open: 10, high: 13, low: 10, close: 12, volume: 10 },
    { time: 1_704_153_600, open: 20, high: 22, low: 20, close: 21, volume: 5 },
  ]
  const vwap = calcVWAP(data)
  assertClose(vwap[0].value, 10)
  assertClose(vwap[1].value, 10.833333333333332)
  assertClose(vwap[2].value, 21)

  const volume = calcVolume([
    { time: START, open: 9, high: 11, low: 8, close: 10, volume: 10 },
    { time: START + 60, open: 10, high: 11, low: 8, close: 9, volume: 12 },
  ])
  assert.match(volume[0].color, /8,153,129/)
  assert.match(volume[1].color, /242,54,69/)
})

test('DPO and Aroon use their standard displacement and period-plus-one window', () => {
  const data = candles(20, index => index + 1)
  assertClose(atIndex(calcDPO(data, 4), 3), -1.5)
  const [up, down] = calcAroon(data, 3)
  assertClose(atIndex(up, 3), 100)
  assertClose(atIndex(down, 3), 0)
})

test('all active indicator calculations emit finite, time-ordered data', () => {
  const data = candles(220, index => 100 + index * 0.12 + Math.sin(index / 4) * 4)
  const groups = [
    [calcSMA(data, 20)],
    [calcEMA(data, 20)],
    [calcWMA(data, 20)],
    [calcHMA(data, 20)],
    [calcVWMA(data, 20)],
    [calcVWAP(data)],
    calcBollingerBands(data, 20, 2),
    [calcBollingerWidth(data, 20, 2)],
    calcKeltnerChannels(data, 20, 2),
    calcDonchianChannels(data, 20),
    [calcParabolicSAR(data)],
    [calcSupertrend(data, 10, 3)],
    [calcRSI(data, 14)],
    calcStochastic(data, 14, 3, 3),
    calcStochasticRSI(data, 14, 14, 3, 3),
    Object.values(calcMACD(data)),
    calcADX(data, 14),
    [calcATR(data, 14)],
    [calcCCI(data, 20)],
    [calcWilliamsR(data, 14)],
    [calcROC(data, 12)],
    [calcMomentum(data, 10)],
    [calcMFI(data, 14)],
    [calcOBV(data)],
    [calcAccumulationDistribution(data)],
    [calcChaikinOscillator(data)],
    [calcCMF(data, 20)],
    [calcVolume(data)],
    [calcVolumeOscillator(data, 5, 10)],
    [calcAwesomeOscillator(data)],
    [calcTRIX(data, 15)],
    [calcDPO(data, 20)],
    calcPPO(data, 12, 26, 9),
    calcAroon(data, 25),
    [calcUltimateOscillator(data)],
  ]

  const ichimoku = calcIchimoku(data)
  groups.push([ichimoku.tenkan, ichimoku.kijun, ichimoku.senkouA, ichimoku.senkouB, ichimoku.chikou])
  for (const group of groups) {
    for (const series of group) {
      assert.ok(series.length > 0, 'active indicator unexpectedly returned no points')
      assertFiniteSeries(series)
    }
  }
  for (const point of ichimoku.cloud) {
    assert.ok(Number.isFinite(point.spanA))
    assert.ok(Number.isFinite(point.spanB))
  }
})
