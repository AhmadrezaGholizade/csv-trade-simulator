import type { DrawTool } from '../chartTypes'
import { Ico } from './drawingIcons'

export interface ToolItem {
  id: DrawTool
  title: string
  icon: React.ReactNode
  shortcut?: string
}

export interface ToolSection {
  title: string
  tools: ToolItem[]
}

export interface ToolGroup {
  id: string
  title: string
  icon: React.ReactNode
  tools: ToolItem[]
  sections?: ToolSection[]
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'lines', title: 'Lines', icon: Ico.trendline,
    tools: [
      { id: 'trendline',     title: 'Trend Line',       icon: Ico.trendline },
      { id: 'ray',           title: 'Ray',               icon: Ico.ray },
      { id: 'infoline',      title: 'Info Line',         icon: Ico.infoline },
      { id: 'extendedline',  title: 'Extended Line',     icon: Ico.extendedline },
      { id: 'trendangle',    title: 'Trend Angle',       icon: Ico.trendangle },
      { id: 'horizontal',    title: 'Horizontal Line',   icon: Ico.horizontal },
      { id: 'horizontalray', title: 'Horizontal Ray',    icon: Ico.horizontalray },
      { id: 'vertical',      title: 'Vertical Line',     icon: Ico.vertical },
      { id: 'crossline',     title: 'Cross Line',        icon: Ico.crossline },
    ],
    sections: [
      {
        title: 'Lines',
        tools: [
          { id: 'trendline',     title: 'Trendline',       icon: Ico.trendline, shortcut: 'Alt + T' },
          { id: 'ray',           title: 'Ray',             icon: Ico.ray },
          { id: 'infoline',      title: 'Info line',       icon: Ico.infoline },
          { id: 'extendedline',  title: 'Extended line',   icon: Ico.extendedline },
          { id: 'trendangle',    title: 'Trend angle',     icon: Ico.trendangle },
          { id: 'horizontal',    title: 'Horizontal line', icon: Ico.horizontal, shortcut: 'Alt + H' },
          { id: 'horizontalray', title: 'Horizontal ray',  icon: Ico.horizontalray, shortcut: 'Alt + J' },
          { id: 'vertical',      title: 'Vertical line',   icon: Ico.vertical, shortcut: 'Alt + V' },
          { id: 'crossline',     title: 'Cross line',      icon: Ico.crossline, shortcut: 'Alt + C' },
        ],
      },
      {
        title: 'Channels',
        tools: [
          { id: 'parallelchannel', title: 'Parallel channel', icon: Ico.parallelchannel },
          { id: 'regressiontrend', title: 'Regression trend', icon: Ico.regressiontrend },
          { id: 'flattopbottom', title: 'Flat top/bottom', icon: Ico.flattopbottom },
          { id: 'disjointchannel', title: 'Disjoint channel', icon: Ico.disjointchannel },
        ],
      },
      {
        title: 'Pitchforks',
        tools: [
          { id: 'pitchfork', title: 'Pitchfork', icon: Ico.pitchfork },
          { id: 'schiffpitchfork', title: 'Schiff pitchfork', icon: Ico.schiffpitchfork },
          { id: 'modifiedschiffpitchfork', title: 'Modified Schiff pitchfork', icon: Ico.modifiedschiffpitchfork },
          { id: 'insidepitchfork', title: 'Inside pitchfork', icon: Ico.insidepitchfork },
        ],
      },
    ],
  },
  {
    id: 'fibonacci', title: 'Fibonacci', icon: Ico.fibonacci,
    tools: [
      { id: 'fibonacci',    title: 'Fib Retracement', icon: Ico.fibonacci },
      { id: 'trendbasedfibextension', title: 'Trend-Based Fib Extension', icon: Ico.fibextension },
      { id: 'fibchannel', title: 'Fib Channel', icon: Ico.fibchannel },
      { id: 'fibtimezone', title: 'Fib Time Zone', icon: Ico.fibtimezone },
      { id: 'fibspeedresistancefan', title: 'Fib Speed Resistance Fan', icon: Ico.fibfan },
      { id: 'trendbasedfibtime', title: 'Trend-Based Fib Time', icon: Ico.fibtrendtime },
      { id: 'fibcircles', title: 'Fib Circles', icon: Ico.fibcircles },
      { id: 'fibspiral', title: 'Fib Spiral', icon: Ico.fibspiral },
      { id: 'fibspeedresistancearcs', title: 'Fib Speed Resistance Arcs', icon: Ico.fibarcs },
      { id: 'fibwedge', title: 'Fib Wedge', icon: Ico.fibwedge },
      { id: 'pitchfan', title: 'Pitchfan', icon: Ico.pitchfan },
    ],
    sections: [
      {
        title: 'Fibonacci',
        tools: [
          { id: 'fibonacci', title: 'Fib Retracement', icon: Ico.fibonacci, shortcut: 'Alt + F' },
          { id: 'trendbasedfibextension', title: 'Trend-Based Fib Extension', icon: Ico.fibextension },
          { id: 'fibchannel', title: 'Fib Channel', icon: Ico.fibchannel },
          { id: 'fibtimezone', title: 'Fib Time Zone', icon: Ico.fibtimezone },
          { id: 'fibspeedresistancefan', title: 'Fib Speed Resistance Fan', icon: Ico.fibfan },
          { id: 'trendbasedfibtime', title: 'Trend-Based Fib Time', icon: Ico.fibtrendtime },
          { id: 'fibcircles', title: 'Fib Circles', icon: Ico.fibcircles },
          { id: 'fibspiral', title: 'Fib Spiral', icon: Ico.fibspiral },
          { id: 'fibspeedresistancearcs', title: 'Fib Speed Resistance Arcs', icon: Ico.fibarcs },
          { id: 'fibwedge', title: 'Fib Wedge', icon: Ico.fibwedge },
          { id: 'pitchfan', title: 'Pitchfan', icon: Ico.pitchfan },
        ],
      },
      {
        title: 'Gann',
        tools: [
          { id: 'gannbox', title: 'Gann Box', icon: Ico.gannbox },
          { id: 'gannsquarefixed', title: 'Gann Square Fixed', icon: Ico.gannsquarefixed },
          { id: 'gannsquare', title: 'Gann Square', icon: Ico.gannsquare },
          { id: 'gannfan', title: 'Gann Fan', icon: Ico.gannfan },
        ],
      },
    ],
  },
  {
    id: 'patterns', title: 'Patterns', icon: Ico.xabcdpattern,
    tools: [
      { id: 'xabcdpattern', title: 'XABCD Pattern', icon: Ico.xabcdpattern },
      { id: 'cypherpattern', title: 'Cypher Pattern', icon: Ico.cypherpattern },
      { id: 'headandshoulders', title: 'Head and Shoulders', icon: Ico.headshoulders },
      { id: 'abcdpattern', title: 'ABCD Pattern', icon: Ico.abcdpattern },
      { id: 'trianglepattern', title: 'Triangle Pattern', icon: Ico.trianglepattern },
      { id: 'threedrivespattern', title: 'Three Drives Pattern', icon: Ico.threedrivespattern },
    ],
    sections: [
      {
        title: 'Patterns',
        tools: [
          { id: 'xabcdpattern', title: 'XABCD Pattern', icon: Ico.xabcdpattern },
          { id: 'cypherpattern', title: 'Cypher Pattern', icon: Ico.cypherpattern },
          { id: 'headandshoulders', title: 'Head and Shoulders', icon: Ico.headshoulders },
          { id: 'abcdpattern', title: 'ABCD Pattern', icon: Ico.abcdpattern },
          { id: 'trianglepattern', title: 'Triangle Pattern', icon: Ico.trianglepattern },
          { id: 'threedrivespattern', title: 'Three Drives Pattern', icon: Ico.threedrivespattern },
        ],
      },
      {
        title: 'Elliott Waves',
        tools: [
          { id: 'elliottimpulse', title: 'Elliott Impulse Wave (12345)', icon: Ico.elliottimpulse },
          { id: 'elliottcorrection', title: 'Elliott Correction Wave (ABC)', icon: Ico.elliottcorrection },
          { id: 'elliotttriangle', title: 'Elliott Triangle Wave (ABCDE)', icon: Ico.elliotttriangle },
          { id: 'elliottdoublecombo', title: 'Elliott Double Combo Wave (WXY)', icon: Ico.elliottdoublecombo },
          { id: 'elliotttriplecombo', title: 'Elliott Triple Combo Wave (WXYZ)', icon: Ico.elliotttriplecombo },
        ],
      },
      {
        title: 'Cycles',
        tools: [
          { id: 'cycliclines', title: 'Cyclic Lines', icon: Ico.cycles },
          { id: 'timecycles', title: 'Time Cycles', icon: Ico.timecycles },
          { id: 'sineline', title: 'Sine Line', icon: Ico.sineline },
        ],
      },
    ],
  },
  {
    id: 'projection', title: 'Projection', icon: Ico.position,
    tools: [
      { id: 'longposition', title: 'Long Position', icon: Ico.longposition },
      { id: 'shortposition', title: 'Short Position', icon: Ico.shortposition },
      { id: 'forecast', title: 'Forecast', icon: Ico.forecast },
      { id: 'barspattern', title: 'Bars Pattern', icon: Ico.barspattern },
      { id: 'ghostfeed', title: 'Ghost Feed', icon: Ico.ghostfeed },
      { id: 'projection', title: 'Projection', icon: Ico.projection },
    ],
    sections: [
      {
        title: 'Projection',
        tools: [
          { id: 'longposition', title: 'Long Position', icon: Ico.longposition },
          { id: 'shortposition', title: 'Short Position', icon: Ico.shortposition },
          { id: 'forecast', title: 'Forecast', icon: Ico.forecast },
          { id: 'barspattern', title: 'Bars Pattern', icon: Ico.barspattern },
          { id: 'ghostfeed', title: 'Ghost Feed', icon: Ico.ghostfeed },
          { id: 'projection', title: 'Projection', icon: Ico.projection },
        ],
      },
      {
        title: 'Volume-Based',
        tools: [
          { id: 'anchoredvwap', title: 'Anchored VWAP', icon: Ico.anchoredvwap },
          { id: 'fixedrangevolumeprofile', title: 'Fixed Range Volume Profile', icon: Ico.fixedrangevolumeprofile },
        ],
      },
      {
        title: 'Measurer',
        tools: [
          { id: 'pricerange', title: 'Price Range', icon: Ico.pricerange },
          { id: 'daterange', title: 'Date Range', icon: Ico.daterange },
          { id: 'dateandpricerange', title: 'Date and Price Range', icon: Ico.dateandpricerange },
        ],
      },
    ],
  },
  {
    id: 'textnotes', title: 'Text & Notes', icon: Ico.texttool,
    tools: [
      { id: 'text', title: 'Text', icon: Ico.texttool },
      { id: 'anchoredtext', title: 'Anchored Text', icon: Ico.anchoredtext },
      { id: 'note', title: 'Note', icon: Ico.note },
      { id: 'callout', title: 'Callout', icon: Ico.callout },
      { id: 'comment', title: 'Comment', icon: Ico.comment },
      { id: 'pricelabel', title: 'Price Label', icon: Ico.label },
      { id: 'signpost', title: 'Signpost', icon: Ico.signpost },
      { id: 'flagmark', title: 'Flag Mark', icon: Ico.flagmark },
    ],
    sections: [
      {
        title: 'Text & Notes',
        tools: [
          { id: 'text', title: 'Text', icon: Ico.texttool },
          { id: 'anchoredtext', title: 'Anchored Text', icon: Ico.anchoredtext },
          { id: 'note', title: 'Note', icon: Ico.note },
          { id: 'callout', title: 'Callout', icon: Ico.callout },
          { id: 'comment', title: 'Comment', icon: Ico.comment },
          { id: 'pricelabel', title: 'Price Label', icon: Ico.label },
          { id: 'signpost', title: 'Signpost', icon: Ico.signpost },
          { id: 'flagmark', title: 'Flag Mark', icon: Ico.flagmark },
        ],
      },
    ],
  },
  {
    id: 'shapes', title: 'Shapes', icon: Ico.brush,
    tools: [
      { id: 'brush', title: 'Brush', icon: Ico.brush },
      { id: 'highlighter', title: 'Highlighter', icon: Ico.highlighter },
      { id: 'arrowmarker', title: 'Arrow Marker', icon: Ico.arrowmarker },
      { id: 'rectangle', title: 'Rectangle', icon: Ico.rectangle },
    ],
    sections: [
      {
        title: 'Brushes',
        tools: [
          { id: 'brush', title: 'Brush', icon: Ico.brush },
          { id: 'highlighter', title: 'Highlighter', icon: Ico.highlighter },
        ],
      },
      {
        title: 'Arrows',
        tools: [
          { id: 'arrowmarker', title: 'Arrow Marker', icon: Ico.arrowmarker },
          { id: 'arrow', title: 'Arrow', icon: Ico.shapeArrow },
          { id: 'arrowmarkup', title: 'Arrow Mark Up', icon: Ico.arrowup },
          { id: 'arrowmarkdown', title: 'Arrow Mark Down', icon: Ico.arrowdown },
          { id: 'arrowmarkleft', title: 'Arrow Mark Left', icon: Ico.arrowleft },
          { id: 'arrowmarkright', title: 'Arrow Mark Right', icon: Ico.arrowright },
        ],
      },
      {
        title: 'Shapes',
        tools: [
          { id: 'rectangle', title: 'Rectangle', icon: Ico.rectangle, shortcut: 'Alt + Shift + R' },
          { id: 'rotatedrectangle', title: 'Rotated Rectangle', icon: Ico.rotatedrect },
          { id: 'path', title: 'Path', icon: Ico.path },
          { id: 'circle', title: 'Circle', icon: Ico.circle },
          { id: 'ellipse', title: 'Ellipse', icon: Ico.ellipse },
          { id: 'polyline', title: 'Polyline', icon: Ico.polyline },
          { id: 'triangle', title: 'Triangle', icon: Ico.triangle },
          { id: 'arc', title: 'Arc', icon: Ico.arc },
          { id: 'curve', title: 'Curve', icon: Ico.curve },
          { id: 'doublecurve', title: 'Double Curve', icon: Ico.doublecurve },
        ],
      },
    ],
  },
]

export const getGroupTools = (group: ToolGroup) =>
  group.sections?.flatMap(section => section.tools) ?? group.tools

export const ALL_DRAW_TOOLS = TOOL_GROUPS.flatMap(getGroupTools)

export const TOOL_GROUP_ID_BY_TOOL = new Map<DrawTool, string>(
  TOOL_GROUPS.flatMap(group =>
    getGroupTools(group).map(tool => [tool.id, group.id] as const)
  )
)
