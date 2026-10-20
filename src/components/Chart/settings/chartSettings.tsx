/* eslint-disable react-refresh/only-export-components -- shared chart settings module intentionally exports JSX icons and helpers */
import type { CSSProperties } from 'react'
import type { PriceFormat } from 'lightweight-charts'

export type ChartSettingsTab = 'symbol' | 'canvas'
export type SettingsColorSlot = 'bodyUp' | 'bodyDown' | 'borderUp' | 'borderDown' | 'wickUp' | 'wickDown'
export type SettingsPrecision = 'default' | 'integer' | `decimal-${number}`

export const SettingsArrowDownIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
    <path fill="currentColor" d="M3.92 7.83 9 12.29l5.08-4.46-1-1.13L9 10.29l-4.09-3.6-.99 1.14Z" />
  </svg>
)

export const SettingsGearIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="24" height="24" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M18 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-1 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    <path fillRule="evenodd" d="M8.5 5h11l5 9-5 9h-11l-5-9 5-9Zm-3.86 9L9.1 6h9.82l4.45 8-4.45 8H9.1l-4.45-8Z" />
  </svg>
)

export const SettingsSymbolIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="21" height="21" aria-hidden="true">
    <path fill="currentColor" d="M12 7h-.75V4h-1.5v3H9a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h.75v3h1.5v-3H12a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1ZM9.5 19.5v-11h2v11h-2Zm8-3v-5h2v5h-2Zm.24-6.5H17a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.75v3h1.5v-3H20a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-.76V7h-1.5v3Z" />
  </svg>
)

export const SettingsCanvasIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="21" height="21" aria-hidden="true">
    <path fill="currentColor" d="M16.73 6.56a2.5 2.5 0 0 1 3.54 0l1.17 1.17a2.5 2.5 0 0 1 0 3.54l-.59.58-9 9-1 1-.14.15H6v-4.7l.15-.15 1-1 9-9 .58-.59Zm2.83.7a1.5 1.5 0 0 0-2.12 0l-.23.24 3.29 3.3.23-.24a1.5 1.5 0 0 0 0-2.12l-1.17-1.17Zm.23 4.24L16.5 8.2l-8.3 8.3 3.3 3.3 8.3-8.3Zm-9 9L7.5 17.2l-.5.5V21h3.3l.5-.5Z" />
  </svg>
)

export const PRECISION_OPTIONS: { value: SettingsPrecision; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'integer', label: 'Integer' },
  ...Array.from({ length: 15 }, (_, index) => ({
    value: `decimal-${index + 1}` as SettingsPrecision,
    label: `${index + 1} ${index + 1 === 1 ? 'decimal' : 'decimals'}`,
  })),
]

const SETTINGS_COLOR_PALETTE = [
  '#ffffff', '#d1d5db', '#bfc3c9', '#a9adb5', '#858892', '#6d7079', '#4b5563', '#374151', '#111827', '#000000',
  '#f23645', '#ff9800', '#ffeb3b', '#8bc34a', '#009688', '#00acc1', '#2962ff', '#673ab7', '#9c27b0', '#e91e63',
  '#ffcdd2', '#ffe0b2', '#fff9c4', '#dcedc8', '#b2dfdb', '#b2ebf2', '#bbdefb', '#d1c4e9', '#e1bee7', '#f8bbd0',
  '#ef9a9a', '#ffcc80', '#fff59d', '#c5e1a5', '#80cbc4', '#80deea', '#90caf9', '#b39ddb', '#ce93d8', '#f48fb1',
  '#ef5350', '#ffb74d', '#fff176', '#aed581', '#4db6ac', '#4dd0e1', '#64b5f6', '#9575cd', '#ba68c8', '#f06292',
  '#f44336', '#ff9800', '#ffeb3b', '#8bc34a', '#009688', '#00acc1', '#2962ff', '#673ab7', '#9c27b0', '#e91e63',
  '#b71c1c', '#e65100', '#ff6f00', '#1b5e20', '#004d40', '#006064', '#0d47a1', '#311b92', '#4a148c', '#880e4f',
]

export function colorWithOpacity(color: string, opacity: number) {
  if (!color.startsWith('#')) return color
  const hex = color.slice(1)
  const full = hex.length === 3 ? hex.split('').map(part => part + part).join('') : hex
  const value = Number.parseInt(full, 16)
  if (!Number.isFinite(value)) return color
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${Math.min(100, Math.max(0, opacity)) / 100})`
}

export function getSettingsPriceFormat(precision: SettingsPrecision, defaultFormat: PriceFormat): PriceFormat {
  if (precision === 'default') return defaultFormat
  if (precision === 'integer') return { type: 'price', precision: 0, minMove: 1 }
  const digits = Number(precision.replace('decimal-', ''))
  return { type: 'price', precision: digits, minMove: 10 ** -digits }
}

interface ChartSettingsColorPopoverProps {
  activeColor: string
  opacity: number
  onSelect: (color: string) => void
  onOpacityChange: (opacity: number) => void
  thickness?: number
  onThicknessChange?: (thickness: 1 | 2 | 3 | 4) => void
}

export function ChartSettingsColorPopover({
  activeColor,
  opacity,
  onSelect,
  onOpacityChange,
  thickness,
  onThicknessChange,
}: ChartSettingsColorPopoverProps) {
  const updateOpacityInput = (value: string) => {
    const digits = value.replace(/\D/g, '')
    const next = digits === '' ? 0 : Math.min(100, Number(digits))
    onOpacityChange(next)
  }

  return (
    <div
      className="sim-chart-color-popover"
      onPointerDown={event => {
        event.stopPropagation()
      }}
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div className="sim-chart-color-grid">
        {SETTINGS_COLOR_PALETTE.map((color, index) => (
          <button
            key={`${color}-${index}`}
            type="button"
            className={`sim-chart-color-cell ${activeColor === color ? 'sim-chart-color-cell-active' : ''}`}
            style={{ background: color }}
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onSelect(color)
            }}
            aria-label={`Select ${color}`}
          />
        ))}
      </div>
      <div className="sim-chart-color-opacity-title">Opacity</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px', alignItems: 'center', gap: 10 }}>
        <input
          className="sim-chart-color-opacity"
          type="range"
          min="0"
          max="100"
          value={opacity}
          style={{ '--opacity-color': activeColor } as CSSProperties}
          onChange={event => onOpacityChange(Number(event.target.value))}
        />
        <label className="sim-chart-color-opacity-input">
          <input
            value={opacity}
            inputMode="numeric"
            pattern="[0-9]*"
            onChange={event => updateOpacityInput(event.target.value)}
            onKeyDown={event => {
              if (['e', 'E', '+', '-', '.', ','].includes(event.key)) event.preventDefault()
            }}
            aria-label="Opacity percent"
          />
          <span>%</span>
        </label>
      </div>
      {thickness != null && onThicknessChange && (
        <>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, margin: '12px 0 7px' }}>Thickness</div>
          <div className="sim-chart-color-thickness" role="radiogroup" aria-label="Line thickness">
            {([1, 2, 3, 4] as const).map(width => (
              <button
                key={width}
                type="button"
                role="radio"
                aria-checked={thickness === width}
                className={thickness === width ? 'sim-chart-color-thickness-active' : ''}
                onClick={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  onThicknessChange(width)
                }}
                aria-label={`${width} pixel line`}
              >
                <span style={{ height: width }} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
