export type CanvasBackgroundType = 'solid' | 'gradient'
export type CanvasGridMode = 'none' | 'vertical' | 'horizontal' | 'both'
export type CanvasLineStyle = 'solid' | 'dashed' | 'dotted'
export type CanvasLineWidth = 1 | 2 | 3 | 4

export interface ChartCanvasSettings {
  backgroundType: CanvasBackgroundType
  backgroundTopColor: string
  backgroundTopOpacity: number
  backgroundBottomColor: string
  backgroundBottomOpacity: number
  gridMode: CanvasGridMode
  gridVerticalColor: string
  gridVerticalOpacity: number
  gridHorizontalColor: string
  gridHorizontalOpacity: number
  sessionBreaksVisible: boolean
  sessionBreakColor: string
  sessionBreakOpacity: number
  sessionBreakStyle: CanvasLineStyle
  sessionBreakWidth: CanvasLineWidth
  crosshairColor: string
  crosshairOpacity: number
  crosshairStyle: CanvasLineStyle
  crosshairWidth: CanvasLineWidth
  watermarkVisible: boolean
  watermarkColor: string
  watermarkOpacity: number
  scaleTextColor: string
  scaleTextOpacity: number
  scaleTextSize: number
  scaleLineColor: string
  scaleLineOpacity: number
}

export const CHART_CANVAS_SETTINGS_STORAGE_KEY = 'sim-trade-chart-canvas-settings-v1'

export const DEFAULT_CHART_CANVAS_SETTINGS: ChartCanvasSettings = {
  backgroundType: 'solid',
  backgroundTopColor: '#ffffff',
  backgroundTopOpacity: 100,
  backgroundBottomColor: '#ffffff',
  backgroundBottomOpacity: 100,
  gridMode: 'both',
  gridVerticalColor: '#223843',
  gridVerticalOpacity: 8,
  gridHorizontalColor: '#223843',
  gridHorizontalOpacity: 8,
  sessionBreaksVisible: false,
  sessionBreakColor: '#6d7079',
  sessionBreakOpacity: 58,
  sessionBreakStyle: 'dashed',
  sessionBreakWidth: 1,
  crosshairColor: '#6d7079',
  crosshairOpacity: 58,
  crosshairStyle: 'dashed',
  crosshairWidth: 1,
  watermarkVisible: false,
  watermarkColor: '#00acc1',
  watermarkOpacity: 16,
  scaleTextColor: '#131722',
  scaleTextOpacity: 100,
  scaleTextSize: 12,
  scaleLineColor: '#223843',
  scaleLineOpacity: 12,
}

const BACKGROUND_TYPES = new Set<CanvasBackgroundType>(['solid', 'gradient'])
const GRID_MODES = new Set<CanvasGridMode>(['none', 'vertical', 'horizontal', 'both'])
const LINE_STYLES = new Set<CanvasLineStyle>(['solid', 'dashed', 'dotted'])
const LINE_WIDTHS = new Set<CanvasLineWidth>([1, 2, 3, 4])
const TEXT_SIZES = new Set([10, 11, 12, 14, 16, 18, 20, 24, 28])

function clampOpacity(value: unknown, fallback: number) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric))) : fallback
}

function color(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function normalizeChartCanvasSettings(value: unknown): ChartCanvasSettings {
  const source = value && typeof value === 'object' ? value as Partial<ChartCanvasSettings> : {}
  const defaults = DEFAULT_CHART_CANVAS_SETTINGS
  return {
    backgroundType: BACKGROUND_TYPES.has(source.backgroundType as CanvasBackgroundType) ? source.backgroundType as CanvasBackgroundType : defaults.backgroundType,
    backgroundTopColor: color(source.backgroundTopColor, defaults.backgroundTopColor),
    backgroundTopOpacity: clampOpacity(source.backgroundTopOpacity, defaults.backgroundTopOpacity),
    backgroundBottomColor: color(source.backgroundBottomColor, defaults.backgroundBottomColor),
    backgroundBottomOpacity: clampOpacity(source.backgroundBottomOpacity, defaults.backgroundBottomOpacity),
    gridMode: GRID_MODES.has(source.gridMode as CanvasGridMode) ? source.gridMode as CanvasGridMode : defaults.gridMode,
    gridVerticalColor: color(source.gridVerticalColor, defaults.gridVerticalColor),
    gridVerticalOpacity: clampOpacity(source.gridVerticalOpacity, defaults.gridVerticalOpacity),
    gridHorizontalColor: color(source.gridHorizontalColor, defaults.gridHorizontalColor),
    gridHorizontalOpacity: clampOpacity(source.gridHorizontalOpacity, defaults.gridHorizontalOpacity),
    sessionBreaksVisible: typeof source.sessionBreaksVisible === 'boolean' ? source.sessionBreaksVisible : defaults.sessionBreaksVisible,
    sessionBreakColor: color(source.sessionBreakColor, defaults.sessionBreakColor),
    sessionBreakOpacity: clampOpacity(source.sessionBreakOpacity, defaults.sessionBreakOpacity),
    sessionBreakStyle: LINE_STYLES.has(source.sessionBreakStyle as CanvasLineStyle) ? source.sessionBreakStyle as CanvasLineStyle : defaults.sessionBreakStyle,
    sessionBreakWidth: LINE_WIDTHS.has(source.sessionBreakWidth as CanvasLineWidth) ? source.sessionBreakWidth as CanvasLineWidth : defaults.sessionBreakWidth,
    crosshairColor: color(source.crosshairColor, defaults.crosshairColor),
    crosshairOpacity: clampOpacity(source.crosshairOpacity, defaults.crosshairOpacity),
    crosshairStyle: LINE_STYLES.has(source.crosshairStyle as CanvasLineStyle) ? source.crosshairStyle as CanvasLineStyle : defaults.crosshairStyle,
    crosshairWidth: LINE_WIDTHS.has(source.crosshairWidth as CanvasLineWidth) ? source.crosshairWidth as CanvasLineWidth : defaults.crosshairWidth,
    watermarkVisible: typeof source.watermarkVisible === 'boolean' ? source.watermarkVisible : defaults.watermarkVisible,
    watermarkColor: color(source.watermarkColor, defaults.watermarkColor),
    watermarkOpacity: clampOpacity(source.watermarkOpacity, defaults.watermarkOpacity),
    scaleTextColor: color(source.scaleTextColor, defaults.scaleTextColor),
    scaleTextOpacity: clampOpacity(source.scaleTextOpacity, defaults.scaleTextOpacity),
    scaleTextSize: TEXT_SIZES.has(Number(source.scaleTextSize)) ? Number(source.scaleTextSize) : defaults.scaleTextSize,
    scaleLineColor: color(source.scaleLineColor, defaults.scaleLineColor),
    scaleLineOpacity: clampOpacity(source.scaleLineOpacity, defaults.scaleLineOpacity),
  }
}

export function loadChartCanvasSettings() {
  if (typeof window === 'undefined') return { ...DEFAULT_CHART_CANVAS_SETTINGS }
  try {
    const stored = window.localStorage.getItem(CHART_CANVAS_SETTINGS_STORAGE_KEY)
    return normalizeChartCanvasSettings(stored ? JSON.parse(stored) : null)
  } catch {
    return { ...DEFAULT_CHART_CANVAS_SETTINGS }
  }
}

export function saveChartCanvasSettings(value: ChartCanvasSettings) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CHART_CANVAS_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeChartCanvasSettings(value)))
}
