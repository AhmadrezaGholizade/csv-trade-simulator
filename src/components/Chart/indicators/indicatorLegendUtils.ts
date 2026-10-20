import type { IndicatorSeries } from '../chartTypes'

export interface IndicatorLegendValue {
  color: string
  text: string
}

export function getIndicatorLegendValues(indicator: IndicatorSeries | undefined): IndicatorLegendValue[] {
  if (!indicator) return []

  return indicator.series.flatMap((series, index) => {
    const data = series.data() as unknown as ReadonlyArray<{ value?: number; color?: string }>
    let latest: { value?: number; color?: string } | undefined
    for (let dataIndex = data.length - 1; dataIndex >= 0; dataIndex -= 1) {
      if (Number.isFinite(data[dataIndex]?.value)) {
        latest = data[dataIndex]
        break
      }
    }
    if (!latest || !Number.isFinite(latest.value)) return []

    const options = series.options() as { color?: string }
    return [{
      color: latest.color ?? options.color ?? '#2962ff',
      text: formatIndicatorValue(Number(latest.value)),
      index,
    }]
  }).map(({ color, text }) => ({ color, text }))
}

export function getIndicatorPaneTarget(indicator: IndicatorSeries | undefined): HTMLElement | null {
  const pane = indicator?.series[0]?.getPane()
  if (!pane || pane.paneIndex() === 0) return null
  const paneRow = pane.getHTMLElement()
  const paneWrapper = paneRow?.children.item(1)?.firstElementChild
  return paneWrapper instanceof HTMLElement ? paneWrapper : null
}

function formatIndicatorValue(value: number) {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000_000) return `${trimZeros(value / 1_000_000_000, 3)}B`
  if (absolute >= 1_000_000) return `${trimZeros(value / 1_000_000, 3)}M`
  if (absolute >= 1_000) return `${trimZeros(value / 1_000, 3)}K`
  if (absolute >= 100) return trimZeros(value, 2)
  if (absolute >= 1) return trimZeros(value, 3)
  return trimZeros(value, 5)
}

function trimZeros(value: number, digits: number) {
  return value.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1')
}
