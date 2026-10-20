import type { Logical } from 'lightweight-charts'
import type { DrawTool, Point } from '../chartTypes'
import { CHANNEL_TOOLS } from './chartHelpers'
import { yOnSegmentLineAtX, getMidpoint } from './chartGeometry'

type PixelConverter = {
  pointToPixel: (p: Point) => { x: number; y: number }
  pixelToPoint: (px: number, py: number) => Point
}

// ─────────────────────────────────────────────
// Parallel channel
// Normalises the width-point so it always sits at the midpoint x of the
// baseline, making the offset well-defined regardless of where the user
// originally clicked.
// ─────────────────────────────────────────────
export function normalizeChannelWidthPoint(
  tool: DrawTool,
  points: Point[],
  { pointToPixel, pixelToPoint }: PixelConverter,
): Point[] {
  if (
    tool === 'trendbasedfibextension' ||
    tool === 'fibchannel' ||
    !CHANNEL_TOOLS.includes(tool) ||
    points.length < 3
  ) {
    return points
  }

  const start = pointToPixel(points[0])
  const end   = pointToPixel(points[1])
  const width = pointToPixel(points[2])
  const offsetY  = width.y - yOnSegmentLineAtX(start, end, width.x)
  const middle   = getMidpoint(start, end)
  const normalized = pixelToPoint(middle.x, middle.y + offsetY)
  return [points[0], points[1], normalized]
}

export function normalizeGannSquareFixedPoints(
  tool: DrawTool,
  points: Point[],
  { pointToPixel, pixelToPoint }: PixelConverter,
): Point[] {
  if (tool !== 'gannsquarefixed' || points.length < 2) return points

  const origin = pointToPixel(points[0])
  const control = pointToPixel(points[1])

  const dx = control.x - origin.x
  const dy = control.y - origin.y

  const controlLevel = 0.25
  const controlRadius = Math.hypot(dx, dy)

  if (controlRadius < 0.001) return points

  const side = controlRadius / controlLevel

  const signX = dx >= 0 ? 1 : -1
  const signY = dy >= 0 ? 1 : -1

  const outerCorner = pixelToPoint(
    origin.x + signX * side,
    origin.y + signY * side,
  )

  // points[2] مخفی است و فقط برای چسبیدن شکل به چارت ذخیره می‌شود
  return [
    points[0],
    points[1],
    outerCorner,
  ]
}

export function normalizeTimeCyclesPoints(
  tool: DrawTool,
  points: Point[],
  { pointToPixel, pixelToPoint }: PixelConverter,
): Point[] {
  if (tool !== 'timecycles' || points.length < 2) return points

  const a = pointToPixel(points[0])
  const b = pointToPixel(points[1])

  // دو نود باید همیشه روی یک Y باشند
  const sameY = a.y

  return [
    points[0],
    pixelToPoint(b.x, sameY),
  ]
}

export function normalizeArcMidpoint(
  tool: DrawTool,
  points: Point[],
  { pointToPixel, pixelToPoint }: PixelConverter,
): Point[] {
  if (tool !== 'arc' || points.length < 3) return points

  const start = pointToPixel(points[0])
  const end = pointToPixel(points[1])
  const control = pointToPixel(points[2])
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 0.001) return points

  const middle = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }
  const nx = -dy / length
  const ny = dx / length
  const offset = (control.x - middle.x) * nx + (control.y - middle.y) * ny
  const normalized = pixelToPoint(
    middle.x + nx * offset,
    middle.y + ny * offset,
  )

  return [points[0], points[1], normalized]
}

export function normalizeCurvePoints(
  tool: DrawTool,
  points: Point[],
  { pointToPixel, pixelToPoint }: PixelConverter,
): Point[] {
  if (tool !== 'curve' || points.length !== 2) return points

  const start = pointToPixel(points[0])
  const end = pointToPixel(points[1])
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 0.001) return points

  const middle = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }
  const nx = -dy / length
  const ny = dx / length
  const offset = Math.max(28, Math.min(120, length * 0.35))
  const curvePoint = pixelToPoint(
    middle.x + nx * offset,
    middle.y + ny * offset,
  )

  return [points[0], points[1], curvePoint]
}

export function normalizeDoubleCurvePoints(
  tool: DrawTool,
  points: Point[],
  { pointToPixel, pixelToPoint }: PixelConverter,
): Point[] {
  if (tool !== 'doublecurve' || points.length !== 2) return points

  const start = pointToPixel(points[0])
  const end = pointToPixel(points[1])
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 0.001) return points

  const nx = -dy / length
  const ny = dx / length
  const offset = Math.max(36, Math.min(150, length * 0.45))
  const p1 = pixelToPoint(
    start.x + dx / 3 + nx * offset,
    start.y + dy / 3 + ny * offset,
  )
  const p2 = pixelToPoint(
    start.x + (dx * 2) / 3 - nx * offset,
    start.y + (dy * 2) / 3 - ny * offset,
  )

  return [points[0], p1, p2, points[1]]
}


// ─────────────────────────────────────────────
// Flat-top / flat-bottom
// The third point only carries price (y); its x is snapped to the end
// point so the horizontal band has a clean right edge.
// ─────────────────────────────────────────────
export function normalizeFlatTopBottomPoint(
  tool: DrawTool,
  points: Point[],
  { pointToPixel, pixelToPoint }: PixelConverter,
): Point[] {
  if (tool !== 'flattopbottom' || points.length < 3) return points
  const end        = pointToPixel(points[1])
  const heightPoint = pointToPixel(points[2])
  const normalized = pixelToPoint(end.x, heightPoint.y)
  return [points[0], points[1], normalized]
}

// ─────────────────────────────────────────────
// Disjoint channel
// The third point only carries price (y); its x is snapped to the end
// point so the inverse baseline starts at the correct time position.
// ─────────────────────────────────────────────
export function normalizeDisjointChannelPoint(
  tool: DrawTool,
  points: Point[],
  { pointToPixel, pixelToPoint }: PixelConverter,
): Point[] {
  if (tool !== 'disjointchannel' || points.length < 3) return points
  const end          = pointToPixel(points[1])
  const inverseStart = pointToPixel(points[2])
  const normalized   = pixelToPoint(end.x, inverseStart.y)
  return [points[0], points[1], normalized]
}

// ─────────────────────────────────────────────
// Regression trend
// After the user places both endpoints, recalculates them so they lie on
// the least-squares regression line computed over the visible candles.
// This is the only normalizer that reads external data (candles).
// ─────────────────────────────────────────────
export function normalizeRegressionTrendPoints(
  tool: DrawTool,
  points: Point[],
  sourceCandles: { close: number; ts: string }[],
  converters: PixelConverter & {
    logicalToCoordinate: (logical: number) => number | null
    priceToCoordinate: (price: number) => number | null
  },
): Point[] {
  if (tool !== 'regressiontrend' || points.length < 2) return points
  if (sourceCandles.length < 2) return points

  const startIndex = getCandleIndexForPoint(points[0], sourceCandles)
  const endIndex   = getCandleIndexForPoint(points[1], sourceCandles)
  if (startIndex === null || endIndex === null) return points

  const from  = Math.max(0, Math.min(sourceCandles.length - 1, Math.min(startIndex, endIndex)))
  const to    = Math.max(0, Math.min(sourceCandles.length - 1, Math.max(startIndex, endIndex)))
  const count = to - from + 1
  if (count < 2) return points

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
  for (let i = from; i <= to; i++) {
    const x = i
    const y = sourceCandles[i].close
    sumX  += x
    sumY  += y
    sumXY += x * y
    sumXX += x * x
  }

  const denominator = count * sumXX - sumX * sumX
  if (Math.abs(denominator) < 0.000001) return points

  const slope     = (count * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / count

  return points.slice(0, 2).map(point => {
    const logical = getCandleIndexForPoint(point, sourceCandles) ?? 0
    const x       = converters.logicalToCoordinate(logical) ?? point.x
    const price   = slope * logical + intercept
    const y       = converters.priceToCoordinate(price) ?? point.y
    return {
      ...point,
      logical: logical as unknown as Logical,
      time: new Date(sourceCandles[logical].ts).getTime() / 1000,
      price,
      x,
      y,
    }
  })
}

function getCandleIndexForPoint(point: Point, sourceCandles: { ts: string }[]) {
  if (sourceCandles.length === 0) return null

  if (point.time != null) {
    const targetMs = Number(point.time) * 1000
    if (Number.isFinite(targetMs)) {
      let nearestIndex = 0
      let nearestDistance = Number.POSITIVE_INFINITY

      for (let i = 0; i < sourceCandles.length; i += 1) {
        const distance = Math.abs(new Date(sourceCandles[i].ts).getTime() - targetMs)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestIndex = i
        }
      }

      return nearestIndex
    }
  }

  const logical = Number(point.logical)
  if (!Number.isFinite(logical)) return null
  return Math.max(0, Math.min(sourceCandles.length - 1, Math.round(logical)))
}

// ─────────────────────────────────────────────
// Convenience: apply all three point-count normalizers in the right order
// (channel → flat → disjoint).  Used both on mouseDown and on mouseMove.
// ─────────────────────────────────────────────
export function applyPointNormalizers(
  tool: DrawTool,
  points: Point[],
  converters: PixelConverter,
): Point[] {

  return normalizeDoubleCurvePoints(
    tool,
    normalizeCurvePoints(
      tool,
      normalizeArcMidpoint(
        tool,
        normalizeTimeCyclesPoints(
          tool,
          normalizeDisjointChannelPoint(
            tool,
            normalizeFlatTopBottomPoint(
              tool,
              normalizeChannelWidthPoint(tool, points, converters),
              converters,
            ),
            converters,
          ),
          converters,
        ),
        converters,
      ),
      converters,
    ),
    converters,
  )
}
