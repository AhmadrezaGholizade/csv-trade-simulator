import type { CandlestickData, ISeriesApi, Logical, SeriesType } from 'lightweight-charts'

export type DrawTool =
  | 'trendline' | 'ray' | 'infoline' | 'extendedline' | 'trendangle'
  | 'horizontal' | 'horizontalray' | 'vertical' | 'crossline'
  | 'parallelchannel' | 'regressiontrend' | 'flattopbottom' | 'disjointchannel'
  | 'pitchfork' | 'schiffpitchfork' | 'modifiedschiffpitchfork' | 'insidepitchfork'
  | 'fibonacci' | 'trendbasedfibextension' | 'fibchannel' | 'fibtimezone'
  | 'fibspeedresistancefan' | 'trendbasedfibtime' | 'fibcircles'
  | 'fibspiral' | 'fibspeedresistancearcs' | 'fibwedge' | 'pitchfan'
  | 'gannbox' | 'gannsquarefixed' | 'gannsquare' | 'gannfan'
  | 'fibfan'
  | 'xabcdpattern' | 'cypherpattern' | 'headandshoulders' | 'abcdpattern'
  | 'trianglepattern' | 'threedrivespattern'
  | 'elliottimpulse' | 'elliottcorrection' | 'elliotttriangle'
  | 'elliottdoublecombo' | 'elliotttriplecombo'
  | 'cycliclines' | 'timecycles' | 'sineline'
  | 'longposition' | 'shortposition' | 'forecast' | 'barspattern'
  | 'ghostfeed' | 'projection'
  | 'anchoredvwap' | 'fixedrangevolumeprofile'
  | 'pricerange' | 'daterange' | 'dateandpricerange'
  | 'brush' | 'highlighter'
  | 'arrowmarker' | 'arrow' | 'arrowmarkup' | 'arrowmarkdown'
  | 'arrowmarkleft' | 'arrowmarkright'
  | 'rectangle' | 'rotatedrectangle' | 'path' | 'circle' | 'ellipse'
  | 'polyline' | 'triangle' | 'arc' | 'curve' | 'doublecurve'
  | 'text' | 'anchoredtext' | 'note' | 'anchorednote' | 'callout'
  | 'comment' | 'pricelabel' | 'signpost' | 'flagmark'
  | null

export interface Point {
  time: number | null
  logical: Logical
  price: number
  x: number
  y: number
}

export interface Drawing {
  id: string
  tool: DrawTool
  points: Point[]
  color: string
  opacity?: number
  lineWidth?: number
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  text?: string
  textOffset?: { x: number; y: number }
  anchored?: boolean
  series?: ISeriesApi<'Line'>[]
}

export interface IndicatorSeries {
  series: ISeriesApi<'Line' | 'Histogram'>[]
  decorations?: ISeriesApi<SeriesType>[]
  refreshDecorations?: (data: CandlestickData[]) => void
  paneIndex?: number
  priceScaleId?: string
  pane?: number
}

export interface SelectedDrawing {
  id: string
  panelX: number
  panelY: number
}

export type CursorMode = 'cross' | 'dot' | 'arrow' | 'eraser'

export interface PixelPoint {
  x: number
  y: number
  price: number
  time: number | null
  logical?: Logical
}
