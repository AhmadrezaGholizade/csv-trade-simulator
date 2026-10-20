import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { Drawing } from '../chartTypes'
import { Ico } from '../toolbar/drawingIcons'
import { ALL_DRAW_TOOLS } from '../toolbar/toolRegistry'
import { getDrawingSettingsPanelWidth, getDrawingToolSettings } from './drawingSettingsRegistry'
import type { DrawingColorControl } from './drawingSettingsRegistry'

const DRAWING_COLOR_PALETTE = [
  '#ffffff', '#e5e7eb', '#c4c7cc', '#9ca3af', '#7b8088', '#5f636b', '#40444b', '#2d3036', '#17191d', '#050607',
  '#f23645', '#ff9800', '#ffcc00', '#4caf62', '#16a085', '#00a6a6', '#0097a7', '#4263eb', '#7e57c2', '#c12a87',
  '#ffc7ce', '#ffe1b5', '#fff0a8', '#bfe3c5', '#b9e5d9', '#b5e5e7', '#b5dce9', '#b8d0f5', '#cbbce8', '#efbad7',
  '#ff9aa5', '#ffc46b', '#ffe36d', '#89ca98', '#65c9b6', '#58cbd0', '#5ab6ca', '#6d9fee', '#9a7bc8', '#dc72aa',
  '#f45b69', '#ffa726', '#ffd43b', '#43a85a', '#12a58f', '#00aeb5', '#078da0', '#3675dc', '#7651bf', '#cf338b',
  '#d92735', '#f57c00', '#e9b900', '#218b3d', '#087f70', '#007f86', '#087080', '#2458c6', '#5935aa', '#ad176c',
  '#a51825', '#d55300', '#c99000', '#12692b', '#006258', '#00636a', '#075661', '#173fa2', '#412489', '#870c55',
]

const LINE_STYLES = [
  ['solid', 'Line'],
  ['dashed', 'Dashed line'],
  ['dotted', 'Dotted line'],
] as const

type DrawingStylePatch = Pick<Drawing, 'color' | 'opacity' | 'lineStyle' | 'lineWidth'>
type OpenMenu = 'color' | 'opacity' | 'style' | 'width' | null

interface DrawingSettingsPanelProps {
  drawing: Drawing
  left: string | number
  top: number
  onMove: (dx: number, dy: number) => void
  onUpdate: (patch: Partial<DrawingStylePatch>) => void
  onDelete: () => void
}

export function DrawingSettingsPanel({
  drawing,
  left,
  top,
  onMove,
  onUpdate,
  onDelete,
}: DrawingSettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const settings = getDrawingToolSettings(drawing.tool)
  const panelWidth = getDrawingSettingsPanelWidth(drawing.tool)
  const toolMeta = useMemo(
    () => ALL_DRAW_TOOLS.find(tool => tool.id === drawing.tool),
    [drawing.tool],
  )

  useEffect(() => {
    if (!openMenu) return
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && panelRef.current?.contains(target)) return
      setOpenMenu(null)
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [openMenu])

  const stopPanelEvent = (event: React.SyntheticEvent) => event.stopPropagation()
  const toggleMenu = (menu: Exclude<OpenMenu, null>) => {
    setOpenMenu(current => current === menu ? null : menu)
  }

  return (
    <div
      ref={panelRef}
      className="sim-chart-selection-panel"
      role="toolbar"
      aria-label={`${toolMeta?.title ?? 'Drawing'} settings`}
      onMouseDown={stopPanelEvent}
      onPointerDown={stopPanelEvent}
      onClick={stopPanelEvent}
      style={{
        position: 'absolute',
        left,
        top,
        zIndex: 50,
        width: panelWidth,
        boxSizing: 'border-box',
        background: 'var(--surface-0)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-soft)',
        borderRadius: 8,
        padding: '5px 7px',
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        boxShadow: '0 4px 24px rgba(0,0,0,0.28)',
        backdropFilter: 'blur(12px)',
        pointerEvents: 'auto',
      }}
    >
      <DragHandle onMove={onMove} />
      <ToolIdentity title={toolMeta?.title ?? String(drawing.tool ?? 'Drawing')} icon={toolMeta?.icon} />

      {settings.color && (
        <ColorControl
          drawing={drawing}
          label={getColorLabel(settings.color)}
          open={openMenu === 'color'}
          panelWidth={panelWidth}
          showOpacity={settings.opacity}
          onToggle={() => toggleMenu('color')}
          onUpdate={onUpdate}
        />
      )}

      {!settings.color && settings.opacity && (
        <OpacityControl
          opacity={drawing.opacity ?? 100}
          open={openMenu === 'opacity'}
          onToggle={() => toggleMenu('opacity')}
          onUpdate={opacity => onUpdate({ opacity })}
        />
      )}

      {settings.lineWidth && (
        <LineWidthControl
          value={drawing.lineWidth ?? settings.defaultLineWidth ?? 2}
          widths={settings.lineWidths ?? [1, 2, 3, 4]}
          open={openMenu === 'width'}
          onToggle={() => toggleMenu('width')}
          onSelect={lineWidth => {
            onUpdate({ lineWidth })
            setOpenMenu(null)
          }}
        />
      )}

      {settings.lineStyle && (
        <LineStyleControl
          value={drawing.lineStyle ?? 'solid'}
          open={openMenu === 'style'}
          onToggle={() => toggleMenu('style')}
          onSelect={lineStyle => {
            onUpdate({ lineStyle })
            setOpenMenu(null)
          }}
        />
      )}

      <Divider />
      <button
        type="button"
        className="sim-chart-line-width-trigger sim-chart-drawing-delete-trigger"
        data-tooltip="Delete"
        aria-label="Delete drawing"
        onClick={onDelete}
        style={{
          width: 30, height: 30, flex: '0 0 30px', borderRadius: 4, cursor: 'pointer', border: 'none',
          background: 'transparent', color: '#D77A61',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {Ico.trash}
      </button>
    </div>
  )
}

function ToolIdentity({ title, icon }: { title: string; icon?: ReactNode }) {
  return (
    <span
      className="sim-chart-drawing-tool-identity"
      title={title}
      role="img"
      aria-label={title}
      style={{
        width: 30, height: 30, flex: '0 0 30px', display: 'grid', placeItems: 'center',
        color: 'var(--text-secondary)', overflow: 'hidden', boxSizing: 'border-box',
        border: '1px solid color-mix(in srgb, var(--text-primary) 8%, var(--border-soft))',
        borderRadius: 4, background: 'color-mix(in srgb, var(--text-primary) 7%, var(--surface-0))',
        cursor: 'default', pointerEvents: 'none', userSelect: 'none',
      }}
    >
      <span className="sim-chart-drawing-tool-identity-icon" aria-hidden="true">
        {icon ?? Ico.trendline}
      </span>
    </span>
  )
}

function ColorControl({
  drawing,
  label,
  open,
  panelWidth,
  showOpacity,
  onToggle,
  onUpdate,
}: {
  drawing: Drawing
  label: string
  open: boolean
  panelWidth: number
  showOpacity: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<DrawingStylePatch>) => void
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="sim-chart-line-width-trigger"
        data-tooltip={label}
        aria-label={label}
        aria-expanded={open}
        onClick={onToggle}
        style={{
          position: 'relative', width: 30, height: 30, padding: '3px 5px 8px', border: 0, borderRadius: 4,
          display: 'grid', placeItems: 'center', cursor: 'pointer',
          color: 'var(--text-primary)', background: 'transparent',
        }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M10.62.72a2.47 2.47 0 0 1 3.5 0l1.16 1.16c.96.97.96 2.54 0 3.5l-.58.58-8.9 8.9-1 1-.14.14H0v-4.65l.14-.15 1-1 8.9-8.9.58-.58Zm2.8.7a1.48 1.48 0 0 0-2.1 0l-.23.23 3.26 3.26.23-.23c.58-.58.58-1.52 0-2.1l-1.16-1.16Zm.23 4.2-3.26-3.27-8.2 8.2 3.25 3.27 8.2-8.2Zm-8.9 8.9-3.27-3.26-.5.5V15h3.27l.5-.5Z" />
        </svg>
        <span style={{
          position: 'absolute', left: 4, right: 4, bottom: 2, height: 3,
          borderRadius: 2, background: drawing.color,
          opacity: (drawing.opacity ?? 100) / 100,
        }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: -(panelWidth - 78), zIndex: 70,
          width: 248, padding: 12, border: '1px solid var(--border-soft)', borderRadius: 7,
          background: 'var(--surface-0)', boxShadow: '0 7px 22px rgba(0,0,0,0.42)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 18px)', gap: 5 }}>
            {DRAWING_COLOR_PALETTE.map(color => {
              const active = drawing.color.toLowerCase() === color
              return (
                <button
                  type="button"
                  key={color}
                  className="sim-chart-color-swatch"
                  title={color}
                  aria-label={`Set color ${color}`}
                  aria-pressed={active}
                  onClick={() => onUpdate({ color })}
                  style={{
                    width: 18, height: 18, padding: 0, cursor: 'pointer', borderRadius: 2, background: color,
                    border: active ? '2px solid var(--surface-0)' : '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
                    outline: active ? '2px solid var(--accent)' : 'none', outlineOffset: 1,
                  }}
                />
              )
            })}
          </div>
          {showOpacity && (
            <>
              <div style={{ height: 1, margin: '12px 0 10px', background: 'var(--border-soft)' }} />
              <OpacityEditor
                color={drawing.color}
                opacity={drawing.opacity ?? 100}
                onUpdate={opacity => onUpdate({ opacity })}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function OpacityControl({
  opacity,
  open,
  onToggle,
  onUpdate,
}: {
  opacity: number
  open: boolean
  onToggle: () => void
  onUpdate: (opacity: number) => void
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="sim-chart-line-width-trigger"
        data-tooltip="Opacity"
        aria-label="Opacity"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          width: 42, height: 24, padding: '0 4px', border: 0, borderRadius: 4,
          display: 'grid', placeItems: 'center', cursor: 'pointer',
          color: 'var(--text-primary)', background: 'transparent', fontSize: 11,
        }}
      >
        {opacity}%
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: -8, zIndex: 70,
          width: 210, padding: 12, border: '1px solid var(--border-soft)', borderRadius: 7,
          background: 'var(--surface-0)', boxShadow: '0 7px 22px rgba(0,0,0,0.42)',
        }}>
          <OpacityEditor color="#787b86" opacity={opacity} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  )
}

function OpacityEditor({ color, opacity, onUpdate }: { color: string; opacity: number; onUpdate: (opacity: number) => void }) {
  return (
    <div style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)' }}>
      Opacity
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <input
          className="sim-chart-opacity-range"
          type="range"
          aria-label="Opacity percentage"
          min="0"
          max="100"
          step="1"
          value={opacity}
          onChange={event => onUpdate(Number(event.target.value))}
          style={{
            flex: 1,
            '--drawing-color': color,
            '--drawing-opacity': `${opacity}%`,
          } as CSSProperties}
        />
        <label style={{ position: 'relative', width: 48 }}>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            aria-label="Opacity percentage"
            value={opacity}
            onChange={event => onUpdate(clampOpacity(event.target.value))}
            style={{
              width: '100%', height: 28, padding: '3px 16px 3px 5px',
              color: 'var(--text-primary)', background: 'transparent',
              border: '1px solid var(--border-soft)', borderRadius: 4,
              textAlign: 'right', font: 'inherit', fontSize: 12,
            }}
          />
          <span style={{ position: 'absolute', right: 5, top: 6, pointerEvents: 'none', fontSize: 12 }}>%</span>
        </label>
      </div>
    </div>
  )
}

function LineStyleControl({
  value,
  open,
  onToggle,
  onSelect,
}: {
  value: NonNullable<Drawing['lineStyle']>
  open: boolean
  onToggle: () => void
  onSelect: (lineStyle: NonNullable<Drawing['lineStyle']>) => void
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="sim-chart-line-width-trigger"
        data-tooltip="Line style"
        aria-label="Line style"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          width: 30, height: 24, padding: '0 5px', border: 0, borderRadius: 4,
          display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'inherit', background: 'transparent',
        }}
      >
        <LineSample style={value} width={20} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: -8, zIndex: 70,
          width: 134, padding: 0, overflow: 'hidden',
          border: '1px solid var(--border-soft)', borderRadius: 7,
          background: 'var(--surface-0)', boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
        }}>
          {LINE_STYLES.map(([lineStyle, label], index) => {
            const active = value === lineStyle
            return (
              <button
                type="button"
                key={lineStyle}
                className="sim-chart-line-width-option"
                data-active={active}
                aria-pressed={active}
                onClick={() => onSelect(lineStyle)}
                style={{
                  width: '100%', height: 36, padding: '0 11px', border: 0,
                  borderTop: index === 0 ? 0 : '1px solid var(--border-soft)',
                  display: 'flex', alignItems: 'center', gap: 10,
                  cursor: 'pointer', color: 'var(--text-primary)', background: 'transparent',
                  fontSize: 13, whiteSpace: 'nowrap',
                }}
              >
                <LineSample style={lineStyle} width={20} thin />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function LineWidthControl({
  value,
  widths,
  open,
  onToggle,
  onSelect,
}: {
  value: number
  widths: readonly number[]
  open: boolean
  onToggle: () => void
  onSelect: (lineWidth: number) => void
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="sim-chart-line-width-trigger"
        data-tooltip="Line width"
        aria-label="Line width"
        aria-expanded={open}
        onClick={onToggle}
        style={{
          width: 54, height: 22, padding: '0 4px', borderRadius: 4, cursor: 'pointer',
          border: 'none', color: 'inherit', background: 'transparent',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <span style={{ width: 16, height: Math.min(4, value), background: 'currentColor', borderRadius: 1 }} />
        <span>{value}px</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', left: -5, zIndex: 60,
          width: 82, padding: 0, overflow: 'hidden',
          border: '1px solid var(--border-soft)', borderRadius: 7,
          background: 'var(--surface-0)', boxShadow: '0 5px 14px rgba(0,0,0,0.45)',
        }}>
          {widths.map((lineWidth, index) => {
            const active = value === lineWidth
            return (
              <button
                type="button"
                key={lineWidth}
                className="sim-chart-line-width-option"
                data-active={active}
                aria-pressed={active}
                onClick={() => onSelect(lineWidth)}
                style={{
                  width: '100%', height: 34, padding: '0 11px', border: 0,
                  borderTop: index === 0 ? 0 : '1px solid var(--border-soft)',
                  display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                  fontSize: 13, color: 'var(--text-primary)', background: 'transparent',
                }}
              >
                <span style={{ width: 18, height: Math.min(5, lineWidth), flex: '0 0 18px', borderRadius: 2, background: 'currentColor' }} />
                <span>{lineWidth}px</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function getColorLabel(control: Exclude<DrawingColorControl, false>) {
  if (control === 'border') return 'Border color'
  if (control === 'text') return 'Text color'
  if (control === 'fill') return 'Fill color'
  if (control === 'brush') return 'Brush color'
  return 'Line color'
}

function clampOpacity(value: string) {
  const opacity = Number(value)
  if (!Number.isFinite(opacity)) return 0
  return Math.min(100, Math.max(0, opacity))
}

function Divider() {
  return <div aria-hidden="true" style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)' }} />
}

function LineSample({ style, width, thin = false }: { style: NonNullable<Drawing['lineStyle']>; width: number; thin?: boolean }) {
  return <span style={{ width, height: 0, borderTop: `${thin ? 1 : 2}px ${style} currentColor` }} />
}

function DragHandle({ onMove }: { onMove: (dx: number, dy: number) => void }) {
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragX = String(event.clientX)
    event.currentTarget.dataset.dragY = String(event.clientY)
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const previousX = Number(event.currentTarget.dataset.dragX)
    const previousY = Number(event.currentTarget.dataset.dragY)
    onMove(event.clientX - previousX, event.clientY - previousY)
    event.currentTarget.dataset.dragX = String(event.clientX)
    event.currentTarget.dataset.dragY = String(event.clientY)
  }

  const releaseDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      title="Move settings"
      aria-label="Move settings"
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={releaseDrag}
      onPointerCancel={releaseDrag}
      style={{
        width: 12, height: 22, display: 'grid',
        gridTemplateColumns: 'repeat(2, 3px)', gridTemplateRows: 'repeat(3, 3px)',
        placeContent: 'center', gap: 2, flex: '0 0 12px', cursor: 'grab', touchAction: 'none', opacity: 0.55,
      }}
    >
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor' }} />
      ))}
    </div>
  )
}
