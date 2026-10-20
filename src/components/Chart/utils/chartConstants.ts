// ─────────────────────────────────────────────
// Node index sentinels
// negative values are reserved for virtual/derived handle nodes
// (real point indices are 0, 1, 2, … matching Drawing.points array)
// ─────────────────────────────────────────────
export const NODE_INDICES = {
  /** Drag the whole drawing (clicked on a line segment, not a handle) */
  WHOLE_DRAG: -1,
  /** CrossLine — horizontal arm */
  CROSSLINE_HORIZONTAL: -2,
  /** CrossLine — vertical arm */
  CROSSLINE_VERTICAL: -3,

  // Parallel-channel virtual handles
  CHANNEL_BASE_MIDDLE:     -20,
  CHANNEL_PARALLEL_MIDDLE: -21,
  CHANNEL_PARALLEL_START:  -22,
  CHANNEL_PARALLEL_END:    -23,

  // Flat-top / flat-bottom virtual handles
  FLAT_HORIZONTAL_START: -24,
  FLAT_HORIZONTAL_END:   -25,

  // Disjoint-channel virtual handles
  DISJOINT_REFERENCE:   -26,
  DISJOINT_INVERSE_END: -27,

  // Position-tool virtual handles
  POSITION_TARGET: -40,
  POSITION_STOP:   -41,
  POSITION_WIDTH:  -42,

  // Rectangle virtual handles
  RECT_TOP:    -60,
  RECT_RIGHT:  -61,
  RECT_BOTTOM: -62,
  RECT_LEFT:   -63,
  RECT_TOP_RIGHT:    -64,
  RECT_BOTTOM_LEFT:  -65,

  // Rotated rectangle virtual corner handles
  ROT_RECT_A: -70,
  ROT_RECT_B: -71,
  ROT_RECT_C: -72,
  ROT_RECT_D: -73,

  // Ellipse virtual mirrored width handle
  ELLIPSE_OPPOSITE_WIDTH: -80,

  // Text tools body drag handle
  TEXT_BODY: -90,
} as const

export type NodeIndex = (typeof NODE_INDICES)[keyof typeof NODE_INDICES] | number

// ─────────────────────────────────────────────
// Hit-testing thresholds (px)
// ─────────────────────────────────────────────
export const HIT = {
  /** Radius around a handle node that counts as a hit */
  NODE: 10,
  /** Distance from a line segment that counts as a hit */
  LINE: 6,
  /** Distance from a trade price line that counts as a hit */
  TRADE_LINE: 7,
} as const

// ─────────────────────────────────────────────
// Chart layout / storage
// ─────────────────────────────────────────────
export const CHART_LAYOUT_STORAGE_KEY = 'sim-trade-chart-layout'

// ─────────────────────────────────────────────
// Playback
// ─────────────────────────────────────────────
export const MIN_PLAYBACK_INTERVAL_MS = 50

// ─────────────────────────────────────────────
// Trade level step (minimum distance between entry/sl/tp)
// ─────────────────────────────────────────────
export const LEVEL_STEP = 0.001

// ─────────────────────────────────────────────
// Zoom factors
// ─────────────────────────────────────────────
export const ZOOM = {
  IN_FACTOR:  0.72,
  OUT_FACTOR: 1.38,
  MIN_BARS:   5,
} as const

// ─────────────────────────────────────────────
// Reset view defaults
// ─────────────────────────────────────────────
export const VIEW = {
  VISIBLE_BARS:       120,
  RIGHT_PADDING_BARS: 18,
} as const
