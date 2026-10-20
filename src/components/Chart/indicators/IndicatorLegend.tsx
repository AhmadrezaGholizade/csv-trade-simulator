import { createPortal } from 'react-dom'
import type { IndicatorLegendValue } from './indicatorLegendUtils'

interface IndicatorLegendRowProps {
  name: string
  values: IndicatorLegendValue[]
  visible: boolean
  selected: boolean
  onSelect: () => void
  onToggleVisibility: () => void
  onRemove: () => void
}

interface PaneIndicatorLegendProps extends IndicatorLegendRowProps {
  target: HTMLElement | null
}

const EyeIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="2.75" />
  </svg>
)

const HiddenIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 3l18 18M10.6 5.2A10.8 10.8 0 0 1 12 5c6 0 9.5 7 9.5 7a15.4 15.4 0 0 1-2.1 3M6.2 6.2C3.8 8 2.5 12 2.5 12S6 19 12 19a9.8 9.8 0 0 0 4.1-.9M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </svg>
)

const SettingsIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.56-1H3v-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63h.02A1.7 1.7 0 0 0 10 3.09V3h4v.09A1.7 1.7 0 0 0 15 4.65a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9v.02A1.7 1.7 0 0 0 20.91 10H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
  </svg>
)

const TrashIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3M18 7l-1 13H7L6 7M10 11v5M14 11v5" />
  </svg>
)

export function IndicatorLegendRow({
  name,
  values,
  visible,
  selected,
  onSelect,
  onToggleVisibility,
  onRemove,
}: IndicatorLegendRowProps) {
  return (
    <div
      className={`sim-chart-indicator-legend-row ${selected ? 'sim-chart-indicator-legend-row-selected' : ''} ${visible ? '' : 'sim-chart-indicator-legend-row-hidden'}`}
      role="toolbar"
      aria-label={`${name} indicator controls`}
      tabIndex={0}
      onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onClick={onSelect}
      onFocus={onSelect}
    >
      <span className="sim-chart-indicator-legend-name">{name}</span>
      {values.map((value, index) => (
        <span
          key={`${name}-${index}`}
          className="sim-chart-indicator-legend-value"
          style={{ color: value.color }}
        >
          {value.text}
        </span>
      ))}
      <span className="sim-chart-indicator-legend-actions">
        <button
          type="button"
          title={visible ? 'Hide indicator' : 'Show indicator'}
          aria-label={visible ? `Hide ${name}` : `Show ${name}`}
          aria-pressed={visible}
          onClick={event => {
            event.stopPropagation()
            onToggleVisibility()
          }}
        >
          {visible ? EyeIcon : HiddenIcon}
        </button>
        <button
          type="button"
          title="Settings"
          aria-label={`${name} settings`}
          onClick={event => event.stopPropagation()}
        >
          {SettingsIcon}
        </button>
        <button
          type="button"
          title="Remove indicator"
          aria-label={`Remove ${name}`}
          onClick={event => {
            event.stopPropagation()
            onRemove()
          }}
        >
          {TrashIcon}
        </button>
      </span>
    </div>
  )
}

export function PaneIndicatorLegend({ target, ...props }: PaneIndicatorLegendProps) {
  if (!target) return null
  return createPortal(
    <div className="sim-chart-pane-indicator-legends">
      <IndicatorLegendRow {...props} />
    </div>,
    target,
  )
}
