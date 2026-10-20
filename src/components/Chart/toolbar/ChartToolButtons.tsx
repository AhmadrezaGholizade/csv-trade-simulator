/* eslint-disable react-refresh/only-export-components -- shared toolbar module intentionally exports styles and components */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import type { CursorMode, DrawTool } from '../chartTypes'
import { Ico } from './drawingIcons'
import { getGroupTools } from './toolRegistry'
import type { ToolGroup } from './toolRegistry'

// ─────────────────────────────────────────────
// Shared button styles
// ─────────────────────────────────────────────
export const chartButtonStyles = {
  pill: (active: boolean): CSSProperties => ({
    padding: '2px 8px',
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 4,
    cursor: 'pointer',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    border: active ? '1px solid var(--accent)' : '1px solid var(--chart-axis)',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--app-text)' : 'var(--text-dim)',
    transition: 'all 0.12s',
    userSelect: 'none' as const,
    height: 22,
    display: 'flex',
    alignItems: 'center',
  }),
  icon: (active: boolean, size = 28): CSSProperties => ({
    width: size,
    height: size,
    borderRadius: 4,
    cursor: 'pointer',
    padding: 0,
    border: '1px solid transparent',
    background: active ? 'var(--surface-soft)' : 'transparent',
    color: active ? 'var(--app-text)' : 'var(--tool-icon)',
    transition: 'all 0.12s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none' as const,
    flexShrink: 0,
  }),
  flyout: (): CSSProperties => ({
    position: 'fixed' as const,
    left: 58,
    top: 0,
    direction: 'ltr' as const,
    textAlign: 'left' as const,
    background: 'var(--surface-0)',
    border: '1px solid var(--border-soft)',
    borderRadius: 3,
    padding: '7px 7px 9px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
    minWidth: 250,
    maxHeight: 'calc(100vh - 16px)',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    zIndex: 200,
    boxShadow: '0 16px 34px rgba(0,0,0,0.52)',
  }),
  flyoutItem: (active: boolean): CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: '26px 1fr auto',
    alignItems: 'center',
    gap: 9,
    width: '100%',
    minHeight: 34,
    padding: '4px 8px',
    borderRadius: 2,
    cursor: 'pointer',
    border: 'none',
    background: active ? 'rgba(216,180,160,0.14)' : 'transparent',
    color: active ? 'var(--app-text)' : 'var(--text-muted)',
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    transition: 'all 0.1s',
    direction: 'ltr' as const,
    textAlign: 'left' as const,
  }),
  flyoutSectionTitle: (): CSSProperties => ({
    color: 'var(--text-dim)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.05em',
    lineHeight: '18px',
    padding: '4px 8px 5px',
    textTransform: 'uppercase' as const,
  }),
  flyoutDivider: (): CSSProperties => ({
    height: 1,
    margin: '7px 0',
    background: 'var(--border-soft)',
  }),
  toolDivider: (): CSSProperties => ({
    width: 36,
    height: 1,
    margin: '5px auto',
    background: 'var(--border-soft)',
    flexShrink: 0,
  }),
}

// ─────────────────────────────────────────────
// Sub-component: ToolGroupButton
// – Click icon  → activate last selected tool in group (start drawing)
// – Click ">"   → open/close flyout (only visible on hover)
// – Select item → update group's pinned tool, close panel, start drawing
// ─────────────────────────────────────────────
interface ToolGroupButtonProps {
  group: ToolGroup
  activeTool: DrawTool
  pinnedTool: DrawTool          // last selected tool for this group
  openPanel: string | null
  setOpenPanel: (id: string | null) => void
  onSelectTool: (id: DrawTool) => void
  onPinTool: (groupId: string, toolId: DrawTool) => void
}

export function ToolGroupButton({ group, activeTool, pinnedTool, openPanel, setOpenPanel, onSelectTool, onPinTool }: ToolGroupButtonProps) {
  const isOpen  = openPanel === group.id
  const [hovered, setHovered] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [flyoutPosition, setFlyoutPosition] = useState({ left: 58, top: 44 })

  // The displayed icon: pinned tool takes priority, else group default
  const groupTools = getGroupTools(group)
  const displayTool = groupTools.find(t => t.id === pinnedTool) ?? groupTools[0]
  const isActive    = activeTool === displayTool.id

  const handleIconClick = () => {
    // Toggle: if already active deactivate, else activate pinned/default tool
    if (activeTool === displayTool.id) {
      onSelectTool(null)
    } else {
      onSelectTool(displayTool.id)
    }
    if (isOpen) setOpenPanel(null)
  }

  const handleChevronClick = (e: MouseEvent) => {
    e.stopPropagation()
    setHovered(false)
    setOpenPanel(isOpen ? null : group.id)
  }

  const handleItemClick = (toolId: DrawTool) => {
    onPinTool(group.id, toolId)   // update pinned so icon changes permanently
    onSelectTool(toolId)           // start drawing immediately
    setOpenPanel(null)
  }

  useEffect(() => {
    if (!isOpen) return
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const panelWidth = 250
      const left = Math.min(rect.right + 4, window.innerWidth - panelWidth - 8)
      const top = Math.max(44, Math.min(rect.top, window.innerHeight - 420))
      setFlyoutPosition({ left, top })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen])

  return (
    <div
      ref={anchorRef}
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchEnd={() => setHovered(false)}
    >
      {/* Main row: icon button + chevron */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {/* Icon — click to draw */}
        <button
          title={displayTool.title}
          onClick={handleIconClick}
          style={{
            ...chartButtonStyles.icon(isActive, 36),
            borderRadius: 3,
            color: isActive ? 'var(--tool-icon-active)' : hovered ? 'var(--app-text)' : 'var(--tool-icon)',
            background: isActive
              ? 'rgba(216,180,160,0.14)'
              : hovered
                ? 'rgba(255,255,255,0.06)'
                : 'transparent',
            transition: 'all 0.12s',
          }}
        >
          {displayTool.icon}
        </button>

        {/* Chevron */}
        <button
          title="More tools"
          onClick={handleChevronClick}
          style={{
            width: hovered || isOpen ? 12 : 10,
            height: 36,
            overflow: 'hidden',
            padding: 0,
            border: 'none',
            borderRadius: 2,
            background: isOpen
              ? 'rgba(216,180,160,0.18)'
              : isActive
                ? 'rgba(216,180,160,0.10)'
                : hovered
                  ? 'rgba(255,255,255,0.06)'
                  : 'transparent',
            color: isOpen ? 'var(--tool-icon-active)' : hovered ? 'var(--tool-icon)' : 'var(--tool-shortcut)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'width 0.15s, color 0.12s, background 0.12s',
            flexShrink: 0,
          }}
        >
          <span style={{
            display: 'flex',
            alignItems: 'center',
            transform: isOpen ? 'scaleX(-1)' : 'none',
            transition: 'transform 0.15s',
            opacity: hovered || isOpen ? 1 : 0.72,
          } as CSSProperties}>
            {Ico.chevron}
          </span>
        </button>
      </div>

      {/* Flyout panel */}
      {isOpen && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 150 }}
            onClick={() => {
              setHovered(false)
              setOpenPanel(null)
            }}
          />
          <div style={{
            ...chartButtonStyles.flyout(),
            left: flyoutPosition.left,
            top: flyoutPosition.top,
            maxHeight: `calc(100dvh - ${flyoutPosition.top + 96}px)`,
          }}>
            {(group.sections ?? [{ title: group.title, tools: group.tools }]).map((section, index) => (
              <div key={section.title}>
                {index > 0 && <div style={chartButtonStyles.flyoutDivider()} />}
                <div style={chartButtonStyles.flyoutSectionTitle()}>{section.title}</div>
                {section.tools.map(tool => (
                  <button
                    key={tool.id}
                    onClick={() => handleItemClick(tool.id)}
                    style={chartButtonStyles.flyoutItem(pinnedTool === tool.id)}
                  >
                    <span className="sim-chart-flyout-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tool-icon)' }}>{tool.icon}</span>
                    <span>{tool.title}</span>
                    <span style={{ color: 'var(--tool-shortcut)', fontSize: 11, fontWeight: 600 }}>{tool.shortcut}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// Sub-component: CursorButton (same hover-chevron pattern)
// ─────────────────────────────────────────────
interface CursorButtonProps {
  cursorMode: CursorMode
  openPanel: string | null
  setOpenPanel: (id: string | null) => void
  onSelect: (m: CursorMode) => void
}

const CURSOR_ITEMS: { key: CursorMode; label: string; icon: ReactNode }[] = [
  { key: 'cross',  label: 'Crosshair', icon: Ico.cross  },
  { key: 'dot',    label: 'Dot',       icon: Ico.dot    },
  { key: 'arrow',  label: 'Arrow',     icon: Ico.arrow  },
  { key: 'eraser', label: 'Eraser',    icon: Ico.eraser },
]

export function CursorButton({ cursorMode, openPanel, setOpenPanel, onSelect }: CursorButtonProps) {
  const isOpen  = openPanel === 'cursor'
  const [hovered, setHovered] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [flyoutPosition, setFlyoutPosition] = useState({ left: 58, top: 44 })
  const current = CURSOR_ITEMS.find(c => c.key === cursorMode)!
  const isActive = cursorMode !== 'arrow'

  const handleChevronClick = (e: MouseEvent) => {
    e.stopPropagation()
    setHovered(false)
    setOpenPanel(isOpen ? null : 'cursor')
  }

  useEffect(() => {
    if (!isOpen) return
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const panelWidth = 250
      const left = Math.min(rect.right + 4, window.innerWidth - panelWidth - 8)
      const top = Math.max(44, Math.min(rect.top, window.innerHeight - 260))
      setFlyoutPosition({ left, top })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen])

  return (
    <div
      ref={anchorRef}
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchEnd={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {/* Icon — click to cycle or just show current */}
        <button
          title={current.label}
          onClick={() => { /* clicking icon does nothing extra for cursor */ }}
          style={{
            ...chartButtonStyles.icon(isActive, 36),
            borderRadius: 3,
            color: isActive ? 'var(--tool-icon-active)' : hovered ? 'var(--app-text)' : 'var(--tool-icon)',
            background: isActive
              ? 'rgba(216,180,160,0.14)'
              : hovered
                ? 'rgba(255,255,255,0.06)'
                : 'transparent',
            transition: 'all 0.12s',
          }}
        >
          {current.icon}
        </button>

        {/* Chevron */}
        <button
          title="Cursor options"
          onClick={handleChevronClick}
          style={{
            width: hovered || isOpen ? 12 : 10,
            height: 36,
            overflow: 'hidden',
            padding: 0,
            border: 'none',
            borderRadius: 2,
            background: isOpen
              ? 'rgba(216,180,160,0.18)'
              : isActive
                ? 'rgba(216,180,160,0.10)'
                : hovered
                  ? 'rgba(255,255,255,0.06)'
                  : 'transparent',
            color: isOpen ? 'var(--tool-icon-active)' : hovered ? 'var(--tool-icon)' : 'var(--tool-shortcut)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'width 0.15s, color 0.12s, background 0.12s',
            flexShrink: 0,
          }}
        >
          <span style={{
            display: 'flex',
            alignItems: 'center',
            transform: isOpen ? 'scaleX(-1)' : 'none',
            transition: 'transform 0.15s',
            opacity: hovered || isOpen ? 1 : 0.72,
          }}>
            {Ico.chevron}
          </span>
        </button>
      </div>

      {isOpen && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 150 }}
            onClick={() => {
              setHovered(false)
              setOpenPanel(null)
            }}
          />
          <div style={{
            ...chartButtonStyles.flyout(),
            left: flyoutPosition.left,
            top: flyoutPosition.top,
            maxHeight: `calc(100dvh - ${flyoutPosition.top + 96}px)`,
          }}>
            <div style={{
              fontSize: 9, fontWeight: 700, color: 'var(--tool-shortcut)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '3px 8px 4px',
            }}>
              Cursor
            </div>
            {CURSOR_ITEMS.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => { onSelect(key); setOpenPanel(null) }}
                style={chartButtonStyles.flyoutItem(cursorMode === key)}
              >
                <span className="sim-chart-flyout-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.8 }}>{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

interface DeleteMenuButtonProps {
  drawingsCount: number
  indicatorsCount: number
  openPanel: string | null
  setOpenPanel: (id: string | null) => void
  onClearDrawings: () => void
  onClearIndicators: () => void
}

const countLabel = (count: number, singular: string) =>
  `${count} ${singular}${count === 1 ? '' : 's'}`

const removeLabel = (count: number, singular: string) =>
  `Remove ${countLabel(count, singular)}`

export function DeleteMenuButton({
  drawingsCount,
  indicatorsCount,
  openPanel,
  setOpenPanel,
  onClearDrawings,
  onClearIndicators,
}: DeleteMenuButtonProps) {
  const isOpen = openPanel === 'delete'
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [menuPosition, setMenuPosition] = useState({ left: 52, top: 44 })
  const [hoveredItem, setHoveredItem] = useState<number | null>(null)
  const hasDrawings = drawingsCount > 0
  const hasIndicators = indicatorsCount > 0

  useEffect(() => {
    if (!isOpen) return
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const menuWidth = 234
      const menuHeight = 128
      setMenuPosition({
        left: Math.min(rect.right + 4, window.innerWidth - menuWidth - 8),
        top: Math.max(8, Math.min(rect.top, window.innerHeight - menuHeight - 8)),
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen])

  const runAndClose = (action: () => void) => {
    action()
    setOpenPanel(null)
  }

  const itemStyle = (index: number): CSSProperties => ({
    width: '100%',
    minHeight: 38,
    padding: '8px 12px',
    border: 0,
    borderRadius: 4,
    background: hoveredItem === index ? 'rgba(216,180,160,0.14)' : 'transparent',
    color: hoveredItem === index ? 'var(--tool-icon-active)' : 'var(--app-text)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.25,
    textAlign: 'left',
    whiteSpace: 'nowrap',
    outline: 'none',
    transition: 'background 120ms ease, color 120ms ease',
  })

  const itemHoverProps = (index: number) => ({
    onMouseEnter: () => setHoveredItem(index),
    onMouseLeave: () => setHoveredItem(null),
    onFocus: () => setHoveredItem(index),
    onBlur: () => setHoveredItem(null),
  })

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        title="Remove drawings or indicators"
        aria-label="Remove drawings or indicators"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setOpenPanel(isOpen ? null : 'delete')}
        style={{
          ...chartButtonStyles.icon(isOpen, 36),
          color: hasDrawings || hasIndicators || isOpen ? 'var(--tool-icon-active)' : 'var(--tool-shortcut)',
          background: isOpen ? 'rgba(216,180,160,0.14)' : 'transparent',
        }}
      >
        {Ico.trash}
      </button>

      {isOpen && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 150 }}
            onPointerDown={() => setOpenPanel(null)}
          />
          <div
            role="menu"
            aria-label="Remove chart items"
            className="sim-chart-delete-menu"
            style={{
              position: 'fixed',
              left: menuPosition.left,
              top: menuPosition.top,
              zIndex: 200,
              width: 234,
              padding: 5,
              border: '1px solid var(--border-soft)',
              borderRadius: 7,
              background: 'var(--surface-0)',
              boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
              direction: 'ltr',
              textAlign: 'left',
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => runAndClose(onClearDrawings)}
              style={itemStyle(0)}
              {...itemHoverProps(0)}
            >
              {removeLabel(drawingsCount, 'drawing')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runAndClose(onClearIndicators)}
              style={itemStyle(1)}
              {...itemHoverProps(1)}
            >
              {removeLabel(indicatorsCount, 'indicator')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => runAndClose(() => {
                onClearDrawings()
                onClearIndicators()
              })}
              style={itemStyle(2)}
              {...itemHoverProps(2)}
            >
              Remove {countLabel(drawingsCount, 'drawing')} &amp; {countLabel(indicatorsCount, 'indicator')}
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

