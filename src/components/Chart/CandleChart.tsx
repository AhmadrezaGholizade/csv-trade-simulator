import { isTimeframeAvailable } from '../../api/market'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  createChart,
  CrosshairMode,
  ColorType,
  LineStyle,
  CandlestickSeries,
  HistogramSeries,
  PriceScaleMode,
  TickMarkType,
  createTextWatermark,
} from 'lightweight-charts'
import type {
  IChartApi,
  ISeriesApi,
  ITextWatermarkPluginApi,
  CandlestickData,
  LogicalRange,
  Time,
} from 'lightweight-charts'
import { useSimStore } from '../../store/simStore'
import { useCandles } from '../../hooks/useCandles'
import type { Candle, OrderPriceField, PendingOrder, Trade } from '../../types'
import type { CursorMode, Drawing, DrawTool, IndicatorSeries, Point, SelectedDrawing } from './chartTypes'
import { INDICATORS, createIndicatorSeries, refreshIndicatorSeries, removeIndicatorSeries } from './chartIndicators'
import { renderDrawings } from './drawingRenderer'
import { coordinateToAnchoredTime, timeToAnchoredCoordinate } from './utils/drawingCoordinates'
import { Ico } from './toolbar/drawingIcons'
import { chartButtonStyles as css } from './toolbar/ChartToolButtons'
import { ChartSideToolbar } from './toolbar/ChartSideToolbar'

import {
  TOOL_GROUPS,
  getGroupTools,
  ALL_DRAW_TOOLS,
} from './toolbar/toolRegistry'
import {
  getDrawToolShortcut,
  isEditableShortcutTarget,
} from './toolbar/toolShortcuts'
import { cssVar, CHANNEL_TOOLS, formatChartTime, formatTimeAxisTick, formatPrice, getRequiredPointCount, getChartCursorClass } from './utils/chartHelpers'
import {
  getDraftLimitPrice,
  getPlannedOpenPrice,
  parsePrice,
  validateOrderPriceField,
} from '../../lib/orderValidation'
import { formatSymbolPrice, getSymbolMinMove, getSymbolPricePrecision, roundSymbolPrice } from '../../lib/symbolPrice'
import {
  CHART_LAYOUT_STORAGE_KEY,
  MIN_PLAYBACK_INTERVAL_MS,
  ZOOM,
} from './utils/chartConstants'
import { useDrawingInteraction } from './utils/useDrawingInteraction'
import { simplifyFreehandDrawingPoints } from './utils/freehandSimplify'
import {
  ChartSettingsColorPopover,
  PRECISION_OPTIONS,
  SettingsArrowDownIcon,
  SettingsCanvasIcon,
  SettingsGearIcon,
  SettingsSymbolIcon,
  colorWithOpacity,
  getSettingsPriceFormat,
} from './settings/chartSettings'
import type { ChartSettingsTab, SettingsColorSlot, SettingsPrecision } from './settings/chartSettings'
import { CANDLE_SIZE_GROUPS, CANDLE_SIZE_OPTIONS } from './settings/candleSizes'
import { SettingsDropdownPortal } from './settings/SettingsDropdownPortal'
import { DrawingSettingsPanel } from './settings/DrawingSettingsPanel'
import { getDrawingSettingsPanelWidth } from './settings/drawingSettingsRegistry'
import {
  IndicatorLegendRow,
  PaneIndicatorLegend,
} from './indicators/IndicatorLegend'
import {
  getIndicatorLegendValues,
  getIndicatorPaneTarget,
} from './indicators/indicatorLegendUtils'
import { CanvasSettingsPanel } from './settings/CanvasSettingsPanel'
import {
  DEFAULT_CHART_CANVAS_SETTINGS,
  loadChartCanvasSettings,
  saveChartCanvasSettings,
} from './settings/canvasSettings'
import type { CanvasLineStyle, ChartCanvasSettings } from './settings/canvasSettings'
import { getSymbolIcons } from '../../lib/symbolIcons'
import cameraSvg from '../../assets/icons/chart/camera.svg?raw'


declare global {
  interface Window {
    __copiedDrawing?: Drawing
  }
}

type TradeLineTarget =
  | { kind: 'trade'; id: string; field: 'entry' | 'sl' | 'tp' }
  | { kind: 'pending'; id: string; field: 'entryPrice' | 'limitPrice' | 'sl' | 'tp' }

const MAX_LIGHTWEIGHT_CHART_VALUE = Number.MAX_SAFE_INTEGER / 100
const toChartHistogramValue = (value: number | null | undefined) => {
  const next = Number(value ?? 0)
  if (!Number.isFinite(next) || next <= 0) return 0
  return Math.min(next, MAX_LIGHTWEIGHT_CHART_VALUE)
}

type PendingTradeLineUpdate =
  | { kind: 'trade'; id: string; levels: Partial<Pick<Trade, 'sl' | 'tp'>> }
  | { kind: 'pending'; id: string; updates: Partial<PendingOrder> }

interface ChartSettingsSnapshot {
  canvas: ChartCanvasSettings
  colorBarsPreviousClose: boolean
  precision: SettingsPrecision
  timeZone: string
  bodyVisible: boolean
  bordersVisible: boolean
  wickVisible: boolean
  colors: Record<SettingsColorSlot, string>
  colorOpacity: Record<SettingsColorSlot, number>
}

type PriceLineLabelSide = 'right' | 'left'
type PriceLineLabelPosition = 'center' | 'above'
type ModalKey = 'indicators' | 'settings' | 'goto'
type ModalPosition = { left: number; top: number }
type FloatingMenuPosition = { left: number; top: number; width: number; maxHeight: number }

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
const CHART_COLORS = {
  bg: '#ffffff',
  grid: 'rgba(34,56,67,0.08)',
  axis: 'rgba(34,56,67,0.12)',
  text: '#131722',
}

const BACKFILL_LOGICAL_THRESHOLD = 1500
const PRUNE_LEADING_BUFFER = 2000
const PRUNE_MIN_REMOVE = 750
const EDITABLE_TEXT_TOOLS = new Set<DrawTool>(['text', 'anchoredtext', 'note', 'anchorednote', 'callout', 'comment', 'signpost'])
const SCREEN_ANCHORED_TEXT_TOOLS = new Set<DrawTool>(['anchoredtext', 'anchorednote'])
const TIMEFRAME_MENU_WIDTH = 188

const CameraIcon = (
  <span
    className="sim-chart-camera-icon"
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: cameraSvg }}
  />
)

const DownloadImageIcon = (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M10 3v9" />
    <path d="m6.5 8.5 3.5 3.5 3.5-3.5" />
    <path d="M3.5 13.5v2a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </svg>
)

const TimeframeChevronIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
    <path fill="currentColor" d="m4.67 10.62.66.76L9 8.16l3.67 3.22.66-.76L9 6.84l-4.33 3.78Z"></path>
  </svg>
)

const CopyImageIcon = (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="6" y="4" width="11" height="11" rx="1.5" />
    <path d="M3 7.5v7A2.5 2.5 0 0 0 5.5 17h7" />
  </svg>
)

const ScrollForwardIcon = (
  <svg viewBox="0 0 70 70" width="22" height="22" fill="currentColor" aria-hidden="true">
    <path d="M34.779,7c2.433,0,4.634,1.614,5.212,4.005l11.386,23.299h0.036l-0.019,0.066l0.019,0.066h-0.036L39.991,58.994 C39.413,61.385,37.211,63,34.777,63c-0.404,0-0.814-0.045-1.225-0.138c-2.882-0.654-4.671-3.441-3.998-6.23L40.332,34.37 L29.555,13.366c-0.673-2.787,1.116-5.576,3.998-6.229C33.963,7.044,34.375,7,34.779,7 M34.779,3c-0.708,0-1.419,0.079-2.11,0.236 c-2.476,0.561-4.565,2.042-5.888,4.171c-1.291,2.079-1.687,4.528-1.115,6.897c0.075,0.308,0.186,0.605,0.33,0.888l9.867,19.229 l-9.909,20.467c-0.124,0.258-0.221,0.527-0.288,0.805c-0.571,2.369-0.176,4.818,1.114,6.896c1.321,2.129,3.411,3.611,5.89,4.174 C33.361,66.92,34.07,67,34.777,67c4.199,0,7.832-2.705,8.985-6.631l11.036-23.803c0.437-0.694,0.647-1.502,0.609-2.313 c-0.013-0.711-0.219-1.411-0.594-2.025L43.75,9.585C42.581,5.684,38.962,3,34.779,3L34.779,3z" />
    <path d="M44.693,30.813l-5-10c-0.247-0.494-0.047-1.095,0.447-1.342c0.496-0.245,1.096-0.047,1.342,0.447l5,10 c0.247,0.494,0.047,1.095-0.447,1.342c-0.144,0.071-0.297,0.105-0.446,0.105C45.222,31.365,44.869,31.163,44.693,30.813z M37.693,16.813l-1-2c-0.247-0.494-0.047-1.095,0.447-1.342c0.494-0.246,1.096-0.047,1.342,0.447l1,2 c0.247,0.494,0.047,1.095-0.447,1.342c-0.144,0.071-0.297,0.105-0.446,0.105C38.222,17.365,37.869,17.163,37.693,16.813z" />
    <path d="M22.588,31.325c2.209,0,4,1.791,4,4s-1.791,4-4,4s-4-1.791-4-4S20.379,31.325,22.588,31.325 M22.588,27.325 c-4.411,0-8,3.589-8,8s3.589,8,8,8s8-3.589,8-8S26.999,27.325,22.588,27.325L22.588,27.325z" />
  </svg>
)

const FullscreenIcon = (
  <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" viewBox="0 0 31.812 31.906" width="17" height="17" aria-hidden="true">
    <path d="M31.728,31.291 C31.628,31.535 31.434,31.729 31.190,31.830 C31.069,31.881 30.940,31.907 30.811,31.907 L23.851,31.907 C23.301,31.907 22.856,31.461 22.856,30.910 C22.856,30.359 23.301,29.913 23.851,29.913 L28.405,29.908 L19.171,20.646 C18.782,20.257 18.782,19.626 19.171,19.236 C19.559,18.847 20.188,18.847 20.577,19.236 L29.906,28.593 L29.906,23.906 C29.906,23.355 30.261,22.933 30.811,22.933 C31.360,22.933 31.805,23.379 31.805,23.930 L31.805,30.910 C31.805,31.040 31.779,31.169 31.728,31.291 ZM30.811,8.973 C30.261,8.973 29.906,8.457 29.906,7.906 L29.906,3.313 L20.577,12.669 C20.382,12.864 20.128,12.962 19.874,12.962 C19.619,12.962 19.365,12.864 19.171,12.669 C18.782,12.280 18.782,11.649 19.171,11.259 L28.497,1.906 L23.906,1.906 C23.356,1.906 22.856,1.546 22.856,0.996 C22.856,0.445 23.301,-0.001 23.851,-0.001 L30.811,-0.001 C30.811,-0.001 30.811,-0.001 30.812,-0.001 C30.941,-0.001 31.069,0.025 31.190,0.076 C31.434,0.177 31.628,0.371 31.728,0.615 C31.779,0.737 31.805,0.866 31.805,0.996 L31.805,7.976 C31.805,8.526 31.360,8.973 30.811,8.973 ZM3.387,29.908 L7.942,29.913 C8.492,29.913 8.936,30.359 8.936,30.910 C8.936,31.461 8.492,31.907 7.942,31.907 L0.982,31.907 C0.853,31.907 0.724,31.881 0.602,31.830 C0.359,31.729 0.165,31.535 0.064,31.291 C0.014,31.169 -0.012,31.040 -0.012,30.910 L-0.012,23.930 C-0.012,23.379 0.433,22.933 0.982,22.933 C1.532,22.933 1.906,23.355 1.906,23.906 L1.906,28.573 L11.216,19.236 C11.605,18.847 12.234,18.847 12.622,19.236 C13.011,19.626 13.011,20.257 12.622,20.646 L3.387,29.908 ZM11.919,12.962 C11.665,12.962 11.410,12.864 11.216,12.669 L1.906,3.332 L1.906,7.906 C1.906,8.457 1.532,8.973 0.982,8.973 C0.433,8.973 -0.012,8.526 -0.012,7.976 L-0.012,0.996 C-0.012,0.866 0.014,0.737 0.064,0.615 C0.165,0.371 0.359,0.177 0.602,0.076 C0.723,0.025 0.852,-0.001 0.980,-0.001 C0.981,-0.001 0.981,-0.001 0.982,-0.001 L7.942,-0.001 C8.492,-0.001 8.936,0.445 8.936,0.996 C8.936,1.546 8.456,1.906 7.906,1.906 L3.296,1.906 L12.622,11.259 C13.011,11.649 13.011,12.280 12.622,12.669 C12.428,12.864 12.174,12.962 11.919,12.962 Z" />
  </svg>
)

const ActualSizeIcon = (
  <svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" viewBox="0 0 31.812 31.906" width="17" height="17" aria-hidden="true">
    <path d="M23.263,9.969 L27.823,9.969 C28.372,9.969 28.817,10.415 28.817,10.966 C28.817,11.516 28.456,11.906 27.906,11.906 L21.154,11.906 C21.058,11.935 20.962,11.963 20.863,11.963 C20.608,11.963 20.354,11.865 20.160,11.671 C19.916,11.426 19.843,11.088 19.906,10.772 L19.906,3.906 C19.906,3.355 20.313,2.989 20.863,2.989 C21.412,2.989 21.857,3.435 21.857,3.986 L21.857,8.559 L30.103,0.289 C30.491,-0.100 31.120,-0.100 31.509,0.289 C31.897,0.679 31.897,1.310 31.509,1.699 L23.263,9.969 ZM11.914,27.917 C11.914,28.468 11.469,28.914 10.920,28.914 C10.370,28.914 9.926,28.468 9.926,27.917 L9.926,23.344 L1.680,31.613 C1.486,31.808 1.231,31.906 0.977,31.906 C0.723,31.906 0.468,31.808 0.274,31.613 C-0.114,31.224 -0.114,30.593 0.274,30.203 L8.520,21.934 L3.960,21.934 C3.410,21.934 2.966,21.488 2.966,20.937 C2.966,20.386 3.410,19.940 3.960,19.940 L10.920,19.940 C10.920,19.940 10.921,19.940 10.921,19.940 C11.050,19.940 11.179,19.967 11.300,20.017 C11.543,20.118 11.737,20.312 11.838,20.556 C11.888,20.678 11.914,20.807 11.914,20.937 L11.914,27.917 ZM10.920,11.963 C10.821,11.963 10.724,11.935 10.629,11.906 L3.906,11.906 C3.356,11.906 2.966,11.516 2.966,10.966 C2.966,10.415 3.410,9.969 3.960,9.969 L8.520,9.969 L0.274,1.699 C-0.114,1.310 -0.114,0.679 0.274,0.289 C0.662,-0.100 1.292,-0.100 1.680,0.289 L9.926,8.559 L9.926,3.986 C9.926,3.435 10.370,2.989 10.920,2.989 C11.469,2.989 11.914,3.435 11.914,3.986 L11.914,10.965 C11.914,11.221 11.817,11.476 11.623,11.671 C11.429,11.865 11.174,11.963 10.920,11.963 ZM20.174,20.222 C20.345,20.047 20.585,19.940 20.863,19.940 L27.823,19.940 C28.372,19.940 28.817,20.386 28.817,20.937 C28.817,21.488 28.372,21.934 27.823,21.934 L23.263,21.934 L31.509,30.203 C31.897,30.593 31.897,31.224 31.509,31.613 C31.314,31.808 31.060,31.906 30.806,31.906 C30.551,31.906 30.297,31.808 30.103,31.613 L21.857,23.344 L21.857,27.917 C21.857,28.468 21.412,28.914 20.863,28.914 C20.313,28.914 19.906,28.457 19.906,27.906 L19.906,21.130 C19.843,20.815 19.916,20.477 20.160,20.232 C20.164,20.228 20.170,20.227 20.174,20.222 Z" />
  </svg>
)

const GoToIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="20" height="20" aria-hidden="true">
    <path fill="currentColor" fillRule="evenodd" d="M11 4h-1v2H7.5A2.5 2.5 0 0 0 5 8.5V13h1v-2h16v8.5c0 .83-.67 1.5-1.5 1.5H14v1h6.5a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 20.5 6H18V4h-1v2h-6V4Zm6 4V7h-6v1h-1V7H7.5C6.67 7 6 7.67 6 8.5V10h16V8.5c0-.83-.67-1.5-1.5-1.5H18v1h-1Zm-5.15 10.15-3.5-3.5-.7.7L10.29 18H4v1h6.3l-2.65 2.65.7.7 3.5-3.5.36-.35-.36-.35Z" />
  </svg>
)

type TimeZoneOption = {
  label: string
  zone: string
  group?: 'major' | 'exchange'
}

const TIMEZONE_OPTIONS: TimeZoneOption[] = [
  { label: 'UTC', zone: 'UTC', group: 'major' },
  { label: '(UTC+3:30) Tehran', zone: 'Asia/Tehran', group: 'major' },
  { label: '(UTC-4) New York', zone: 'America/New_York', group: 'major' },
  { label: '(UTC+8) Hong Kong', zone: 'Asia/Hong_Kong', group: 'major' },
  { label: '(UTC+8) Shanghai', zone: 'Asia/Shanghai', group: 'major' },
  { label: '(UTC+9) Tokyo', zone: 'Asia/Tokyo', group: 'major' },
  { label: '(UTC+1) London', zone: 'Europe/London', group: 'major' },
  { label: '(UTC+2) Berlin', zone: 'Europe/Berlin', group: 'major' },
  { label: '(UTC+4) Dubai', zone: 'Asia/Dubai', group: 'major' },
  { label: '(UTC+5:30) Kolkata', zone: 'Asia/Kolkata', group: 'major' },
  { label: '(UTC-10) Honolulu', zone: 'Pacific/Honolulu', group: 'exchange' },
  { label: '(UTC-8) Anchorage', zone: 'America/Anchorage', group: 'exchange' },
  { label: '(UTC-8) Juneau', zone: 'America/Juneau', group: 'exchange' },
  { label: '(UTC-7) Los Angeles', zone: 'America/Los_Angeles', group: 'exchange' },
  { label: '(UTC-7) Phoenix', zone: 'America/Phoenix', group: 'exchange' },
  { label: '(UTC-7) Vancouver', zone: 'America/Vancouver', group: 'exchange' },
  { label: '(UTC-6) Denver', zone: 'America/Denver', group: 'exchange' },
  { label: '(UTC-6) Mexico City', zone: 'America/Mexico_City', group: 'exchange' },
  { label: '(UTC-6) San Salvador', zone: 'America/El_Salvador', group: 'exchange' },
  { label: '(UTC-5) Bogota', zone: 'America/Bogota', group: 'exchange' },
  { label: '(UTC-5) Chicago', zone: 'America/Chicago', group: 'exchange' },
  { label: '(UTC-5) Lima', zone: 'America/Lima', group: 'exchange' },
  { label: '(UTC-4) Caracas', zone: 'America/Caracas', group: 'exchange' },
  { label: '(UTC-4) Santiago', zone: 'America/Santiago', group: 'exchange' },
  { label: '(UTC-4) Toronto', zone: 'America/Toronto', group: 'exchange' },
  { label: '(UTC-3) Buenos Aires', zone: 'America/Argentina/Buenos_Aires', group: 'exchange' },
  { label: '(UTC-3) Sao Paulo', zone: 'America/Sao_Paulo', group: 'exchange' },
  { label: '(UTC) Reykjavik', zone: 'Atlantic/Reykjavik', group: 'exchange' },
  { label: '(UTC+1) Casablanca', zone: 'Africa/Casablanca', group: 'exchange' },
  { label: '(UTC+1) Dublin', zone: 'Europe/Dublin', group: 'exchange' },
  { label: '(UTC+1) Lagos', zone: 'Africa/Lagos', group: 'exchange' },
  { label: '(UTC+1) Lisbon', zone: 'Europe/Lisbon', group: 'exchange' },
  { label: '(UTC+1) Tunis', zone: 'Africa/Tunis', group: 'exchange' },
  { label: '(UTC+2) Amsterdam', zone: 'Europe/Amsterdam', group: 'exchange' },
  { label: '(UTC+2) Belgrade', zone: 'Europe/Belgrade', group: 'exchange' },
  { label: '(UTC+2) Bratislava', zone: 'Europe/Bratislava', group: 'exchange' },
  { label: '(UTC+2) Brussels', zone: 'Europe/Brussels', group: 'exchange' },
  { label: '(UTC+2) Budapest', zone: 'Europe/Budapest', group: 'exchange' },
  { label: '(UTC+2) Copenhagen', zone: 'Europe/Copenhagen', group: 'exchange' },
  { label: '(UTC+2) Johannesburg', zone: 'Africa/Johannesburg', group: 'exchange' },
  { label: '(UTC+2) Luxembourg', zone: 'Europe/Luxembourg', group: 'exchange' },
  { label: '(UTC+2) Madrid', zone: 'Europe/Madrid', group: 'exchange' },
  { label: '(UTC+2) Malta', zone: 'Europe/Malta', group: 'exchange' },
  { label: '(UTC+2) Oslo', zone: 'Europe/Oslo', group: 'exchange' },
  { label: '(UTC+2) Paris', zone: 'Europe/Paris', group: 'exchange' },
  { label: '(UTC+2) Prague', zone: 'Europe/Prague', group: 'exchange' },
  { label: '(UTC+2) Rome', zone: 'Europe/Rome', group: 'exchange' },
  { label: '(UTC+2) Stockholm', zone: 'Europe/Stockholm', group: 'exchange' },
  { label: '(UTC+2) Vienna', zone: 'Europe/Vienna', group: 'exchange' },
  { label: '(UTC+2) Warsaw', zone: 'Europe/Warsaw', group: 'exchange' },
  { label: '(UTC+2) Zurich', zone: 'Europe/Zurich', group: 'exchange' },
  { label: '(UTC+3) Athens', zone: 'Europe/Athens', group: 'exchange' },
  { label: '(UTC+3) Bahrain', zone: 'Asia/Bahrain', group: 'exchange' },
  { label: '(UTC+3) Bucharest', zone: 'Europe/Bucharest', group: 'exchange' },
  { label: '(UTC+3) Cairo', zone: 'Africa/Cairo', group: 'exchange' },
  { label: '(UTC+3) Helsinki', zone: 'Europe/Helsinki', group: 'exchange' },
  { label: '(UTC+3) Istanbul', zone: 'Europe/Istanbul', group: 'exchange' },
  { label: '(UTC+3) Jerusalem', zone: 'Asia/Jerusalem', group: 'exchange' },
  { label: '(UTC+3) Kuwait', zone: 'Asia/Kuwait', group: 'exchange' },
  { label: '(UTC+3) Moscow', zone: 'Europe/Moscow', group: 'exchange' },
  { label: '(UTC+3) Nairobi', zone: 'Africa/Nairobi', group: 'exchange' },
  { label: '(UTC+3) Nicosia', zone: 'Asia/Nicosia', group: 'exchange' },
  { label: '(UTC+3) Qatar', zone: 'Asia/Qatar', group: 'exchange' },
  { label: '(UTC+3) Riga', zone: 'Europe/Riga', group: 'exchange' },
  { label: '(UTC+3) Riyadh', zone: 'Asia/Riyadh', group: 'exchange' },
  { label: '(UTC+3) Tallinn', zone: 'Europe/Tallinn', group: 'exchange' },
  { label: '(UTC+3) Vilnius', zone: 'Europe/Vilnius', group: 'exchange' },
  { label: '(UTC+4) Muscat', zone: 'Asia/Muscat', group: 'exchange' },
  { label: '(UTC+5) Ashgabat', zone: 'Asia/Ashgabat', group: 'exchange' },
  { label: '(UTC+5) Astana', zone: 'Asia/Almaty', group: 'exchange' },
  { label: '(UTC+5) Karachi', zone: 'Asia/Karachi', group: 'exchange' },
  { label: '(UTC+5:30) Colombo', zone: 'Asia/Colombo', group: 'exchange' },
  { label: '(UTC+5:45) Kathmandu', zone: 'Asia/Kathmandu', group: 'exchange' },
  { label: '(UTC+6) Dhaka', zone: 'Asia/Dhaka', group: 'exchange' },
  { label: '(UTC+6:30) Yangon', zone: 'Asia/Yangon', group: 'exchange' },
  { label: '(UTC+7) Bangkok', zone: 'Asia/Bangkok', group: 'exchange' },
  { label: '(UTC+7) Ho Chi Minh', zone: 'Asia/Ho_Chi_Minh', group: 'exchange' },
  { label: '(UTC+7) Jakarta', zone: 'Asia/Jakarta', group: 'exchange' },
  { label: '(UTC+8) Chongqing', zone: 'Asia/Shanghai', group: 'exchange' },
  { label: '(UTC+8) Kuala Lumpur', zone: 'Asia/Kuala_Lumpur', group: 'exchange' },
  { label: '(UTC+8) Manila', zone: 'Asia/Manila', group: 'exchange' },
  { label: '(UTC+8) Perth', zone: 'Australia/Perth', group: 'exchange' },
  { label: '(UTC+8) Singapore', zone: 'Asia/Singapore', group: 'exchange' },
  { label: '(UTC+8) Taipei', zone: 'Asia/Taipei', group: 'exchange' },
  { label: '(UTC+9) Seoul', zone: 'Asia/Seoul', group: 'exchange' },
  { label: '(UTC+9:30) Adelaide', zone: 'Australia/Adelaide', group: 'exchange' },
  { label: '(UTC+10) Brisbane', zone: 'Australia/Brisbane', group: 'exchange' },
  { label: '(UTC+10) Sydney', zone: 'Australia/Sydney', group: 'exchange' },
  { label: '(UTC+11) Norfolk Island', zone: 'Pacific/Norfolk', group: 'exchange' },
  { label: '(UTC+12) New Zealand', zone: 'Pacific/Auckland', group: 'exchange' },
  { label: '(UTC+12:45) Chatham Islands', zone: 'Pacific/Chatham', group: 'exchange' },
  { label: '(UTC+13) Tokelau', zone: 'Pacific/Fakaofo', group: 'exchange' },
]

function getTimeZoneOption(zone: string) {
  return TIMEZONE_OPTIONS.find(item => item.zone === zone) ?? TIMEZONE_OPTIONS[0]
}

function formatUtcClock(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function parseTimeZoneOffsetMinutes(label: string) {
  if (label === 'UTC' || label.startsWith('(UTC)')) return 0
  const match = /^\(UTC([+-])(\d{1,2})(?::(\d{2}))?\)/.exec(label)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? '0')
  return sign * (hours * 60 + minutes)
}

function formatOffsetClock(date: Date, offsetMinutes: number) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
}

function formatDateInput(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function formatTimeInput(value?: string) {
  if (!value) return '00:00'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '00:00'
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

function formatCalendarDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
  return date
}

function getMonthCalendar(year: number, month: number) {
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingEmpty = (firstDay.getDay() + 6) % 7
  return [
    ...Array.from({ length: leadingEmpty }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1)),
  ]
}

function getSymbolPriceFormat(symbol: string) {
  return {
    type: 'price' as const,
    precision: getSymbolPricePrecision(symbol),
    minMove: getSymbolMinMove(symbol),
  }
}

function getCanvasLineStyle(style: CanvasLineStyle) {
  if (style === 'dashed') return LineStyle.Dashed
  if (style === 'dotted') return LineStyle.Dotted
  return LineStyle.Solid
}

function getCanvasLineDash(style: CanvasLineStyle) {
  if (style === 'dashed') return [6, 4]
  if (style === 'dotted') return [2, 3]
  return []
}

function getCanvasBackground(settings: ChartCanvasSettings) {
  if (settings.backgroundType === 'gradient') {
    return {
      type: ColorType.VerticalGradient as const,
      topColor: colorWithOpacity(settings.backgroundTopColor, settings.backgroundTopOpacity),
      bottomColor: colorWithOpacity(settings.backgroundBottomColor, settings.backgroundBottomOpacity),
    }
  }
  return {
    type: ColorType.Solid as const,
    color: colorWithOpacity(settings.backgroundTopColor, settings.backgroundTopOpacity),
  }
}

interface CanvasRgbColor {
  r: number
  g: number
  b: number
}

const CANVAS_LIGHT_TEXT = '#f5f7fa'

function parseCanvasColor(color: string): CanvasRgbColor {
  const hex = color.trim().replace(/^#/, '')
  const full = hex.length === 3 ? hex.split('').map(part => part + part).join('') : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return { r: 255, g: 255, b: 255 }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

function compositeCanvasColor(foreground: CanvasRgbColor, background: CanvasRgbColor, opacity: number) {
  const alpha = Math.min(100, Math.max(0, opacity)) / 100
  return {
    r: Math.round(foreground.r * alpha + background.r * (1 - alpha)),
    g: Math.round(foreground.g * alpha + background.g * (1 - alpha)),
    b: Math.round(foreground.b * alpha + background.b * (1 - alpha)),
  }
}

function getCanvasColorLuminance(color: CanvasRgbColor) {
  const linearChannel = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linearChannel(color.r)
    + 0.7152 * linearChannel(color.g)
    + 0.0722 * linearChannel(color.b)
}

function getCanvasUiPalette(settings: ChartCanvasSettings) {
  const brightCanvas = { r: 255, g: 255, b: 255 }
  const compositeOnBrightCanvas = (color: string, opacity: number) => (
    compositeCanvasColor(parseCanvasColor(color), brightCanvas, opacity)
  )
  const top = compositeOnBrightCanvas(settings.backgroundTopColor, settings.backgroundTopOpacity)
  const bottom = settings.backgroundType === 'gradient'
    ? compositeOnBrightCanvas(settings.backgroundBottomColor, settings.backgroundBottomOpacity)
    : top
  const background = {
    r: Math.round((top.r + bottom.r) / 2),
    g: Math.round((top.g + bottom.g) / 2),
    b: Math.round((top.b + bottom.b) / 2),
  }
  const luminance = getCanvasColorLuminance(background)

  return {
    background: `rgb(${background.r}, ${background.g}, ${background.b})`,
    foreground: luminance < 0.19 ? CANVAS_LIGHT_TEXT : '#131722',
    backgroundColor: background,
    luminance,
  }
}

function ensureCanvasTextContrast(settings: ChartCanvasSettings): ChartCanvasSettings {
  const palette = getCanvasUiPalette(settings)
  const visibleTextColor = compositeCanvasColor(
    parseCanvasColor(settings.scaleTextColor),
    palette.backgroundColor,
    settings.scaleTextOpacity,
  )
  const textLuminance = getCanvasColorLuminance(visibleTextColor)
  const lighter = Math.max(textLuminance, palette.luminance)
  const darker = Math.min(textLuminance, palette.luminance)
  const contrastRatio = (lighter + 0.05) / (darker + 0.05)
  if (contrastRatio >= 4.5) return settings

  return {
    ...settings,
    scaleTextColor: palette.foreground,
    scaleTextOpacity: 100,
  }
}

function formatStatusPrice(symbol: string, precision: SettingsPrecision, value: number) {
  if (precision === 'integer') return value.toFixed(0)
  if (precision.startsWith('decimal-')) return value.toFixed(Number(precision.replace('decimal-', '')))
  return formatSymbolPrice(symbol, value)
}

function getTimeframeMinutes(timeframe: string) {
  const match = /^(\d+)(m|h|d|w)$/.exec(timeframe)
  if (!match) return 5
  const value = Number(match[1])
  const unit = match[2]
  if (unit === 'm') return value
  if (unit === 'h') return value * 60
  if (unit === 'd') return value * 1440
  return value * 10080
}

function drawSessionBreaks(
  canvas: HTMLCanvasElement,
  chart: IChartApi | null,
  candles: Candle[],
  timeframe: string,
  settings: ChartCanvasSettings,
) {
  if (!settings.sessionBreaksVisible || !chart || candles.length < 2) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const expectedMs = getTimeframeMinutes(timeframe) * 60_000
  const minBreakMs = getTimeframeMinutes(timeframe) >= 1440
    ? expectedMs * 1.5
    : Math.max(expectedMs * 3, 6 * 60 * 60_000)
  const plotHeight = Math.max(0, canvas.height - (chart.timeScale().height() ?? 0))

  ctx.save()
  ctx.strokeStyle = colorWithOpacity(settings.sessionBreakColor, settings.sessionBreakOpacity)
  ctx.lineWidth = settings.sessionBreakWidth
  ctx.setLineDash(getCanvasLineDash(settings.sessionBreakStyle))

  for (let index = 1; index < candles.length; index += 1) {
    const previousTime = new Date(candles[index - 1].ts).getTime()
    const currentTime = new Date(candles[index].ts).getTime()
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) continue
    if (currentTime - previousTime <= minBreakMs) continue

    const time = (currentTime / 1000) as Time
    const x = chart.timeScale().timeToCoordinate(time)
    if (x == null) continue

    const alignedX = Math.round(x) + 0.5
    ctx.beginPath()
    ctx.moveTo(alignedX, 0)
    ctx.lineTo(alignedX, plotHeight)
    ctx.stroke()
  }

  ctx.restore()
}

export default function CandleChart() {
  const { loading, error, loadPrevious, hasMore } = useCandles()
  const rootRef       = useRef<HTMLDivElement>(null)
  const containerRef  = useRef<HTMLDivElement>(null)
  const overlayRef    = useRef<HTMLCanvasElement>(null)
  const chartRef      = useRef<IChartApi | null>(null)
  const candleRef     = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef     = useRef<ISeriesApi<'Histogram'> | null>(null)
  const watermarkRef  = useRef<ITextWatermarkPluginApi<Time> | null>(null)
  const loadPreviousRef = useRef(loadPrevious)
  const timeframeButtonRef = useRef<HTMLButtonElement | null>(null)

  // Drawing state
  const [activeTool, setActiveTool]   = useState<DrawTool>(null)
  const [drawings, setDrawings]       = useState<Drawing[]>(() => {
    try {
      const saved = localStorage.getItem(CHART_LAYOUT_STORAGE_KEY)
      if (!saved) return []
      const parsed = JSON.parse(saved) as { drawings?: Array<Omit<Drawing, 'tool'> & { tool: string }> }
      return Array.isArray(parsed.drawings)
        ? parsed.drawings.filter(drawing => drawing.tool !== 'pricenote') as Drawing[]
        : []
    } catch {
      return []
    }
  })
  const [drawingsLocked, setDrawingsLocked] = useState(false)
  const [drawingsHidden, setDrawingsHidden] = useState(false)
  const drawingsRef                   = useRef<Drawing[]>([])
  const drawingsLockedRef             = useRef(false)
  const drawingsHiddenRef             = useRef(false)
  const activeToolRef                 = useRef<DrawTool>(null)
  const redrawCanvasRef               = useRef<(() => void) | null>(null)
  const mousePos                      = useRef<{ x: number; y: number } | null>(null)

  const [cursorMode, setCursorMode]   = useState<CursorMode>('cross')
  const cursorModeRef                 = useRef<CursorMode>('cross')
  const [axisCursor, setAxisCursor]    = useState<'ns-resize' | 'ew-resize' | null>(null)
  const [drawingNodeCursor, setDrawingNodeCursor] = useState<'default' | 'ns-resize' | 'ew-resize' | null>(null)
  const [priceScaleMode, setPriceScaleMode] = useState<'regular' | 'percent' | 'log'>('regular')
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(true)
  const [utcClock, setUtcClock] = useState(() => formatUtcClock(new Date()))
  const [chartTimeZone, setChartTimeZone] = useState('UTC')
  const autoScaleEnabledRef = useRef(true)
  const previousFeedVisibleIndex = useRef<number | null>(null)
  const previousFeedFirstTs = useRef<string | null>(null)
  const pendingPrunedFrontCount = useRef(0)

  // Toolbar open panel state (only one panel open at a time)
  const [openPanel, setOpenPanel]     = useState<string | null>(null)
  const [indicatorSearch, setIndicatorSearch] = useState('')
  const [showTradeHistory, setShowTradeHistory] = useState(true)
  const [showScrollForward, setShowScrollForward] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [goToDateInput, setGoToDateInput] = useState('')
  const [goToTimeInput, setGoToTimeInput] = useState('00:00')
  const [drawingDragGestureLocked, setDrawingDragGestureLocked] = useState(false)
  const [chartSettingsTab, setChartSettingsTab] = useState<ChartSettingsTab>('symbol')
  const [settingsTemplateOpen, setSettingsTemplateOpen] = useState(false)
  const [settingsPrecisionOpen, setSettingsPrecisionOpen] = useState(false)
  const [settingsTimezoneOpen, setSettingsTimezoneOpen] = useState(false)
  const [precisionAnchor, setPrecisionAnchor] = useState<HTMLButtonElement | null>(null)
  const [timezoneAnchor, setTimezoneAnchor] = useState<HTMLButtonElement | null>(null)
  const [timeframeGroupsOpen, setTimeframeGroupsOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CANDLE_SIZE_GROUPS.map(group => [group.label, true]))
  )
  const [settingsPrecision, setSettingsPrecision] = useState<SettingsPrecision>('default')
  const [settingsColorBarsPreviousClose, setSettingsColorBarsPreviousClose] = useState(false)
  const [settingsBodyVisible, setSettingsBodyVisible] = useState(true)
  const [settingsBordersVisible, setSettingsBordersVisible] = useState(true)
  const [settingsWickVisible, setSettingsWickVisible] = useState(true)
  const [activeSettingsColor, setActiveSettingsColor] = useState<SettingsColorSlot | null>(null)
  const [modalPositions, setModalPositions] = useState<Partial<Record<ModalKey, ModalPosition>>>({})
  const [timeframeMenuPosition, setTimeframeMenuPosition] = useState<FloatingMenuPosition | null>(null)
  const [settingsColors, setSettingsColors] = useState<Record<SettingsColorSlot, string>>({
    bodyUp: '#089981',
    bodyDown: '#f23645',
    borderUp: '#000000',
    borderDown: '#000000',
    wickUp: '#000000',
    wickDown: '#000000',
  })
  const [settingsColorOpacity, setSettingsColorOpacity] = useState<Record<SettingsColorSlot, number>>({
    bodyUp: 100,
    bodyDown: 100,
    borderUp: 100,
    borderDown: 100,
    wickUp: 100,
    wickDown: 100,
  })
  const [canvasSettings, setCanvasSettings] = useState<ChartCanvasSettings>(() => (
    ensureCanvasTextContrast(loadChartCanvasSettings())
  ))
  const canvasUiPalette = useMemo(() => getCanvasUiPalette(canvasSettings), [canvasSettings])
  const chartSettingsSnapshotRef = useRef<ChartSettingsSnapshot | null>(null)

  // Pinned tool per group — persists last selection so icon stays updated
  const [pinnedTools, setPinnedTools] = useState<Record<string, DrawTool>>(() =>
    Object.fromEntries(TOOL_GROUPS.map(g => [g.id, getGroupTools(g)[0].id]))
  )
  const handlePinTool = (groupId: string, toolId: DrawTool) => {
    setPinnedTools(prev => ({ ...prev, [groupId]: toolId }))
  }

  const [selected, setSelected]         = useState<SelectedDrawing | null>(null)
  const selectedRef                      = useRef<SelectedDrawing | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const editingTextIdRef = useRef<string | null>(null)
  const [textCursorVisible, setTextCursorVisible] = useState(true)
  const draggingTradeLine = useRef<TradeLineTarget | null>(null)
  const pendingTradeLineUpdate = useRef<PendingTradeLineUpdate | null>(null)

  useEffect(() => { cursorModeRef.current = cursorMode }, [cursorMode])
  useEffect(() => { autoScaleEnabledRef.current = autoScaleEnabled }, [autoScaleEnabled])
  useEffect(() => { editingTextIdRef.current = editingTextId }, [editingTextId])

  const startTextEdit = useCallback((drawingId: string) => {
    editingTextIdRef.current = drawingId
    setEditingTextId(drawingId)
    setSelected(null)
    setTextCursorVisible(true)
    requestAnimationFrame(() => redrawCanvasRef.current?.())
  }, [setSelected])

  const stopTextEdit = useCallback(() => {
    const id = editingTextIdRef.current
    if (!id) return
    const drawing = drawingsRef.current.find(item => item.id === id)
    if (drawing && EDITABLE_TEXT_TOOLS.has(drawing.tool) && !(drawing.text ?? '').trim()) {
      const next = drawingsRef.current.filter(item => item.id !== id)
      drawingsRef.current = next
      setDrawings(next)
      if (selectedRef.current?.id === id) {
        selectedRef.current = null
        setSelected(null)
      }
    }
    editingTextIdRef.current = null
    setEditingTextId(null)
    requestAnimationFrame(() => redrawCanvasRef.current?.())
  }, [setDrawings, setSelected])

  useEffect(() => {
    if (!editingTextId) return
    const timer = window.setInterval(() => {
      setTextCursorVisible(value => !value)
    }, 530)
    return () => window.clearInterval(timer)
  }, [editingTextId])

  useEffect(() => {
    if (editingTextId) redrawCanvasRef.current?.()
  }, [editingTextId, textCursorVisible])

  useEffect(() => {
    const onTextEditKey = (event: KeyboardEvent) => {
      const id = editingTextIdRef.current
      if (!id) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const drawing = drawingsRef.current.find(item => item.id === id)
      if (!drawing || !EDITABLE_TEXT_TOOLS.has(drawing.tool)) {
        stopTextEdit()
        return
      }

      let nextText: string | null = null
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        stopTextEdit()
        return
      }
      if (event.key === 'Enter') {
        nextText = `${drawing.text ?? ''}\n`
      } else if (event.key === 'Backspace') {
        nextText = (drawing.text ?? '').slice(0, -1)
      } else if (event.key === 'Delete') {
        nextText = ''
      } else if (event.key.length === 1) {
        nextText = `${drawing.text ?? ''}${event.key}`
      } else {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      const next = drawingsRef.current.map(item =>
        item.id === id ? { ...item, text: nextText ?? '' } : item,
      )
      drawingsRef.current = next
      setDrawings(next)
      setTextCursorVisible(true)
      redrawCanvasRef.current?.()
    }

    document.addEventListener('keydown', onTextEditKey, true)
    return () => document.removeEventListener('keydown', onTextEditKey, true)
  }, [setDrawings, stopTextEdit])

  useEffect(() => {
    const offsetMinutes = parseTimeZoneOffsetMinutes(getTimeZoneOption(chartTimeZone).label)
    const updateClock = () => setUtcClock(formatOffsetClock(new Date(), offsetMinutes))
    const initialTimer = window.setTimeout(updateClock, 0)
    const timer = window.setInterval(() => {
      updateClock()
    }, 1000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [chartTimeZone])

  // Indicator state
  const [activeIndicators, setActiveIndicators] = useState<Set<string>>(new Set())
  const [hiddenIndicators, setHiddenIndicators] = useState<Set<string>>(new Set())
  const [selectedIndicator, setSelectedIndicator] = useState<string | null>(null)
  const [indicatorSeriesByName, setIndicatorSeriesByName] = useState<Map<string, IndicatorSeries>>(() => new Map())

  useEffect(() => {
    if (!selectedIndicator) return
    const clearSelection = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (target?.closest('.sim-chart-indicator-legend-row')) return
      setSelectedIndicator(null)
    }
    document.addEventListener('pointerdown', clearSelection)
    return () => document.removeEventListener('pointerdown', clearSelection)
  }, [selectedIndicator])

  const candles         = useSimStore(s => s.candles)
  const symbol          = useSimStore(s => s.symbol)
  const symbolLabel     = useSimStore(s => s.symbolLabel)
  const timeframe       = useSimStore(s => s.timeframe)
  const visibleIndex    = useSimStore(s => s.visibleIndex)
  const playing         = useSimStore(s => s.playing)
  const speed           = useSimStore(s => s.speed)
  const config          = useSimStore(s => s.config)
  const trades          = useSimStore(s => s.trades)
  const pendingOrders   = useSimStore(s => s.pendingOrders)
  const setMarket       = useSimStore(s => s.setMarket)
  const updateTradeLevels = useSimStore(s => s.updateTradeLevels)
  const updatePendingOrder = useSimStore(s => s.updatePendingOrder)
  const orderDraft = useSimStore(s => s.orderDraft)
  const activeOrderPriceField = useSimStore(s => s.activeOrderPriceField)
  const setOrderDraft = useSimStore(s => s.setOrderDraft)
  const setActiveOrderPriceField = useSimStore(s => s.setActiveOrderPriceField)
  const setOrderPriceFieldError = useSimStore(s => s.setOrderPriceFieldError)
  const visibleIndexRef = useRef(visibleIndex)
  const visibleCandles = useMemo(() => candles.slice(0, visibleIndex), [candles, visibleIndex])
  const candleData = useMemo(() => visibleCandles.map((candle, index) => {
    const previous = visibleCandles[index - 1]
    const isUp = settingsColorBarsPreviousClose && previous
      ? candle.close >= previous.close
      : candle.close >= candle.open
    const bodyColor = colorWithOpacity(
      isUp ? settingsColors.bodyUp : settingsColors.bodyDown,
      isUp ? settingsColorOpacity.bodyUp : settingsColorOpacity.bodyDown,
    )
    const borderColor = colorWithOpacity(
      isUp ? settingsColors.borderUp : settingsColors.borderDown,
      isUp ? settingsColorOpacity.borderUp : settingsColorOpacity.borderDown,
    )
    const wickColor = colorWithOpacity(
      isUp ? settingsColors.wickUp : settingsColors.wickDown,
      isUp ? settingsColorOpacity.wickUp : settingsColorOpacity.wickDown,
    )
    return {
      time: (new Date(candle.ts).getTime() / 1000) as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume ?? 0,
      ...(settingsColorBarsPreviousClose ? {
        color: settingsBodyVisible ? bodyColor : 'transparent',
        borderColor,
        wickColor,
      } : {}),
    }
  }), [
    settingsBodyVisible,
    settingsColorBarsPreviousClose,
    settingsColorOpacity,
    settingsColors,
    visibleCandles,
  ])
  const volumeData = useMemo(() => visibleCandles.map(c => ({
    time: (new Date(c.ts).getTime() / 1000) as Time,
    value: toChartHistogramValue(c.volume),
    color: c.close >= c.open ? 'rgba(8,153,129,0.28)' : 'rgba(242,54,69,0.28)',
  })), [visibleCandles])
  const selectedCandle = candles[Math.max(0, Math.min(candles.length - 1, visibleIndex - 1))]
  const previousSelectedCandle = candles[Math.max(0, Math.min(candles.length - 1, visibleIndex - 2))]
  const selectedCandleChange = selectedCandle && previousSelectedCandle
    ? selectedCandle.close - previousSelectedCandle.close
    : 0
  const selectedCandleChangePercent = previousSelectedCandle?.close
    ? selectedCandleChange / previousSelectedCandle.close * 100
    : 0
  const symbolIcons = useMemo(() => getSymbolIcons(symbol), [symbol])
  const gotoDateValue = formatDateInput(selectedCandle?.ts)
  const gotoTimeValue = formatTimeInput(selectedCandle?.ts)
  const todayDateValue = useMemo(() => formatCalendarDate(new Date()), [])
  const calendarBaseDate = useMemo(
    () => parseDateInput(goToDateInput) ?? parseDateInput(gotoDateValue) ?? new Date(),
    [goToDateInput, gotoDateValue],
  )
  const calendarMonthLabel = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(calendarBaseDate),
    [calendarBaseDate],
  )
  const calendarDays = useMemo(
    () => getMonthCalendar(calendarBaseDate.getFullYear(), calendarBaseDate.getMonth()),
    [calendarBaseDate],
  )
  const selectedTimeZoneLabel = getTimeZoneOption(chartTimeZone).label
  const selectedTimeZoneName = selectedTimeZoneLabel === 'UTC'
    ? 'UTC'
    : selectedTimeZoneLabel.replace(/^\([^)]*\)\s*/, '')
  const selectedCandleSize = CANDLE_SIZE_OPTIONS.find(item => item.id === timeframe) ?? CANDLE_SIZE_OPTIONS[3]

  const restoreChartGestureHandling = useCallback(() => {
    chartRef.current?.applyOptions({
      handleScroll: true,
      handleScale: true,
    })
    setDrawingDragGestureLocked(false)
  }, [])

  const disableChartGestureHandling = useCallback(() => {
    chartRef.current?.applyOptions({
      handleScroll: false,
      handleScale: false,
    })
    setDrawingDragGestureLocked(true)
  }, [])

  const getVisibleDrawings = useCallback(() => {
    return drawingsRef.current
  }, [])
  const getInteractionCandles = useCallback(() => visibleCandles, [visibleCandles])

  useEffect(() => {
    loadPreviousRef.current = loadPrevious
  }, [loadPrevious])
  const settingsTabs: { id: ChartSettingsTab; label: string; icon: ReactNode }[] = [
    { id: 'symbol', label: 'Symbol', icon: SettingsSymbolIcon },
    { id: 'canvas', label: 'Canvas', icon: SettingsCanvasIcon },
  ]
  const selectedPrecisionLabel = PRECISION_OPTIONS.find(item => item.value === settingsPrecision)?.label ?? 'Default'
  const renderSettingsSwatch = (slot: SettingsColorSlot) => (
    <span className="sim-chart-settings-swatch-wrap">
      <button
        type="button"
        className={`sim-chart-settings-swatch ${activeSettingsColor === slot ? 'sim-chart-settings-swatch-active' : ''}`}
        onPointerDown={event => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          setActiveSettingsColor(activeSettingsColor === slot ? null : slot)
        }}
      >
        <span style={{
          background:
            `linear-gradient(${colorWithOpacity(settingsColors[slot], settingsColorOpacity[slot])}, ${colorWithOpacity(settingsColors[slot], settingsColorOpacity[slot])}), ` +
            'repeating-conic-gradient(rgba(255,255,255,0.18) 0 25%, rgba(0,0,0,0.18) 0 50%) 0 / 8px 8px',
        }} />
      </button>
      {activeSettingsColor === slot && (
        <ChartSettingsColorPopover
          activeColor={settingsColors[slot]}
          opacity={settingsColorOpacity[slot]}
          onSelect={color => setSettingsColors(prev => ({ ...prev, [slot]: color }))}
          onOpacityChange={opacity => setSettingsColorOpacity(prev => ({ ...prev, [slot]: opacity }))}
        />
      )}
    </span>
  )
  const beginModalDrag = (key: ModalKey, event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, select, textarea')) return
    const modal = event.currentTarget.closest('[data-chart-modal]') as HTMLElement | null
    const chartBounds = containerRef.current?.getBoundingClientRect()
    const modalBounds = modal?.getBoundingClientRect()
    if (!modal || !chartBounds || !modalBounds) return

    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = modalPositions[key]?.left ?? modalBounds.left
    const startTop = modalPositions[key]?.top ?? modalBounds.top
    const maxLeft = chartBounds.right - modalBounds.width - 8
    const maxTop = chartBounds.bottom - modalBounds.height - 8
    const minLeft = chartBounds.left + 8
    const minTop = chartBounds.top + 44

    const onMove = (moveEvent: PointerEvent) => {
      const nextLeft = Math.min(Math.max(startLeft + moveEvent.clientX - startX, minLeft), Math.max(minLeft, maxLeft))
      const nextTop = Math.min(Math.max(startTop + moveEvent.clientY - startY, minTop), Math.max(minTop, maxTop))
      setModalPositions(prev => ({ ...prev, [key]: { left: nextLeft, top: nextTop } }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }
  const majorTimeZones = TIMEZONE_OPTIONS.filter(item => item.group === 'major')
  const exchangeTimeZones = TIMEZONE_OPTIONS.filter(item => item.group === 'exchange')

  useEffect(() => {
    if (openPanel === 'goto') return
    const frame = requestAnimationFrame(() => {
      setGoToDateInput(gotoDateValue)
      setGoToTimeInput(gotoTimeValue)
    })
    return () => cancelAnimationFrame(frame)
  }, [gotoDateValue, gotoTimeValue, openPanel])

  const updateTimeframeMenuPosition = useCallback(() => {
    const button = timeframeButtonRef.current
    if (!button) return

    const rect = button.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const gutter = 8
    const width = Math.min(TIMEFRAME_MENU_WIDTH, Math.max(140, viewportWidth - gutter * 2))
    const left = Math.min(
      Math.max(rect.left, gutter),
      Math.max(gutter, viewportWidth - width - gutter),
    )
    const top = Math.min(rect.bottom + 4, Math.max(44, viewportHeight - 96))
    const maxHeight = Math.max(132, viewportHeight - top - 44)

    setTimeframeMenuPosition({ left, top, width, maxHeight })
  }, [])

  useEffect(() => {
    if (openPanel !== 'timeframe') return

    updateTimeframeMenuPosition()
    window.addEventListener('resize', updateTimeframeMenuPosition)
    window.addEventListener('scroll', updateTimeframeMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateTimeframeMenuPosition)
      window.removeEventListener('scroll', updateTimeframeMenuPosition, true)
    }
  }, [openPanel, updateTimeframeMenuPosition])

  const updateScrollForwardVisibility = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return

    const range = chart.timeScale().getVisibleLogicalRange()
    const lastVisibleIndex = visibleIndexRef.current - 1
    if (!range || lastVisibleIndex < 0) {
      setShowScrollForward(false)
      return
    }

    setShowScrollForward(Number(range.to) < lastVisibleIndex)
  }, [])

  useEffect(() => {
    visibleIndexRef.current = visibleIndex
    updateScrollForwardVisibility()
  }, [updateScrollForwardVisibility, visibleIndex])

  useEffect(() => { drawingsRef.current = drawings }, [drawings])
  useEffect(() => { activeToolRef.current = activeTool }, [activeTool])
  useEffect(() => { drawingsLockedRef.current = drawingsLocked }, [drawingsLocked])
  useEffect(() => { drawingsHiddenRef.current = drawingsHidden }, [drawingsHidden])

  useEffect(() => {
    if (openPanel !== 'top-indicators' && openPanel !== 'timeframe' && openPanel !== 'goto' && openPanel !== 'timezone' && openPanel !== 'snapshot') return
    const closeFloatingPanel = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.sim-chart-top-popover')) return
      if (target?.closest('.sim-chart-settings-dropdown-menu')) return
      if (target?.closest('.sim-chart-goto-shell')) return
      if (target?.closest('.sim-chart-timezone-shell')) return
      setOpenPanel(null)
    }
    document.addEventListener('pointerdown', closeFloatingPanel)
    return () => document.removeEventListener('pointerdown', closeFloatingPanel)
  }, [openPanel])

  useEffect(() => {
    if (!activeSettingsColor && !settingsPrecisionOpen && !settingsTimezoneOpen && !settingsTemplateOpen) return
    const closeSettingsDrops = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.sim-chart-settings-swatch-wrap')) return
      if (target?.closest('.sim-chart-settings-select-wrap')) return
      if (target?.closest('.sim-chart-settings-dropdown-menu')) return
      if (target?.closest('.sim-chart-settings-template')) return
      setActiveSettingsColor(null)
      setSettingsPrecisionOpen(false)
      setSettingsTimezoneOpen(false)
      setSettingsTemplateOpen(false)
    }
    document.addEventListener('pointerdown', closeSettingsDrops)
    return () => document.removeEventListener('pointerdown', closeSettingsDrops)
  }, [activeSettingsColor, settingsPrecisionOpen, settingsTemplateOpen, settingsTimezoneOpen])

  // ── Init chart ──────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    let chart: IChartApi | null = null
    let ro: ResizeObserver | null = null
    const timer = setTimeout(() => {
      if (!containerRef.current) return

      const buyColor = cssVar('--trade-buy', '#089981')
      const sellColor = cssVar('--trade-sell', '#f23645')

      chart = createChart(containerRef.current, {
        layout: {
          background: getCanvasBackground(canvasSettings),
          textColor: colorWithOpacity(canvasSettings.scaleTextColor, canvasSettings.scaleTextOpacity),
          fontSize: canvasSettings.scaleTextSize,
          fontFamily: 'Vazirmatn, sans-serif',
        },
        localization: {
          timeFormatter: (time: Time) => formatChartTime(time, 'UTC', 0),
        },
        grid: {
          vertLines: {
            color: colorWithOpacity(canvasSettings.gridVerticalColor, canvasSettings.gridVerticalOpacity),
            visible: canvasSettings.gridMode === 'vertical' || canvasSettings.gridMode === 'both',
            style: LineStyle.Solid,
          },
          horzLines: {
            color: colorWithOpacity(canvasSettings.gridHorizontalColor, canvasSettings.gridHorizontalOpacity),
            visible: canvasSettings.gridMode === 'horizontal' || canvasSettings.gridMode === 'both',
            style: LineStyle.Solid,
          },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: colorWithOpacity(canvasSettings.crosshairColor, canvasSettings.crosshairOpacity),
            width: canvasSettings.crosshairWidth,
            style: getCanvasLineStyle(canvasSettings.crosshairStyle),
            labelVisible: true,
          },
          horzLine: {
            color: colorWithOpacity(canvasSettings.crosshairColor, canvasSettings.crosshairOpacity),
            width: canvasSettings.crosshairWidth,
            style: getCanvasLineStyle(canvasSettings.crosshairStyle),
            labelVisible: true,
          },
        },
        rightPriceScale: {
          borderColor: colorWithOpacity(canvasSettings.scaleLineColor, canvasSettings.scaleLineOpacity),
        },
        timeScale: {
          borderColor: colorWithOpacity(canvasSettings.scaleLineColor, canvasSettings.scaleLineOpacity),
          rightOffset: 84,
          timeVisible: true,
          tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => formatTimeAxisTick(time, tickMarkType, 'UTC', 0),
        },
        width:  containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      })

      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor:        buyColor,
        downColor:      sellColor,
        borderUpColor:  buyColor,
        borderDownColor:sellColor,
        wickUpColor:    buyColor,
        wickDownColor:  sellColor,
        priceFormat: getSymbolPriceFormat(useSimStore.getState().symbol),
      })

      const volSeries = chart.addSeries(HistogramSeries, {
        color: CHART_COLORS.axis,
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
        priceLineVisible: false,
        lastValueVisible: false,
      })
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })

      const initialState = useSimStore.getState()
      watermarkRef.current = createTextWatermark(chart.panes()[0], {
        visible: canvasSettings.watermarkVisible,
        horzAlign: 'center',
        vertAlign: 'center',
        lines: [
          {
            text: `${initialState.symbolLabel}, ${initialState.timeframe}`,
            color: colorWithOpacity(canvasSettings.watermarkColor, canvasSettings.watermarkOpacity),
            fontSize: 68,
            lineHeight: 82,
            fontFamily: 'Vazirmatn, sans-serif',
            fontStyle: '600',
          },
          {
            text: initialState.symbolLabel,
            color: colorWithOpacity(canvasSettings.watermarkColor, canvasSettings.watermarkOpacity),
            fontSize: 30,
            lineHeight: 40,
            fontFamily: 'Vazirmatn, sans-serif',
            fontStyle: '500',
          },
        ],
      })

      chartRef.current  = chart
      candleRef.current = candleSeries
      volumeRef.current = volSeries
      candleSeries.applyOptions({
        priceFormat: getSettingsPriceFormat(settingsPrecision, getSymbolPriceFormat(useSimStore.getState().symbol)),
        upColor: settingsBodyVisible ? colorWithOpacity(settingsColors.bodyUp, settingsColorOpacity.bodyUp) : 'transparent',
        downColor: settingsBodyVisible ? colorWithOpacity(settingsColors.bodyDown, settingsColorOpacity.bodyDown) : 'transparent',
        borderVisible: settingsBordersVisible,
        borderUpColor: colorWithOpacity(settingsColors.borderUp, settingsColorOpacity.borderUp),
        borderDownColor: colorWithOpacity(settingsColors.borderDown, settingsColorOpacity.borderDown),
        wickVisible: settingsWickVisible,
        wickUpColor: colorWithOpacity(settingsColors.wickUp, settingsColorOpacity.wickUp),
        wickDownColor: colorWithOpacity(settingsColors.wickDown, settingsColorOpacity.wickDown),
      })

      const handleVisibleLogicalRangeChange = (logicalRange: LogicalRange | null) => {
        if (autoScaleEnabledRef.current) {
          chart?.priceScale('right').setAutoScale(true)
        }
        if (logicalRange && Number(logicalRange.from) < BACKFILL_LOGICAL_THRESHOLD) {
          void loadPreviousRef.current()
        }
        if (logicalRange && Number(logicalRange.from) > PRUNE_LEADING_BUFFER + PRUNE_MIN_REMOVE) {
          const removeCount = Math.floor(Number(logicalRange.from) - PRUNE_LEADING_BUFFER)
          const removed = useSimStore.getState().pruneCandlesBefore(removeCount)
          if (removed > 0) pendingPrunedFrontCount.current += removed
        }
        updateScrollForwardVisibility()
        redrawCanvasRef.current?.()
      }

      chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange)

      ro = new ResizeObserver(() => {
        if (containerRef.current)
          chart?.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight })
        redrawCanvasRef.current?.()
      })
      ro.observe(containerRef.current)
    }, 100)
    return () => {
      clearTimeout(timer)
      ro?.disconnect()
      watermarkRef.current?.detach()
      watermarkRef.current = null
      chart?.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
    }
    // Chart instance owns subscriptions and must be created once; reactive series settings are applied by effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    candleRef.current?.applyOptions({
      priceFormat: getSettingsPriceFormat(settingsPrecision, getSymbolPriceFormat(symbol)),
    })
  }, [settingsPrecision, symbol])

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: {
        background: getCanvasBackground(canvasSettings),
        textColor: colorWithOpacity(canvasSettings.scaleTextColor, canvasSettings.scaleTextOpacity),
        fontSize: canvasSettings.scaleTextSize,
      },
      grid: {
        vertLines: {
          color: colorWithOpacity(canvasSettings.gridVerticalColor, canvasSettings.gridVerticalOpacity),
          visible: canvasSettings.gridMode === 'vertical' || canvasSettings.gridMode === 'both',
          style: LineStyle.Solid,
        },
        horzLines: {
          color: colorWithOpacity(canvasSettings.gridHorizontalColor, canvasSettings.gridHorizontalOpacity),
          visible: canvasSettings.gridMode === 'horizontal' || canvasSettings.gridMode === 'both',
          style: LineStyle.Solid,
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: colorWithOpacity(canvasSettings.crosshairColor, canvasSettings.crosshairOpacity),
          width: canvasSettings.crosshairWidth,
          style: getCanvasLineStyle(canvasSettings.crosshairStyle),
          labelVisible: true,
        },
        horzLine: {
          color: colorWithOpacity(canvasSettings.crosshairColor, canvasSettings.crosshairOpacity),
          width: canvasSettings.crosshairWidth,
          style: getCanvasLineStyle(canvasSettings.crosshairStyle),
          labelVisible: true,
        },
      },
      rightPriceScale: {
        borderColor: colorWithOpacity(canvasSettings.scaleLineColor, canvasSettings.scaleLineOpacity),
      },
      timeScale: {
        borderColor: colorWithOpacity(canvasSettings.scaleLineColor, canvasSettings.scaleLineOpacity),
      },
    })
    redrawCanvasRef.current?.()
  }, [canvasSettings])

  useEffect(() => {
    const color = colorWithOpacity(canvasSettings.watermarkColor, canvasSettings.watermarkOpacity)
    watermarkRef.current?.applyOptions({
      visible: canvasSettings.watermarkVisible,
      horzAlign: 'center',
      vertAlign: 'center',
      lines: [
        {
          text: `${symbolLabel}, ${timeframe}`,
          color,
          fontSize: 68,
          lineHeight: 82,
          fontFamily: 'Vazirmatn, sans-serif',
          fontStyle: '600',
        },
        {
          text: symbolLabel,
          color,
          fontSize: 30,
          lineHeight: 40,
          fontFamily: 'Vazirmatn, sans-serif',
          fontStyle: '500',
        },
      ],
    })
  }, [canvasSettings.watermarkColor, canvasSettings.watermarkOpacity, canvasSettings.watermarkVisible, symbolLabel, timeframe])

  useEffect(() => {
    const bodyUp = colorWithOpacity(settingsColors.bodyUp, settingsColorOpacity.bodyUp)
    const bodyDown = colorWithOpacity(settingsColors.bodyDown, settingsColorOpacity.bodyDown)
    const borderUp = colorWithOpacity(settingsColors.borderUp, settingsColorOpacity.borderUp)
    const borderDown = colorWithOpacity(settingsColors.borderDown, settingsColorOpacity.borderDown)
    const wickUp = colorWithOpacity(settingsColors.wickUp, settingsColorOpacity.wickUp)
    const wickDown = colorWithOpacity(settingsColors.wickDown, settingsColorOpacity.wickDown)
    candleRef.current?.applyOptions({
      upColor: settingsBodyVisible ? bodyUp : 'transparent',
      downColor: settingsBodyVisible ? bodyDown : 'transparent',
      borderVisible: settingsBordersVisible,
      borderUpColor: borderUp,
      borderDownColor: borderDown,
      wickVisible: settingsWickVisible,
      wickUpColor: wickUp,
      wickDownColor: wickDown,
    })
  }, [settingsBodyVisible, settingsBordersVisible, settingsColorOpacity, settingsColors, settingsWickVisible])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const offsetMinutes = parseTimeZoneOffsetMinutes(getTimeZoneOption(chartTimeZone).label)
    chart.applyOptions({
      localization: {
        timeFormatter: (time: Time) => formatChartTime(time, chartTimeZone, offsetMinutes),
      },
      timeScale: {
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => formatTimeAxisTick(time, tickMarkType, chartTimeZone, offsetMinutes),
      },
    })
    redrawCanvasRef.current?.()
  }, [chartTimeZone])

  // ── Feed data ────────────────────────────────
  useEffect(() => {
    const chart  = chartRef.current
    const candle = candleRef.current
    const vol    = volumeRef.current
    if (!chart || !candle || !vol || candles.length === 0) return

    const previousVisibleIndex = previousFeedVisibleIndex.current
    const previousFirstTs = previousFeedFirstTs.current
    const prunedFrontCount = pendingPrunedFrontCount.current
    const rangeBeforeUpdate = chart.timeScale().getVisibleLogicalRange()
    const currentFirstTs = visibleCandles[0]?.ts ?? null
    const previousFirstIndex = previousFirstTs
      ? visibleCandles.findIndex(candle => candle.ts === previousFirstTs)
      : -1
    const prependedVisibleCandles = previousFirstIndex > 0 && previousFirstTs !== currentFirstTs
    const previousLastIndex = previousVisibleIndex != null ? previousVisibleIndex - 1 : -1
    const wasAtFront = !rangeBeforeUpdate || previousLastIndex < 0 || Number(rangeBeforeUpdate.to) >= previousLastIndex - 0.5
    const prunedVisibleCandles = prunedFrontCount > 0
    const shouldFollowNewCandle = !prependedVisibleCandles && !prunedVisibleCandles && autoScaleEnabledRef.current && (
      previousVisibleIndex == null ||
      (visibleIndex > previousVisibleIndex && wasAtFront)
    )

    candle.setData(candleData)
    vol.setData(volumeData)
    previousFeedVisibleIndex.current = visibleIndex
    previousFeedFirstTs.current = currentFirstTs
    if (prependedVisibleCandles && rangeBeforeUpdate) {
      chart.timeScale().setVisibleLogicalRange({
        from: rangeBeforeUpdate.from + previousFirstIndex,
        to: rangeBeforeUpdate.to + previousFirstIndex,
      })
    } else if (prunedVisibleCandles && rangeBeforeUpdate) {
      pendingPrunedFrontCount.current = 0
      chart.timeScale().setVisibleLogicalRange({
        from: rangeBeforeUpdate.from - prunedFrontCount,
        to: rangeBeforeUpdate.to - prunedFrontCount,
      })
    } else if (prunedVisibleCandles) {
      pendingPrunedFrontCount.current = 0
    }
    if (shouldFollowNewCandle) {
      chart.timeScale().scrollToPosition(18, false)
    }
    if (autoScaleEnabledRef.current) {
      chart.priceScale('right').setAutoScale(true)
    }
    updateScrollForwardVisibility()

    activeIndicators.forEach(name => {
      refreshIndicatorSeries(name, indicatorSeriesByName.get(name), candleData)
    })
  }, [activeIndicators, candleData, candles.length, indicatorSeriesByName, updateScrollForwardVisibility, visibleCandles, visibleIndex, volumeData])

  // ── Playback ─────────────────────────────────
  useEffect(() => {
    if (!playing) return
    const step = Math.max(1, Math.trunc(speed))
    const delay = Math.max(MIN_PLAYBACK_INTERVAL_MS, 500)
    const id = setInterval(() => {
      const state = useSimStore.getState()
      if (state.visibleIndex >= state.candles.length) {
        if (!hasMore) state.setPlaying(false)
        return
      }
      state.setVisibleIndex(state.visibleIndex + step)
    }, delay)
    return () => clearInterval(id)
  }, [hasMore, playing, speed])

  // ─────────────────────────────────────────────
  // Indicators
  // ─────────────────────────────────────────────
  const getCandleData = useCallback((): CandlestickData[] => {
    return candleData
  }, [candleData])

  const removeIndicator = (name: string) => {
    const chart = chartRef.current
    if (!chart) return
    removeIndicatorSeries(chart, indicatorSeriesByName.get(name))
    setIndicatorSeriesByName(current => {
      const next = new Map(current)
      next.delete(name)
      return next
    })
    setActiveIndicators(current => {
      const next = new Set(current)
      next.delete(name)
      return next
    })
    setHiddenIndicators(current => {
      const next = new Set(current)
      next.delete(name)
      return next
    })
    setSelectedIndicator(current => current === name ? null : current)
  }

  const clearIndicators = () => {
    const chart = chartRef.current
    if (chart) {
      indicatorSeriesByName.forEach(indicator => removeIndicatorSeries(chart, indicator))
    }
    setIndicatorSeriesByName(new Map())
    setActiveIndicators(new Set())
    setHiddenIndicators(new Set())
    setSelectedIndicator(null)
  }

  const toggleIndicatorVisibility = (name: string) => {
    const indicator = indicatorSeriesByName.get(name)
    if (!indicator) return
    const nextVisible = hiddenIndicators.has(name)
    ;[...(indicator.decorations ?? []), ...indicator.series].forEach(series => {
      series.applyOptions({ visible: nextVisible })
    })
    setHiddenIndicators(current => {
      const next = new Set(current)
      if (nextVisible) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleIndicator = (name: string) => {
    const chart = chartRef.current
    if (!chart) return

    if (activeIndicators.has(name)) {
      removeIndicator(name)
    } else {
      const indicator = createIndicatorSeries(chart, name, getCandleData())
      if (indicator) {
        setIndicatorSeriesByName(current => new Map(current).set(name, indicator))
        setActiveIndicators(current => new Set(current).add(name))
        setHiddenIndicators(current => {
          const next = new Set(current)
          next.delete(name)
          return next
        })
      }
    }
  }

  const saveChartLayout = useCallback(() => {
    localStorage.setItem(CHART_LAYOUT_STORAGE_KEY, JSON.stringify({
      drawings: drawingsRef.current,
      indicators: Array.from(activeIndicators),
      savedAt: new Date().toISOString(),
    }))
  }, [activeIndicators])

  const getChartSnapshotBlob = useCallback(async () => {
    const container = containerRef.current
    const overlay = overlayRef.current
    if (!container) return null

    redrawCanvasRef.current?.()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const output = document.createElement('canvas')
    output.width = Math.max(1, Math.round(rect.width * dpr))
    output.height = Math.max(1, Math.round(rect.height * dpr))

    const ctx = output.getContext('2d')
    if (!ctx) return null

    if (canvasSettings.backgroundType === 'gradient') {
      const gradient = ctx.createLinearGradient(0, 0, 0, output.height)
      gradient.addColorStop(0, colorWithOpacity(canvasSettings.backgroundTopColor, canvasSettings.backgroundTopOpacity))
      gradient.addColorStop(1, colorWithOpacity(canvasSettings.backgroundBottomColor, canvasSettings.backgroundBottomOpacity))
      ctx.fillStyle = gradient
    } else {
      ctx.fillStyle = colorWithOpacity(canvasSettings.backgroundTopColor, canvasSettings.backgroundTopOpacity)
    }
    ctx.fillRect(0, 0, output.width, output.height)

    const drawCanvas = (canvas: HTMLCanvasElement) => {
      const canvasRect = canvas.getBoundingClientRect()
      const left = Math.round((canvasRect.left - rect.left) * dpr)
      const top = Math.round((canvasRect.top - rect.top) * dpr)
      const width = Math.round(canvasRect.width * dpr)
      const height = Math.round(canvasRect.height * dpr)
      ctx.drawImage(canvas, left, top, width, height)
    }

    container.querySelectorAll('canvas').forEach(canvas => drawCanvas(canvas))
    if (overlay) drawCanvas(overlay)

    return new Promise<Blob | null>(resolve => output.toBlob(resolve, 'image/png'))
  }, [canvasSettings])

  const downloadChartImage = useCallback(async () => {
    const blob = await getChartSnapshotBlob()
    if (!blob) return

    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `chart-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setOpenPanel(null)
  }, [getChartSnapshotBlob])

  const copyChartImage = useCallback(async () => {
    const blob = await getChartSnapshotBlob()
    if (!blob || !navigator.clipboard || typeof ClipboardItem === 'undefined') return

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    setOpenPanel(null)
  }, [getChartSnapshotBlob])

  const scrollChartForward = useCallback(() => {
    chartRef.current?.timeScale().scrollToPosition(18, true)
    setShowScrollForward(false)
    redrawCanvasRef.current?.()
  }, [])

  const filteredIndicators = useMemo(() => {
    const query = indicatorSearch.trim().toLowerCase()
    if (!query) return INDICATORS
    return INDICATORS.filter(name => name.toLowerCase().includes(query))
  }, [indicatorSearch])

  function drawPriceLine(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    price: number,
    color: string,
    label: string,
    dash: number[] = [],
    fillLabel = true,
    labelY?: number,
    labelSide: PriceLineLabelSide = 'right',
    labelPosition: PriceLineLabelPosition = 'center',
    lineWidth = 1.2,
    lineAlpha = 1,
  ) {
    const y = candleRef.current?.priceToCoordinate(price)
    if (y == null) return
    const boxY = labelY ?? (labelPosition === 'above' ? y - 13 : y)
    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = lineWidth
    ctx.setLineDash(dash)
    ctx.beginPath()
    ctx.moveTo(52, y)
    ctx.lineTo(canvas.width - 68, y)
    ctx.globalAlpha = lineAlpha
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    ctx.font = '11px Vazirmatn, sans-serif'
    const text = `${label} ${formatPrice(price)}`
    const width = ctx.measureText(text).width + 12
    const priceScaleWidth = chartRef.current?.priceScale('right').width() ?? 64
    const priceScaleLeft = canvas.width - priceScaleWidth
    const x = labelSide === 'left'
      ? 58
      : priceScaleLeft - width - 1
    if (fillLabel) {
      ctx.fillRect(x, boxY - 11, width, 22)
      ctx.fillStyle = '#fff'
    }
    ctx.fillText(text, x + 6, boxY + 4)
    ctx.restore()
  }

  function resolveStackedLabelYs(canvas: HTMLCanvasElement, firstY: number, secondY: number) {
    const minGap = 24
    if (Math.abs(firstY - secondY) >= minGap) return [firstY, secondY] as const

    const firstIsTop = firstY <= secondY
    const center = (firstY + secondY) / 2
    let top = center - minGap / 2
    let bottom = center + minGap / 2
    if (top < 12) {
      bottom += 12 - top
      top = 12
    }
    if (bottom > canvas.height - 12) {
      top -= bottom - (canvas.height - 12)
      bottom = canvas.height - 12
    }
    return firstIsTop ? [top, bottom] as const : [bottom, top] as const
  }

  const drawTradeOverlay = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const current = candles[visibleIndex - 1]
    if (!current) return

    const bid = current.close
    const ask = bid + config.spread
    const buyColor = cssVar('--trade-buy', '#089981')
    const sellColor = cssVar('--trade-sell', '#f23645')
    const muted = cssVar('--text-muted', 'rgba(120,120,120,0.7)')

    const askY = candleRef.current?.priceToCoordinate(ask)
    const bidY = candleRef.current?.priceToCoordinate(bid)
    const [askLabelY, bidLabelY] = askY != null && bidY != null
      ? resolveStackedLabelYs(canvas, askY, bidY)
      : [undefined, undefined]
    drawPriceLine(ctx, canvas, ask, sellColor, 'ASK', [2, 3], true, askLabelY, 'right', 'center', 0.8, 0.58)
    drawPriceLine(ctx, canvas, bid, buyColor, 'BID', [2, 3], true, bidLabelY, 'right', 'center', 0.8, 0.58)

    const draftSideColor = orderDraft.type === 'buy' ? buyColor : sellColor
    const draftEntry = parsePrice(orderDraft.entryPrice)
    const draftLimit = parsePrice(orderDraft.limitPrice)
    const draftSl = orderDraft.slEnabled ? parsePrice(orderDraft.sl) : undefined
    const draftTp = orderDraft.tpEnabled ? parsePrice(orderDraft.tp) : undefined
    const draftOpenPrice = getPlannedOpenPrice(orderDraft, bid, config.spread ?? 0, symbol)

    if (orderDraft.orderKind === 'market') {
      if (draftSl !== undefined) drawPriceLine(ctx, canvas, draftSl, sellColor, 'DRAFT SL', [2, 6], false, undefined, 'left', 'above', 1, 0.9)
      if (draftTp !== undefined) drawPriceLine(ctx, canvas, draftTp, buyColor, 'DRAFT TP', [2, 6], false, undefined, 'left', 'above', 1, 0.9)
    } else {
      if (draftEntry !== undefined) drawPriceLine(ctx, canvas, draftEntry, draftSideColor, `DRAFT ${orderDraft.orderKind.toUpperCase()}`, [2, 6], false, undefined, 'left', 'above', 1, 0.9)
      if (orderDraft.orderKind === 'stop-limit' && draftLimit !== undefined) {
        drawPriceLine(ctx, canvas, getDraftLimitPrice(orderDraft, bid, config.spread ?? 0, symbol), '#f59e0b', 'DRAFT LIMIT', [6, 3], true, undefined, 'left', 'above', 1.8, 0.96)
      }
      if ((draftEntry !== undefined || orderDraft.orderKind === 'stop-limit') && draftSl !== undefined && Number.isFinite(draftOpenPrice)) {
        drawPriceLine(ctx, canvas, draftSl, sellColor, 'DRAFT SL', [2, 6], false, undefined, 'left', 'above', 1, 0.9)
      }
      if ((draftEntry !== undefined || orderDraft.orderKind === 'stop-limit') && draftTp !== undefined && Number.isFinite(draftOpenPrice)) {
        drawPriceLine(ctx, canvas, draftTp, buyColor, 'DRAFT TP', [2, 6], false, undefined, 'left', 'above', 1, 0.9)
      }
    }

    pendingOrders.filter(order => order.status === 'pending').forEach(order => {
      const preview = pendingTradeLineUpdate.current?.kind === 'pending' && pendingTradeLineUpdate.current.id === order.id
        ? pendingTradeLineUpdate.current.updates
        : {}
      const entryPrice = preview.entryPrice ?? order.entryPrice
      const limitPrice = preview.limitPrice ?? order.limitPrice
      const sl = preview.sl ?? order.sl
      const tp = preview.tp ?? order.tp
      const sideColor = order.type === 'buy' ? buyColor : sellColor
      drawPriceLine(ctx, canvas, entryPrice, sideColor, `${order.type.toUpperCase()} ${order.orderKind}`, [6, 4], false, undefined, 'left', 'above')
      if (limitPrice !== undefined) drawPriceLine(ctx, canvas, limitPrice, muted, 'LIMIT', [4, 4], false, undefined, 'left', 'above')
      if (sl !== undefined) drawPriceLine(ctx, canvas, sl, sellColor, `SL #${order.id.slice(0, 4)}`, [3, 4], false, undefined, 'left', 'above')
      if (tp !== undefined) drawPriceLine(ctx, canvas, tp, buyColor, `TP #${order.id.slice(0, 4)}`, [3, 4], false, undefined, 'left', 'above')
    })

    trades.forEach(trade => {
      const entryTime = new Date(trade.openTime).getTime() / 1000
      const entryX = chartRef.current?.timeScale().timeToCoordinate(entryTime as Time) ?? 52
      const entryY = candleRef.current?.priceToCoordinate(trade.openPrice)
      if (entryY == null) return

      if (trade.closePrice === undefined) {
        const preview = pendingTradeLineUpdate.current?.kind === 'trade' && pendingTradeLineUpdate.current.id === trade.id
          ? pendingTradeLineUpdate.current.levels
          : {}
        const sl = preview.sl ?? trade.sl
        const tp = preview.tp ?? trade.tp
        drawPriceLine(ctx, canvas, trade.openPrice, trade.type === 'buy' ? buyColor : sellColor, `${trade.type.toUpperCase()} #${trade.id.slice(0, 4)}`, [], false, undefined, 'left', 'above')
        if (sl !== undefined) drawPriceLine(ctx, canvas, sl, sellColor, `SL #${trade.id.slice(0, 4)}`, [3, 4], false, undefined, 'left', 'above')
        if (tp !== undefined) drawPriceLine(ctx, canvas, tp, buyColor, `TP #${trade.id.slice(0, 4)}`, [3, 4], false, undefined, 'left', 'above')
        return
      }

      if (!showTradeHistory) return

      const closeTime = trade.closeTime ? new Date(trade.closeTime).getTime() / 1000 : entryTime
      const closeX = chartRef.current?.timeScale().timeToCoordinate(closeTime as Time) ?? canvas.width - 80
      const closeY = candleRef.current?.priceToCoordinate(trade.closePrice)
      if (closeY == null) return

      const resultColor = (trade.pnl ?? 0) >= 0 ? buyColor : sellColor
      ctx.save()
      ctx.strokeStyle = resultColor
      ctx.fillStyle = resultColor
      ctx.lineWidth = 1.2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.shadowColor = 'rgba(0, 0, 0, 0.36)'
      ctx.shadowBlur = 2
      ctx.setLineDash([7, 4])
      ctx.globalAlpha = 0.34
      ctx.beginPath()
      ctx.moveTo(entryX, entryY)
      ctx.lineTo(closeX, closeY)
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.globalAlpha = 0.18
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)'
      ctx.lineWidth = 2.8
      ctx.beginPath()
      ctx.moveTo(entryX, entryY)
      ctx.lineTo(closeX, closeY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 0.42
      ctx.strokeStyle = resultColor
      ctx.lineWidth = 1.1
      ctx.setLineDash([7, 4])
      ctx.beginPath()
      ctx.moveTo(entryX, entryY)
      ctx.lineTo(closeX, closeY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 0.95
      ctx.beginPath()
      ctx.moveTo(entryX, entryY - 7)
      ctx.lineTo(entryX + 6, entryY + 5)
      ctx.lineTo(entryX - 6, entryY + 5)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.86)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.strokeStyle = resultColor
      ctx.beginPath()
      ctx.moveTo(closeX, closeY + 7)
      ctx.lineTo(closeX + 6, closeY - 5)
      ctx.lineTo(closeX - 6, closeY - 5)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.86)'
      ctx.stroke()
      ctx.fillStyle = resultColor
      ctx.font = '12px Vazirmatn, sans-serif'
      ctx.globalAlpha = 0.85
      ctx.fillText(`${(trade.pnl ?? 0) >= 0 ? '+' : ''}${(trade.pnl ?? 0).toFixed(2)}`, closeX + 6, closeY - 6)
      ctx.restore()
    })

  }, [candles, visibleIndex, config.spread, orderDraft, symbol, pendingOrders, trades, showTradeHistory])

  const drawOrderPricePicker = useCallback((canvas: HTMLCanvasElement) => {
    if (!activeOrderPriceField || !mousePos.current) return
    const price = candleRef.current?.coordinateToPrice(mousePos.current.y)
    if (price == null) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const y = mousePos.current.y
    const priceScaleWidth = chartRef.current?.priceScale('right').width() ?? 64
    const timeScaleHeight = chartRef.current?.timeScale().height() ?? 32
    const left = 52
    const right = canvas.width - priceScaleWidth - 6
    const plotBottom = Math.max(0, canvas.height - timeScaleHeight)
    const state = useSimStore.getState()
    const current = state.candles[state.visibleIndex - 1]
    const getErrorAtY = (sampleY: number) => {
      const samplePrice = candleRef.current?.coordinateToPrice(sampleY)
      if (samplePrice == null || !current) return 'قیمت فعلی بازار در دسترس نیست'
      return validateOrderPriceField(
        activeOrderPriceField,
        roundSymbolPrice(state.symbol, samplePrice),
        state.orderDraft,
        current.close,
        state.config.spread ?? 0,
        state.symbol,
      )
    }

    ctx.save()
    const bandHeight = 3
    for (let bandTop = 0; bandTop < plotBottom; bandTop += bandHeight) {
      const height = Math.min(bandHeight, plotBottom - bandTop)
      const bandError = getErrorAtY(bandTop + height / 2)
      ctx.fillStyle = bandError
        ? 'rgba(242, 54, 69, 0.085)'
        : 'rgba(8, 153, 129, 0.085)'
      ctx.fillRect(left, bandTop, Math.max(0, right - left), height)
    }
    ctx.restore()

    const error = getErrorAtY(y)
    const isValid = !error
    const statusColor = isValid ? 'rgba(8, 153, 129, 0.95)' : 'rgba(242, 54, 69, 0.95)'
    const label = isValid ? 'محدوده مجاز — برای ثبت کلیک کنید' : 'محدوده غیر مجاز'
    ctx.font = '11px Vazirmatn, sans-serif'
    const labelWidth = ctx.measureText(label).width + 18
    const labelX = Math.max(58, Math.min(right - labelWidth, mousePos.current.x + 12))

    ctx.save()
    ctx.strokeStyle = statusColor
    ctx.lineWidth = 1.2
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(right, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = statusColor
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.22)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(labelX, y - 15, labelWidth, 30, 6)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#e5e7eb'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, labelX + 9, y)
    ctx.restore()
  }, [activeOrderPriceField])

  const getOrderPriceError = useCallback((field: OrderPriceField, price: number) => {
    const state = useSimStore.getState()
    const current = state.candles[state.visibleIndex - 1]
    if (!current) return 'قیمت فعلی بازار در دسترس نیست'
    return validateOrderPriceField(field, price, state.orderDraft, current.close, state.config.spread ?? 0, state.symbol)
  }, [])

  const commitOrderPricePick = useCallback((my: number) => {
    const state = useSimStore.getState()
    const field = state.activeOrderPriceField
    if (!field) return false
    const price = candleRef.current?.coordinateToPrice(my)
    if (price == null) return true

    const nextPrice = roundSymbolPrice(state.symbol, price)
    const error = getOrderPriceError(field, nextPrice)
    if (error) {
      setOrderPriceFieldError(field, error)
      redrawCanvasRef.current?.()
      return true
    }

    setOrderDraft({
      [field]: formatSymbolPrice(state.symbol, nextPrice),
      ...(field === 'sl' ? { slEnabled: true } : {}),
      ...(field === 'tp' ? { tpEnabled: true } : {}),
    })
    setActiveOrderPriceField(null)
    requestAnimationFrame(() => redrawCanvasRef.current?.())
    return true
  }, [getOrderPriceError, setActiveOrderPriceField, setOrderDraft, setOrderPriceFieldError])

  const pointToPixel = useCallback((p: Point): { x: number; y: number } => {
    const chart = chartRef.current
    const sx = (timeToAnchoredCoordinate(chart, visibleCandles, p) ?? p.x) as number
    const sy = (p.price > 0 && p.price < 1e7)
      ? (candleRef.current?.priceToCoordinate(p.price) ?? p.y) as number
      : p.y
    return { x: sx, y: sy }
  }, [visibleCandles])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || candles.length === 0 || drawingsRef.current.length === 0) return
    const sourceCandles = visibleCandles
    if (sourceCandles.length < 2) return

    let changed = false
    const migrated = drawingsRef.current.map(drawing => {
      if (SCREEN_ANCHORED_TEXT_TOOLS.has(drawing.tool)) return drawing
      let drawingChanged = false
      let points = drawing.points.map(point => {
        if (point.time != null) return point
        const time = coordinateToAnchoredTime(chart, sourceCandles, point.x)
        if (time == null) return point
        changed = true
        drawingChanged = true
        return { ...point, time }
      })

      const canSimplifyFreehand = (
        (drawing.tool === 'brush' || drawing.tool === 'highlighter') &&
        points.length > 2 &&
        points.every(point => point.time != null)
      )

      if (canSimplifyFreehand) {
        const simplified = simplifyFreehandDrawingPoints(
          points,
          pointToPixel,
          drawing.tool === 'highlighter'
            ? { minDistance: 5, epsilon: 3.5, maxPoints: 650 }
            : { minDistance: 2.5, epsilon: 1.8, maxPoints: 900 },
        )
        if (simplified.length !== points.length) {
          points = simplified
          changed = true
          drawingChanged = true
        }
      }

      return drawingChanged ? { ...drawing, points } : drawing
    })

    if (!changed) return
    drawingsRef.current = migrated
    setDrawings(migrated)
  }, [candles.length, pointToPixel, visibleCandles])

  const redrawCanvas = useCallback((currentPoints?: Point[]) => {
    const canvas = overlayRef.current
    if (!canvas) return
    renderDrawings({
      canvas,
      chart: chartRef.current,
      candleSeries: candleRef.current,
      candles: visibleCandles,
      drawings: drawingsHiddenRef.current ? [] : getVisibleDrawings(),
      currentPoints,
      activeTool: activeToolRef.current,
      cursorMode: cursorModeRef.current,
      mousePosition: mousePos.current,
      selectedId: drawingsHiddenRef.current ? undefined : selectedRef.current?.id,
      editingTextId: drawingsHiddenRef.current ? null : editingTextIdRef.current,
      textCursorVisible,
      drawingsLocked: drawingsLockedRef.current,
      priceFormatter: price => {
        const precision = settingsPrecision === 'default'
          ? getSymbolPricePrecision(symbol)
          : settingsPrecision === 'integer'
            ? 0
            : Number(settingsPrecision.replace('decimal-', ''))
        return price.toFixed(precision)
      },
      pointToPixel,
    })
    drawSessionBreaks(canvas, chartRef.current, visibleCandles, timeframe, canvasSettings)
    drawTradeOverlay(canvas)
    drawOrderPricePicker(canvas)
  }, [getVisibleDrawings, pointToPixel, visibleCandles, symbol, timeframe, textCursorVisible, settingsPrecision, canvasSettings, drawTradeOverlay, drawOrderPricePicker])

  useEffect(() => {
    redrawCanvasRef.current = redrawCanvas
  }, [redrawCanvas])

  const interaction = useDrawingInteraction({
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
    onStartTextEdit: startTextEdit,
    getCandles: getInteractionCandles,
  })

  const {
    isDrawing,
    drawingPoints,
    activateDrawTool: _activateDrawTool,
    selectDrawing,
    cloneDrawing,
    findHitDrawing,
    getDrawingNodeCursor,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleContainerDrag,
    cancelActiveTool,
  } = interaction

  useEffect(() => {
    const cancelDrawingOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (containerRef.current?.contains(target) || overlayRef.current?.contains(target)) return
      if (activeToolRef.current !== 'brush' && activeToolRef.current !== 'highlighter') return
      cancelActiveTool()
    }

    document.addEventListener('pointerdown', cancelDrawingOnOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', cancelDrawingOnOutsidePointerDown)
  }, [cancelActiveTool, isDrawing])

  const activateDrawTool = useCallback((tool: DrawTool) => {
    _activateDrawTool(tool)
    setOpenPanel(null)
  }, [_activateDrawTool])

  const findHitTradeLine = useCallback((_mx: number, my: number): TradeLineTarget | null => {
    const toY = (price: number) => candleRef.current?.priceToCoordinate(price)
    const within = (price: number) => {
      const y = toY(price)
      return y != null && Math.abs(y - my) <= 7
    }

    for (const trade of [...trades].reverse()) {
      if (trade.closePrice !== undefined) continue
      if (trade.sl !== undefined && within(trade.sl)) return { kind: 'trade', id: trade.id, field: 'sl' }
      if (trade.tp !== undefined && within(trade.tp)) return { kind: 'trade', id: trade.id, field: 'tp' }
      if (within(trade.openPrice)) return { kind: 'trade', id: trade.id, field: 'entry' }
    }

    for (const order of [...pendingOrders].reverse()) {
      if (order.status !== 'pending') continue
      if (within(order.entryPrice)) return { kind: 'pending', id: order.id, field: 'entryPrice' }
      if (order.limitPrice !== undefined && within(order.limitPrice)) return { kind: 'pending', id: order.id, field: 'limitPrice' }
      if (order.sl !== undefined && within(order.sl)) return { kind: 'pending', id: order.id, field: 'sl' }
      if (order.tp !== undefined && within(order.tp)) return { kind: 'pending', id: order.id, field: 'tp' }
    }

    return null
  }, [trades, pendingOrders])

  const applyTradeLineDrag = useCallback((my: number) => {
    const price = candleRef.current?.coordinateToPrice(my)
    if (price == null || !draggingTradeLine.current) return

    const state = useSimStore.getState()
    const symbol = state.symbol
    const nextPrice = roundSymbolPrice(symbol, price)
    const minMove = getSymbolMinMove(symbol)
    const target = draggingTradeLine.current
    const current = state.candles[state.visibleIndex - 1]
    if (!current) return
    const bid = current.close
    const ask = bid + (state.config.spread ?? 0)
    const draggedTradeOpenPrice = target.kind === 'trade'
      ? state.trades.find(item => item.id === target.id)?.openPrice ?? bid
      : bid
    const clampLevel = (side: 'buy' | 'sell', field: 'sl' | 'tp', value: number) => {
      if (side === 'buy') {
        return field === 'sl'
          ? Math.min(value, bid - minMove)
          : Math.max(value, Math.max(bid + minMove, draggedTradeOpenPrice))
      }

      return field === 'sl'
        ? Math.max(value, ask + minMove)
        : Math.min(value, Math.min(ask - minMove, draggedTradeOpenPrice))
    }
    const clampPendingEntry = (order: PendingOrder, value: number) => {
      if (order.type === 'buy') {
        if (order.orderKind === 'limit') return Math.min(value, ask - minMove)
        const stopped = Math.max(value, ask + minMove)
        return order.orderKind === 'stop-limit' && order.limitPrice !== undefined
          ? Math.min(stopped, order.limitPrice)
          : stopped
      }
      if (order.orderKind === 'limit') return Math.max(value, bid + minMove)
      const stopped = Math.min(value, bid - minMove)
      return order.orderKind === 'stop-limit' && order.limitPrice !== undefined
        ? Math.max(stopped, order.limitPrice)
        : stopped
    }
    const clampPendingLevel = (order: PendingOrder, field: 'sl' | 'tp', value: number) => {
      const openPrice = order.orderKind === 'stop-limit'
        ? (order.limitPrice ?? order.entryPrice)
        : order.entryPrice

      if (order.type === 'buy') {
        return field === 'sl'
          ? Math.min(value, openPrice - (state.config.spread ?? 0) - minMove)
          : Math.max(value, openPrice + minMove)
      }

      return field === 'sl'
        ? Math.max(value, openPrice + (state.config.spread ?? 0) + minMove)
        : Math.min(value, openPrice - minMove)
    }
    const clampPendingLimit = (order: PendingOrder, value: number) => {
      return order.type === 'buy'
        ? Math.max(value, order.entryPrice)
        : Math.min(value, order.entryPrice)
    }

    if (target.kind === 'trade') {
      if (target.field === 'entry') {
        const trade = useSimStore.getState().trades.find(item => item.id === target.id)
        if (!trade || trade.closePrice !== undefined) return

        if (trade.type === 'buy') {
          const field = nextPrice >= trade.openPrice ? 'tp' : 'sl'
          pendingTradeLineUpdate.current = {
            kind: 'trade',
            id: target.id,
            levels: { [field]: roundSymbolPrice(symbol, clampLevel(trade.type, field, nextPrice)) },
          }
        } else {
          const field = nextPrice <= trade.openPrice ? 'tp' : 'sl'
          pendingTradeLineUpdate.current = {
            kind: 'trade',
            id: target.id,
            levels: { [field]: roundSymbolPrice(symbol, clampLevel(trade.type, field, nextPrice)) },
          }
        }
      } else {
        const trade = useSimStore.getState().trades.find(item => item.id === target.id)
        if (!trade || trade.closePrice !== undefined) return
        const nextLevel = roundSymbolPrice(symbol, clampLevel(trade.type, target.field, nextPrice))
        pendingTradeLineUpdate.current = {
          kind: 'trade',
          id: target.id,
          levels: { [target.field]: nextLevel } as Partial<Pick<Trade, 'sl' | 'tp'>>,
        }
      }
    } else {
      const pending = useSimStore.getState().pendingOrders.find(item => item.id === target.id)
      if (!pending || pending.status !== 'pending') return
      const updates = target.field === 'sl' || target.field === 'tp'
        ? { [target.field]: roundSymbolPrice(symbol, clampPendingLevel(pending, target.field, nextPrice)) }
        : target.field === 'entryPrice'
          ? { entryPrice: roundSymbolPrice(symbol, clampPendingEntry(pending, nextPrice)) }
          : { limitPrice: roundSymbolPrice(symbol, clampPendingLimit(pending, nextPrice)) }
      pendingTradeLineUpdate.current = {
        kind: 'pending',
        id: target.id,
        updates: updates as Partial<PendingOrder>,
      }
    }
  }, [])

  const commitTradeLineDrag = useCallback(() => {
    const update = pendingTradeLineUpdate.current
    pendingTradeLineUpdate.current = null
    draggingTradeLine.current = null

    if (!update) {
      redrawCanvas()
      return
    }

    if (update.kind === 'trade') {
      updateTradeLevels(update.id, update.levels)
    } else {
      updatePendingOrder(update.id, update.updates)
    }
    redrawCanvas()
  }, [redrawCanvas, updatePendingOrder, updateTradeLevels])

  // ── Wheel passthrough: fix scroll when cursor mode is cross/dot ──
  const handleWheel = useCallback((e: WheelEvent) => {
    // Forward wheel events to the chart container so scroll works
    if (!containerRef.current) return
    containerRef.current.dispatchEvent(new WheelEvent('wheel', {
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaZ: e.deltaZ,
      deltaMode: e.deltaMode,
      bubbles: true,
      cancelable: true,
    }))
  }, [])

  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: true })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // ── Sync canvas size ─────────────────────────
  useEffect(() => {
    const canvas = overlayRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const sync = () => {
      canvas.width  = container.clientWidth
      canvas.height = container.clientHeight
      redrawCanvas()
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(container)
    return () => ro.disconnect()
  }, [redrawCanvas])

  useEffect(() => { redrawCanvas() }, [drawings, redrawCanvas])
  useEffect(() => { redrawCanvas() }, [drawingsHidden, drawingsLocked, cursorMode, activeTool, redrawCanvas])
  useEffect(() => { redrawCanvas() }, [trades, pendingOrders, visibleIndex, redrawCanvas])
  useEffect(() => { requestAnimationFrame(() => redrawCanvas()) }, [priceScaleMode, redrawCanvas])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableShortcutTarget(e.target)) return
      const isSnapshotDownload = (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.code === 'KeyS'
      const isSnapshotCopy = (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === 'KeyS'

      if (isSnapshotDownload || isSnapshotCopy) {
        e.preventDefault()
        if (isSnapshotDownload) void downloadChartImage()
        else void copyChartImage()
        return
      }

      const sel = selectedRef.current
      if (drawingsLockedRef.current || drawingsHiddenRef.current) return
      const key = e.key.toLowerCase()
      const isCopy = (e.ctrlKey || e.metaKey) && (e.code === 'KeyC' || key === 'c')
      const isPaste = (e.ctrlKey || e.metaKey) && (e.code === 'KeyV' || key === 'v')
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
        setSelected(null); selectedRef.current = null
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
        const offset = 20
        const newD = cloneDrawing(d, offset, offset)
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
  }, [activateDrawTool, cloneDrawing, copyChartImage, downloadChartImage, redrawCanvas, selectDrawing])

  const clearDrawings = () => {
    drawingsRef.current = []
    setDrawings([])
    selectedRef.current = null
    setSelected(null)
    const ctx = overlayRef.current?.getContext('2d')
    ctx?.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height)
    setActiveTool(null)
  }

  const zoomTimeScale = useCallback((direction: 'in' | 'out') => {
    const chart = chartRef.current
    if (!chart) return
    const timeScale = chart.timeScale()
    const range = timeScale.getVisibleLogicalRange()
    if (!range) return
    const center = (range.from + range.to) / 2
    const width = range.to - range.from
    const nextWidth = Math.max(ZOOM.MIN_BARS, width * (direction === 'in' ? ZOOM.IN_FACTOR : ZOOM.OUT_FACTOR))
    timeScale.setVisibleLogicalRange({
      from: center - nextWidth / 2,
      to: center + nextWidth / 2,
    })
    redrawCanvas()
  }, [redrawCanvas])

  const activateRangeMeasure = useCallback(() => {
    setOpenPanel(null)
    setActiveTool('dateandpricerange')
    setCursorMode('arrow')
  }, [])

  const toggleDrawingsLock = useCallback(() => {
    setDrawingsLocked(prev => {
      const next = !prev
      if (next) {
        setSelected(null)
        selectedRef.current = null
      }
      return next
    })
    redrawCanvas()
  }, [redrawCanvas])

  const toggleDrawingsHidden = useCallback(() => {
    setDrawingsHidden(prev => {
      const next = !prev
      setSelected(null)
      selectedRef.current = null
      return next
    })
  }, [])

  const applyPriceScaleMode = useCallback((mode: 'regular' | 'percent' | 'log') => {
    const chart = chartRef.current
    if (!chart) return
    const priceScale = chart.priceScale('right')
    priceScale.applyOptions({
      mode: mode === 'percent'
        ? PriceScaleMode.Percentage
        : mode === 'log'
          ? PriceScaleMode.Logarithmic
          : PriceScaleMode.Normal,
    })
    if (autoScaleEnabledRef.current) {
      priceScale.setAutoScale(true)
    }
    setPriceScaleMode(mode)
    requestAnimationFrame(() => redrawCanvas())
  }, [redrawCanvas])

  const togglePriceScaleMode = useCallback((mode: 'percent' | 'log') => {
    applyPriceScaleMode(priceScaleMode === mode ? 'regular' : mode)
  }, [applyPriceScaleMode, priceScaleMode])

  const enableAutoScale = useCallback(() => {
    const next = !autoScaleEnabledRef.current
    autoScaleEnabledRef.current = next
    setAutoScaleEnabled(next)
    if (next) {
      chartRef.current?.priceScale('right').setAutoScale(true)
    }
    requestAnimationFrame(() => redrawCanvas())
  }, [redrawCanvas])

  const disableAutoScaleForManualPriceScale = useCallback((mx: number, my: number) => {
    const canvas = overlayRef.current
    const chart = chartRef.current
    if (!canvas || !chart) return
    const priceScaleWidth = chart.priceScale('right').width() ?? 0
    const timeScaleHeight = chart.timeScale().height() ?? 0
    const inPriceScale = priceScaleWidth > 0 && mx >= canvas.width - priceScaleWidth && my < canvas.height - timeScaleHeight
    if (inPriceScale) {
      autoScaleEnabledRef.current = false
      setAutoScaleEnabled(false)
    }
  }, [])

  const getAxisHit = useCallback((mx: number, my: number) => {
    const canvas = overlayRef.current
    const chart = chartRef.current
    if (!canvas || !chart) return { price: false, time: false }
    const priceScaleWidth = chart.priceScale('right').width() ?? 0
    const timeScaleHeight = chart.timeScale().height() ?? 0
    const price = priceScaleWidth > 0 && mx >= canvas.width - priceScaleWidth && my < canvas.height - timeScaleHeight
    const time = timeScaleHeight > 0 && my >= canvas.height - timeScaleHeight && mx < canvas.width - priceScaleWidth
    return { price, time }
  }, [])

  const setAutoScaleOn = useCallback(() => {
    autoScaleEnabledRef.current = true
    setAutoScaleEnabled(true)
    chartRef.current?.priceScale('right').setAutoScale(true)
    requestAnimationFrame(() => redrawCanvas())
  }, [redrawCanvas])

  // Determine canvas pointer-events:
  // - eraser: always active
  // - activeTool: active
  // - cross/dot: only for cursor drawing, but we pass wheel through manually → keep none to allow chart interaction
  const canvasPointerEvents: React.CSSProperties['pointerEvents'] =
    cursorMode === 'eraser' || cursorMode === 'arrow' || activeTool
      ? 'auto'
      : cursorMode === 'cross' || cursorMode === 'dot'
        ? 'none'
        : 'none'
  const chartCursorClass = getChartCursorClass(cursorMode, activeTool)
  const updateAxisCursor = useCallback((mx: number, my: number) => {
    const canvas = overlayRef.current
    const chart = chartRef.current
    if (!canvas || !chart) return
    const priceScaleWidth = chart.priceScale('right').width() ?? 0
    const timeScaleHeight = chart.timeScale().height() ?? 0
    const inPriceScale = priceScaleWidth > 0 && mx >= canvas.width - priceScaleWidth && my < canvas.height - timeScaleHeight
    const inTimeScale = timeScaleHeight > 0 && my >= canvas.height - timeScaleHeight && mx < canvas.width - priceScaleWidth
    const next = inPriceScale ? 'ns-resize' : inTimeScale ? 'ew-resize' : null
    setAxisCursor(prev => prev === next ? prev : next)
  }, [])

  // For cross/dot cursor overlay, listen on the container div instead
  const handleContainerMouseMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const canvas = overlayRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    mousePos.current = { x: mx, y: my }
    updateAxisCursor(mx, my)
    setDrawingNodeCursor(null)

    if (activeOrderPriceField) {
      redrawCanvas()
    }

    if (draggingTradeLine.current) {
      e.preventDefault(); e.stopPropagation()
      applyTradeLineDrag(my)
      redrawCanvas()
      return
    }

    if (handleContainerDrag(mx, my)) {
      e.preventDefault(); e.stopPropagation()
      return
    }

    if (activeTool) return
    const drawingHit = findHitDrawing(mx, my)
    setDrawingNodeCursor(drawingHit && drawingHit.nodeIdx !== -1
      ? getDrawingNodeCursor(drawingHit.drawing, drawingHit.nodeIdx)
      : null)
    if (cursorMode !== 'cross' && cursorMode !== 'dot') return
    redrawCanvas()
  }, [cursorMode, activeTool, activeOrderPriceField, applyTradeLineDrag, redrawCanvas, handleContainerDrag, updateAxisCursor, findHitDrawing, getDrawingNodeCursor])

  const handleOverlayMouseMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (rect) {
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      updateAxisCursor(mx, my)
      const drawingHit = !activeTool ? findHitDrawing(mx, my) : null
      setDrawingNodeCursor(drawingHit && drawingHit.nodeIdx !== -1
        ? getDrawingNodeCursor(drawingHit.drawing, drawingHit.nodeIdx)
        : null)
    }
    handleMouseMove(e)
  }, [activeTool, findHitDrawing, getDrawingNodeCursor, handleMouseMove, updateAxisCursor])

  const handleContainerMouseDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const canvas = overlayRef.current
    if (canvas) {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const hit = getAxisHit(mx, my)
      if (hit.price || hit.time) {
        if (hit.price) disableAutoScaleForManualPriceScale(mx, my)
        return
      }
      if (commitOrderPricePick(my)) {
        e.preventDefault(); e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        return
      }
    }
    if (activeTool) return
    if (cursorMode !== 'cross' && cursorMode !== 'dot') return
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const tradeLine = findHitTradeLine(mx, my)
    if (tradeLine) {
      e.preventDefault(); e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      disableChartGestureHandling()
      draggingTradeLine.current = tradeLine
      return
    }

    const hit = findHitDrawing(mx, my)
    if (hit) {
      e.preventDefault(); e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      if (!EDITABLE_TEXT_TOOLS.has(hit.drawing.tool)) stopTextEdit()
      if (drawingsLockedRef.current) {
        selectDrawing(hit.drawing, false)
        redrawCanvas()
      } else {
        disableChartGestureHandling()
        interaction.beginDrawingDrag(hit.drawing, hit.nodeIdx, mx, my, e.ctrlKey || e.metaKey)
      }
    } else {
      stopTextEdit()
      setSelected(null)
      selectedRef.current = null
      redrawCanvas()
    }
  }, [activeTool, cursorMode, commitOrderPricePick, disableAutoScaleForManualPriceScale, disableChartGestureHandling, findHitDrawing, findHitTradeLine, getAxisHit, interaction, redrawCanvas, selectDrawing, stopTextEdit])

  const handleContainerMouseUp = useCallback(() => {
    if (draggingTradeLine.current) {
      commitTradeLineDrag()
      restoreChartGestureHandling()
      return
    }
    if (interaction.draggingDrawingId.current !== null) {
      interaction.handleMouseUp()
      restoreChartGestureHandling()
    }
  }, [commitTradeLineDrag, interaction, restoreChartGestureHandling])

  const handleContainerDoubleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const canvas = overlayRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const drawingHit = findHitDrawing(mx, my)
    if (drawingHit && EDITABLE_TEXT_TOOLS.has(drawingHit.drawing.tool)) {
      e.preventDefault()
      e.stopPropagation()
      selectDrawing(drawingHit.drawing)
      startTextEdit(drawingHit.drawing.id)
      redrawCanvas()
      return
    }
    const hit = getAxisHit(mx, my)
    if (!hit.price && !hit.time) return
    e.preventDefault()
    e.stopPropagation()
    if (hit.price) {
      setAutoScaleOn()
      return
    }
    scrollChartForward()
  }, [findHitDrawing, getAxisHit, redrawCanvas, scrollChartForward, selectDrawing, setAutoScaleOn, startTextEdit])

  const handleContainerWheelCapture = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const canvas = overlayRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    disableAutoScaleForManualPriceScale(e.clientX - rect.left, e.clientY - rect.top)
  }, [disableAutoScaleForManualPriceScale])

  const handleContainerMouseLeave = useCallback(() => {
    mousePos.current = null
    setAxisCursor(null)
    setDrawingNodeCursor(null)
    draggingTradeLine.current = null
    pendingTradeLineUpdate.current = null
    redrawCanvas()
  }, [redrawCanvas])

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current
    if (!root) return

    if (document.fullscreenElement === root) {
      await document.exitFullscreen()
      return
    }

    await root.requestFullscreen()
  }, [])

  useEffect(() => {
    const syncFullscreen = () => {
      const next = document.fullscreenElement === rootRef.current
      setIsFullscreen(next)
      requestAnimationFrame(() => {
        chartRef.current?.applyOptions({
          width: containerRef.current?.clientWidth ?? 0,
          height: containerRef.current?.clientHeight ?? 0,
        })
        redrawCanvasRef.current?.()
      })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F11') return
      event.preventDefault()
      void toggleFullscreen()
    }

    document.addEventListener('fullscreenchange', syncFullscreen)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [toggleFullscreen])

  const topPanelOpen =
    openPanel === 'timeframe' ||
    openPanel === 'top-indicators' ||
    openPanel === 'top-settings' ||
    openPanel === 'snapshot'

  const indicatorLegendEntries = Array.from(activeIndicators).map(name => {
    const indicator = indicatorSeriesByName.get(name)
    const paneIndex = indicator?.series[0]?.getPane().paneIndex() ?? 0
    return {
      name,
      indicator,
      paneIndex,
      target: paneIndex > 0 ? getIndicatorPaneTarget(indicator) : null,
      values: getIndicatorLegendValues(indicator),
    }
  })
  const overlayIndicatorLegends = indicatorLegendEntries.filter(item => item.paneIndex === 0)
  const paneIndicatorLegends = indicatorLegendEntries.filter(item => item.paneIndex > 0)

  const selectedPanelDrawing = selected ? drawings.find(drawing => drawing.id === selected.id) : undefined
  const selectionPanelWidth = selectedPanelDrawing ? getDrawingSettingsPanelWidth(selectedPanelDrawing.tool) : 0
  const selectionPanelLeft = selected
    ? `clamp(44px, ${selected.panelX - selectionPanelWidth / 2}px, calc(100% - ${selectionPanelWidth + 8}px))`
    : 44
  const selectionPanelTop = selected ? Math.max(selected.panelY, 8) : 8

  const updateDrawingSettings = (drawingId: string, patch: Partial<Pick<Drawing, 'color' | 'opacity' | 'lineStyle' | 'lineWidth'>>) => {
    const next = drawingsRef.current.map(drawing =>
      drawing.id === drawingId ? { ...drawing, ...patch } : drawing
    )
    drawingsRef.current = next
    setDrawings(next)
    redrawCanvasRef.current?.()
  }

  const deleteDrawing = (drawingId: string) => {
    const next = drawingsRef.current.filter(drawing => drawing.id !== drawingId)
    drawingsRef.current = next
    setDrawings(next)
    setSelected(null)
    selectedRef.current = null
    redrawCanvasRef.current?.()
  }

  const captureChartSettingsSnapshot = () => {
    chartSettingsSnapshotRef.current = {
      canvas: { ...canvasSettings },
      colorBarsPreviousClose: settingsColorBarsPreviousClose,
      precision: settingsPrecision,
      timeZone: chartTimeZone,
      bodyVisible: settingsBodyVisible,
      bordersVisible: settingsBordersVisible,
      wickVisible: settingsWickVisible,
      colors: { ...settingsColors },
      colorOpacity: { ...settingsColorOpacity },
    }
  }

  const cancelChartSettings = () => {
    const snapshot = chartSettingsSnapshotRef.current
    if (snapshot) {
      setCanvasSettings(ensureCanvasTextContrast({ ...snapshot.canvas }))
      setSettingsColorBarsPreviousClose(snapshot.colorBarsPreviousClose)
      setSettingsPrecision(snapshot.precision)
      setChartTimeZone(snapshot.timeZone)
      setSettingsBodyVisible(snapshot.bodyVisible)
      setSettingsBordersVisible(snapshot.bordersVisible)
      setSettingsWickVisible(snapshot.wickVisible)
      setSettingsColors({ ...snapshot.colors })
      setSettingsColorOpacity({ ...snapshot.colorOpacity })
    }
    chartSettingsSnapshotRef.current = null
    setSettingsTemplateOpen(false)
    setSettingsPrecisionOpen(false)
    setSettingsTimezoneOpen(false)
    setOpenPanel(null)
  }

  const confirmChartSettings = () => {
    saveChartCanvasSettings(canvasSettings)
    chartSettingsSnapshotRef.current = null
    setSettingsTemplateOpen(false)
    setSettingsPrecisionOpen(false)
    setSettingsTimezoneOpen(false)
    setOpenPanel(null)
  }

  const applyCanvasTemplate = (template: 'default' | 'clean' | 'sea-blue') => {
    if (template === 'default') {
      setCanvasSettings(ensureCanvasTextContrast({ ...DEFAULT_CHART_CANVAS_SETTINGS }))
    } else if (template === 'clean') {
      setCanvasSettings(ensureCanvasTextContrast({
        ...DEFAULT_CHART_CANVAS_SETTINGS,
        gridMode: 'none',
        sessionBreaksVisible: false,
        watermarkVisible: false,
      }))
    } else {
      setCanvasSettings(ensureCanvasTextContrast({
        ...DEFAULT_CHART_CANVAS_SETTINGS,
        backgroundType: 'gradient',
        backgroundTopColor: '#ffffff',
        backgroundBottomColor: '#dff3f7',
        gridVerticalColor: '#00acc1',
        gridHorizontalColor: '#00acc1',
        gridVerticalOpacity: 10,
        gridHorizontalOpacity: 10,
        crosshairColor: '#0097a7',
        watermarkColor: '#00acc1',
      }))
    }
    setSettingsTemplateOpen(false)
  }

  return (
    <div
      ref={rootRef}
      className="sim-chart-root"
      onContextMenu={event => event.preventDefault()}
      style={{
        '--chart-bg': canvasUiPalette.background,
        '--chart-text': colorWithOpacity(canvasSettings.scaleTextColor, canvasSettings.scaleTextOpacity),
        position: 'relative',
        width: '100%',
        height: '100%',
        background: canvasSettings.backgroundType === 'gradient'
          ? `linear-gradient(${colorWithOpacity(canvasSettings.backgroundTopColor, canvasSettings.backgroundTopOpacity)}, ${colorWithOpacity(canvasSettings.backgroundBottomColor, canvasSettings.backgroundBottomOpacity)})`
          : colorWithOpacity(canvasSettings.backgroundTopColor, canvasSettings.backgroundTopOpacity),
        direction: 'ltr',
      } as CSSProperties}
    >
      <style>
        {`
          .sim-chart-cursor-none, .sim-chart-cursor-none * { cursor: none !important; }
          .sim-chart-cursor-default, .sim-chart-cursor-default * { cursor: default !important; }
          .sim-chart-cursor-cell, .sim-chart-cursor-cell * { cursor: cell !important; }
          .sim-chart-cursor-crosshair, .sim-chart-cursor-crosshair * { cursor: crosshair !important; }
          .sim-chart-axis-y, .sim-chart-axis-y * { cursor: ns-resize !important; }
          .sim-chart-axis-x, .sim-chart-axis-x * { cursor: ew-resize !important; }
          .sim-chart-node-y, .sim-chart-node-y * { cursor: ns-resize !important; }
          .sim-chart-node-x, .sim-chart-node-x * { cursor: ew-resize !important; }
          .sim-chart-floating-actions {
            position: absolute;
            right: 78px;
            bottom: 76px;
            z-index: 35;
            display: flex;
            align-items: center;
            gap: 8px;
            pointer-events: auto;
          }
          .sim-chart-floating-button {
            width: 38px;
            height: 38px;
            border: 1px solid rgba(148, 163, 184, 0.24);
            border-radius: 9px;
            background: rgba(255, 255, 255, 0.92);
            color: rgba(71, 85, 105, 0.86);
            display: grid;
            place-items: center;
            cursor: pointer;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
            backdrop-filter: blur(10px);
            transition: color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, background 160ms ease;
          }
          .sim-chart-floating-button:hover {
            color: var(--accent);
            border-color: color-mix(in srgb, var(--accent) 38%, transparent);
            background: rgba(248, 251, 255, 0.98);
            box-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 22%, transparent);
            transform: translateY(-1px);
          }
          .sim-chart-floating-button:disabled {
            cursor: wait;
            color: rgba(120, 123, 134, 0.7);
            border-color: rgba(148, 163, 184, 0.18);
            background: rgba(255, 255, 255, 0.72);
            box-shadow: none;
            transform: none;
          }
          .sim-chart-symbol-status {
            position: absolute;
            top: 44px;
            left: 62px;
            z-index: 22;
            max-width: calc(100% - 150px);
            min-height: 28px;
            display: flex;
            align-items: center;
            gap: 7px;
            color: color-mix(in srgb, var(--chart-text) 92%, transparent);
            font-family: 'Vazirmatn', sans-serif;
            font-size: 12px;
            line-height: 1;
            white-space: nowrap;
            overflow: hidden;
            pointer-events: none;
            direction: ltr;
            text-shadow: 0 1px 0 color-mix(in srgb, var(--chart-bg) 85%, transparent);
          }
          .sim-chart-symbol-icons {
            width: 31px;
            height: 22px;
            position: relative;
            flex: 0 0 31px;
          }
          .sim-chart-symbol-icons img {
            position: absolute;
            top: 1px;
            width: 20px;
            height: 20px;
            object-fit: cover;
            border-radius: 50%;
            border: 1px solid rgba(255,255,255,0.92);
            box-shadow: 0 1px 3px rgba(15,23,42,0.22);
          }
          .sim-chart-symbol-icons img:first-child { left: 0; z-index: 2; }
          .sim-chart-symbol-icons img:nth-child(2) { left: 11px; z-index: 1; }
          .sim-chart-symbol-title {
            font-size: 13px;
            font-weight: 700;
          }
          .sim-chart-symbol-separator { color: rgba(71,85,105,0.52); }
          .sim-chart-symbol-data-offline {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #787b86;
            box-shadow: 0 0 0 3px rgba(120,123,134,0.14);
            margin: 0 3px;
          }
          .sim-chart-symbol-ohlc {
            display: flex;
            align-items: center;
            gap: 4px;
            font-variant-numeric: tabular-nums;
          }
          .sim-chart-symbol-change-positive { color: #089981; }
          .sim-chart-symbol-change-negative { color: #f23645; }
          .sim-chart-overlay-indicator-legends {
            position: absolute;
            top: 76px;
            left: 62px;
            z-index: 23;
            max-width: calc(100% - 150px);
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
            pointer-events: none;
            direction: ltr;
          }
          .sim-chart-pane-indicator-legends {
            position: absolute;
            top: 5px;
            left: 62px;
            z-index: 8;
            max-width: calc(100% - 76px);
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
            pointer-events: none;
            direction: ltr;
          }
          .sim-chart-indicator-legend-row {
            width: max-content;
            max-width: 100%;
            min-height: 28px;
            padding: 2px 4px 2px 6px;
            border: 1px solid transparent;
            border-radius: 4px;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            gap: 5px;
            color: color-mix(in srgb, var(--chart-text) 94%, transparent);
            background: transparent;
            font-family: 'Vazirmatn', sans-serif;
            font-size: 12px;
            line-height: 1;
            white-space: nowrap;
            pointer-events: auto;
            cursor: default !important;
            outline: none;
            text-shadow: 0 1px 0 color-mix(in srgb, var(--chart-bg) 85%, transparent);
            transition: border-color 100ms ease, background 100ms ease, box-shadow 100ms ease;
          }
          .sim-chart-indicator-legend-row:hover,
          .sim-chart-indicator-legend-row:focus-within {
            border-color: color-mix(in srgb, var(--chart-text) 24%, transparent);
            background: color-mix(in srgb, var(--chart-bg) 92%, transparent);
          }
          .sim-chart-indicator-legend-row-selected,
          .sim-chart-indicator-legend-row-selected:hover,
          .sim-chart-indicator-legend-row-selected:focus-within {
            border-color: #2962ff;
            background: color-mix(in srgb, var(--chart-bg) 94%, transparent);
            box-shadow: 0 0 0 1px color-mix(in srgb, #2962ff 18%, transparent);
          }
          .sim-chart-indicator-legend-name {
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .sim-chart-indicator-legend-value {
            flex: 0 0 auto;
            font-variant-numeric: tabular-nums;
            font-weight: 500;
          }
          .sim-chart-indicator-legend-row-hidden .sim-chart-indicator-legend-name,
          .sim-chart-indicator-legend-row-hidden .sim-chart-indicator-legend-value {
            opacity: 0.46;
          }
          .sim-chart-indicator-legend-actions {
            height: 22px;
            margin-left: 3px;
            padding-left: 3px;
            border-left: 1px solid color-mix(in srgb, var(--chart-text) 14%, transparent);
            display: inline-flex;
            align-items: center;
            gap: 2px;
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
            transition: opacity 80ms ease, visibility 80ms ease;
          }
          .sim-chart-indicator-legend-row:hover .sim-chart-indicator-legend-actions,
          .sim-chart-indicator-legend-row:focus-within .sim-chart-indicator-legend-actions,
          .sim-chart-indicator-legend-row-selected .sim-chart-indicator-legend-actions {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
          }
          .sim-chart-indicator-legend-actions button {
            width: 22px;
            height: 22px;
            padding: 0;
            border: 0;
            border-radius: 4px;
            display: grid;
            place-items: center;
            color: color-mix(in srgb, var(--chart-text) 78%, transparent);
            background: transparent;
            cursor: pointer !important;
          }
          .sim-chart-indicator-legend-actions button:hover,
          .sim-chart-indicator-legend-actions button:focus-visible {
            color: var(--chart-text);
            background: color-mix(in srgb, var(--chart-text) 10%, transparent);
            outline: none;
          }
          .sim-chart-indicator-legend-actions button[aria-disabled='true'] {
            cursor: default;
          }
          .sim-chart-indicator-legend-actions svg {
            width: 16px;
            height: 16px;
            display: block;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.7;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          .sim-chart-surface .sim-chart-indicator-legend-row,
          .sim-chart-surface .sim-chart-indicator-legend-name,
          .sim-chart-surface .sim-chart-indicator-legend-value,
          .sim-chart-surface .sim-chart-indicator-legend-actions {
            cursor: default !important;
          }
          .sim-chart-surface .sim-chart-indicator-legend-actions button,
          .sim-chart-surface .sim-chart-indicator-legend-actions button * {
            cursor: pointer !important;
          }
          .sim-chart-tools button svg {
            width: 28px;
            height: 28px;
            display: block;
            margin: 0;
            flex: 0 0 28px;
          }
          .sim-chart-topbar button > svg,
          .sim-chart-topbar button > span > svg {
            display: block;
            margin: 0;
          }
          .sim-chart-topbar button[title="Settings"] > svg {
            width: 28px;
            height: 28px;
            flex: 0 0 28px;
          }
          .sim-chart-tools button[title="More tools"] > span > svg,
          .sim-chart-tools button[title="Cursor options"] > span > svg {
            width: 7px;
            height: 7px;
            flex: 0 0 7px;
          }
          .sim-chart-flyout-icon > svg {
            width: 24px;
            height: 24px;
            display: block;
            margin: 0;
          }
          .sim-chart-indicator-trigger > svg {
            width: 19px;
            height: 19px;
          }
          .sim-chart-camera-icon {
            width: 28px;
            height: 28px;
            display: grid;
            place-items: center;
            overflow: hidden;
          }
          .sim-chart-camera-icon > svg {
            width: 28px;
            height: 28px;
            display: block;
            flex: 0 0 28px;
          }
          .sim-chart-line-width-trigger {
            position: relative;
            min-height: 30px;
            border-radius: 4px !important;
            transition: background 100ms ease, color 100ms ease;
          }
          .sim-chart-line-width-trigger:hover,
          .sim-chart-line-width-trigger:focus-visible {
            color: #f5f5f5 !important;
            background: #3b3b42 !important;
            box-shadow: none !important;
            outline: none;
          }
          .sim-chart-line-width-trigger[aria-expanded="true"] {
            color: #f5f5f5 !important;
            background: #3b3b42 !important;
          }
          .sim-chart-line-width-trigger:active {
            background: #45454d !important;
          }
          .sim-chart-line-width-trigger[data-tooltip]::after {
            content: attr(data-tooltip);
            position: absolute;
            left: 50%;
            bottom: calc(100% + 9px);
            z-index: 100;
            padding: 5px 8px;
            border-radius: 2px;
            color: #fff;
            background: #26262b;
            font-size: 12px;
            line-height: 1;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transform: translate(-50%, 2px);
            visibility: hidden;
            transition: opacity 80ms ease 350ms, transform 80ms ease 350ms, visibility 0s linear 430ms;
          }
          .sim-chart-line-width-trigger[data-tooltip]::before {
            content: '';
            position: absolute;
            left: 50%;
            bottom: calc(100% + 4px);
            z-index: 101;
            border: 5px solid transparent;
            border-top-color: #26262b;
            pointer-events: none;
            opacity: 0;
            transform: translateX(-50%);
            visibility: hidden;
            transition: opacity 80ms ease 350ms, visibility 0s linear 430ms;
          }
          .sim-chart-line-width-trigger[data-tooltip]:hover::after,
          .sim-chart-line-width-trigger[data-tooltip]:hover::before,
          .sim-chart-line-width-trigger[data-tooltip]:focus-visible::after,
          .sim-chart-line-width-trigger[data-tooltip]:focus-visible::before {
            opacity: 1;
            visibility: visible;
            transition-delay: 350ms;
          }
          .sim-chart-line-width-trigger[data-tooltip]:hover::after,
          .sim-chart-line-width-trigger[data-tooltip]:focus-visible::after {
            transform: translate(-50%, 0);
          }
          .sim-chart-drawing-tool-identity-icon {
            width: 18px;
            height: 18px;
            display: grid;
            place-items: center;
            overflow: hidden;
            line-height: 0;
          }
          .sim-chart-drawing-tool-identity-icon > svg {
            display: block;
            width: 18px !important;
            height: 18px !important;
            max-width: 18px;
            max-height: 18px;
            flex: 0 0 18px;
          }
          .sim-chart-drawing-delete-trigger > svg {
            display: block;
            width: 18px !important;
            height: 18px !important;
            flex: 0 0 18px;
          }
          .sim-chart-color-swatch {
            transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
          }
          .sim-chart-color-swatch:hover,
          .sim-chart-color-swatch:focus-visible {
            z-index: 1;
            transform: scale(1.18);
            box-shadow: 0 2px 7px rgba(0,0,0,.4);
            filter: brightness(1.08);
            outline: 2px solid var(--text-primary) !important;
            outline-offset: 1px;
          }
          .sim-chart-line-width-option {
            position: relative;
            transition: background 120ms ease, color 120ms ease;
          }
          .sim-chart-line-width-option:hover,
          .sim-chart-line-width-option:focus-visible {
            background: color-mix(in srgb, var(--text-primary) 12%, transparent) !important;
            outline: none;
          }
          .sim-chart-line-width-option[data-active="true"] {
            color: #111318 !important;
            background: #f4f4f5 !important;
          }
          .sim-chart-line-width-option[data-active="true"]:hover,
          .sim-chart-line-width-option[data-active="true"]:focus-visible {
            background: #ffffff !important;
          }
          .sim-chart-opacity-range {
            appearance: none;
            width: 100%;
            height: 10px;
            margin: 0;
            border: 0;
            border-radius: 5px;
            cursor: pointer;
            background:
              linear-gradient(color-mix(in srgb, var(--drawing-color) var(--drawing-opacity), transparent), color-mix(in srgb, var(--drawing-color) var(--drawing-opacity), transparent)),
              conic-gradient(#b8bcc2 25%, #fff 0 50%, #b8bcc2 0 75%, #fff 0) 0 / 8px 8px;
            box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 25%, transparent);
          }
          .sim-chart-opacity-range::-webkit-slider-runnable-track {
            height: 10px;
            border-radius: 5px;
            background: transparent;
          }
          .sim-chart-opacity-range::-webkit-slider-thumb {
            appearance: none;
            width: 13px;
            height: 13px;
            margin-top: -1.5px;
            border: 2px solid var(--text-primary);
            border-radius: 50%;
            background: var(--surface-0);
            box-shadow: 0 1px 3px rgba(0,0,0,.35);
          }
          .sim-chart-opacity-range::-moz-range-track {
            height: 10px;
            border-radius: 5px;
            background: transparent;
          }
          .sim-chart-opacity-range::-moz-range-thumb {
            width: 10px;
            height: 10px;
            border: 2px solid var(--text-primary);
            border-radius: 50%;
            background: var(--surface-0);
          }
          input[aria-label="Opacity percentage"]::-webkit-inner-spin-button,
          input[aria-label="Opacity percentage"]::-webkit-outer-spin-button {
            appearance: none;
            margin: 0;
          }
          input[aria-label="Opacity percentage"] { -moz-appearance: textfield; }
          .sim-chart-snapshot-menu {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            z-index: 5000;
            width: 300px;
            padding: 12px 0 8px;
            border: 1px solid var(--border-soft);
            border-radius: 4px;
            background: var(--surface-0);
            color: var(--app-text);
            box-shadow: 0 14px 34px var(--shadow-deep);
          }
          .sim-chart-snapshot-title {
            padding: 0 12px 8px;
            color: var(--text-dim);
            font-size: 10px;
            font-weight: 400;
            letter-spacing: 0;
            text-transform: uppercase;
          }
          .sim-chart-snapshot-item {
            width: 100%;
            height: 32px;
            border: none;
            background: transparent;
            color: inherit;
            display: grid;
            grid-template-columns: 28px 1fr auto;
            align-items: center;
            gap: 8px;
            padding: 0 12px;
            cursor: pointer;
            font-family: inherit;
            font-size: 13px;
            font-weight: 400;
            text-align: left;
          }
          .sim-chart-snapshot-item:hover {
            background: var(--surface-soft);
          }
          .sim-chart-snapshot-icon {
            color: var(--tool-icon-active);
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .sim-chart-snapshot-icon > svg {
            width: 28px;
            height: 28px;
            display: block;
            margin: 0;
            flex: 0 0 28px;
          }
          .sim-chart-snapshot-label {
            font-size: 13px;
            font-weight: 400;
            white-space: nowrap;
          }
          .sim-chart-snapshot-shortcut {
            color: var(--tool-shortcut);
            font-size: 12px;
            font-weight: 400;
            white-space: nowrap;
          }
          .sim-chart-tools {
            overflow-y: auto;
            overflow-x: visible;
            direction: rtl;
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          .sim-chart-tools > * {
            direction: ltr;
          }
          .sim-chart-tools::-webkit-scrollbar {
            display: none;
          }
          .sim-chart-root {
            touch-action: pan-x pan-y;
          }
          .sim-chart-root:fullscreen {
            width: 100vw !important;
            height: 100vh !important;
            background: var(--chart-bg);
          }
          .sim-chart-topbar {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }
          .sim-chart-topbar::-webkit-scrollbar {
            display: none;
          }
          .sim-chart-surface {
            touch-action: pan-x pan-y;
            bottom: 32px !important;
            height: auto !important;
          }
          .sim-chart-drawing-drag-locked {
            touch-action: none !important;
          }
          .sim-chart-overlay {
            touch-action: none;
            bottom: 32px !important;
          }
          .sim-chart-bottom-bar {
            position: absolute;
            left: 52px;
            right: 0;
            bottom: 0;
            height: 32px;
            z-index: 38;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 0 12px;
            background: var(--chart-toolbar);
            border-top: 1px solid color-mix(in srgb, var(--chart-axis) 70%, transparent);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
            color: var(--text-muted);
            font-size: 12px;
            font-family: 'Vazirmatn', sans-serif;
            direction: ltr;
            pointer-events: auto;
          }
          .sim-chart-bottom-controls {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
          }
          .sim-chart-bottom-clock {
            border: none;
            background: transparent;
            font: inherit;
            color: color-mix(in srgb, var(--tool-icon-active) 76%, var(--text-muted));
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            cursor: pointer;
            padding: 3px 6px;
            border-radius: 4px;
            line-height: 1.15;
          }
          .sim-chart-bottom-clock:hover,
          .sim-chart-bottom-clock-active {
            color: var(--app-text);
            background: color-mix(in srgb, var(--tool-icon-active) 10%, transparent);
          }
          .sim-chart-settings-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: min(612px, calc(100vw - 32px));
            height: min(620px, calc(100vh - 56px));
            display: grid;
            grid-template-rows: 64px 1fr 64px;
            background: var(--surface-0);
            border: 1px solid var(--border-soft);
            border-radius: 6px;
            color: var(--app-text);
            box-shadow: 0 24px 70px var(--shadow-deep);
            overflow: visible;
            z-index: 5000;
          }
          .sim-chart-modal-header {
            cursor: grab;
            user-select: none;
          }
          .sim-chart-modal-header:active {
            cursor: grabbing;
          }
          .sim-chart-settings-header,
          .sim-chart-settings-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 20px;
            border-bottom: 1px solid var(--border-soft);
          }
          .sim-chart-settings-footer {
            border-top: 1px solid var(--border-soft);
            border-bottom: none;
          }
          .sim-chart-settings-body {
            display: grid;
            grid-template-columns: 200px 1fr;
            min-height: 0;
            overflow: visible;
          }
          .sim-chart-settings-sidebar {
            padding: 14px 12px;
            border-right: 1px solid var(--border-soft);
          }
          .sim-chart-settings-tab {
            width: 100%;
            min-height: 39px;
            display: grid;
            grid-template-columns: 30px 1fr;
            align-items: center;
            gap: 10px;
            border: none;
            border-radius: 4px;
            background: transparent;
            color: var(--text-muted);
            cursor: pointer;
            padding: 0 12px;
            text-align: left;
            font-size: 13px;
            font-weight: 700;
          }
          .sim-chart-settings-tab svg {
            width: 26px;
            height: 26px;
            display: block;
            overflow: visible;
          }
          .sim-chart-settings-tab:hover,
          .sim-chart-settings-tab-active {
            background: var(--surface-soft);
            color: var(--app-text);
          }
          .sim-chart-settings-tab-active {
            background: color-mix(in srgb, #2962ff 9%, var(--surface-0));
          }
          .sim-chart-settings-tab:focus {
            outline: none;
          }
          .sim-chart-settings-content {
            padding: 25px 20px;
            overflow: visible;
          }
          .sim-chart-settings-section {
            color: var(--text-dim);
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            margin: 0 0 18px;
          }
          .sim-chart-settings-row {
            display: grid;
            grid-template-columns: 28px 1fr;
            align-items: center;
            gap: 8px;
            min-height: 50px;
            color: var(--app-text);
            font-size: 14px;
          }
          .sim-chart-settings-data-row {
            grid-template-columns: 128px minmax(0, 1fr);
            gap: 8px;
          }
          .sim-chart-settings-check {
            position: relative;
            width: 18px;
            height: 18px;
            appearance: none;
            border: 1px solid var(--text-dim);
            border-radius: 3px;
            background: var(--surface-0);
            cursor: pointer;
          }
          .sim-chart-settings-check:checked {
            background: var(--accent);
            border-color: var(--accent);
          }
          .sim-chart-settings-check:checked::after {
            content: '';
            position: absolute;
            left: 50%;
            top: 50%;
            width: 11px;
            height: 9px;
            background: var(--palette-paper);
            clip-path: polygon(14% 48%, 0 63%, 38% 100%, 100% 16%, 84% 0, 36% 64%);
            transform: translate(-50%, -50%);
          }
          .sim-chart-settings-candle-control {
            display: grid;
            grid-template-columns: 70px auto;
            align-items: center;
            gap: 20px;
          }
          .sim-chart-settings-swatches {
            display: flex;
            gap: 8px;
            align-items: center;
          }
          .sim-chart-settings-swatch-wrap {
            position: relative;
            display: inline-flex;
            flex: 0 0 auto;
          }
          .sim-chart-settings-swatch {
            width: 34px;
            height: 34px;
            border-radius: 6px;
            border: 1px solid var(--text-dim);
            padding: 4px;
            background: var(--surface-1);
            cursor: pointer;
            display: block;
          }
          .sim-chart-settings-swatch span {
            display: block;
            width: 100%;
            height: 100%;
            border-radius: 3px;
          }
          .sim-chart-settings-swatch-active {
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent);
          }
          .sim-chart-color-popover {
            position: absolute;
            left: 0;
            top: 42px;
            width: 236px;
            padding: 6px 6px 10px;
            border: 1px solid var(--border-soft);
            border-radius: 4px;
            background: var(--surface-0);
            box-shadow: 0 18px 44px var(--shadow-deep);
            z-index: 5000;
          }
          .sim-chart-color-grid {
            display: grid;
            grid-template-columns: repeat(10, 17px);
            gap: 6px;
          }
          .sim-chart-color-cell {
            width: 17px;
            height: 17px;
            border: 1px solid transparent;
            border-radius: 2px;
            cursor: pointer;
            padding: 0;
            display: block;
          }
          .sim-chart-color-cell-active {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px var(--surface-0), 0 0 0 3px var(--accent);
          }
          .sim-chart-color-opacity-title {
            margin: 12px 0 8px;
            padding-top: 11px;
            border-top: 1px solid var(--border-soft);
            color: var(--text-muted);
            font-size: 12px;
          }
          .sim-chart-color-opacity {
            width: 100%;
            height: 14px;
            appearance: none;
            background: transparent;
            cursor: pointer;
          }
          .sim-chart-color-opacity::-webkit-slider-runnable-track {
            height: 8px;
            border-radius: 4px;
            border: 1px solid var(--border-soft);
            background:
              linear-gradient(90deg, transparent 0%, var(--opacity-color) 100%),
              repeating-conic-gradient(rgba(255,255,255,0.22) 0 25%, rgba(0,0,0,0.22) 0 50%) 0 / 8px 8px;
          }
          .sim-chart-color-opacity::-webkit-slider-thumb {
            appearance: none;
            width: 12px;
            height: 12px;
            margin-top: -3px;
            border-radius: 50%;
            border: 1px solid rgba(0,0,0,0.25);
            background: var(--palette-paper);
            box-shadow: 0 0 0 1px rgba(255,255,255,0.45);
          }
          .sim-chart-color-opacity::-moz-range-track {
            height: 8px;
            border-radius: 4px;
            border: 1px solid var(--border-soft);
            background:
              linear-gradient(90deg, transparent 0%, var(--opacity-color) 100%),
              repeating-conic-gradient(rgba(255,255,255,0.22) 0 25%, rgba(0,0,0,0.22) 0 50%) 0 / 8px 8px;
          }
          .sim-chart-color-opacity::-moz-range-thumb {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: 1px solid rgba(0,0,0,0.25);
            background: var(--palette-paper);
          }
          .sim-chart-color-opacity-input {
            height: 28px;
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: center;
            border: 1px solid var(--border-soft);
            border-radius: 4px;
            color: var(--app-text);
            font-size: 13px;
            padding: 0 6px;
          }
          .sim-chart-color-opacity-input input {
            width: 28px;
            border: none;
            outline: none;
            background: transparent;
            color: var(--app-text);
            text-align: right;
            font: inherit;
            padding: 0;
          }
          .sim-chart-indicator-list {
            overflow-y: auto;
            scrollbar-width: none;
            -ms-overflow-style: none;
            padding: 0 10px 14px 20px;
          }
          .sim-chart-indicator-list::-webkit-scrollbar {
            display: none;
          }
          .sim-chart-settings-select {
            width: 100%;
            height: 34px;
            border: 1px solid var(--border-soft);
            border-radius: 5px;
            background: var(--surface-0);
            color: var(--app-text);
            padding: 0 38px 0 10px;
            font-size: 13px;
            appearance: none;
            cursor: pointer;
          }
          .sim-chart-settings-select:focus {
            outline: none;
            border-color: var(--accent);
          }
          .sim-chart-settings-select-wrap {
            position: relative;
            display: inline-flex;
            width: 150px;
          }
          .sim-chart-settings-select-wrap-wide {
            width: 220px;
          }
          .sim-chart-settings-dropdown-button {
            position: relative;
            display: flex;
            align-items: center;
            width: 100%;
            height: 36px;
            border: 1px solid var(--border-soft);
            border-radius: 6px;
            background: var(--surface-0);
            color: var(--app-text);
            padding: 0 34px 0 10px;
            cursor: pointer;
            font: inherit;
            text-align: left;
            transition: border-color 120ms ease, box-shadow 120ms ease;
          }
          .sim-chart-settings-dropdown-button[aria-expanded='true'] {
            border-color: #2962ff;
            box-shadow: 0 0 0 1px #2962ff;
          }
          .sim-chart-settings-dropdown-button[aria-expanded='true'] .sim-chart-settings-dropdown-arrow {
            transform: rotate(180deg);
            color: var(--app-text);
          }
          .sim-chart-settings-dropdown-menu {
            position: absolute;
            left: 0;
            top: 38px;
            width: 220px;
            max-height: 360px;
            overflow-y: auto;
            scrollbar-width: none;
            -ms-overflow-style: none;
            padding: 5px 0;
            border: 1px solid var(--border-soft);
            border-radius: 6px;
            background: var(--surface-0);
            box-shadow: 0 10px 28px var(--shadow-deep);
            z-index: 5000;
          }
          .sim-chart-settings-dropdown-menu::-webkit-scrollbar {
            display: none;
          }
          .sim-chart-settings-dropdown-option {
            width: 100%;
            height: 34px;
            min-height: 34px;
            border: none;
            background: transparent;
            color: var(--app-text);
            cursor: pointer;
            padding: 0 11px;
            text-align: left;
            font: inherit;
          }
          .sim-chart-settings-dropdown-option:hover,
          .sim-chart-settings-dropdown-option-active {
            background: #2962ff;
            color: #fff;
          }
          .sim-chart-settings-select-arrow,
          .sim-chart-settings-template-arrow {
            position: absolute;
            top: 1px;
            right: 1px;
            width: 32px;
            height: 32px;
            display: grid;
            place-items: center;
            border-radius: 4px;
            color: var(--text-muted);
            pointer-events: none;
            transition: transform 120ms ease, background 120ms ease, color 120ms ease;
          }
          .sim-chart-settings-dropdown-button .sim-chart-settings-template-arrow,
          .sim-chart-settings-template-button .sim-chart-settings-template-arrow {
            top: 5px;
            right: 3px;
            width: 23px;
            height: 24px;
          }
          .sim-chart-settings-select:hover + .sim-chart-settings-select-arrow,
          .sim-chart-settings-template-button:hover .sim-chart-settings-template-arrow {
            background: color-mix(in srgb, var(--palette-paper) 12%, transparent);
            color: var(--app-text);
          }
          .sim-chart-settings-dropdown-button:hover .sim-chart-settings-template-arrow {
            background: color-mix(in srgb, var(--palette-paper) 12%, transparent);
            color: var(--app-text);
          }
          .sim-chart-settings-dropdown-arrow {
            position: absolute;
            top: 0;
            right: 2px;
            width: 30px;
            height: 34px;
            display: grid;
            place-items: center;
            color: var(--text-muted);
            pointer-events: none;
            transition: transform 120ms ease, color 120ms ease;
          }
          .sim-chart-settings-select:focus + .sim-chart-settings-select-arrow,
          .sim-chart-settings-template-button[aria-expanded='true'] .sim-chart-settings-template-arrow {
            transform: rotate(180deg);
            color: var(--app-text);
          }
          .sim-chart-settings-template {
            position: relative;
          }
          .sim-chart-settings-template-button,
          .sim-chart-settings-action {
            height: 34px;
            border: 1px solid var(--border-soft);
            border-radius: 5px;
            background: var(--surface-0);
            color: var(--app-text);
            cursor: pointer;
            font-size: 14px;
            transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
          }
          .sim-chart-settings-template-button {
            position: relative;
            min-width: 118px;
            padding: 0 38px 0 10px;
            text-align: left;
          }
          .sim-chart-settings-template-button[aria-expanded='true'] {
            border-color: var(--accent);
          }
          .sim-chart-settings-action {
            padding: 0 12px;
          }
          .sim-chart-settings-template-button:hover,
          .sim-chart-settings-action:hover {
            background: var(--surface-soft);
            border-color: color-mix(in srgb, var(--accent) 62%, var(--border-soft));
            color: var(--app-text);
          }
          .sim-chart-settings-template-menu {
            position: absolute;
            left: 0;
            bottom: 40px;
            width: 118px;
            padding: 8px 0;
            border: 1px solid var(--border-soft);
            border-radius: 5px;
            background: var(--surface-0);
            box-shadow: 0 14px 36px var(--shadow-deep);
          }
          .sim-chart-settings-template-menu button {
            width: 100%;
            min-height: 32px;
            border: none;
            background: transparent;
            color: var(--app-text);
            text-align: left;
            padding: 0 12px;
            cursor: pointer;
          }
          .sim-chart-settings-template-menu button:hover {
            background: var(--surface-soft);
          }
          .sim-chart-settings-primary {
            background: var(--accent);
            border-color: var(--accent);
            color: #fff;
          }
          .sim-chart-settings-primary:hover {
            background: color-mix(in srgb, var(--accent) 86%, var(--palette-paper));
            color: #fff;
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
          }
          .sim-chart-timezone-shell {
            position: relative;
            display: flex;
            align-items: center;
          }
          .sim-chart-timezone-menu {
            position: absolute;
            right: 0;
            bottom: 36px;
            width: 238px;
            max-height: min(560px, calc(100vh - 86px));
            overflow-y: auto;
            scrollbar-width: none;
            -ms-overflow-style: none;
            padding: 6px 0;
            border: 1px solid var(--border-soft);
            border-radius: 5px;
            background: var(--surface-0);
            box-shadow: 0 18px 44px rgba(0,0,0,0.46);
            color: var(--app-text);
            z-index: 5000;
          }
          .sim-chart-timezone-menu::-webkit-scrollbar {
            display: none;
          }
          .sim-chart-timezone-option {
            width: 100%;
            min-height: 33px;
            display: grid;
            grid-template-columns: 22px 1fr;
            align-items: center;
            gap: 8px;
            border: none;
            background: transparent;
            color: var(--app-text);
            font: inherit;
            font-size: 13px;
            font-weight: 600;
            text-align: left;
            padding: 6px 12px 6px 7px;
            cursor: pointer;
          }
          .sim-chart-timezone-option:hover {
            background: var(--surface-soft);
          }
          .sim-chart-timezone-option-active {
            color: var(--highlight);
          }
          .sim-chart-timezone-check {
            color: var(--app-text);
            font-size: 18px;
            line-height: 1;
            text-align: center;
          }
          .sim-chart-bottom-separator {
            width: 1px;
            height: 15px;
            background: color-mix(in srgb, var(--chart-axis) 75%, transparent);
          }
          .sim-chart-scale-button {
            border: 1px solid transparent;
            background: transparent;
            color: var(--tool-icon);
            font: inherit;
            font-weight: 600;
            padding: 2px 5px;
            border-radius: 4px;
            cursor: pointer;
            line-height: 1.15;
            transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
          }
          .sim-chart-goto-shell {
            position: relative;
            display: flex;
            align-items: center;
          }
          .sim-chart-goto-button {
            width: 28px;
            height: 28px;
            border: 1px solid transparent;
            border-radius: 5px;
            background: transparent;
            color: var(--tool-icon);
            display: grid;
            place-items: center;
            cursor: pointer;
            transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
          }
          .sim-chart-goto-button:hover,
          .sim-chart-goto-button-active {
            color: var(--app-text);
            background: color-mix(in srgb, var(--tool-icon-active) 14%, transparent);
            border-color: color-mix(in srgb, var(--tool-icon-active) 24%, transparent);
          }
          .sim-chart-goto-menu {
            position: fixed;
            left: 50%;
            top: 50%;
            bottom: auto;
            transform: translate(-50%, -50%);
            width: min(320px, calc(100vw - 32px));
            max-height: calc(100vh - 56px);
            overflow: auto;
            scrollbar-width: none;
            -ms-overflow-style: none;
            border: 1px solid var(--border-soft);
            border-radius: 6px;
            background: var(--surface-0);
            color: var(--app-text);
            box-shadow: 0 18px 44px rgba(0, 0, 0, 0.42);
            padding: 18px 20px 14px;
            z-index: 5000;
          }
          .sim-chart-goto-menu::-webkit-scrollbar {
            display: none;
          }
          .sim-chart-goto-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 16px;
          }
          .sim-chart-goto-title {
            color: var(--app-text);
            font-size: 18px;
            font-weight: 700;
          }
          .sim-chart-goto-close,
          .sim-chart-goto-month-button,
          .sim-chart-goto-field-icon {
            border: none;
            background: transparent;
            color: var(--text-muted);
            display: grid;
            place-items: center;
          }
          .sim-chart-goto-close {
            width: 24px;
            height: 24px;
            cursor: pointer;
            font-size: 26px;
            line-height: 1;
            font-weight: 300;
          }
          .sim-chart-goto-tabs {
            display: flex;
            align-items: center;
            gap: 24px;
            border-bottom: 3px solid rgba(219, 211, 216, 0.34);
            margin-bottom: 16px;
          }
          .sim-chart-goto-tab {
            border: none;
            background: transparent;
            color: color-mix(in srgb, var(--app-text) 82%, var(--text-muted));
            font: inherit;
            font-size: 14px;
            font-weight: 700;
            padding: 0 0 8px;
            cursor: pointer;
            position: relative;
          }
          .sim-chart-goto-tab-active::after {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            bottom: -3px;
            height: 3px;
            border-radius: 3px;
            background: color-mix(in srgb, var(--app-text) 58%, var(--border-soft));
          }
          .sim-chart-goto-fields {
            display: grid;
            grid-template-columns: 1fr 100px;
            gap: 12px;
            margin-bottom: 16px;
          }
          .sim-chart-goto-field {
            height: 34px;
            display: flex;
            align-items: center;
            gap: 6px;
            border: 1px solid rgba(219, 211, 216, 0.28);
            border-radius: 5px;
            padding: 0 8px;
            background: var(--surface-soft);
          }
          .sim-chart-goto-field:focus-within {
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent);
          }
          .sim-chart-goto-input {
            min-width: 0;
            width: 100%;
            border: none;
            outline: none;
            background: transparent;
            color: var(--app-text);
            font: inherit;
            font-size: 13px;
            font-variant-numeric: tabular-nums;
            direction: ltr;
          }
          .sim-chart-goto-field-icon {
            width: 18px;
            height: 18px;
            border: 1px solid rgba(219, 211, 216, 0.48);
            border-radius: 4px;
            font-size: 11px;
            flex: 0 0 auto;
          }
          .sim-chart-goto-month {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin: 6px 0 14px;
            color: color-mix(in srgb, var(--app-text) 84%, var(--text-muted));
            font-size: 15px;
            font-weight: 500;
          }
          .sim-chart-goto-month-button {
            width: 26px;
            height: 26px;
            cursor: pointer;
            font-size: 26px;
            line-height: 1;
          }
          .sim-chart-goto-calendar {
            display: grid;
            grid-template-columns: repeat(7, minmax(0, 1fr));
            gap: 9px 4px;
            text-align: center;
            direction: ltr;
            margin-bottom: 44px;
            justify-items: center;
            width: 100%;
          }
          .sim-chart-goto-day-label {
            color: color-mix(in srgb, var(--text-muted) 78%, var(--palette-mist));
            font-size: 12px;
            font-style: italic;
          }
          .sim-chart-goto-day {
            width: 28px;
            height: 28px;
            border: none;
            border-radius: 5px;
            background: transparent;
            color: var(--app-text);
            font: inherit;
            font-size: 15px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
          }
          .sim-chart-goto-day-muted {
            color: rgba(219, 211, 216, 0.24);
          }
          .sim-chart-goto-day-today {
            text-decoration: underline;
            text-decoration-thickness: 2px;
            text-underline-offset: 4px;
            text-decoration-color: var(--accent);
          }
          .sim-chart-goto-day-future {
            color: var(--text-dim);
            cursor: not-allowed;
            opacity: 0.55;
          }
          .sim-chart-goto-day-active {
            background: var(--accent);
            color: #fff;
            font-weight: 800;
          }
          .sim-chart-goto-footer {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin: 0 -20px -14px;
            padding: 16px 20px 14px;
            border-top: 1px solid rgba(219, 211, 216, 0.16);
          }
          .sim-chart-goto-action {
            height: 34px;
            border-radius: 5px;
            padding: 0 14px;
            font: inherit;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
          }
          .sim-chart-goto-cancel {
            border: 1px solid var(--accent);
            background: transparent;
            color: var(--accent);
          }
          .sim-chart-goto-submit {
            border: 1px solid var(--accent);
            background: var(--accent);
            color: #fff;
          }
          .sim-chart-scale-button:hover {
            color: var(--app-text);
            background: color-mix(in srgb, var(--tool-icon-active) 10%, transparent);
            border-color: color-mix(in srgb, var(--tool-icon-active) 18%, transparent);
          }
          .sim-chart-scale-button-active {
            color: var(--app-text);
            background: color-mix(in srgb, var(--tool-icon-active) 18%, transparent);
            border-color: color-mix(in srgb, var(--tool-icon-active) 32%, transparent);
          }
          .sim-chart-scale-button-auto {
            color: color-mix(in srgb, var(--tool-icon-active) 78%, var(--tool-icon));
          }
          .sim-chart-timeframe-menu {
            scrollbar-width: thin;
            scrollbar-color: color-mix(in srgb, var(--text-muted) 42%, transparent) transparent;
          }
          .sim-chart-timeframe-group {
            border-top: 1px solid color-mix(in srgb, var(--border-soft) 76%, transparent);
          }
          .sim-chart-timeframe-group:first-child {
            border-top: 0;
          }
          .sim-chart-timeframe-header {
            width: calc(100% - 8px);
            height: 34px;
            margin: 4px;
            padding: 0 7px;
            border: none;
            border-radius: 6px;
            background: transparent;
            color: var(--text-dim);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            direction: ltr;
            font-family: inherit;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.4px;
            text-align: left;
          }
          .sim-chart-timeframe-header:hover {
            background: color-mix(in srgb, var(--app-text) 8%, transparent);
            color: color-mix(in srgb, var(--app-text) 72%, var(--text-dim));
          }
          .sim-chart-timeframe-chevron {
            width: 18px;
            height: 18px;
            color: currentColor;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            opacity: 0.78;
            transition: transform 140ms ease;
          }
          .sim-chart-timeframe-chevron-closed {
            transform: rotate(180deg);
          }
          .sim-chart-timeframe-items {
            display: grid;
            gap: 1px;
            padding: 0 4px 6px;
          }
          .sim-chart-timeframe-item {
            width: 100%;
            height: 32px;
            padding: 0 7px;
            border: none;
            border-radius: 5px;
            background: transparent;
            color: var(--app-text);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            font-family: inherit;
            font-size: 14px;
            font-weight: 500;
            text-align: left;
            direction: ltr;
          }
          .sim-chart-timeframe-item:hover {
            background: color-mix(in srgb, var(--app-text) 8%, transparent);
          }
          .sim-chart-timeframe-item-active,
          .sim-chart-timeframe-item-active:hover {
            background: color-mix(in srgb, var(--accent) 88%, var(--app-text));
            color: var(--color-paper);
            font-weight: 700;
          }
          .sim-chart-compact-timeframe {
            height: 34px;
            min-width: 42px;
            padding: 0 7px;
            border: 1px solid transparent;
            border-radius: 4px;
            background: transparent;
            color: var(--app-text);
            cursor: pointer;
            font: inherit;
            font-size: 13px;
            font-weight: 500;
            font-variant-numeric: tabular-nums;
            line-height: 34px;
          }
          .sim-chart-compact-timeframe:hover {
            background: color-mix(in srgb, var(--app-text) 8%, transparent);
          }
          .sim-chart-compact-timeframe-open {
            color: var(--highlight);
            background: color-mix(in srgb, var(--highlight) 13%, transparent);
          }
          .sim-chart-compact-candle {
            position: relative;
            width: 34px;
            height: 34px;
            padding: 0;
            border: none;
            border-radius: 0;
            background: transparent;
            color: var(--tool-icon);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .sim-chart-compact-candle::before,
          .sim-chart-compact-candle::after {
            content: "";
            position: absolute;
            top: 8px;
            bottom: 8px;
            width: 1px;
            background: color-mix(in srgb, var(--app-text) 22%, transparent);
            pointer-events: none;
          }
          .sim-chart-compact-candle::before {
            left: 0;
          }
          .sim-chart-compact-candle::after {
            right: 0;
          }
          .sim-chart-compact-candle:hover {
            color: var(--app-text);
            background: color-mix(in srgb, var(--app-text) 8%, transparent);
          }
          .sim-chart-compact-candle svg {
            width: 24px;
            height: 24px;
          }
          @media (max-width: 900px) {
            .sim-chart-topbar {
              height: 40px !important;
              overflow-x: auto !important;
              overflow-y: hidden !important;
              white-space: nowrap !important;
              padding-right: env(safe-area-inset-right) !important;
            }
            .sim-chart-topbar > button,
            .sim-chart-topbar .sim-chart-top-popover {
              flex: 0 0 auto !important;
            }
            .sim-chart-tools {
              top: 40px !important;
              left: 0 !important;
              right: auto !important;
              bottom: 0 !important;
              width: 52px !important;
              height: auto !important;
              flex-direction: column !important;
              align-items: center !important;
              justify-content: flex-start !important;
              gap: 3px !important;
              padding: 8px 6px calc(8px + env(safe-area-inset-bottom)) 6px !important;
              overflow-x: visible !important;
              overflow-y: auto !important;
              border-right: 1px solid var(--chart-axis) !important;
              border-top: none !important;
              box-shadow: 1px 0 0 rgba(0,0,0,0.08) !important;
            }
            .sim-chart-tools > * {
              flex: 0 0 auto !important;
            }
            .sim-chart-bottom-bar {
              left: 52px !important;
            }
            .sim-chart-timeframe-menu {
              overflow-y: auto !important;
              z-index: 5000 !important;
            }
          }
          @media (max-width: 560px) {
            .sim-chart-indicator-trigger {
              min-width: 42px !important;
              padding: 0 8px !important;
            }
            .sim-chart-indicator-label {
              display: none !important;
            }
          }
        `}
      </style>

      {/* ── Top bar ── */}
      <div className="sim-chart-topbar" style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 36, zIndex: topPanelOpen ? 6000 : 30,
        display: 'flex', alignItems: 'center',
        background: 'var(--chart-toolbar)',
        borderBottom: '1px solid var(--chart-axis)',
        color: 'var(--app-text)',
        fontSize: 13,
        userSelect: 'none',
      }}>
        <button
          style={{
            height: 36,
            padding: '0 13px',
            border: 'none',
            borderRight: '1px solid rgba(239,241,243,0.12)',
            background: 'var(--surface-2)',
            color: 'var(--app-text)',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          پنل اختصاصی بورسینو
        </button>

        <div className="sim-chart-top-popover" style={{ position: 'relative' }}>
          <button
            ref={timeframeButtonRef}
            type="button"
            title="Candle size"
            aria-expanded={openPanel === 'timeframe'}
            className={`sim-chart-compact-timeframe ${openPanel === 'timeframe' ? 'sim-chart-compact-timeframe-open' : ''}`}
            onClick={() => {
              updateTimeframeMenuPosition()
              setOpenPanel(openPanel === 'timeframe' ? null : 'timeframe')
            }}
          >
            {selectedCandleSize.id}
          </button>
          {openPanel === 'timeframe' && (
            <div
              data-chart-modal
              className="sim-chart-timeframe-menu"
              role="menu"
              aria-label="Candle size"
              style={{
                position: 'fixed',
                top: timeframeMenuPosition?.top ?? 36,
                left: timeframeMenuPosition?.left ?? 0,
                width: timeframeMenuPosition?.width ?? TIMEFRAME_MENU_WIDTH,
                maxHeight: timeframeMenuPosition?.maxHeight,
                overflowY: 'auto',
                padding: 0,
                border: '1px solid var(--border-soft)',
                borderRadius: 4,
                background: 'var(--surface-1)',
                boxShadow: '0 16px 40px var(--shadow-deep)',
                display: 'grid',
                gap: 0,
                zIndex: 5000,
              }}
            >
              {CANDLE_SIZE_GROUPS.map(group => {
                const groupOpen = timeframeGroupsOpen[group.label] ?? true
                return (
                <div
                  key={group.label}
                  className="sim-chart-timeframe-group"
                >
                  <button
                    type="button"
                    className="sim-chart-timeframe-header"
                    aria-expanded={groupOpen}
                    onClick={() => {
                      setTimeframeGroupsOpen(current => ({
                        ...current,
                        [group.label]: !(current[group.label] ?? true),
                      }))
                    }}
                  >
                    <span>{group.label}</span>
                    <span className={`sim-chart-timeframe-chevron ${groupOpen ? '' : 'sim-chart-timeframe-chevron-closed'}`}>
                      {TimeframeChevronIcon}
                    </span>
                  </button>
                  {groupOpen && (
                    <div className="sim-chart-timeframe-items">
                      {group.items.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={timeframe === item.id}
                          disabled={!isTimeframeAvailable(item.id)}
                          title={isTimeframeAvailable(item.id) ? '' : 'از تایم‌فریم این CSV قابل ساخت نیست'}
                          style={!isTimeframeAvailable(item.id) ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                          className={`sim-chart-timeframe-item ${timeframe === item.id ? 'sim-chart-timeframe-item-active' : ''}`}
                          onClick={() => {
                            setMarket({ symbol, symbolLabel, timeframe: item.id })
                            setOpenPanel(null)
                          }}
                        >
                          <span>{item.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )})}
            </div>
          )}
        </div>
        <button type="button" title="Chart type" className="sim-chart-compact-candle">{Ico.candles}</button>

        <div className="sim-chart-top-popover" style={{ position: 'relative' }}>
          <button
            title="Indicators"
            className="sim-chart-indicator-trigger"
            onClick={() => setOpenPanel(openPanel === 'top-indicators' ? null : 'top-indicators')}
            style={{
              position: 'relative',
              minWidth: 104,
              height: 34,
              padding: '0 11px 0 8px',
              border: 'none',
              background: openPanel === 'top-indicators' ? 'rgba(216,180,160,0.14)' : 'transparent',
              color: 'var(--highlight)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              fontSize: 13,
            }}
          >
            {Ico.fx}
            <span className="sim-chart-indicator-label">Indicators</span>
            {activeIndicators.size > 0 && (
              <span style={{
                position: 'absolute',
                top: 4,
                right: 3,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                background: '#D77A61',
                color: 'var(--palette-paper)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 10,
                fontWeight: 700,
              }}>{activeIndicators.size}</span>
            )}
          </button>
          {openPanel === 'top-indicators' && (
            <div data-chart-modal style={{
              position: 'fixed',
              top: modalPositions.indicators ? modalPositions.indicators.top : '50%',
              left: modalPositions.indicators ? modalPositions.indicators.left : '50%',
              transform: modalPositions.indicators ? 'none' : 'translate(-50%, -50%)',
              width: 'min(472px, calc(100vw - 28px))',
              height: 'min(600px, calc(100vh - 84px))',
              background: 'var(--surface-0)',
              border: '1px solid rgba(239,241,243,0.16)',
              borderRadius: 5,
              boxShadow: '0 18px 54px rgba(0,0,0,0.58)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              color: 'var(--app-text)',
              zIndex: 5000,
            }}>
              <div className="sim-chart-modal-header" onPointerDown={event => beginModalDrag('indicators', event)} style={{
                minHeight: 82,
                padding: '10px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid rgba(239,241,243,0.12)',
              }}>
                <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0 }}>Indicators</div>
                <button
                  title="Close"
                  onClick={() => setOpenPanel(null)}
                  style={{
                    width: 34,
                    height: 34,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--app-text)',
                    cursor: 'pointer',
                    fontSize: 28,
                    lineHeight: '30px',
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{
                height: 42,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0 18px',
                borderBottom: '1px solid rgba(239,241,243,0.10)',
                color: 'var(--text-dim)',
              }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.35">
                  <circle cx="8" cy="8" r="5.5" />
                  <line x1="12.2" y1="12.2" x2="16" y2="16" />
                </svg>
                <input
                  autoFocus
                  value={indicatorSearch}
                  onChange={event => setIndicatorSearch(event.target.value)}
                  placeholder="Search"
                  style={{
                    flex: 1,
                    height: 40,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: 'var(--app-text)',
                    fontSize: 15,
                  }}
                />
              </div>

              <div style={{
                padding: '14px 20px 7px',
                color: 'var(--text-muted)',
                fontSize: 10,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                Script name
              </div>

              <div className="sim-chart-indicator-list">
                {filteredIndicators.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', padding: '18px 0', fontSize: 13 }}>No indicators found</div>
                ) : filteredIndicators.map(name => (
                  <button
                    key={name}
                    onClick={() => toggleIndicator(name)}
                    style={{
                      width: '100%',
                      minHeight: 32,
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                      gap: 12,
                      border: 'none',
                      borderRadius: 3,
                      background: activeIndicators.has(name) ? 'var(--accent-soft)' : 'transparent',
                      color: 'var(--app-text)',
                      cursor: 'pointer',
                      padding: '5px 10px 5px 12px',
                      textAlign: 'left',
                      fontSize: 13,
                      fontWeight: 650,
                    }}
                  >
                    <span>{name}</span>
                    {activeIndicators.has(name) && (
                      <span style={{
                        color: 'var(--highlight)',
                        fontSize: 11,
                        fontWeight: 800,
                      }}>
                        On
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <button
          title={showTradeHistory ? 'پنهان کردن تاریخچه معاملات' : 'نمایش تاریخچه معاملات'}
          aria-pressed={showTradeHistory}
          onClick={() => setShowTradeHistory(value => !value)}
          style={{
            height: 30,
            minWidth: 34,
            padding: '0 8px',
            marginRight: 6,
            border: showTradeHistory ? '1px solid var(--accent)' : '1px solid var(--chart-axis)',
            borderRadius: 5,
            background: showTradeHistory ? 'var(--accent-soft)' : 'var(--surface-soft)',
            color: showTradeHistory ? 'var(--accent)' : 'var(--tool-icon)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            boxShadow: showTradeHistory ? '0 0 0 1px rgba(215,122,97,0.08)' : 'none',
          }}
        >
          {Ico.history}
          <span style={{ fontSize: 11, fontWeight: 800 }}>تاریخچه معاملات</span>
        </button>
        <button
          title={isFullscreen ? 'خروج از تمام صفحه (F11)' : 'تمام صفحه (F11)'}
          aria-pressed={isFullscreen}
          onClick={() => void toggleFullscreen()}
          style={{
            ...css.icon(isFullscreen, 30),
            width: 32,
            minWidth: 32,
            marginRight: 4,
            color: isFullscreen ? 'var(--accent)' : 'var(--tool-icon)',
            border: isFullscreen ? '1px solid var(--accent)' : '1px solid var(--chart-axis)',
            background: isFullscreen ? 'var(--accent-soft)' : 'var(--surface-soft)',
          }}
        >
          {isFullscreen ? ActualSizeIcon : FullscreenIcon}
        </button>

        <div className="sim-chart-top-popover" style={{ position: 'relative' }}>
          <button
            title="Save layout"
            aria-label="Save layout"
            aria-haspopup="menu"
            aria-expanded={openPanel === 'snapshot'}
            onClick={() => {
              saveChartLayout()
              setOpenPanel(openPanel === 'snapshot' ? null : 'snapshot')
            }}
            style={{
              ...css.icon(openPanel === 'snapshot', 34),
              color: openPanel === 'snapshot' ? 'var(--app-text)' : 'var(--tool-icon)',
            }}
          >
            {CameraIcon}
          </button>
          {openPanel === 'snapshot' && (
            <div
              className="sim-chart-snapshot-menu"
              role="menu"
              aria-label="Chart snapshot"
            >
              <div className="sim-chart-snapshot-title">
                Chart snapshot
              </div>
              {[
                { id: 'download', label: 'Download image', shortcut: 'Ctrl + Alt + S', icon: DownloadImageIcon },
                { id: 'copy', label: 'Copy image', shortcut: 'Ctrl + Shift + S', icon: CopyImageIcon },
              ].map(item => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => void (item.id === 'download' ? downloadChartImage() : copyChartImage())}
                  className="sim-chart-snapshot-item"
                >
                  <span className="sim-chart-snapshot-icon">{item.icon}</span>
                  <span className="sim-chart-snapshot-label">{item.label}</span>
                  <span className="sim-chart-snapshot-shortcut">{item.shortcut}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="sim-chart-top-popover" style={{ position: 'relative' }}>
          <button
            title="Settings"
            onClick={() => {
              if (openPanel === 'top-settings') {
                cancelChartSettings()
                return
              }
              captureChartSettingsSnapshot()
              setSettingsTemplateOpen(false)
              setSettingsPrecisionOpen(false)
              setSettingsTimezoneOpen(false)
              setOpenPanel('top-settings')
            }}
            style={{
              ...css.icon(openPanel === 'top-settings', 34),
              color: openPanel === 'top-settings' ? 'var(--app-text)' : 'var(--tool-icon)',
            }}
          >
            {SettingsGearIcon}
          </button>
          {openPanel === 'top-settings' && (
            <div
              data-chart-modal
              className="sim-chart-settings-modal"
              role="dialog"
              aria-label="Chart settings"
              style={modalPositions.settings ? {
                top: modalPositions.settings.top,
                left: modalPositions.settings.left,
                transform: 'none',
              } : undefined}
            >
              <div className="sim-chart-settings-header sim-chart-modal-header" onPointerDown={event => beginModalDrag('settings', event)}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>Chart settings</div>
                <button
                  type="button"
                  onClick={cancelChartSettings}
                  aria-label="Close"
                  style={{
                    width: 34,
                    height: 34,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--app-text)',
                    cursor: 'pointer',
                    fontSize: 28,
                    lineHeight: '30px',
                  }}
                >
                  ×
                </button>
              </div>

              <div className="sim-chart-settings-body">
                <div className="sim-chart-settings-sidebar">
                  {settingsTabs.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={`sim-chart-settings-tab ${chartSettingsTab === item.id ? 'sim-chart-settings-tab-active' : ''}`}
                      onClick={() => setChartSettingsTab(item.id)}
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>

                <div className="sim-chart-settings-content">
                  {chartSettingsTab === 'symbol' ? (
                    <>
                      <div className="sim-chart-settings-section">Candles</div>
                      <div className="sim-chart-settings-row">
                        <input
                          type="checkbox"
                          className="sim-chart-settings-check"
                          aria-label="Color bars based on previous close"
                          checked={settingsColorBarsPreviousClose}
                          onChange={event => setSettingsColorBarsPreviousClose(event.target.checked)}
                        />
                        <span>Color bars based on previous close</span>
                      </div>
                      <div className="sim-chart-settings-row">
                        <input
                          type="checkbox"
                          className="sim-chart-settings-check"
                          aria-label="Show candle body"
                          checked={settingsBodyVisible}
                          onChange={event => setSettingsBodyVisible(event.target.checked)}
                        />
                        <span className="sim-chart-settings-candle-control">
                          <span>Body</span>
                          <span className="sim-chart-settings-swatches">
                            {renderSettingsSwatch('bodyUp')}
                            {renderSettingsSwatch('bodyDown')}
                          </span>
                        </span>
                      </div>
                      <div className="sim-chart-settings-row">
                        <input
                          type="checkbox"
                          className="sim-chart-settings-check"
                          aria-label="Show candle borders"
                          checked={settingsBordersVisible}
                          onChange={event => setSettingsBordersVisible(event.target.checked)}
                        />
                        <span className="sim-chart-settings-candle-control">
                          <span>Borders</span>
                          <span className="sim-chart-settings-swatches">
                            {renderSettingsSwatch('borderUp')}
                            {renderSettingsSwatch('borderDown')}
                          </span>
                        </span>
                      </div>
                      <div className="sim-chart-settings-row">
                        <input
                          type="checkbox"
                          className="sim-chart-settings-check"
                          aria-label="Show candle wick"
                          checked={settingsWickVisible}
                          onChange={event => setSettingsWickVisible(event.target.checked)}
                        />
                        <span className="sim-chart-settings-candle-control">
                          <span>Wick</span>
                          <span className="sim-chart-settings-swatches">
                            {renderSettingsSwatch('wickUp')}
                            {renderSettingsSwatch('wickDown')}
                          </span>
                        </span>
                      </div>

                      <div className="sim-chart-settings-section" style={{ marginTop: 24 }}>Data modification</div>
                      <div className="sim-chart-settings-row sim-chart-settings-data-row">
                        <span>Precision</span>
                        <span className="sim-chart-settings-select-wrap">
                          <button
                            type="button"
                            className="sim-chart-settings-dropdown-button"
                            aria-label="Precision"
                            aria-expanded={settingsPrecisionOpen}
                            onClick={event => {
                              setPrecisionAnchor(event.currentTarget)
                              setSettingsTimezoneOpen(false)
                              setSettingsPrecisionOpen(value => !value)
                            }}
                          >
                            {selectedPrecisionLabel}
                            <span className="sim-chart-settings-dropdown-arrow">{SettingsArrowDownIcon}</span>
                          </button>
                          {settingsPrecisionOpen && (
                            <SettingsDropdownPortal anchor={precisionAnchor} ariaLabel="Precision">
                              {PRECISION_OPTIONS.map(item => (
                                <button
                                  key={item.value}
                                  type="button"
                                  role="option"
                                  aria-selected={settingsPrecision === item.value}
                                  className={`sim-chart-settings-dropdown-option ${settingsPrecision === item.value ? 'sim-chart-settings-dropdown-option-active' : ''}`}
                                  onClick={() => {
                                    setSettingsPrecision(item.value)
                                    setSettingsPrecisionOpen(false)
                                  }}
                                >
                                  {item.label}
                                </button>
                              ))}
                            </SettingsDropdownPortal>
                          )}
                        </span>
                      </div>
                      <div className="sim-chart-settings-row sim-chart-settings-data-row">
                        <span>Timezone</span>
                        <span className="sim-chart-settings-select-wrap sim-chart-settings-select-wrap-wide">
                          <button
                            type="button"
                            className="sim-chart-settings-dropdown-button"
                            aria-label="Timezone"
                            aria-expanded={settingsTimezoneOpen}
                            onClick={event => {
                              setTimezoneAnchor(event.currentTarget)
                              setSettingsPrecisionOpen(false)
                              setSettingsTimezoneOpen(value => !value)
                            }}
                          >
                            {selectedTimeZoneLabel}
                            <span className="sim-chart-settings-dropdown-arrow">{SettingsArrowDownIcon}</span>
                          </button>
                          {settingsTimezoneOpen && (
                            <SettingsDropdownPortal anchor={timezoneAnchor} ariaLabel="Timezone">
                              {TIMEZONE_OPTIONS.map(item => (
                                <button
                                  key={item.zone}
                                  type="button"
                                  role="option"
                                  aria-selected={chartTimeZone === item.zone}
                                  className={`sim-chart-settings-dropdown-option ${chartTimeZone === item.zone ? 'sim-chart-settings-dropdown-option-active' : ''}`}
                                  onClick={() => {
                                    setChartTimeZone(item.zone)
                                    setSettingsTimezoneOpen(false)
                                  }}
                                >
                                  {item.label}
                                </button>
                              ))}
                            </SettingsDropdownPortal>
                          )}
                        </span>
                      </div>
                    </>
                  ) : (
                    <CanvasSettingsPanel
                      value={canvasSettings}
                      onChange={patch => setCanvasSettings(current => (
                        ensureCanvasTextContrast({ ...current, ...patch })
                      ))}
                    />
                  )}
                </div>
              </div>

              <div className="sim-chart-settings-footer">
                <div className="sim-chart-settings-template">
                  <button
                    type="button"
                    className="sim-chart-settings-template-button"
                    aria-expanded={settingsTemplateOpen}
                    onClick={() => {
                      setSettingsPrecisionOpen(false)
                      setSettingsTimezoneOpen(false)
                      setSettingsTemplateOpen(value => !value)
                    }}
                  >
                    <span>Template</span>
                    <span className="sim-chart-settings-template-arrow">{SettingsArrowDownIcon}</span>
                  </button>
                  {settingsTemplateOpen && (
                    <div className="sim-chart-settings-template-menu">
                      <button type="button" onClick={() => applyCanvasTemplate('default')}>Default</button>
                      <button type="button" onClick={() => applyCanvasTemplate('clean')}>Clean canvas</button>
                      <button type="button" onClick={() => applyCanvasTemplate('sea-blue')}>Sea blue</button>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button type="button" className="sim-chart-settings-action" onClick={cancelChartSettings}>Cancel</button>
                  <button type="button" className="sim-chart-settings-action sim-chart-settings-primary" onClick={confirmChartSettings}>Ok</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ChartSideToolbar
        activeTool={activeTool}
        cursorMode={cursorMode}
        drawingsCount={drawings.length}
        indicatorsCount={activeIndicators.size}
        drawingsHidden={drawingsHidden}
        drawingsLocked={drawingsLocked}
        openPanel={openPanel}
        pinnedTools={pinnedTools}
        setActiveTool={setActiveTool}
        setCursorMode={setCursorMode}
        setOpenPanel={setOpenPanel}
        onActivateRangeMeasure={activateRangeMeasure}
        onClearDrawings={clearDrawings}
        onClearIndicators={clearIndicators}
        onPinTool={handlePinTool}
        onToggleDrawingsHidden={toggleDrawingsHidden}
        onToggleDrawingsLock={toggleDrawingsLock}
        onZoomTimeScale={zoomTimeScale}
      />

      <div
        className="sim-chart-symbol-status"
        aria-label={`${symbolLabel} ${timeframe} chart status`}
        style={{ color: colorWithOpacity(canvasSettings.scaleTextColor, canvasSettings.scaleTextOpacity) }}
      >
        <span className="sim-chart-symbol-icons" aria-hidden="true">
          {symbolIcons.slice(0, 2).map((icon, index) => (
            <img key={`${symbol}-${index}`} src={icon} alt="" />
          ))}
        </span>
        <span className="sim-chart-symbol-title">{symbolLabel}</span>
        <span className="sim-chart-symbol-separator">·</span>
        <span>{timeframe}</span>
        <span className="sim-chart-symbol-separator">·</span>
        <span>{symbol.replace('_', '/')}</span>
        <span className="sim-chart-symbol-data-offline" title="Offline data" aria-label="Offline data" />
        {selectedCandle && (
          <span className="sim-chart-symbol-ohlc">
            <span>O {formatStatusPrice(symbol, settingsPrecision, selectedCandle.open)}</span>
            <span>H {formatStatusPrice(symbol, settingsPrecision, selectedCandle.high)}</span>
            <span>L {formatStatusPrice(symbol, settingsPrecision, selectedCandle.low)}</span>
            <span>C {formatStatusPrice(symbol, settingsPrecision, selectedCandle.close)}</span>
            <span className={selectedCandleChange >= 0 ? 'sim-chart-symbol-change-positive' : 'sim-chart-symbol-change-negative'}>
              {selectedCandleChange >= 0 ? '+' : ''}{formatStatusPrice(symbol, settingsPrecision, selectedCandleChange)}
              {' '}({selectedCandleChangePercent >= 0 ? '+' : ''}{selectedCandleChangePercent.toFixed(2)}%)
            </span>
          </span>
        )}
      </div>

      {overlayIndicatorLegends.length > 0 && (
        <div className="sim-chart-overlay-indicator-legends" aria-label="Chart indicators">
          {overlayIndicatorLegends.map(item => (
            <IndicatorLegendRow
              key={item.name}
              name={item.name}
              values={item.values}
              visible={!hiddenIndicators.has(item.name)}
              selected={selectedIndicator === item.name}
              onSelect={() => setSelectedIndicator(item.name)}
              onToggleVisibility={() => toggleIndicatorVisibility(item.name)}
              onRemove={() => removeIndicator(item.name)}
            />
          ))}
        </div>
      )}

      {paneIndicatorLegends.map(item => (
        <PaneIndicatorLegend
          key={item.name}
          target={item.target}
          name={item.name}
          values={item.values}
          visible={!hiddenIndicators.has(item.name)}
          selected={selectedIndicator === item.name}
          onSelect={() => setSelectedIndicator(item.name)}
          onToggleVisibility={() => toggleIndicatorVisibility(item.name)}
          onRemove={() => removeIndicator(item.name)}
        />
      ))}

      {/* ── Drawing settings panel ── */}
      {selected && selectedPanelDrawing && !drawingsLocked && !drawingsHidden && (
        <DrawingSettingsPanel
          key={selectedPanelDrawing.id}
          drawing={selectedPanelDrawing}
          left={selectionPanelLeft}
          top={selectionPanelTop}
          onMove={(dx, dy) => {
            setSelected(current => {
              if (!current) return current
              const next = {
                ...current,
                panelX: current.panelX + dx,
                panelY: Math.max(8, current.panelY + dy),
              }
              selectedRef.current = next
              return next
            })
          }}
          onUpdate={patch => updateDrawingSettings(selectedPanelDrawing.id, patch)}
          onDelete={() => deleteDrawing(selectedPanelDrawing.id)}
        />
      )}

      {/* ── Chart container ── */}
      <div
        ref={containerRef}
        className={`${axisCursor === 'ns-resize' ? 'sim-chart-axis-y' : axisCursor === 'ew-resize' ? 'sim-chart-axis-x' : drawingNodeCursor === 'ew-resize' ? 'sim-chart-node-x' : drawingNodeCursor === 'ns-resize' ? 'sim-chart-node-y' : drawingNodeCursor === 'default' ? 'sim-chart-cursor-default' : chartCursorClass} sim-chart-surface ${drawingDragGestureLocked ? 'sim-chart-drawing-drag-locked' : ''}`}
        style={{ position: 'absolute', inset: '0 0 25px 0' }}
        onPointerMove={handleContainerMouseMove}
        onPointerDownCapture={handleContainerMouseDown}
        onWheelCapture={handleContainerWheelCapture}
        onPointerUp={handleContainerMouseUp}
        onDoubleClick={handleContainerDoubleClick}
        onPointerCancel={() => {
          restoreChartGestureHandling()
          handleContainerMouseLeave()
        }}
        onPointerLeave={handleContainerMouseLeave}
        onContextMenu={event => event.preventDefault()}
      />

      {/* ── Overlay canvas ── */}
      <canvas
        ref={overlayRef}
        className="sim-chart-overlay"
        onPointerDown={event => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          if (!activeTool) {
            const rect = overlayRef.current?.getBoundingClientRect()
            if (rect) {
              const hit = findHitDrawing(event.clientX - rect.left, event.clientY - rect.top)
              if (hit) disableChartGestureHandling()
              if (!hit || !EDITABLE_TEXT_TOOLS.has(hit.drawing.tool)) stopTextEdit()
            }
          }
          handleMouseDown(event)
        }}
        onPointerMove={handleOverlayMouseMove}
        onPointerUp={() => {
          handleMouseUp()
          restoreChartGestureHandling()
        }}
        onDoubleClick={handleContainerDoubleClick}
        onPointerCancel={() => {
          handleMouseLeave()
          restoreChartGestureHandling()
        }}
        onPointerLeave={handleMouseLeave}
        onContextMenu={event => event.preventDefault()}
        style={{
          position: 'absolute', inset: '0 0 32px 0',
          cursor: axisCursor ?? (cursorMode === 'eraser'
            ? 'none'
            : drawingNodeCursor
              ? drawingNodeCursor
            : activeTool
              ? 'crosshair'
              : cursorMode === 'arrow'
                ? 'default'
                : 'none'),
          zIndex: 10,
          pointerEvents: canvasPointerEvents,
        }}
      />

      <div className="sim-chart-bottom-bar">
        <div className="sim-chart-goto-shell">
          <button
            type="button"
            className={`sim-chart-goto-button ${openPanel === 'goto' ? 'sim-chart-goto-button-active' : ''}`}
            onClick={() => setOpenPanel(openPanel === 'goto' ? null : 'goto')}
            title="Go to"
            aria-label="Go to"
            aria-expanded={openPanel === 'goto'}
          >
            {GoToIcon}
          </button>

          {openPanel === 'goto' && (
            <div
              data-chart-modal
              className="sim-chart-goto-menu"
              role="dialog"
              aria-label="Go to"
              style={modalPositions.goto ? {
                top: modalPositions.goto.top,
                left: modalPositions.goto.left,
                transform: 'none',
              } : undefined}
            >
              <div className="sim-chart-goto-header sim-chart-modal-header" onPointerDown={event => beginModalDrag('goto', event)}>
                <div className="sim-chart-goto-title">Go to</div>
                <button type="button" className="sim-chart-goto-close" onClick={() => setOpenPanel(null)} aria-label="Close">×</button>
              </div>

              <div className="sim-chart-goto-tabs" role="tablist" aria-label="Go to mode">
                <button
                  type="button"
                  className="sim-chart-goto-tab sim-chart-goto-tab-active"
                  role="tab"
                  aria-selected="true"
                >
                  Date
                </button>
              </div>

              <div className="sim-chart-goto-fields">
                <label className="sim-chart-goto-field">
                  <input
                    className="sim-chart-goto-input"
                    value={goToDateInput}
                    onChange={event => setGoToDateInput(event.target.value)}
                    aria-label="Start date"
                    placeholder="YYYY-MM-DD"
                  />
                  <span className="sim-chart-goto-field-icon" aria-hidden="true">{GoToIcon}</span>
                </label>
                <label className="sim-chart-goto-field">
                  <input
                    className="sim-chart-goto-input"
                    value={goToTimeInput}
                    onChange={event => setGoToTimeInput(event.target.value)}
                    aria-label="Start time"
                    placeholder="HH:MM"
                  />
                  <span className="sim-chart-goto-field-icon" aria-hidden="true">◷</span>
                </label>
              </div>

              <div className="sim-chart-goto-month">
                <button
                  type="button"
                  className="sim-chart-goto-month-button"
                  aria-label="Previous month"
                  onClick={() => setGoToDateInput(formatCalendarDate(new Date(calendarBaseDate.getFullYear(), calendarBaseDate.getMonth() - 1, Math.min(calendarBaseDate.getDate(), 28))))}
                >
                  ‹
                </button>
                <span>{calendarMonthLabel}</span>
                <button
                  type="button"
                  className="sim-chart-goto-month-button"
                  aria-label="Next month"
                  onClick={() => setGoToDateInput(formatCalendarDate(new Date(calendarBaseDate.getFullYear(), calendarBaseDate.getMonth() + 1, Math.min(calendarBaseDate.getDate(), 28))))}
                >
                  ›
                </button>
              </div>

              <div className="sim-chart-goto-calendar" aria-label={`${calendarMonthLabel} calendar`}>
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(day => (
                  <div key={day} className="sim-chart-goto-day-label">{day}</div>
                ))}
                {calendarDays.map((day, index) => {
                  if (!day) return <div key={`empty-${index}`} aria-hidden="true" />
                  const dayValue = formatCalendarDate(day)
                  const isToday = dayValue === todayDateValue
                  const isFuture = dayValue > todayDateValue
                  const isSelected = dayValue === goToDateInput && !isFuture
                  return (
                    <button
                      key={dayValue}
                      type="button"
                      className={[
                        'sim-chart-goto-day',
                        isToday ? 'sim-chart-goto-day-today' : '',
                        isFuture ? 'sim-chart-goto-day-future' : '',
                        isSelected ? 'sim-chart-goto-day-active' : '',
                      ].filter(Boolean).join(' ')}
                      disabled={isFuture}
                      onClick={() => setGoToDateInput(dayValue)}
                    >
                      {day.getDate()}
                    </button>
                  )
                })}
              </div>

              <div className="sim-chart-goto-footer">
                <button type="button" className="sim-chart-goto-action sim-chart-goto-cancel" onClick={() => setOpenPanel(null)}>Cancel</button>
                <button type="button" className="sim-chart-goto-action sim-chart-goto-submit">Go to</button>
              </div>
            </div>
          )}
        </div>

        <div className="sim-chart-bottom-controls">
          <div className="sim-chart-timezone-shell">
            <button
              type="button"
              className={`sim-chart-bottom-clock ${openPanel === 'timezone' ? 'sim-chart-bottom-clock-active' : ''}`}
              onClick={() => setOpenPanel(openPanel === 'timezone' ? null : 'timezone')}
              title="Chart timezone"
              aria-expanded={openPanel === 'timezone'}
            >
              {utcClock} ({selectedTimeZoneName})
            </button>
            {openPanel === 'timezone' && (
              <div className="sim-chart-timezone-menu" role="menu" aria-label="Chart timezone">
                {majorTimeZones.map(item => (
                  <button
                    key={`major-${item.zone}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={chartTimeZone === item.zone}
                    className={`sim-chart-timezone-option ${chartTimeZone === item.zone ? 'sim-chart-timezone-option-active' : ''}`}
                    onClick={() => {
                      setChartTimeZone(item.zone)
                      setOpenPanel(null)
                    }}
                  >
                    <span className="sim-chart-timezone-check">{chartTimeZone === item.zone ? '✓' : ''}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
                {exchangeTimeZones.map(item => (
                  <button
                    key={`exchange-${item.zone}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={chartTimeZone === item.zone}
                    className={`sim-chart-timezone-option ${chartTimeZone === item.zone ? 'sim-chart-timezone-option-active' : ''}`}
                    onClick={() => {
                      setChartTimeZone(item.zone)
                      setOpenPanel(null)
                    }}
                  >
                    <span className="sim-chart-timezone-check">{chartTimeZone === item.zone ? '✓' : ''}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="sim-chart-bottom-separator" aria-hidden="true" />
          <button
            type="button"
            className={`sim-chart-scale-button ${priceScaleMode === 'percent' ? 'sim-chart-scale-button-active' : ''}`}
            onClick={() => togglePriceScaleMode('percent')}
            title="Percentage scale"
            aria-pressed={priceScaleMode === 'percent'}
          >
            %
          </button>
          <button
            type="button"
            className={`sim-chart-scale-button ${priceScaleMode === 'log' ? 'sim-chart-scale-button-active' : ''}`}
            onClick={() => togglePriceScaleMode('log')}
            title="Logarithmic scale"
            aria-pressed={priceScaleMode === 'log'}
          >
            log
          </button>
          <button
            type="button"
            className={`sim-chart-scale-button sim-chart-scale-button-auto ${autoScaleEnabled ? 'sim-chart-scale-button-active' : ''}`}
            onClick={enableAutoScale}
            title="Auto scale"
            aria-pressed={autoScaleEnabled}
          >
            auto
          </button>
        </div>
      </div>

      {showScrollForward && (
        <div className="sim-chart-floating-actions">
          <button
            type="button"
            className="sim-chart-floating-button"
            title="Scroll to latest"
            onClick={scrollChartForward}
          >
            {ScrollForwardIcon}
          </button>
        </div>
      )}

      {/* ── Active tool label ── */}
      {activeTool && (
        <div style={{
          position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
          zIndex: 30,
          background: 'rgba(13,15,20,0.9)',
          border: '1px solid rgba(215,122,97,0.3)',
          borderRadius: 6,
          padding: '4px 12px',
          fontSize: 10,
          fontWeight: 600,
          color: '#D8B4A0',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          backdropFilter: 'blur(8px)',
          pointerEvents: 'none',
        }}>
          {ALL_DRAW_TOOLS.find(t => t.id === activeTool)?.title ?? activeTool}
          {(() => {
            const requiredPoints = getRequiredPointCount(activeTool)
            if (!isDrawing.current) return ' · click to start'
            const nextPoint = drawingPoints.current.length + 1
            if ((CHANNEL_TOOLS.includes(activeTool) || activeTool === 'flattopbottom' || activeTool === 'disjointchannel') && nextPoint === 3) return ' · click channel width'
            return ` · click point ${Math.min(nextPoint, requiredPoints)}`
          })()}
        </div>
      )}

      {/* ── Loading / Error overlay ── */}
      {(loading || error) && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 40,
          display: 'grid', placeItems: 'center',
          color: error ? '#D77A61' : 'rgba(219,211,216,0.48)',
          background: 'rgba(10,12,16,0.8)',
          fontSize: 12,
          fontWeight: 500,
          letterSpacing: '0.04em',
        }}>
          {error ?? 'در حال بارگذاری...'}
        </div>
      )}
    </div>
  )
}
