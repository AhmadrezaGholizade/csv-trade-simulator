import { useRef, useCallback, useEffect } from 'react'
import type { IChartApi, ISeriesApi, Logical, Time } from 'lightweight-charts'
import type { Drawing, DrawTool, Point, SelectedDrawing, CursorMode } from '../chartTypes'
import { CHANNEL_TOOLS, getRequiredPointCount } from './chartHelpers'
import { getMidpoint, getChannelGeometry } from './chartGeometry'
import { NODE_INDICES, HIT } from './chartConstants'
import { getHitSegments, getDrawingHandlePixel, getHandleHits } from './drawingHitTest'
import {
  applyPointNormalizers,
  normalizeRegressionTrendPoints,
  normalizeGannSquareFixedPoints,
} from './drawingNormalizers'
import { getDrawToolShortcut, isEditableShortcutTarget } from '../toolbar/toolShortcuts'
import { TOOL_GROUP_ID_BY_TOOL } from '../toolbar/toolRegistry'
import { distToSegment } from './chartGeometry'
import { candleUnixTime, coordinateToAnchoredTime, timeToAnchoredCoordinate } from './drawingCoordinates'
import { simplifyFreehandDrawingPoints } from './freehandSimplify'

const DEFAULT_DRAWING_COLOR = '#2962ff'
const BRUSH_DRAWING_COLOR = '#00bcd4'
const HIGHLIGHTER_DRAWING_COLOR = '#00bcd4'
const BRUSH_MIN_POINT_DISTANCE = 2
const SELECTION_PANEL_GAP = 44
const SELECTION_PANEL_TOP_THRESHOLD = 60
const FREEHAND_SIMPLIFY = {
  brush: { minDistance: 2.5, epsilon: 1.8, maxPoints: 900 },
  highlighter: { minDistance: 5, epsilon: 3.5, maxPoints: 650 },
} as const
const FREEHAND_TOOLS = new Set<DrawTool>(['brush', 'highlighter'])
const TEXT_TOOLS = new Set<DrawTool>(['text', 'anchoredtext', 'note', 'anchorednote', 'callout', 'comment', 'pricelabel', 'signpost', 'flagmark'])
const EDITABLE_TEXT_TOOLS = new Set<DrawTool>(['text', 'anchoredtext', 'note', 'anchorednote', 'callout', 'comment', 'signpost'])
type SourceCandle = { open: number; high: number; low: number; close: number; volume?: number; ts: string }

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

declare global {
  interface Window {
    __copiedDrawing?: Drawing
  }
}

function getCandleIndexForPoint(point: Pick<Point, 'time' | 'logical'>, candles: SourceCandle[]) {
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

function hitFixedRangeVolumeProfile(
  mx: number,
  my: number,
  pixels: { x: number; y: number }[],
  candles: { open: number; high: number; low: number; close: number; volume?: number; ts: string }[],
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>,
) {
  const profile = buildFixedRangeProfileForHit(pixels, candles, chart)
  if (!profile) return false
  const left = Math.min(pixels[0].x, pixels[1].x)
  const right = Math.max(pixels[0].x, pixels[1].x)
  const maxWidth = Math.max(40, (right - left) * 0.30)
  const maxVolume = Math.max(...profile.bins.map(bin => bin.total), 1)

  return profile.bins.some(bin => {
    const y1 = candleSeries.priceToCoordinate(bin.high)
    const y2 = candleSeries.priceToCoordinate(bin.low)
    if (y1 == null || y2 == null) return false
    const rowTop = Math.min(y1, y2)
    const rowBottom = Math.max(y1, y2)
    const width = (bin.total / maxVolume) * maxWidth
    return mx >= left && mx <= left + width + HIT.LINE && my >= rowTop - HIT.LINE && my <= rowBottom + HIT.LINE
  })
}

function getFixedRangeProfileBoundsForHit(
  pixels: { x: number; y: number }[],
  candles: { open: number; high: number; low: number; close: number; volume?: number; ts: string }[],
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>,
) {
  const profile = buildFixedRangeProfileForHit(pixels, candles, chart)
  if (!profile) return null
  const top = candleSeries.priceToCoordinate(Math.max(...profile.bins.map(bin => bin.high)))
  const bottom = candleSeries.priceToCoordinate(Math.min(...profile.bins.map(bin => bin.low)))
  if (top == null || bottom == null) return null
  return {
    left: Math.min(pixels[0].x, pixels[1].x),
    right: Math.max(pixels[0].x, pixels[1].x),
    top,
    bottom,
  }
}

function buildFixedRangeProfileForHit(
  pixels: { x: number; y: number }[],
  candles: { open: number; high: number; low: number; close: number; volume?: number; ts: string }[],
  chart: IChartApi,
): { bins: ProfileBin[] } | null {
  const left = Math.min(pixels[0].x, pixels[1].x)
  const right = Math.max(pixels[0].x, pixels[1].x)
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
  const bins: ProfileBin[] = Array.from({ length: binCount }, (_, index) => ({
    low: minPrice + index * step,
    high: minPrice + (index + 1) * step,
    buy: 0,
    sell: 0,
    total: 0,
  }))
  rangeCandles.forEach(candle => {
    const span = Math.max(candle.high - candle.low, step)
    const volume = Math.max(1, candle.volume ?? 1)
    bins.forEach(bin => {
      const overlap = Math.max(0, Math.min(candle.high, bin.high) - Math.max(candle.low, bin.low))
      if (overlap <= 0) return
      bin.total += volume * (overlap / span)
    })
  })
  return { bins }
}

type ProfileBin = {
  low: number
  high: number
  buy: number
  sell: number
  total: number
}

export type DrawingNodeCursor = 'default' | 'ew-resize' | 'ns-resize'

function getAxisCursorFromVector(dx: number, dy: number): DrawingNodeCursor {
  if (Math.hypot(dx, dy) < 0.001) return 'default'
  return Math.abs(dx) >= Math.abs(dy) ? 'ew-resize' : 'ns-resize'
}

function getDrawingNodeCursor(
  drawing: Drawing,
  nodeIdx: number,
  pointToPixel: (point: Point) => { x: number; y: number },
): DrawingNodeCursor {
  if (nodeIdx === NODE_INDICES.TEXT_BODY) return 'default'
  if (nodeIdx === NODE_INDICES.WHOLE_DRAG) return 'default'
  if (drawing.tool === 'horizontal' || drawing.tool === 'horizontalray') return 'ns-resize'
  if (drawing.tool === 'vertical') return 'ew-resize'
  if (drawing.tool === 'crossline' && nodeIdx === NODE_INDICES.CROSSLINE_HORIZONTAL) return 'ns-resize'
  if (drawing.tool === 'crossline' && nodeIdx === NODE_INDICES.CROSSLINE_VERTICAL) return 'ew-resize'

  if (
    nodeIdx === NODE_INDICES.POSITION_TARGET ||
    nodeIdx === NODE_INDICES.POSITION_STOP ||
    nodeIdx === NODE_INDICES.CHANNEL_BASE_MIDDLE ||
    nodeIdx === NODE_INDICES.CHANNEL_PARALLEL_MIDDLE ||
    nodeIdx === NODE_INDICES.DISJOINT_REFERENCE ||
    nodeIdx === NODE_INDICES.FLAT_HORIZONTAL_START ||
    nodeIdx === NODE_INDICES.FLAT_HORIZONTAL_END ||
    nodeIdx === NODE_INDICES.RECT_TOP ||
    nodeIdx === NODE_INDICES.RECT_BOTTOM
  ) {
    return 'ns-resize'
  }

  if (
    nodeIdx === NODE_INDICES.POSITION_WIDTH ||
    nodeIdx === NODE_INDICES.RECT_LEFT ||
    nodeIdx === NODE_INDICES.RECT_RIGHT
  ) {
    return 'ew-resize'
  }

  if (drawing.tool === 'ellipse' && (nodeIdx === 2 || nodeIdx === NODE_INDICES.ELLIPSE_OPPOSITE_WIDTH) && drawing.points.length >= 2) {
    const start = pointToPixel(drawing.points[0])
    const end = pointToPixel(drawing.points[1])
    return getAxisCursorFromVector(-(end.y - start.y), end.x - start.x)
  }

  if (
    drawing.tool === 'rotatedrectangle' &&
    (
      nodeIdx === NODE_INDICES.ROT_RECT_A ||
      nodeIdx === NODE_INDICES.ROT_RECT_B ||
      nodeIdx === NODE_INDICES.ROT_RECT_C ||
      nodeIdx === NODE_INDICES.ROT_RECT_D
    ) &&
    drawing.points.length >= 2
  ) {
    const start = pointToPixel(drawing.points[0])
    const end = pointToPixel(drawing.points[1])
    return getAxisCursorFromVector(-(end.y - start.y), end.x - start.x)
  }

  return 'default'
}

function isTextTool(tool: DrawTool) {
  return TEXT_TOOLS.has(tool)
}

function isAnchoredTextTool(tool: DrawTool) {
  return tool === 'anchoredtext' || tool === 'anchorednote'
}

function getDefaultTextOffset(tool: DrawTool) {
  switch (tool) {
    case 'comment':
      return { x: 0, y: 0 }
    case 'callout':
      return { x: 42, y: -46 }
    case 'signpost':
      return { x: 0, y: -90 }
    case 'text':
    case 'anchoredtext':
      return { x: 0, y: -18 }
    default:
      return { x: -118, y: -64 }
  }
}

function getTextBodyHitRect(drawing: Drawing, point: { x: number; y: number }) {
  const offset = drawing.tool === 'comment' ? { x: 0, y: 0 } : drawing.textOffset ?? getDefaultTextOffset(drawing.tool)
  if (drawing.tool === 'pricelabel') return { x: point.x + 16, y: point.y - 13, width: 72, height: 26 }
  if (drawing.tool === 'flagmark') return { x: point.x - 8, y: point.y - 22, width: 36, height: 36 }
  if (drawing.tool === 'note' || drawing.tool === 'anchorednote') {
    const lines = (drawing.text || 'Add Text').split('\n')
    const width = Math.max(48, Math.max(...lines.map(line => line.length), 0) * 7 + 20)
    const height = Math.max(34, lines.length * 16 + 12)
    return { x: point.x - width / 2, y: point.y - height / 2, width, height }
  }
  if (drawing.tool === 'text' || drawing.tool === 'anchoredtext') {
    const lineCount = Math.max(1, (drawing.text || 'Add Text').split('\n').length)
    const height = Math.max(34, lineCount * 24 + 10)
    return { x: point.x + offset.x, y: point.y + offset.y - Math.max(0, height - 34), width: 240, height }
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
  return { x: point.x + offset.x, y: point.y + offset.y, width: 120, height: 32 }
}

function pointInRect(x: number, y: number, rect: { x: number; y: number; width: number; height: number }) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

function getDefaultTextForTool(tool: DrawTool, price: number) {
  switch (tool) {
    case 'text':
    case 'anchoredtext':
      return ''
    case 'note':
      return ''
    case 'anchorednote':
      return ''
    case 'callout':
      return ''
    case 'comment':
      return ''
    case 'pricelabel':
      return Number.isFinite(price) ? price.toFixed(3).replace(/\.?0+$/, '') : ''
    case 'signpost':
      return ''
    default:
      return ''
  }
}

export interface DrawingInteractionOptions {
  /** Ref to the overlay canvas element */
  overlayRef: React.RefObject<HTMLCanvasElement | null>
  /** Ref to the lightweight-charts IChartApi instance */
  chartRef: React.RefObject<IChartApi | null>
  /** Ref to the main candlestick series (used for price↔pixel conversion) */
  candleRef: React.RefObject<ISeriesApi<'Candlestick'> | null>

  /** Current drawings array (react state) */
  drawingsRef: React.MutableRefObject<Drawing[]>
  getVisibleDrawings: () => Drawing[]
  drawingsLockedRef: React.MutableRefObject<boolean>
  drawingsHiddenRef: React.MutableRefObject<boolean>
  activeToolRef: React.MutableRefObject<DrawTool>
  cursorModeRef: React.MutableRefObject<CursorMode>
  selectedRef: React.MutableRefObject<SelectedDrawing | null>

  /** Setters that update React state */
  setDrawings: (drawings: Drawing[]) => void
  setActiveTool: (tool: DrawTool) => void
  setCursorMode: (mode: CursorMode) => void
  setSelected: (sel: SelectedDrawing | null) => void
  setPinnedTools: React.Dispatch<React.SetStateAction<Record<string, DrawTool>>>

  /** Called whenever canvas needs a redraw */
  redrawCanvas: (currentPoints?: Point[]) => void
  onStartTextEdit?: (drawingId: string) => void

  /** Source candles slice (used for regression-trend normalization) */
  getCandles: () => { open: number; high: number; low: number; close: number; ts: string }[]
}

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export function useDrawingInteraction({
  overlayRef,
  chartRef,
  candleRef,
  drawingsRef,
  getVisibleDrawings,
  drawingsLockedRef,
  drawingsHiddenRef,
  activeToolRef,
  cursorModeRef,
  selectedRef,
  setDrawings,
  setActiveTool,
  setCursorMode,
  setSelected,
  setPinnedTools,
  redrawCanvas,
  onStartTextEdit,
  getCandles,
}: DrawingInteractionOptions) {
  // ── In-flight drawing state ──────────────────
  const isDrawing      = useRef(false)
  const drawingPoints  = useRef<Point[]>([])

  // ── Drag state ───────────────────────────────
  const draggingDrawingId = useRef<string | null>(null)
  const draggingNodeIdx   = useRef<number | null>(null)
  const dragStartMouse    = useRef<{ x: number; y: number } | null>(null)
  const dragStartPoints   = useRef<Point[]>([])
  const dragStartTextOffset = useRef<{ x: number; y: number } | null>(null)

  // ── Coordinate converters ────────────────────
  const pointToPixel = useCallback((p: Point): { x: number; y: number } => {
    const activeDrawing = draggingDrawingId.current
      ? drawingsRef.current.find(d => d.id === draggingDrawingId.current)
      : null
    if (activeDrawing && isAnchoredTextTool(activeDrawing.tool)) return { x: p.x, y: p.y }
    const chart = chartRef.current
    const sx = (timeToAnchoredCoordinate(chart, getCandles(), p) ?? p.x) as number
    const sy = (p.price > 0 && p.price < 1e7)
      ? (candleRef.current?.priceToCoordinate(p.price) ?? p.y) as number
      : p.y
    return { x: sx, y: sy }
  }, [candleRef, chartRef, drawingsRef, getCandles])

  const pixelToPoint = useCallback((px: number, py: number): Point => {
    const chart = chartRef.current
    const sourceCandles = getCandles()
    const ts = coordinateToAnchoredTime(chart, sourceCandles, px)
    const logical = (chart?.timeScale().coordinateToLogical(px) ?? px) as unknown as Logical
    const price = candleRef.current?.coordinateToPrice(py) ?? py
    return { time: ts, logical, price, x: px, y: py }
  }, [candleRef, chartRef, getCandles])

  const getChartPoint = useCallback((
    e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement>,
  ): Point | null => {
    const chart  = chartRef.current
    const canvas = overlayRef.current
    if (!chart || !canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const ts      = coordinateToAnchoredTime(chart, getCandles(), x)
    const logical = chart.timeScale().coordinateToLogical(x)
    const price   = candleRef.current?.coordinateToPrice(y)
    return {
      time:    ts,
      logical: (logical ?? x) as unknown as Logical,
      price:   price ?? y,
      x,
      y,
    }
  }, [candleRef, chartRef, getCandles, overlayRef])

  // ── Helpers ──────────────────────────────────
  const findHitDrawing = useCallback((mx: number, my: number): { drawing: Drawing; nodeIdx: number } | null => {
    if (drawingsHiddenRef.current) return null
    const canvas = overlayRef.current
    for (const d of [...getVisibleDrawings()].reverse()) {
      const pixels = d.points.map(p => isAnchoredTextTool(d.tool) ? { x: p.x, y: p.y } : pointToPixel(p))

      if (d.points.length > 0 && isTextTool(d.tool)) {
        const textPoint = (d.tool === 'note' || d.tool === 'anchorednote') && pixels[1] ? pixels[1] : pixels[0]
        const rect = getTextBodyHitRect(d, textPoint)
        if (d.tool === 'signpost' && Math.hypot(textPoint.x - mx, rect.y - my) < HIT.NODE) {
          return { drawing: d, nodeIdx: 0 }
        }
        if (pointInRect(mx, my, rect)) {
          return {
            drawing: d,
            nodeIdx: d.tool === 'callout'
              ? NODE_INDICES.TEXT_BODY
              : NODE_INDICES.WHOLE_DRAG,
          }
        }
      }

      if (d.tool === 'fixedrangevolumeprofile' && pixels.length >= 2) {
        const chart = chartRef.current
        const candleSeries = candleRef.current
        const bounds = chart && candleSeries
          ? getFixedRangeProfileBoundsForHit(pixels, getCandles(), chart, candleSeries)
          : null
        if (bounds) {
          const handles = [
            { point: { x: bounds.left, y: bounds.top }, nodeIdx: 0 },
            { point: { x: bounds.right, y: bounds.bottom }, nodeIdx: 1 },
          ]
          for (const handle of handles) {
            if (Math.hypot(handle.point.x - mx, handle.point.y - my) < HIT.NODE) {
              return { drawing: d, nodeIdx: handle.nodeIdx }
            }
          }
        }
      }

      const handleHits = getHandleHits(d, pixels)
      for (const handle of handleHits) {
        const handlePixel = getDrawingHandlePixel(
          d,
          handle.point,
          { width: canvas?.width ?? 0 },
          chartRef.current?.priceScale('right').width() ?? 0,
        )
        const hitRadius =
          d.tool === 'fibspeedresistancearcs' && handle.nodeIdx === 0
            ? HIT.NODE + 8
            : HIT.NODE

        if (Math.hypot(handlePixel.x - mx, handlePixel.y - my) < hitRadius) {
          return { drawing: d, nodeIdx: handle.nodeIdx }
        }
      }

      if (d.tool === 'crossline' && pixels.length >= 1) {
        if (Math.abs(pixels[0].y - my) < HIT.LINE) return { drawing: d, nodeIdx: NODE_INDICES.CROSSLINE_HORIZONTAL }
        if (Math.abs(pixels[0].x - mx) < HIT.LINE) return { drawing: d, nodeIdx: NODE_INDICES.CROSSLINE_VERTICAL }
      }

      if (d.tool === 'fixedrangevolumeprofile' && pixels.length >= 2) {
        const chart = chartRef.current
        const candleSeries = candleRef.current
        if (chart && candleSeries && hitFixedRangeVolumeProfile(mx, my, pixels, getCandles(), chart, candleSeries)) {
          return { drawing: d, nodeIdx: NODE_INDICES.WHOLE_DRAG }
        }
      }

      for (const [start, end] of getHitSegments(d, pixels, canvas ?? { width: 0, height: 0 }, {
        candles: getCandles(),
        chart: chartRef.current,
        candleSeries: candleRef.current,
      })) {
        if (distToSegment(mx, my, start, end) < HIT.LINE) {
          return { drawing: d, nodeIdx: NODE_INDICES.WHOLE_DRAG }
        }
      }
    }
    return null
  }, [candleRef, chartRef, drawingsHiddenRef, getCandles, getVisibleDrawings, overlayRef, pointToPixel])

  const selectDrawing = useCallback((drawing: Drawing, showPanel = true) => {
    const panelPt = isAnchoredTextTool(drawing.tool)
      ? { x: drawing.points[0]?.x ?? 0, y: drawing.points[0]?.y ?? 0 }
      : pointToPixel(drawing.points[0])
    const previousSelection = selectedRef.current
    const sel: SelectedDrawing = previousSelection?.id === drawing.id
      ? previousSelection
      : {
          id: drawing.id,
          panelX: panelPt.x,
          panelY: panelPt.y <= SELECTION_PANEL_TOP_THRESHOLD
            ? panelPt.y + SELECTION_PANEL_GAP
            : panelPt.y - SELECTION_PANEL_GAP,
        }
    setSelected(showPanel ? sel : null)
    selectedRef.current = sel
  }, [pointToPixel, selectedRef, setSelected])

  const cloneDrawing = useCallback((drawing: Drawing, offsetX = 0, offsetY = 0): Drawing => ({
    ...drawing,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    points: drawing.points.map(point => {
      if (offsetX === 0 && offsetY === 0) return { ...point }
      if (isAnchoredTextTool(drawing.tool)) return { ...point, x: point.x + offsetX, y: point.y + offsetY }
      const px = pointToPixel(point)
      return pixelToPoint(px.x + offsetX, px.y + offsetY)
    }),
  }), [pixelToPoint, pointToPixel])

  const createDrawing = useCallback((drawing: Drawing): Drawing => drawing, [])

  const createPositionPoints = useCallback((point: Point, side: 'long' | 'short') => {
    const entry = pointToPixel(point)
    const width = 120
    const targetHeight = 64
    const stopHeight = 64

    return [
      point,
      pixelToPoint(entry.x + width, entry.y + (side === 'long' ? -targetHeight : targetHeight)),
      pixelToPoint(entry.x + width, entry.y + (side === 'long' ? stopHeight : -stopHeight)),
    ]
  }, [pixelToPoint, pointToPixel])

  const createAnchoredVwapPoint = useCallback((point: Point): Point => {
    const chart = chartRef.current
    const candleSeries = candleRef.current
    if (!chart || !candleSeries) return point
    const sourceCandles = getCandles()
    const index = getCandleIndexForPoint(point, sourceCandles)
    const logical = index ?? Math.round(Number(point.logical))
    const candle = sourceCandles[logical]
    if (!candle) return point
    const time = candleUnixTime(candle)
    const x = chart.timeScale().timeToCoordinate(time as Time) ?? point.x
    const middlePrice = (candle.high + candle.low) / 2
    const y = candleSeries.priceToCoordinate(middlePrice) ?? point.y
    return {
      ...pixelToPoint(x, y),
      time,
      logical: logical as unknown as Logical,
      price: middlePrice,
    }
  }, [candleRef, chartRef, getCandles, pixelToPoint])

  const createSignpostPoint = useCallback((point: Point): Point => {
    const chart = chartRef.current
    const candleSeries = candleRef.current
    if (!chart || !candleSeries) return point
    const sourceCandles = getCandles()
    const index = getCandleIndexForPoint(point, sourceCandles)
    const candle = index == null ? null : sourceCandles[index]
    if (!candle) return point
    const time = candleUnixTime(candle)
    const x = chart.timeScale().timeToCoordinate(time as Time) ?? point.x
    const highY = candleSeries.priceToCoordinate(candle.high)
    if (highY == null) return point
    return {
      ...pixelToPoint(x, highY - 8),
      time,
      logical: index as unknown as Logical,
    }
  }, [candleRef, chartRef, getCandles, pixelToPoint])

  const createBarsPatternSnapshot = useCallback((startPoint: Point, endPoint: Point): Point[] => {
    const chart = chartRef.current
    const candleSeries = candleRef.current
    if (!chart || !candleSeries) return [startPoint, endPoint]

    const startPx = pointToPixel(startPoint)
    const endPx = pointToPixel(endPoint)
    const left = Math.min(startPx.x, endPx.x)
    const right = Math.max(startPx.x, endPx.x)
    const offset = 70
    const segments: Point[] = []

    for (const candle of getCandles()) {
      const time = Math.floor(new Date(candle.ts).getTime() / 1000)
      const x = chart.timeScale().timeToCoordinate(time as Time)
      if (x == null || x < left || x > right) continue
      const highY = candleSeries.priceToCoordinate(candle.high)
      const lowY = candleSeries.priceToCoordinate(candle.low)
      if (highY == null || lowY == null) continue
      segments.push(
        pixelToPoint(x, highY - offset),
        pixelToPoint(x, lowY - offset),
      )
    }

    if (segments.length < 2) return [startPoint, endPoint]
    return [segments[0], segments[segments.length - 1], ...segments]
  }, [candleRef, chartRef, getCandles, pixelToPoint, pointToPixel])

  const beginDrawingDrag = useCallback((
    drawing: Drawing,
    nodeIdx: number,
    mx: number,
    my: number,
    cloneFirst: boolean,
  ) => {
      const dragDrawing = cloneFirst ? cloneDrawing(drawing) : drawing

    if (cloneFirst) {
      setSelected(null)
      selectedRef.current = null
      const next = [...drawingsRef.current, dragDrawing]
      drawingsRef.current = next
      setDrawings(next)
    }

    selectDrawing(dragDrawing, cloneFirst || nodeIdx === NODE_INDICES.WHOLE_DRAG)
    draggingDrawingId.current = dragDrawing.id
    draggingNodeIdx.current   = nodeIdx
    dragStartMouse.current    = { x: mx, y: my }
    dragStartPoints.current   = dragDrawing.points.map(point => ({ ...point }))
    dragStartTextOffset.current = dragDrawing.textOffset ? { ...dragDrawing.textOffset } : getDefaultTextOffset(dragDrawing.tool)
    redrawCanvas()
  }, [cloneDrawing, drawingsRef, redrawCanvas, selectDrawing, selectedRef, setDrawings, setSelected])

  const finishGhostFeedDrawing = useCallback(() => {
    if (drawingPoints.current.length < 2) return false
    const newDrawing = createDrawing({
      id: Date.now().toString(),
      tool: 'ghostfeed',
      points: [...drawingPoints.current],
      color: '#64748b',
    })
    const next = [...drawingsRef.current, newDrawing]
    drawingsRef.current = next
    setDrawings(next)
    selectDrawing(newDrawing)
    drawingPoints.current = []
    isDrawing.current = false
    redrawCanvas()
    return true
  }, [createDrawing, drawingsRef, redrawCanvas, selectDrawing, setDrawings])

  const finishPathDrawing = useCallback(() => {
    if (drawingPoints.current.length < 2) {
      drawingPoints.current = []
      isDrawing.current = false
      redrawCanvas()
      return false
    }

    const newDrawing = createDrawing({
      id: Date.now().toString(),
      tool: 'path',
      points: [...drawingPoints.current],
      color: DEFAULT_DRAWING_COLOR,
    })
    const next = [...drawingsRef.current, newDrawing]
    drawingsRef.current = next
    setDrawings(next)
    selectDrawing(newDrawing)
    drawingPoints.current = []
    isDrawing.current = false
    redrawCanvas()
    setActiveTool(null)
    setCursorMode('cross')
    return true
  }, [createDrawing, drawingsRef, redrawCanvas, selectDrawing, setActiveTool, setCursorMode, setDrawings])

  const finishPolylineDrawing = useCallback((closed = false) => {
    if (drawingPoints.current.length < 2) {
      drawingPoints.current = []
      isDrawing.current = false
      redrawCanvas()
      return false
    }

    const points = closed && drawingPoints.current.length >= 3
      ? [...drawingPoints.current, drawingPoints.current[0]]
      : [...drawingPoints.current]

    const newDrawing = createDrawing({
      id: Date.now().toString(),
      tool: 'polyline',
      points,
      color: DEFAULT_DRAWING_COLOR,
    })
    const next = [...drawingsRef.current, newDrawing]
    drawingsRef.current = next
    setDrawings(next)
    selectDrawing(newDrawing)
    drawingPoints.current = []
    isDrawing.current = false
    redrawCanvas()
    setActiveTool(null)
    setCursorMode('cross')
    return true
  }, [createDrawing, drawingsRef, redrawCanvas, selectDrawing, setActiveTool, setCursorMode, setDrawings])

  const finishFreehandDrawing = useCallback(() => {
    const tool = activeToolRef.current
    if (!FREEHAND_TOOLS.has(tool)) return false
    if (drawingPoints.current.length < 2) {
      drawingPoints.current = []
      isDrawing.current = false
      redrawCanvas()
      return false
    }

    const points = simplifyFreehandDrawingPoints(
      drawingPoints.current,
      pointToPixel,
      tool === 'highlighter' ? FREEHAND_SIMPLIFY.highlighter : FREEHAND_SIMPLIFY.brush,
    )

    const newDrawing = createDrawing({
      id: Date.now().toString(),
      tool,
      points,
      color: tool === 'highlighter' ? HIGHLIGHTER_DRAWING_COLOR : BRUSH_DRAWING_COLOR,
      lineWidth: tool === 'highlighter' ? 24 : 2,
    })
    const next = [...drawingsRef.current, newDrawing]
    drawingsRef.current = next
    setDrawings(next)
    selectDrawing(newDrawing)
    drawingPoints.current = []
    isDrawing.current = false
    redrawCanvas()
    return true
  }, [activeToolRef, createDrawing, drawingsRef, pointToPixel, redrawCanvas, selectDrawing, setDrawings])

  const cancelActiveTool = useCallback(() => {
    isDrawing.current = false
    drawingPoints.current = []
    draggingDrawingId.current = null
    draggingNodeIdx.current = null
    dragStartMouse.current = null
    dragStartPoints.current = []
    dragStartTextOffset.current = null
    setActiveTool(null)
    setCursorMode('cross')
    redrawCanvas()
  }, [redrawCanvas, setActiveTool, setCursorMode])

  const applyDrawingPointDrag = useCallback((d: Drawing, dx: number, dy: number): Drawing => {
    const nodeIdx = draggingNodeIdx.current

    if (d.tool === 'signpost') {
      const startOffset = dragStartTextOffset.current ?? getDefaultTextOffset('signpost')
      if (nodeIdx === 0) {
        return { ...d, textOffset: { x: 0, y: startOffset.y + dy } }
      }
      if (nodeIdx === NODE_INDICES.WHOLE_DRAG && dragStartPoints.current[0]) {
        const startPixel = pointToPixel(dragStartPoints.current[0])
        const nextPoint = createSignpostPoint(pixelToPoint(startPixel.x + dx, startPixel.y))
        return { ...d, points: [nextPoint], textOffset: startOffset }
      }
    }

    if (nodeIdx === NODE_INDICES.TEXT_BODY && d.tool === 'callout') {
      const startOffset = dragStartTextOffset.current ?? getDefaultTextOffset(d.tool)
      return { ...d, textOffset: { x: startOffset.x + dx, y: startOffset.y + dy } }
    }

    if (d.tool === 'fixedrangevolumeprofile' && nodeIdx === NODE_INDICES.WHOLE_DRAG) {
      return d
    }

    if (d.tool === 'fixedrangevolumeprofile' && (nodeIdx === 0 || nodeIdx === 1)) {
      const chart = chartRef.current
      const candleSeries = candleRef.current
      const startPixels = dragStartPoints.current.map(point => pointToPixel(point))
      const bounds = chart && candleSeries
        ? getFixedRangeProfileBoundsForHit(startPixels, getCandles(), chart, candleSeries)
        : null
      const newPts = [...dragStartPoints.current]
      if (bounds && nodeIdx === 0) {
        newPts[0] = pixelToPoint(bounds.left + dx, bounds.top + dy)
      } else if (bounds && nodeIdx === 1) {
        newPts[1] = pixelToPoint(bounds.right + dx, bounds.bottom + dy)
      } else {
        const origPx = pointToPixel(dragStartPoints.current[nodeIdx])
        newPts[nodeIdx] = pixelToPoint(origPx.x + dx, origPx.y + dy)
      }
      return { ...d, points: newPts, lineWidth: -999 }
    }

    if ((d.tool === 'longposition' || d.tool === 'shortposition') && dragStartPoints.current.length >= 3) {
      const [entry, target, stop] = dragStartPoints.current.map(p => pointToPixel(p))

      if (nodeIdx === NODE_INDICES.POSITION_TARGET) {
        const nextTargetY = d.tool === 'longposition'
          ? Math.min(target.y + dy, entry.y - 1)
          : Math.max(target.y + dy, entry.y + 1)
        return {
          ...d,
          points: [
            dragStartPoints.current[0],
            pixelToPoint(target.x, nextTargetY),
            dragStartPoints.current[2],
          ],
        }
      }

      if (nodeIdx === NODE_INDICES.POSITION_STOP) {
        const nextStopY = d.tool === 'longposition'
          ? Math.max(stop.y + dy, entry.y + 1)
          : Math.min(stop.y + dy, entry.y - 1)
        return {
          ...d,
          points: [
            dragStartPoints.current[0],
            dragStartPoints.current[1],
            pixelToPoint(stop.x, nextStopY),
          ],
        }
      }

      if (nodeIdx === NODE_INDICES.POSITION_WIDTH) {
        const nextX = Math.max(entry.x + 12, target.x + dx)
        return {
          ...d,
          points: [
            dragStartPoints.current[0],
            pixelToPoint(nextX, target.y),
            pixelToPoint(nextX, stop.y),
          ],
        }
      }

      if (nodeIdx === NODE_INDICES.WHOLE_DRAG) {
        return {
          ...d,
          points: [entry, target, stop].map(point => pixelToPoint(point.x + dx, point.y + dy)),
        }
      }
    }

    if (d.tool === 'gannsquarefixed' && dragStartPoints.current.length >= 2) {
      const startPixels = dragStartPoints.current.map(p => pointToPixel(p))
      const [origin, control] = startPixels

      // drag whole object
      if (nodeIdx === NODE_INDICES.WHOLE_DRAG) {
        return {
          ...d,
          points: startPixels.map(p => pixelToPoint(p.x + dx, p.y + dy)),
        }
      }

      // drag origin
      if (nodeIdx === 0) {
        const nextPoints = [
          pixelToPoint(origin.x + dx, origin.y + dy),
          dragStartPoints.current[1],
        ]

        return {
          ...d,
          points: normalizeGannSquareFixedPoints(
            d.tool,
            nextPoints,
            { pointToPixel, pixelToPoint },
          ),
        }
      }

      // drag control point روی arc کوچک
      if (nodeIdx === 1) {
        const nextPoints = [
          dragStartPoints.current[0],
          pixelToPoint(control.x + dx, control.y + dy),
        ]

        return {
          ...d,
          points: normalizeGannSquareFixedPoints(
            d.tool,
            nextPoints,
            { pointToPixel, pixelToPoint },
          ),
        }
      }
    }

    if (d.tool === 'fibwedge' && dragStartPoints.current.length >= 3) {
      const startPixels = dragStartPoints.current.map(p => pointToPixel(p))
      const [center, rayA, rayB] = startPixels

      const angleA = Math.atan2(rayA.y - center.y, rayA.x - center.x)
      const angleB = Math.atan2(rayB.y - center.y, rayB.x - center.x)

      // Drag whole drawing:
      // فقط وقتی روی خود کمان/خط کلیک شده، کل آبجکت حرکت کند
      if (nodeIdx === NODE_INDICES.WHOLE_DRAG) {
        return {
          ...d,
          points: startPixels.map(p => pixelToPoint(p.x + dx, p.y + dy)),
        }
      }

      // Drag center:
      // فقط مرکز تغییر کند
      if (nodeIdx === 0) {
        return {
          ...d,
          points: [
            pixelToPoint(center.x + dx, center.y + dy),
            dragStartPoints.current[1],
            dragStartPoints.current[2],
          ],
        }
      }

      // Drag node 1:
      // نود دوم جهت ضلع اول و radius کل wedge را عوض کند
      if (nodeIdx === 1) {
        const nextRayA = {
          x: rayA.x + dx,
          y: rayA.y + dy,
        }

        const nextRadius = Math.hypot(
          nextRayA.x - center.x,
          nextRayA.y - center.y,
        )

        if (nextRadius < 0.001) return d

        const nextRayB = {
          x: center.x + Math.cos(angleB) * nextRadius,
          y: center.y + Math.sin(angleB) * nextRadius,
        }

        return {
          ...d,
          points: [
            dragStartPoints.current[0],
            pixelToPoint(nextRayA.x, nextRayA.y),
            pixelToPoint(nextRayB.x, nextRayB.y),
          ],
        }
      }

      // Drag node 2:
      // نود سوم جهت ضلع دوم و radius کل wedge را عوض کند
      if (nodeIdx === 2) {
        const nextRayB = {
          x: rayB.x + dx,
          y: rayB.y + dy,
        }

        const nextRadius = Math.hypot(
          nextRayB.x - center.x,
          nextRayB.y - center.y,
        )

        if (nextRadius < 0.001) return d

        const nextRayA = {
          x: center.x + Math.cos(angleA) * nextRadius,
          y: center.y + Math.sin(angleA) * nextRadius,
        }

        return {
          ...d,
          points: [
            dragStartPoints.current[0],
            pixelToPoint(nextRayA.x, nextRayA.y),
            pixelToPoint(nextRayB.x, nextRayB.y),
          ],
        }
      }
    }
    if (
      (
        d.tool === 'fibonacci' ||
        d.tool === 'trendbasedfibextension' ||
        d.tool === 'fibchannel'
      ) &&
      nodeIdx === NODE_INDICES.WHOLE_DRAG
    ) {
      const startPixels = dragStartPoints.current.map(p => pointToPixel(p))

      return {
        ...d,
        points: startPixels.map(p => pixelToPoint(p.x + dx, p.y + dy)),
      }
    }
   if (
      d.tool !== 'trendbasedfibextension' &&
      d.tool !== 'fibchannel' &&
      CHANNEL_TOOLS.includes(d.tool) &&
      dragStartPoints.current.length >= 3
    ) {
      const startPixels = dragStartPoints.current.map(p => pointToPixel(p))
      const geometry = getChannelGeometry(startPixels)

      if (geometry && (nodeIdx === NODE_INDICES.CHANNEL_BASE_MIDDLE || nodeIdx === NODE_INDICES.CHANNEL_PARALLEL_MIDDLE)) {
  
        // ✅ نود مربعی خط اول: هر دو سر خط اول رو در Y جابجا کن، عرض کانال ثابت
        if (nodeIdx === NODE_INDICES.CHANNEL_BASE_MIDDLE) {
          return {
            ...d,
            points: [
              pixelToPoint(startPixels[0].x, startPixels[0].y + dy),
              pixelToPoint(startPixels[1].x, startPixels[1].y + dy),
              dragStartPoints.current[2], // points[2] ثابت می‌مونه
            ],
          }
        }

        // ✅ نود مربعی خط موازی: فقط عرض کانال عوض بشه (همین کد قبلی)
        const middle = getMidpoint(startPixels[0], startPixels[1])
        const nextWidthPoint = pixelToPoint(middle.x, middle.y + geometry.offsetY + dy)
        return { ...d, points: [dragStartPoints.current[0], dragStartPoints.current[1], nextWidthPoint] }
      }

      if (geometry && (
        nodeIdx === 0 ||
        nodeIdx === 1 ||
        nodeIdx === NODE_INDICES.CHANNEL_PARALLEL_START ||
        nodeIdx === NODE_INDICES.CHANNEL_PARALLEL_END
      )) {
        const nextPixels = [...startPixels]
        const targetIdx = nodeIdx === 1 || nodeIdx === NODE_INDICES.CHANNEL_PARALLEL_END ? 1 : 0
        nextPixels[targetIdx] = {
          x: startPixels[targetIdx].x + dx,
          y: startPixels[targetIdx].y + dy,
        }

        // ✅ از newMiddle استفاده کن نه oldMiddle
        const newMiddle = getMidpoint(nextPixels[0], nextPixels[1])
        const nextWidthPoint = pixelToPoint(newMiddle.x, newMiddle.y + geometry.offsetY)

        return {
          ...d,
          points: [
            pixelToPoint(nextPixels[0].x, nextPixels[0].y),
            pixelToPoint(nextPixels[1].x, nextPixels[1].y),
            nextWidthPoint,
          ],
        }
      }
    }

    if (d.tool === 'disjointchannel' && dragStartPoints.current.length >= 3) {
      const startPixels = dragStartPoints.current.map(p => pointToPixel(p))
      const [start, end, storedInverseStart] = startPixels

      // همیشه نود مربعی خط دوم باید هم‌X با نقطه دوم خط اول باشد
      const inverseStart = { x: end.x, y: storedInverseStart.y }

      // نود دایره‌ای خط دوم، مشتق‌شده از نقطه اول + شیب معکوس است
      const inverseEnd = {
        x: start.x,
        y: inverseStart.y + (end.y - start.y),
      }

      // نقطه اول خط اصلی
      // اگر نقطه اول جابه‌جا شود، p2 فقط از نظر X دوباره به end قفل می‌شود
      if (nodeIdx === 0) {
        const nextStart = pixelToPoint(start.x + dx, start.y + dy)
        const nextP2 = pixelToPoint(end.x, inverseStart.y)

        return {
          ...d,
          points: [nextStart, dragStartPoints.current[1], nextP2],
        }
      }

      // نقطه دوم خط اصلی
      // وقتی end در X حرکت کند، نود مربعی خط دوم هم باید همان X را بگیرد
      if (nodeIdx === 1) {
        const nextEndPx = {
          x: end.x + dx,
          y: end.y + dy,
        }

        const nextEnd = pixelToPoint(nextEndPx.x, nextEndPx.y)
        const nextP2 = pixelToPoint(nextEndPx.x, inverseStart.y)

        return {
          ...d,
          points: [dragStartPoints.current[0], nextEnd, nextP2],
        }
      }

      // نود مربعی خط دوم: فقط Y
      // X همیشه قفل به end.x است
      if (nodeIdx === NODE_INDICES.DISJOINT_REFERENCE) {
        const nextP2 = pixelToPoint(end.x, inverseStart.y + dy)

        return {
          ...d,
          points: [dragStartPoints.current[0], dragStartPoints.current[1], nextP2],
        }
      }

      // نود دایره‌ای خط دوم: X و Y
      // خود نود دایره‌ای با موس حرکت می‌کند،
      // ولی چون این نود ذخیره‌شده نیست، باید start را طوری آپدیت کنیم
      // که inverseEnd مشتق‌شده دقیقاً روی موقعیت جدید بیفتد.
      if (nodeIdx === NODE_INDICES.DISJOINT_INVERSE_END) {
        const nextInverseEnd = {
          x: inverseEnd.x + dx,
          y: inverseEnd.y + dy,
        }

        const nextStart = pixelToPoint(
          nextInverseEnd.x,
          end.y + inverseStart.y - nextInverseEnd.y,
        )

        const nextP2 = pixelToPoint(end.x, inverseStart.y)

        return {
          ...d,
          points: [nextStart, dragStartPoints.current[1], nextP2],
        }
      }
    }

    if (d.tool === 'flattopbottom' && dragStartPoints.current.length >= 3) {
      if (nodeIdx === 0 || nodeIdx === 1) {
        const startPixels = dragStartPoints.current.map(p => pointToPixel(p))
        const nextPixels = [...startPixels]
        nextPixels[nodeIdx] = {
          x: startPixels[nodeIdx].x + dx,
          y: startPixels[nodeIdx].y + dy,
        }
        return {
          ...d,
          points: [
            pixelToPoint(nextPixels[0].x, nextPixels[0].y),
            pixelToPoint(nextPixels[1].x, nextPixels[1].y),
            dragStartPoints.current[2],
          ],
        }
      }

      if (nodeIdx === NODE_INDICES.FLAT_HORIZONTAL_START || nodeIdx === NODE_INDICES.FLAT_HORIZONTAL_END) {
        const end = pointToPixel(dragStartPoints.current[1])
        const heightPoint = pointToPixel(dragStartPoints.current[2])
        const nextHeightPoint = pixelToPoint(end.x, heightPoint.y + dy)
        return { ...d, points: [dragStartPoints.current[0], dragStartPoints.current[1], nextHeightPoint] }
      }
    }

    if (d.tool === 'timecycles' && dragStartPoints.current.length >= 2) {
      const a = pointToPixel(dragStartPoints.current[0])
      const b = pointToPixel(dragStartPoints.current[1])

      // drag whole object
      if (nodeIdx === NODE_INDICES.WHOLE_DRAG) {
        return {
          ...d,
          points: [
            pixelToPoint(a.x + dx, a.y + dy),
            pixelToPoint(b.x + dx, b.y + dy),
          ],
        }
      }

      // drag node 0
      if (nodeIdx === 0) {
        const nextA = {
          x: a.x + dx,
          y: a.y + dy,
        }

        return {
          ...d,
          points: [
            pixelToPoint(nextA.x, nextA.y),
            pixelToPoint(b.x, nextA.y), // فقط Y برابر شود، X ثابت بماند
          ],
        }
      }

      // drag node 1
      if (nodeIdx === 1) {
        const nextB = {
          x: b.x + dx,
          y: b.y + dy,
        }

        return {
          ...d,
          points: [
            pixelToPoint(a.x, nextB.y), // فقط Y برابر شود، X ثابت بماند
            pixelToPoint(nextB.x, nextB.y),
          ],
        }
      }
    }

    if (d.tool === 'projection' && dragStartPoints.current.length >= 3) {
      const origin = pointToPixel(dragStartPoints.current[0])
      const upper = pointToPixel(dragStartPoints.current[1])
      const lower = pointToPixel(dragStartPoints.current[2])

      if (nodeIdx === 1 || nodeIdx === 2) {
        const source = nodeIdx === 1 ? upper : lower
        const target = { x: source.x + dx, y: source.y + dy }
        const nextRadius = Math.max(1, Math.hypot(target.x - origin.x, target.y - origin.y))
        const nextAngle = Math.atan2(target.y - origin.y, target.x - origin.x)
        const otherAngle = Math.atan2(
          (nodeIdx === 1 ? lower : upper).y - origin.y,
          (nodeIdx === 1 ? lower : upper).x - origin.x,
        )
        const nextPoint = pixelToPoint(
          origin.x + Math.cos(nextAngle) * nextRadius,
          origin.y + Math.sin(nextAngle) * nextRadius,
        )
        const otherPoint = pixelToPoint(
          origin.x + Math.cos(otherAngle) * nextRadius,
          origin.y + Math.sin(otherAngle) * nextRadius,
        )

        return {
          ...d,
          points: nodeIdx === 1
            ? [dragStartPoints.current[0], nextPoint, otherPoint]
            : [dragStartPoints.current[0], otherPoint, nextPoint],
        }
      }
    }

    if (d.tool === 'arc' && dragStartPoints.current.length >= 3) {
      const startPixels = dragStartPoints.current.map(point => pointToPixel(point))
      const control = startPixels[2]

      if (nodeIdx === NODE_INDICES.WHOLE_DRAG) {
        return {
          ...d,
          points: startPixels.map(point => pixelToPoint(point.x + dx, point.y + dy)),
        }
      }

      if (nodeIdx === 0 || nodeIdx === 1) {
        const baseDx = startPixels[1].x - startPixels[0].x
        const baseDy = startPixels[1].y - startPixels[0].y
        const baseLength = Math.hypot(baseDx, baseDy)
        if (baseLength < 0.001) return d
        const baseMiddle = {
          x: (startPixels[0].x + startPixels[1].x) / 2,
          y: (startPixels[0].y + startPixels[1].y) / 2,
        }
        const baseNx = -baseDy / baseLength
        const baseNy = baseDx / baseLength
        const signedOffset = (control.x - baseMiddle.x) * baseNx + (control.y - baseMiddle.y) * baseNy

        const nextPixels = [...startPixels]
        nextPixels[nodeIdx] = {
          x: nextPixels[nodeIdx].x + dx,
          y: nextPixels[nodeIdx].y + dy,
        }
        const nextDx = nextPixels[1].x - nextPixels[0].x
        const nextDy = nextPixels[1].y - nextPixels[0].y
        const nextLength = Math.hypot(nextDx, nextDy)
        if (nextLength < 0.001) return d
        const nextMiddle = {
          x: (nextPixels[0].x + nextPixels[1].x) / 2,
          y: (nextPixels[0].y + nextPixels[1].y) / 2,
        }
        const nextControl = {
          x: nextMiddle.x + (-nextDy / nextLength) * signedOffset,
          y: nextMiddle.y + (nextDx / nextLength) * signedOffset,
        }
        return {
          ...d,
          points: [
            pixelToPoint(nextPixels[0].x, nextPixels[0].y),
            pixelToPoint(nextPixels[1].x, nextPixels[1].y),
            pixelToPoint(nextControl.x, nextControl.y),
          ],
        }
      }

      if (nodeIdx === 2) {
        const nextMid = {
          x: control.x + dx,
          y: control.y + dy,
        }
        const baseStart = pointToPixel(dragStartPoints.current[0])
        const baseEnd = pointToPixel(dragStartPoints.current[1])
        const baseDx = baseEnd.x - baseStart.x
        const baseDy = baseEnd.y - baseStart.y
        const baseLength = Math.hypot(baseDx, baseDy)
        if (baseLength < 0.001) return d
        const middle = {
          x: (baseStart.x + baseEnd.x) / 2,
          y: (baseStart.y + baseEnd.y) / 2,
        }
        const nx = -baseDy / baseLength
        const ny = baseDx / baseLength
        const offset = (nextMid.x - middle.x) * nx + (nextMid.y - middle.y) * ny
        const snappedMid = {
          x: middle.x + nx * offset,
          y: middle.y + ny * offset,
        }
        return {
          ...d,
          points: [
            dragStartPoints.current[0],
            dragStartPoints.current[1],
            pixelToPoint(snappedMid.x, snappedMid.y),
          ],
        }
      }
    }

    if (d.tool === 'ellipse' && dragStartPoints.current.length >= 2) {
      const startPixels = dragStartPoints.current.map(point => pointToPixel(point))
      const [start, end] = startPixels
      const control = startPixels[2]
      const dxBase = end.x - start.x
      const dyBase = end.y - start.y
      const baseLength = Math.hypot(dxBase, dyBase)
      if (baseLength < 0.001) return d

      const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      const nx = -dyBase / baseLength
      const ny = dxBase / baseLength
      const signedMinor = control
        ? (control.x - center.x) * nx + (control.y - center.y) * ny
        : Math.max(8, baseLength * 0.12)

      if (nodeIdx === NODE_INDICES.WHOLE_DRAG) {
        return {
          ...d,
          points: startPixels.map(point => pixelToPoint(point.x + dx, point.y + dy)),
        }
      }

      if (nodeIdx === 0 || nodeIdx === 1) {
        const nextStart = nodeIdx === 0 ? { x: start.x + dx, y: start.y + dy } : start
        const nextEnd = nodeIdx === 1 ? { x: end.x + dx, y: end.y + dy } : end
        const nextDx = nextEnd.x - nextStart.x
        const nextDy = nextEnd.y - nextStart.y
        const nextLength = Math.hypot(nextDx, nextDy)
        if (nextLength < 0.001) return d

        const nextCenter = { x: (nextStart.x + nextEnd.x) / 2, y: (nextStart.y + nextEnd.y) / 2 }
        const nextNx = -nextDy / nextLength
        const nextNy = nextDx / nextLength
        const nextControl = {
          x: nextCenter.x + nextNx * signedMinor,
          y: nextCenter.y + nextNy * signedMinor,
        }

        return {
          ...d,
          points: [
            pixelToPoint(nextStart.x, nextStart.y),
            pixelToPoint(nextEnd.x, nextEnd.y),
            pixelToPoint(nextControl.x, nextControl.y),
          ],
        }
      }

      if (nodeIdx === 2 || nodeIdx === NODE_INDICES.ELLIPSE_OPPOSITE_WIDTH) {
        const sign = signedMinor < 0 ? -1 : 1
        const ry = Math.max(1, Math.abs(signedMinor))
        const handle = nodeIdx === 2
          ? { x: center.x + nx * ry * sign, y: center.y + ny * ry * sign }
          : { x: center.x - nx * ry * sign, y: center.y - ny * ry * sign }
        const target = { x: handle.x + dx, y: handle.y + dy }
        const projected = (target.x - center.x) * nx + (target.y - center.y) * ny
        const nextSignedMinor = nodeIdx === 2 ? projected : -projected
        const nextControl = {
          x: center.x + nx * nextSignedMinor,
          y: center.y + ny * nextSignedMinor,
        }

        return {
          ...d,
          points: [
            dragStartPoints.current[0],
            dragStartPoints.current[1],
            pixelToPoint(nextControl.x, nextControl.y),
          ],
        }
      }
    }

    if (d.tool === 'barspattern' && dragStartPoints.current.length > 2 && (nodeIdx === 0 || nodeIdx === 1)) {
      const startPixels = dragStartPoints.current.map(point => pointToPixel(point))
      const moving = startPixels[nodeIdx]
      const fixed = startPixels[nodeIdx === 0 ? 1 : 0]
      const target = { x: moving.x + dx, y: moving.y + dy }
      const baseDx = moving.x - fixed.x
      const baseDy = moving.y - fixed.y
      const sx = Math.abs(baseDx) < 0.001 ? 1 : (target.x - fixed.x) / baseDx
      const sy = Math.abs(baseDy) < 0.001 ? 1 : (target.y - fixed.y) / baseDy

      return {
        ...d,
        points: startPixels.map(point => pixelToPoint(
          fixed.x + (point.x - fixed.x) * sx,
          fixed.y + (point.y - fixed.y) * sy,
        )),
      }
    }

    if (d.tool === 'anchoredvwap' && dragStartPoints.current.length >= 1 && nodeIdx === 0) {
      const start = pointToPixel(dragStartPoints.current[0])
      return {
        ...d,
        points: [createAnchoredVwapPoint(pixelToPoint(start.x + dx, start.y + dy))],
      }
    }

    if (FREEHAND_TOOLS.has(d.tool) && nodeIdx === NODE_INDICES.WHOLE_DRAG) {
      const startPixels = dragStartPoints.current.map(point => pointToPixel(point))
      return {
        ...d,
        points: startPixels.map(point => pixelToPoint(point.x + dx, point.y + dy)),
      }
    }

    if (d.tool === 'rectangle' && dragStartPoints.current.length >= 2) {
      const [a, b] = dragStartPoints.current.map(point => pointToPixel(point))
      let left = Math.min(a.x, b.x)
      let right = Math.max(a.x, b.x)
      let top = Math.min(a.y, b.y)
      let bottom = Math.max(a.y, b.y)

      if (nodeIdx === NODE_INDICES.WHOLE_DRAG) {
        return {
          ...d,
          points: [
            pixelToPoint(a.x + dx, a.y + dy),
            pixelToPoint(b.x + dx, b.y + dy),
          ],
        }
      }

      if (nodeIdx === 0) {
        left = a.x + dx
        top = a.y + dy
      } else if (nodeIdx === 1) {
        right = b.x + dx
        bottom = b.y + dy
      } else if (nodeIdx === NODE_INDICES.RECT_TOP) {
        top += dy
      } else if (nodeIdx === NODE_INDICES.RECT_RIGHT) {
        right += dx
      } else if (nodeIdx === NODE_INDICES.RECT_BOTTOM) {
        bottom += dy
      } else if (nodeIdx === NODE_INDICES.RECT_LEFT) {
        left += dx
      } else if (nodeIdx === NODE_INDICES.RECT_TOP_RIGHT) {
        right += dx
        top += dy
      } else if (nodeIdx === NODE_INDICES.RECT_BOTTOM_LEFT) {
        left += dx
        bottom += dy
      }

      return {
        ...d,
        points: [
          pixelToPoint(left, top),
          pixelToPoint(right, bottom),
        ],
      }
    }

    if (d.tool === 'rotatedrectangle' && dragStartPoints.current.length >= 3) {
      const startPixels = dragStartPoints.current.map(point => pointToPixel(point))
      const [leftCenter, rightCenter, widthPoint] = startPixels
      const dxBase = rightCenter.x - leftCenter.x
      const dyBase = rightCenter.y - leftCenter.y
      const baseLength = Math.hypot(dxBase, dyBase)
      if (baseLength < 0.001) return d

      const oldNx = -dyBase / baseLength
      const oldNy = dxBase / baseLength
      const signedHalfLength =
        (widthPoint.x - leftCenter.x) * oldNx +
        (widthPoint.y - leftCenter.y) * oldNy

      if (nodeIdx === NODE_INDICES.WHOLE_DRAG) {
        return {
          ...d,
          points: startPixels.map(point => pixelToPoint(point.x + dx, point.y + dy)),
        }
      }

      const isCornerNode =
        nodeIdx === NODE_INDICES.ROT_RECT_A ||
        nodeIdx === NODE_INDICES.ROT_RECT_B ||
        nodeIdx === NODE_INDICES.ROT_RECT_C ||
        nodeIdx === NODE_INDICES.ROT_RECT_D

      if (isCornerNode) {
        const source = nodeIdx === NODE_INDICES.ROT_RECT_A || nodeIdx === NODE_INDICES.ROT_RECT_D
          ? leftCenter
          : rightCenter
        const corner = nodeIdx === NODE_INDICES.ROT_RECT_A
          ? { x: leftCenter.x + oldNx * signedHalfLength, y: leftCenter.y + oldNy * signedHalfLength }
          : nodeIdx === NODE_INDICES.ROT_RECT_B
            ? { x: rightCenter.x + oldNx * signedHalfLength, y: rightCenter.y + oldNy * signedHalfLength }
            : nodeIdx === NODE_INDICES.ROT_RECT_C
              ? { x: rightCenter.x - oldNx * signedHalfLength, y: rightCenter.y - oldNy * signedHalfLength }
              : { x: leftCenter.x - oldNx * signedHalfLength, y: leftCenter.y - oldNy * signedHalfLength }
        const target = { x: corner.x + dx, y: corner.y + dy }
        const nextSignedHalfLength = (target.x - source.x) * oldNx + (target.y - source.y) * oldNy
        const nextWidthPoint = {
          x: leftCenter.x + oldNx * nextSignedHalfLength,
          y: leftCenter.y + oldNy * nextSignedHalfLength,
        }

        return {
          ...d,
          points: [
            dragStartPoints.current[0],
            dragStartPoints.current[1],
            pixelToPoint(nextWidthPoint.x, nextWidthPoint.y),
          ],
        }
      }

      if (nodeIdx === 0 || nodeIdx === 1) {
        const nextLeft = nodeIdx === 0
          ? { x: leftCenter.x + dx, y: leftCenter.y + dy }
          : leftCenter
        const nextRight = nodeIdx === 1
          ? { x: rightCenter.x + dx, y: rightCenter.y + dy }
          : rightCenter
        const nextDx = nextRight.x - nextLeft.x
        const nextDy = nextRight.y - nextLeft.y
        const nextLength = Math.hypot(nextDx, nextDy)
        if (nextLength < 0.001) return d

        const nextNx = -nextDy / nextLength
        const nextNy = nextDx / nextLength
        const nextWidthPoint = {
          x: nextLeft.x + nextNx * signedHalfLength,
          y: nextLeft.y + nextNy * signedHalfLength,
        }

        return {
          ...d,
          points: [
            pixelToPoint(nextLeft.x, nextLeft.y),
            pixelToPoint(nextRight.x, nextRight.y),
            pixelToPoint(nextWidthPoint.x, nextWidthPoint.y),
          ],
        }
      }
    }

    if (d.tool === 'polyline' && dragStartPoints.current.length >= 3) {
      const startPixels = dragStartPoints.current.map(point => pointToPixel(point))
      const first = startPixels[0]
      const last = startPixels[startPixels.length - 1]
      const isClosed = Math.hypot(last.x - first.x, last.y - first.y) <= HIT.NODE + 6

      if (isClosed && nodeIdx === 0) {
        return {
          ...d,
          points: dragStartPoints.current.map((point, i) => {
            if (i !== 0 && i !== dragStartPoints.current.length - 1) return point
            const px = pointToPixel(point)
            return pixelToPoint(px.x + dx, px.y + dy)
          }),
        }
      }
    }

    // Default: move individual node or whole drawing
    const newPts = dragStartPoints.current.map((p, i) => {
      if (nodeIdx !== null && nodeIdx >= 0 && i !== nodeIdx) return p
      const origPx = pointToPixel(p)

      if (d.tool === 'horizontal') {
        const next = pixelToPoint(origPx.x, origPx.y + dy)
        return { ...p, price: next.price, y: next.y }
      }
      if (d.tool === 'crossline' && nodeIdx === NODE_INDICES.CROSSLINE_HORIZONTAL) {
        const next = pixelToPoint(origPx.x, origPx.y + dy)
        return { ...p, price: next.price, y: next.y }
      }
      if (d.tool === 'crossline' && nodeIdx === NODE_INDICES.CROSSLINE_VERTICAL) {
        const next = pixelToPoint(origPx.x + dx, origPx.y)
        return { ...p, time: next.time, logical: next.logical, x: next.x }
      }
      if (isAnchoredTextTool(d.tool)) {
        return { ...p, x: origPx.x + dx, y: origPx.y + dy }
      }
      return pixelToPoint(origPx.x + dx, origPx.y + dy)
    })

    const candles = getCandles()
    return {
      ...d,
      points: normalizeRegressionTrendPoints(
        d.tool,
        applyPointNormalizers(d.tool, newPts, { pointToPixel, pixelToPoint }),
        candles,
        {
          pointToPixel,
          pixelToPoint,
          logicalToCoordinate: (l) =>
            chartRef.current?.timeScale().logicalToCoordinate(l as unknown as Logical) ?? null,
          priceToCoordinate: (p) =>
            candleRef.current?.priceToCoordinate(p) ?? null,
        },
      ),
    }
  }, [candleRef, chartRef, createAnchoredVwapPoint, createSignpostPoint, getCandles, pixelToPoint, pointToPixel])

  const activateDrawTool = useCallback((tool: DrawTool) => {
    if (!tool) return
    isDrawing.current = false
    drawingPoints.current = []
    setSelected(null)
    selectedRef.current = null
    setActiveTool(tool)
    setCursorMode('arrow')
    const groupId = TOOL_GROUP_ID_BY_TOOL.get(tool)
    if (groupId) setPinnedTools(prev => ({ ...prev, [groupId]: tool }))
  }, [selectedRef, setActiveTool, setCursorMode, setSelected, setPinnedTools])

  // ── Mouse/pointer handlers ───────────────────

  const handleMouseDown = useCallback((
    e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const tool = activeToolRef.current
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const isRightClick = 'button' in e && e.button === 2

    if (isRightClick) {
      e.preventDefault()
      e.stopPropagation()
      if (tool === 'path' && isDrawing.current) {
        finishPathDrawing()
        return
      }
      if (tool === 'polyline' && isDrawing.current) {
        finishPolylineDrawing(false)
        return
      }
      if (tool && isDrawing.current) cancelActiveTool()
      return
    }

    // ── Eraser ──
    if (cursorModeRef.current === 'eraser') {
      if (drawingsLockedRef.current) return
      const hit = findHitDrawing(mx, my)
      if (hit) {
        e.preventDefault()
        e.stopPropagation()
        const next = drawingsRef.current.filter(d => d.id !== hit.drawing.id)
        drawingsRef.current = next
        setDrawings(next)
        setSelected(null)
        selectedRef.current = null
        redrawCanvas()
      }
      return
    }

    // ── No tool: select / drag ──
    if (!tool) {
      const hit = findHitDrawing(mx, my)
      if (hit) {
        e.preventDefault()
        e.stopPropagation()
        if (drawingsLockedRef.current) {
          selectDrawing(hit.drawing, false)
          redrawCanvas()
        } else {
          beginDrawingDrag(hit.drawing, hit.nodeIdx, mx, my, e.ctrlKey || e.metaKey)
        }
      } else {
        setSelected(null)
        selectedRef.current = null
        redrawCanvas()
      }
      return
    }

    // ── Drawing mode ──
    const pt = getChartPoint(e)
    if (!pt) return
    const requiredPoints = getRequiredPointCount(tool)

    if (FREEHAND_TOOLS.has(tool)) {
      e.preventDefault()
      e.stopPropagation()
      isDrawing.current = true
      drawingPoints.current = [pt]
      redrawCanvas([pt])
      return
    }

    if (tool === 'ghostfeed') {
      e.preventDefault()
      e.stopPropagation()
      if (!isDrawing.current) {
        isDrawing.current = true
        drawingPoints.current = [pt]
        redrawCanvas([pt])
        return
      }

      const last = drawingPoints.current.at(-1)
      const lastPx = last ? pointToPixel(last) : null
      if (lastPx && drawingPoints.current.length >= 2 && Math.hypot(lastPx.x - mx, lastPx.y - my) < HIT.NODE + 6) {
        finishGhostFeedDrawing()
        return
      }

      drawingPoints.current = [...drawingPoints.current, pt]
      redrawCanvas([...drawingPoints.current])
      return
    }

    if (tool === 'path') {
      e.preventDefault()
      e.stopPropagation()
      if (!isDrawing.current) {
        isDrawing.current = true
        drawingPoints.current = [pt]
        redrawCanvas([pt])
        return
      }

      const last = drawingPoints.current.at(-1)
      const lastPx = last ? pointToPixel(last) : null
      if (lastPx && drawingPoints.current.length >= 2 && Math.hypot(lastPx.x - mx, lastPx.y - my) < HIT.NODE + 6) {
        finishPathDrawing()
        return
      }

      drawingPoints.current = [...drawingPoints.current, pt]
      redrawCanvas([...drawingPoints.current])
      return
    }

    if (tool === 'polyline') {
      e.preventDefault()
      e.stopPropagation()
      if (!isDrawing.current) {
        isDrawing.current = true
        drawingPoints.current = [pt]
        redrawCanvas([pt])
        return
      }

      const first = drawingPoints.current[0]
      const firstPx = first ? pointToPixel(first) : null
      if (firstPx && drawingPoints.current.length >= 3 && Math.hypot(firstPx.x - mx, firstPx.y - my) < HIT.NODE + 6) {
        finishPolylineDrawing(true)
        return
      }

      const last = drawingPoints.current.at(-1)
      const lastPx = last ? pointToPixel(last) : null
      if (lastPx && drawingPoints.current.length >= 2 && Math.hypot(lastPx.x - mx, lastPx.y - my) < HIT.NODE + 6) {
        finishPolylineDrawing(false)
        return
      }

      drawingPoints.current = [...drawingPoints.current, pt]
      redrawCanvas([...drawingPoints.current])
      return
    }

    if (!isDrawing.current) {
      if (requiredPoints === 1) {
        const firstPoint = isAnchoredTextTool(tool)
          ? { ...pt, x: mx, y: my, price: 0, time: null }
          : pt
        const points =
          tool === 'longposition'
            ? createPositionPoints(firstPoint, 'long')
            : tool === 'shortposition'
              ? createPositionPoints(firstPoint, 'short')
              : tool === 'anchoredvwap'
                ? [createAnchoredVwapPoint(firstPoint)]
                : tool === 'signpost'
                  ? [createSignpostPoint(firstPoint)]
                : [firstPoint]
        const newDrawing = createDrawing({
          id: Date.now().toString(),
          tool,
          points,
          color: DEFAULT_DRAWING_COLOR,
          text: getDefaultTextForTool(tool, firstPoint.price),
          anchored: isAnchoredTextTool(tool),
        })
        const next = [...drawingsRef.current, newDrawing]
        drawingsRef.current = next
        setDrawings(next)
        selectDrawing(newDrawing)
        if (EDITABLE_TEXT_TOOLS.has(tool)) onStartTextEdit?.(newDrawing.id)
        redrawCanvas()
        setActiveTool(null)
        setCursorMode('cross')
        return
      }
      isDrawing.current = true
      drawingPoints.current = [pt]
      redrawCanvas([pt])
    } else if (requiredPoints > 2) {
      const nextPoints = applyPointNormalizers(
        tool,
        [...drawingPoints.current, pt],
        { pointToPixel, pixelToPoint },
      )
      if (nextPoints.length >= requiredPoints) {
        isDrawing.current = false
        const newDrawing = createDrawing({
          id: Date.now().toString(),
          tool,
          points: nextPoints,
          color: DEFAULT_DRAWING_COLOR,
          text: getDefaultTextForTool(tool, nextPoints[0]?.price ?? 0),
          anchored: isAnchoredTextTool(tool),
        })
        const next = [...drawingsRef.current, newDrawing]
        drawingsRef.current = next
        setDrawings(next)
        selectDrawing(newDrawing)
        drawingPoints.current = []
        redrawCanvas()
        setActiveTool(null)
        setCursorMode('cross')
      } else {
        drawingPoints.current = nextPoints
        redrawCanvas(nextPoints)
      }
    } else {
      const firstPoint = drawingPoints.current[0]
      isDrawing.current = false
      const candles = getCandles()

      const rawPoints = tool === 'barspattern'
        ? createBarsPatternSnapshot(firstPoint, pt)
        : [firstPoint, pt]

      const normalizedPoints =
        tool === 'barspattern'
          ? rawPoints
          : tool === 'gannsquarefixed'
          ? normalizeGannSquareFixedPoints(
              tool,
              rawPoints,
              { pointToPixel, pixelToPoint },
            )
          : applyPointNormalizers(
              tool,
              rawPoints,
              { pointToPixel, pixelToPoint },
            )

      const finalPoints = normalizeRegressionTrendPoints(
        tool,
        normalizedPoints,
        candles,
        {
          pointToPixel,
          pixelToPoint,
          logicalToCoordinate: (l) =>
            chartRef.current?.timeScale().logicalToCoordinate(l as unknown as Logical) ?? null,
          priceToCoordinate: (p) =>
            candleRef.current?.priceToCoordinate(p) ?? null,
        },
      )

      const newDrawing = createDrawing({
        id: Date.now().toString(),
        tool,
        points: finalPoints,
        color: DEFAULT_DRAWING_COLOR,
        text: getDefaultTextForTool(tool, finalPoints[0]?.price ?? 0),
        anchored: isAnchoredTextTool(tool),
      })

      const next = [...drawingsRef.current, newDrawing]
      drawingsRef.current = next
      setDrawings(next)
      selectDrawing(newDrawing)
      if (EDITABLE_TEXT_TOOLS.has(tool)) onStartTextEdit?.(newDrawing.id)
      drawingPoints.current = []
      redrawCanvas()
      setActiveTool(null)
      setCursorMode('cross')
    }
  }, [
    activeToolRef, beginDrawingDrag, candleRef, chartRef, createAnchoredVwapPoint, createSignpostPoint, createBarsPatternSnapshot, createDrawing, createPositionPoints, cursorModeRef,
    cancelActiveTool, drawingsLockedRef, drawingsRef, findHitDrawing, finishGhostFeedDrawing, finishPathDrawing, finishPolylineDrawing, getCandles, getChartPoint, overlayRef,
    pixelToPoint, pointToPixel, redrawCanvas, selectDrawing, selectedRef,
    setActiveTool, setCursorMode, setDrawings, setSelected,
    onStartTextEdit,
  ])

  const handleMouseMove = useCallback((
    e: React.MouseEvent<HTMLCanvasElement> | React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    // ── Drag ──
    if (draggingDrawingId.current !== null && dragStartMouse.current) {
      e.preventDefault()
      e.stopPropagation()
      const dx = mx - dragStartMouse.current.x
      const dy = my - dragStartMouse.current.y
      const updated = drawingsRef.current.map(d =>
        d.id !== draggingDrawingId.current ? d : applyDrawingPointDrag(d, dx, dy),
      )
      drawingsRef.current = updated
      setDrawings(updated)
      redrawCanvas()
      return
    }

    const cursor = cursorModeRef.current
    if (cursor === 'cross' || cursor === 'dot') {
      redrawCanvas(isDrawing.current ? [...drawingPoints.current] : undefined)
      return
    }
    if (!isDrawing.current) { redrawCanvas(); return }

    const pt = getChartPoint(e)
    if (!pt) return
    const tool = activeToolRef.current
    const pts = [...drawingPoints.current]
    const requiredPoints = getRequiredPointCount(tool)

    if (FREEHAND_TOOLS.has(tool)) {
      e.preventDefault()
      e.stopPropagation()
      const last = pts.at(-1)
      const lastPx = last ? pointToPixel(last) : null
      const minDistance = tool === 'highlighter' ? 4 : BRUSH_MIN_POINT_DISTANCE
      if (!lastPx || Math.hypot(lastPx.x - mx, lastPx.y - my) >= minDistance) {
        const nextPoints = [...pts, pt]
        drawingPoints.current = nextPoints
        redrawCanvas(nextPoints)
      }
      return
    }

    if (tool === 'ghostfeed') {
      redrawCanvas([...pts, pt])
      return
    }

    if (tool === 'path') {
      redrawCanvas([...pts, pt])
      return
    }

    if (tool === 'polyline') {
      redrawCanvas([...pts, pt])
      return
    }

    if (requiredPoints > 2) {
      redrawCanvas(applyPointNormalizers(tool, [...pts, pt], { pointToPixel, pixelToPoint }))
    } else {
      if (pts.length === 1) pts.push(pt)
      else pts[pts.length - 1] = pt
      drawingPoints.current = pts
      redrawCanvas(tool === 'curve' || tool === 'doublecurve'
        ? applyPointNormalizers(tool, pts, { pointToPixel, pixelToPoint })
        : pts)
    }
  }, [
    activeToolRef, applyDrawingPointDrag, cursorModeRef, drawingsRef,
    getChartPoint, overlayRef, pixelToPoint, pointToPixel, redrawCanvas, setDrawings,
  ])

  const handleMouseUp = useCallback(() => {
    if (draggingDrawingId.current !== null) {
      const final = drawingsRef.current.map(d =>
        d.id === draggingDrawingId.current && d.tool === 'fixedrangevolumeprofile' && d.lineWidth === -999
          ? { ...d, lineWidth: undefined }
          : d,
      )
      drawingsRef.current = final
      setDrawings([...final])
      draggingDrawingId.current = null
      draggingNodeIdx.current   = null
      dragStartMouse.current    = null
      dragStartTextOffset.current = null
      return
    }
    if (FREEHAND_TOOLS.has(activeToolRef.current) && isDrawing.current) {
      finishFreehandDrawing()
      return
    }
    if (activeToolRef.current && isDrawing.current) {
      redrawCanvas([...drawingPoints.current])
    }
  }, [activeToolRef, drawingsRef, finishFreehandDrawing, redrawCanvas, setDrawings])

  const handleMouseLeave = useCallback(() => {
    redrawCanvas()
  }, [redrawCanvas])

  // ── Keyboard shortcuts ───────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableShortcutTarget(e.target)) return
      const sel = selectedRef.current
      if (drawingsLockedRef.current || drawingsHiddenRef.current) return

      const key      = e.key.toLowerCase()
      const isCopy   = (e.ctrlKey || e.metaKey) && (e.code === 'KeyC' || key === 'c')
      const isPaste  = (e.ctrlKey || e.metaKey) && (e.code === 'KeyV' || key === 'v')
      const shortcutTool = getDrawToolShortcut(e)

      if (shortcutTool) {
        e.preventDefault()
        activateDrawTool(shortcutTool)
        return
      }

      if (sel && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        const next = drawingsRef.current.filter(d => d.id !== sel.id)
        drawingsRef.current = next
        setDrawings(next)
        setSelected(null)
        selectedRef.current = null
        redrawCanvas()
      }

      if (sel && isCopy) {
        e.preventDefault()
        const d = drawingsRef.current.find(d => d.id === sel.id)
        if (d) window.__copiedDrawing = cloneDrawing(d)
      }

      if (isPaste) {
        const d = window.__copiedDrawing
        if (!d) return
        e.preventDefault()
        const newD = cloneDrawing(d, 20, 20)
        setSelected(null)
        selectedRef.current = null
        const next = [...drawingsRef.current, newD]
        drawingsRef.current = next
        setDrawings(next)
        selectDrawing(newD)
        redrawCanvas()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [
    activateDrawTool, cloneDrawing, drawingsHiddenRef, drawingsLockedRef,
    drawingsRef, redrawCanvas, selectDrawing, selectedRef, setDrawings, setSelected,
  ])

  // ── Drag state exposed for container-level move handler ─────────────────
  /**
   * Container-level drag handler for cross/dot cursor mode (where the overlay
   * canvas has pointer-events: none and can't receive events directly).
   */
  const handleContainerDrag = useCallback((mx: number, my: number) => {
    if (draggingDrawingId.current === null || !dragStartMouse.current) return false

    const dx = mx - dragStartMouse.current.x
    const dy = my - dragStartMouse.current.y
    const updated = drawingsRef.current.map(d =>
      d.id !== draggingDrawingId.current ? d : applyDrawingPointDrag(d, dx, dy),
    )
    drawingsRef.current = updated
    setDrawings(updated)
    redrawCanvas()
    return true
  }, [applyDrawingPointDrag, drawingsRef, redrawCanvas, setDrawings])

  const isDraggingDrawing = useCallback(() => draggingDrawingId.current !== null, [])

  return {
    // State refs (read-only outside)
    isDrawing,
    drawingPoints,
    draggingDrawingId,

    // Coordinate helpers
    pointToPixel,
    pixelToPoint,

    // Actions
    activateDrawTool,
    selectDrawing,
    cloneDrawing,
    findHitDrawing,
    getDrawingNodeCursor: (drawing: Drawing, nodeIdx: number) => getDrawingNodeCursor(drawing, nodeIdx, pointToPixel),

    // Mouse handlers (attach to overlay canvas)
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,

    // Container-level drag helper (cross/dot mode)
    handleContainerDrag,
    isDraggingDrawing,

    beginDrawingDrag,
    cancelActiveTool,
  }
}
