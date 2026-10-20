import type { DrawTool } from '../chartTypes'

export type DrawingToolId = Exclude<DrawTool, null>
export type DrawingColorControl = false | 'line' | 'border' | 'text' | 'fill' | 'brush'

export interface DrawingToolSettings {
  color: DrawingColorControl
  opacity: boolean
  lineStyle: boolean
  lineWidth: boolean
  forceStrokeColor?: boolean
  defaultLineWidth?: number
  lineWidths?: readonly number[]
}

const STANDARD_WIDTHS = [1, 2, 3, 4] as const
const BRUSH_WIDTHS = [1, 2, 3, 4, 6, 8, 12] as const
const HIGHLIGHTER_WIDTHS = [8, 12, 16, 24, 32] as const

const line = (forceStrokeColor = false): DrawingToolSettings => ({
  color: 'line',
  opacity: true,
  lineStyle: true,
  lineWidth: true,
  forceStrokeColor,
  defaultLineWidth: 2,
  lineWidths: STANDARD_WIDTHS,
})

const multiColorLine: DrawingToolSettings = {
  color: false,
  opacity: true,
  lineStyle: true,
  lineWidth: true,
  defaultLineWidth: 1,
  lineWidths: STANDARD_WIDTHS,
}

const opacityOnly: DrawingToolSettings = {
  color: false,
  opacity: true,
  lineStyle: false,
  lineWidth: false,
}

const colorOnly = (color: Exclude<DrawingColorControl, false>): DrawingToolSettings => ({
  color,
  opacity: true,
  lineStyle: false,
  lineWidth: false,
})

const borderShape = (defaultLineWidth = 2): DrawingToolSettings => ({
  color: 'border',
  opacity: true,
  lineStyle: true,
  lineWidth: true,
  forceStrokeColor: true,
  defaultLineWidth,
  lineWidths: STANDARD_WIDTHS,
})

export const DRAWING_SETTINGS_BY_TOOL: Record<DrawingToolId, DrawingToolSettings> = {
  // Lines
  trendline: line(),
  ray: line(),
  infoline: line(),
  extendedline: line(),
  trendangle: line(),
  horizontal: line(),
  horizontalray: line(),
  vertical: line(),
  crossline: line(),

  // Channels
  parallelchannel: line(),
  regressiontrend: line(),
  flattopbottom: line(),
  disjointchannel: line(),

  // Pitchforks keep their internal red/green/blue palette.
  pitchfork: { ...multiColorLine },
  schiffpitchfork: { ...multiColorLine },
  modifiedschiffpitchfork: { ...multiColorLine },
  insidepitchfork: { ...multiColorLine },

  // Fibonacci and Gann drawings are intentionally multi-color.
  fibonacci: { ...multiColorLine },
  trendbasedfibextension: { ...multiColorLine },
  fibchannel: { ...multiColorLine },
  fibtimezone: { ...multiColorLine },
  fibspeedresistancefan: { ...multiColorLine },
  trendbasedfibtime: { ...multiColorLine },
  fibcircles: { ...multiColorLine },
  fibspiral: { ...multiColorLine },
  fibspeedresistancearcs: { ...multiColorLine },
  fibwedge: { ...multiColorLine },
  pitchfan: { ...multiColorLine },
  gannbox: { ...multiColorLine },
  gannsquarefixed: { ...multiColorLine },
  gannsquare: { ...multiColorLine },
  gannfan: { ...multiColorLine },
  fibfan: { ...multiColorLine },

  // Patterns and waves use one editable structural line color.
  xabcdpattern: line(true),
  cypherpattern: line(true),
  headandshoulders: line(true),
  abcdpattern: line(true),
  trianglepattern: line(true),
  threedrivespattern: line(true),
  elliottimpulse: line(true),
  elliottcorrection: line(true),
  elliotttriangle: line(true),
  elliottdoublecombo: line(true),
  elliotttriplecombo: line(true),
  cycliclines: line(true),
  timecycles: line(true),
  sineline: line(true),

  // Trading and projection tools preserve semantic colors and fills.
  longposition: { ...opacityOnly },
  shortposition: { ...opacityOnly },
  forecast: line(),
  barspattern: { ...opacityOnly },
  ghostfeed: { ...opacityOnly },
  projection: { ...opacityOnly },
  anchoredvwap: { ...multiColorLine },
  fixedrangevolumeprofile: { ...opacityOnly },
  pricerange: { ...opacityOnly },
  daterange: { ...opacityOnly },
  dateandpricerange: { ...opacityOnly },

  // Freehand tools have width but no dash pattern.
  brush: {
    color: 'brush',
    opacity: true,
    lineStyle: false,
    lineWidth: true,
    defaultLineWidth: 2,
    lineWidths: BRUSH_WIDTHS,
  },
  highlighter: {
    color: 'brush',
    opacity: true,
    lineStyle: false,
    lineWidth: true,
    defaultLineWidth: 24,
    lineWidths: HIGHLIGHTER_WIDTHS,
  },

  // Arrows
  arrowmarker: colorOnly('fill'),
  arrow: line(),
  arrowmarkup: colorOnly('fill'),
  arrowmarkdown: colorOnly('fill'),
  arrowmarkleft: colorOnly('fill'),
  arrowmarkright: colorOnly('fill'),

  // Shapes
  rectangle: borderShape(),
  rotatedrectangle: borderShape(1.5),
  path: line(),
  circle: borderShape(1.5),
  ellipse: borderShape(1.5),
  polyline: borderShape(),
  triangle: borderShape(),
  arc: borderShape(1.5),
  curve: line(),
  doublecurve: borderShape(1.8),

  // Text tools only expose controls that affect their current renderer.
  text: colorOnly('text'),
  anchoredtext: colorOnly('text'),
  note: { ...opacityOnly },
  anchorednote: { ...opacityOnly },
  callout: { ...opacityOnly },
  comment: colorOnly('fill'),
  pricelabel: colorOnly('fill'),
  signpost: { ...opacityOnly },
  flagmark: colorOnly('fill'),
}

export function getDrawingToolSettings(tool: DrawTool): DrawingToolSettings {
  return tool ? DRAWING_SETTINGS_BY_TOOL[tool] : opacityOnly
}

export function getDrawingSettingsPanelWidth(tool: DrawTool) {
  const settings = getDrawingToolSettings(tool)
  const controlWidths = [
    settings.color ? 30 : 0,
    !settings.color && settings.opacity ? 42 : 0,
    settings.lineStyle ? 30 : 0,
    settings.lineWidth ? 54 : 0,
  ].filter(Boolean)
  // Frame + drag handle + fixed tool identity + divider + delete button + flex gaps.
  return 104 + controlWidths.reduce((sum, width) => sum + width, 0) + controlWidths.length * 5
}

export function getDrawingLineDash(lineStyle: 'solid' | 'dashed' | 'dotted' | undefined) {
  if (lineStyle === 'dashed') return [8, 5]
  if (lineStyle === 'dotted') return [1, 5]
  return []
}
