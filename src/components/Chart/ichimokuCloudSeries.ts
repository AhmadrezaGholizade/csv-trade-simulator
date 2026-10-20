import { customSeriesDefaultOptions } from 'lightweight-charts'
import type {
  CustomSeriesOptions,
  CustomSeriesPricePlotValues,
  CustomSeriesWhitespaceData,
  ICustomSeriesPaneRenderer,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  PriceToCoordinateConverter,
  Time,
} from 'lightweight-charts'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import type { IchimokuCloudPoint } from './indicatorCalculations'

export interface IchimokuCloudOptions extends CustomSeriesOptions {
  bullishColor: string
  bearishColor: string
}

const DEFAULT_OPTIONS: IchimokuCloudOptions = {
  ...customSeriesDefaultOptions,
  color: 'rgba(8,153,129,0.28)',
  bullishColor: 'rgba(8,153,129,0.28)',
  bearishColor: 'rgba(242,54,69,0.24)',
  priceLineVisible: false,
  lastValueVisible: false,
}

class IchimokuCloudRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, IchimokuCloudPoint> | null = null
  private options: IchimokuCloudOptions = DEFAULT_OPTIONS

  update(data: PaneRendererCustomData<Time, IchimokuCloudPoint>, options: IchimokuCloudOptions) {
    this.data = data
    this.options = options
  }

  draw(target: CanvasRenderingTarget2D, priceConverter: PriceToCoordinateConverter): void {
    const rendererData = this.data
    if (!rendererData || rendererData.bars.length < 2) return

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save()
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'

      const fillPolygon = (points: ReadonlyArray<readonly [number, number]>, color: string) => {
        context.beginPath()
        context.moveTo(points[0][0], points[0][1])
        for (let index = 1; index < points.length; index += 1) {
          context.lineTo(points[index][0], points[index][1])
        }
        context.closePath()
        context.fillStyle = color
        context.fill()
      }

      for (let index = 1; index < rendererData.bars.length; index += 1) {
        const previous = rendererData.bars[index - 1]
        const current = rendererData.bars[index]
        if (!previous || !current) continue
        if (current.x < 0) continue
        if (previous.x > mediaSize.width) break

        const previousA = previous.originalData.spanA
        const previousB = previous.originalData.spanB
        const currentA = current.originalData.spanA
        const currentB = current.originalData.spanB
        const previousAY = priceConverter(previousA)
        const previousBY = priceConverter(previousB)
        const currentAY = priceConverter(currentA)
        const currentBY = priceConverter(currentB)
        if (previousAY === null || previousBY === null || currentAY === null || currentBY === null) continue

        const previousDifference = previousA - previousB
        const currentDifference = currentA - currentB
        const previousColor = previousDifference >= 0 ? this.options.bullishColor : this.options.bearishColor
        const currentColor = currentDifference >= 0 ? this.options.bullishColor : this.options.bearishColor

        if (previousDifference * currentDifference < 0) {
          const ratio = previousDifference / (previousDifference - currentDifference)
          const crossX = previous.x + (current.x - previous.x) * ratio
          const crossPrice = previousA + (currentA - previousA) * ratio
          const crossY = priceConverter(crossPrice)
          if (crossY === null) continue

          fillPolygon([
            [previous.x, previousAY],
            [crossX, crossY],
            [previous.x, previousBY],
          ], previousColor)
          fillPolygon([
            [crossX, crossY],
            [current.x, currentAY],
            [current.x, currentBY],
          ], currentColor)
        } else {
          fillPolygon([
            [previous.x, previousAY],
            [current.x, currentAY],
            [current.x, currentBY],
            [previous.x, previousBY],
          ], currentColor)
        }
      }
      context.restore()
    })
  }
}

export class IchimokuCloudPaneView implements ICustomSeriesPaneView<Time, IchimokuCloudPoint, IchimokuCloudOptions> {
  private readonly cloudRenderer = new IchimokuCloudRenderer()

  renderer(): ICustomSeriesPaneRenderer {
    return this.cloudRenderer
  }

  update(data: PaneRendererCustomData<Time, IchimokuCloudPoint>, options: IchimokuCloudOptions): void {
    this.cloudRenderer.update(data, options)
  }

  priceValueBuilder(point: IchimokuCloudPoint): CustomSeriesPricePlotValues {
    return [Math.max(point.spanA, point.spanB), Math.min(point.spanA, point.spanB), point.spanA]
  }

  isWhitespace(
    data: IchimokuCloudPoint | CustomSeriesWhitespaceData<Time>,
  ): data is CustomSeriesWhitespaceData<Time> {
    return !('spanA' in data) || !Number.isFinite(data.spanA) || !Number.isFinite(data.spanB)
  }

  defaultOptions(): IchimokuCloudOptions {
    return DEFAULT_OPTIONS
  }
}
