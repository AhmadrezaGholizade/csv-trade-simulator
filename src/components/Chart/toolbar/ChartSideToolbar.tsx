import type { Dispatch, SetStateAction } from 'react'
import type { CursorMode, DrawTool } from '../chartTypes'
import { Ico } from './drawingIcons'
import { TOOL_GROUPS, getGroupTools } from './toolRegistry'
import { CursorButton, DeleteMenuButton, ToolGroupButton, chartButtonStyles as css } from './ChartToolButtons'

interface ChartSideToolbarProps {
  activeTool: DrawTool
  cursorMode: CursorMode
  drawingsCount: number
  indicatorsCount: number
  drawingsHidden: boolean
  drawingsLocked: boolean
  openPanel: string | null
  pinnedTools: Record<string, DrawTool>
  setActiveTool: Dispatch<SetStateAction<DrawTool>>
  setCursorMode: Dispatch<SetStateAction<CursorMode>>
  setOpenPanel: Dispatch<SetStateAction<string | null>>
  onActivateRangeMeasure: () => void
  onClearDrawings: () => void
  onClearIndicators: () => void
  onPinTool: (groupId: string, toolId: DrawTool) => void
  onToggleDrawingsHidden: () => void
  onToggleDrawingsLock: () => void
  onZoomTimeScale: (direction: 'in' | 'out') => void
}

export function ChartSideToolbar({
  activeTool,
  cursorMode,
  drawingsCount,
  indicatorsCount,
  drawingsHidden,
  drawingsLocked,
  openPanel,
  pinnedTools,
  setActiveTool,
  setCursorMode,
  setOpenPanel,
  onActivateRangeMeasure,
  onClearDrawings,
  onClearIndicators,
  onPinTool,
  onToggleDrawingsHidden,
  onToggleDrawingsLock,
  onZoomTimeScale,
}: ChartSideToolbarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 36,
        bottom: 0,
        left: 0,
        zIndex: 20,
        width: 52,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        background: 'var(--chart-toolbar)',
        padding: '8px 6px',
        borderRight: '1px solid var(--chart-axis)',
        boxShadow: '1px 0 0 rgba(0,0,0,0.08)',
      }}
      className="sim-chart-tools"
    >
      <CursorButton
        cursorMode={cursorMode}
        openPanel={openPanel}
        setOpenPanel={setOpenPanel}
        onSelect={mode => {
          setCursorMode(mode)
          setActiveTool(null)
        }}
      />

      <div style={css.toolDivider()} />

      {TOOL_GROUPS.map(group => (
        <ToolGroupButton
          key={group.id}
          group={group}
          activeTool={activeTool}
          pinnedTool={pinnedTools[group.id] ?? getGroupTools(group)[0].id}
          openPanel={openPanel}
          setOpenPanel={setOpenPanel}
          onSelectTool={tool => {
            setActiveTool(tool)
            if (tool) setCursorMode('arrow')
          }}
          onPinTool={onPinTool}
        />
      ))}

      <div style={css.toolDivider()} />

      <button
        title="Date and Price Range"
        onClick={onActivateRangeMeasure}
        style={{
          ...css.icon(activeTool === 'dateandpricerange', 36),
          color: activeTool === 'dateandpricerange' ? 'var(--tool-icon-active)' : 'var(--tool-icon)',
        }}
      >
        {Ico.measure}
      </button>
      <button
        title="Zoom in"
        onClick={() => onZoomTimeScale('in')}
        style={{ ...css.icon(false, 36), color: 'var(--tool-icon)' }}
      >
        {Ico.zoomin}
      </button>
      <button
        title="Zoom out"
        onClick={() => onZoomTimeScale('out')}
        style={{ ...css.icon(false, 36), color: 'var(--tool-icon)' }}
      >
        {Ico.zoomout}
      </button>

      <div style={css.toolDivider()} />

      <button
        title="Lock all drawings"
        onClick={onToggleDrawingsLock}
        style={{
          ...css.icon(drawingsLocked, 36),
          color: drawingsLocked ? 'var(--tool-icon-active)' : 'var(--tool-icon)',
        }}
      >
        {drawingsLocked ? Ico.lockon : Ico.lock}
      </button>
      <button
        title="Hide all drawings"
        onClick={onToggleDrawingsHidden}
        style={{
          ...css.icon(drawingsHidden, 36),
          color: drawingsHidden ? 'var(--tool-icon-active)' : 'var(--tool-icon)',
        }}
      >
        {drawingsHidden ? Ico.hideall : Ico.hideVisible}
      </button>

      <div style={css.toolDivider()} />

      <DeleteMenuButton
        drawingsCount={drawingsCount}
        indicatorsCount={indicatorsCount}
        openPanel={openPanel}
        setOpenPanel={setOpenPanel}
        onClearDrawings={onClearDrawings}
        onClearIndicators={onClearIndicators}
      />
    </div>
  )
}
