import type { IChartApi, ISeriesApi, Logical, Time } from 'lightweight-charts'
import type { Candle } from '../../types'
import type { CursorMode, Drawing, PixelPoint, Point } from './chartTypes'
import { distToSegment } from './utils/chartGeometry'
import { getHitSegments } from './utils/drawingHitTest'
import { candleUnixTime, timeToAnchoredCoordinate } from './utils/drawingCoordinates'
import { getDrawingLineDash, getDrawingToolSettings } from './settings/drawingSettingsRegistry'

import {
  FIB_LEVELS,
  FIB_TIME_LEVELS,
  FIB_SPEED_LEVELS,
  FIB_SPEED_ARC_LEVELS,
  GANN_SQUARE_LEVELS,
  GANN_FAN_RAYS,
  GANN_FAN_FILL_COLORS,
  GANN_SQUARE_LINE_COLORS,
  GANN_SQUARE_FILL_COLORS,
  GANN_BOX_LEVELS,
  GANN_BOX_LINE_COLORS,
  GANN_BOX_FILL_COLORS,
  FIB_WEDGE_LEVELS,
  FIB_WEDGE_COLORS,
  GOLDEN_RATIO,
  FIB_LINE_COLORS,
  FIB_COLORS,
  FIB_ZONE_COLORS,
  REGRESSION_DEVIATION_MULTIPLIER,
  CIRCLE_STROKE_COLOR,
  CIRCLE_FILL_COLOR,
  CIRCLE_LINE_WIDTH,
  ELLIPSE_STROKE_COLOR,
  ELLIPSE_FILL_COLOR,
  ELLIPSE_LINE_WIDTH,
  CLOSED_POLYLINE_FILL_COLOR,
  CLOSED_POLYLINE_DISTANCE_PX,
  ARC_STROKE_COLOR,
  ARC_FILL_COLOR,
  ARC_LINE_WIDTH,
  DOUBLE_CURVE_STROKE_COLOR,
  DOUBLE_CURVE_LINE_WIDTH,
} from './rendering/drawingRenderConstants'
const DRAWING_NODE_BLUE = '#2962ff'
const BRUSH_DRAWING_COLOR = '#00bcd4'
const FREEHAND_TOOLS = new Set<Drawing['tool']>(['brush', 'highlighter'])
const LOCKED_NODE_TOOLS = new Set<Drawing['tool']>(['arrowmarkup', 'arrowmarkdown', 'arrowmarkleft', 'arrowmarkright'])
const HANDLELESS_TOOLS = new Set<Drawing['tool']>(['flagmark'])
const FLAG_POLE_COLOR = '#1C274C'
const LEGACY_DRAWING_ORANGE = '#D77A61'
const HOVER_NODE_HIT_RADIUS = 10
const HOVER_LINE_HIT_RADIUS = 8
const TEXT_TOOLS = new Set<Drawing['tool']>([
  'text',
  'anchoredtext',
  'note',
  'anchorednote',
  'callout',
  'comment',
  'pricelabel',
  'signpost',
  'flagmark',
])
const EDITABLE_TEXT_TOOLS = new Set<Drawing['tool']>(['text', 'anchoredtext', 'note', 'anchorednote', 'callout', 'comment', 'signpost'])
const TEXT_PLACEHOLDER = 'Add Text'

interface ActiveDrawingRenderStyle {
  opacity: number
  strokeColor?: string
  lineWidth?: number
  lineDash?: number[]
}

const activeStyleByContext = new WeakMap<CanvasRenderingContext2D, ActiveDrawingRenderStyle>()
const styledContextByContext = new WeakMap<CanvasRenderingContext2D, CanvasRenderingContext2D>()
const rawContextByStyledContext = new WeakMap<object, CanvasRenderingContext2D>()

function getStyledDrawingContext(ctx: CanvasRenderingContext2D, drawing: Drawing) {
  const settings = getDrawingToolSettings(drawing.tool)
  const style: ActiveDrawingRenderStyle = {
    opacity: Math.min(1, Math.max(0, (drawing.opacity ?? 100) / 100)),
    strokeColor: settings.color && settings.forceStrokeColor ? drawing.color : undefined,
    lineWidth: settings.lineWidth && drawing.lineWidth != null ? drawing.lineWidth : undefined,
    lineDash: settings.lineStyle && drawing.lineStyle ? getDrawingLineDash(drawing.lineStyle) : undefined,
  }

  activeStyleByContext.set(ctx, style)
  ctx.globalAlpha = style.opacity
  if (style.strokeColor) ctx.strokeStyle = style.strokeColor
  if (style.lineWidth != null) ctx.lineWidth = style.lineWidth
  if (style.lineDash) ctx.setLineDash(style.lineDash)

  const cached = styledContextByContext.get(ctx)
  if (cached) return cached

  const styled = new Proxy(ctx, {
    get(target, property) {
      if (property === 'setLineDash') {
        return (segments: number[]) => {
          const active = activeStyleByContext.get(target)
          target.setLineDash(active?.lineDash ?? segments)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(target, property, value) {
      const active = activeStyleByContext.get(target)
      if (property === 'strokeStyle' && active?.strokeColor) {
        target.strokeStyle = active.strokeColor
        return true
      }
      if (property === 'lineWidth' && active?.lineWidth != null) {
        target.lineWidth = active.lineWidth
        return true
      }
      if (property === 'globalAlpha' && active) {
        const localAlpha = Number(value)
        target.globalAlpha = Math.min(1, Math.max(0, Number.isFinite(localAlpha) ? localAlpha : 1)) * active.opacity
        return true
      }
      return Reflect.set(target, property, value, target)
    },
  }) as CanvasRenderingContext2D

  styledContextByContext.set(ctx, styled)
  rawContextByStyledContext.set(styled, ctx)
  return styled
}

function getRawDrawingContext(ctx: CanvasRenderingContext2D) {
  return rawContextByStyledContext.get(ctx) ?? ctx
}

function extendRayFarPx(
  from: { x: number; y: number },
  through: { x: number; y: number },
  distance = 100000,
) {
  const dx = through.x - from.x
  const dy = through.y - from.y
  const len = Math.hypot(dx, dy)

  if (len < 0.001) return through

  return {
    x: from.x + (dx / len) * distance,
    y: from.y + (dy / len) * distance,
  }
}

export interface RenderDrawingsOptions {
  canvas: HTMLCanvasElement
  chart: IChartApi | null
  candleSeries: ISeriesApi<'Candlestick'> | null
  candles: Candle[]
  drawings: Drawing[]
  currentPoints?: Point[]
  activeTool: Drawing['tool']
  cursorMode: CursorMode
  mousePosition: { x: number; y: number } | null
  selectedId?: string
  editingTextId?: string | null
  textCursorVisible?: boolean
  drawingsLocked?: boolean
  priceFormatter?: (price: number) => string
  pointToPixel: (point: Point) => { x: number; y: number }
}

export function renderDrawings({
  canvas,
  chart,
  candleSeries,
  candles,
  drawings,
  currentPoints,
  activeTool,
  cursorMode,
  mousePosition,
  selectedId,
  editingTextId = null,
  textCursorVisible = false,
  drawingsLocked = false,
  priceFormatter = formatPriceLabel,
  pointToPixel,
}: RenderDrawingsOptions) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const clip = getDrawingClipRect(canvas, chart)
  const getDrawingPixels = (drawing: Drawing): PixelPoint[] => drawing.points.map(point =>
    toPixelPoint(point, chart, candleSeries, candles, drawing),
  )

  ctx.save()
  ctx.beginPath()
  ctx.rect(clip.x, clip.y, clip.width, clip.height)
  ctx.clip()

  drawCursor(ctx, canvas, cursorMode, activeTool, mousePosition)

  const allDrawings = [...drawings]
  if (currentPoints?.length && activeTool === 'barspattern') {
    const points = currentPoints.map(point => toPixelPoint(point, chart, candleSeries, candles))
    drawBarsPatternSetup(ctx, canvas, points, candles, chart, candleSeries, mousePosition, clip)
  } else if (currentPoints?.length && activeTool) {
    allDrawings.push({
      id: '__preview',
      tool: activeTool,
      points: currentPoints,
      color: FREEHAND_TOOLS.has(activeTool) ? BRUSH_DRAWING_COLOR : DRAWING_NODE_BLUE,
      lineWidth: activeTool === 'highlighter' ? 24 : activeTool === 'brush' ? 2 : undefined,
    })
  }

  const renderDrawing = (drawing: Drawing) => {
    if (drawing.points.length === 0) return
    const drawingColor = drawing.color === LEGACY_DRAWING_ORANGE ? DRAWING_NODE_BLUE : drawing.color
    const styledDrawing = { ...drawing, color: drawingColor }
    ctx.strokeStyle = drawingColor
    ctx.fillStyle = drawingColor
    ctx.lineWidth = drawing.lineWidth ?? 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash(
      drawing.lineStyle === 'dashed' ? [8, 5]
        : drawing.lineStyle === 'dotted' ? [1, 5]
          : [],
    )

    const points = drawing.points.map(point => toPixelPoint(point, chart, candleSeries, candles, drawing))
    const isSelected = drawing.id !== '__preview' && drawing.id === selectedId
    const isEditingText = drawing.id !== '__preview' && drawing.id === editingTextId && EDITABLE_TEXT_TOOLS.has(drawing.tool)
    const textHandlePoint = points[0] ? getHandlePixelPoint(drawing.tool, points[0], clip) : null
    const isHoveredText = Boolean(mousePosition && textHandlePoint && TEXT_TOOLS.has(drawing.tool) && (
      Math.hypot(textHandlePoint.x - mousePosition.x, textHandlePoint.y - mousePosition.y) <= HOVER_NODE_HIT_RADIUS ||
      pointInTextRect(mousePosition, getTextToolBodyRect(ctx, styledDrawing, points))
    ))
    const drawingContext = getStyledDrawingContext(ctx, styledDrawing)
    drawByTool(drawingContext, canvas, styledDrawing, points, candles, chart, candleSeries, isSelected || isHoveredText, isEditingText, textCursorVisible, priceFormatter)
  }

  allDrawings
    .filter(drawing => drawing.tool === 'fixedrangevolumeprofile')
    .forEach(renderDrawing)
  allDrawings
    .filter(drawing => drawing.tool !== 'fixedrangevolumeprofile')
    .forEach(renderDrawing)

  ctx.globalAlpha = 1
  ctx.setLineDash([])

  if (activeTool && currentPoints?.length) {
    const previewPixels = currentPoints.map(point => pointToPixel(point))
    const previewHandles = activeTool === 'fixedrangevolumeprofile' || FREEHAND_TOOLS.has(activeTool)
      ? []
      : getSelectionHandlePoints(activeTool, previewPixels)
    previewHandles.forEach(handle => {
      drawSelectionHandle(ctx, canvas, getHandlePixelPoint(activeTool, handle.point, clip), handle.square)
    })
  }

  if (drawingsLocked) {
    const lockedHandleDrawings = selectedId
      ? drawings.filter(drawing => drawing.id === selectedId)
      : cursorMode === 'arrow' && !activeTool
        ? drawings
      : []

    lockedHandleDrawings.forEach(drawing => {
      if (drawing.points.length === 0) return
      const pixels = getDrawingPixels(drawing)
      const lockedPoints = getLockedHandlePixels(drawing, pixels, {
        candles,
        chart,
        candleSeries,
        clip,
      })
      lockedPoints.forEach(point => drawLockedSelectionHandle(ctx, point, false))
    })
  } else if (selectedId) {
    const selected = drawings.find(drawing => drawing.id === selectedId)
    if (selected && !SELF_RENDERED_HANDLE_TOOLS.has(selected.tool)) {
      const selectedPixels = getDrawingPixels(selected)
      if (FREEHAND_TOOLS.has(selected.tool)) {
        const endpoints = getFreehandLockedHandlePoints(selectedPixels)
        endpoints.forEach(point => {
          drawLockedSelectionHandle(ctx, point)
        })
      } else if (LOCKED_NODE_TOOLS.has(selected.tool)) {
        selectedPixels.slice(0, 1).forEach(point => {
          drawLockedSelectionHandle(ctx, point)
        })
      } else if (HANDLELESS_TOOLS.has(selected.tool)) {
        selectedPixels.slice(0, 1).forEach(point => {
          drawLockedSelectionHandle(ctx, getFlagLockedHandlePoint(point), false)
        })
      } else {
        const handlePoints = getSelectionHandlePoints(selected.tool, selectedPixels, {
          candles,
          chart,
          candleSeries,
        }, selected)
        handlePoints.forEach(handle => {
          drawSelectionHandle(ctx, canvas, getHandlePixelPoint(selected.tool, handle.point, clip), handle.square)
        })
      }
    }
  }

  if (!drawingsLocked && mousePosition) {
    const hovered = getHoveredDrawingPreview(
      ctx,
      drawings,
      mousePosition,
      clip,
      chart,
      candleSeries,
      candles,
      pointToPixel,
    )
    if (hovered) {
      if (FREEHAND_TOOLS.has(hovered.drawing.tool)) {
        hovered.points.forEach(point => drawLockedSelectionHandle(ctx, point, hovered.hitKind === 'node'))
      } else if (LOCKED_NODE_TOOLS.has(hovered.drawing.tool)) {
        hovered.points.forEach(point => drawLockedSelectionHandle(ctx, point))
      } else {
        hovered.handles.forEach((handle, index) => {
          const point = getHandlePixelPoint(hovered.drawing.tool, handle.point, clip)
          if (hovered.hitKind === 'node' && index === hovered.hitHandleIndex) {
            drawHoverSelectionHandle(ctx, canvas, point, handle.square)
          } else {
            drawSelectionHandle(ctx, canvas, point, handle.square)
          }
        })
      }
    }
  }

  ctx.restore()
}

const SINGLE_HANDLE_TOOLS = new Set<Drawing['tool']>(['horizontal', 'horizontalray', 'vertical', 'crossline'])
const SQUARE_HANDLE_TOOLS = new Set<Drawing['tool']>(['horizontal', 'horizontalray', 'vertical'])
const CHANNEL_HANDLE_TOOLS = new Set<Drawing['tool']>([
  'parallelchannel',
])
const SELF_RENDERED_HANDLE_TOOLS = new Set<Drawing['tool']>([
  'pitchfork',
  'schiffpitchfork',
  'modifiedschiffpitchfork',
  'insidepitchfork',
])

function getSelectionHandlePoints(
  tool: Drawing['tool'],
  points: { x: number; y: number }[],
  context?: {
    candles: Candle[]
    chart: IChartApi | null
    candleSeries: ISeriesApi<'Candlestick'> | null
  },
  drawing?: Drawing,
): { point: { x: number; y: number }; square: boolean }[] {
  if (FREEHAND_TOOLS.has(tool)) return []
  if (LOCKED_NODE_TOOLS.has(tool)) return []
  if (HANDLELESS_TOOLS.has(tool)) return []
  if ((tool === 'note' || tool === 'anchorednote') && points.length >= 2) {
    const rect = getNoteBodyRectFromPoint(points[1], drawing?.text ?? '')
    return [
      { point: points[0], square: false },
      { point: getNoteLineAttachPoint(rect, points[0]), square: false },
    ]
  }
  if (tool === 'signpost' && points[0]) {
    const offset = drawing?.textOffset ?? getDefaultTextOffset('signpost')
    return [{ point: { x: points[0].x, y: points[0].y + offset.y }, square: true }]
  }
  if (SINGLE_HANDLE_TOOLS.has(tool)) return points.slice(0, 1).map(point => ({ point, square: SQUARE_HANDLE_TOOLS.has(tool) }))
  if (tool === 'barspattern' && points.length >= 2 && context) {
    const anchors = points.length > 2
      ? points.slice(0, 2)
      : getBarsPatternAnchorPoints(points, context.candles, context.chart, context.candleSeries)
    return anchors.map(point => ({ point, square: false }))
  }
  if (tool === 'fixedrangevolumeprofile' && points.length >= 2) {
    const left = Math.min(points[0].x, points[1].x)
    const right = Math.max(points[0].x, points[1].x)
    const top = context
      ? getFixedRangeProfilePixelBounds(points, context.candles, context.chart, context.candleSeries)?.top ?? Math.min(points[0].y, points[1].y)
      : Math.min(points[0].y, points[1].y)
    const bottom = context
      ? getFixedRangeProfilePixelBounds(points, context.candles, context.chart, context.candleSeries)?.bottom ?? Math.max(points[0].y, points[1].y)
      : Math.max(points[0].y, points[1].y)
    return [
      { point: { x: left, y: top }, square: false },
      { point: { x: right, y: bottom }, square: false },
    ]
  }
  if (tool === 'projection' && points.length >= 3) {
    const sectorPoints = getProjectionSectorHandlePoints(points)
    return sectorPoints.map(point => ({ point, square: false }))
  }
  if (tool === 'arc' && points.length >= 3) {
    return [
      { point: points[0], square: false },
      { point: points[1], square: false },
      { point: points[2], square: false },
    ]
  }
  if (tool === 'curve' && points.length >= 3) {
    return [
      { point: points[0], square: false },
      { point: points[2], square: false },
      { point: points[1], square: false },
    ]
  }
  if (tool === 'doublecurve' && points.length >= 4) {
    return points.map(point => ({ point, square: false }))
  }
  if (tool === 'ellipse' && points.length >= 2) {
    const geometry = getRotatedEllipseGeometry(points)
    if (!geometry) return points.map(point => ({ point, square: false }))
    return [
      { point: geometry.start, square: false },
      { point: geometry.widthPoint, square: false },
      { point: geometry.end, square: false },
      { point: geometry.oppositeWidthPoint, square: false },
    ]
  }
  if (tool === 'polyline' && points.length >= 3 && isClosedPolyline(points)) {
    return points.slice(0, -1).map(point => ({ point, square: false }))
  }
  if (tool === 'rectangle' && points.length >= 2) {
    const left = Math.min(points[0].x, points[1].x)
    const right = Math.max(points[0].x, points[1].x)
    const top = Math.min(points[0].y, points[1].y)
    const bottom = Math.max(points[0].y, points[1].y)
    const midX = (left + right) / 2
    const midY = (top + bottom) / 2
    return [
      { point: { x: left, y: top }, square: false },
      { point: { x: midX, y: top }, square: true },
      { point: { x: right, y: top }, square: false },
      { point: { x: right, y: midY }, square: true },
      { point: { x: right, y: bottom }, square: false },
      { point: { x: midX, y: bottom }, square: true },
      { point: { x: left, y: bottom }, square: false },
      { point: { x: left, y: midY }, square: true },
    ]
  }
  if (tool === 'rotatedrectangle' && points.length >= 2) {
    if (points.length < 3) {
      return points.map(point => ({ point, square: false }))
    }
    const geometry = getRotatedRectangleGeometry(points)
    if (!geometry) return points.map(point => ({ point, square: false }))
    return [
      { point: geometry.a, square: false },
      { point: geometry.leftCenter, square: false },
      { point: geometry.d, square: false },
      { point: geometry.c, square: false },
      { point: geometry.rightCenter, square: false },
      { point: geometry.b, square: false },
    ]
  }
  if ((tool === 'longposition' || tool === 'shortposition') && points.length >= 1) {
    const geometry = getPositionGeometry(points, tool === 'longposition' ? 'long' : 'short')
    return [
      { point: geometry.entry, square: false },
      { point: { x: geometry.left, y: geometry.targetY }, square: true },
      { point: { x: geometry.left, y: geometry.stopY }, square: true },
      { point: { x: geometry.right, y: geometry.entry.y }, square: true },
    ]
  }
  if (tool === 'flattopbottom' && points.length >= 3) {
    const [start, end, heightPoint] = points
    return [
      { point: start, square: false },
      { point: end, square: false },
      { point: { x: start.x, y: heightPoint.y }, square: false },
      { point: { x: end.x, y: heightPoint.y }, square: false },
    ]
  }
  if (tool === 'gannsquarefixed' && points.length >= 2) {
    return [
      { point: points[0], square: false },
      { point: points[1], square: false },
    ]
  }
  if (tool === 'disjointchannel' && points.length >= 3) {
    const [start, end, inverseStart] = points
    const anchoredInverseStart = { x: end.x, y: inverseStart.y }
    const inverseEnd = getDisjointInverseEnd(start, end, anchoredInverseStart)
    return [
      { point: start, square: false },
      { point: end, square: false },
      { point: anchoredInverseStart, square: true },
      { point: inverseEnd, square: false },
    ]
  }
  if (!CHANNEL_HANDLE_TOOLS.has(tool) || points.length < 3) return points.map(point => ({ point, square: SQUARE_HANDLE_TOOLS.has(tool) }))

  const [start, end, widthPoint] = points
  const offsetY = widthPoint.y - yOnLineAtX(start, end, widthPoint.x)
  const parallelStart = { x: start.x, y: start.y + offsetY }
  const parallelEnd = { x: end.x, y: end.y + offsetY }
  const baseMiddle = getMidpoint(start, end)
  const parallelMiddle = getMidpoint(parallelStart, parallelEnd)

  return [
    { point: start, square: false },
    { point: end, square: false },
    { point: parallelStart, square: false },
    { point: parallelEnd, square: false },
    { point: baseMiddle, square: true },
    { point: parallelMiddle, square: true },
  ]
}

function getFreehandLockedHandlePoints(points: { x: number; y: number }[]) {
  if (points.length === 0) return []
  if (points.length === 1) return [points[0]]
  return [points[0], points[points.length - 1]]
}

function getHoveredDrawingPreview(
  ctx: CanvasRenderingContext2D,
  drawings: Drawing[],
  mousePosition: { x: number; y: number },
  clip: { x: number; y: number; width: number; height: number },
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
  candles: Candle[],
  pointToPixel: (point: Point) => { x: number; y: number },
) {
  for (const drawing of [...drawings].reverse()) {
    if (drawing.points.length === 0) continue
    const pixels: PixelPoint[] = drawing.points.map(point => {
      if (TEXT_TOOLS.has(drawing.tool) && (drawing.anchored || drawing.tool === 'anchoredtext' || drawing.tool === 'anchorednote')) {
        return { x: point.x, y: point.y, price: point.price, time: point.time, logical: point.logical }
      }
      const pixel = pointToPixel(point)
      return { x: pixel.x, y: pixel.y, price: point.price, time: point.time, logical: point.logical }
    })
    const context = { candles, chart, candleSeries }
    const handles = FREEHAND_TOOLS.has(drawing.tool)
      ? []
      : getSelectionHandlePoints(drawing.tool, pixels, context, drawing)

    if (LOCKED_NODE_TOOLS.has(drawing.tool)) {
      const point = pixels[0]
      if (point && Math.hypot(point.x - mousePosition.x, point.y - mousePosition.y) <= 24) {
        return { drawing, points: [point], handles: [], hitKind: 'node' as const, hitHandleIndex: 0 }
      }
    }

    for (let index = 0; index < handles.length; index += 1) {
      const handle = handles[index]
      const point = getHandlePixelPoint(drawing.tool, handle.point, clip)
      if (Math.hypot(point.x - mousePosition.x, point.y - mousePosition.y) <= HOVER_NODE_HIT_RADIUS) {
        return { drawing, points: [], handles, hitKind: 'node' as const, hitHandleIndex: index }
      }
    }

    if (TEXT_TOOLS.has(drawing.tool)) {
      if (pointInTextRect(mousePosition, getTextToolBodyRect(ctx, drawing, pixels))) {
        return {
          drawing,
          points: [],
          handles,
          hitKind: 'object' as const,
          hitHandleIndex: -1,
        }
      }
      continue
    }

    const lineHitRadius = FREEHAND_TOOLS.has(drawing.tool)
      ? Math.max(HOVER_LINE_HIT_RADIUS, (drawing.lineWidth ?? 2) / 2)
      : HOVER_LINE_HIT_RADIUS
    for (const [start, end] of getHitSegments(drawing, pixels, { width: clip.width, height: clip.height }, context)) {
      if (distToSegment(mousePosition.x, mousePosition.y, start, end) <= lineHitRadius) {
        return {
          drawing,
          points: FREEHAND_TOOLS.has(drawing.tool) ? getFreehandLockedHandlePoints(pixels) : [],
          handles,
          hitKind: 'object' as const,
          hitHandleIndex: -1,
        }
      }
    }
  }

  return null
}

function getLockedHandlePixels(
  drawing: Drawing,
  pixels: { x: number; y: number }[],
  context: {
    candles: Candle[]
    chart: IChartApi | null
    candleSeries: ISeriesApi<'Candlestick'> | null
    clip: { x: number; y: number; width: number; height: number }
  },
) {
  if (FREEHAND_TOOLS.has(drawing.tool)) return getFreehandLockedHandlePoints(pixels)
  if (drawing.tool === 'flagmark') return pixels.slice(0, 1).map(getFlagLockedHandlePoint)

  const handles = getSelectionHandlePoints(drawing.tool, pixels, context, drawing)
  if (handles.length > 0) {
    return handles.map(handle => getHandlePixelPoint(drawing.tool, handle.point, context.clip))
  }

  return pixels
}

function getFlagLockedHandlePoint(point: { x: number; y: number }) {
  return { x: point.x, y: point.y + 12 }
}

function hsYOnLineAtX(
  a: { x: number; y: number },
  b: { x: number; y: number },
  x: number,
) {
  const dx = b.x - a.x
  if (Math.abs(dx) < 0.000001) return (a.y + b.y) / 2

  const t = (x - a.x) / dx
  return a.y + (b.y - a.y) * t
}

function isHsPointAboveNeckline(
  p: { x: number; y: number },
  n1: { x: number; y: number },
  n2: { x: number; y: number },
) {
  // در canvas هرچه y کمتر باشد، نقطه بالاتر است
  return p.y < hsYOnLineAtX(n1, n2, p.x)
}

function drawElliottImpulseLabel(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  label: string,
  color: string,
) {
  const offsets: Record<string, { dx: number; dy: number }> = {
    '0': { dx: -2, dy: 24 },
    '1': { dx: 0, dy: -18 },
    '2': { dx: 0, dy: 24 },
    '3': { dx: 0, dy: -18 },
    '4': { dx: 0, dy: 24 },
    '5': { dx: -4, dy: -18 },
  }

  const off = offsets[label] ?? { dx: 6, dy: -6 }

  ctx.save()
  ctx.fillStyle = color
  ctx.font = 'bold 12px Vazirmatn, Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`(${label})`, point.x + off.dx, point.y + off.dy)
  ctx.restore()
}

function getSegmentNecklineIntersection(
  a: { x: number; y: number },
  b: { x: number; y: number },
  n1: { x: number; y: number },
  n2: { x: number; y: number },
) {
  const r = {
    x: b.x - a.x,
    y: b.y - a.y,
  }

  const s = {
    x: n2.x - n1.x,
    y: n2.y - n1.y,
  }

  const denom = r.x * s.y - r.y * s.x
  if (Math.abs(denom) < 0.000001) return null

  const qp = {
    x: n1.x - a.x,
    y: n1.y - a.y,
  }

  const t = (qp.x * s.y - qp.y * s.x) / denom
  const u = (qp.x * r.y - qp.y * r.x) / denom

  if (t < 0 || t > 1) return null

  return {
    x: a.x + r.x * t,
    y: a.y + r.y * t,
    t,
    u,
  }
}

function clipPolygonAboveNeckline(
  polygon: Array<{ x: number; y: number }>,
  n1: { x: number; y: number },
  n2: { x: number; y: number },
) {
  if (polygon.length < 3) return []

  const output: Array<{ x: number; y: number }> = []

  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]
    const prev = polygon[(i + polygon.length - 1) % polygon.length]

    const currentInside = isHsPointAboveNeckline(current, n1, n2)
    const prevInside = isHsPointAboveNeckline(prev, n1, n2)

    const intersection = getSegmentNecklineIntersection(prev, current, n1, n2)

    if (currentInside) {
      if (!prevInside && intersection) {
        output.push(intersection)
      }
      output.push(current)
    } else if (prevInside && intersection) {
      output.push(intersection)
    }
  }

  return output
}

function fillHsPolygon(
  ctx: CanvasRenderingContext2D,
  polygon: Array<{ x: number; y: number }>,
  fillStyle: string,
) {
  if (polygon.length < 3) return

  ctx.save()
  ctx.fillStyle = fillStyle
  ctx.beginPath()
  ctx.moveTo(polygon[0].x, polygon[0].y)

  for (let i = 1; i < polygon.length; i++) {
    ctx.lineTo(polygon[i].x, polygon[i].y)
  }

  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function getQuarterArcAngles(signX: number, signY: number) {
  // canvas coordinates: y رو به پایین مثبت است
  if (signX >= 0 && signY <= 0) {
    // بالا-راست
    return { startAngle: -Math.PI / 2, endAngle: 0 }
  }
  if (signX >= 0 && signY >= 0) {
    // پایین-راست
    return { startAngle: 0, endAngle: Math.PI / 2 }
  }
  if (signX <= 0 && signY >= 0) {
    // پایین-چپ
    return { startAngle: Math.PI / 2, endAngle: Math.PI }
  }
  // بالا-چپ
  return { startAngle: Math.PI, endAngle: Math.PI * 1.5 }
}

function getMidpoint(start: { x: number; y: number }, end: { x: number; y: number }) {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
}

function getFibArcAngles(p0: PixelPoint, p1: PixelPoint) {
  const upward = p1.y <= p0.y

  if (upward) {
    return {
      upward: true,
      startAngle: Math.PI,
      endAngle: 2 * Math.PI,
      anticlockwise: false,
      labelYOffsetSign: -1,
    }
  }

  return {
    upward: false,
    startAngle: 0,
    endAngle: Math.PI,
    anticlockwise: false,
    labelYOffsetSign: 1,
  }
}

function getSegmentLength(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function formatPatternRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || Math.abs(denominator) < 0.000001) {
    return '--'
  }
  return (numerator / denominator).toFixed(3)
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)

  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

function drawElliottTriangleLabel(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  label: string,
  color: string,
) {
  const offsets: Record<string, { dx: number; dy: number }> = {
    'A': { dx: 0, dy: -18 },
    'B': { dx: 0, dy: 18 },
    'C': { dx: 0, dy: -18 },
    'D': { dx: 0, dy: 18 },
    'E': { dx: 0, dy: -18 },
  }

  const off = offsets[label] ?? { dx: 6, dy: -6 }

  ctx.save()
  ctx.fillStyle = color
  ctx.font = 'bold 12px Vazirmatn, Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`(${label})`, point.x + off.dx, point.y + off.dy)
  ctx.restore()
}

function drawElliottDoubleComboLabel(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  label: string,
  color: string,
) {
  const offsets: Record<string, { dx: number; dy: number }> = {
    'W': { dx: 0, dy: -18 },
    'X': { dx: 0, dy: 18 },
    'Y': { dx: 0, dy: -18 },
  }

  const off = offsets[label] ?? { dx: 6, dy: -6 }

  ctx.save()
  ctx.fillStyle = color
  ctx.font = 'bold 12px Vazirmatn, Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`(${label})`, point.x + off.dx, point.y + off.dy)
  ctx.restore()
}

function drawPatternBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  fg = '#ffffff',
) {
  ctx.save()

  ctx.font = 'bold 11px Vazirmatn, Inter, sans-serif'

  const paddingX = 6
  const paddingTop = 4
  const paddingBottom = 4

  const metrics = ctx.measureText(text)

  const textWidth = metrics.width
  const ascent = metrics.actualBoundingBoxAscent || 9
  const descent = metrics.actualBoundingBoxDescent || 3

  const w = textWidth + paddingX * 2
  const h = ascent + descent + paddingTop + paddingBottom

  const boxX = x - w / 2
  const boxY = y - h / 2

  roundedRectPath(ctx, boxX, boxY, w, h, 4)

  ctx.fillStyle = bg
  ctx.fill()

  ctx.fillStyle = fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // دقیقاً وسط کردن متن با metric واقعی فونت
  const textY =
    boxY +
    paddingTop +
    ascent

  ctx.fillText(text, x, textY)

  ctx.restore()
}

function drawElliottCorrectionLabel(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  label: string,
  color: string,
) {
  const offsets: Record<string, { dx: number; dy: number }> = {
    '0': { dx: -2, dy: 24 },
    'A': { dx: 0, dy: -18 },
    'B': { dx: 0, dy: 24 },
    'C': { dx: 0, dy: -18 },
  }

  const off = offsets[label] ?? { dx: 6, dy: -6 }

  ctx.save()
  ctx.fillStyle = color
  ctx.font = 'bold 12px Vazirmatn, Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`(${label})`, point.x + off.dx, point.y + off.dy)
  ctx.restore()
}

function drawABCDPointLabel(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  label: 'A' | 'B' | 'C' | 'D',
  color: string,
) {
  let bx = point.x
  let by = point.y - 16

  if (label === 'A') {
    bx = point.x
    by = point.y + 16
  } else if (label === 'B') {
    bx = point.x
    by = point.y - 16
  } else if (label === 'C') {
    bx = point.x
    by = point.y + 16
  } else if (label === 'D') {
    bx = point.x + 14
    by = point.y - 2
  }

  drawPatternBadge(ctx, bx, by, label, color)
}

function drawElliottTripleComboLabel(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  label: string,
  color: string,
) {
  const offsets: Record<string, { dx: number; dy: number }> = {
    'W': { dx: 0, dy: -18 },
    'X1': { dx: 0, dy: 18 },
    'Y': { dx: 0, dy: -18 },
    'X2': { dx: 0, dy: 18 },
    'Z': { dx: 0, dy: -18 },
  }

  const off = offsets[label] ?? { dx: 6, dy: -6 }

  const text =
    label === 'X1' || label === 'X2'
      ? '(X)'
      : `(${label})`

  ctx.save()
  ctx.fillStyle = color
  ctx.font = 'bold 12px Vazirmatn, Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, point.x + off.dx, point.y + off.dy)
  ctx.restore()
}

function hsCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  return a.x * b.y - a.y * b.x
}

function intersectInfiniteLineWithSegment(
  lineA: { x: number; y: number },
  lineB: { x: number; y: number },
  segA: { x: number; y: number },
  segB: { x: number; y: number },
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

  // فقط اگر برخورد روی خود segment شانه باشد
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

function intersectInfiniteLines(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
) {
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


function drawTrianglePatternPointLabel(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  label: 'A' | 'B' | 'C' | 'D',
  color: string,
) {
  let bx = point.x
  let by = point.y - 16

  if (label === 'A') {
    bx = point.x + 12
    by = point.y + 14
  } else if (label === 'B') {
    bx = point.x
    by = point.y - 16
  } else if (label === 'C') {
    bx = point.x
    by = point.y + 16
  } else if (label === 'D') {
    bx = point.x + 14
    by = point.y - 2
  }

  drawPatternBadge(ctx, bx, by, label, color)
}

type TrianglePatternGeometryPoint = { x: number; y: number }

type TrianglePatternGeometry = {
  apex: TrianglePatternGeometryPoint | null
  lowerBase: TrianglePatternGeometryPoint
  upperBase: TrianglePatternGeometryPoint
  polygon: TrianglePatternGeometryPoint[]
  isFallback: boolean
}

function triDistSq(
  a: TrianglePatternGeometryPoint,
  b: TrianglePatternGeometryPoint,
) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function pointOnLineAtX(
  a: TrianglePatternGeometryPoint,
  b: TrianglePatternGeometryPoint,
  x: number,
  fallbackFrom: TrianglePatternGeometryPoint,
) {
  const dx = b.x - a.x

  // اگر خود خط تقریباً عمودی بود، نمی‌شود نقطه‌ی جدید در x دیگر ساخت.
  // پس دورترین endpoint نسبت به apex را برمی‌گردانیم.
  if (Math.abs(dx) < 0.000001) {
    return triDistSq(a, fallbackFrom) >= triDistSq(b, fallbackFrom)
      ? a
      : b
  }

  const t = (x - a.x) / dx

  return {
    x,
    y: a.y + (b.y - a.y) * t,
  }
}

function getTriangleBaseX(
  apex: TrianglePatternGeometryPoint,
  points: TrianglePatternGeometryPoint[],
) {
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

function getTrianglePatternGeometry(
  a: TrianglePatternGeometryPoint,
  b: TrianglePatternGeometryPoint,
  c: TrianglePatternGeometryPoint,
  d: TrianglePatternGeometryPoint,
): TrianglePatternGeometry {
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

  // ✅ ضلع اصلی مثلث همیشه در راستای Y است
  // پس فقط x آن را انتخاب می‌کنیم، نه اینکه با دو نود واقعی بسازیم
  const baseX = getTriangleBaseX(apex, [a, b, c, d])

  const lowerBase = pointOnLineAtX(a, c, baseX, apex)
  const upperBase = pointOnLineAtX(b, d, baseX, apex)

  return {
    apex,
    lowerBase,
    upperBase,
    polygon: [lowerBase, upperBase, apex],
    isFallback: false,
  }
}


function getExtendedHsNeckline(
  n1: { x: number; y: number },
  n2: { x: number; y: number },
  leftLineA?: { x: number; y: number },
  leftLineB?: { x: number; y: number },
  rightLineA?: { x: number; y: number },
  rightLineB?: { x: number; y: number },
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

  let start = {
    x: n1.x - ux * far,
    y: n1.y - uy * far,
  }

  let end = {
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

    // سمت چپ N1
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

    // سمت راست N2
    if (rightHit && rightHit.t >= 1) {
      end = rightHit.point
    }
  }

  return { start, end }
}

function drawRatioOnSegment(
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  text: string,
  color: string,
  offsetX = 0,
  offsetY = 0,
) {
  const mx = (start.x + end.x) / 2 + offsetX
  const my = (start.y + end.y) / 2 + offsetY
  drawPatternBadge(ctx, mx, my, text, color)
}

function formatGannMetric(value: number, decimals = 6) {
  if (!Number.isFinite(value)) return '--'

  const fixed = value.toFixed(decimals)

  return fixed
    .replace(/\.?0+$/, '')
}

function drawGannSquareMetrics(
  ctx: CanvasRenderingContext2D,
  origin: PixelPoint,
  opposite: PixelPoint,
  left: number,
  right: number,
  top: number,
  bottom: number,
) {
  const priceRange = Math.abs(opposite.price - origin.price)

  const logicalA = Number(origin.logical)
  const logicalB = Number(opposite.logical)

  const barRange = Number.isFinite(logicalA) && Number.isFinite(logicalB)
    ? Math.abs(logicalB - logicalA)
    : Math.abs(opposite.x - origin.x)

  const ratio = barRange > 0
    ? priceRange / barRange
    : NaN

  ctx.save()

  ctx.font = '11px Vazirmatn, Inter, sans-serif'
  ctx.fillStyle = '#787b86'

  // بالا-چپ: price range
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(
    formatGannMetric(priceRange, 6),
    left,
    top - 10,
  )

  // بالا-راست: price/bar ratio
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText(
    formatGannMetric(ratio, 8),
    right,
    top - 10,
  )

  // پایین-راست: bar range
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(
    formatGannMetric(barRange, 0),
    right + 10,
    bottom + 10,
  )

  ctx.restore()
}

function getDisjointInverseEnd(
  start: { x: number; y: number },
  end: { x: number; y: number },
  inverseStart: { x: number; y: number },
) {
  return {
    x: start.x,
    y: inverseStart.y + (end.y - start.y),
  }
}

function priceDistance(a: PixelPoint, b: PixelPoint) {
  const priceDist = Math.abs(a.price - b.price)

  if (Number.isFinite(priceDist) && priceDist > 0) {
    return priceDist
  }

  return Math.hypot(b.x - a.x, b.y - a.y)
}

function ratioText(numerator: number, denominator: number) {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    Math.abs(denominator) < 0.000001
  ) {
    return '--'
  }

  return (numerator / denominator).toFixed(3)
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  }
}

function getWedgeArcSpec(
  center: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
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

function getHandlePixelPoint(
  tool: Drawing['tool'],
  point: { x: number; y: number },
  clip: { x: number; y: number; width: number; height: number },
) {
  if (tool === 'horizontal') return { x: clip.x + clip.width / 2, y: point.y }
  if (tool === 'text' || tool === 'anchoredtext') return { x: point.x - 6, y: point.y + 6 }
  return point
}

function getDrawingClipRect(canvas: HTMLCanvasElement, chart: IChartApi | null) {
  const priceScaleWidth = chart?.priceScale('right').width() ?? 0
  const timeScaleHeight = chart?.timeScale().height() ?? 0
  return {
    x: 0,
    y: 0,
    width: Math.max(0, canvas.width - priceScaleWidth),
    height: Math.max(0, canvas.height - timeScaleHeight),
  }
}

function drawCursor(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  cursorMode: CursorMode,
  activeTool: Drawing['tool'],
  mousePosition: { x: number; y: number } | null,
) {
  if (!mousePosition) return
  const { x, y } = mousePosition

  ctx.save()
  if (cursorMode === 'cross' || activeTool === 'crossline') {
    ctx.strokeStyle = 'rgba(156,163,175,0.25)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(canvas.width, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, canvas.height)
    ctx.stroke()
    ctx.setLineDash([])
  } else if (cursorMode === 'dot') {
    ctx.fillStyle = 'rgba(99,102,241,0.75)'
    ctx.beginPath()
    ctx.arc(x, y, 3.5, 0, Math.PI * 2)
    ctx.fill()
  } else if (cursorMode === 'eraser') {
    ctx.strokeStyle = 'rgba(226,232,240,0.92)'
    ctx.fillStyle = 'rgba(15,23,42,0.88)'
    ctx.lineWidth = 1.35
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.translate(x + 5, y + 5)
    ctx.rotate(-0.55)
    ctx.beginPath()
    ctx.roundRect(-7, -4, 13, 8, 1.8)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-2, -4)
    ctx.lineTo(-2, 4)
    ctx.stroke()
  }
  ctx.restore()
}

function toPixelPoint(
  point: Point,
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
  candles: Candle[] = [],
  drawing?: Drawing,
): PixelPoint {
  if (drawing && TEXT_TOOLS.has(drawing.tool) && (drawing.anchored || drawing.tool === 'anchoredtext' || drawing.tool === 'anchorednote')) {
    return { x: point.x, y: point.y, price: point.price, time: point.time, logical: point.logical }
  }

  const sx = timeToAnchoredCoordinate(chart, candles, point) ?? point.x
  const sy = point.price > 0 && point.price < 1e7
    ? candleSeries?.priceToCoordinate(point.price) ?? point.y
    : point.y

  return { x: sx ?? point.x, y: sy ?? point.y, price: point.price, time: point.time, logical: point.logical }
}

function drawByTool(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  drawing: Drawing,
  points: PixelPoint[],
  candles: Candle[],
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
  isSelected = false,
  isEditingText = false,
  textCursorVisible = false,
  priceFormatter: (price: number) => string = formatPriceLabel,
) {
  switch (drawing.tool) {
    case 'trendline':
      drawLine(ctx, points)
      break
    case 'infoline':
      drawInfoLine(ctx, canvas, points)
      break
    case 'horizontal':
      drawHorizontal(ctx, canvas, points)
      break
    case 'rectangle':
      drawRectangle(ctx, points)
      break
    case 'fibonacci':
      drawFibonacci(ctx, canvas, points, isSelected)
      break
    case 'pitchfork':
    case 'schiffpitchfork':
    case 'modifiedschiffpitchfork':
    case 'insidepitchfork':
      if (points.length < 3) {
        // Preview: draw a line from point[0] to mouse (point[1] if exists)
        if (points.length >= 2) {
          ctx.save()
          ctx.strokeStyle = '#f23645'
          ctx.lineWidth = 1.55
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(points[0].x, points[0].y)
          ctx.lineTo(points[1].x, points[1].y)
          ctx.stroke()
          // draw the two anchor dots
          ;[points[0], points[1]].forEach(p => {
            ctx.fillStyle = '#fff'
            ctx.beginPath()
            ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#2962ff'
            ctx.lineWidth = 2
            ctx.stroke()
          })
          ctx.restore()
        } else if (points.length === 1) {
          // single dot so user knows placement started
          ctx.save()
          ctx.fillStyle = '#fff'
          ctx.strokeStyle = '#2962ff'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(points[0].x, points[0].y, 5.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
      } else if (drawing.tool === 'schiffpitchfork' || drawing.tool === 'modifiedschiffpitchfork' || drawing.tool === 'insidepitchfork') {
        drawSchiffPitchfork(ctx, points, isSelected, drawing.tool)
      } else {
        drawPitchfork(ctx, points, isSelected)
      }
      break
    case 'ray':
      drawRay(ctx, points)
      break
    case 'extendedline':
      drawExtendedLine(ctx, points)
      break
    case 'trendangle':
      drawTrendAngle(ctx, points)
      break
    case 'horizontalray':
      drawHorizontalRay(ctx, canvas, points)
      break
    case 'vertical':
      drawVertical(ctx, canvas, points)
      break
    case 'crossline':
      drawCrossLine(ctx, canvas, points)
      break
    case 'regressiontrend':
      drawRegressionTrend(ctx, points, candles, chart, candleSeries, drawing.color)
      break
    case 'flattopbottom':
      drawFlatTopBottom(ctx, points)
      break
    case 'disjointchannel':
      drawDisjointChannel(ctx, points)
      break
    case 'parallelchannel':
      drawParallelChannel(ctx, points)
      break

    case 'fibchannel':
      drawFibChannel(ctx, points)
      break

    case 'trendbasedfibextension':
      drawTrendBasedFibExtension(ctx, points, candleSeries)
      break
    case 'fibtimezone':
      drawFibTimeZone(ctx, canvas, chart, points)
      break

    case 'trendbasedfibtime':
      drawTrendBasedFibTime(ctx, canvas, chart, points)
      break
    case 'fibspeedresistancefan':
      drawFibSpeedResistanceFan(ctx, points)
      break

    case 'fibfan':
      drawFibFan(ctx, points)
      break

    case 'gannfan':
      drawGannFan(ctx, points)
      break

    case 'pitchfan':
      drawPitchFan(ctx, points)
      break
    case 'fibcircles':
      drawFibCircles(ctx, points)
      break
    case 'fibspiral':
      drawFibSpiral(ctx, canvas, points)
      break

    case 'fibspeedresistancearcs':
      drawFibSpeedResistanceArcs(ctx, points)
      break

    case 'fibwedge':
      drawFibWedge(ctx, points)
      break
    case 'gannbox':
      drawGannBox(ctx, points)
      break

    case 'gannsquarefixed':
      drawGannSquareFixed(ctx, points)
      break

    case 'gannsquare':
      drawGannSquare(ctx, points)
      break
    case 'xabcdpattern':
      drawXABCDPattern(ctx, points, drawing.color)
      break

    case 'cypherpattern':
      drawCypherPattern(ctx, points, drawing.color)
      break
    case 'headandshoulders':
      drawHeadAndShoulders(ctx, points)
      break
    case 'abcdpattern':
      drawABCDPattern(ctx, points)
      break
    case 'trianglepattern':
      drawTrianglePattern(ctx, points)
      break
    case 'threedrivespattern':
      drawThreeDrivesPattern(ctx, points, drawing.color)
      break
    case 'elliottimpulse':
      drawElliottImpulseWave(ctx, points)
      break
    case 'elliottcorrection':
      drawElliottCorrectionWave(ctx, points)
      break
    case 'elliotttriangle':
      drawElliottTriangleWave(ctx, points)
      break
    case 'elliottdoublecombo':
      drawElliottDoubleComboWave(ctx, points)
      break
    case 'elliotttriplecombo':
      drawElliottTripleComboWave(ctx, points)
      break
    case 'cycliclines':
      drawCyclicLines(ctx, canvas, points, drawing.color)
      break
    case 'timecycles':
      drawTimeCycles(ctx, canvas, points, drawing.color)
      break
    case 'sineline':
      drawSineLine(ctx, canvas, points, drawing.color)
      break
    case 'longposition':
      drawPosition(ctx, points, 'long', candles, chart, candleSeries, isSelected)
      break
    case 'shortposition':
      drawPosition(ctx, points, 'short', candles, chart, candleSeries, isSelected)
      break
    case 'forecast':
      drawForecast(ctx, points, candles, false, drawing.color)
      break
    case 'ghostfeed':
      drawGhostFeed(ctx, points, chart)
      break
    case 'barspattern':
      drawBarsPatternShadow(ctx, points, candles, chart, candleSeries)
      break
    case 'projection':
      drawProjection(ctx, points)
      break
    case 'anchoredvwap':
      drawAnchoredVwap(ctx, points, candles, chart, candleSeries)
      break
    case 'fixedrangevolumeprofile':
      drawFixedRangeVolumeProfile(ctx, canvas, points, candles, chart, candleSeries, drawing.id === '__preview' || drawing.lineWidth === -999)
      break
    case 'pricerange':
      drawPriceRange(ctx, points)
      break
    case 'daterange':
      drawDateRange(ctx, points, candles, chart)
      break
    case 'dateandpricerange':
      drawDateAndPriceRange(ctx, points, candles, chart)
      break
    case 'brush':
      drawSmoothPath(ctx, points, false)
      break
    case 'highlighter':
      drawSmoothPath(ctx, points, true)
      break
    case 'arrowmarker':
      drawArrowMarker(ctx, points)
      break
    case 'arrow':
      drawArrowLine(ctx, points)
      break
    case 'arrowmarkup':
      drawArrowMark(ctx, points, 'up', drawing.color)
      break
    case 'arrowmarkdown':
      drawArrowMark(ctx, points, 'down', drawing.color)
      break
    case 'arrowmarkleft':
      drawArrowMark(ctx, points, 'left', drawing.color)
      break
    case 'arrowmarkright':
      drawArrowMark(ctx, points, 'right', drawing.color)
      break
    case 'rotatedrectangle':
      drawRotatedRectangle(ctx, points)
      break
    case 'path':
      drawPathWithArrow(ctx, points)
      break
    case 'polyline':
      drawPatternPolyline(ctx, points, [])
      break
    case 'circle':
      drawCircle(ctx, points)
      break
    case 'arc':
      drawArc(ctx, points)
      break
    case 'curve':
      drawCurve(ctx, points)
      break
    case 'doublecurve':
      drawDoubleCurve(ctx, points)
      break
    case 'text':
      drawTextNote(ctx, points, drawing.text ?? '', 'plain', drawing, isSelected, isEditingText, textCursorVisible)
      break
    case 'anchoredtext':
      drawTextNote(ctx, points, drawing.text ?? '', 'plain', drawing, isSelected, isEditingText, textCursorVisible)
      break
    case 'note':
      drawTextNote(ctx, points, drawing.text ?? '', 'note', drawing, isSelected, isEditingText, textCursorVisible)
      break
    case 'anchorednote':
      drawTextNote(ctx, points, drawing.text ?? '', 'note', drawing, isSelected, isEditingText, textCursorVisible)
      break
    case 'callout':
      drawTextNote(ctx, points, drawing.text ?? '', 'callout', drawing, isSelected, isEditingText, textCursorVisible)
      break
    case 'comment':
      drawTextNote(ctx, points, drawing.text ?? '', 'comment', drawing, isSelected, isEditingText, textCursorVisible)
      break
    case 'pricelabel':
      {
        const label = points[0] ? priceFormatter(points[0].price) : 'Price'
        drawTextNote(ctx, points, label, 'price-label', { ...drawing, text: label }, isSelected)
      }
      break
    case 'signpost':
      drawTextNote(ctx, points, drawing.text ?? '', 'signpost', drawing, isSelected, isEditingText, textCursorVisible)
      break
    case 'flagmark':
      drawTextNote(ctx, points, drawing.text ?? '', 'flag', drawing, isSelected)
      break
    case 'ellipse':
      drawEllipse(ctx, points)
      break
    case 'triangle':
      drawTriangle(ctx, points)
      break
  }
}

function extendRayFar(
  from: { x: number; y: number },
  through: { x: number; y: number },
  distance = 100000,
) {
  const dx = through.x - from.x
  const dy = through.y - from.y
  const len = Math.hypot(dx, dy)

  if (len < 0.001) return through

  return {
    x: from.x + (dx / len) * distance,
    y: from.y + (dy / len) * distance,
  }
}

function drawLine(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  ctx.lineTo(points[1].x, points[1].y)
  ctx.stroke()
}

function drawInfoLine(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, points: PixelPoint[]) {
  if (points.length < 2) return
  const [start, end] = points
  drawLine(ctx, points)
  if (!segmentIntersectsRect(start, end, 0, 0, canvas.width, canvas.height)) return

  const dx = end.x - start.x
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy)
  const priceDelta = end.price - start.price
  const percent = start.price !== 0 ? (priceDelta / start.price) * 100 : 0
  const bars = getInfoLineBars(start, end, dx)
  const duration = getInfoLineDuration(start, end)
  const angle = Math.atan2(start.y - end.y, end.x - start.x) * 180 / Math.PI
  const decimals = Math.max(1, Math.min(5, Math.abs(priceDelta) < 10 ? 3 : 1))
  const valueText = `${formatSigned(priceDelta, decimals)} (${formatSigned(percent, 2)}%), ${end.price.toFixed(3)}`
  const barsText = `${bars} bars${duration ? ` (${duration})` : ''}, distance: ${Math.round(distance)} px`
  const angleText = `${Math.round(angle)}°`
  const rows = [
    { icon: '↕', text: valueText },
    { icon: '↔', text: barsText },
    { icon: '∠', text: angleText },
  ]

  drawInfoLinePanel(ctx, canvas, start, end, rows)
}

function drawInfoLinePanel(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  start: PixelPoint,
  end: PixelPoint,
  rows: { icon: string; text: string }[],
) {
  ctx = getRawDrawingContext(ctx)
  ctx.save()
  ctx.font = '12px Arial, Vazirmatn, sans-serif'
  const iconWidth = 21
  const paddingX = 10
  const paddingY = 9
  const rowHeight = 23
  const textWidth = Math.max(...rows.map(row => ctx.measureText(row.text).width))
  const width = Math.min(Math.max(190, Math.ceil(iconWidth + textWidth + paddingX * 2 + 8)), canvas.width - 16)
  const height = paddingY * 2 + rowHeight * rows.length
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2
  const leftPoint = start.x <= end.x ? start : end
  const rightPoint = start.x <= end.x ? end : start
  const leftToRightDy = rightPoint.y - leftPoint.y
  const gap = 10
  const x = Math.max(8, Math.min(canvas.width - width - 8, midX + gap))
  const preferredY = leftToRightDy >= 0
    ? midY - height - gap
    : midY + gap
  const y = Math.max(44, Math.min(canvas.height - height - 12, preferredY))

  const styles = getComputedStyle(canvas)
  const chartBg = styles.getPropertyValue('--chart-bg').trim() || '#ffffff'
  const chartText = styles.getPropertyValue('--chart-text').trim() || '#131722'
  const chartAxis = styles.getPropertyValue('--chart-axis').trim() || 'rgba(34, 56, 67, 0.12)'

  ctx.shadowColor = 'rgba(0, 0, 0, 0.14)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 6
  ctx.globalAlpha = 0.82
  ctx.fillStyle = chartBg
  ctx.strokeStyle = chartAxis
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, 3)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.shadowColor = 'transparent'
  ctx.stroke()

  ctx.fillStyle = chartText
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  rows.forEach((row, index) => {
    const rowY = y + paddingY + rowHeight * index + rowHeight / 2
    ctx.font = '16px Arial, Vazirmatn, sans-serif'
    ctx.fillText(row.icon, x + paddingX, rowY)
    ctx.font = '12px Arial, Vazirmatn, sans-serif'
    ctx.fillText(row.text, x + paddingX + iconWidth + 6, rowY)
  })
  ctx.restore()
}

function getInfoLineBars(start: PixelPoint, end: PixelPoint, dx: number) {
  const logicalStart = Number(start.logical)
  const logicalEnd = Number(end.logical)
  if (Number.isFinite(logicalStart) && Number.isFinite(logicalEnd)) {
    return Math.max(0, Math.round(Math.abs(logicalEnd - logicalStart)))
  }
  return Math.max(0, Math.round(Math.abs(dx) / 8))
}

function getInfoLineDuration(start: PixelPoint, end: PixelPoint) {
  if (start.time == null || end.time == null) return ''
  const seconds = Math.abs(end.time - start.time)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes || parts.length === 0) parts.push(`${minutes}m`)
  return parts.join(' ')
}

function formatSigned(value: number, decimals: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}`
}

function segmentIntersectsRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  if (pointInRect(start, left, top, right, bottom) || pointInRect(end, left, top, right, bottom)) return true
  return (
    segmentsIntersect(start, end, { x: left, y: top }, { x: right, y: top }) ||
    segmentsIntersect(start, end, { x: right, y: top }, { x: right, y: bottom }) ||
    segmentsIntersect(start, end, { x: right, y: bottom }, { x: left, y: bottom }) ||
    segmentsIntersect(start, end, { x: left, y: bottom }, { x: left, y: top })
  )
}

function pointInRect(point: { x: number; y: number }, left: number, top: number, right: number, bottom: number) {
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
}

function segmentsIntersect(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) {
  const ccw = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (r.y - p.y) * (q.x - p.x) > (q.y - p.y) * (r.x - p.x)
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)
}

function drawHorizontal(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, points: PixelPoint[]) {
  if (points.length < 1) return
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(0, points[0].y)
  ctx.lineTo(canvas.width, points[0].y)
  ctx.stroke()
  ctx.font = '10px Vazirmatn, sans-serif'
  ctx.fillText(points[0].price.toFixed(5), 4, points[0].y - 4)
}

function drawRectangle(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const left = Math.min(points[0].x, points[1].x)
  const right = Math.max(points[0].x, points[1].x)
  const top = Math.min(points[0].y, points[1].y)
  const bottom = Math.max(points[0].y, points[1].y)
  ctx.save()
  ctx.strokeStyle = '#9c27b0'
  ctx.fillStyle = 'rgba(156, 39, 176, 0.18)'
  ctx.lineWidth = 1.5
  ctx.fillRect(left, top, right - left, bottom - top)
  ctx.strokeRect(left, top, right - left, bottom - top)
  ctx.restore()
}

function drawFibonacci(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, points: PixelPoint[], isSelected = false) {  if (points.length < 2) return

  const p0 = points[0]
  const p1 = points[1]

  const startPrice = p0.price
  const endPrice = p1.price
  const range = startPrice - endPrice

  const yAtLevel = (level: number) => p0.y + (p1.y - p0.y) * level

  // ── محدوده خطوط فقط بین دو anchor point ──
  const lineLeft = Math.min(p0.x, p1.x)
  const lineRight = Math.max(p0.x, p1.x)

  // لیبل‌ها بیرون از ناحیه — سمت چپ از lineLeft
  const labelX = lineLeft - 6

  ctx.save()
  ctx.font = '11px Vazirmatn, Inter, sans-serif'

  // Draw zone fills between consecutive levels
  for (let i = 0; i < FIB_LEVELS.length - 1; i++) {
    const y1 = yAtLevel(FIB_LEVELS[i])
    const y2 = yAtLevel(FIB_LEVELS[i + 1])
    const topY = Math.min(y1, y2)
    const botY = Math.max(y1, y2)
    ctx.fillStyle = FIB_ZONE_COLORS[i] ?? 'rgba(120,123,134,0.05)'
    ctx.fillRect(lineLeft, topY, lineRight - lineLeft, botY - topY)
  }

  // Draw level lines and labels
  FIB_LEVELS.forEach((level, i) => {
    const y = yAtLevel(level)
    const price = (startPrice - range * level).toFixed(3)
    const color = FIB_LINE_COLORS[i] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(lineLeft, y)
    ctx.lineTo(lineRight, y)
    ctx.stroke()

    // لیبل بیرون از فیب — سمت چپ، راست‌چین
    const labelText = `${level} (${price})`
    ctx.fillStyle = color
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(labelText, labelX, y)
  })

  // Dashed connector line between anchors
  ctx.strokeStyle = 'rgba(150,150,150,0.6)'
  ctx.lineWidth = 1
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(p0.x, p0.y)
  ctx.lineTo(p1.x, p1.y)
  ctx.stroke()
  ctx.setLineDash([])

  // Anchor circles
  // بعد: فقط وقتی isSelected
  if (isSelected) {
    ;[p0, p1].forEach(p => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
      ctx.fillStyle = canvas.style.backgroundColor || '#131722'
      ctx.fill()
      ctx.strokeStyle = '#9598a1'
      ctx.lineWidth = 1.5
      ctx.stroke()
    })
  }

  ctx.restore()
}

function drawPitchfork(ctx: CanvasRenderingContext2D, points: PixelPoint[], isSelected = false) {
  if (points.length < 3) return
  const [a, b, c] = points
  // Andrews: median starts at A (same x AND y as A)
  drawPitchforkCore(ctx, a, a, b, c, isSelected)
}

/**
 * Core pitchfork renderer — all variants share this.
 *
 * Points A, B, C are the three user-placed anchors.
 * @param a         - First anchor (A) — also the visible handle dot
 * @param rayOrigin - Where the median line STARTS (x is always a.x; y varies per variant)
 * @param b         - Second anchor (upper tine root)
 * @param c         - Third anchor (lower tine root)
 *
 * Visual anatomy (matches reference image):
 *   1. Red segment: A → B  (handle bar connecting first two nodes)
 *   2. Red median : starts at { x: a.x, y: midpoint(B,C).y } → extends right
 *      The median y-start is determined ONLY by B (and C for midpoint).
 *      A's position does NOT affect where the median starts vertically.
 *   3. Blue tines : from B and C, parallel to median direction, extended right
 *   4. Green inner: quartile lines between tines and median, same direction
 *   5. Fills       : blue outer bands, green inner band
 *
 * Direction vector = medianMid - rayOrigin, extended to scale 6000.
 * Tine roots (B, C) extend with the SAME dx/dy as the median.
 */

function drawPitchforkCore(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  rayOrigin: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  isSelected = false,
) {
  // medianMid is the point the median line aims THROUGH (midpoint of B and C)
  const medianMid = getMidpoint(b, c)

  // Direction vector from rayOrigin → medianMid
  const dx = medianMid.x - rayOrigin.x
  const dy = medianMid.y - rayOrigin.y
  const len = Math.hypot(dx, dy)
  if (len < 0.001) return

  const scale = 6000 / len
  const ex = dx * scale
  const ey = dy * scale

  // ── Key points ────────────────────────────────────────────
  // Median: starts at rayOrigin, passes through medianMid, extends far
  const medianEnd = { x: medianMid.x + ex, y: medianMid.y + ey }

  // Tines: B and C each extend parallel to the median direction
  const bEnd = { x: b.x + ex, y: b.y + ey }
  const cEnd = { x: c.x + ex, y: c.y + ey }

  // Quartile inner lines: at midpoint between each tine and the median
  // Their start points lie on the vertical from medianMid toward B/C
  const upperInnerStart = getMidpoint(b, medianMid)
  const lowerInnerStart = getMidpoint(medianMid, c)
  const upperInnerEnd = { x: upperInnerStart.x + ex, y: upperInnerStart.y + ey }
  const lowerInnerEnd = { x: lowerInnerStart.x + ex, y: lowerInnerStart.y + ey }

  // ── Colors ────────────────────────────────────────────────
  const outerColor = '#2962ff'
  const innerColor = '#00897b'
  const medianColor = '#f23645'

  ctx.save()
  ctx.setLineDash([])

  // ── Fill bands ────────────────────────────────────────────
  // Upper outer band (blue): B → bEnd → upperInnerEnd → upperInnerStart
  ctx.globalAlpha = 0.18
  ctx.fillStyle = outerColor
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(bEnd.x, bEnd.y)
  ctx.lineTo(upperInnerEnd.x, upperInnerEnd.y)
  ctx.lineTo(upperInnerStart.x, upperInnerStart.y)
  ctx.closePath()
  ctx.fill()

  // Lower outer band (blue): lowerInnerStart → lowerInnerEnd → cEnd → C
  ctx.beginPath()
  ctx.moveTo(lowerInnerStart.x, lowerInnerStart.y)
  ctx.lineTo(lowerInnerEnd.x, lowerInnerEnd.y)
  ctx.lineTo(cEnd.x, cEnd.y)
  ctx.lineTo(c.x, c.y)
  ctx.closePath()
  ctx.fill()

  // Inner band (green): upperInnerStart → upperInnerEnd → lowerInnerEnd → lowerInnerStart
  ctx.globalAlpha = 0.16
  ctx.fillStyle = innerColor
  ctx.beginPath()
  ctx.moveTo(upperInnerStart.x, upperInnerStart.y)
  ctx.lineTo(upperInnerEnd.x, upperInnerEnd.y)
  ctx.lineTo(lowerInnerEnd.x, lowerInnerEnd.y)
  ctx.lineTo(lowerInnerStart.x, lowerInnerStart.y)
  ctx.closePath()
  ctx.fill()

  ctx.globalAlpha = 1

  // ── Outer tines: B and C extended ────────────────────────
  ctx.strokeStyle = outerColor
  ctx.lineWidth = 1.7
  drawSegment(ctx, b.x, b.y, bEnd.x, bEnd.y)
  drawSegment(ctx, c.x, c.y, cEnd.x, cEnd.y)

  // ── Inner quartile lines ──────────────────────────────────
  ctx.strokeStyle = innerColor
  ctx.lineWidth = 1.4
  drawSegment(ctx, upperInnerStart.x, upperInnerStart.y, upperInnerEnd.x, upperInnerEnd.y)
  drawSegment(ctx, lowerInnerStart.x, lowerInnerStart.y, lowerInnerEnd.x, lowerInnerEnd.y)

  // ── Red lines ─────────────────────────────────────────────
  ctx.strokeStyle = medianColor
  ctx.lineWidth = 1.55

  // Handle bar A -> B: only for Schiff variants (rayOrigin is a different object than a)
  if (rayOrigin !== a) {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  // Median: from rayOrigin extending through medianMid forward
  drawSegment(ctx, rayOrigin.x, rayOrigin.y, medianEnd.x, medianEnd.y)

  // ── Selection handles on A, B, C ─────────────────────────
  if (isSelected) {
    ;[a, b, c].forEach(pt => drawPitchforkHandle(ctx, pt.x, pt.y))
  }

  ctx.restore()
}

function drawPitchforkHandle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx = getRawDrawingContext(ctx)
  ctx.save()
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  ctx.lineWidth = 2
  ctx.strokeStyle = '#2962ff'
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(x, y, 5.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawRay(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const dx = points[1].x - points[0].x
  const dy = points[1].y - points[0].y
  const len = Math.hypot(dx, dy)
  if (len === 0) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  ctx.lineTo(points[0].x + (dx / len) * 3000, points[0].y + (dy / len) * 3000)
  ctx.stroke()
}

function drawExtendedLine(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const dx = points[1].x - points[0].x
  const dy = points[1].y - points[0].y
  const len = Math.hypot(dx, dy)
  if (len === 0) return
  ctx.beginPath()
  ctx.moveTo(points[0].x - (dx / len) * 3000, points[0].y - (dy / len) * 3000)
  ctx.lineTo(points[1].x + (dx / len) * 3000, points[1].y + (dy / len) * 3000)
  ctx.stroke()
}

function drawTrendAngle(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const [start, end] = points
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.hypot(dx, dy) < 0.001) return

  const previousStroke = ctx.strokeStyle
  const previousFill = ctx.fillStyle
  const previousWidth = ctx.lineWidth
  const color = String(previousStroke)
  const rawAngle = Math.atan2(start.y - end.y, end.x - start.x) * 180 / Math.PI
  const angle = Math.round(rawAngle)
  const radius = Math.min(48, Math.max(28, Math.hypot(dx, dy) * 0.18))
  const baseAngle = dx >= 0 ? 0 : Math.PI
  const lineAngle = Math.atan2(dy, dx)
  const anticlockwise = dy < 0

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = previousWidth || 1.5
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()

  ctx.setLineDash([2, 2])
  ctx.globalAlpha = 0.72
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(start.x + Math.sign(dx || 1) * radius, start.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(start.x, start.y, radius, baseAngle, lineAngle, anticlockwise)
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.setLineDash([])

  const labelAngle = baseAngle + shortestAngleDelta(baseAngle, lineAngle) * 0.52
  const labelX = start.x + Math.cos(labelAngle) * (radius + 17)
  const labelY = start.y + Math.sin(labelAngle) * (radius + 17)
  ctx.font = '12px Arial, Vazirmatn, sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${angle}°`, labelX, labelY)
  ctx.restore()

  ctx.strokeStyle = previousStroke
  ctx.fillStyle = previousFill
  ctx.lineWidth = previousWidth
}

function shortestAngleDelta(from: number, to: number) {
  let delta = to - from
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

function drawHorizontalRay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, points: PixelPoint[]) {
  if (points.length < 1) return
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  ctx.lineTo(canvas.width, points[0].y)
  ctx.stroke()
  ctx.font = '10px Vazirmatn, sans-serif'
  ctx.fillText(points[0].price.toFixed(5), canvas.width - 60, points[0].y - 4)
}

function drawVertical(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, points: PixelPoint[]) {
  if (points.length < 1) return
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(points[0].x, 0)
  ctx.lineTo(points[0].x, canvas.height)
  ctx.stroke()
}

function drawCrossLine(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, points: PixelPoint[]) {
  if (points.length < 1) return
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(0, points[0].y)
  ctx.lineTo(canvas.width, points[0].y)
  ctx.moveTo(points[0].x, 0)
  ctx.lineTo(points[0].x, canvas.height)
  ctx.stroke()
}

function drawParallelChannel(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const [start, end] = points
  const widthPoint = points[2]
  if (!widthPoint) {
    drawLine(ctx, points)
    return
  }

  const offsetY = widthPoint.y - yOnLineAtX(start, end, widthPoint.x)
  const parallelStart = { ...start, y: start.y + offsetY }
  const parallelEnd = { ...end, y: end.y + offsetY }
  const middleStart = { ...start, y: start.y + offsetY / 2 }
  const middleEnd = { ...end, y: end.y + offsetY / 2 }

  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(parallelStart.x, parallelStart.y)
  ctx.lineTo(parallelEnd.x, parallelEnd.y)
  ctx.stroke()

  ctx.setLineDash([5, 5])
  ctx.beginPath()
  ctx.moveTo(middleStart.x, middleStart.y)
  ctx.lineTo(middleEnd.x, middleEnd.y)
  ctx.stroke()
  ctx.setLineDash([])

  if (widthPoint) {
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(parallelStart.x, parallelStart.y)
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(parallelEnd.x, parallelEnd.y)
    ctx.stroke()
    ctx.globalAlpha = 0.08
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.lineTo(parallelEnd.x, parallelEnd.y)
    ctx.lineTo(parallelStart.x, parallelStart.y)
    ctx.closePath()
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

function drawFlatTopBottom(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const [start, end] = points
  const heightPoint = points[2]
  if (!heightPoint) {
    drawLine(ctx, points)
    return
  }

  const horizontalY = heightPoint.y
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(start.x, horizontalY)
  ctx.lineTo(end.x, horizontalY)
  ctx.stroke()

  ctx.globalAlpha = 0.08
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.lineTo(end.x, horizontalY)
  ctx.lineTo(start.x, horizontalY)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
}

function drawDisjointChannel(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const [start, end, inverseStart] = points
  if (!inverseStart) {
    drawLine(ctx, points)
    return
  }

  const anchoredInverseStart = { x: end.x, y: inverseStart.y }
  const inverseEnd = getDisjointInverseEnd(start, end, anchoredInverseStart)

  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(anchoredInverseStart.x, anchoredInverseStart.y)
  ctx.lineTo(inverseEnd.x, inverseEnd.y)
  ctx.stroke()

  ctx.globalAlpha = 0.35
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(inverseEnd.x, inverseEnd.y)
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(anchoredInverseStart.x, anchoredInverseStart.y)
  ctx.stroke()

  ctx.globalAlpha = 0.12
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.lineTo(anchoredInverseStart.x, anchoredInverseStart.y)
  ctx.lineTo(inverseEnd.x, inverseEnd.y)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
}

function drawRegressionTrend(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  candles: Candle[],
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
  color: string,
) {
  if (points.length < 2 || candles.length < 2 || !chart || !candleSeries) {
    drawLine(ctx, points)
    return
  }

  const startIndex = getCandleIndexForPoint(points[0], candles)
  const endIndex = getCandleIndexForPoint(points[1], candles)
  if (startIndex === null || endIndex === null) {
    drawLine(ctx, points)
    return
  }

  const from = Math.max(0, Math.min(candles.length - 1, Math.min(startIndex, endIndex)))
  const to = Math.max(0, Math.min(candles.length - 1, Math.max(startIndex, endIndex)))
  const count = to - from + 1
  if (count < 2) {
    drawLine(ctx, points)
    return
  }

  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = from; i <= to; i++) {
    const x = i
    const y = candles[i].close
    sumX += x
    sumY += y
    sumXY += x * y
    sumXX += x * x
  }

  const denominator = count * sumXX - sumX * sumX
  if (Math.abs(denominator) < 0.000001) {
    drawLine(ctx, points)
    return
  }

  const slope = (count * sumXY - sumX * sumY) / denominator
  const intercept = (sumY - slope * sumX) / count
  let residualSum = 0
  for (let i = from; i <= to; i++) {
    const base = slope * i + intercept
    const residual = candles[i].close - base
    residualSum += residual * residual
  }
  const deviation = Math.sqrt(residualSum / count)
  const channelDeviation = deviation * REGRESSION_DEVIATION_MULTIPLIER

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
    drawLine(ctx, points)
    return
  }

  ctx.save()
  ctx.globalAlpha = 0.28
  ctx.fillStyle = '#2563ff'
  ctx.beginPath()
  ctx.moveTo(leftX, leftUpperY)
  ctx.lineTo(rightX, rightUpperY)
  ctx.lineTo(rightX, rightY)
  ctx.lineTo(leftX, leftY)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#ff4d5d'
  ctx.beginPath()
  ctx.moveTo(leftX, leftY)
  ctx.lineTo(rightX, rightY)
  ctx.lineTo(rightX, rightLowerY)
  ctx.lineTo(leftX, leftLowerY)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.setLineDash([])
  drawSegment(ctx, leftX, leftUpperY, rightX, rightUpperY)
  drawSegment(ctx, leftX, leftLowerY, rightX, rightLowerY)
  ctx.setLineDash([5, 5])
  drawSegment(ctx, leftX, leftY, rightX, rightY)
  ctx.setLineDash([])
  ctx.fillStyle = color
  ctx.font = '10px Vazirmatn, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const labelX = Math.min(leftX, rightX) + 4
  const labelY = (leftX <= rightX ? leftLowerY : rightLowerY) + 6
  ctx.fillText(channelDeviation.toPrecision(14), labelX, labelY)
  ctx.restore()
}

function drawSegment(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function yOnLineAtX(start: { x: number; y: number }, end: { x: number; y: number }, x: number) {
  const dx = end.x - start.x
  if (Math.abs(dx) < 0.0001) return start.y
  const t = (x - start.x) / dx
  return start.y + (end.y - start.y) * t
}

function drawTrendBasedFibTime(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  chart: IChartApi | null,
  points: PixelPoint[],
) {
  if (points.length < 1) return

  const [p1, p2, p3] = points

  // preview: فقط یک نقطه
  if (points.length === 1) {
    return
  }

  // preview: فقط trend line
  if (points.length === 2) {
    ctx.save()
    ctx.strokeStyle = '#7b8494'
    ctx.lineWidth = 1.4
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
    return
  }

  if (!p2 || !p3) return

  const clip = getDrawingClipRect(canvas, chart)
  const chartBottomY = clip.y + clip.height

  const baseDeltaX = p2.x - p1.x
  if (Math.abs(baseDeltaX) < 0.001) return

  const levels = [0, 0.382, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3]
  const colors = [
    '#787b86',
    '#f23645',
    '#4caf50',
    '#089981',
    '#00bcd4',
    '#787b86',
    '#2962ff',
    '#e91e63',
    '#9c27b0',
    '#7c4dff',
  ]

  const xAtLevel = (level: number) => p3.x + baseDeltaX * level

  ctx.save()

  // background bands
  for (let i = 0; i < levels.length - 1; i++) {
    const x1 = xAtLevel(levels[i])
    const x2 = xAtLevel(levels[i + 1])

    ctx.fillStyle = i % 2 === 0
      ? 'rgba(242,54,69,0.08)'
      : 'rgba(76,175,80,0.08)'

    ctx.fillRect(
      Math.min(x1, x2),
      0,
      Math.abs(x2 - x1),
      chartBottomY,
    )
  }

  // vertical lines + labels
  ctx.font = '11px Vazirmatn, Inter, sans-serif'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'

  levels.forEach((level, i) => {
    const x = xAtLevel(level)
    const color = colors[i] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1.4
    ctx.setLineDash([])

    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, chartBottomY)
    ctx.stroke()

    // label پایین چارت، سمت راست خط
    ctx.fillText(String(level), x + 3, chartBottomY - 3)
  })

  // dashed guide path: p1 -> p2 -> p3
  ctx.strokeStyle = '#7b8494'
  ctx.lineWidth = 1.5
  ctx.setLineDash([8, 8])
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.lineTo(p3.x, p3.y)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.restore()
}

function drawFibSpeedResistanceArcs(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  const [p0, p1] = points

  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const baseRadius = Math.hypot(dx, dy)

  if (baseRadius < 0.001) return

  const levels = FIB_SPEED_ARC_LEVELS
  const { upward, startAngle, endAngle, anticlockwise, labelYOffsetSign } =
    getFibArcAngles(p0, p1)

  ctx.save()

  // dashed trend line
  ctx.strokeStyle = '#7b8494'
  ctx.lineWidth = 1.5
  ctx.setLineDash([8, 8])
  ctx.beginPath()
  ctx.moveTo(p0.x, p0.y)
  ctx.lineTo(p1.x, p1.y)
  ctx.stroke()
  ctx.setLineDash([])

  // fill bands between arcs
  for (let i = levels.length - 1; i >= 1; i--) {
    const outerLevel = levels[i]
    const innerLevel = levels[i - 1]

    const outerR = baseRadius * outerLevel
    const innerR = baseRadius * innerLevel

    ctx.fillStyle = FIB_ZONE_COLORS[i - 1] ?? 'rgba(120,123,134,0.06)'

    ctx.beginPath()

    // outer semicircle
    ctx.arc(p0.x, p0.y, outerR, startAngle, endAngle, anticlockwise)

    if (innerLevel > 0) {
      // وصل کردن outer به inner از سمت راست
      ctx.lineTo(p0.x + innerR, p0.y)

      // inner semicircle برعکس outer برای hollow ring
      ctx.arc(p0.x, p0.y, innerR, endAngle, startAngle, !anticlockwise)
    } else {
      ctx.lineTo(p0.x, p0.y)
    }

    ctx.closePath()
    ctx.fill()
  }

  // arc outlines + labels
  ctx.font = '11px Vazirmatn, Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = upward ? 'bottom' : 'top'

  levels.forEach((level, i) => {
    const radius = baseRadius * level
    const color = FIB_LINE_COLORS[i] ?? '#787b86'

    if (level <= 0) {
      ctx.fillStyle = color
      ctx.fillText(
        '0',
        p0.x + 6,
        p0.y + (upward ? -2 : 2),
      )
      return
    }

    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1.35

    ctx.beginPath()
    ctx.arc(p0.x, p0.y, radius, startAngle, endAngle, anticlockwise)
    ctx.stroke()

    // label at top-center or bottom-center of arc
    ctx.fillText(
      String(level),
      p0.x,
      p0.y + labelYOffsetSign * radius + (upward ? -2 : 2),
    )
  })

  ctx.restore()
}

function drawGannBox(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  const a = points[0]
  const b = points[1]

  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const bottom = Math.max(a.y, b.y)
  const width = right - left
  const height = bottom - top

  if (width < 0.001 || height < 0.001) return

  const xAt = (level: number) => left + width * level
  const yAt = (level: number) => bottom - height * level

  ctx.save()
  ctx.setLineDash([])
  ctx.font = '11px Vazirmatn, Inter, sans-serif'

  // vertical fills
  for (let i = 0; i < GANN_BOX_LEVELS.length - 1; i++) {
    const level = GANN_BOX_LEVELS[i]
    const x1 = xAt(GANN_BOX_LEVELS[i])
    const x2 = xAt(GANN_BOX_LEVELS[i + 1])

    ctx.fillStyle = GANN_BOX_FILL_COLORS[level] ?? 'rgba(120,123,134,0.08)'
    ctx.fillRect(x1, top, x2 - x1, height)
  }

  // horizontal fills روی vertical fillها
  for (let i = 0; i < GANN_BOX_LEVELS.length - 1; i++) {
    const level = GANN_BOX_LEVELS[i]
    const y1 = yAt(GANN_BOX_LEVELS[i + 1])
    const y2 = yAt(GANN_BOX_LEVELS[i])

    ctx.fillStyle = GANN_BOX_FILL_COLORS[level] ?? 'rgba(120,123,134,0.08)'
    ctx.fillRect(left, y1, width, y2 - y1)
  }

  // border
  ctx.strokeStyle = '#787b86'
  ctx.lineWidth = 1.35
  ctx.strokeRect(left, top, width, height)

  // vertical grid lines
  GANN_BOX_LEVELS.forEach(level => {
    const x = xAt(level)
    const color = GANN_BOX_LINE_COLORS[level] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.lineWidth = level === 0 || level === 1 ? 1.35 : 1.15

    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
  })

  // horizontal grid lines
  GANN_BOX_LEVELS.forEach(level => {
    const y = yAt(level)
    const color = GANN_BOX_LINE_COLORS[level] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.lineWidth = level === 0 || level === 1 ? 1.35 : 1.15

    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
  })

  // top labels
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  GANN_BOX_LEVELS.forEach(level => {
    const x = xAt(level)
    const color = GANN_BOX_LINE_COLORS[level] ?? '#787b86'

    ctx.fillStyle = color
    ctx.fillText(String(level), x, top - 6)
  })

  // bottom labels
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  GANN_BOX_LEVELS.forEach(level => {
    const x = xAt(level)
    const color = GANN_BOX_LINE_COLORS[level] ?? '#787b86'

    ctx.fillStyle = color
    ctx.fillText(String(level), x, bottom + 6)
  })

  // left labels
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  GANN_BOX_LEVELS.forEach(level => {
    const y = yAt(level)
    const color = GANN_BOX_LINE_COLORS[level] ?? '#787b86'

    ctx.fillStyle = color
    ctx.fillText(String(level), left - 8, y)
  })

  // right labels
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  GANN_BOX_LEVELS.forEach(level => {
    const y = yAt(level)
    const color = GANN_BOX_LINE_COLORS[level] ?? '#787b86'

    ctx.fillStyle = color
    ctx.fillText(String(level), right + 8, y)
  })

  ctx.restore()
}

function drawSchiffPitchfork(ctx: CanvasRenderingContext2D, points: PixelPoint[], isSelected = false, tool = 'schiffpitchfork') {
  if (points.length < 3) return
  const [a, b, c] = points

  if (tool === 'insidepitchfork') {
    drawInsidePitchfork(ctx, a, b, c, isSelected)
    return
  }

  if (tool === 'modifiedschiffpitchfork') {
    // Modified Schiff: origin shifts 50% in BOTH x and y (midpoint of A and B)
    const modOrigin = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    drawPitchforkCore(ctx, a, modOrigin, b, c, isSelected)
    return
  }

  // Schiff: only Y shifts 50% between A and B — X stays at A.x
  const schiffOrigin = { x: a.x, y: (a.y + b.y) / 2 }
  drawPitchforkCore(ctx, a, schiffOrigin, b, c, isSelected)
}

function drawFibSpeedResistanceFan(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  const [p0, p1] = points
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y

  if (Math.abs(dx) < 0.001 || Math.abs(dy) < 0.001) {
    drawLine(ctx, points)
    return
  }

  const xAtLevel = (level: number) => p0.x + dx * (1 - level)
  const yAtLevel = (level: number) => p0.y + dy * (1 - level)

  const topPointAtLevel = (level: number) => ({
    x: xAtLevel(level),
    y: p1.y,
  })

  const rightPointAtLevel = (level: number) => ({
    x: p1.x,
    y: yAtLevel(level),
  })

  const lineColor = (level: number) => {
    if (level === 0) return '#787b86'
    if (level === 0.25) return DRAWING_NODE_BLUE
    if (level === 0.382) return '#00bcd4'
    if (level === 0.5) return '#4caf50'
    if (level === 0.618) return '#089981'
    if (level === 0.75) return '#2962ff'
    return '#787b86'
  }

  const fillColor = (index: number) => {
    const colors = [
      'rgba(120,123,134,0.10)',
      'rgba(41,98,255,0.10)',
      'rgba(0,188,212,0.10)',
      'rgba(76,175,80,0.10)',
      'rgba(41,98,255,0.10)',
      'rgba(120,123,134,0.08)',
    ]
    return colors[index % colors.length]
  }

  // upper fan levels: from steep to diagonal
  const upperLevels = [1, 0.75, 0.618, 0.5, 0.382, 0.25, 0]
  // lower/right fan levels: from diagonal to shallow
  const lowerLevels = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]

  ctx.save()

  // ── Fill zones (extended) : upper half
  for (let i = 0; i < upperLevels.length - 1; i++) {
    const farA = extendRayFar(p0, topPointAtLevel(upperLevels[i]))
    const farB = extendRayFar(p0, topPointAtLevel(upperLevels[i + 1]))

    ctx.fillStyle = fillColor(i)
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(farA.x, farA.y)
    ctx.lineTo(farB.x, farB.y)
    ctx.closePath()
    ctx.fill()
  }

  // ── Fill zones (extended) : lower/right half
  for (let i = 0; i < lowerLevels.length - 1; i++) {
    const farA = extendRayFar(p0, rightPointAtLevel(lowerLevels[i]))
    const farB = extendRayFar(p0, rightPointAtLevel(lowerLevels[i + 1]))

    ctx.fillStyle = fillColor(i)
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(farA.x, farA.y)
    ctx.lineTo(farB.x, farB.y)
    ctx.closePath()
    ctx.fill()
  }

  // ── Finite guide grid / box (همان محدوده‌ی اولیه)
  ctx.lineWidth = 1
  ctx.setLineDash([])
  ctx.strokeStyle = 'rgba(120,123,134,0.55)'

  FIB_SPEED_LEVELS.forEach(level => {
    const x = xAtLevel(level)
    const y = yAtLevel(level)

    ctx.beginPath()
    ctx.moveTo(x, p0.y)
    ctx.lineTo(x, p1.y)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(p0.x, y)
    ctx.lineTo(p1.x, y)
    ctx.stroke()
  })

  ctx.strokeStyle = 'rgba(120,123,134,0.75)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(p0.x, p0.y)
  ctx.lineTo(p1.x, p0.y)
  ctx.lineTo(p1.x, p1.y)
  ctx.lineTo(p0.x, p1.y)
  ctx.closePath()
  ctx.stroke()

  // ── Extended upper fan lines
  upperLevels.forEach(level => {
    const target = topPointAtLevel(level)
    const far = extendRayFar(p0, target)
    const color = lineColor(level)

    ctx.strokeStyle = color
    ctx.lineWidth = level === 0 ? 1.6 : 1.35
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(far.x, far.y)
    ctx.stroke()
  })

  // ── Extended lower/right fan lines
  lowerLevels.forEach(level => {
    const target = rightPointAtLevel(level)
    const far = extendRayFar(p0, target)
    const color = lineColor(level)

    ctx.strokeStyle = color
    ctx.lineWidth = level === 0 ? 1.6 : 1.35
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(far.x, far.y)
    ctx.stroke()
  })

  // ── Labels روی guide box
  ctx.font = '11px Vazirmatn, Inter, sans-serif'
  ctx.textBaseline = 'middle'

  FIB_SPEED_LEVELS.forEach(level => {
    const color = lineColor(level)
    const text = String(level)

    ctx.fillStyle = color

    // left labels
    ctx.textAlign = 'right'
    ctx.fillText(text, p0.x - 7, yAtLevel(level))

    // right labels
    ctx.textAlign = 'left'
    ctx.fillText(text, p1.x + 7, yAtLevel(level))

    // bottom labels
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(text, xAtLevel(level), p0.y + 7)

    // top labels
    ctx.textBaseline = 'bottom'
    ctx.fillText(text, xAtLevel(level), p1.y - 7)

    ctx.textBaseline = 'middle'
  })

  ctx.restore()
}

function extendRayFarPoint(
  from: { x: number; y: number },
  through: { x: number; y: number },
  distance = 100000,
) {
  const dx = through.x - from.x
  const dy = through.y - from.y
  const len = Math.hypot(dx, dy)

  if (len < 0.001) return through

  return {
    x: from.x + (dx / len) * distance,
    y: from.y + (dy / len) * distance,
  }
}

function drawPitchFan(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  const origin = points[0]
  const rayA = points[1]

  // preview بعد از دو نقطه
  if (points.length < 3) {
    const farA = extendRayFar(origin, rayA)

    ctx.save()
    ctx.strokeStyle = '#2962ff'
    ctx.lineWidth = 1.5
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(origin.x, origin.y)
    ctx.lineTo(farA.x, farA.y)
    ctx.stroke()
    ctx.restore()
    return
  }

  const rayB = points[2]

  // فقط 5 ray
  const levels = [0, 0.25, 0.5, 0.75, 1]

  const pointAtLevel = (level: number) => ({
    x: rayA.x + (rayB.x - rayA.x) * level,
    y: rayA.y + (rayB.y - rayA.y) * level,
  })

  const rayAtLevel = (level: number) => {
    const p = pointAtLevel(level)
    return {
      point: p,
      far: extendRayFar(origin, p),
    }
  }

  const rays = levels.map(rayAtLevel)

  ctx.save()
  ctx.setLineDash([])

  // fills
  // band 1: بین ray0 و ray1 -> آبی
  ctx.fillStyle = 'rgba(41, 98, 255, 0.14)'
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(rays[0].far.x, rays[0].far.y)
  ctx.lineTo(rays[1].far.x, rays[1].far.y)
  ctx.closePath()
  ctx.fill()

  // band 2: بین ray1 و ray2 -> فیروزه‌ای
  ctx.fillStyle = 'rgba(0, 188, 212, 0.16)'
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(rays[1].far.x, rays[1].far.y)
  ctx.lineTo(rays[2].far.x, rays[2].far.y)
  ctx.closePath()
  ctx.fill()

  // band 3: بین ray2 و ray3 -> فیروزه‌ای
  ctx.fillStyle = 'rgba(0, 188, 212, 0.16)'
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(rays[2].far.x, rays[2].far.y)
  ctx.lineTo(rays[3].far.x, rays[3].far.y)
  ctx.closePath()
  ctx.fill()

  // band 4: بین ray3 و ray4 -> آبی
  ctx.fillStyle = 'rgba(41, 98, 255, 0.14)'
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(rays[3].far.x, rays[3].far.y)
  ctx.lineTo(rays[4].far.x, rays[4].far.y)
  ctx.closePath()
  ctx.fill()

  // خط کنترل بین نود 2 و 3
  ctx.strokeStyle = '#f23645'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(rayA.x, rayA.y)
  ctx.lineTo(rayB.x, rayB.y)
  ctx.stroke()

  // ray 0 - آبی
  ctx.strokeStyle = '#2962ff'
  ctx.lineWidth = 1.7
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(rays[0].far.x, rays[0].far.y)
  ctx.stroke()

  // ray 0.25 - فیروزه‌ای
  ctx.strokeStyle = '#00bcd4'
  ctx.lineWidth = 1.45
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(rays[1].far.x, rays[1].far.y)
  ctx.stroke()

  // ray 0.5 - قرمز
  ctx.strokeStyle = '#f23645'
  ctx.lineWidth = 1.35
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(rays[2].far.x, rays[2].far.y)
  ctx.stroke()

  // ray 0.75 - فیروزه‌ای
  ctx.strokeStyle = '#00bcd4'
  ctx.lineWidth = 1.45
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(rays[3].far.x, rays[3].far.y)
  ctx.stroke()

  // ray 1 - آبی
  ctx.strokeStyle = '#2962ff'
  ctx.lineWidth = 1.7
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(rays[4].far.x, rays[4].far.y)
  ctx.stroke()

  ctx.restore()
}

function getGannSquareFixedOuterFromControl(
  origin: { x: number; y: number },
  control: { x: number; y: number },
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


function drawHeadAndShoulders(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 1) return

  const [l0, ls, n1, h, n2, rs, r0] = points

  const strokeColor = '#089981'
  const fillShoulder = 'rgba(8,153,129,0.14)'
  const fillHead = 'rgba(8,153,129,0.18)'

  ctx.save()
  ctx.strokeStyle = strokeColor
  ctx.fillStyle = strokeColor
  ctx.lineWidth = 1.8
  ctx.setLineDash([])
  ctx.font = '11px Vazirmatn, Inter, sans-serif'

  // ── Left outer leg
  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(l0.x, l0.y)
    ctx.lineTo(ls.x, ls.y)
    ctx.stroke()
  }

  // ── Left shoulder complete
  if (points.length >= 3) {
    ctx.beginPath()
    ctx.moveTo(ls.x, ls.y)
    ctx.lineTo(n1.x, n1.y)
    ctx.stroke()

    // Fill needs both neckline points; before the fifth click, keep preview to lines only.
    if (points.length >= 5 && !isHsPointAboveNeckline(l0, n1, n2)) {
      const clipped = clipPolygonAboveNeckline(
        [l0, ls, n1],
        n1,
        n2,
      )
      fillHsPolygon(ctx, clipped, fillShoulder)
    }
  }

  // ── Head left side
  if (points.length >= 4) {
    ctx.beginPath()
    ctx.moveTo(n1.x, n1.y)
    ctx.lineTo(h.x, h.y)
    ctx.stroke()
  }

  // ── Head complete
  if (points.length >= 5) {
    ctx.beginPath()
    ctx.moveTo(h.x, h.y)
    ctx.lineTo(n2.x, n2.y)
    ctx.stroke()

    ctx.save()
    ctx.fillStyle = fillHead
    ctx.beginPath()
    ctx.moveTo(n1.x, n1.y)
    ctx.lineTo(h.x, h.y)
    ctx.lineTo(n2.x, n2.y)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // ── Right shoulder left side
  if (points.length >= 6) {
    ctx.beginPath()
    ctx.moveTo(n2.x, n2.y)
    ctx.lineTo(rs.x, rs.y)
    ctx.stroke()
  }

  // ── Right outer leg
  if (points.length >= 7) {
    ctx.beginPath()
    ctx.moveTo(rs.x, rs.y)
    ctx.lineTo(r0.x, r0.y)
    ctx.stroke()

    // ✅ فقط اگر نود بیرونی راست پایین neckline باشد
    if (!isHsPointAboveNeckline(r0, n1, n2)) {
      const clipped = clipPolygonAboveNeckline(
        [n2, rs, r0],
        n1,
        n2,
      )
      fillHsPolygon(ctx, clipped, fillShoulder)
    }
  }

  // ── Infinite neckline
  if (points.length >= 5) {
    const { start, end } = getExtendedHsNeckline(
      n1,
      n2,
      points.length >= 2 ? l0 : undefined,
      points.length >= 2 ? ls : undefined,
      points.length >= 7 ? rs : undefined,
      points.length >= 7 ? r0 : undefined,
    )

    ctx.save()
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 1.2
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
    ctx.restore()
  }

  // ── Labels
  if (points.length >= 2) {
    drawPatternBadge(ctx, ls.x, ls.y - 16, 'Left Shoulder', strokeColor)
  }

  if (points.length >= 4) {
    drawPatternBadge(ctx, h.x, h.y - 16, 'Head', strokeColor)
  }

  if (points.length >= 6) {
    drawPatternBadge(ctx, rs.x, rs.y - 16, 'Right Shoulder', strokeColor)
  }

  ctx.restore()
}

function drawTrianglePattern(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 1) return

  const [a, b, c, d] = points
  const color = '#6f42c1'
  const fillColor = 'rgba(111,66,193,0.16)'

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.8
  ctx.setLineDash([])
  ctx.font = '11px Vazirmatn, Inter, sans-serif'

  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  if (points.length >= 3) {
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()
    ctx.restore()
  }

  if (points.length >= 4) {
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()

    const geometry = getTrianglePatternGeometry(a, b, c, d)
    const { lowerBase, upperBase, apex, polygon, isFallback } = geometry

    ctx.save()
    ctx.fillStyle = fillColor
    ctx.beginPath()
    ctx.moveTo(polygon[0].x, polygon[0].y)

    for (let i = 1; i < polygon.length; i++) {
      ctx.lineTo(polygon[i].x, polygon[i].y)
    }

    ctx.closePath()
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 4])

    if (!isFallback && apex) {
      // ✅ ضلع اصلی عمودی
      ctx.beginPath()
      ctx.moveTo(lowerBase.x, lowerBase.y)
      ctx.lineTo(upperBase.x, upperBase.y)
      ctx.stroke()

      // ضلع بالا تا apex
      ctx.beginPath()
      ctx.moveTo(upperBase.x, upperBase.y)
      ctx.lineTo(apex.x, apex.y)
      ctx.stroke()

      // ضلع پایین تا apex
      ctx.beginPath()
      ctx.moveTo(lowerBase.x, lowerBase.y)
      ctx.lineTo(apex.x, apex.y)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.moveTo(polygon[0].x, polygon[0].y)

      for (let i = 1; i < polygon.length; i++) {
        ctx.lineTo(polygon[i].x, polygon[i].y)
      }

      ctx.closePath()
      ctx.stroke()
    }

    ctx.restore()
  }

  if (points.length >= 1) drawTrianglePatternPointLabel(ctx, a, 'A', color)
  if (points.length >= 2) drawTrianglePatternPointLabel(ctx, b, 'B', color)
  if (points.length >= 3) drawTrianglePatternPointLabel(ctx, c, 'C', color)
  if (points.length >= 4) drawTrianglePatternPointLabel(ctx, d, 'D', color)

  ctx.restore()
}

function drawGannSquareFixed(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  const origin = points[0]
  const control = points[1]

  // points[2] اگر وجود داشته باشد، outer corner ذخیره‌شده روی چارت است
  const outer = points[2] ?? getGannSquareFixedOuterFromControl(origin, control)

  const spanX = outer.x - origin.x
  const spanY = outer.y - origin.y

  if (Math.abs(spanX) < 0.001 || Math.abs(spanY) < 0.001) return

  const signX = spanX >= 0 ? 1 : -1
  const signY = spanY >= 0 ? 1 : -1

  const left = Math.min(origin.x, outer.x)
  const right = Math.max(origin.x, outer.x)
  const top = Math.min(origin.y, outer.y)
  const bottom = Math.max(origin.y, outer.y)

  const width = right - left
  const height = bottom - top

  const xAt = (level: number) => origin.x + spanX * level
  const yAt = (level: number) => origin.y + spanY * level

  const { startAngle, endAngle } = getQuarterArcAngles(signX, signY)

  ctx.save()
  ctx.setLineDash([])
  ctx.font = '11px Vazirmatn, Inter, sans-serif'

  // vertical fills
  for (let i = 0; i < GANN_SQUARE_LEVELS.length - 1; i++) {
    const level = GANN_SQUARE_LEVELS[i]
    const xA = xAt(GANN_SQUARE_LEVELS[i])
    const xB = xAt(GANN_SQUARE_LEVELS[i + 1])

    ctx.fillStyle = GANN_SQUARE_FILL_COLORS[level] ?? 'rgba(120,123,134,0.07)'
    ctx.fillRect(
      Math.min(xA, xB),
      top,
      Math.abs(xB - xA),
      height,
    )
  }

  // horizontal fills
  for (let i = 0; i < GANN_SQUARE_LEVELS.length - 1; i++) {
    const level = GANN_SQUARE_LEVELS[i]
    const yA = yAt(GANN_SQUARE_LEVELS[i])
    const yB = yAt(GANN_SQUARE_LEVELS[i + 1])

    ctx.fillStyle = GANN_SQUARE_FILL_COLORS[level] ?? 'rgba(120,123,134,0.07)'
    ctx.fillRect(
      left,
      Math.min(yA, yB),
      width,
      Math.abs(yB - yA),
    )
  }

  // border
  ctx.strokeStyle = '#787b86'
  ctx.lineWidth = 1.35
  ctx.strokeRect(left, top, width, height)

  // vertical grid
  GANN_SQUARE_LEVELS.forEach(level => {
    const x = xAt(level)
    const color = GANN_SQUARE_LINE_COLORS[level] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.lineWidth = level === 0 || level === 1 ? 1.3 : 1.1

    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
  })

  // horizontal grid
  GANN_SQUARE_LEVELS.forEach(level => {
    const y = yAt(level)
    const color = GANN_SQUARE_LINE_COLORS[level] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.lineWidth = level === 0 || level === 1 ? 1.3 : 1.1

    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
  })

  // quarter arcs — حالا ellipse هستند تا به چارت بچسبند
  GANN_SQUARE_LEVELS.forEach(level => {
    if (level <= 0) return

    const rx = Math.abs(spanX) * level
    const ry = Math.abs(spanY) * level
    const color = GANN_SQUARE_LINE_COLORS[level] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.lineWidth = level === 1 ? 1.5 : 1.1

    ctx.beginPath()
    ctx.ellipse(
      origin.x,
      origin.y,
      rx,
      ry,
      0,
      startAngle,
      endAngle,
      false,
    )
    ctx.stroke()
  })

  // angle lines
  const angleTargets = [
    { levelX: 0.25, levelY: 1, color: DRAWING_NODE_BLUE },
    { levelX: 0.5, levelY: 1, color: '#089981' },
    { levelX: 1, levelY: 1, color: '#4caf50' },
    { levelX: 1, levelY: 0.5, color: '#00bcd4' },
  ]

  angleTargets.forEach(({ levelX, levelY, color }) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.15

    ctx.beginPath()
    ctx.moveTo(origin.x, origin.y)
    ctx.lineTo(xAt(levelX), yAt(levelY))
    ctx.stroke()
  })

  ctx.restore()
}

function drawFibSpiral(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  // ✅ semantics درست:
  // p0 = center
  // p1 = point on ray / outer anchor
  const center = points[0]
  const guidePoint = points[1]

  const dx = guidePoint.x - center.x
  const dy = guidePoint.y - center.y
  const guideRadius = Math.hypot(dx, dy)

  if (guideRadius < 0.001) return

  const guideAngle = Math.atan2(dy, dx)

  // می‌خواهیم spiral بعد از یک دور کامل از guidePoint عبور کند
  // چون بعد از 2π زاویه دوباره روی همان ray برمی‌گردد
  const turnToGuide = Math.PI * 2

  // r(t) = a * φ^(t / (π/2))
  // و می‌خواهیم در t = 2π ، شعاع = guideRadius شود
  const a = guideRadius / Math.pow(GOLDEN_RATIO, turnToGuide / (Math.PI / 2))

  // اگر جهت برعکس شد فقط false/true را عوض کن
  const clockwise = true

  const totalAngle = Math.PI * 2 * 2.6
  const steps = 420

  const spiralPoints: { x: number; y: number }[] = []

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * totalAngle
    const theta = clockwise ? -t : t
    const radius = a * Math.pow(GOLDEN_RATIO, t / (Math.PI / 2))
    const angle = guideAngle + theta

    const x = center.x + Math.cos(angle) * radius
    const y = center.y + Math.sin(angle) * radius

    spiralPoints.push({ x, y })

    if (
      x < -canvas.width * 0.5 ||
      x > canvas.width * 1.5 ||
      y < -canvas.height * 0.5 ||
      y > canvas.height * 1.5
    ) {
      break
    }
  }

  ctx.save()

  // ✅ خط صاف باید از center به guidePoint و در همان جهت extend شود
  const guideFar = extendRayFarPoint(center, guidePoint, 100000)

  ctx.lineWidth = 1.6
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(center.x, center.y)
  ctx.lineTo(guideFar.x, guideFar.y)
  ctx.stroke()

  if (spiralPoints.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(spiralPoints[0].x, spiralPoints[0].y)
    for (let i = 1; i < spiralPoints.length; i++) {
      ctx.lineTo(spiralPoints[i].x, spiralPoints[i].y)
    }
    ctx.stroke()
  }

  ctx.restore()
}

function drawElliottImpulseWave(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 1) return

  const color = '#3B82F6'

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([])

  // polyline اصلی: 0 -> 1 -> 2 -> 3 -> 4 -> 5
  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }

    ctx.stroke()
  }

  points.forEach((p, i) => {
    drawElliottImpulseLabel(ctx, p, String(i), color)
  })

  ctx.restore()
}

function drawFibTimeZone(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  chart: IChartApi | null,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  const [p0, p1] = points
  const stepX = p1.x - p0.x
  if (Math.abs(stepX) < 0.001) return

  const timeScaleHeight = chart?.timeScale().height() ?? 0
  const chartBottomY = canvas.height - timeScaleHeight

  const color =
    typeof ctx.strokeStyle === 'string'
      ? ctx.strokeStyle
      : DRAWING_NODE_BLUE

  ctx.save()

  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.5
  ctx.setLineDash([])

  ctx.font = '11px Vazirmatn, Inter, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'

  FIB_TIME_LEVELS.forEach(level => {
    const x = p0.x + stepX * level
    if (x < 0 || x > canvas.width) return

    // vertical line
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, chartBottomY)
    ctx.stroke()

    // label: پایین چارت، سمت راست خط
    ctx.fillText(String(level), x + 4, chartBottomY - 4)
  })

  // guide line between the two anchor points
  ctx.strokeStyle = color
  ctx.lineWidth = 1.25
  ctx.setLineDash([6, 6])
  ctx.beginPath()
  ctx.moveTo(p0.x, p0.y)
  ctx.lineTo(p1.x, p1.y)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.restore()
}

function drawABCDPattern(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 1) return

  const [a, b, c, d] = points
  const color = '#089981'

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.8
  ctx.setLineDash([])
  ctx.font = '11px Vazirmatn, Inter, sans-serif'

  // ── Main leg A -> B
  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  // ── Main leg B -> C + guide A -> C + ratio BC/AB
  if (points.length >= 3) {
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()

    // dotted guide A -> C
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()
    ctx.restore()

    const bcAb = ratioText(
      priceDistance(b, c),
      priceDistance(a, b),
    )

    const m = midpoint(a, c)
    drawPatternBadge(ctx, m.x, m.y + 10, bcAb, color)
  }

  // ── Main leg C -> D + guide B -> D + ratio CD/BC
  if (points.length >= 4) {
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()

    // dotted guide B -> D
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()
    ctx.restore()

    const cdBc = ratioText(
      priceDistance(c, d),
      priceDistance(b, c),
    )

    const m = midpoint(b, d)
    drawPatternBadge(ctx, m.x, m.y - 8, cdBc, color)
  }

  // ── Point labels only (no custom node circles)
  if (points.length >= 1) drawABCDPointLabel(ctx, a, 'A', color)
  if (points.length >= 2) drawABCDPointLabel(ctx, b, 'B', color)
  if (points.length >= 3) drawABCDPointLabel(ctx, c, 'C', color)
  if (points.length >= 4) drawABCDPointLabel(ctx, d, 'D', color)

  ctx.restore()
}

function drawFibFan(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const origin = points[0]
  const end = points[1]
  const dx = end.x - origin.x
  const dy = end.y - origin.y
  FIB_LEVELS.slice(1, -1).forEach((level, i) => {
    const tx = origin.x + dx
    const ty = origin.y + dy * level
    ctx.strokeStyle = FIB_COLORS[i + 1]
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(origin.x, origin.y)
    ctx.lineTo(origin.x + (tx - origin.x) * 3, origin.y + (ty - origin.y) * 3)
    ctx.stroke()
    ctx.setLineDash([])
  })
}

function drawCypherPattern(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  color = DRAWING_NODE_BLUE,
) {
  if (points.length < 1) return

  const [x, a, b, c, d] = points

  const fillA = 'rgba(41,98,255,0.13)'
  const fillB = 'rgba(41,98,255,0.16)'

  ctx.save()

  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.8
  ctx.setLineDash([])
  ctx.font = '11px Vazirmatn, Inter, sans-serif'

  // ─────────────────────────
  // Main solid legs: X-A-B-C-D
  // ─────────────────────────
  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(x.x, x.y)
    ctx.lineTo(a.x, a.y)
    ctx.stroke()
  }

  if (points.length >= 3) {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()

    // fill XAB
    ctx.fillStyle = fillA
    ctx.beginPath()
    ctx.moveTo(x.x, x.y)
    ctx.lineTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.closePath()
    ctx.fill()

    // guide X-B
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.75
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(x.x, x.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.restore()

    // Cypher rule 1: AB / XA
    const abXa = ratioText(
      priceDistance(a, b),
      priceDistance(x, a),
    )

    const m = midpoint(x, b)
    drawPatternBadge(ctx, m.x, m.y + 10, abXa, color)
  }

  if (points.length >= 4) {
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()

    // guide A-C
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.75
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()
    ctx.restore()

    // // guide X-C: چون Cypher با XC/XA هم معنی پیدا می‌کند
    // ctx.save()
    // ctx.strokeStyle = color
    // ctx.globalAlpha = 0.45
    // ctx.lineWidth = 1.0
    // ctx.setLineDash([2, 4])
    // ctx.beginPath()
    // ctx.moveTo(x.x, x.y)
    // ctx.lineTo(c.x, c.y)
    // ctx.stroke()
    // ctx.restore()

    // Cypher rule 2: XC / XA
    // در Cypher معمولاً باید حدود 1.272 تا 1.414 باشد
    const xcXa = ratioText(
      priceDistance(x, c),
      priceDistance(x, a),
    )

    const m = midpoint(a, c)
    drawPatternBadge(ctx, m.x, m.y - 10, xcXa, color)
  }

  if (points.length >= 5) {
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()

    // fill BCD
    ctx.fillStyle = fillB
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.closePath()
    ctx.fill()

    // guide X-D
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.75
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(x.x, x.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()
    ctx.restore()

    // guide B-D
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.75
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()
    ctx.restore()

    // Cypher rule 3: CD / XC
    // مقدار ایده‌آل Cypher نزدیک 0.786 است
    const cdXc = ratioText(
      priceDistance(c, d),
      priceDistance(x, c),
    )

    const xdm = midpoint(x, d)
    drawPatternBadge(ctx, xdm.x, xdm.y - 8, cdXc, color)

    // یک عدد کمکی: CD / BC
    // این برای خوانایی مثل TradingView-style pattern labels خوب است
    const cdBc = ratioText(
      priceDistance(c, d),
      priceDistance(b, c),
    )

    const bdm = midpoint(b, d)
    drawPatternBadge(ctx, bdm.x, bdm.y + 12, cdBc, color)
  }

  ctx.restore()
}

function drawElliottTriangleWave(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 1) return

  const color = DRAWING_NODE_BLUE
  const labels = ['A', 'B', 'C', 'D', 'E']

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([])

  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }

    ctx.stroke()
  }

  points.forEach((p, i) => {
    drawElliottTriangleLabel(ctx, p, labels[i] ?? '', color)
  })

  ctx.restore()
}

function drawElliottCorrectionWave(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 1) return

  const color = '#3B82F6'
  const labels = ['0', 'A', 'B', 'C']

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([])

  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }

    ctx.stroke()
  }

  points.forEach((p, i) => {
    drawElliottCorrectionLabel(ctx, p, labels[i] ?? '', color)
  })

  ctx.restore()
}

function drawFibCircles(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return

  const [p0, p1] = points

  const cx = (p0.x + p1.x) / 2
  const cy = (p0.y + p1.y) / 2
  const baseRx = Math.abs(p1.x - p0.x) / 2
  const baseRy = Math.abs(p1.y - p0.y) / 2

  if (baseRx < 0.001 || baseRy < 0.001) {
    drawLine(ctx, points)
    return
  }

  const levels = FIB_LEVELS

  ctx.save()

  // dashed guide line
  ctx.strokeStyle = '#7b8494'
  ctx.lineWidth = 1.5
  ctx.setLineDash([8, 8])
  ctx.beginPath()
  ctx.moveTo(p0.x, p0.y)
  ctx.lineTo(p1.x, p1.y)
  ctx.stroke()
  ctx.setLineDash([])

  // fill bands between consecutive ellipses
  for (let i = levels.length - 1; i >= 1; i--) {
    const outerLevel = levels[i]
    const innerLevel = levels[i - 1]

    const outerRx = baseRx * outerLevel
    const outerRy = baseRy * outerLevel
    const innerRx = baseRx * innerLevel
    const innerRy = baseRy * innerLevel

    ctx.fillStyle = FIB_ZONE_COLORS[i - 1] ?? 'rgba(120,123,134,0.06)'

    ctx.beginPath()
    ctx.ellipse(cx, cy, outerRx, outerRy, 0, 0, Math.PI * 2)

    if (innerLevel > 0) {
      ctx.moveTo(cx + innerRx, cy)
      ctx.ellipse(cx, cy, innerRx, innerRy, 0, 0, Math.PI * 2, true)
    }

    ctx.fill('evenodd')
  }

  // ellipse outlines + labels
  ctx.font = '11px Vazirmatn, Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  levels.forEach((level, i) => {
    if (level <= 0) return

    const rx = baseRx * level
    const ry = baseRy * level
    const color = FIB_LINE_COLORS[i] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1.35

    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.stroke()

    // label at bottom of ellipse
    ctx.fillText(String(level), cx, cy + ry + 3)
  })

  // level 0 label near center-bottom
  ctx.fillStyle = FIB_LINE_COLORS[0] ?? '#787b86'
  ctx.fillText('0', cx, cy + 4)

  ctx.restore()
}

function drawFibChannel(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  const [p1, p2, p3] = points

  if (!p3) {
    drawLine(ctx, points)
    return
  }

  const offX = p3.x - p1.x
  const offY = p3.y - p1.y

  const lineAtLevel = (level: number) => ({
    start: {
      x: p1.x + offX * level,
      y: p1.y + offY * level,
    },
    end: {
      x: p2.x + offX * level,
      y: p2.y + offY * level,
    },
  })

  ctx.save()

  // fills
  for (let i = 0; i < FIB_LEVELS.length - 1; i++) {
    const a = lineAtLevel(FIB_LEVELS[i])
    const b = lineAtLevel(FIB_LEVELS[i + 1])

    ctx.fillStyle = FIB_ZONE_COLORS[i] ?? 'rgba(120,123,134,0.06)'
    ctx.beginPath()
    ctx.moveTo(a.start.x, a.start.y)
    ctx.lineTo(a.end.x, a.end.y)
    ctx.lineTo(b.end.x, b.end.y)
    ctx.lineTo(b.start.x, b.start.y)
    ctx.closePath()
    ctx.fill()
  }

  // lines + labels
  ctx.font = '12px Arial, Vazirmatn, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  FIB_LEVELS.forEach((level, i) => {
    const line = lineAtLevel(level)
    const color = FIB_LINE_COLORS[i] ?? '#787b86'
    const price = p1.price + (p3.price - p1.price) * level

    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1.35

    ctx.beginPath()
    ctx.moveTo(line.start.x, line.start.y)
    ctx.lineTo(line.end.x, line.end.y)
    ctx.stroke()

    ctx.fillText(`${level} (${price.toFixed(3)})`, line.start.x - 8, line.start.y)
  })

  // side guides
  const topLine = lineAtLevel(1)
  ctx.strokeStyle = 'rgba(120,123,134,0.5)'
  ctx.lineWidth = 1
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(topLine.start.x, topLine.start.y)
  ctx.moveTo(p2.x, p2.y)
  ctx.lineTo(topLine.end.x, topLine.end.y)
  ctx.stroke()

  ctx.restore()
}

function drawElliottTripleComboWave(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 1) return

  const color = '#6AA84F'
  const labels = ['', 'W', 'X1', 'Y', 'X2', 'Z']

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([])

  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }

    ctx.stroke()
  }

  points.forEach((p, i) => {
    const label = labels[i]
    if (label) {
      drawElliottTripleComboLabel(ctx, p, label, color)
    }
  })

  ctx.restore()
}


function drawGannSquare(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  const origin = points[0]
  const opposite = points[1]

  const spanX = opposite.x - origin.x
  const spanY = opposite.y - origin.y

  if (Math.abs(spanX) < 0.001 || Math.abs(spanY) < 0.001) return

  const signX = spanX >= 0 ? 1 : -1
  const signY = spanY >= 0 ? 1 : -1

  const left = Math.min(origin.x, opposite.x)
  const right = Math.max(origin.x, opposite.x)
  const top = Math.min(origin.y, opposite.y)
  const bottom = Math.max(origin.y, opposite.y)

  const width = right - left
  const height = bottom - top

  const xAt = (level: number) => origin.x + spanX * level
  const yAt = (level: number) => origin.y + spanY * level

  const { startAngle, endAngle } = getQuarterArcAngles(signX, signY)

  ctx.save()
  ctx.setLineDash([])
  ctx.font = '11px Vazirmatn, Inter, sans-serif'

  // fills ستونی
  for (let i = 0; i < GANN_SQUARE_LEVELS.length - 1; i++) {
    const level = GANN_SQUARE_LEVELS[i]
    const xA = xAt(GANN_SQUARE_LEVELS[i])
    const xB = xAt(GANN_SQUARE_LEVELS[i + 1])

    ctx.fillStyle = GANN_SQUARE_FILL_COLORS[level] ?? 'rgba(120,123,134,0.07)'
    ctx.fillRect(
      Math.min(xA, xB),
      top,
      Math.abs(xB - xA),
      height,
    )
  }

  // fills ردیفی
  for (let i = 0; i < GANN_SQUARE_LEVELS.length - 1; i++) {
    const level = GANN_SQUARE_LEVELS[i]
    const yA = yAt(GANN_SQUARE_LEVELS[i])
    const yB = yAt(GANN_SQUARE_LEVELS[i + 1])

    ctx.fillStyle = GANN_SQUARE_FILL_COLORS[level] ?? 'rgba(120,123,134,0.07)'
    ctx.fillRect(
      left,
      Math.min(yA, yB),
      width,
      Math.abs(yB - yA),
    )
  }

  // border
  ctx.strokeStyle = '#787b86'
  ctx.lineWidth = 1.35
  ctx.strokeRect(left, top, width, height)

  // vertical grid
  GANN_SQUARE_LEVELS.forEach(level => {
    const x = xAt(level)
    const color = GANN_SQUARE_LINE_COLORS[level] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.lineWidth = level === 0 || level === 1 ? 1.3 : 1.1

    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
  })

  // horizontal grid
  GANN_SQUARE_LEVELS.forEach(level => {
    const y = yAt(level)
    const color = GANN_SQUARE_LINE_COLORS[level] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.lineWidth = level === 0 || level === 1 ? 1.3 : 1.1

    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
  })

  // quarter arcs
  GANN_SQUARE_LEVELS.forEach(level => {
    if (level <= 0) return

    const rx = Math.abs(spanX) * level
    const ry = Math.abs(spanY) * level
    const color = GANN_SQUARE_LINE_COLORS[level] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.lineWidth = level === 1 ? 1.5 : 1.1

    ctx.beginPath()
    ctx.ellipse(
      origin.x,
      origin.y,
      rx,
      ry,
      0,
      startAngle,
      endAngle,
      false,
    )
    ctx.stroke()
  })

  // angle lines
  const angleTargets = [
    { levelX: 0.25, levelY: 1, color: DRAWING_NODE_BLUE },
    { levelX: 0.5, levelY: 1, color: '#089981' },
    { levelX: 1, levelY: 1, color: '#4caf50' },
    { levelX: 1, levelY: 0.5, color: '#00bcd4' },
  ]

  angleTargets.forEach(({ levelX, levelY, color }) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1.15

    ctx.beginPath()
    ctx.moveTo(origin.x, origin.y)
    ctx.lineTo(xAt(levelX), yAt(levelY))
    ctx.stroke()
  })

  drawGannSquareMetrics(
    ctx,
    origin,
    opposite,
    left,
    right,
    top,
    bottom,
  )

  ctx.restore()
}

function drawThreeDrivesPattern(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  color = '#6f42c1',
) {
  if (points.length < 1) return

  const [p1, p2, p3, p4, , p6, p7] = points

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.8
  ctx.setLineDash([])
  ctx.font = '11px Vazirmatn, Inter, sans-serif'

  // ── Main solid zig-zag
  for (let i = 1; i < points.length; i++) {
    ctx.beginPath()
    ctx.moveTo(points[i - 1].x, points[i - 1].y)
    ctx.lineTo(points[i].x, points[i].y)
    ctx.stroke()
  }

  // ── Dotted guide 1: P2 -> P4
  // label: Drive2 / Drive1
  if (points.length >= 4) {
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(p2.x, p2.y)
    ctx.lineTo(p4.x, p4.y)
    ctx.stroke()
    ctx.restore()

    const drive1 = priceDistance(p1, p2)
    const drive2 = priceDistance(p3, p4)
    const r1 = ratioText(drive2, drive1)

    const m1 = midpoint(p2, p4)
    drawPatternBadge(ctx, m1.x, m1.y, r1, color)
  }

  // ── Dotted guide 2: P4 -> P6
  if (points.length >= 6) {
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(p4.x, p4.y)
    ctx.lineTo(p6.x, p6.y)
    ctx.stroke()
    ctx.restore()

    const drive2 = priceDistance(p3, p4)
    const drive3 = priceDistance(p6, p7)
    const r2 = ratioText(drive3, drive2)

    const m2 = midpoint(p4, p6)
    drawPatternBadge(ctx, m2.x, m2.y, r2, color)
  }

  ctx.restore()
}

function drawCyclicLines(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  points: PixelPoint[],
  color = '#67C5DF',
) {
  if (points.length < 1) return

  const p1 = points[0]
  const p2 = points[1] ?? points[0]

  const dx = p2.x - p1.x
  const step = Math.abs(dx)
  if (step < 1) return

  const dir = dx >= 0 ? 1 : -1

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.2
  ctx.setLineDash([])

  if (dir > 0) {
    for (let x = p1.x; x <= canvas.width + step; x += step) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
  } else {
    for (let x = p1.x; x >= -step; x -= step) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height)
      ctx.stroke()
    }
  }

  // guide بین دو نود
  if (points.length >= 2) {
    ctx.save()
    ctx.strokeStyle = '#7A7A7A'
    ctx.lineWidth = 1
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()
    ctx.restore()
  }

  ctx.restore()
}

function drawGannFan(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  const origin = points[0]
  const oneOne = points[1]

  const dx = oneOne.x - origin.x
  const dy = oneOne.y - origin.y

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return

  const rays = GANN_FAN_RAYS.map(ray => {
    const target = {
      x: origin.x + dx,
      y: origin.y + dy * ray.factor,
    }

    return {
      ...ray,
      target,
      far: extendRayFarPx(origin, target),
    }
  })

  ctx.save()
  ctx.setLineDash([])

  // fill بین rayها
  for (let i = 0; i < rays.length - 1; i++) {
    const a = rays[i]
    const b = rays[i + 1]

    ctx.fillStyle = GANN_FAN_FILL_COLORS[i] ?? 'rgba(120,123,134,0.08)'

    ctx.beginPath()
    ctx.moveTo(origin.x, origin.y)
    ctx.lineTo(a.far.x, a.far.y)
    ctx.lineTo(b.far.x, b.far.y)
    ctx.closePath()
    ctx.fill()
  }

  // rayها
  rays.forEach(ray => {
    ctx.strokeStyle = ray.color
    ctx.lineWidth = ray.label === '1/1' ? 1.8 : 1.45

    ctx.beginPath()
    ctx.moveTo(origin.x, origin.y)
    ctx.lineTo(ray.far.x, ray.far.y)
    ctx.stroke()
  })

  // labelها
  ctx.font = '11px Vazirmatn, Inter, sans-serif'
  ctx.textBaseline = 'middle'

  rays.forEach(ray => {
    ctx.fillStyle = ray.color

    // labelهای کمتر از 1 مثل 1/8, 1/4, 1/3, 1/2
    // افقی کنار هم قرار بگیرند
    if (ray.factor > 1) {
      const labelLevelByFactor: Record<number, number> = {
        8: 0.11,
        4: 0.18,
        3: 0.25,
        2: 0.35,
      }

      const t = labelLevelByFactor[ray.factor] ?? 0.25

      const lx = origin.x + dx * t
      const ly = origin.y + dy

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(ray.label, lx, ly - 8)
      return
    }

    // بقیه labelها روی ray خودشان بمانند
    const lx = ray.target.x
    const ly = ray.target.y

    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(ray.label, lx + 4, ly)
  })

  ctx.restore()
}

function drawTrendBasedFibExtension(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  candleSeries: ISeriesApi<'Candlestick'> | null,
) {
  if (points.length < 1) return

  const [p1, p2, p3] = points

  if (points.length === 1) {
    return
  }

  if (points.length === 2) {
    ctx.save()
    ctx.strokeStyle = '#7b8494'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
    return
  }

  if (!p2 || !p3) return

  const leftX = Math.min(p2.x, p3.x)
  const rightX = Math.max(p2.x, p3.x)

  const movePrice = p2.price - p1.price
  const levelPrice = (level: number) => p3.price + movePrice * level

  const levelY = (level: number) => {
    const price = levelPrice(level)
    return candleSeries?.priceToCoordinate(price) ?? (p3.y + (p2.y - p1.y) * level)
  }

  ctx.save()

  // background zones
  for (let i = 0; i < FIB_LEVELS.length - 1; i++) {
    const y1 = levelY(FIB_LEVELS[i])
    const y2 = levelY(FIB_LEVELS[i + 1])
    ctx.fillStyle = FIB_ZONE_COLORS[i] ?? 'rgba(120,123,134,0.06)'
    ctx.fillRect(leftX, Math.min(y1, y2), rightX - leftX, Math.abs(y2 - y1))
  }

  // level lines + labels
  ctx.font = '12px Arial, Vazirmatn, sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'

  FIB_LEVELS.forEach((level, i) => {
    const y = levelY(level)
    const price = levelPrice(level)
    const color = FIB_LINE_COLORS[i] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1.35
    ctx.beginPath()
    ctx.moveTo(leftX, y)
    ctx.lineTo(rightX, y)
    ctx.stroke()

    ctx.fillText(`${level} (${price.toFixed(3)})`, leftX - 8, y)
  })

  // dashed guide path
  ctx.strokeStyle = '#7b8494'
  ctx.lineWidth = 1.4
  ctx.setLineDash([6, 6])
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y)
  ctx.lineTo(p2.x, p2.y)
  ctx.lineTo(p3.x, p3.y)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.restore()
}

function drawFibWedge(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 2) return

  const [center, rayA, rayB] = points

  // preview: بعد از نقطه اول و دوم فقط خط اولیه رسم شود
  if (points.length === 2) {
    ctx.save()
    ctx.strokeStyle = '#7b8494'
    ctx.lineWidth = 1.5
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(center.x, center.y)
    ctx.lineTo(rayA.x, rayA.y)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (!rayB) return

  const radiusA = Math.hypot(rayA.x - center.x, rayA.y - center.y)
  const radiusB = Math.hypot(rayB.x - center.x, rayB.y - center.y)
  const baseRadius = Math.max(radiusA, radiusB)

  if (baseRadius < 0.001) return

  const angleA = Math.atan2(rayA.y - center.y, rayA.x - center.x)
  const angleB = Math.atan2(rayB.y - center.y, rayB.x - center.x)

  // هر دو ضلع با radius مشترک رسم می‌شوند
  const rayAEnd = {
    x: center.x + Math.cos(angleA) * baseRadius,
    y: center.y + Math.sin(angleA) * baseRadius,
  }

  const rayBEnd = {
    x: center.x + Math.cos(angleB) * baseRadius,
    y: center.y + Math.sin(angleB) * baseRadius,
  }

  const { startAngle, endAngle, anticlockwise, midAngle } =
    getWedgeArcSpec(center, rayAEnd, rayBEnd)

  ctx.save()

  // fill bands between arcs
  for (let i = FIB_WEDGE_LEVELS.length - 1; i >= 0; i--) {
    const outerLevel = FIB_WEDGE_LEVELS[i]
    const innerLevel = i === 0 ? 0 : FIB_WEDGE_LEVELS[i - 1]

    const outerR = baseRadius * outerLevel
    const innerR = baseRadius * innerLevel

    ctx.fillStyle = FIB_ZONE_COLORS[i] ?? 'rgba(120,123,134,0.08)'

    ctx.beginPath()

    ctx.arc(
      center.x,
      center.y,
      outerR,
      startAngle,
      endAngle,
      anticlockwise,
    )

    if (innerLevel > 0) {
      const innerEndX = center.x + Math.cos(endAngle) * innerR
      const innerEndY = center.y + Math.sin(endAngle) * innerR

      ctx.lineTo(innerEndX, innerEndY)

      ctx.arc(
        center.x,
        center.y,
        innerR,
        endAngle,
        startAngle,
        !anticlockwise,
      )
    } else {
      ctx.lineTo(center.x, center.y)
    }

    ctx.closePath()
    ctx.fill()
  }

  // boundary ray A
  ctx.strokeStyle = '#787b86'
  ctx.lineWidth = 1.35
  ctx.setLineDash([])

  ctx.beginPath()
  ctx.moveTo(center.x, center.y)
  ctx.lineTo(rayAEnd.x, rayAEnd.y)
  ctx.stroke()

  // boundary ray B
  ctx.beginPath()
  ctx.moveTo(center.x, center.y)
  ctx.lineTo(rayBEnd.x, rayBEnd.y)
  ctx.stroke()

  // arc outlines + labels
  ctx.font = '11px Vazirmatn, Inter, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  FIB_WEDGE_LEVELS.forEach((level, i) => {
    const r = baseRadius * level
    const color = FIB_WEDGE_COLORS[i] ?? '#787b86'

    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1.35

    ctx.beginPath()
    ctx.arc(
      center.x,
      center.y,
      r,
      startAngle,
      endAngle,
      anticlockwise,
    )
    ctx.stroke()

    const lx = center.x + Math.cos(midAngle) * r
    const ly = center.y + Math.sin(midAngle) * r

    ctx.fillText(String(level), lx, ly - 2)
  })

  ctx.restore()
}

function drawPatternPolyline(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  labels: string[],
) {
  if (points.length < 2) return
  const isClosed = isClosedPolyline(points)

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)

  points.slice(1).forEach(point => {
    ctx.lineTo(point.x, point.y)
  })

  if (isClosed && points.length >= 3) {
    ctx.closePath()
    ctx.fillStyle = CLOSED_POLYLINE_FILL_COLOR
    ctx.fill()
  }

  ctx.stroke()
  ctx.restore()

  ctx.font = '11px Vazirmatn, sans-serif'

  points.forEach((point, index) => {
    const label = labels[index]
    if (!label) return

    ctx.fillText(label, point.x + 5, point.y - 5)
  })
}

function isClosedPolyline(points: { x: number; y: number }[]) {
  if (points.length < 3) return false
  const first = points[0]
  const last = points[points.length - 1]
  return Math.hypot(last.x - first.x, last.y - first.y) <= CLOSED_POLYLINE_DISTANCE_PX
}

function drawPathWithArrow(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return

  drawPatternPolyline(ctx, points, [])

  const end = points[points.length - 1]
  const start = [...points].reverse().find(point => Math.hypot(end.x - point.x, end.y - point.y) > 1)
  if (!start) return

  drawOpenArrowHead(ctx, start, end, 16, Math.PI / 7)
}

function getPositionGeometry(points: { x: number; y: number }[], side: 'long' | 'short') {
  const entry = points[0]
  const target = points[1] ?? {
    x: entry.x + 120,
    y: entry.y + (side === 'long' ? -64 : 64),
  }
  const stop = points[2] ?? {
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
    targetY: target.y,
    stopY: stop.y,
    profitTop: Math.min(entry.y, target.y),
    profitHeight: Math.abs(target.y - entry.y),
    lossTop: Math.min(entry.y, stop.y),
    lossHeight: Math.abs(stop.y - entry.y),
  }
}

function getFixedRangeProfilePixelBounds(
  points: { x: number; y: number }[],
  candles: Candle[],
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
) {
  if (points.length < 2 || !chart || !candleSeries) return null
  const profile = buildFixedRangeVolumeProfile(points, candles, chart)
  if (!profile) return null
  const top = candleSeries.priceToCoordinate(profile.maxPrice)
  const bottom = candleSeries.priceToCoordinate(profile.minPrice)
  if (top == null || bottom == null) return null
  return { top, bottom }
}

function drawPosition(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  side: 'long' | 'short',
  candles: Candle[],
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
  isSelected: boolean,
) {
  if (points.length < 1) return
  const geometry = getPositionGeometry(points, side)
  const { entry, target, stop, left, right, targetY, stopY } = geometry
  const entryPrice = getPositionPrice(entry)
  const targetPrice = getPositionPrice(target)
  const stopPrice = getPositionPrice(stop)
  const resolvedTrade = resolvePositionTrade(candles, chart, candleSeries, {
    side,
    left,
    right,
    entryPrice,
    targetPrice,
    stopPrice,
  })
  const top = Math.min(targetY, stopY)
  const bottom = Math.max(targetY, stopY)
  const entryX = resolvedTrade ? Math.max(left, Math.min(right, resolvedTrade.entry.x)) : null
  const clampedExitPoint = resolvedTrade
    ? {
        ...resolvedTrade.exit,
        x: Math.max(left, Math.min(right, resolvedTrade.exit.x)),
        y: Math.max(top, Math.min(bottom, resolvedTrade.exit.y)),
      }
    : null
  const rectLeft = left
  const rectRight = right
  const exitPrice = clampedExitPoint?.price ?? entryPrice
  const reward = Math.abs(targetPrice - entryPrice)
  const risk = Math.abs(entryPrice - stopPrice)
  const rewardPct = entryPrice ? (reward / Math.abs(entryPrice)) * 100 : 0
  const riskPct = entryPrice ? (risk / Math.abs(entryPrice)) * 100 : 0
  const riskReward = risk > 0 ? reward / risk : 0
  const qty = 120
  const targetAmount = reward * qty
  const stopAmount = risk * qty
  const closedPnl = side === 'long'
    ? exitPrice - entryPrice
    : entryPrice - exitPrice

  ctx.save()
  ctx.globalAlpha = 0.14
  ctx.fillStyle = '#26a69a'
  ctx.fillRect(rectLeft, geometry.profitTop, rectRight - rectLeft, geometry.profitHeight)
  ctx.fillStyle = '#ff4d5d'
  ctx.fillRect(rectLeft, geometry.lossTop, rectRight - rectLeft, geometry.lossHeight)
  ctx.globalAlpha = 1

  if (entryX != null && clampedExitPoint) {
    const tradeFillLeft = Math.min(entryX, clampedExitPoint.x)
    const tradeFillRight = Math.max(entryX, clampedExitPoint.x)
    const tradeFillTop = Math.min(entry.y, clampedExitPoint.y)
    const tradeFillHeight = Math.abs(clampedExitPoint.y - entry.y)
    ctx.globalAlpha = 0.3
    ctx.fillStyle = closedPnl >= 0 ? '#26a69a' : '#ff4d5d'
    ctx.fillRect(tradeFillLeft, tradeFillTop, tradeFillRight - tradeFillLeft, tradeFillHeight)
    ctx.globalAlpha = 1
  }

  ctx.strokeStyle = '#26a69a'
  ctx.lineWidth = 1
  drawPositionLevelLine(ctx, rectLeft, rectRight, targetY)
  ctx.strokeStyle = '#6b7280'
  drawPositionLevelLine(ctx, rectLeft, rectRight, entry.y)
  ctx.strokeStyle = '#ff4d5d'
  drawPositionLevelLine(ctx, rectLeft, rectRight, stopY)

  if (entryX != null && clampedExitPoint) {
    drawPositionTradePath(ctx, { x: entryX, y: entry.y }, { x: clampedExitPoint.x, y: clampedExitPoint.y })
  }

  if (!isSelected) {
    ctx.restore()
    return
  }

  const targetLabel = `Target: ${formatPositionValue(reward)} (${formatPositionValue(rewardPct)}%) ${formatPositionValue(reward * 1000, 0)}, Amount: ${formatPositionValue(targetAmount)}`
  const entryLabel = `Closed P&L: ${formatPositionValue(closedPnl)}, Qty: ${qty}\nRisk/Reward Ratio: ${formatPositionValue(riskReward, 2)}`
  const stopLabel = `Stop: ${formatPositionValue(risk)} (${formatPositionValue(riskPct)}%) ${formatPositionValue(risk * 1000, 0)}, Amount: ${formatPositionValue(stopAmount)}`

  const targetLabelY = targetY < entry.y ? top - 14 : bottom + 14
  const stopLabelY = stopY > entry.y ? bottom + 14 : top - 14

  const labelX = (rectLeft + rectRight) / 2
  drawPositionBadge(ctx, labelX, targetLabelY, targetLabel, '#009688')
  drawPositionBadge(ctx, labelX, entry.y, entryLabel, closedPnl >= 0 ? '#009688' : '#ff3347', '#ffffff')
  drawPositionBadge(ctx, labelX, stopLabelY, stopLabel, '#ff3347')
  ctx.restore()
}

function drawPositionLevelLine(ctx: CanvasRenderingContext2D, left: number, right: number, y: number) {
  ctx.beginPath()
  ctx.moveTo(left, y)
  ctx.lineTo(right, y)
  ctx.stroke()
}

function formatPositionValue(value: number, decimals = 3) {
  if (!Number.isFinite(value)) return '--'
  return value.toFixed(decimals)
}

function getPositionPrice(point: { y: number; price?: number }) {
  return typeof point.price === 'number' && Number.isFinite(point.price)
    ? point.price
    : point.y
}

function resolvePositionTrade(
  candles: Candle[],
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
  trade: {
    side: 'long' | 'short'
    left: number
    right: number
    entryPrice: number
    targetPrice: number
    stopPrice: number
  },
) {
  if (!chart || !candleSeries || candles.length === 0) return null

  const candlesInRange = candles
    .map((candle, index) => ({ candle, index, x: candleTimeToX(chart, candle) }))
    .filter(item => item.x != null && item.x >= trade.left && item.x <= trade.right)

  const entryHit = candlesInRange.find(item =>
    item.candle.low <= trade.entryPrice && item.candle.high >= trade.entryPrice
  )
  const entryIndex = entryHit?.index ?? -1
  if (entryIndex < 0) return null

  const entryCandle = candles[entryIndex]
  const entryX = candleTimeToX(chart, entryCandle)
  const entryY = candleSeries.priceToCoordinate(trade.entryPrice)
  if (entryX == null || entryY == null) return null

  for (let i = entryIndex; i < candles.length; i++) {
    const candle = candles[i]
    const exitX = candleTimeToX(chart, candle)
    if (exitX == null || exitX < trade.left || exitX > trade.right) continue
    const high = candle.high
    const low = candle.low
    const stopHit = trade.side === 'long'
      ? low <= trade.stopPrice
      : high >= trade.stopPrice
    const targetHit = trade.side === 'long'
      ? high >= trade.targetPrice
      : low <= trade.targetPrice

    if (!stopHit && !targetHit) continue

    const exitPrice = stopHit ? trade.stopPrice : trade.targetPrice
    const exitY = candleSeries.priceToCoordinate(exitPrice)
    if (exitX == null || exitY == null) return null

    return {
      entry: { x: entryX, y: entryY },
      exit: {
        x: exitX,
        y: exitY,
        price: exitPrice,
        reason: stopHit ? 'stop' as const : 'target' as const,
      },
    }
  }

  const lastInRange = candlesInRange.at(-1)
  if (!lastInRange) return null
  const last = lastInRange.candle
  const exitX = candleTimeToX(chart, last)
  const liveExitPrice = last.close
  const exitY = candleSeries.priceToCoordinate(liveExitPrice)
  if (exitX == null || exitY == null) return null

  return {
    entry: { x: entryX, y: entryY },
    exit: {
      x: exitX,
      y: exitY,
      price: liveExitPrice,
      reason: 'live' as const,
    },
  }
}

function candleTimeToX(chart: IChartApi, candle: Candle) {
  const time = candleUnixTime(candle)
  return chart.timeScale().timeToCoordinate(time as Time)
}

function getCandleIndexForPoint(point: PixelPoint, candles: Candle[]) {
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

function drawPositionTradePath(
  ctx: CanvasRenderingContext2D,
  entry: { x: number; y: number },
  exit: { x: number; y: number },
) {
  ctx.save()
  ctx.strokeStyle = 'rgba(95, 116, 139, 0.62)'
  ctx.fillStyle = 'rgba(95, 116, 139, 0.62)'
  ctx.lineWidth = 1
  ctx.setLineDash([5, 6])
  ctx.beginPath()
  ctx.moveTo(entry.x, entry.y)
  ctx.lineTo(exit.x, exit.y)
  ctx.stroke()
  ctx.setLineDash([])

  const angle = Math.atan2(exit.y - entry.y, exit.x - entry.x)
  const size = 8
  ctx.beginPath()
  ctx.moveTo(exit.x - Math.cos(angle - Math.PI / 6) * size, exit.y - Math.sin(angle - Math.PI / 6) * size)
  ctx.lineTo(exit.x, exit.y)
  ctx.lineTo(exit.x - Math.cos(angle + Math.PI / 6) * size, exit.y - Math.sin(angle + Math.PI / 6) * size)
  ctx.stroke()
  ctx.restore()
}

function drawPositionBadge(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  text: string,
  bg: string,
  border?: string,
) {
  const lines = text.split('\n')
  ctx.save()
  ctx.font = 'bold 10px Vazirmatn, Inter, sans-serif'

  const paddingX = 5
  const paddingY = 4
  const lineHeight = 12
  const width = Math.max(...lines.map(line => ctx.measureText(line).width)) + paddingX * 2
  const height = lines.length * lineHeight + paddingY * 2
  const x = centerX - width / 2
  const y = centerY - height / 2

  roundedRectPath(ctx, x, y, width, height, 3)
  ctx.fillStyle = bg
  ctx.fill()
  if (border) {
    ctx.strokeStyle = border
    ctx.lineWidth = 2
    ctx.stroke()
  }

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  lines.forEach((line, index) => {
    ctx.fillText(line, centerX, y + paddingY + lineHeight / 2 + index * lineHeight)
  })
  ctx.restore()
}

function drawForecast(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  candles: Candle[],
  ghost: boolean,
  color = '#2962ff',
) {
  if (points.length < 2) return

  const blue = color
  const success = '#58b368'
  const failure = '#f54b5f'
  const isBullish = points[1].price >= points[0].price
  const result = resolveForecastResult(points[1], candles, isBullish)

  ctx.save()
  ctx.strokeStyle = blue
  ctx.fillStyle = blue
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash(ghost ? [5, 5] : [])

  if (points.length >= 3) {
    drawForecastCurve(ctx, points[0], points[2])
    drawForecastArrow(ctx, points[0], points[2])
    drawForecastCurve(ctx, points[1], points[2])
  } else {
    drawForecastCurve(ctx, points[0], points[1])
    drawForecastArrow(ctx, points[0], points[1])
  }

  if (points.length >= 4) {
    drawForecastCurve(ctx, points[0], points[3])
    drawForecastArrow(ctx, points[0], points[3])
  }

  ctx.setLineDash([])
  drawForecastValueLabel(ctx, points[0], [formatPositionValue(points[0].price, 3), formatForecastDate(points[0])], blue, 'above')
  drawForecastValueLabel(ctx, points[1], [
    `${formatSigned(points[1].price - points[0].price, 3)} (${formatForecastPercent(points[0], points[1])})${getInfoLineDuration(points[0], points[1]) ? ` in ${getInfoLineDuration(points[0], points[1])}` : ''}`,
    `${formatPositionValue(points[1].price, 3)} ${formatForecastDate(points[1])}`,
  ], blue, 'above', result === null ? undefined : { text: result ? 'SUCCESS' : 'FAILURE', color: result ? success : failure })

  points.slice(2).forEach(point => {
    drawForecastValueLabel(ctx, point, [
      `${formatSigned(point.price - points[0].price, 3)} (${formatForecastPercent(points[0], point)})${getInfoLineDuration(points[0], point) ? ` in ${getInfoLineDuration(points[0], point)}` : ''}`,
      `${formatPositionValue(point.price, 3)} ${formatForecastDate(point)}`,
    ], blue, 'above')
  })

  ctx.restore()
}

function drawGhostFeed(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  chart: IChartApi | null,
) {
  if (points.length < 2) return

  ctx.save()
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.78)'
  ctx.lineWidth = 1.1
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.stroke()

  const candles = buildGhostFeedCandles(points, chart)
  candles.forEach(candle => {
    const up = candle.close <= candle.open
    const stroke = up ? 'rgba(20, 184, 166, 0.78)' : 'rgba(248, 113, 113, 0.78)'
    const fill = up ? 'rgba(153, 246, 228, 0.30)' : 'rgba(254, 202, 202, 0.34)'
    const bodyTop = Math.min(candle.open, candle.close)
    const bodyBottom = Math.max(candle.open, candle.close)

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.62)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(candle.x, candle.high)
    ctx.lineTo(candle.x, candle.low)
    ctx.stroke()

    ctx.strokeStyle = stroke
    ctx.fillStyle = fill
    ctx.lineWidth = 1
    ctx.fillRect(candle.x - candle.width / 2, bodyTop, candle.width, Math.max(2, bodyBottom - bodyTop))
    ctx.strokeRect(candle.x - candle.width / 2, bodyTop, candle.width, Math.max(2, bodyBottom - bodyTop))
  })

  ctx.restore()
}

function buildGhostFeedCandles(points: PixelPoint[], chart: IChartApi | null) {
  const candles: {
    x: number
    high: number
    low: number
    open: number
    close: number
    width: number
  }[] = []
  let previousClose: number | null = null

  for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex++) {
    const start = points[segmentIndex - 1]
    const end = points[segmentIndex]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const barWidth = getApproxBarWidth(chart)
    const slotCount = Math.max(2, Math.round(Math.abs(dx) / Math.max(barWidth, 1)))

    Array.from({ length: slotCount }, (_, i) => i).forEach(i => {
      if (segmentIndex > 1 && i === 0) return
      const t = slotCount <= 1 ? 1 : i / (slotCount - 1)
      const seed = segmentIndex * 997 + i * 37
      const x = start.x + dx * t
      const pathY = start.y + dy * t
      const wave = Math.sin((i + segmentIndex * 3) * 0.72) * 13
      const noise = (ghostRandom(seed + 9) - 0.5) * 30
      const closeCenter = pathY + wave + noise
      const capacity = 0.62
      const body = (4 + ghostRandom(seed + 1) * 22) * capacity
      const wickTop = (3 + Math.pow(ghostRandom(seed + 2), 1.7) * 28) * capacity
      const wickBottom = (3 + Math.pow(ghostRandom(seed + 3), 1.7) * 28) * capacity
      const trendStep = dy / Math.max(1, slotCount - 1)
      const open = previousClose ?? (closeCenter - trendStep * 0.45 + (ghostRandom(seed + 5) - 0.5) * 12)
      const trendBias = Math.max(-0.18, Math.min(0.18, trendStep / 70))
      const randomDirection = ghostRandom(seed + 6) < 0.5 + trendBias ? 1 : -1
      const close = closeCenter + randomDirection * body * (0.28 + ghostRandom(seed + 7) * 0.34)
      const high = Math.min(open, close) - wickTop
      const low = Math.max(open, close) + wickBottom
      previousClose = close

      candles.push({
        x,
        high,
        low,
        open,
        close,
        width: Math.max(1.4, Math.min(9, barWidth * 0.58)),
      })
    })
  }

  return candles
}

function getApproxBarWidth(chart: IChartApi | null) {
  const zero = chart?.timeScale().logicalToCoordinate(0 as Logical)
  const one = chart?.timeScale().logicalToCoordinate(1 as Logical)
  if (zero == null || one == null) return 8
  return Math.max(2, Math.min(32, Math.abs(one - zero)))
}

function ghostRandom(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

function drawBarsPatternSetup(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  points: PixelPoint[],
  candles: Candle[],
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
  mousePosition: { x: number; y: number } | null,
  clip: { x: number; y: number; width: number; height: number },
) {
  if (points.length < 1) return

  const start = points[0]
  const endX = points[1]?.x ?? mousePosition?.x
  if (endX == null) return

  const startCandle = findCandleAtX(candles, chart, start.x)
  const endCandle = findCandleAtX(candles, chart, endX)
  const startHighY = startCandle && candleSeries
    ? candleSeries.priceToCoordinate(startCandle.high)
    : start.y
  const endHighY = endCandle && candleSeries
    ? candleSeries.priceToCoordinate(endCandle.high)
    : mousePosition?.y ?? points[1]?.y ?? start.y
  if (startHighY == null || endHighY == null) return

  const offset = 70
  const startLineY = Math.max(clip.y + 8, startHighY - offset)
  const endLineY = Math.max(clip.y + 8, endHighY - offset)

  ctx.save()
  ctx.strokeStyle = 'rgba(107, 114, 128, 0.86)'
  ctx.lineWidth = 1
  ctx.setLineDash([])

  ctx.beginPath()
  ctx.moveTo(start.x, clip.y)
  ctx.lineTo(start.x, clip.y + clip.height)
  ctx.moveTo(endX, clip.y)
  ctx.lineTo(endX, clip.y + clip.height)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(start.x, startLineY)
  ctx.lineTo(endX, endLineY)
  ctx.stroke()

  ctx.setLineDash([5, 6])
  ctx.beginPath()
  ctx.moveTo(clip.x, endLineY)
  ctx.lineTo(Math.min(canvas.width, clip.x + clip.width), endLineY)
  ctx.stroke()

  ctx.restore()
}

function drawBarsPatternShadow(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  candles: Candle[],
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
) {
  if (points.length > 2) {
    ctx.save()
    ctx.strokeStyle = '#2962ff'
    ctx.lineWidth = 2
    ctx.setLineDash([])
    for (let i = 2; i + 1 < points.length; i += 2) {
      ctx.beginPath()
      ctx.moveTo(points[i].x, points[i].y)
      ctx.lineTo(points[i + 1].x, points[i + 1].y)
      ctx.stroke()
    }
    ctx.restore()
    return
  }

  if (points.length < 2 || !chart || !candleSeries) return

  const range = getBarsPatternRange(points, candles, chart)
  if (!range.length) return

  const offset = 70

  ctx.save()
  ctx.strokeStyle = '#2962ff'
  ctx.fillStyle = '#2962ff'
  ctx.lineWidth = 2
  ctx.setLineDash([])

  const firstX = candleTimeToX(chart, range[0])
  const lastX = candleTimeToX(chart, range[range.length - 1])
  if (firstX == null || lastX == null) return
  range.forEach(candle => {
    const x = candleTimeToX(chart, candle)
    const highY = candleSeries.priceToCoordinate(candle.high)
    const lowY = candleSeries.priceToCoordinate(candle.low)
    if (x == null || highY == null || lowY == null) return

    const shadowHigh = highY - offset
    const shadowLow = lowY - offset

    ctx.beginPath()
    ctx.moveTo(x, shadowHigh)
    ctx.lineTo(x, shadowLow)
    ctx.stroke()
  })

  ctx.restore()
}

function getBarsPatternAnchorPoints(
  points: { x: number; y: number }[],
  candles: Candle[],
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
) {
  if (points.length < 2 || !chart || !candleSeries) return points.slice(0, 2)
  const range = getBarsPatternRange(points, candles, chart)
  if (!range.length) return points.slice(0, 2)
  const first = range[0]
  const last = range[range.length - 1]
  const firstX = candleTimeToX(chart, first)
  const lastX = candleTimeToX(chart, last)
  const firstHighY = candleSeries.priceToCoordinate(first.high)
  const lastLowY = candleSeries.priceToCoordinate(last.low)
  if (firstX == null || lastX == null || firstHighY == null || lastLowY == null) return points.slice(0, 2)
  const offset = 70
  return [
    { x: firstX, y: firstHighY - offset },
    { x: lastX, y: lastLowY - offset },
  ]
}

function getBarsPatternRange(
  points: { x: number; y: number }[],
  candles: Candle[],
  chart: IChartApi | null,
) {
  if (!chart || points.length < 2) return []
  const [a, b] = points
  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)

  return candles.filter(candle => {
    const x = candleTimeToX(chart, candle)
    return x != null && x >= left && x <= right
  })
}

function findCandleAtX(
  candles: Candle[],
  chart: IChartApi | null,
  x: number,
) {
  if (!chart || candles.length === 0) return null
  let nearest: { candle: Candle; distance: number } | null = null

  for (const candle of candles) {
    const cx = candleTimeToX(chart, candle)
    if (cx == null) continue
    const distance = Math.abs(cx - x)
    if (!nearest || distance < nearest.distance) {
      nearest = { candle, distance }
    }
  }

  return nearest?.candle ?? null
}

function resolveForecastResult(target: PixelPoint, candles: Candle[], isBullish: boolean) {
  const candle = findForecastCandle(target, candles)
  if (!candle) return null
  return isBullish
    ? candle.high >= target.price
    : candle.low <= target.price
}

function findForecastCandle(point: PixelPoint, candles: Candle[]) {
  if (candles.length === 0) return null

  const byTimeIndex = getCandleIndexForPoint(point, candles)
  if (byTimeIndex != null) return candles[byTimeIndex]

  const logical = Number(point.logical)
  if (Number.isFinite(logical)) {
    const byLogical = candles[Math.max(0, Math.min(candles.length - 1, Math.round(logical)))]
    if (byLogical) return byLogical
  }

  if (point.time != null) {
    const targetMs = point.time * 1000
    let nearest = candles[0]
    let nearestDistance = Math.abs(new Date(nearest.ts).getTime() - targetMs)
    for (const candle of candles) {
      const distance = Math.abs(new Date(candle.ts).getTime() - targetMs)
      if (distance < nearestDistance) {
        nearest = candle
        nearestDistance = distance
      }
    }
    return nearest
  }

  return null
}

function drawForecastCurve(ctx: CanvasRenderingContext2D, start: PixelPoint, end: PixelPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  for (let i = 1; i <= 48; i++) {
    const t = i / 48
    ctx.lineTo(start.x + dx * t, start.y + dy * t * t)
  }
  ctx.stroke()
}

function drawForecastArrow(ctx: CanvasRenderingContext2D, start: PixelPoint, end: PixelPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const angle = Math.atan2(dy * 2, dx)
  const size = 11
  ctx.beginPath()
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(end.x - Math.cos(angle - Math.PI / 7) * size, end.y - Math.sin(angle - Math.PI / 7) * size)
  ctx.lineTo(end.x - Math.cos(angle) * size * 0.62, end.y - Math.sin(angle) * size * 0.62)
  ctx.lineTo(end.x - Math.cos(angle + Math.PI / 7) * size, end.y - Math.sin(angle + Math.PI / 7) * size)
  ctx.closePath()
  ctx.fill()
}

function drawForecastValueLabel(
  ctx: CanvasRenderingContext2D,
  point: PixelPoint,
  lines: string[],
  color: string,
  placement: 'above' | 'below',
  status?: { text: string; color: string },
) {
  ctx = getRawDrawingContext(ctx)
  const paddingX = 5
  const lineHeight = 13

  ctx.save()
  ctx.font = '700 11px Vazirmatn, Inter, sans-serif'

  const bodyWidth = Math.max(86, ...lines.map(line => ctx.measureText(line).width + paddingX * 2))
  const bodyHeight = lines.length * lineHeight + 5
  const statusHeight = status ? 21 : 0
  const totalHeight = bodyHeight + statusHeight
  const x = point.x - bodyWidth / 2
  const y = placement === 'above' ? point.y - totalHeight - 10 : point.y + 10

  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  if (status) {
    roundedRectPath(ctx, x, y, bodyWidth, statusHeight, 4)
    ctx.fillStyle = status.color
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    if (status.text === 'SUCCESS') {
      ctx.fillText('✓ SUCCESS', point.x, y + 13)
    } else {
      drawForecastFailureIcon(ctx, point.x - 29, y + 12.5, 15)
      ctx.fillText('FAILURE', point.x + 8, y + 13)
    }
    ctx.textAlign = 'left'
  }

  roundedRectPath(ctx, x, y + statusHeight, bodyWidth, bodyHeight, 3)
  ctx.fillStyle = color
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  lines.forEach((line, index) => {
    ctx.fillText(line, x + paddingX, y + statusHeight + 11 + index * lineHeight)
  })
  ctx.restore()
}

function drawForecastFailureIcon(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
) {
  const scale = size / 404.693
  ctx.save()
  ctx.translate(centerX - size / 2, centerY - size / 2)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(127.811, 158.887)
  ctx.bezierCurveTo(150.004, 158.887, 168.061, 140.828, 168.061, 118.629)
  ctx.bezierCurveTo(168.061, 96.432, 150.004, 78.373, 127.811, 78.373)
  ctx.bezierCurveTo(105.612, 78.373, 87.555, 96.432, 87.555, 118.629)
  ctx.bezierCurveTo(87.555, 140.828, 105.612, 158.887, 127.811, 158.887)
  ctx.closePath()
  ctx.moveTo(127.811, 106.045)
  ctx.bezierCurveTo(134.75, 106.045, 140.391, 111.691, 140.391, 118.629)
  ctx.bezierCurveTo(140.391, 125.568, 134.75, 131.215, 127.811, 131.215)
  ctx.bezierCurveTo(120.873, 131.215, 115.225, 125.569, 115.225, 118.629)
  ctx.bezierCurveTo(115.225, 111.692, 120.873, 106.045, 127.811, 106.045)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(276.889, 78.373)
  ctx.bezierCurveTo(254.69, 78.373, 236.631, 96.432, 236.631, 118.629)
  ctx.bezierCurveTo(236.631, 140.828, 254.69, 158.887, 276.889, 158.887)
  ctx.bezierCurveTo(299.082, 158.887, 317.139, 140.828, 317.139, 118.629)
  ctx.bezierCurveTo(317.139, 96.432, 299.082, 78.373, 276.889, 78.373)
  ctx.closePath()
  ctx.moveTo(276.889, 131.215)
  ctx.bezierCurveTo(269.951, 131.215, 264.303, 125.569, 264.303, 118.629)
  ctx.bezierCurveTo(264.303, 111.691, 269.951, 106.045, 276.889, 106.045)
  ctx.bezierCurveTo(283.828, 106.045, 289.469, 111.691, 289.469, 118.629)
  ctx.bezierCurveTo(289.469, 125.569, 283.826, 131.215, 276.889, 131.215)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(202.346, 175.627)
  ctx.bezierCurveTo(139.053, 175.627, 87.555, 227.127, 87.555, 290.419)
  ctx.bezierCurveTo(87.555, 298.06, 93.748, 304.255, 101.391, 304.255)
  ctx.bezierCurveTo(109.032, 304.255, 115.225, 298.06, 115.225, 290.419)
  ctx.bezierCurveTo(115.225, 242.38, 154.307, 203.298, 202.346, 203.298)
  ctx.bezierCurveTo(250.387, 203.298, 289.469, 242.38, 289.469, 290.419)
  ctx.bezierCurveTo(289.469, 298.06, 295.662, 304.255, 303.303, 304.255)
  ctx.bezierCurveTo(310.944, 304.255, 317.139, 298.06, 317.139, 290.419)
  ctx.bezierCurveTo(317.139, 227.127, 265.641, 175.627, 202.346, 175.627)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function formatForecastPercent(start: PixelPoint, end: PixelPoint) {
  if (!Number.isFinite(start.price) || start.price === 0) return '0.00%'
  return `${(((end.price - start.price) / start.price) * 100).toFixed(2)}%`
}

function formatForecastDate(point: PixelPoint) {
  if (point.time == null) return ''
  const date = new Date(point.time * 1000)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

function drawTimeCycles(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  points: PixelPoint[],
  color = '#2FA37A',
) {
  if (points.length < 2) return

  const p1 = points[0]
  const p2 = points[1]

  // دو نود = دو سر اولین نیم‌دایره
  const diameter = Math.abs(p2.x - p1.x)
  if (diameter < 1) return

  const radius = diameter / 2
  const baseY = (p1.y + p2.y) / 2
  const dir = p2.x >= p1.x ? 1 : -1

  const firstLeftX = dir > 0 ? Math.min(p1.x, p2.x) : Math.min(p2.x, p1.x)
  const firstCenterX = firstLeftX + radius

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = 'rgba(120, 170, 90, 0.45)'
  ctx.lineWidth = 2
  ctx.setLineDash([])

  // از هر دو طرف extend
  const startCenter =
    firstCenterX - Math.ceil(firstCenterX / diameter) * diameter - diameter
  const endCenter = canvas.width + diameter * 2

  for (let cx = startCenter; cx <= endCenter; cx += diameter) {
    const left = cx - radius

    // fill بدون خط زیر
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(left, baseY)
    ctx.arc(cx, baseY, radius, Math.PI, 0, false)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // فقط خود کمان stroke شود
    ctx.beginPath()
    ctx.arc(cx, baseY, radius, Math.PI, 0, false)
    ctx.stroke()
  }

  ctx.restore()
}

function drawSineLine(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  points: PixelPoint[],
  color = '#16A085',
) {
  if (points.length < 2) return

  const p1 = points[0]
  const p2 = points[1]

  const halfPeriod = Math.abs(p2.x - p1.x)
  if (halfPeriod < 1) return

  const midY = (p1.y + p2.y) / 2
  const ampTerm = (p1.y - p2.y) / 2

  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([])

  ctx.beginPath()

  let started = false

  for (let x = 0; x <= canvas.width; x += 2) {
    const t = (x - p1.x) / halfPeriod

    // p1 و p2 دو اکسترمم مخالف‌اند
    const y = midY + ampTerm * Math.cos(Math.PI * t)

    if (!started) {
      ctx.moveTo(x, y)
      started = true
    } else {
      ctx.lineTo(x, y)
    }
  }

  ctx.stroke()
  ctx.restore()
}

function drawElliottDoubleComboWave(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
) {
  if (points.length < 1) return

  const color = '#6AA84F'
  const labels = ['', 'W', 'X', 'Y']

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([])

  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }

    ctx.stroke()
  }

  points.forEach((p, i) => {
    const label = labels[i]
    if (label) {
      drawElliottDoubleComboLabel(ctx, p, label, color)
    }
  })

  ctx.restore()
}

function drawProjection(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return

  const [origin, upperPoint, lowerPoint] = points

  if (points.length < 3) {
    ctx.save()
    ctx.strokeStyle = '#b8c0cc'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(origin.x, origin.y)
    ctx.lineTo(upperPoint.x, upperPoint.y)
    ctx.stroke()
    ctx.restore()
    return
  }

  const geometry = getProjectionSectorGeometry(origin, upperPoint, lowerPoint)
  if (!geometry) return

  const { upper, radius, startAngle, endAngle, anticlockwise } = geometry
  const gradient = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, radius)
  gradient.addColorStop(0, 'rgba(129, 199, 132, 0.28)')
  gradient.addColorStop(0.5, 'rgba(221, 224, 211, 0.27)')
  gradient.addColorStop(1, 'rgba(239, 154, 181, 0.44)')

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(upper.x, upper.y)
  ctx.arc(origin.x, origin.y, radius, startAngle, endAngle, anticlockwise)
  ctx.closePath()
  ctx.fillStyle = gradient
  ctx.fill()

  ctx.strokeStyle = 'rgba(176, 185, 197, 0.86)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(upper.x, upper.y)
  ctx.arc(origin.x, origin.y, radius, startAngle, endAngle, anticlockwise)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

function getProjectionSectorGeometry(
  origin: { x: number; y: number },
  upperPoint: { x: number; y: number },
  lowerPoint: { x: number; y: number },
) {
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
  const delta = normalizeAngleDelta(lowerAngle - upperAngle)
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

function normalizeAngleDelta(delta: number) {
  while (delta <= -Math.PI) delta += Math.PI * 2
  while (delta > Math.PI) delta -= Math.PI * 2
  return delta
}

function getProjectionSectorHandlePoints(points: { x: number; y: number }[]) {
  if (points.length < 3) return points
  const geometry = getProjectionSectorGeometry(points[0], points[1], points[2])
  if (!geometry) return points
  return [points[0], geometry.upper, geometry.lower]
}

function drawAnchoredVwap(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  candles: Candle[],
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
) {
  if (points.length < 1) return
  if (!chart || !candleSeries || candles.length === 0) return
  const anchor = points[0]
  const startIndex = getCandleIndexForPoint(anchor, candles) ?? 0
  const vwapPoints: { x: number; y: number; price: number }[] = []
  const upperPoints: { x: number; y: number }[] = []
  const lowerPoints: { x: number; y: number }[] = []
  let cumulativePv = 0
  let cumulativeVolume = 0
  let cumulativeVariance = 0

  for (let i = startIndex; i < candles.length; i++) {
    const candle = candles[i]
    const x = candleTimeToX(chart, candle)
    if (x == null) continue
    const typical = (candle.high + candle.low + candle.close) / 3
    const volume = Math.max(1, candle.volume ?? 1)
    cumulativePv += typical * volume
    cumulativeVolume += volume
    const vwap = cumulativePv / cumulativeVolume
    cumulativeVariance += volume * Math.pow(typical - vwap, 2)
    const deviation = Math.sqrt(cumulativeVariance / cumulativeVolume)
    const y = candleSeries.priceToCoordinate(vwap)
    const upperY = candleSeries.priceToCoordinate(vwap + deviation)
    const lowerY = candleSeries.priceToCoordinate(vwap - deviation)
    if (y == null || upperY == null || lowerY == null) continue
    vwapPoints.push({ x, y, price: vwap })
    upperPoints.push({ x, y: upperY })
    lowerPoints.push({ x, y: lowerY })
  }

  if (vwapPoints.length < 2) return

  ctx.save()
  ctx.fillStyle = 'rgba(76, 175, 80, 0.08)'
  ctx.beginPath()
  ctx.moveTo(upperPoints[0].x, upperPoints[0].y)
  upperPoints.slice(1).forEach(point => ctx.lineTo(point.x, point.y))
  lowerPoints.slice().reverse().forEach(point => ctx.lineTo(point.x, point.y))
  ctx.closePath()
  ctx.fill()

  drawAnchoredVwapLine(ctx, upperPoints, '#4CAF50', 1.2)
  drawAnchoredVwapLine(ctx, vwapPoints, '#2196F3', 1.5)
  drawAnchoredVwapLine(ctx, lowerPoints, '#4CAF50', 1.2)

  ctx.restore()
}

function drawAnchoredVwapLine(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string,
  width: number,
) {
  if (points.length < 2) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  points.slice(1).forEach(point => ctx.lineTo(point.x, point.y))
  ctx.stroke()
  ctx.restore()
}

function drawFixedRangeVolumeProfile(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  points: PixelPoint[],
  candles: Candle[],
  chart: IChartApi | null,
  candleSeries: ISeriesApi<'Candlestick'> | null,
  isPreview = false,
) {
  if (points.length < 1) return
  const first = points[0]
  const second = points[1]

  ctx.save()

  if (isPreview || !second || !chart || !candleSeries) {
    ctx.strokeStyle = 'rgba(107, 114, 128, 0.84)'
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(first.x, 0)
    ctx.lineTo(first.x, canvas.height)
    if (second) {
      ctx.moveTo(second.x, 0)
      ctx.lineTo(second.x, canvas.height)
      ctx.moveTo(first.x, first.y)
      ctx.lineTo(second.x, second.y)
    }
    ctx.stroke()
    if (second) {
      ctx.setLineDash([5, 6])
      ctx.beginPath()
      ctx.moveTo(0, second.y)
      ctx.lineTo(canvas.width, second.y)
      ctx.stroke()
    }
    ctx.restore()
    return
  }

  const profile = buildFixedRangeVolumeProfile(points, candles, chart)
  if (!profile) {
    ctx.restore()
    return
  }

  const left = Math.min(first.x, second.x)
  const right = Math.max(first.x, second.x)
  const topY = candleSeries.priceToCoordinate(profile.maxPrice)
  const bottomY = candleSeries.priceToCoordinate(profile.minPrice)
  if (topY == null || bottomY == null) {
    ctx.restore()
    return
  }

  ctx.fillStyle = 'rgba(232, 245, 252, 0.08)'
  ctx.fillRect(left, topY, right - left, bottomY - topY)

  const maxWidth = Math.max(40, (right - left) * 0.30)
  const maxVolume = Math.max(...profile.bins.map(bin => bin.total), 1)

  profile.bins.forEach(bin => {
    const y1 = candleSeries.priceToCoordinate(bin.high)
    const y2 = candleSeries.priceToCoordinate(bin.low)
    if (y1 == null || y2 == null) return
    const rowTop = Math.min(y1, y2)
    const rowHeight = Math.max(2, Math.abs(y2 - y1) - 1)
    const totalWidth = (bin.total / maxVolume) * maxWidth
    const sellWidth = totalWidth * (bin.sell / Math.max(bin.total, 1))
    const buyWidth = Math.max(0, totalWidth - sellWidth)
    const inValueArea = bin.index >= profile.valueLowIndex && bin.index <= profile.valueHighIndex

    ctx.globalAlpha = inValueArea ? 0.34 : 0.16
    ctx.fillStyle = '#5bb6ed'
    ctx.fillRect(left, rowTop, sellWidth, rowHeight)
    ctx.fillStyle = DRAWING_NODE_BLUE
    ctx.fillRect(left + sellWidth, rowTop, buyWidth, rowHeight)
  })
  ctx.globalAlpha = 1

  const poc = profile.bins[profile.pocIndex]
  const pocY = candleSeries.priceToCoordinate((poc.low + poc.high) / 2)
  if (pocY != null) {
    ctx.strokeStyle = 'rgba(239, 35, 60, 0.58)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(left, pocY)
    ctx.lineTo(right, pocY)
    ctx.stroke()
  }

  ctx.restore()
}

function buildFixedRangeVolumeProfile(
  points: { x: number; y: number }[],
  candles: Candle[],
  chart: IChartApi,
) {
  if (points.length < 2) return null
  const left = Math.min(points[0].x, points[1].x)
  const right = Math.max(points[0].x, points[1].x)
  const rangeCandles = candles.filter(candle => {
    const time = candleUnixTime(candle)
    const x = timeToAnchoredCoordinate(chart, candles, { time })
    return x != null && x >= left && x <= right
  })
  if (!rangeCandles.length) return null

  const minPrice = Math.min(...rangeCandles.map(candle => candle.low))
  const maxPrice = Math.max(...rangeCandles.map(candle => candle.high))
  const binCount = 42
  const step = (maxPrice - minPrice) / binCount
  if (!Number.isFinite(step) || step <= 0) return null

  const bins = Array.from({ length: binCount }, (_, index) => ({
    index,
    low: minPrice + index * step,
    high: minPrice + (index + 1) * step,
    buy: 0,
    sell: 0,
    total: 0,
  }))

  rangeCandles.forEach(candle => {
    const low = candle.low
    const high = candle.high
    const span = Math.max(high - low, step)
    const volume = Math.max(1, candle.volume ?? 1)
    const buyShare = candle.close >= candle.open ? 0.68 : 0.32

    bins.forEach(bin => {
      const overlap = Math.max(0, Math.min(high, bin.high) - Math.max(low, bin.low))
      if (overlap <= 0) return
      const share = overlap / span
      const vol = volume * share
      bin.buy += vol * buyShare
      bin.sell += vol * (1 - buyShare)
      bin.total += vol
    })
  })

  let pocIndex = 0
  bins.forEach((bin, index) => {
    if (bin.total > bins[pocIndex].total) pocIndex = index
  })

  const target = bins.reduce((sum, bin) => sum + bin.total, 0) * 0.70
  let valueLowIndex = pocIndex
  let valueHighIndex = pocIndex
  let areaVolume = bins[pocIndex].total
  while (areaVolume < target && (valueLowIndex > 0 || valueHighIndex < bins.length - 1)) {
    const nextLow = valueLowIndex > 0 ? bins[valueLowIndex - 1].total : -1
    const nextHigh = valueHighIndex < bins.length - 1 ? bins[valueHighIndex + 1].total : -1
    if (nextHigh >= nextLow) {
      valueHighIndex++
      areaVolume += Math.max(0, nextHigh)
    } else {
      valueLowIndex--
      areaVolume += Math.max(0, nextLow)
    }
  }

  return { bins, minPrice, maxPrice, pocIndex, valueLowIndex, valueHighIndex }
}

function drawPriceRange(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const [a, b] = points
  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const bottom = Math.max(a.y, b.y)
  const midX = (left + right) / 2
  const up = b.price >= a.price
  const color = '#2962ff'
  const delta = b.price - a.price
  const percent = a.price !== 0 ? (delta / a.price) * 100 : 0
  const label = `${formatPriceRangeDelta(delta, 3)} (${formatPriceRangeDelta(percent, 2)}%) ${formatPositionValue(b.price, 3)}`

  ctx.save()
  ctx.fillStyle = 'rgba(41, 98, 255, 0.15)'
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([])
  ctx.fillRect(left, top, right - left, bottom - top)

  ctx.beginPath()
  ctx.moveTo(left, top)
  ctx.lineTo(right, top)
  ctx.moveTo(left, bottom)
  ctx.lineTo(right, bottom)
  ctx.moveTo(midX, top)
  ctx.lineTo(midX, bottom)
  ctx.stroke()

  const arrowY = up ? top : bottom
  const arrowDir = up ? -1 : 1
  ctx.beginPath()
  ctx.moveTo(midX - 10, arrowY - arrowDir * 10)
  ctx.lineTo(midX, arrowY)
  ctx.lineTo(midX + 10, arrowY - arrowDir * 10)
  ctx.stroke()

  drawRangeLabel(ctx, midX, up ? top - 22 : bottom + 22, label)
  ctx.restore()
}

function formatPriceRangeDelta(value: number, decimals: number) {
  const sign = value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(decimals)}`
}

function drawRangeLabel(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  text: string,
) {
  ctx.save()
  ctx.font = '700 12px Vazirmatn, Inter, sans-serif'
  const lines = text.split('\n')
  const width = Math.max(...lines.map(line => ctx.measureText(line).width)) + 18
  const height = lines.length === 1 ? 25 : lines.length * 18 + 8
  const x = centerX - width / 2
  const y = centerY - height / 2
  roundedRectPath(ctx, x, y, width, height, 4)
  ctx.fillStyle = 'rgba(17, 24, 39, 0.92)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (lines.length === 1) {
    ctx.fillText(lines[0], centerX, centerY + 0.5)
  } else {
    const startY = centerY - ((lines.length - 1) * 18) / 2
    lines.forEach((line, index) => {
      ctx.font = index === 0 ? '700 12px Vazirmatn, Inter, sans-serif' : '600 11px Vazirmatn, Inter, sans-serif'
      ctx.fillText(line, centerX, startY + index * 18)
    })
  }
  ctx.restore()
}

function drawDateRange(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  candles: Candle[] = [],
  chart: IChartApi | null = null,
) {
  if (points.length < 2) return
  const [a, b] = points
  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const bottom = Math.max(a.y, b.y)
  const midY = (top + bottom) / 2
  const color = '#2962ff'
  const bars = getBarDistanceForPoints(a, b, candles)
  const volume = getDateRangeVolume(a, b, candles, chart)
  const duration = formatDateRangeDuration(a, b)
  const label = `${bars} bars, ${duration}\nVol ${formatCompactVolume(volume)}`

  ctx.save()
  ctx.fillStyle = 'rgba(41, 98, 255, 0.15)'
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([])
  ctx.fillRect(left, top, right - left, bottom - top)

  ctx.beginPath()
  ctx.moveTo(left, top)
  ctx.lineTo(left, bottom)
  ctx.moveTo(right, top)
  ctx.lineTo(right, bottom)
  ctx.moveTo(left, midY)
  ctx.lineTo(right, midY)
  ctx.stroke()

  const arrowAtRight = b.x >= a.x
  const arrowX = arrowAtRight ? right : left
  const arrowDir = arrowAtRight ? 1 : -1
  ctx.beginPath()
  ctx.moveTo(arrowX - arrowDir * 11, midY - 10)
  ctx.lineTo(arrowX, midY)
  ctx.lineTo(arrowX - arrowDir * 11, midY + 10)
  ctx.stroke()

  drawRangeLabel(ctx, (left + right) / 2, b.y >= a.y ? bottom + 22 : top - 22, label)
  ctx.restore()
}

function getDateRangeVolume(
  a: PixelPoint,
  b: PixelPoint,
  candles: Candle[],
  chart: IChartApi | null,
) {
  if (!chart) return 0
  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)
  return candles.reduce((sum, candle) => {
    const x = candleTimeToX(chart, candle)
    if (x == null || x < left || x > right) return sum
    return sum + (candle.volume ?? 0)
  }, 0)
}

function getBarDistanceForPoints(a: PixelPoint, b: PixelPoint, candles: Candle[]) {
  const aIndex = getCandleIndexForPoint(a, candles)
  const bIndex = getCandleIndexForPoint(b, candles)
  if (aIndex != null && bIndex != null) return bIndex - aIndex
  return Math.round(Number(b.logical) - Number(a.logical))
}

function formatDateRangeDuration(a: PixelPoint, b: PixelPoint) {
  if (a.time == null || b.time == null) return '0m'
  const totalMinutes = Math.round((b.time - a.time) / 60)
  const sign = totalMinutes < 0 ? '-' : ''
  const abs = Math.abs(totalMinutes)
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60
  return `${sign}${hours}h ${minutes}m`
}

function formatCompactVolume(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(3)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(3)}K`
  return value.toFixed(0)
}

function drawDateAndPriceRange(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  candles: Candle[] = [],
  chart: IChartApi | null = null,
) {
  if (points.length < 2) return
  const [a, b] = points
  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const bottom = Math.max(a.y, b.y)
  const midX = (left + right) / 2
  const midY = (top + bottom) / 2
  const priceUp = b.price >= a.price
  const timeRight = b.x >= a.x
  const color = '#2962ff'
  const delta = b.price - a.price
  const percent = a.price !== 0 ? (delta / a.price) * 100 : 0
  const bars = getBarDistanceForPoints(a, b, candles)
  const duration = formatDateRangeDuration(a, b)
  const volume = getDateRangeVolume(a, b, candles, chart)
  const label = [
    `${formatPriceRangeDelta(delta, 3)} (${formatPriceRangeDelta(percent, 2)}%) ${formatPositionValue(b.price, 3)}`,
    `${bars} bars, ${duration}`,
    `Vol ${formatCompactVolume(volume)}`,
  ].join('\n')

  ctx.save()
  ctx.fillStyle = 'rgba(41, 98, 255, 0.15)'
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash([])
  ctx.fillRect(left, top, right - left, bottom - top)

  ctx.beginPath()
  ctx.moveTo(left, midY)
  ctx.lineTo(right, midY)
  ctx.moveTo(midX, top)
  ctx.lineTo(midX, bottom)
  ctx.stroke()

  const arrowX = timeRight ? right : left
  const arrowDirX = timeRight ? 1 : -1
  ctx.beginPath()
  ctx.moveTo(arrowX - arrowDirX * 11, midY - 10)
  ctx.lineTo(arrowX, midY)
  ctx.lineTo(arrowX - arrowDirX * 11, midY + 10)
  ctx.stroke()

  const arrowY = priceUp ? top : bottom
  const arrowDirY = priceUp ? -1 : 1
  ctx.beginPath()
  ctx.moveTo(midX - 10, arrowY - arrowDirY * 10)
  ctx.lineTo(midX, arrowY)
  ctx.lineTo(midX + 10, arrowY - arrowDirY * 10)
  ctx.stroke()

  drawRangeLabel(ctx, midX, priceUp ? top - 40 : bottom + 40, label)
  ctx.restore()
}

function drawSmoothPath(ctx: CanvasRenderingContext2D, points: PixelPoint[], highlighter: boolean) {
  if (points.length < 2) return
  const smoothIterations = points.length > 900 ? 0 : points.length > 350 ? 1 : 2
  const pathPoints = smoothFreehandPoints(points, smoothIterations)
  ctx.save()
  if (highlighter) {
    ctx.globalAlpha = 0.28
    ctx.lineWidth = 24
  } else {
    ctx.lineWidth = 2
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(pathPoints[0].x, pathPoints[0].y)

  if (pathPoints.length === 2) {
    ctx.lineTo(pathPoints[1].x, pathPoints[1].y)
    ctx.stroke()
    ctx.restore()
    return
  }

  for (let i = 0; i < pathPoints.length - 1; i++) {
    const p0 = pathPoints[Math.max(0, i - 1)]
    const p1 = pathPoints[i]
    const p2 = pathPoints[i + 1]
    const p3 = pathPoints[Math.min(pathPoints.length - 1, i + 2)]
    const cp1x = p1.x + (p2.x - p0.x) / 8
    const cp1y = p1.y + (p2.y - p0.y) / 8
    const cp2x = p2.x - (p3.x - p1.x) / 8
    const cp2y = p2.y - (p3.y - p1.y) / 8
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
  }
  ctx.stroke()
  ctx.restore()
}

function smoothFreehandPoints(points: PixelPoint[], iterations: number) {
  let smoothed = points

  for (let pass = 0; pass < iterations; pass++) {
    if (smoothed.length < 3) return smoothed
    const next: PixelPoint[] = [smoothed[0]]

    for (let i = 0; i < smoothed.length - 1; i++) {
      const a = smoothed[i]
      const b = smoothed[i + 1]
      next.push(
        { ...a, x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
        { ...b, x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
      )
    }

    next.push(smoothed[smoothed.length - 1])
    smoothed = next
  }

  return smoothed
}

function drawArrowLine(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const [start, end] = points
  ctx.save()
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
  drawOpenArrowHead(ctx, start, end, 16, Math.PI / 7)
  ctx.restore()
}

function drawOpenArrowHead(
  ctx: CanvasRenderingContext2D,
  start: PixelPoint,
  end: PixelPoint,
  size: number,
  spread: number,
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  ctx.beginPath()
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(end.x - Math.cos(angle - spread) * size, end.y - Math.sin(angle - spread) * size)
  ctx.moveTo(end.x, end.y)
  ctx.lineTo(end.x - Math.cos(angle + spread) * size, end.y - Math.sin(angle + spread) * size)
  ctx.stroke()
}

function drawArrowMarker(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const [start, end] = points
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return

  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const scale = len / 560
  const local = (x: number, y: number) => ({
    x: start.x + ux * (x * scale) + nx * (y * scale),
    y: start.y + uy * (x * scale) + ny * (y * scale),
  })

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  const p0 = local(0, -5)
  ctx.moveTo(p0.x, p0.y)
  const c1 = local(0, -5)
  const c2 = local(360, -30)
  const p1 = local(360, -30)
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p1.x, p1.y)
  const p2 = local(360, -60)
  const p3 = local(560, 0)
  const p4 = local(360, 60)
  const p5 = local(360, 30)
  ctx.lineTo(p2.x, p2.y)
  ctx.lineTo(p3.x, p3.y)
  ctx.lineTo(p4.x, p4.y)
  ctx.lineTo(p5.x, p5.y)
  const c3 = local(360, 30)
  const c4 = local(0, 5)
  const p6 = local(0, 5)
  ctx.bezierCurveTo(c3.x, c3.y, c4.x, c4.y, p6.x, p6.y)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(start.x, start.y, 5 * scale, 5 * scale, Math.atan2(uy, ux), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawArrowMark(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  direction: 'up' | 'down' | 'left' | 'right',
  color: string,
) {
  if (points.length < 1) return
  const p = points[0]
  const length = 36
  const head = 20
  const halfHead = 16
  const halfTail = 8
  const dir = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }[direction]
  const nx = -dir.y
  const ny = dir.x
  const along = (distance: number, side = 0) => ({
    x: p.x - dir.x * distance + nx * side,
    y: p.y - dir.y * distance + ny * side,
  })
  const shapes = [
    { x: p.x, y: p.y },
    along(head, halfHead),
    along(head, halfTail),
    along(length, halfTail),
    along(length, -halfTail),
    along(head, -halfTail),
    along(head, -halfHead),
  ]
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  shapes.forEach(({ x, y }, i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawRotatedRectangle(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  if (points.length < 3) {
    ctx.save()
    ctx.strokeStyle = '#4caf50'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    ctx.lineTo(points[1].x, points[1].y)
    ctx.stroke()
    ctx.restore()
    return
  }
  const geometry = getRotatedRectangleGeometry(points)
  if (!geometry) return
  const { a, b, c, d } = geometry
  ctx.save()
  ctx.strokeStyle = '#4caf50'
  ctx.fillStyle = 'rgba(76, 175, 80, 0.18)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(c.x, c.y)
  ctx.lineTo(d.x, d.y)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function getRotatedRectangleGeometry(points: { x: number; y: number }[]) {
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

function drawCircle(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  const radius = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
  ctx.save()
  ctx.strokeStyle = CIRCLE_STROKE_COLOR
  ctx.fillStyle = CIRCLE_FILL_COLOR
  ctx.lineWidth = CIRCLE_LINE_WIDTH
  ctx.beginPath()
  ctx.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawArc(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  if (points.length < 3) {
    ctx.save()
    ctx.strokeStyle = ARC_STROKE_COLOR
    ctx.lineWidth = ARC_LINE_WIDTH
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    ctx.lineTo(points[1].x, points[1].y)
    ctx.stroke()
    ctx.restore()
    return
  }

  const control = getQuadraticArcControl(points[0], points[1], points[2])
  ctx.save()
  ctx.strokeStyle = ARC_STROKE_COLOR
  ctx.fillStyle = ARC_FILL_COLOR
  ctx.lineWidth = ARC_LINE_WIDTH

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  ctx.quadraticCurveTo(control.x, control.y, points[1].x, points[1].y)
  ctx.lineTo(points[0].x, points[0].y)
  ctx.closePath()
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  ctx.quadraticCurveTo(control.x, control.y, points[1].x, points[1].y)
  ctx.stroke()
  ctx.restore()
}

function getQuadraticArcControl(
  start: { x: number; y: number },
  end: { x: number; y: number },
  midpoint: { x: number; y: number },
) {
  return {
    x: 2 * midpoint.x - (start.x + end.x) / 2,
    y: 2 * midpoint.y - (start.y + end.y) / 2,
  }
}

function drawCurve(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 3) return
  const control = getQuadraticArcControl(points[0], points[1], points[2])
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  ctx.quadraticCurveTo(control.x, control.y, points[1].x, points[1].y)
  ctx.stroke()
}

function drawDoubleCurve(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 4) return
  const controls = getCubicThroughFourPointControls(points[0], points[1], points[2], points[3])
  ctx.save()
  ctx.strokeStyle = DOUBLE_CURVE_STROKE_COLOR
  ctx.lineWidth = DOUBLE_CURVE_LINE_WIDTH
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  ctx.bezierCurveTo(controls.c1.x, controls.c1.y, controls.c2.x, controls.c2.y, points[3].x, points[3].y)
  ctx.stroke()
  ctx.restore()
}

function getCubicThroughFourPointControls(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
) {
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

function drawTextNote(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  text: string,
  variant: 'plain' | 'anchored' | 'note' | 'pin' | 'anchored-pin' | 'callout' | 'comment' | 'price-label' | 'signpost' | 'flag',
  drawing: Drawing,
  active = false,
  editing = false,
  cursorVisible = false,
) {
  if (points.length < 1) return
  const p = points[0]
  ctx.save()
  ctx.font = variant === 'plain' || variant === 'anchored' ? '20px Vazirmatn, sans-serif' : '12px Vazirmatn, sans-serif'
  ctx.textBaseline = 'middle'
  const rect = getTextToolBodyRect(ctx, drawing, points)
  const { x, y, width, height } = rect
  const paddingX = 10
  const blue = drawing.color || DRAWING_NODE_BLUE
  const dark = '#2b2f3a'

  if (variant === 'anchored' || variant === 'anchored-pin') {
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(rect.x + rect.width / 2, rect.y + rect.height / 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (variant === 'pin' || variant === 'anchored-pin') {
    drawPin(ctx, p.x, p.y, blue)
    if (!active) {
      ctx.restore()
      return
    }
  }

  if (variant === 'signpost') {
    const visibleText = text || (editing ? TEXT_PLACEHOLDER : '')
    const attachY = p.y >= y + height / 2 ? y + height : y
    ctx.strokeStyle = '#8b8f98'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x, attachY)
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = 'rgba(100,116,139,0.28)'
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, 4)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#111827'
    ctx.textAlign = 'left'
    const lines = visibleText.split('\n')
    const lineHeight = 16
    const firstLineY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2
    if (editing && !text) ctx.globalAlpha = 0.4
    lines.forEach((line, index) => ctx.fillText(line, x + paddingX, firstLineY + index * lineHeight))
    ctx.globalAlpha = 1
    if (editing && cursorVisible) {
      const textLines = text.split('\n')
      const lastLine = textLines.at(-1) ?? ''
      const cursorX = x + paddingX + ctx.measureText(lastLine).width + 2
      const cursorCenterY = firstLineY + (textLines.length - 1) * lineHeight
      ctx.strokeStyle = '#111827'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(cursorX, cursorCenterY - 8)
      ctx.lineTo(cursorX, cursorCenterY + 8)
      ctx.stroke()
    }
    ctx.restore()
    return
  }

  if (variant === 'plain' || variant === 'anchored') {
    ctx.fillStyle = blue
    ctx.textAlign = 'left'
    const visibleText = text || (editing ? TEXT_PLACEHOLDER : '')
    if (visibleText) {
      const lines = visibleText.split('\n')
      const lineHeight = 24
      const firstLineY = y + 15
      if (editing && !text) {
        ctx.save()
        ctx.globalAlpha = 0.38
        lines.forEach((line, index) => ctx.fillText(line, x, firstLineY + index * lineHeight))
        ctx.restore()
      } else {
        lines.forEach((line, index) => ctx.fillText(line, x, firstLineY + index * lineHeight))
      }
    }
    if (editing && cursorVisible) {
      const lines = text.split('\n')
      const lastLine = lines.at(-1) ?? ''
      const lineHeight = 24
      const firstLineY = y + 15
      const cursorX = lastLine ? x + ctx.measureText(lastLine).width + 2 : x
      const cursorCenterY = firstLineY + (lines.length - 1) * lineHeight
      ctx.save()
      ctx.strokeStyle = blue
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(cursorX, cursorCenterY - 12)
      ctx.lineTo(cursorX, cursorCenterY + 12)
      ctx.stroke()
      ctx.restore()
    }
    if (variant === 'anchored') {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
    return
  }

  if (variant === 'note') {
    const boxPoint = points[1] ?? p
    const noteRect = getTextToolBodyRect(ctx, drawing, [{ ...boxPoint, price: p.price, time: p.time, logical: p.logical }])
    const x = noteRect.x
    const y = noteRect.y
    const width = noteRect.width
    const height = noteRect.height
    if (points[1]) {
      const anchor = getNoteLineAttachPoint(noteRect, p)
      ctx.strokeStyle = '#8b8f98'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(anchor.x, anchor.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()

      ctx.fillStyle = '#d1d5db'
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.fillStyle = dark
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, 4)
    ctx.fill()

    const visibleText = text || (editing ? TEXT_PLACEHOLDER : '')
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    if (visibleText) {
      const lines = visibleText.split('\n')
      const lineHeight = 16
      const firstLineY = y + 13
      if (editing && !text) {
        ctx.save()
        ctx.globalAlpha = 0.45
        lines.forEach((line, index) => ctx.fillText(line, x + paddingX, firstLineY + index * lineHeight))
        ctx.restore()
      } else {
        lines.forEach((line, index) => ctx.fillText(line, x + paddingX, firstLineY + index * lineHeight))
      }
    }
    if (editing && cursorVisible) {
      const lines = text.split('\n')
      const lastLine = lines.at(-1) ?? ''
      const lineHeight = 16
      const firstLineY = y + 13
      const cursorX = x + paddingX + (lastLine ? ctx.measureText(lastLine).width + 2 : 0)
      const cursorCenterY = firstLineY + (lines.length - 1) * lineHeight
      ctx.save()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(cursorX, cursorCenterY - 8)
      ctx.lineTo(cursorX, cursorCenterY + 8)
      ctx.stroke()
      ctx.restore()
    }
    ctx.restore()
    return
  }

  if (variant === 'flag') {
    const scale = 1.45
    const left = p.x - 5 * scale
    const top = p.y + 12 - 22.5 * scale
    ctx.translate(left, top)
    ctx.scale(scale, scale)
    ctx.fillStyle = FLAG_POLE_COLOR
    ctx.globalAlpha = 0.5
    ctx.fill(new Path2D('M6.5 1.75C6.5 1.33579 6.16421 1 5.75 1C5.33579 1 5 1.33579 5 1.75V21.75C5 22.1642 5.33579 22.5 5.75 22.5C6.16421 22.5 6.5 22.1642 6.5 21.75V13.6V3.6V1.75Z'))
    ctx.globalAlpha = 1
    ctx.fillStyle = blue
    ctx.fill(new Path2D('M13.5582 3.87333L13.1449 3.70801C11.5821 3.08288 9.8712 2.9258 8.22067 3.25591L6.5 3.60004V13.6L8.22067 13.2559C9.8712 12.9258 11.5821 13.0829 13.1449 13.708C14.8385 14.3854 16.7024 14.5119 18.472 14.0695L18.5721 14.0445C19.1582 13.898 19.4361 13.2269 19.1253 12.7089L17.5647 10.1078C17.2232 9.53867 17.0524 9.25409 17.0119 8.94455C16.9951 8.81543 16.9951 8.68466 17.0119 8.55553C17.0524 8.24599 17.2232 7.96141 17.5647 7.39225L18.8432 5.26136C19.1778 4.70364 18.6711 4.01976 18.0401 4.17751C16.5513 4.54971 14.9831 4.44328 13.5582 3.87333Z'))
    ctx.restore()
    return
  }

  if (variant === 'callout') {
    const bodyRect = { x, y, width, height }
    const targetInsideBody = p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height
    const calloutFill = '#76d3dc'
    const visibleText = text || (editing ? 'Add Text' : '')
    const tail = targetInsideBody ? null : getCalloutTailPoints(bodyRect, p)
    ctx.fillStyle = calloutFill
    ctx.strokeStyle = '#0f91a0'
    // One fill operation for body + tail prevents translucent overlap seams.
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, 7)
    if (tail) {
      ctx.moveTo(tail.a.x, tail.a.y)
      ctx.lineTo(p.x, p.y)
      ctx.lineTo(tail.b.x, tail.b.y)
      ctx.closePath()
    }
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, 7)
    ctx.stroke()
    if (tail) {
      ctx.beginPath()
      ctx.moveTo(tail.a.x, tail.a.y)
      ctx.lineTo(p.x, p.y)
      ctx.lineTo(tail.b.x, tail.b.y)
      ctx.stroke()
      // Paint out shared body edge: visible result is one continuous polygon.
      ctx.strokeStyle = calloutFill
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(tail.a.x, tail.a.y)
      ctx.lineTo(tail.b.x, tail.b.y)
      ctx.stroke()
      ctx.lineWidth = 1
      ctx.strokeStyle = '#0f91a0'
    }
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    const lines = visibleText.split('\n')
    const lineHeight = 16
    const firstLineY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2
    if (editing && !text) ctx.globalAlpha = 0.45
    lines.forEach((line, index) => ctx.fillText(line, x + width / 2, firstLineY + index * lineHeight))
    ctx.globalAlpha = 1
    if (editing && cursorVisible) {
      const lastLine = text.split('\n').at(-1) ?? ''
      const cursorCenterY = firstLineY + (Math.max(1, text.split('\n').length) - 1) * lineHeight
      const cursorX = x + width / 2 + ctx.measureText(lastLine).width / 2 + 2
      ctx.save()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(cursorX, cursorCenterY - 8)
      ctx.lineTo(cursorX, cursorCenterY + 8)
      ctx.stroke()
      ctx.restore()
    }
    ctx.restore()
    return
  }

  if (variant === 'comment') {
    const visibleText = text || (editing ? TEXT_PLACEHOLDER : '')
    ctx.fillStyle = blue
    ctx.beginPath()
    ctx.roundRect(x, y, width, height, [18, 18, 18, 0])
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    const lines = visibleText.split('\n')
    const lineHeight = 16
    const firstLineY = y + 18
    if (editing && !text) ctx.globalAlpha = 0.45
    lines.forEach((line, index) => ctx.fillText(line, x + paddingX, firstLineY + index * lineHeight))
    ctx.globalAlpha = 1
    if (editing && cursorVisible) {
      const textLines = text.split('\n')
      const lastLine = textLines.at(-1) ?? ''
      const cursorX = x + paddingX + ctx.measureText(lastLine).width + 2
      const cursorCenterY = firstLineY + (textLines.length - 1) * lineHeight
      ctx.beginPath()
      ctx.moveTo(cursorX, cursorCenterY - 8)
      ctx.lineTo(cursorX, cursorCenterY + 8)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
    ctx.restore()
    return
  }

  if (variant === 'price-label') {
    drawPriceBubble(ctx, p, text, blue)
    ctx.restore()
    return
  }

  ctx.fillStyle = dark
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, 4)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(x + Math.min(width - 12, 28), y + height)
  ctx.lineTo(x + Math.min(width - 2, 40), y + height)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.fillText(text, x + paddingX, y + height / 2)
  ctx.restore()
}

function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(x, y, 11, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(x, y, 3, 0, Math.PI * 2)
  ctx.fill()
}

function drawPriceBubble(ctx: CanvasRenderingContext2D, p: PixelPoint, text: string, color: string) {
  ctx.font = '12px Vazirmatn, sans-serif'
  const width = Math.max(52, ctx.measureText(text).width + 18)
  const height = 26
  const x = p.x + 16
  const y = p.y - height / 2
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(x, y + height / 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, 4)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + width / 2, y + height / 2)
}

function getTextToolBodyRect(ctx: CanvasRenderingContext2D, drawing: Drawing, points: PixelPoint[]) {
  const p = (drawing.tool === 'note' || drawing.tool === 'anchorednote' ? points[1] : points[0]) ?? points[0] ?? { x: 0, y: 0, price: 0, time: null }
  const text = getDrawingText(drawing, p) || (EDITABLE_TEXT_TOOLS.has(drawing.tool) ? TEXT_PLACEHOLDER : '')
  const isLarge = drawing.tool === 'text' || drawing.tool === 'anchoredtext'
  ctx.save()
  ctx.font = isLarge ? '20px Vazirmatn, sans-serif' : '12px Vazirmatn, sans-serif'
  const lines = text.split('\n')
  const measuredTextWidth = Math.max(...lines.map(line => ctx.measureText(line).width), 0)
  const width = isLarge
    ? Math.max(40, measuredTextWidth)
    : Math.max(drawing.tool === 'comment' ? 68 : drawing.tool === 'callout' ? 86 : 56, measuredTextWidth + (drawing.tool === 'callout' ? 32 : 20))
  const height = isLarge ? Math.max(30, lines.length * 24 + 6) : drawing.tool === 'comment' ? Math.max(44, lines.length * 16 + 24) : drawing.tool === 'callout' ? Math.max(34, lines.length * 16 + 12) : drawing.tool === 'signpost' ? Math.max(26, lines.length * 16 + 10) : 26
  ctx.restore()
  const offset = drawing.tool === 'comment' ? { x: 0, y: 0 } : drawing.textOffset ?? getDefaultTextOffset(drawing.tool)
  if (drawing.tool === 'pricelabel') return { x: p.x + 16, y: p.y - 13, width: Math.max(52, ctx.measureText(text).width + 18), height: 26 }
  if (drawing.tool === 'flagmark') return { x: p.x - 8, y: p.y - 22, width: 36, height: 36 }
  if (drawing.tool === 'note' || drawing.tool === 'anchorednote') {
    const lineCount = Math.max(1, text.split('\n').length)
    const noteWidth = Math.max(48, measuredTextWidth + 20)
    const noteHeight = Math.max(34, lineCount * 16 + 12)
    return getNoteBodyRectFromPoint(p, text, noteWidth, noteHeight)
  }
  if (drawing.tool === 'comment') {
    return { x: p.x + offset.x, y: p.y + offset.y - height, width, height }
  }
  if (drawing.tool === 'signpost') {
    return { x: p.x - width / 2, y: p.y + offset.y, width, height }
  }
  const topY = isLarge ? p.y + offset.y - Math.max(0, height - 30) : p.y + offset.y
  return { x: p.x + offset.x, y: topY, width, height }
}

function getNoteBodyRectFromPoint(
  point: { x: number; y: number },
  text: string,
  measuredWidth?: number,
  measuredHeight?: number,
) {
  const lines = (text || 'Add Text').split('\n')
  const width = measuredWidth ?? Math.max(48, Math.max(...lines.map(line => line.length), 0) * 7 + 20)
  const height = measuredHeight ?? Math.max(34, lines.length * 16 + 12)
  return { x: point.x - width / 2, y: point.y - height / 2, width, height }
}

function getNoteLineAttachPoint(
  rect: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number },
) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const dx = target.x - center.x
  const dy = target.y - center.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      x: dx >= 0 ? rect.x + rect.width : rect.x,
      y: center.y,
    }
  }
  return {
    x: center.x,
    y: dy >= 0 ? rect.y + rect.height : rect.y,
  }
}

function getCalloutTailPoints(
  rect: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number },
) {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  const dx = target.x - center.x
  const dy = target.y - center.y
  const sideWidth = 10
  const cornerInset = 12
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height

  // Attach only to straight edge sections. Never consume a rounded corner.
  if (Math.abs(dx) >= Math.abs(dy)) {
    const y = Math.max(rect.y + cornerInset, Math.min(bottom - cornerInset, target.y))
    const x = dx >= 0 ? right : rect.x
    return {
      a: { x, y: y - sideWidth / 2 },
      b: { x, y: y + sideWidth / 2 },
    }
  }

  {
    const x = Math.max(rect.x + cornerInset, Math.min(right - cornerInset, target.x))
    const y = dy >= 0 ? bottom : rect.y
    return {
      a: { x: x - sideWidth / 2, y },
      b: { x: x + sideWidth / 2, y },
    }
  }

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

function getDrawingText(drawing: Drawing, p: PixelPoint) {
  if (drawing.tool === 'pricelabel') return drawing.text ?? (Number.isFinite(p.price) ? formatPriceLabel(p.price) : 'Price')
  return drawing.text ?? ''
}

function formatPriceLabel(price: number) {
  if (!Number.isFinite(price)) return ''
  return price.toFixed(3).replace(/\.?0+$/, '')
}

function pointInTextRect(point: { x: number; y: number }, rect: { x: number; y: number; width: number; height: number }) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

function drawXABCDPattern(
  ctx: CanvasRenderingContext2D,
  points: PixelPoint[],
  color = DRAWING_NODE_BLUE,
) {
  if (points.length < 1) return

  const [x, a, b, c, d] = points

  const fillPrimary = 'rgba(41,98,255,0.14)'
  const fillSecondary = 'rgba(41,98,255,0.18)'
  const guideColor = color

  ctx.save()
  ctx.setLineDash([])
  ctx.lineWidth = 1.8
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.font = '11px Vazirmatn, Inter, sans-serif'

  // ── Solid structure ─────────────────────────
  if (points.length >= 2) {
    ctx.beginPath()
    ctx.moveTo(x.x, x.y)
    ctx.lineTo(a.x, a.y)
    ctx.stroke()
  }

  if (points.length >= 3) {
    // X-A-B
    ctx.beginPath()
    ctx.moveTo(x.x, x.y)
    ctx.lineTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()

    ctx.save()
    ctx.globalAlpha = 1
    ctx.fillStyle = fillPrimary
    ctx.beginPath()
    ctx.moveTo(x.x, x.y)
    ctx.lineTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // guide X-B
    ctx.save()
    ctx.strokeStyle = guideColor
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(x.x, x.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.restore()

    // AB / XA
    const ratioABXA = formatPatternRatio(
      getSegmentLength(a, b),
      getSegmentLength(x, a),
    )
    drawRatioOnSegment(ctx, x, b, ratioABXA, color, 0, 12)
  }

  if (points.length >= 4) {
    // B-C
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()

    // guide A-C
    ctx.save()
    ctx.strokeStyle = guideColor
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()
    ctx.restore()

    // BC / AB
    const ratioBCAB = formatPatternRatio(
      getSegmentLength(b, c),
      getSegmentLength(a, b),
    )
    drawRatioOnSegment(ctx, a, c, ratioBCAB, color, 0, -10)
  }

  if (points.length >= 5) {
    // C-D
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()

    // fill B-C-D
    ctx.save()
    ctx.fillStyle = fillSecondary
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // guide X-D
    ctx.save()
    ctx.strokeStyle = guideColor
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(x.x, x.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()
    ctx.restore()

    // guide B-D
    ctx.save()
    ctx.strokeStyle = guideColor
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(d.x, d.y)
    ctx.stroke()
    ctx.restore()

    // XD / XA
    const ratioXDXA = formatPatternRatio(
      getSegmentLength(x, d),
      getSegmentLength(x, a),
    )
    drawRatioOnSegment(ctx, x, d, ratioXDXA, color, 0, -8)

    // CD / BC
    const ratioCDBC = formatPatternRatio(
      getSegmentLength(c, d),
      getSegmentLength(b, c),
    )
    drawRatioOnSegment(ctx, b, d, ratioCDBC, color, 0, 12)
  }

  ctx.restore()
}

function drawInsidePitchfork(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  isSelected = false,
) {
  const fifthLineBackStart = getMidpoint(a, b)
  const medianMid = getMidpoint(b, c)

  // شیب مرجع کل inside pitchfork از خط پنجم می‌آید
  const dx = c.x - fifthLineBackStart.x
  const dy = c.y - fifthLineBackStart.y
  const len = Math.hypot(dx, dy)
  if (len < 0.001) return

  const scale = 6000 / len
  const ex = dx * scale
  const ey = dy * scale

  const medianEnd = { x: medianMid.x + ex, y: medianMid.y + ey }

  const bEnd = { x: b.x + ex, y: b.y + ey }
  const cEnd = { x: c.x + ex, y: c.y + ey }

  const upperInnerStart = getMidpoint(b, medianMid)
  const lowerInnerStart = getMidpoint(medianMid, c)

  const upperInnerEnd = { x: upperInnerStart.x + ex, y: upperInnerStart.y + ey }
  const lowerInnerEnd = { x: lowerInnerStart.x + ex, y: lowerInnerStart.y + ey }

  const outerColor = '#2962ff'
  const innerColor = '#00897b'
  const medianColor = '#f23645'

  ctx.save()
  ctx.setLineDash([])

  // fills
  ctx.globalAlpha = 0.18
  ctx.fillStyle = outerColor

  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(bEnd.x, bEnd.y)
  ctx.lineTo(upperInnerEnd.x, upperInnerEnd.y)
  ctx.lineTo(upperInnerStart.x, upperInnerStart.y)
  ctx.closePath()
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(lowerInnerStart.x, lowerInnerStart.y)
  ctx.lineTo(lowerInnerEnd.x, lowerInnerEnd.y)
  ctx.lineTo(cEnd.x, cEnd.y)
  ctx.lineTo(c.x, c.y)
  ctx.closePath()
  ctx.fill()

  ctx.globalAlpha = 0.16
  ctx.fillStyle = innerColor
  ctx.beginPath()
  ctx.moveTo(upperInnerStart.x, upperInnerStart.y)
  ctx.lineTo(upperInnerEnd.x, upperInnerEnd.y)
  ctx.lineTo(lowerInnerEnd.x, lowerInnerEnd.y)
  ctx.lineTo(lowerInnerStart.x, lowerInnerStart.y)
  ctx.closePath()
  ctx.fill()

  ctx.globalAlpha = 1

  // outer lines
  ctx.strokeStyle = outerColor
  ctx.lineWidth = 1.7
  drawSegment(ctx, b.x, b.y, bEnd.x, bEnd.y)
  drawSegment(ctx, fifthLineBackStart.x, fifthLineBackStart.y, cEnd.x, cEnd.y)

  // inner lines
  ctx.strokeStyle = innerColor
  ctx.lineWidth = 1.4
  drawSegment(ctx, upperInnerStart.x, upperInnerStart.y, upperInnerEnd.x, upperInnerEnd.y)
  drawSegment(ctx, lowerInnerStart.x, lowerInnerStart.y, lowerInnerEnd.x, lowerInnerEnd.y)

  // median + handle
  ctx.strokeStyle = medianColor
  ctx.lineWidth = 1.55

  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()

  drawSegment(ctx, medianMid.x, medianMid.y, medianEnd.x, medianEnd.y)

  if (isSelected) {
    ;[a, b, c].forEach(pt => drawPitchforkHandle(ctx, pt.x, pt.y))
  }

  ctx.restore()
}

function drawEllipse(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  const geometry = getRotatedEllipseGeometry(points)
  if (!geometry) return
  const { center, rx, ry, rotation } = geometry
  ctx.save()
  ctx.strokeStyle = ELLIPSE_STROKE_COLOR
  ctx.fillStyle = ELLIPSE_FILL_COLOR
  ctx.lineWidth = ELLIPSE_LINE_WIDTH
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, rx, ry, rotation, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function getRotatedEllipseGeometry(points: { x: number; y: number }[]) {
  if (points.length < 2) return null
  const [start, end] = points
  const dx = end.x - start.x
  const dy = end.y - start.y
  const majorLength = Math.hypot(dx, dy)
  if (majorLength < 0.001) return null

  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const ux = dx / majorLength
  const uy = dy / majorLength
  const nx = -uy
  const ny = ux
  const control = points[2]
  const signedMinor = control
    ? (control.x - center.x) * nx + (control.y - center.y) * ny
    : Math.max(8, majorLength * 0.12)
  const ry = Math.max(1, Math.abs(signedMinor))
  const widthSign = signedMinor < 0 ? -1 : 1
  const widthPoint = {
    x: center.x + nx * ry * widthSign,
    y: center.y + ny * ry * widthSign,
  }
  const oppositeWidthPoint = {
    x: center.x - nx * ry * widthSign,
    y: center.y - ny * ry * widthSign,
  }

  return {
    start,
    end,
    center,
    widthPoint,
    oppositeWidthPoint,
    rx: majorLength / 2,
    ry,
    rotation: Math.atan2(dy, dx),
  }
}

function drawTriangle(ctx: CanvasRenderingContext2D, points: PixelPoint[]) {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  ctx.lineTo(points[1].x, points[1].y)
  if (points.length >= 3) {
    ctx.lineTo(points[2].x, points[2].y)
    ctx.closePath()
    ctx.stroke()
    ctx.globalAlpha = 0.05
    ctx.fill()
    ctx.globalAlpha = 1
  } else {
    ctx.stroke()
  }
}

function drawSelectionHandle(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  point: { x: number; y: number },
  square: boolean,
) {
  const chartBg = getComputedStyle(canvas).getPropertyValue('--chart-bg').trim() || '#ffffff'

  ctx.save()
  ctx.setLineDash([])
  ctx.strokeStyle = DRAWING_NODE_BLUE
  ctx.fillStyle = chartBg
  ctx.lineWidth = 2
  if (square) {
    ctx.beginPath()
    roundedRectPath(ctx, point.x - 5, point.y - 5, 10, 10, 3)
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

function drawHoverSelectionHandle(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  point: { x: number; y: number },
  square: boolean,
) {
  const chartBg = getComputedStyle(canvas).getPropertyValue('--chart-bg').trim() || '#ffffff'

  ctx.save()
  ctx.setLineDash([])
  ctx.save()
  const glow = ctx.createRadialGradient(point.x, point.y, 4, point.x, point.y, 14)
  glow.addColorStop(0, 'rgba(0, 176, 255, 0.42)')
  glow.addColorStop(0.45, 'rgba(41, 98, 255, 0.24)')
  glow.addColorStop(1, 'rgba(41, 98, 255, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(point.x, point.y, 14, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.strokeStyle = DRAWING_NODE_BLUE
  ctx.fillStyle = chartBg
  ctx.lineWidth = 2
  if (square) {
    ctx.beginPath()
    roundedRectPath(ctx, point.x - 6, point.y - 6, 12, 12, 3)
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(point.x, point.y, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

function drawLockedSelectionHandle(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  glowing = false,
) {
  ctx.save()
  ctx.setLineDash([])
  if (glowing) {
    const glow = ctx.createRadialGradient(point.x, point.y, 2, point.x, point.y, 18)
    glow.addColorStop(0, 'rgba(0, 176, 255, 0.42)')
    glow.addColorStop(0.45, 'rgba(41, 98, 255, 0.26)')
    glow.addColorStop(1, 'rgba(41, 98, 255, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(point.x, point.y, 18, 0, Math.PI * 2)
    ctx.fill()

    ctx.shadowColor = 'rgba(0, 176, 255, 0.9)'
    ctx.shadowBlur = 14
  }
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(point.x, point.y, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = DRAWING_NODE_BLUE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}
