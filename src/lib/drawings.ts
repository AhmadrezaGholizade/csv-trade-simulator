import type { Drawing, Point } from '../types'
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'

function uuid() {
  return Math.random().toString(36).slice(2, 10)
}

export function createDrawing(tool: Drawing['tool'], points: Point[]): Drawing {
  return { id: uuid(), tool, points, color: '#D8B4A0' }
}

export function renderDrawings(
  drawings: Drawing[],
  canvas: HTMLCanvasElement,
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  pendingTool: Drawing['tool'],
  pendingPoints: Point[],
) {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.floor(rect.width * dpr))
  const h = Math.max(1, Math.floor(rect.height * dpr))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)

  const toXY = (p: Point) => ({
    x: chart.timeScale().timeToCoordinate(p.time as UTCTimestamp),
    y: series.priceToCoordinate(p.price),
  })

  const allDrawings: Drawing[] = [
    ...drawings,
    ...(pendingPoints.length > 0 ? [{ id: '__pending__', tool: pendingTool, points: pendingPoints, color: '#DBD3D8' }] : []),
  ]

  for (const d of allDrawings) {
    const pts = d.points.map(toXY)
    if (pts.some(p => p.x === null || p.y === null)) continue
    const color = d.color ?? '#D8B4A0'
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.setLineDash([])

    if (d.tool === 'hline') drawHLine(ctx, pts[0]!.y!, rect.width, color)
    else if (d.tool === 'trendline' && pts.length >= 2) drawLine(ctx, pts[0], pts[1])
    else if (d.tool === 'fibonacci' && pts.length >= 2) drawFibonacci(ctx, pts[0], pts[1], rect.width, color)
    else if (d.tool === 'rectangle' && pts.length >= 2) drawRect(ctx, pts[0], pts[1], color)
    else if (d.tool === 'pitchfork' && pts.length >= 3) drawPitchfork(ctx, pts[0], pts[1], pts[2], color)
  }
}

function drawHLine(ctx: CanvasRenderingContext2D, y: number, width: number, color: string) {
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.setLineDash([6, 4])
  ctx.moveTo(0, y)
  ctx.lineTo(width, y)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  a: { x: number | null; y: number | null },
  b: { x: number | null; y: number | null },
) {
  if (a.x === null || a.y === null || b.x === null || b.y === null) return
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

function drawFibonacci(
  ctx: CanvasRenderingContext2D,
  a: { x: number | null; y: number | null },
  b: { x: number | null; y: number | null },
  width: number,
  color: string,
) {
  if (a.x === null || a.y === null || b.x === null || b.y === null) return
  const dy = b.y - a.y
  for (const level of FIB_LEVELS) {
    const y = a.y + dy * level
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.globalAlpha = level === 0 || level === 1 ? 1 : 0.6
    ctx.setLineDash([4, 4])
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.font = '10px monospace'
    ctx.fillText(`${(level * 100).toFixed(1)}%`, 6, y - 3)
  }
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  a: { x: number | null; y: number | null },
  b: { x: number | null; y: number | null },
  color: string,
) {
  if (a.x === null || a.y === null || b.x === null || b.y === null) return
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.fillStyle = color.replace(')', ', 0.08)').replace('rgb', 'rgba')
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(b.x - a.x)
  const h = Math.abs(b.y - a.y)
  ctx.fillRect(x, y, w, h)
  ctx.strokeRect(x, y, w, h)
}

function drawPitchfork(
  ctx: CanvasRenderingContext2D,
  a: { x: number | null; y: number | null },
  b: { x: number | null; y: number | null },
  c: { x: number | null; y: number | null },
  color: string,
) {
  if (a.x === null || a.y === null || b.x === null || b.y === null || c.x === null || c.y === null) return
  const midX = (b.x + c.x) / 2
  const midY = (b.y + c.y) / 2
  const dx = midX - a.x
  const dy = midY - a.y

  ctx.strokeStyle = color
  // handle
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(midX, midY); ctx.stroke()
  // left tine
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + dx * 2, b.y + dy * 2); ctx.stroke()
  // right tine
  ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + dx * 2, c.y + dy * 2); ctx.stroke()
}