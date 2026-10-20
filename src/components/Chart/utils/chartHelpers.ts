import type { DrawTool, CursorMode } from '../chartTypes'
import { TickMarkType } from 'lightweight-charts'
import type { Time } from 'lightweight-charts'

const CHANNEL_TOOLS: DrawTool[] = [
  'parallelchannel',
]

const THREE_POINT_TOOLS: DrawTool[] = [
  ...CHANNEL_TOOLS,
  'trendbasedfibextension',
  'fibchannel',
  'trendbasedfibtime',
  'fibwedge',
  'disjointchannel',
  'flattopbottom',
  'pitchfork',
  'schiffpitchfork',
  'modifiedschiffpitchfork',
  'insidepitchfork',
  'triangle',
  'pitchfan',
]

const TOOL_POINT_COUNTS: Partial<Record<NonNullable<DrawTool>, number>> = {
  horizontal: 1,
  horizontalray: 1,
  vertical: 1,
  crossline: 1,
  xabcdpattern: 5,
  cypherpattern: 5,
  headandshoulders: 7,
  abcdpattern: 4,
  trianglepattern: 4,
  threedrivespattern: 7,
  elliottimpulse: 6,
  elliottcorrection: 4,
  elliotttriangle: 5,
  elliottdoublecombo: 4,
  elliotttriplecombo: 6,
  cycliclines: 2,
  timecycles: 2,
  sineline: 2,
  longposition: 1,
  shortposition: 1,
  forecast: 2,
  barspattern: 2,
  projection: 3,
  anchoredvwap: 1,
  fixedrangevolumeprofile: 2,
  pricerange: 2,
  daterange: 2,
  dateandpricerange: 2,
  brush: 4,
  highlighter: 4,
  arrowmarker: 2,
  arrow: 2,
  arrowmarkup: 1,
  arrowmarkdown: 1,
  fibtimezone: 2,
  trendbasedfibtime: 3,
  arrowmarkleft: 1,
  arrowmarkright: 1,
  rotatedrectangle: 3,
  path: 4,
  circle: 2,
  ellipse: 3,
  arc: 3,
  curve: 2,
  doublecurve: 2,
  text: 1,
  anchoredtext: 1,
  note: 2,
  anchorednote: 2,
  callout: 1,
  comment: 1,
  pricelabel: 1,
  signpost: 1,
  flagmark: 1,
}

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}
function padTimePart(value: number) {
  return String(value).padStart(2, '0')
}

function chartTimeToDate(time: Time) {
  if (typeof time === 'number') return new Date(time * 1000)
  if (typeof time === 'string') return new Date(time)
  return new Date(Date.UTC(time.year, time.month - 1, time.day))
}

function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const pick = (type: string) => parts.find(part => part.type === type)?.value ?? '00'
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour') === '24' ? '00' : pick('hour'),
    minute: pick('minute'),
  }
}

function getFixedOffsetParts(date: Date, offsetMinutes: number) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000)
  return {
    year: String(shifted.getUTCFullYear()),
    month: padTimePart(shifted.getUTCMonth() + 1),
    day: padTimePart(shifted.getUTCDate()),
    hour: padTimePart(shifted.getUTCHours()),
    minute: padTimePart(shifted.getUTCMinutes()),
  }
}

function getDisplayParts(date: Date, timeZone: string, fixedOffsetMinutes?: number) {
  return fixedOffsetMinutes == null
    ? getZonedParts(date, timeZone)
    : getFixedOffsetParts(date, fixedOffsetMinutes)
}

function formatChartTime(time: Time, timeZone = 'UTC', fixedOffsetMinutes?: number) {
  const date = chartTimeToDate(time)
  const zoned = getDisplayParts(date, timeZone, fixedOffsetMinutes)
  const gregorian = `${zoned.year}-${zoned.month}-${zoned.day}`
  const clock = `${zoned.hour}:${zoned.minute}`
  const jalali = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)

  return `${gregorian} ${clock} | ${jalali}`
}

function formatTimeAxisTick(time: Time, tickMarkType: TickMarkType, timeZone = 'UTC', fixedOffsetMinutes?: number) {
  const date = chartTimeToDate(time)
  const zoned = getDisplayParts(date, timeZone, fixedOffsetMinutes)

  if (tickMarkType === TickMarkType.Year) {
    return zoned.year
  }

  if (tickMarkType === TickMarkType.Month) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
    }).format(date)
  }

  if (tickMarkType === TickMarkType.DayOfMonth) {
    return String(Number(zoned.day))
  }

  return `${zoned.hour}:${zoned.minute}`
}

function formatPrice(price: number) {
  return Number.isFinite(price) ? price.toFixed(3) : '--'
}

const getRequiredPointCount = (tool: DrawTool) => {
  if (!tool) return 0
  return TOOL_POINT_COUNTS[tool] ?? (THREE_POINT_TOOLS.includes(tool) ? 3 : 2)
}

const getChartCursorClass = (cursorMode: CursorMode, activeTool: DrawTool) => {
  if (cursorMode === 'eraser') return 'sim-chart-cursor-none'
  if (activeTool) return 'sim-chart-cursor-crosshair'
  if (cursorMode === 'cross' || cursorMode === 'dot') return 'sim-chart-cursor-none'
  return 'sim-chart-cursor-default'
}

export { cssVar, padTimePart, CHANNEL_TOOLS, chartTimeToDate, formatChartTime, formatTimeAxisTick, formatPrice, getRequiredPointCount, getChartCursorClass }
