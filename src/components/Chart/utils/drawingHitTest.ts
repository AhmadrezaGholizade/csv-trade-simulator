import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts'
import type { Drawing } from '../chartTypes'
import { CHANNEL_TOOLS } from './chartHelpers'
import { getChannelGeometry, getDisjointInverseEnd, yOnSegmentLineAtX } from './chartGeometry'
import { NODE_INDICES } from './chartConstants'
import { CLOSED_POLYLINE_DISTANCE_PX, REGRESSION_DEVIATION_MULTIPLIER } from '../rendering/drawingRenderConstants'

type Pt = { x: number; y: number }
type HitContext = {
  candles: { close: number; ts: string }[]
  chart: IChartApi | null
  candleSeries: ISeriesApi<'Candlestick'> | null
}

const PITCHFORK_TOOLS = ['pitchfork', 'schiffpitchfork', 'modifiedschiffpitchfork', 'insidepitchfork']
const LOCKED_NODE_TOOLS = ['arrowmarkup', 'arrowmarkdown', 'arrowmarkleft', 'arrowmarkright']
const HANDLELESS_TOOLS = ['flagmark']
const TEXT_TOOLS = ['text', 'anchoredtext', 'note', 'anchorednote', 'callout', 'comment', 'pricelabel', 'signpost', 'flagmark']

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]
const FIB_SPEED_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]

function candleTimeToX(chart: IChartApi, candle: { ts: string }) {
  const time = Math.floor(new Date(candle.ts).getTime() / 1000)
  return chart.timeScale().timeToCoordinate(time as Time)
}

function getCandleIndexForDrawingPoint(point: Drawing['points'][number], candles: { ts: string }[]) {
  if (candles.length === 0) return null

  if (point.time != null) {
    const targetMs = Number(point.time) * 1000
    if (Number.isFinite(targetMs)) {
      let nearestIndex = 0
      let nearestDistance = Number.POSITIVE_INFINITY

      for (let i = 0; i < candles.length; i += 1) {
        const distance = Math.abs(new Date(candles[i].ts).getTime() - targetMs)
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
  return Math.max(0, Math.min(candles.length - 1, Math.round(logical)))
}

// ─────────────────────────────────────────────
// Helper: extend a segment to canvas edges
// ─────────────────────────────────────────────
function extendSegmentToCanvas(
  a: Pt,
  b: Pt,
  canvas: { width: number; height: number },
): [Pt, Pt] {
  if (Math.abs(b.x - a.x) < 0.001) {
    // vertical
    return [{ x: a.x, y: 0 }, { x: a.x, y: canvas.height }]
  }
  const slope = (b.y - a.y) / (b.x - a.x)
  const yAt0  = a.y - slope * a.x
  const yAtW  = a.y + slope * (canvas.width - a.x)
  return [{ x: 0, y: yAt0 }, { x: canvas.width, y: yAtW }]
}

function extendRayToCanvas(
  from: Pt,
  to: Pt,
  canvas: { width: number; height: number },
): Pt {
  if (Math.abs(to.x - from.x) < 0.001) {
    return { x: from.x, y: to.y > from.y ? canvas.height : 0 }
  }
  const slope = (to.y - from.y) / (to.x - from.x)
  const goRight = to.x > from.x
  const edgeX = goRight ? canvas.width : 0
  const edgeY = from.y + slope * (edgeX - from.x)
  return { x: edgeX, y: edgeY }
}

function approximateArcSegments(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  steps = 48,
): (readonly [Pt, Pt])[] {
  const segments: (readonly [Pt, Pt])[] = []

  let prev: Pt = {
    x: cx + Math.cos(startAngle) * r,
    y: cy + Math.sin(startAngle) * r,
  }

  for (let i = 1; i <= steps; i++) {
    const t = startAngle + ((endAngle - startAngle) * i) / steps
    const next: Pt = {
      x: cx + Math.cos(t) * r,
      y: cy + Math.sin(t) * r,
    }

    segments.push([prev, next] as const)
    prev = next
  }

  return segments
}

function approximateCircularArcSegments(
  center: Pt,
  radius: number,
  startAngle: number,
  endAngle: number,
  anticlockwise: boolean,
  steps = 48,
): (readonly [Pt, Pt])[] {
  const segments: (readonly [Pt, Pt])[] = []
  let delta = endAngle - startAngle

  if (!anticlockwise && delta < 0) delta += Math.PI * 2
  if (anticlockwise && delta > 0) delta -= Math.PI * 2

  let prev = {
    x: center.x + Math.cos(startAngle) * radius,
    y: center.y + Math.sin(startAngle) * radius,
  }

  for (let i = 1; i <= steps; i++) {
    const angle = startAngle + delta * (i / steps)
    const next = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }

    segments.push([prev, next] as const)
    prev = next
  }

  return segments
}

function getProjectionSectorGeometryForHit(origin: Pt, upperPoint: Pt, lowerPoint: Pt) {
  const upperDx = upperPoint.x - origin.x
  const upperDy = upperPoint.y - origin.y
  const lowerDx = lowerPoint.x - origin.x
  const lowerDy = lowerPoint.y - origin.y
  const upperDistance = Math.hypot(upperDx, upperDy)
  const lowerDistance = Math.hypot(lowerDx, lowerDy)
  const radius = Math.max(upperDistance, lowerDistance)
  if (radius < 1) return null

  const upperAngle = Math.atan2(upperDy, upperDx)
  const lowerAngle = Math.atan2(lowerDy, lowerDx)
  const delta = normalizeProjectionAngleDeltaForHit(lowerAngle - upperAngle)
  const anticlockwise = delta < 0

  return {
    upper: {
      x: origin.x + Math.cos(upperAngle) * radius,
      y: origin.y + Math.sin(upperAngle) * radius,
    },
    lower: {
      x: origin.x + Math.cos(lowerAngle) * radius,
      y: origin.y + Math.sin(lowerAngle) * radius,
    },
    radius,
    startAngle: upperAngle,
    endAngle: lowerAngle,
    anticlockwise,
  }
}

function normalizeProjectionAngleDeltaForHit(delta: number) {
  while (delta <= -Math.PI) delta += Math.PI * 2
  while (delta > Math.PI) delta -= Math.PI * 2
  return delta
}

function getQuadraticArcControlForHit(start: Pt, end: Pt, midpoint: Pt) {
  return {
    x: 2 * midpoint.x - (start.x + end.x) / 2,
    y: 2 * midpoint.y - (start.y + end.y) / 2,
  }
}

function approximateQuadraticArcSegments(
  start: Pt,
  end: Pt,
  midpoint: Pt,
  steps = 64,
): (readonly [Pt, Pt])[] {
  const control = getQuadraticArcControlForHit(start, end, midpoint)
  const pointAt = (t: number): Pt => {
    const inv = 1 - t
    return {
      x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
      y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
    }
  }
  const segments: (readonly [Pt, Pt])[] = []
  let prev = pointAt(0)
  for (let i = 1; i <= steps; i++) {
    const next = pointAt(i / steps)
    segments.push([prev, next] as const)
    prev = next
  }
  return segments
}

function getCubicThroughFourPointControlsForHit(p0: Pt, p1: Pt, p2: Pt, p3: Pt) {
  return {
    c1: {
      x: (-5 * p0.x + 18 * p1.x - 9 * p2.x + 2 * p3.x) / 6,
      y: (-5 * p0.y + 18 * p1.y - 9 * p2.y + 2 * p3.y) / 6,
    },
    c2: {
      x: (2 * p0.x - 9 * p1.x + 18 * p2.x - 5 * p3.x) / 6,
      y: (2 * p0.y - 9 * p1.y + 18 * p2.y - 5 * p3.y) / 6,
    },
  }
}

function approximateCubicThroughFourPointSegments(
  p0: Pt,
  p1: Pt,
  p2: Pt,
  p3: Pt,
  steps = 96,
): (readonly [Pt, Pt])[] {
  const { c1, c2 } = getCubicThroughFourPointControlsForHit(p0, p1, p2, p3)
  const pointAt = (t: number): Pt => {
    const inv = 1 - t
    return {
      x: inv * inv * inv * p0.x + 3 * inv * inv * t * c1.x + 3 * inv * t * t * c2.x + t * t * t * p3.x,
      y: inv * inv * inv * p0.y + 3 * inv * inv * t * c1.y + 3 * inv * t * t * c2.y + t * t * t * p3.y,
    }
  }
  const segments: (readonly [Pt, Pt])[] = []
  let prev = pointAt(0)
  for (let i = 1; i <= steps; i++) {
    const next = pointAt(i / steps)
    segments.push([prev, next] as const)
    prev = next
  }
  return segments
}

function hsCross(a: Pt, b: Pt) {
  return a.x * b.y - a.y * b.x
}

type TrianglePatternGeometryForHit = {
  apex: Pt | null
  lowerBase: Pt
  upperBase: Pt
  polygon: Pt[]
  isFallback: boolean
}

function pointOnLineAtXForHit(
  a: Pt,
  b: Pt,
  x: number,
  fallbackFrom: Pt,
): Pt {
  const dx = b.x - a.x

  if (Math.abs(dx) < 0.000001) {
    return distSqForHit(a, fallbackFrom) >= distSqForHit(b, fallbackFrom)
      ? a
      : b
  }

  const t = (x - a.x) / dx

  return {
    x,
    y: a.y + (b.y - a.y) * t,
  }
}

function getTriangleBaseXForHit(apex: Pt, points: Pt[]) {
  let selected = points[0]
  let maxDx = Math.abs(points[0].x - apex.x)

  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i].x - apex.x)

    if (dx > maxDx) {
      maxDx = dx
      selected = points[i]
    }
  }

  return selected.x
}

function getTrianglePatternGeometryForHit(
  a: Pt,
  b: Pt,
  c: Pt,
  d: Pt,
): TrianglePatternGeometryForHit {
  const apex = intersectInfiniteLines(a, c, b, d)

  if (!apex) {
    return {
      apex: null,
      lowerBase: a,
      upperBase: b,
      polygon: [a, b, d, c],
      isFallback: true,
    }
  }

  const baseX = getTriangleBaseXForHit(apex, [a, b, c, d])

  const lowerBase = pointOnLineAtXForHit(a, c, baseX, apex)
  const upperBase = pointOnLineAtXForHit(b, d, baseX, apex)

  return {
    apex,
    lowerBase,
    upperBase,
    polygon: [lowerBase, upperBase, apex],
    isFallback: false,
  }
}

function intersectInfiniteLines(
  a1: Pt,
  a2: Pt,
  b1: Pt,
  b2: Pt,
): Pt | null {
  const r = {
    x: a2.x - a1.x,
    y: a2.y - a1.y,
  }

  const s = {
    x: b2.x - b1.x,
    y: b2.y - b1.y,
  }

  const denom = r.x * s.y - r.y * s.x
  if (Math.abs(denom) < 0.000001) return null

  const qp = {
    x: b1.x - a1.x,
    y: b1.y - a1.y,
  }

  const t = (qp.x * s.y - qp.y * s.x) / denom

  return {
    x: a1.x + r.x * t,
    y: a1.y + r.y * t,
  }
}

function intersectInfiniteLineWithSegment(
  lineA: Pt,
  lineB: Pt,
  segA: Pt,
  segB: Pt,
) {
  const r = {
    x: lineB.x - lineA.x,
    y: lineB.y - lineA.y,
  }

  const s = {
    x: segB.x - segA.x,
    y: segB.y - segA.y,
  }

  const denom = hsCross(r, s)
  if (Math.abs(denom) < 0.000001) return null

  const qp = {
    x: segA.x - lineA.x,
    y: segA.y - lineA.y,
  }

  const t = hsCross(qp, s) / denom
  const u = hsCross(qp, r) / denom

  if (u < 0 || u > 1) return null

  return {
    point: {
      x: lineA.x + r.x * t,
      y: lineA.y + r.y * t,
    },
    t,
    u,
  }
}

function distSqForHit(a: Pt, b: Pt) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}



function getTriangleFillHitSegments(
  polygon: Pt[],
  step = 8,
): (readonly [Pt, Pt])[] {
  if (polygon.length < 3) return []

  const segments: (readonly [Pt, Pt])[] = []

  const minY = Math.floor(Math.min(...polygon.map(p => p.y)))
  const maxY = Math.ceil(Math.max(...polygon.map(p => p.y)))

  for (let y = minY; y <= maxY; y += step) {
    const xs: number[] = []

    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i]
      const p2 = polygon[(i + 1) % polygon.length]

      const yMin = Math.min(p1.y, p2.y)
      const yMax = Math.max(p1.y, p2.y)

      if (Math.abs(p2.y - p1.y) < 0.000001) continue
      if (y < yMin || y >= yMax) continue

      const t = (y - p1.y) / (p2.y - p1.y)
      const x = p1.x + (p2.x - p1.x) * t

      xs.push(x)
    }

    xs.sort((a, b) => a - b)

    for (let i = 0; i + 1 < xs.length; i += 2) {
      segments.push([
        { x: xs[i], y },
        { x: xs[i + 1], y },
      ] as const)
    }
  }

  return segments
}

function getRotatedRectangleGeometryForHit(points: Pt[]) {
  if (points.length < 2) return null
  const [leftCenter, rightCenter] = points
  const widthPoint = points[2]
  const dx = rightCenter.x - leftCenter.x
  const dy = rightCenter.y - leftCenter.y
  const len = Math.hypot(dx, dy)
  if (len < 0.001) return null
  const nx = -dy / len
  const ny = dx / len
  const fallbackHalfLength = Math.max(3, Math.min(8, len * 0.08))
  const signedHalfLength = widthPoint
    ? (widthPoint.x - leftCenter.x) * nx + (widthPoint.y - leftCenter.y) * ny
    : fallbackHalfLength
  const halfLength = Math.abs(signedHalfLength) < 1 ? (signedHalfLength < 0 ? -1 : 1) : signedHalfLength
  return {
    leftCenter,
    rightCenter,
    a: { x: leftCenter.x + nx * halfLength, y: leftCenter.y + ny * halfLength },
    b: { x: rightCenter.x + nx * halfLength, y: rightCenter.y + ny * halfLength },
    c: { x: rightCenter.x - nx * halfLength, y: rightCenter.y - ny * halfLength },
    d: { x: leftCenter.x - nx * halfLength, y: leftCenter.y - ny * halfLength },
  }
}

function getExtendedHsNecklineForHit(
  n1: Pt,
  n2: Pt,
  leftLineA?: Pt,
  leftLineB?: Pt,
  rightLineA?: Pt,
  rightLineB?: Pt,
) {
  const dx = n2.x - n1.x
  const dy = n2.y - n1.y
  const len = Math.hypot(dx, dy)

  if (len < 0.001) {
    return {
      start: n1,
      end: n2,
    }
  }

  const ux = dx / len
  const uy = dy / len
  const far = 100000

  let start: Pt = {
    x: n1.x - ux * far,
    y: n1.y - uy * far,
  }

  let end: Pt = {
    x: n2.x + ux * far,
    y: n2.y + uy * far,
  }

  if (leftLineA && leftLineB) {
    const leftHit = intersectInfiniteLineWithSegment(
      n1,
      n2,
      leftLineA,
      leftLineB,
    )

    if (leftHit && leftHit.t <= 0) {
      start = leftHit.point
    }
  }

  if (rightLineA && rightLineB) {
    const rightHit = intersectInfiniteLineWithSegment(
      n1,
      n2,
      rightLineA,
      rightLineB,
    )

    if (rightHit && rightHit.t >= 1) {
      end = rightHit.point
    }
  }

  return { start, end }
}

function getWedgeArcSpecForHit(
  center: Pt,
  a: Pt,
  b: Pt,
) {
  const startAngle = Math.atan2(a.y - center.y, a.x - center.x)
  const endAngle = Math.atan2(b.y - center.y, b.x - center.x)

  let delta = endAngle - startAngle

  while (delta <= -Math.PI) delta += Math.PI * 2
  while (delta > Math.PI) delta -= Math.PI * 2

  return {
    startAngle,
    endAngle,
    anticlockwise: delta < 0,
    delta,
    midAngle: startAngle + delta / 2,
  }
}

function getGannSquareFixedOuterFromControlForHit(
  origin: Pt,
  control: Pt,
) {
  const dx = control.x - origin.x
  const dy = control.y - origin.y

  const controlLevel = 0.25
  const controlRadius = Math.hypot(dx, dy)

  if (controlRadius < 0.001) return control

  const side = controlRadius / controlLevel
  const signX = dx >= 0 ? 1 : -1
  const signY = dy >= 0 ? 1 : -1

  return {
    x: origin.x + signX * side,
    y: origin.y + signY * side,
  }
}

function approximateEllipseArcSegments(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number,
  steps = 48,
): (readonly [Pt, Pt])[] {
  const segments: (readonly [Pt, Pt])[] = []

  let prev: Pt = {
    x: cx + Math.cos(startAngle) * rx,
    y: cy + Math.sin(startAngle) * ry,
  }

  for (let i = 1; i <= steps; i++) {
    const t = startAngle + ((endAngle - startAngle) * i) / steps

    const next: Pt = {
      x: cx + Math.cos(t) * rx,
      y: cy + Math.sin(t) * ry,
    }

    segments.push([prev, next] as const)
    prev = next
  }

  return segments
}

function getQuarterArcAnglesForHit(signX: number, signY: number) {
  if (signX >= 0 && signY <= 0) {
    return { startAngle: -Math.PI / 2, endAngle: 0 }
  }

  if (signX >= 0 && signY >= 0) {
    return { startAngle: 0, endAngle: Math.PI / 2 }
  }

  if (signX <= 0 && signY >= 0) {
    return { startAngle: Math.PI / 2, endAngle: Math.PI }
  }

  return { startAngle: Math.PI, endAngle: Math.PI * 1.5 }
}

function approximateArcSegmentsDirectional(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  anticlockwise: boolean,
  steps = 48,
): (readonly [Pt, Pt])[] {
  const segments: (readonly [Pt, Pt])[] = []

  let delta = endAngle - startAngle

  if (!anticlockwise && delta < 0) delta += Math.PI * 2
  if (anticlockwise && delta > 0) delta -= Math.PI * 2

  let prev: Pt = {
    x: cx + Math.cos(startAngle) * r,
    y: cy + Math.sin(startAngle) * r,
  }

  for (let i = 1; i <= steps; i++) {
    const t = startAngle + (delta * i) / steps

    const next: Pt = {
      x: cx + Math.cos(t) * r,
      y: cy + Math.sin(t) * r,
    }

    segments.push([prev, next] as const)
    prev = next
  }

  return segments
}

function approximateFibSpiralSegments(
  center: Pt,
  guidePoint: Pt,
  canvas: { width: number; height: number },
): (readonly [Pt, Pt])[] {
  const dx = guidePoint.x - center.x
  const dy = guidePoint.y - center.y
  const guideRadius = Math.hypot(dx, dy)

  if (guideRadius < 0.001) return []

  const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2
  const guideAngle = Math.atan2(dy, dx)
  const turnToGuide = Math.PI * 2
  const a = guideRadius / Math.pow(GOLDEN_RATIO, turnToGuide / (Math.PI / 2))
  const clockwise = true
  const totalAngle = Math.PI * 2 * 2.6
  const steps = 420

  const pts: Pt[] = []

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * totalAngle
    const theta = clockwise ? -t : t
    const radius = a * Math.pow(GOLDEN_RATIO, t / (Math.PI / 2))
    const angle = guideAngle + theta

    const x = center.x + Math.cos(angle) * radius
    const y = center.y + Math.sin(angle) * radius

    pts.push({ x, y })

    if (
      x < -canvas.width * 0.5 ||
      x > canvas.width * 1.5 ||
      y < -canvas.height * 0.5 ||
      y > canvas.height * 1.5
    ) {
      break
    }
  }

  const segments: (readonly [Pt, Pt])[] = []
  for (let i = 1; i < pts.length; i++) {
    segments.push([pts[i - 1], pts[i]] as const)
  }

  return segments
}

function approximateEllipseSegments(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotation = 0,
  steps = 72,
): (readonly [Pt, Pt])[] {
  const segments: (readonly [Pt, Pt])[] = []
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const pointAt = (angle: number): Pt => {
    const x = Math.cos(angle) * rx
    const y = Math.sin(angle) * ry
    return {
      x: cx + x * cos - y * sin,
      y: cy + x * sin + y * cos,
    }
  }

  let prev = pointAt(0)

  for (let i = 1; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    const next = pointAt(angle)

    segments.push([prev, next] as const)
    prev = next
  }

  return segments
}

function getFibArcAnglesForHit(p0: Pt, p1: Pt) {
  const upward = p1.y <= p0.y

  if (upward) {
    return {
      startAngle: Math.PI,
      endAngle: 2 * Math.PI,
    }
  }

  return {
    startAngle: 0,
    endAngle: Math.PI,
  }
}

function getDisjointGeometry(pixels: Pt[]) {
  const [start, end, storedInverseStart] = pixels
  const inverseStart = { x: end.x, y: storedInverseStart.y }
  const inverseEnd = getDisjointInverseEnd(start, end, inverseStart)

  return { start, end, inverseStart, inverseEnd }
}

function getPositionGeometryForHit(pixels: Pt[], side: 'long' | 'short') {
  const entry = pixels[0]
  const target = pixels[1] ?? {
    x: entry.x + 120,
    y: entry.y + (side === 'long' ? -64 : 64),
  }
  const stop = pixels[2] ?? {
    x: target.x,
    y: entry.y + (side === 'long' ? 64 : -64),
  }
  const right = Math.max(entry.x + 12, target.x, stop.x)
  const left = Math.min(entry.x, right - 12)
  const centerX = (left + right) / 2

  return {
    entry,
    target,
    stop,
    left,
    right,
    centerX,
  }
}

function getRegressionTrendSegmentsForHit(
  drawing: Drawing,
  fallbackPixels: Pt[],
  context?: HitContext,
): readonly (readonly [Pt, Pt])[] {
  const chart = context?.chart
  const candleSeries = context?.candleSeries
  const candles = context?.candles ?? []
  if (drawing.points.length < 2 || fallbackPixels.length < 2 || candles.length < 2 || !chart || !candleSeries) {
    return fallbackPixels.length >= 2 ? [[fallbackPixels[0], fallbackPixels[1]]] : []
  }

  const startIndex = getCandleIndexForDrawingPoint(drawing.points[0], candles)
  const endIndex = getCandleIndexForDrawingPoint(drawing.points[1], candles)
  if (startIndex === null || endIndex === null) return [[fallbackPixels[0], fallbackPixels[1]]]

  const from = Math.max(0, Math.min(candles.length - 1, Math.min(startIndex, endIndex)))
  const to = Math.max(0, Math.min(candles.length - 1, Math.max(startIndex, endIndex)))
  const count = to - from + 1
  if (count < 2) return [[fallbackPixels[0], fallbackPixels[1]]]

  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = from; i <= to; i += 1) {
    const x = i
    const y = candles[i].close
    sumX += x
    sumY += y
    sumXY += x * y
    sumXX += x * x
  }

  const denominator = count * sumXX - sumX * sumX
  if (Math.abs(denominator) < 0.000001) return [[fallbackPixels[0], fallbackPixels[1]]]

  const slope = (count * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / count
  let residualSum = 0
  for (let i = from; i <= to; i += 1) {
    const base = slope * i + intercept
    const residual = candles[i].close - base
    residualSum += residual * residual
  }

  const channelDeviation = Math.sqrt(residualSum / count) * REGRESSION_DEVIATION_MULTIPLIER
  const leftIndex = startIndex <= endIndex ? from : to
  const rightIndex = startIndex <= endIndex ? to : from
  const leftBase = slope * leftIndex + intercept
  const rightBase = slope * rightIndex + intercept
  const leftX = candleTimeToX(chart, candles[leftIndex])
  const rightX = candleTimeToX(chart, candles[rightIndex])
  const leftY = candleSeries.priceToCoordinate(leftBase)
  const rightY = candleSeries.priceToCoordinate(rightBase)
  const leftUpperY = candleSeries.priceToCoordinate(leftBase + channelDeviation)
  const rightUpperY = candleSeries.priceToCoordinate(rightBase + channelDeviation)
  const leftLowerY = candleSeries.priceToCoordinate(leftBase - channelDeviation)
  const rightLowerY = candleSeries.priceToCoordinate(rightBase - channelDeviation)

  if (
    leftX == null || rightX == null || leftY == null || rightY == null ||
    leftUpperY == null || rightUpperY == null || leftLowerY == null || rightLowerY == null
  ) {
    return [[fallbackPixels[0], fallbackPixels[1]]]
  }

  const centerStart = { x: leftX, y: leftY }
  const centerEnd = { x: rightX, y: rightY }
  const upperStart = { x: leftX, y: leftUpperY }
  const upperEnd = { x: rightX, y: rightUpperY }
  const lowerStart = { x: leftX, y: leftLowerY }
  const lowerEnd = { x: rightX, y: rightLowerY }

  return [
    [upperStart, upperEnd],
    [centerStart, centerEnd],
    [lowerStart, lowerEnd],
    [upperStart, lowerStart],
    [upperEnd, lowerEnd],
  ]
}

// ─────────────────────────────────────────────
// Hit segments
// ─────────────────────────────────────────────
export function getHitSegments(
  drawing: Drawing,
  pixels: Pt[],
  canvas: { width: number; height: number },
  context?: HitContext,
): readonly (readonly [Pt, Pt])[] {
  if (TEXT_TOOLS.includes(drawing.tool as string) && pixels.length >= 1) {
    const textPoint = (drawing.tool === 'note' || drawing.tool === 'anchorednote') && pixels[1] ? pixels[1] : pixels[0]
    const rect = getTextHitRect(drawing, textPoint)
    const segments: (readonly [Pt, Pt])[] = [
      [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }],
      [{ x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }],
      [{ x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }],
      [{ x: rect.x, y: rect.y + rect.height }, { x: rect.x, y: rect.y }],
    ]
    if (drawing.tool === 'callout') {
      segments.push([pixels[0], { x: rect.x, y: rect.y + rect.height / 2 }])
    } else if (drawing.tool === 'signpost') {
      const attachY = pixels[0].y >= rect.y + rect.height / 2 ? rect.y + rect.height : rect.y
      segments.push([pixels[0], { x: pixels[0].x, y: attachY }])
    }
    return segments
  }

  if (LOCKED_NODE_TOOLS.includes(drawing.tool as string) && pixels.length >= 1) {
    const p = pixels[0]
    return [
      [{ x: p.x - 18, y: p.y }, { x: p.x + 18, y: p.y }],
      [{ x: p.x, y: p.y - 18 }, { x: p.x, y: p.y + 18 }],
    ]
  }

  if ((drawing.tool === 'longposition' || drawing.tool === 'shortposition') && pixels.length >= 1) {
    const { entry, target, stop, left, right } = getPositionGeometryForHit(
      pixels,
      drawing.tool === 'longposition' ? 'long' : 'short',
    )

    return [
      [{ x: left, y: target.y }, { x: right, y: target.y }],
      [{ x: left, y: entry.y }, { x: right, y: entry.y }],
      [{ x: left, y: stop.y }, { x: right, y: stop.y }],
      [{ x: left, y: target.y }, { x: left, y: stop.y }],
      [{ x: right, y: target.y }, { x: right, y: stop.y }],
    ]
  }

  if (drawing.tool === 'horizontal' && pixels.length >= 1) {
    return [[{ x: 0, y: pixels[0].y }, { x: canvas.width, y: pixels[0].y }]]
  }

  if (drawing.tool === 'horizontalray' && pixels.length >= 1) {
    return [[pixels[0], { x: canvas.width, y: pixels[0].y }]]
  }

  if (drawing.tool === 'regressiontrend') {
    return getRegressionTrendSegmentsForHit(drawing, pixels, context)
  }

  if (drawing.tool === 'vertical' && pixels.length >= 1) {
    return [[{ x: pixels[0].x, y: 0 }, { x: pixels[0].x, y: canvas.height }]]
  }

  if (drawing.tool === 'circle' && pixels.length >= 2) {
    const [center, radiusPoint] = pixels
    const radius = Math.hypot(radiusPoint.x - center.x, radiusPoint.y - center.y)
    if (radius < 1) return []
    return approximateArcSegments(center.x, center.y, radius, 0, Math.PI * 2, 96)
  }

  if (drawing.tool === 'arc' && pixels.length >= 2) {
    if (pixels.length < 3) return [[pixels[0], pixels[1]]]
    return approximateQuadraticArcSegments(pixels[0], pixels[1], pixels[2], 96)
  }

  if (drawing.tool === 'curve' && pixels.length >= 3) {
    return approximateQuadraticArcSegments(pixels[0], pixels[1], pixels[2], 96)
  }

  if (drawing.tool === 'doublecurve' && pixels.length >= 4) {
    return approximateCubicThroughFourPointSegments(pixels[0], pixels[1], pixels[2], pixels[3], 120)
  }

  if (drawing.tool === 'ellipse' && pixels.length >= 2) {
    const [start, end, control] = pixels
    const dx = end.x - start.x
    const dy = end.y - start.y
    const majorLength = Math.hypot(dx, dy)
    if (majorLength < 0.001) return []

    const cx = (start.x + end.x) / 2
    const cy = (start.y + end.y) / 2
    const rx = majorLength / 2
    const nx = -dy / majorLength
    const ny = dx / majorLength
    const ry = control
      ? Math.max(1, Math.abs((control.x - cx) * nx + (control.y - cy) * ny))
      : Math.max(8, majorLength * 0.12)

    return approximateEllipseSegments(cx, cy, rx, ry, Math.atan2(dy, dx), 96)
  }

  // ── Extended line: extend in both directions ──
  if (drawing.tool === 'extendedline' && pixels.length >= 2) {
    const [left, right] = extendSegmentToCanvas(pixels[0], pixels[1], canvas)
    return [[left, right]]
  }

  // ── Ray: from point[0] toward point[1] and beyond ──
  if (drawing.tool === 'ray' && pixels.length >= 2) {
    const far = extendRayToCanvas(pixels[0], pixels[1], canvas)
    return [[pixels[0], far]]
  }

  // ── Infoline: extend in both directions (same as extendedline) ──
  if (drawing.tool === 'infoline' && pixels.length >= 2) {
    const [left, right] = extendSegmentToCanvas(pixels[0], pixels[1], canvas)
    return [[left, right]]
  }

  if (drawing.tool === 'headandshoulders' && pixels.length >= 2) {
    const segments: (readonly [Pt, Pt])[] = []
    const [l0, ls, n1, h, n2, rs, r0] = pixels

    if (pixels.length >= 2) segments.push([l0, ls])
    if (pixels.length >= 3) segments.push([ls, n1])
    if (pixels.length >= 4) segments.push([n1, h])
    if (pixels.length >= 5) segments.push([h, n2])
    if (pixels.length >= 6) segments.push([n2, rs])
    if (pixels.length >= 7) segments.push([rs, r0])

    if (pixels.length >= 5) {
      const { start, end } = getExtendedHsNecklineForHit(
        n1,
        n2,
        l0,
        ls,
        pixels.length >= 7 ? rs : undefined,
        pixels.length >= 7 ? r0 : undefined,
      )

      segments.push([start, end] as const)
    }

    return segments
  }

  if (drawing.tool === 'cypherpattern' && pixels.length >= 2) {
    const segments: (readonly [Pt, Pt])[] = []
    const [x, a, b, c, d] = pixels

    // main solid legs
    if (pixels.length >= 2) segments.push([x, a])
    if (pixels.length >= 3) segments.push([a, b], [x, b])
    if (pixels.length >= 4) segments.push([b, c], [a, c], [x, c])
    if (pixels.length >= 5) segments.push([c, d], [x, d], [b, d])

    return segments
  }

  if (drawing.tool === 'fibcircles' && pixels.length >= 2) {
    const [p0, p1] = pixels

    const cx = (p0.x + p1.x) / 2
    const cy = (p0.y + p1.y) / 2
    const baseRx = Math.abs(p1.x - p0.x) / 2
    const baseRy = Math.abs(p1.y - p0.y) / 2

    if (baseRx < 0.001 || baseRy < 0.001) {
      return [[p0, p1]]
    }

    const segments: (readonly [Pt, Pt])[] = []

    FIB_LEVELS.forEach(level => {
      if (level <= 0) return
      const rx = baseRx * level
      const ry = baseRy * level
      segments.push(...approximateEllipseSegments(cx, cy, rx, ry))
    })

    // dashed guide line
    segments.push([p0, p1])

    return segments
  }

  if (drawing.tool === 'barspattern' && pixels.length >= 2) {
    if (pixels.length > 2) {
      const segments: (readonly [Pt, Pt])[] = []
      for (let i = 2; i + 1 < pixels.length; i += 2) {
        segments.push([pixels[i], pixels[i + 1]] as const)
      }
      return segments
    }
    return [[pixels[0], pixels[1]]]
  }

  if (drawing.tool === 'fixedrangevolumeprofile' && pixels.length >= 2) {
    const left = Math.min(pixels[0].x, pixels[1].x)
    const right = Math.max(pixels[0].x, pixels[1].x)
    const top = Math.min(pixels[0].y, pixels[1].y)
    const bottom = Math.max(pixels[0].y, pixels[1].y)
    return [
      [{ x: left, y: top }, { x: right, y: top }],
      [{ x: right, y: top }, { x: right, y: bottom }],
      [{ x: right, y: bottom }, { x: left, y: bottom }],
      [{ x: left, y: bottom }, { x: left, y: top }],
      [{ x: left, y: (top + bottom) / 2 }, { x: right, y: (top + bottom) / 2 }],
    ]
  }

  if ((drawing.tool === 'pricerange' || drawing.tool === 'daterange' || drawing.tool === 'dateandpricerange') && pixels.length >= 2) {
    const left = Math.min(pixels[0].x, pixels[1].x)
    const right = Math.max(pixels[0].x, pixels[1].x)
    const top = Math.min(pixels[0].y, pixels[1].y)
    const bottom = Math.max(pixels[0].y, pixels[1].y)
    const midX = (left + right) / 2
    const midY = (top + bottom) / 2

    if (drawing.tool === 'pricerange') {
      return [
        [{ x: left, y: top }, { x: right, y: top }],
        [{ x: left, y: bottom }, { x: right, y: bottom }],
        [{ x: midX, y: top }, { x: midX, y: bottom }],
      ]
    }

    if (drawing.tool === 'dateandpricerange') {
      return [
        [{ x: left, y: midY }, { x: right, y: midY }],
        [{ x: midX, y: top }, { x: midX, y: bottom }],
        [{ x: left, y: top }, { x: right, y: top }],
        [{ x: right, y: top }, { x: right, y: bottom }],
        [{ x: right, y: bottom }, { x: left, y: bottom }],
        [{ x: left, y: bottom }, { x: left, y: top }],
      ]
    }

    return [
      [{ x: left, y: top }, { x: left, y: bottom }],
      [{ x: right, y: top }, { x: right, y: bottom }],
      [{ x: left, y: midY }, { x: right, y: midY }],
    ]
  }

  if (drawing.tool === 'xabcdpattern' && pixels.length >= 2) {
    const segments: (readonly [Pt, Pt])[] = []
    const [x, a, b, c, d] = pixels

    // solid edges
    if (pixels.length >= 2) segments.push([x, a])
    if (pixels.length >= 3) segments.push([a, b], [x, b])
    if (pixels.length >= 4) segments.push([b, c], [a, c])
    if (pixels.length >= 5) segments.push([c, d], [x, d], [b, d])

    return segments
  }

  if (drawing.tool === 'trianglepattern' && pixels.length >= 2) {
    const segments: (readonly [Pt, Pt])[] = []
    const [a, b, c, d] = pixels

    if (pixels.length >= 2) {
      segments.push([a, b])
    }

    if (pixels.length >= 3) {
      segments.push([b, c], [a, c])
    }

    if (pixels.length >= 4) {
      segments.push([c, d])

      const geometry = getTrianglePatternGeometryForHit(a, b, c, d)
      const { lowerBase, upperBase, apex, polygon, isFallback } = geometry

      if (!isFallback && apex) {
        segments.push(
          [lowerBase, upperBase] as const,
          [upperBase, apex] as const,
          [lowerBase, apex] as const,
        )
      } else {
        for (let i = 0; i < polygon.length; i++) {
          segments.push([
            polygon[i],
            polygon[(i + 1) % polygon.length],
          ] as const)
        }
      }

      segments.push(...getTriangleFillHitSegments(polygon, 8))
    }

    return segments
  }

  if (drawing.tool === 'threedrivespattern' && pixels.length >= 2) {
    const segments: (readonly [Pt, Pt])[] = []
    const p2 = pixels[1]
    const p4 = pixels[3]
    const p6 = pixels[5]

    // main zig-zag
    for (let i = 1; i < pixels.length; i++) {
      segments.push([pixels[i - 1], pixels[i]] as const)
    }

    // dotted guide 1: P2 -> P4
    if (pixels.length >= 4) {
      segments.push([p2, p4] as const)
    }

    // dotted guide 2: P4 -> P6
    if (pixels.length >= 6) {
      segments.push([p4, p6] as const)
    }

    return segments
  }

  if (drawing.tool === 'projection' && pixels.length >= 2) {
    if (pixels.length < 3) return [[pixels[0], pixels[1]]]

    const origin = pixels[0]
    const geometry = getProjectionSectorGeometryForHit(origin, pixels[1], pixels[2])
    if (!geometry) return []

    const { upper, lower, radius, startAngle, endAngle, anticlockwise } = geometry
    return [
      [origin, upper],
      [lower, origin],
      ...approximateCircularArcSegments(origin, radius, startAngle, endAngle, anticlockwise),
    ]
  }

  if (drawing.tool === 'cycliclines' && pixels.length >= 2) {
    const [p1, p2] = pixels
    const dx = p2.x - p1.x
    const step = Math.abs(dx)
    if (step < 1) return []

    const canvasWidth = canvas.width
    const canvasHeight = canvas.height

    const dir = dx >= 0 ? 1 : -1
    const segments: (readonly [Pt, Pt])[] = []

    if (dir > 0) {
      for (let x = p1.x; x <= canvasWidth + step; x += step) {
        segments.push([{ x, y: 0 }, { x, y: canvasHeight }] as const)
      }
    } else {
      for (let x = p1.x; x >= -step; x -= step) {
        segments.push([{ x, y: 0 }, { x, y: canvasHeight }] as const)
      }
    }

    segments.push([p1, p2] as const)

    return segments
  }

  if (drawing.tool === 'timecycles' && pixels.length >= 2) {
    const [p1, p2] = pixels

    // دو نود = دو سر اولین نیم‌دایره
    const diameter = Math.abs(p2.x - p1.x)
    if (diameter < 1) return []

    const radius = diameter / 2
    const baseY = p1.y

    const firstLeftX = Math.min(p1.x, p2.x)
    const firstCenterX = firstLeftX + radius

    const segments: (readonly [Pt, Pt])[] = []

    // از هر دو طرف viewport
    const startCenter =
      firstCenterX - Math.ceil(firstCenterX / diameter) * diameter - diameter

    const endCenter = canvas.width + diameter * 2

    for (let cx = startCenter; cx <= endCenter; cx += diameter) {
      const left = cx - radius
      const right = cx + radius

      // hit روی نیم‌دایره
      segments.push(
        ...approximateArcSegmentsDirectional(
          cx,
          baseY,
          radius,
          Math.PI,
          0,
          false,
          48,
        ),
      )

      // hit روی خط زیر/قطر نیم‌دایره
      // حتی اگر در renderer خط را نکشی، برای select شدن مفید است
      segments.push([
        { x: left, y: baseY },
        { x: right, y: baseY },
      ] as const)
    }

    // خود فاصله‌ی دو نود هم قابل hit باشد
    segments.push([p1, p2] as const)

    return segments
  }

  if (drawing.tool === 'sineline' && pixels.length >= 2) {
    const [p1, p2] = pixels

    const halfPeriod = Math.abs(p2.x - p1.x)
    if (halfPeriod < 1) return []

    const midY = (p1.y + p2.y) / 2
    const ampTerm = (p1.y - p2.y) / 2

    const segments: (readonly [Pt, Pt])[] = []

    let prev: Pt | null = null

    for (let x = 0; x <= canvas.width; x += 6) {
      const t = (x - p1.x) / halfPeriod
      const y = midY + ampTerm * Math.cos(Math.PI * t)

      const cur = { x, y }

      if (prev) {
        segments.push([prev, cur] as const)
      }

      prev = cur
    }

    return segments
  }

  if (drawing.tool === 'elliottimpulse' && pixels.length >= 2) {
    const segments: (readonly [Pt, Pt])[] = []

    for (let i = 1; i < pixels.length; i++) {
      segments.push([pixels[i - 1], pixels[i]] as const)
    }

    return segments
  }

  if (drawing.tool === 'abcdpattern' && pixels.length >= 2) {
    const segments: (readonly [Pt, Pt])[] = []
    const [a, b, c, d] = pixels

    if (pixels.length >= 2) segments.push([a, b])
    if (pixels.length >= 3) segments.push([b, c], [a, c])
    if (pixels.length >= 4) segments.push([c, d], [b, d])

    return segments
  }
  
  if (drawing.tool === 'pitchfan' && pixels.length >= 3) {
    const [origin, rayA, rayB] = pixels
    const levels = [0, 0.25, 0.5, 0.75, 1]

    const segments: (readonly [Pt, Pt])[] = []

    levels.forEach(level => {
      const target = {
        x: rayA.x + (rayB.x - rayA.x) * level,
        y: rayA.y + (rayB.y - rayA.y) * level,
      }

      const far = extendRayFar(origin, target)
      segments.push([origin, far] as const)
    })

    segments.push([rayA, rayB])

    return segments
  }

  if (drawing.tool === 'fibspiral' && pixels.length >= 2) {
    const center = pixels[0]
    const guidePoint = pixels[1]

    const segments: (readonly [Pt, Pt])[] = [
      ...approximateFibSpiralSegments(center, guidePoint, canvas),
    ]

    const guideFar = extendRayFar(center, guidePoint, 100000)
    segments.push([center, guideFar])

    return segments
  }

  if (drawing.tool === 'gannsquare' && pixels.length >= 2) {
    const origin = pixels[0]
    const opposite = pixels[1]

    const spanX = opposite.x - origin.x
    const spanY = opposite.y - origin.y

    if (Math.abs(spanX) < 0.001 || Math.abs(spanY) < 0.001) {
      return [[origin, opposite]]
    }

    const signX = spanX >= 0 ? 1 : -1
    const signY = spanY >= 0 ? 1 : -1

    const left = Math.min(origin.x, opposite.x)
    const right = Math.max(origin.x, opposite.x)
    const top = Math.min(origin.y, opposite.y)
    const bottom = Math.max(origin.y, opposite.y)

    const levels = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]
    const segments: (readonly [Pt, Pt])[] = []

    const xAt = (level: number) => origin.x + spanX * level
    const yAt = (level: number) => origin.y + spanY * level

    // grid vertical
    levels.forEach(level => {
      const x = xAt(level)
      segments.push([{ x, y: top }, { x, y: bottom }] as const)
    })

    // grid horizontal
    levels.forEach(level => {
      const y = yAt(level)
      segments.push([{ x: left, y }, { x: right, y }] as const)
    })

    // border
    segments.push(
      [{ x: left, y: top }, { x: right, y: top }] as const,
      [{ x: right, y: top }, { x: right, y: bottom }] as const,
      [{ x: right, y: bottom }, { x: left, y: bottom }] as const,
      [{ x: left, y: bottom }, { x: left, y: top }] as const,
    )

    // angle lines
    const targets = [
      { x: xAt(0.25), y: yAt(1) },
      { x: xAt(0.5), y: yAt(1) },
      { x: xAt(1), y: yAt(1) },
      { x: xAt(1), y: yAt(0.5) },
    ]

    targets.forEach(t => {
      segments.push([origin, t] as const)
    })

    // quarter arcs
    const { startAngle, endAngle } = getQuarterArcAnglesForHit(signX, signY)

    levels.forEach(level => {
      if (level <= 0) return

      const rx = Math.abs(spanX) * level
      const ry = Math.abs(spanY) * level

      segments.push(
        ...approximateEllipseArcSegments(
          origin.x,
          origin.y,
          rx,
          ry,
          startAngle,
          endAngle,
        ),
      )
    })

    return segments
  }

  if (drawing.tool === 'gannsquarefixed' && pixels.length >= 2) {
    const origin = pixels[0]
    const control = pixels[1]
    const outer = pixels[2] ?? getGannSquareFixedOuterFromControlForHit(origin, control)

    const spanX = outer.x - origin.x
    const spanY = outer.y - origin.y

    if (Math.abs(spanX) < 0.001 || Math.abs(spanY) < 0.001) {
      return [[origin, control]]
    }

    const signX = spanX >= 0 ? 1 : -1
    const signY = spanY >= 0 ? 1 : -1

    const left = Math.min(origin.x, outer.x)
    const right = Math.max(origin.x, outer.x)
    const top = Math.min(origin.y, outer.y)
    const bottom = Math.max(origin.y, outer.y)

    const levels = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]
    const segments: (readonly [Pt, Pt])[] = []

    const xAt = (level: number) => origin.x + spanX * level
    const yAt = (level: number) => origin.y + spanY * level

    // grid vertical
    levels.forEach(level => {
      const x = xAt(level)
      segments.push([{ x, y: top }, { x, y: bottom }] as const)
    })

    // grid horizontal
    levels.forEach(level => {
      const y = yAt(level)
      segments.push([{ x: left, y }, { x: right, y }] as const)
    })

    // border
    segments.push(
      [{ x: left, y: top }, { x: right, y: top }] as const,
      [{ x: right, y: top }, { x: right, y: bottom }] as const,
      [{ x: right, y: bottom }, { x: left, y: bottom }] as const,
      [{ x: left, y: bottom }, { x: left, y: top }] as const,
    )

    // angle lines
    const targets = [
      { x: xAt(0.25), y: yAt(1) },
      { x: xAt(0.5), y: yAt(1) },
      { x: xAt(1), y: yAt(1) },
      { x: xAt(1), y: yAt(0.5) },
    ]

    targets.forEach(t => {
      segments.push([origin, t] as const)
    })

    // ellipse arcs
    const { startAngle, endAngle } = getQuarterArcAnglesForHit(signX, signY)

    levels.forEach(level => {
      if (level <= 0) return

      const rx = Math.abs(spanX) * level
      const ry = Math.abs(spanY) * level

      segments.push(
        ...approximateEllipseArcSegments(
          origin.x,
          origin.y,
          rx,
          ry,
          startAngle,
          endAngle,
        ),
      )
    })

    return segments
  }

  if (drawing.tool === 'gannbox' && pixels.length >= 2) {
    const [a, b] = pixels

    const left = Math.min(a.x, b.x)
    const right = Math.max(a.x, b.x)
    const top = Math.min(a.y, b.y)
    const bottom = Math.max(a.y, b.y)
    const width = right - left
    const height = bottom - top

    const levels = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]
    const segments: (readonly [Pt, Pt])[] = []

    const xAt = (level: number) => left + width * level
    const yAt = (level: number) => bottom - height * level

    levels.forEach(level => {
      const x = xAt(level)
      segments.push([{ x, y: top }, { x, y: bottom }] as const)
    })

    levels.forEach(level => {
      const y = yAt(level)
      segments.push([{ x: left, y }, { x: right, y }] as const)
    })

    return segments
  }

  // ── Fibonacci: horizontal lines at each fib level between the two anchors ──
  if (drawing.tool === 'fibonacci' && pixels.length >= 2) {
    const [p0, p1] = pixels
    const lineLeft  = Math.min(p0.x, p1.x)
    const lineRight = Math.max(p0.x, p1.x)

    const segments: (readonly [Pt, Pt])[] = FIB_LEVELS.map(level => {
      const y = p0.y + (p1.y - p0.y) * level
      return [
        { x: lineLeft, y },
        { x: lineRight, y },
      ] as const
    })

    // خط اصلی/راهنما بین دو anchor هم قابل select باشد
    segments.push([p0, p1])

    return segments
  }

  if (drawing.tool === 'fibwedge' && pixels.length >= 3) {
    const [center, rayA, rayB] = pixels

    const radiusA = Math.hypot(rayA.x - center.x, rayA.y - center.y)
    const radiusB = Math.hypot(rayB.x - center.x, rayB.y - center.y)
    const baseRadius = Math.max(radiusA, radiusB)

    if (baseRadius < 0.001) {
      return [[center, rayA]]
    }

    const angleA = Math.atan2(rayA.y - center.y, rayA.x - center.x)
    const angleB = Math.atan2(rayB.y - center.y, rayB.x - center.x)

    const rayAEnd = {
      x: center.x + Math.cos(angleA) * baseRadius,
      y: center.y + Math.sin(angleA) * baseRadius,
    }

    const rayBEnd = {
      x: center.x + Math.cos(angleB) * baseRadius,
      y: center.y + Math.sin(angleB) * baseRadius,
    }

    const { startAngle, endAngle, anticlockwise } =
      getWedgeArcSpecForHit(center, rayAEnd, rayBEnd)

    const levels = [0.236, 0.382, 0.5, 0.618, 0.786, 1]
    const segments: (readonly [Pt, Pt])[] = []

    levels.forEach(level => {
      const r = baseRadius * level

      segments.push(
        ...approximateArcSegmentsDirectional(
          center.x,
          center.y,
          r,
          startAngle,
          endAngle,
          anticlockwise,
        ),
      )
    })

    segments.push([center, rayAEnd], [center, rayBEnd])

    return segments
  }

  if (drawing.tool === 'fibchannel' && pixels.length >= 3) {
    const [p1, p2, p3] = pixels
    const offX = p3.x - p1.x
    const offY = p3.y - p1.y

    const segments: (readonly [Pt, Pt])[] = FIB_LEVELS.map(level => {
      return [
        { x: p1.x + offX * level, y: p1.y + offY * level },
        { x: p2.x + offX * level, y: p2.y + offY * level },
      ] as const
    })

    const topStart = { x: p1.x + offX, y: p1.y + offY }
    const topEnd   = { x: p2.x + offX, y: p2.y + offY }

    segments.push([p1, p2], [p1, topStart], [p2, topEnd])

    return segments
  }

  if (drawing.tool === 'fibspeedresistancearcs' && pixels.length >= 2) {
    const [p0, p1] = pixels
    const dx = p1.x - p0.x
    const dy = p1.y - p0.y
    const baseRadius = Math.hypot(dx, dy)

    if (baseRadius < 0.001) {
      return [[p0, p1]]
    }

    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236, 4.618]
    const { startAngle, endAngle } = getFibArcAnglesForHit(p0, p1)
    const segments: (readonly [Pt, Pt])[] = []

    levels.forEach(level => {
      if (level <= 0) return
      const r = baseRadius * level
      segments.push(...approximateArcSegments(p0.x, p0.y, r, startAngle, endAngle))
    })

    segments.push([p0, p1])

    return segments
  }

  if (drawing.tool === 'fibspeedresistancefan' && pixels.length >= 2) {
    const [p0, p1] = pixels
    const dx = p1.x - p0.x
    const dy = p1.y - p0.y

    if (Math.abs(dx) < 0.001 || Math.abs(dy) < 0.001) {
      return [[p0, p1]]
    }

    const xAtLevel = (level: number) => p0.x + dx * (1 - level)
    const yAtLevel = (level: number) => p0.y + dy * (1 - level)

    const topPointAtLevel = (level: number): Pt => ({
      x: xAtLevel(level),
      y: p1.y,
    })

    const rightPointAtLevel = (level: number): Pt => ({
      x: p1.x,
      y: yAtLevel(level),
    })

    const upperLevels = [1, 0.75, 0.618, 0.5, 0.382, 0.25, 0]
    const lowerLevels = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]

    const segments: (readonly [Pt, Pt])[] = []

    // finite guide grid / box هم قابل select باشد
    FIB_SPEED_LEVELS.forEach(level => {
      const x = xAtLevel(level)
      const y = yAtLevel(level)

      segments.push([
        { x, y: p0.y },
        { x, y: p1.y },
      ] as const)

      segments.push([
        { x: p0.x, y },
        { x: p1.x, y },
      ] as const)
    })

    // extended upper fan lines
    upperLevels.forEach(level => {
      const target = topPointAtLevel(level)
      const far = extendRayFar(p0, target)

      segments.push([
        p0,
        far,
      ] as const)
    })

    // extended lower/right fan lines
    lowerLevels.forEach(level => {
      const target = rightPointAtLevel(level)
      const far = extendRayFar(p0, target)

      segments.push([
        p0,
        far,
      ] as const)
    })

    // border / main diagonal / guide
    segments.push(
      [p0, p1],
      [p0, { x: p1.x, y: p0.y }],
      [{ x: p1.x, y: p0.y }, p1],
      [p1, { x: p0.x, y: p1.y }],
      [{ x: p0.x, y: p1.y }, p0],
    )

    return segments
  }

  function extendRayFar(
    from: Pt,
    through: Pt,
    distance = 100000,
  ): Pt {
    const dx = through.x - from.x
    const dy = through.y - from.y
    const len = Math.hypot(dx, dy)

    if (len < 0.001) return through

    return {
      x: from.x + (dx / len) * distance,
      y: from.y + (dy / len) * distance,
    }
  }

  if (PITCHFORK_TOOLS.includes(drawing.tool as string) && pixels.length >= 3) {
    const [a, b, c] = pixels
    const mid = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }
    const handle = extendRayToCanvas(a, mid, canvas)
    const handleB = extendRayToCanvas(b, { x: b.x + (mid.x - a.x), y: b.y + (mid.y - a.y) }, canvas)
    const handleC = extendRayToCanvas(c, { x: c.x + (mid.x - a.x), y: c.y + (mid.y - a.y) }, canvas)
    return [[a, handle], [b, handleB], [c, handleC], [b, c]]
  }

  if (drawing.tool === 'disjointchannel' && pixels.length >= 3) {
    const { start, end, inverseStart, inverseEnd } = getDisjointGeometry(pixels)

    return [
      [start, end],
      [inverseStart, inverseEnd], // خط دوم
      [start, inverseEnd],
      [end, inverseStart],
    ]
  }

  if (drawing.tool === 'trendbasedfibextension' && pixels.length >= 3) {
    const [p1, p2, p3] = pixels
    const leftX = Math.min(p2.x, p3.x)
    const rightX = Math.max(p2.x, p3.x)
    const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]

    const segments: (readonly [Pt, Pt])[] = FIB_LEVELS.map(level => {
      const y = p3.y + (p2.y - p1.y) * level
      return [{ x: leftX, y }, { x: rightX, y }] as const
    })

    // guide path
    segments.push([p1, p2], [p2, p3])

    return segments
  }

  if (drawing.tool === 'gannfan' && pixels.length >= 2) {
    const origin = pixels[0]
    const oneOne = pixels[1]

    const dx = oneOne.x - origin.x
    const dy = oneOne.y - origin.y

    const rays = [
      { factor: 8 },
      { factor: 4 },
      { factor: 3 },
      { factor: 2 },
      { factor: 1 },
      { factor: 0.5 },
      { factor: 1 / 3 },
      { factor: 0.25 },
      { factor: 0.125 },
    ]

    const segments: (readonly [Pt, Pt])[] = []

    rays.forEach(ray => {
      const target = {
        x: origin.x + dx,
        y: origin.y + dy * ray.factor,
      }

      const far = extendRayFar(origin, target)
      segments.push([origin, far] as const)
    })

    return segments
  }

  if (drawing.tool === 'trendbasedfibtime' && pixels.length >= 3) {
    const [p1, p2, p3] = pixels
    const baseDeltaX = p2.x - p1.x
    if (Math.abs(baseDeltaX) < 0.001) return [[p1, p2], [p2, p3]]

    const levels = [0, 0.382, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3]

    const segments: (readonly [Pt, Pt])[] = levels.map(level => {
      const x = p3.x + baseDeltaX * level
      return [{ x, y: 0 }, { x, y: canvas.height }] as const
    })

    // dashed guide path
    segments.push([p1, p2], [p2, p3])

    return segments
  }

  if (CHANNEL_TOOLS.includes(drawing.tool) && pixels.length >= 3) {
    const [a, b, c] = pixels
    const offsetY     = c.y - yOnSegmentLineAtX(a, b, c.x)
    const cStart      = { x: a.x, y: a.y + offsetY }
    const cEnd        = { x: b.x, y: b.y + offsetY }
    const middleStart = { x: a.x, y: a.y + offsetY / 2 }
    const middleEnd   = { x: b.x, y: b.y + offsetY / 2 }
    return [[a, b], [cStart, cEnd], [middleStart, middleEnd], [a, cStart], [b, cEnd]]
  }

  if (drawing.tool === 'flattopbottom' && pixels.length >= 3) {
    const [a, b, c] = pixels
    const hStart = { x: a.x, y: c.y }
    const hEnd   = { x: b.x, y: c.y }
    return [[a, b], [hStart, hEnd], [a, hStart], [b, hEnd]]
  }

  if (drawing.tool === 'rectangle' && pixels.length >= 2) {
    const [a, b]      = pixels
    const topLeft     = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }
    const topRight    = { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) }
    const bottomRight = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
    const bottomLeft  = { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) }
    return [[topLeft, topRight], [topRight, bottomRight], [bottomRight, bottomLeft], [bottomLeft, topLeft]]
  }

  if (drawing.tool === 'rotatedrectangle' && pixels.length >= 2) {
    const geometry = getRotatedRectangleGeometryForHit(pixels)
    if (!geometry) return pixels.length >= 2 ? [[pixels[0], pixels[1]]] : []
    const { a, b, c, d, leftCenter, rightCenter } = geometry
    return [[a, b], [b, c], [c, d], [d, a], [leftCenter, rightCenter]]
  }

  if (drawing.tool === 'triangle' && pixels.length >= 3) {
    return [[pixels[0], pixels[1]], [pixels[1], pixels[2]], [pixels[2], pixels[0]]]
  }

  if (drawing.tool === 'polyline' && pixels.length >= 2) {
    const segments = pixels.slice(0, -1).map((point, i) => [point, pixels[i + 1]] as const)
    const first = pixels[0]
    const last = pixels[pixels.length - 1]
    if (pixels.length >= 3 && Math.hypot(last.x - first.x, last.y - first.y) <= CLOSED_POLYLINE_DISTANCE_PX) {
      segments.push([last, first] as const)
    }
    return segments
  }

  return pixels.slice(0, -1).map((point, i) => [point, pixels[i + 1]] as const)
}

function getTextHitRect(drawing: Drawing, point: Pt) {
  const offset = drawing.tool === 'comment' ? { x: 0, y: 0 } : drawing.textOffset ?? getDefaultTextOffset(drawing.tool)
  if (drawing.tool === 'pricelabel') return { x: point.x + 16, y: point.y - 13, width: 64, height: 26 }
  if (drawing.tool === 'flagmark') return { x: point.x - 8, y: point.y - 22, width: 36, height: 36 }
  if (drawing.tool === 'note') {
    const lines = (drawing.text || 'Add Text').split('\n')
    const width = Math.max(48, Math.max(...lines.map(line => line.length), 0) * 7 + 20)
    const height = Math.max(34, lines.length * 16 + 12)
    return { x: point.x - width / 2, y: point.y - height / 2, width, height }
  }
  if (drawing.tool === 'text' || drawing.tool === 'anchoredtext') {
    const lineCount = Math.max(1, (drawing.text || 'Add Text').split('\n').length)
    const height = Math.max(34, lineCount * 24 + 10)
    return { x: point.x + offset.x, y: point.y + offset.y - Math.max(0, height - 34), width: 220, height }
  }
  if (drawing.tool === 'comment') {
    const lines = (drawing.text || 'Add Text').split('\n')
    const width = Math.max(68, Math.max(...lines.map(line => line.length), 0) * 7 + 20)
    const height = Math.max(44, lines.length * 16 + 24)
    return { x: point.x + offset.x, y: point.y + offset.y - height, width, height }
  }
  if (drawing.tool === 'signpost') {
    const lines = (drawing.text || 'Add Text').split('\n')
    const width = Math.max(56, Math.max(...lines.map(line => line.length), 0) * 7 + 20)
    const height = Math.max(26, lines.length * 16 + 10)
    return { x: point.x - width / 2, y: point.y + offset.y, width, height }
  }
  if (drawing.tool === 'callout') {
    const lines = (drawing.text || 'Add text').split('\n')
    const width = Math.max(86, Math.max(...lines.map(line => line.length), 0) * 7 + 32)
    const height = Math.max(34, lines.length * 16 + 12)
    return { x: point.x + offset.x, y: point.y + offset.y, width, height }
  }
  return { x: point.x + offset.x, y: point.y + offset.y, width: 96, height: 30 }
}

function getDefaultTextOffset(tool: Drawing['tool']) {
  switch (tool) {
    case 'text':
    case 'anchoredtext':
      return { x: 0, y: -18 }
    case 'comment':
      return { x: 0, y: 0 }
    case 'callout':
      return { x: 42, y: -46 }
    case 'signpost':
      return { x: 0, y: -90 }
    default:
      return { x: -118, y: -64 }
  }
}

// ─────────────────────────────────────────────
// Handle pixel position
// ─────────────────────────────────────────────
export function getDrawingHandlePixel(
  drawing: Drawing,
  pixel: Pt,
  canvas: { width: number },
  priceScaleWidth: number,
): Pt {
  if (drawing.tool === 'horizontal') {
    return { x: canvas.width / 2 - priceScaleWidth / 2, y: pixel.y }
  }
  return pixel
}

// ─────────────────────────────────────────────
// Parallel channel handle hits
// ─────────────────────────────────────────────
export function getChannelHandleHits(
  drawing: Drawing,
  pixels: Pt[],
): { point: Pt; nodeIdx: number }[] {
  if (!CHANNEL_TOOLS.includes(drawing.tool)) return []
  const geometry = getChannelGeometry(pixels)
  if (!geometry) return []
  return [
    { point: pixels[0],              nodeIdx: 0 },
    { point: pixels[1],              nodeIdx: 1 },
    { point: geometry.parallelStart, nodeIdx: NODE_INDICES.CHANNEL_PARALLEL_START },
    { point: geometry.parallelEnd,   nodeIdx: NODE_INDICES.CHANNEL_PARALLEL_END },
    { point: geometry.baseMiddle,    nodeIdx: NODE_INDICES.CHANNEL_BASE_MIDDLE },
    { point: geometry.parallelMiddle,nodeIdx: NODE_INDICES.CHANNEL_PARALLEL_MIDDLE },
  ]
}

// ─────────────────────────────────────────────
// Pitchfork handle hits
// ─────────────────────────────────────────────
export function getPitchforkHandleHits(
  drawing: Drawing,
  pixels: Pt[],
): { point: Pt; nodeIdx: number }[] {
  if (!PITCHFORK_TOOLS.includes(drawing.tool as string) || pixels.length < 3) return []
  return [
    { point: pixels[0], nodeIdx: 0 },
    { point: pixels[1], nodeIdx: 1 },
    { point: pixels[2], nodeIdx: 2 },
  ]
}

// ─────────────────────────────────────────────
// Flat-top / flat-bottom handle hits
// ─────────────────────────────────────────────
export function getFlatTopBottomHandleHits(
  drawing: Drawing,
  pixels: Pt[],
): { point: Pt; nodeIdx: number }[] {
  if (drawing.tool !== 'flattopbottom' || pixels.length < 3) return []
  return [
    { point: pixels[0],                              nodeIdx: 0 },
    { point: pixels[1],                              nodeIdx: 1 },
    { point: { x: pixels[0].x, y: pixels[2].y },    nodeIdx: NODE_INDICES.FLAT_HORIZONTAL_START },
    { point: { x: pixels[1].x, y: pixels[2].y },    nodeIdx: NODE_INDICES.FLAT_HORIZONTAL_END },
  ]
}

// ─────────────────────────────────────────────
// Disjoint channel handle hits
// ─────────────────────────────────────────────
export function getDisjointHandleHits(
  drawing: Drawing,
  pixels: Pt[],
): { point: Pt; nodeIdx: number }[] {
  if (drawing.tool !== 'disjointchannel' || pixels.length < 3) return []

  const { start, end, inverseStart, inverseEnd } = getDisjointGeometry(pixels)

  return [
    { point: start,        nodeIdx: 0 },
    { point: end,          nodeIdx: 1 },
    { point: inverseStart, nodeIdx: NODE_INDICES.DISJOINT_REFERENCE },
    { point: inverseEnd,   nodeIdx: NODE_INDICES.DISJOINT_INVERSE_END },
  ]
}

// ─────────────────────────────────────────────
// Unified handle-hit resolver
// ─────────────────────────────────────────────
export function getHandleHits(
  drawing: Drawing,
  pixels: Pt[],
): { point: Pt; nodeIdx: number }[] {
  if (drawing.tool === 'brush' || drawing.tool === 'highlighter') return []
  if (LOCKED_NODE_TOOLS.includes(drawing.tool as string)) return []
  if (HANDLELESS_TOOLS.includes(drawing.tool as string)) return []
  if ((drawing.tool === 'note' || drawing.tool === 'anchorednote') && pixels.length >= 2) {
    const rect = getNoteHitRect(drawing, pixels[1])
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: getNoteLineAttachPointForHit(rect, pixels[0]), nodeIdx: 1 },
    ]
  }
  if (drawing.tool === 'signpost' && pixels[0]) {
    const rect = getTextHitRect(drawing, pixels[0])
    return [{ point: { x: pixels[0].x, y: rect.y }, nodeIdx: 0 }]
  }
  if (PITCHFORK_TOOLS.includes(drawing.tool as string)) return getPitchforkHandleHits(drawing, pixels)
  if (drawing.tool === 'disjointchannel')               return getDisjointHandleHits(drawing, pixels)

  if ((drawing.tool === 'longposition' || drawing.tool === 'shortposition') && pixels.length >= 1) {
    const geometry = getPositionGeometryForHit(
      pixels,
      drawing.tool === 'longposition' ? 'long' : 'short',
    )
    return [
      { point: geometry.entry, nodeIdx: 0 },
      { point: { x: geometry.left, y: geometry.target.y }, nodeIdx: NODE_INDICES.POSITION_TARGET },
      { point: { x: geometry.left, y: geometry.stop.y }, nodeIdx: NODE_INDICES.POSITION_STOP },
      { point: { x: geometry.right, y: geometry.entry.y }, nodeIdx: NODE_INDICES.POSITION_WIDTH },
    ]
  }

  if (drawing.tool === 'trendbasedfibtime' && pixels.length >= 3) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
      { point: pixels[2], nodeIdx: 2 },
    ]
  }

  if (drawing.tool === 'projection' && pixels.length >= 3) {
    const geometry = getProjectionSectorGeometryForHit(pixels[0], pixels[1], pixels[2])
    if (!geometry) {
      return [
        { point: pixels[0], nodeIdx: 0 },
        { point: pixels[1], nodeIdx: 1 },
        { point: pixels[2], nodeIdx: 2 },
      ]
    }

    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: geometry.upper, nodeIdx: 1 },
      { point: geometry.lower, nodeIdx: 2 },
    ]
  }

  if (drawing.tool === 'arc' && pixels.length >= 3) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
      { point: pixels[2], nodeIdx: 2 },
    ]
  }

  if (drawing.tool === 'curve' && pixels.length >= 3) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[2], nodeIdx: 2 },
      { point: pixels[1], nodeIdx: 1 },
    ]
  }

  if (drawing.tool === 'doublecurve' && pixels.length >= 4) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
      { point: pixels[2], nodeIdx: 2 },
      { point: pixels[3], nodeIdx: 3 },
    ]
  }

  if (drawing.tool === 'ellipse' && pixels.length >= 2) {
    const [start, end, control] = pixels
    const dx = end.x - start.x
    const dy = end.y - start.y
    const majorLength = Math.hypot(dx, dy)
    if (majorLength < 0.001) return pixels.map((point, nodeIdx) => ({ point, nodeIdx }))

    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    const nx = -dy / majorLength
    const ny = dx / majorLength
    const signedMinor = control
      ? (control.x - center.x) * nx + (control.y - center.y) * ny
      : Math.max(8, majorLength * 0.12)
    const ry = Math.max(1, Math.abs(signedMinor))
    const sign = signedMinor < 0 ? -1 : 1
    const widthPoint = { x: center.x + nx * ry * sign, y: center.y + ny * ry * sign }
    const oppositeWidthPoint = { x: center.x - nx * ry * sign, y: center.y - ny * ry * sign }

    return [
      { point: start, nodeIdx: 0 },
      { point: widthPoint, nodeIdx: 2 },
      { point: end, nodeIdx: 1 },
      { point: oppositeWidthPoint, nodeIdx: NODE_INDICES.ELLIPSE_OPPOSITE_WIDTH },
    ]
  }

  if (drawing.tool === 'polyline' && pixels.length >= 3) {
    const first = pixels[0]
    const last = pixels[pixels.length - 1]
    const nodePixels = Math.hypot(last.x - first.x, last.y - first.y) <= CLOSED_POLYLINE_DISTANCE_PX
      ? pixels.slice(0, -1)
      : pixels
    return nodePixels.map((point, nodeIdx) => ({ point, nodeIdx }))
  }

  if (drawing.tool === 'barspattern' && pixels.length >= 2) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
    ]
  }

  if (drawing.tool === 'fixedrangevolumeprofile' && pixels.length >= 2) {
    const left = Math.min(pixels[0].x, pixels[1].x)
    const right = Math.max(pixels[0].x, pixels[1].x)
    const top = Math.min(pixels[0].y, pixels[1].y)
    const bottom = Math.max(pixels[0].y, pixels[1].y)
    return [
      { point: { x: left, y: top }, nodeIdx: 0 },
      { point: { x: right, y: bottom }, nodeIdx: 1 },
    ]
  }

  if (drawing.tool === 'rectangle' && pixels.length >= 2) {
    const left = Math.min(pixels[0].x, pixels[1].x)
    const right = Math.max(pixels[0].x, pixels[1].x)
    const top = Math.min(pixels[0].y, pixels[1].y)
    const bottom = Math.max(pixels[0].y, pixels[1].y)
    const midX = (left + right) / 2
    const midY = (top + bottom) / 2
    return [
      { point: { x: left, y: top }, nodeIdx: 0 },
      { point: { x: midX, y: top }, nodeIdx: NODE_INDICES.RECT_TOP },
      { point: { x: right, y: top }, nodeIdx: NODE_INDICES.RECT_TOP_RIGHT },
      { point: { x: right, y: midY }, nodeIdx: NODE_INDICES.RECT_RIGHT },
      { point: { x: right, y: bottom }, nodeIdx: 1 },
      { point: { x: midX, y: bottom }, nodeIdx: NODE_INDICES.RECT_BOTTOM },
      { point: { x: left, y: bottom }, nodeIdx: NODE_INDICES.RECT_BOTTOM_LEFT },
      { point: { x: left, y: midY }, nodeIdx: NODE_INDICES.RECT_LEFT },
    ]
  }

  if (drawing.tool === 'rotatedrectangle' && pixels.length >= 2) {
    const geometry = getRotatedRectangleGeometryForHit(pixels)
    if (!geometry) return pixels.map((point, nodeIdx) => ({ point, nodeIdx }))
    return [
      { point: geometry.a, nodeIdx: NODE_INDICES.ROT_RECT_A },
      { point: geometry.leftCenter, nodeIdx: 0 },
      { point: geometry.d, nodeIdx: NODE_INDICES.ROT_RECT_D },
      { point: geometry.c, nodeIdx: NODE_INDICES.ROT_RECT_C },
      { point: geometry.rightCenter, nodeIdx: 1 },
      { point: geometry.b, nodeIdx: NODE_INDICES.ROT_RECT_B },
    ]
  }

  if (drawing.tool === 'xabcdpattern' && pixels.length >= 5) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
      { point: pixels[2], nodeIdx: 2 },
      { point: pixels[3], nodeIdx: 3 },
      { point: pixels[4], nodeIdx: 4 },
    ]
  }

  if (drawing.tool === 'fibwedge' && pixels.length >= 3) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
      { point: pixels[2], nodeIdx: 2 },
    ]
  }

  if (drawing.tool === 'gannsquare' && pixels.length >= 2) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
    ]
  }

  if (drawing.tool === 'gannfan' && pixels.length >= 2) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
    ]
  }

  if (drawing.tool === 'fibchannel' && pixels.length >= 3) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
      { point: pixels[2], nodeIdx: 2 },
    ]
  }

  if (drawing.tool === 'pitchfan' && pixels.length >= 3) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
      { point: pixels[2], nodeIdx: 2 },
    ]
  }

  if (drawing.tool === 'gannsquarefixed' && pixels.length >= 2) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
    ]
  }

  if (drawing.tool === 'trendbasedfibextension' && pixels.length >= 3) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
      { point: pixels[2], nodeIdx: 2 },
    ]
  }

  if (CHANNEL_TOOLS.includes(drawing.tool))             return getChannelHandleHits(drawing, pixels)
  if (drawing.tool === 'flattopbottom')                 return getFlatTopBottomHandleHits(drawing, pixels)

  // ── Fibonacci: two anchor nodes ──
  if (drawing.tool === 'fibonacci' && pixels.length >= 2) {
    return [
      { point: pixels[0], nodeIdx: 0 },
      { point: pixels[1], nodeIdx: 1 },
    ]
  }

  const nodePixels =
    drawing.tool === 'horizontal' ||
    drawing.tool === 'horizontalray' ||
    drawing.tool === 'vertical' ||
    drawing.tool === 'crossline'
      ? pixels.slice(0, 1)
      : pixels

  return nodePixels.map((point, i) => ({ point, nodeIdx: i }))
}

function getNoteHitRect(drawing: Drawing, point: Pt) {
  const lines = (drawing.text || 'Add Text').split('\n')
  const width = Math.max(48, Math.max(...lines.map(line => line.length), 0) * 7 + 20)
  const height = Math.max(34, lines.length * 16 + 12)
  return { x: point.x - width / 2, y: point.y - height / 2, width, height }
}

function getNoteLineAttachPointForHit(
  rect: { x: number; y: number; width: number; height: number },
  target: Pt,
) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const dx = target.x - center.x
  const dy = target.y - center.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? rect.x + rect.width : rect.x, y: center.y }
  }
  return { x: center.x, y: dy >= 0 ? rect.y + rect.height : rect.y }
}
