import type { CandlestickData, HistogramData, IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts'
import { HistogramSeries, LineSeries } from 'lightweight-charts'
import type { IndicatorSeries } from './chartTypes'
import type { IndicatorPoint } from './indicatorCalculations'
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
} from './indicatorCalculations'
import { IchimokuCloudPaneView } from './ichimokuCloudSeries'

type IndicatorKind = 'overlay' | 'pane'
type SeriesKind = 'line' | 'histogram'

interface IndicatorZone {
  min: number
  max: number
  lower: number
  upper: number
}

interface IndicatorDefinition {
  name: string
  kind: IndicatorKind
  colors: string[]
  series: SeriesKind[]
  calculate: (data: CandlestickData[]) => IndicatorPoint[][]
  zone?: IndicatorZone
  referenceLines?: number[]
}

const COLORS = {
  blue: '#2962ff',
  amber: '#f59e0b',
  violet: '#8b5cf6',
  green: '#089981',
  red: '#f23645',
  gray: 'rgba(148,163,184,0.62)',
  cyan: '#06b6d4',
  pink: '#ec4899',
  lime: '#84cc16',
  orange: '#f97316',
}

const indicator = (
  name: string,
  kind: IndicatorKind,
  colors: string[],
  series: SeriesKind[],
  calculate: (data: CandlestickData[]) => IndicatorPoint[][],
  zone?: IndicatorZone,
  referenceLines?: number[],
): IndicatorDefinition => ({ name, kind, colors, series, calculate, zone, referenceLines })

const oscillatorZone: IndicatorZone = { min: 0, max: 100, lower: 20, upper: 80 }
const rsiZone: IndicatorZone = { min: 0, max: 100, lower: 30, upper: 70 }
const williamsZone: IndicatorZone = { min: -100, max: 0, lower: -80, upper: -20 }
const cciZone: IndicatorZone = { min: -200, max: 200, lower: -100, upper: 100 }

export const INDICATOR_DEFS: IndicatorDefinition[] = [
  indicator('SMA 20', 'overlay', [COLORS.blue], ['line'], data => [calcSMA(data, 20)]),
  indicator('EMA 20', 'overlay', [COLORS.amber], ['line'], data => [calcEMA(data, 20)]),
  indicator('WMA 20', 'overlay', [COLORS.violet], ['line'], data => [calcWMA(data, 20)]),
  indicator('HMA 20', 'overlay', [COLORS.cyan], ['line'], data => [calcHMA(data, 20)]),
  indicator('VWMA 20', 'overlay', [COLORS.lime], ['line'], data => [calcVWMA(data, 20)]),
  indicator('VWAP', 'overlay', [COLORS.pink], ['line'], data => [calcVWAP(data)]),
  indicator('Bollinger Bands', 'overlay', [COLORS.blue, COLORS.gray, COLORS.blue], ['line', 'line', 'line'], data => calcBollingerBands(data, 20, 2)),
  indicator('Bollinger Band Width', 'pane', [COLORS.blue], ['line'], data => [calcBollingerWidth(data, 20, 2)]),
  indicator('Keltner Channels', 'overlay', [COLORS.orange, COLORS.gray, COLORS.orange], ['line', 'line', 'line'], data => calcKeltnerChannels(data, 20, 2)),
  indicator('Donchian Channels', 'overlay', [COLORS.cyan, COLORS.gray, COLORS.cyan], ['line', 'line', 'line'], data => calcDonchianChannels(data, 20)),
  indicator('Ichimoku Cloud', 'overlay', [COLORS.blue, COLORS.red, COLORS.green, COLORS.red, COLORS.violet], ['line', 'line', 'line', 'line', 'line'], data => {
    const result = calcIchimoku(data)
    return [result.tenkan, result.kijun, result.senkouA, result.senkouB, result.chikou]
  }),
  indicator('Parabolic SAR', 'overlay', [COLORS.pink], ['line'], data => [calcParabolicSAR(data)]),
  indicator('Supertrend', 'overlay', [COLORS.green], ['line'], data => [calcSupertrend(data, 10, 3)]),
  indicator('RSI 14', 'pane', [COLORS.violet], ['line'], data => [calcRSI(data, 14)], rsiZone),
  indicator('Stochastic', 'pane', [COLORS.blue, COLORS.amber], ['line', 'line'], data => calcStochastic(data, 14, 3, 3), oscillatorZone),
  indicator('Stochastic RSI', 'pane', [COLORS.cyan, COLORS.orange], ['line', 'line'], data => calcStochasticRSI(data, 14, 14, 3, 3), oscillatorZone),
  indicator('MACD', 'pane', [COLORS.blue, COLORS.orange, COLORS.gray], ['line', 'line', 'histogram'], data => {
    const { macd, signal, hist } = calcMACD(data)
    return [macd, signal, hist]
  }, undefined, [0]),
  indicator('ADX/DMI', 'pane', [COLORS.violet, COLORS.green, COLORS.red], ['line', 'line', 'line'], data => calcADX(data, 14)),
  indicator('ATR 14', 'pane', [COLORS.orange], ['line'], data => [calcATR(data, 14)]),
  indicator('CCI 20', 'pane', [COLORS.cyan], ['line'], data => [calcCCI(data, 20)], cciZone),
  indicator('Williams %R', 'pane', [COLORS.pink], ['line'], data => [calcWilliamsR(data, 14)], williamsZone),
  indicator('ROC 12', 'pane', [COLORS.blue], ['line'], data => [calcROC(data, 12)], undefined, [0]),
  indicator('Momentum 10', 'pane', [COLORS.amber], ['line'], data => [calcMomentum(data, 10)], undefined, [0]),
  indicator('MFI 14', 'pane', [COLORS.green], ['line'], data => [calcMFI(data, 14)], oscillatorZone),
  indicator('OBV', 'pane', [COLORS.blue], ['line'], data => [calcOBV(data)]),
  indicator('Accumulation/Distribution', 'pane', [COLORS.cyan], ['line'], data => [calcAccumulationDistribution(data)]),
  indicator('Chaikin Oscillator', 'pane', [COLORS.orange], ['line'], data => [calcChaikinOscillator(data)], undefined, [0]),
  indicator('Chaikin Money Flow', 'pane', [COLORS.green], ['line'], data => [calcCMF(data, 20)], { min: -1, max: 1, lower: -0.25, upper: 0.25 }, [0]),
  indicator('Volume', 'pane', [COLORS.gray], ['histogram'], data => [calcVolume(data)]),
  indicator('Volume Oscillator', 'pane', [COLORS.violet], ['line'], data => [calcVolumeOscillator(data, 5, 10)], undefined, [0]),
  indicator('Awesome Oscillator', 'pane', [COLORS.green], ['histogram'], data => [calcAwesomeOscillator(data)]),
  indicator('TRIX', 'pane', [COLORS.pink], ['line'], data => [calcTRIX(data, 15)], undefined, [0]),
  indicator('DPO', 'pane', [COLORS.cyan], ['line'], data => [calcDPO(data, 20)], undefined, [0]),
  indicator('PPO', 'pane', [COLORS.blue, COLORS.amber], ['line', 'line'], data => calcPPO(data, 12, 26, 9), undefined, [0]),
  indicator('Aroon', 'pane', [COLORS.green, COLORS.red], ['line', 'line'], data => calcAroon(data, 25), oscillatorZone),
  indicator('Ultimate Oscillator', 'pane', [COLORS.orange], ['line'], data => [calcUltimateOscillator(data)], rsiZone),
]

export const INDICATORS = INDICATOR_DEFS.map(definition => definition.name)

const definitionsByName = new Map(INDICATOR_DEFS.map(definition => [definition.name, definition]))
const MAIN_PANE_STRETCH = 6
const INDICATOR_PANE_STRETCH = 1
const MAX_LIGHTWEIGHT_CHART_VALUE = Number.MAX_SAFE_INTEGER / 100

const toChartSeriesValue = (value: number | null | undefined) => {
  const next = Number(value ?? 0)
  if (!Number.isFinite(next)) return 0
  return Math.max(-MAX_LIGHTWEIGHT_CHART_VALUE, Math.min(next, MAX_LIGHTWEIGHT_CHART_VALUE))
}

const histogramData = (points: IndicatorPoint[]): HistogramData[] => points.map(point => ({
  time: point.time,
  value: toChartSeriesValue(point.value),
  color: point.color ?? (point.value >= 0 ? 'rgba(8,153,129,0.4)' : 'rgba(242,54,69,0.4)'),
}))

function syncPaneSizes(chart: IChartApi) {
  chart.panes().forEach((pane, index) => {
    pane.setStretchFactor(index === 0 ? MAIN_PANE_STRETCH : INDICATOR_PANE_STRETCH)
  })
}

const setIndicatorData = (
  series: ISeriesApi<'Line' | 'Histogram'>,
  kind: SeriesKind,
  points: IndicatorPoint[],
) => {
  if (kind === 'histogram') {
    (series as ISeriesApi<'Histogram'>).setData(histogramData(points))
  } else {
    (series as ISeriesApi<'Line'>).setData(points)
  }
}

const setZoneData = (
  indicatorSeries: IndicatorSeries,
  index: number,
  data: CandlestickData[],
  value: number,
) => {
  const series = indicatorSeries.decorations?.[index] as ISeriesApi<'Line'> | undefined
  series?.setData(data.map(item => ({ time: item.time, value })))
}

export function refreshIndicatorSeries(name: string, indicatorSeries: IndicatorSeries | undefined, data: CandlestickData[]) {
  const definition = definitionsByName.get(name)
  if (!indicatorSeries || !definition) return
  const calculated = definition.calculate(data)
  indicatorSeries.series.forEach((series, index) => {
    setIndicatorData(series, definition.series[index], calculated[index] ?? [])
  })
  indicatorSeries.refreshDecorations?.(data)

  if (definition.zone) {
    setZoneData(indicatorSeries, 0, data, definition.zone.upper)
    setZoneData(indicatorSeries, 1, data, definition.zone.lower)
    setZoneData(indicatorSeries, 2, data, definition.zone.max)
    setZoneData(indicatorSeries, 3, data, definition.zone.min)
  }
  const referenceStart = definition.zone ? 4 : 0
  definition.referenceLines?.forEach((value, index) => {
    setZoneData(indicatorSeries, referenceStart + index, data, value)
  })
}

export function createIndicatorSeries(
  chart: IChartApi,
  name: string,
  data: CandlestickData[],
): IndicatorSeries | null {
  const definition = definitionsByName.get(name)
  if (!definition) return null
  const paneIndex = definition.kind === 'pane' ? chart.panes().length : undefined
  if (paneIndex !== undefined) chart.addPane(true)

  const calculated = definition.calculate(data)
  const decorations: ISeriesApi<SeriesType>[] = []
  let refreshDecorations: IndicatorSeries['refreshDecorations']

  if (name === 'Ichimoku Cloud') {
    const cloud = chart.addCustomSeries(new IchimokuCloudPaneView(), {
      bullishColor: 'rgba(8,153,129,0.28)',
      bearishColor: 'rgba(242,54,69,0.24)',
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'right',
    }, paneIndex)
    cloud.setData(calcIchimoku(data).cloud)
    decorations.push(cloud as unknown as ISeriesApi<SeriesType>)
    refreshDecorations = nextData => cloud.setData(calcIchimoku(nextData).cloud)
  }

  if (definition.zone && paneIndex !== undefined) {
    const sharedOptions = {
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'right',
      crosshairMarkerVisible: false,
    }
    const upper = chart.addSeries(LineSeries, { ...sharedOptions, color: 'rgba(248,113,113,0.42)', lineWidth: 1, lineStyle: 2 }, paneIndex)
    const lower = chart.addSeries(LineSeries, { ...sharedOptions, color: 'rgba(52,211,153,0.42)', lineWidth: 1, lineStyle: 2 }, paneIndex)
    const maximum = chart.addSeries(LineSeries, { ...sharedOptions, color: 'rgba(0,0,0,0)', lineWidth: 1 }, paneIndex)
    const minimum = chart.addSeries(LineSeries, { ...sharedOptions, color: 'rgba(0,0,0,0)', lineWidth: 1 }, paneIndex)
    upper.setData(data.map(item => ({ time: item.time, value: definition.zone!.upper })))
    lower.setData(data.map(item => ({ time: item.time, value: definition.zone!.lower })))
    maximum.setData(data.map(item => ({ time: item.time, value: definition.zone!.max })))
    minimum.setData(data.map(item => ({ time: item.time, value: definition.zone!.min })))
    decorations.push(upper, lower, maximum, minimum)
  }

  if (definition.referenceLines && paneIndex !== undefined) {
    definition.referenceLines.forEach(value => {
      const reference = chart.addSeries(LineSeries, {
        priceLineVisible: false,
        lastValueVisible: false,
        priceScaleId: 'right',
        crosshairMarkerVisible: false,
        color: 'rgba(148,163,184,0.34)',
        lineWidth: 1,
        lineStyle: 2,
      }, paneIndex)
      reference.setData(data.map(item => ({ time: item.time, value })))
      decorations.push(reference)
    })
  }

  const series = definition.series.map((seriesKind, index) => {
    const options = {
      color: definition.colors[index] ?? COLORS.blue,
      lineWidth: 1 as const,
      priceLineVisible: false,
      priceScaleId: 'right',
    }
    const created: ISeriesApi<'Line' | 'Histogram'> = seriesKind === 'histogram'
      ? chart.addSeries(HistogramSeries, options, paneIndex)
      : chart.addSeries(LineSeries, {
        ...options,
        crosshairMarkerVisible: false,
        ...(name === 'Parabolic SAR' ? {
          lineVisible: false,
          pointMarkersVisible: true,
          pointMarkersRadius: 2,
        } : {}),
      }, paneIndex)
    setIndicatorData(created, seriesKind, calculated[index] ?? [])
    return created
  })

  if (paneIndex !== undefined) {
    try {
      chart.priceScale('right', paneIndex).applyOptions({
        scaleMargins: { top: 0.12, bottom: 0.12 },
        borderVisible: false,
      })
    } catch {
      // Some lightweight-charts builds create custom scales lazily; the series still renders.
    }
  }

  syncPaneSizes(chart)
  return {
    series,
    decorations,
    refreshDecorations,
    paneIndex,
    priceScaleId: paneIndex !== undefined ? 'right' : undefined,
  }
}

export function removeIndicatorSeries(chart: IChartApi, indicatorSeries: IndicatorSeries | undefined) {
  if (!indicatorSeries) return
  const pane = indicatorSeries.series[0]?.getPane()
  ;[...(indicatorSeries.decorations ?? []), ...indicatorSeries.series].forEach(series => chart.removeSeries(series))
  const paneIndex = pane?.paneIndex()
  if (paneIndex && paneIndex > 0 && pane.getSeries().length === 0) chart.removePane(paneIndex)
  syncPaneSizes(chart)
}
