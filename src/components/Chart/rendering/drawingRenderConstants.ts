// Fibonacci retracement levels — matches TradingView style
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]
export const FIB_TIME_LEVELS = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
export const FIB_SPEED_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]
export const FIB_SPEED_ARC_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236, 4.618]

export const GANN_SQUARE_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]

export const GANN_FAN_RAYS = [
  { label: '1/8', factor: 8, color: '#2962ff' },
  { label: '1/4', factor: 4, color: '#00bcd4' },
  { label: '1/3', factor: 3, color: '#4caf50' },
  { label: '1/2', factor: 2, color: '#089981' },
  { label: '1/1', factor: 1, color: '#00b0ff' },
  { label: '2/1', factor: 0.5, color: '#2962ff' },
  { label: '3/1', factor: 1 / 3, color: '#9c27b0' },
  { label: '4/1', factor: 0.25, color: '#ff2d55' },
  { label: '8/1', factor: 0.125, color: '#ff3b30' },
] as const

export const GANN_FAN_FILL_COLORS = [
  'rgba(41,98,255,0.12)',  // 1/8 - 1/4
  'rgba(0,188,212,0.10)',  // 1/4 - 1/3
  'rgba(76,175,80,0.10)',  // 1/3 - 1/2
  'rgba(8,153,129,0.10)',  // 1/2 - 1/1
  'rgba(41,98,255,0.12)',  // 1/1 - 2/1
  'rgba(156,39,176,0.10)', // 2/1 - 3/1
  'rgba(255,45,85,0.10)',  // 3/1 - 4/1
  'rgba(255,59,48,0.10)',  // 4/1 - 8/1
]

export const GANN_SQUARE_LINE_COLORS: Record<number, string> = {
  0: '#787b86',
  0.25: '#2962ff',
  0.382: '#00bcd4',
  0.5: '#4caf50',
  0.618: '#089981',
  0.75: '#2962ff',
  1: '#787b86',
}

export const GANN_SQUARE_FILL_COLORS: Record<number, string> = {
  0: 'rgba(41,98,255,0.09)',
  0.25: 'rgba(0,188,212,0.08)',
  0.382: 'rgba(76,175,80,0.08)',
  0.5: 'rgba(8,153,129,0.08)',
  0.618: 'rgba(41,98,255,0.08)',
  0.75: 'rgba(120,123,134,0.08)',
}

export const GANN_BOX_LEVELS = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]

export const GANN_BOX_LINE_COLORS: Record<number, string> = {
  0: '#787b86',
  0.25: '#2962ff',
  0.382: '#00bcd4',
  0.5: '#4caf50',
  0.618: '#089981',
  0.75: '#2962ff',
  1: '#787b86',
}

export const GANN_BOX_FILL_COLORS: Record<number, string> = {
  0: 'rgba(41,98,255,0.10)',
  0.25: 'rgba(0,188,212,0.10)',
  0.382: 'rgba(76,175,80,0.10)',
  0.5: 'rgba(8,153,129,0.10)',
  0.618: 'rgba(41,98,255,0.10)',
  0.75: 'rgba(120,123,134,0.10)',
}

export const FIB_WEDGE_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786, 1]
export const FIB_WEDGE_COLORS = [
  '#f23645', // 0.236
  '#2962ff', // 0.382
  '#4caf50', // 0.5
  '#089981', // 0.618
  '#00bcd4', // 0.786
  '#787b86', // 1
]

export const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2

// Line color per level
export const FIB_LINE_COLORS = [
  '#787b86', // 0
  '#f23645', // 0.236
  '#2962ff', // 0.382
  '#4caf50', // 0.5
  '#089981', // 0.618
  '#00bcd4', // 0.786
  '#787b86', // 1
  '#2962ff', // 1.618
  '#f23645', // 2.618
  '#9c27b0', // 3.618
  '#e91e63', // 4.236
]

export const FIB_COLORS = FIB_LINE_COLORS

// Zone fill color between consecutive levels
// Each entry is the fill color for the band ABOVE this level (between level[i] and level[i+1])
export const FIB_ZONE_COLORS = [
  'rgba(242,54,69,0.07)',   // 0 → 0.236  (pink)
  'rgba(41,98,255,0.07)',   // 0.236 → 0.382 (blue)
  'rgba(76,175,80,0.07)',   // 0.382 → 0.5  (green)
  'rgba(8,153,129,0.09)',   // 0.5 → 0.618  (teal)
  'rgba(0,188,212,0.07)',   // 0.618 → 0.786 (cyan)
  'rgba(120,123,134,0.07)', // 0.786 → 1    (grey)
  'rgba(41,98,255,0.08)',   // 1 → 1.618  (blue)
  'rgba(242,54,69,0.06)',   // 1.618 → 2.618
  'rgba(156,39,176,0.06)',  // 2.618 → 3.618
  'rgba(233,30,99,0.06)',   // 3.618 → 4.236
]
export const REGRESSION_DEVIATION_MULTIPLIER = 2

export const CIRCLE_STROKE_COLOR = '#ff9800'
export const CIRCLE_FILL_COLOR = 'rgba(255, 152, 0, 0.22)'
export const CIRCLE_LINE_WIDTH = 1.5

export const ELLIPSE_STROKE_COLOR = '#ff2d55'
export const ELLIPSE_FILL_COLOR = 'rgba(255, 45, 85, 0.18)'
export const ELLIPSE_LINE_WIDTH = 1.5

export const CLOSED_POLYLINE_FILL_COLOR = 'rgba(0, 188, 212, 0.18)'
export const CLOSED_POLYLINE_DISTANCE_PX = 14

export const ARC_STROKE_COLOR = '#e91e63'
export const ARC_FILL_COLOR = 'rgba(233, 30, 99, 0.18)'
export const ARC_LINE_WIDTH = 1.5

export const DOUBLE_CURVE_STROKE_COLOR = '#6d3fd1'
export const DOUBLE_CURVE_LINE_WIDTH = 1.8
