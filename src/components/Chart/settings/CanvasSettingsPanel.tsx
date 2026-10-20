import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ChartSettingsColorPopover, SettingsArrowDownIcon } from './chartSettings'
import type {
  CanvasLineStyle,
  CanvasLineWidth,
  ChartCanvasSettings,
} from './canvasSettings'
import './CanvasSettingsPanel.css'

type ColorKey =
  | 'backgroundTop'
  | 'backgroundBottom'
  | 'gridVertical'
  | 'gridHorizontal'
  | 'sessionBreak'
  | 'crosshair'
  | 'watermark'
  | 'scaleText'
  | 'scaleLine'

type SelectKey = 'background' | 'grid' | 'textSize'

interface CanvasSettingsPanelProps {
  value: ChartCanvasSettings
  onChange: (patch: Partial<ChartCanvasSettings>) => void
}

interface SelectOption<T extends string | number> {
  value: T
  label: string
}

interface CanvasSelectProps<T extends string | number> {
  id: SelectKey
  value: T
  options: SelectOption<T>[]
  open: boolean
  onToggle: (id: SelectKey) => void
  onSelect: (value: T) => void
  ariaLabel: string
}

function CanvasSelect<T extends string | number>({
  id,
  value,
  options,
  open,
  onToggle,
  onSelect,
  ariaLabel,
}: CanvasSelectProps<T>) {
  const selected = options.find(option => option.value === value) ?? options[0]
  return (
    <span className="sim-canvas-select-wrap" data-select={id}>
      <button
        type="button"
        className="sim-canvas-select-button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span>{selected.label}</span>
        <span className="sim-canvas-select-arrow">{SettingsArrowDownIcon}</span>
      </button>
      {open && (
        <span className="sim-canvas-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? 'sim-canvas-select-option-active' : ''}
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function checkerColor(color: string, opacity: number): CSSProperties['background'] {
  const hex = color.startsWith('#') ? color : '#000000'
  const value = Number.parseInt(hex.slice(1), 16)
  const valid = Number.isFinite(value) && (hex.length === 7 || hex.length === 4)
  let rgba = color
  if (valid) {
    const normalized = hex.length === 4
      ? hex.slice(1).split('').map(part => part + part).join('')
      : hex.slice(1)
    const parsed = Number.parseInt(normalized, 16)
    rgba = `rgba(${(parsed >> 16) & 255}, ${(parsed >> 8) & 255}, ${parsed & 255}, ${opacity / 100})`
  }
  return `linear-gradient(${rgba}, ${rgba}), repeating-conic-gradient(#fff 0 25%, #c7c9cf 0 50%) 0 / 8px 8px`
}

interface ColorControlProps {
  controlKey: ColorKey
  activeKey: ColorKey | null
  color: string
  opacity: number
  onToggle: (key: ColorKey) => void
  onColorChange: (color: string) => void
  onOpacityChange: (opacity: number) => void
  label: string
  thickness?: CanvasLineWidth
  onThicknessChange?: (width: CanvasLineWidth) => void
  linePreview?: boolean
  lineStyle?: CanvasLineStyle
  disabled?: boolean
}

function ColorControl({
  controlKey,
  activeKey,
  color,
  opacity,
  onToggle,
  onColorChange,
  onOpacityChange,
  label,
  thickness,
  onThicknessChange,
  linePreview = false,
  lineStyle = 'solid',
  disabled = false,
}: ColorControlProps) {
  return (
    <span className="sim-chart-settings-swatch-wrap sim-canvas-color-wrap" data-color-key={controlKey}>
      <button
        type="button"
        className={`sim-canvas-color-button ${linePreview ? 'sim-canvas-color-button-line' : ''} ${activeKey === controlKey ? 'sim-canvas-control-active' : ''}`}
        aria-label={label}
        aria-expanded={activeKey === controlKey}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onToggle(controlKey)
        }}
      >
        <span className="sim-canvas-color-chip" style={{ background: checkerColor(color, opacity) }} />
        {linePreview && (
          <span
            className={`sim-canvas-line-preview sim-canvas-line-${lineStyle}`}
            style={{ '--line-color': color, '--line-width': `${thickness ?? 1}px` } as CSSProperties}
          />
        )}
      </button>
      {activeKey === controlKey && (
        <ChartSettingsColorPopover
          activeColor={color}
          opacity={opacity}
          onSelect={onColorChange}
          onOpacityChange={onOpacityChange}
          thickness={thickness}
          onThicknessChange={onThicknessChange}
        />
      )}
    </span>
  )
}

interface StyleControlProps {
  value: CanvasLineStyle
  open: boolean
  onToggle: () => void
  onChange: (value: CanvasLineStyle) => void
  label: string
  disabled?: boolean
}

const STYLE_OPTIONS: SelectOption<CanvasLineStyle>[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
]

function StyleControl({ value, open, onToggle, onChange, label, disabled = false }: StyleControlProps) {
  return (
    <span className="sim-canvas-style-wrap">
      <button
        type="button"
        className={`sim-canvas-style-button ${open ? 'sim-canvas-control-active' : ''}`}
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onToggle()
        }}
      >
        <span className={`sim-canvas-style-sample sim-canvas-line-${value}`} />
      </button>
      {open && (
        <span className="sim-canvas-style-menu" role="menu">
          {STYLE_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              className={option.value === value ? 'sim-canvas-style-option-active' : ''}
              onClick={() => onChange(option.value)}
            >
              <span className={`sim-canvas-style-sample sim-canvas-line-${option.value}`} />
              <span>{option.label}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

function SettingRow({ label, checkbox, children, disabled = false }: { label: string; checkbox?: ReactNode; children: ReactNode; disabled?: boolean }) {
  return (
    <div className={`sim-canvas-setting-row ${disabled ? 'sim-canvas-setting-row-disabled' : ''}`}>
      <div className="sim-canvas-setting-label">
        {checkbox}
        <span>{label}</span>
      </div>
      <div className="sim-canvas-setting-control">{children}</div>
    </div>
  )
}

export function CanvasSettingsPanel({ value, onChange }: CanvasSettingsPanelProps) {
  const [activeColor, setActiveColor] = useState<ColorKey | null>(null)
  const [openSelect, setOpenSelect] = useState<SelectKey | null>(null)
  const [openStyle, setOpenStyle] = useState<'session' | 'crosshair' | null>(null)

  useEffect(() => {
    if (!activeColor && !openSelect && !openStyle) return
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.sim-canvas-settings-panel')) return
      setActiveColor(null)
      setOpenSelect(null)
      setOpenStyle(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [activeColor, openSelect, openStyle])

  const toggleColor = (key: ColorKey) => {
    setOpenSelect(null)
    setOpenStyle(null)
    setActiveColor(current => current === key ? null : key)
  }
  const toggleSelect = (key: SelectKey) => {
    setActiveColor(null)
    setOpenStyle(null)
    setOpenSelect(current => current === key ? null : key)
  }
  const toggleStyle = (key: 'session' | 'crosshair') => {
    setActiveColor(null)
    setOpenSelect(null)
    setOpenStyle(current => current === key ? null : key)
  }

  return (
    <div className="sim-canvas-settings-panel">
      <div className="sim-chart-settings-section">Chart basic styles</div>

      <SettingRow label="Background">
        <CanvasSelect
          id="background"
          value={value.backgroundType}
          options={[{ value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }]}
          open={openSelect === 'background'}
          onToggle={toggleSelect}
          onSelect={backgroundType => {
            onChange({ backgroundType })
            setOpenSelect(null)
          }}
          ariaLabel="Background style"
        />
        <ColorControl
          controlKey="backgroundTop"
          activeKey={activeColor}
          color={value.backgroundTopColor}
          opacity={value.backgroundTopOpacity}
          onToggle={toggleColor}
          onColorChange={backgroundTopColor => onChange({ backgroundTopColor })}
          onOpacityChange={backgroundTopOpacity => onChange({ backgroundTopOpacity })}
          label={value.backgroundType === 'gradient' ? 'Top background color' : 'Background color'}
        />
        {value.backgroundType === 'gradient' && (
          <ColorControl
            controlKey="backgroundBottom"
            activeKey={activeColor}
            color={value.backgroundBottomColor}
            opacity={value.backgroundBottomOpacity}
            onToggle={toggleColor}
            onColorChange={backgroundBottomColor => onChange({ backgroundBottomColor })}
            onOpacityChange={backgroundBottomOpacity => onChange({ backgroundBottomOpacity })}
            label="Bottom background color"
          />
        )}
      </SettingRow>

      <SettingRow label="Grid lines">
        <CanvasSelect
          id="grid"
          value={value.gridMode}
          options={[
            { value: 'none', label: 'None' },
            { value: 'vertical', label: 'Vert only' },
            { value: 'horizontal', label: 'Horz only' },
            { value: 'both', label: 'Vert and horz' },
          ]}
          open={openSelect === 'grid'}
          onToggle={toggleSelect}
          onSelect={gridMode => {
            onChange({ gridMode })
            setOpenSelect(null)
          }}
          ariaLabel="Grid line mode"
        />
        {(value.gridMode === 'vertical' || value.gridMode === 'both') && (
          <ColorControl
            controlKey="gridVertical"
            activeKey={activeColor}
            color={value.gridVerticalColor}
            opacity={value.gridVerticalOpacity}
            onToggle={toggleColor}
            onColorChange={gridVerticalColor => onChange({ gridVerticalColor })}
            onOpacityChange={gridVerticalOpacity => onChange({ gridVerticalOpacity })}
            label="Vertical grid color"
          />
        )}
        {(value.gridMode === 'horizontal' || value.gridMode === 'both') && (
          <ColorControl
            controlKey="gridHorizontal"
            activeKey={activeColor}
            color={value.gridHorizontalColor}
            opacity={value.gridHorizontalOpacity}
            onToggle={toggleColor}
            onColorChange={gridHorizontalColor => onChange({ gridHorizontalColor })}
            onOpacityChange={gridHorizontalOpacity => onChange({ gridHorizontalOpacity })}
            label="Horizontal grid color"
          />
        )}
      </SettingRow>

      <SettingRow
        label="Session breaks"
        disabled={!value.sessionBreaksVisible}
        checkbox={(
          <input
            type="checkbox"
            className="sim-chart-settings-check"
            aria-label="Show session breaks"
            checked={value.sessionBreaksVisible}
            onChange={event => {
              const sessionBreaksVisible = event.target.checked
              if (!sessionBreaksVisible) {
                setActiveColor(null)
                setOpenStyle(null)
              }
              onChange({ sessionBreaksVisible })
            }}
          />
        )}
      >
        <ColorControl
          controlKey="sessionBreak"
          activeKey={activeColor}
          color={value.sessionBreakColor}
          opacity={value.sessionBreakOpacity}
          thickness={value.sessionBreakWidth}
          lineStyle={value.sessionBreakStyle}
          linePreview
          disabled={!value.sessionBreaksVisible}
          onToggle={toggleColor}
          onColorChange={sessionBreakColor => onChange({ sessionBreakColor })}
          onOpacityChange={sessionBreakOpacity => onChange({ sessionBreakOpacity })}
          onThicknessChange={sessionBreakWidth => onChange({ sessionBreakWidth })}
          label="Session break color and thickness"
        />
        <StyleControl
          value={value.sessionBreakStyle}
          open={openStyle === 'session'}
          onToggle={() => toggleStyle('session')}
          onChange={sessionBreakStyle => {
            onChange({ sessionBreakStyle })
            setOpenStyle(null)
          }}
          label="Session break line style"
          disabled={!value.sessionBreaksVisible}
        />
      </SettingRow>

      <SettingRow label="Crosshair">
        <ColorControl
          controlKey="crosshair"
          activeKey={activeColor}
          color={value.crosshairColor}
          opacity={value.crosshairOpacity}
          thickness={value.crosshairWidth}
          lineStyle={value.crosshairStyle}
          linePreview
          onToggle={toggleColor}
          onColorChange={crosshairColor => onChange({ crosshairColor })}
          onOpacityChange={crosshairOpacity => onChange({ crosshairOpacity })}
          onThicknessChange={crosshairWidth => onChange({ crosshairWidth })}
          label="Crosshair color and thickness"
        />
        <StyleControl
          value={value.crosshairStyle}
          open={openStyle === 'crosshair'}
          onToggle={() => toggleStyle('crosshair')}
          onChange={crosshairStyle => {
            onChange({ crosshairStyle })
            setOpenStyle(null)
          }}
          label="Crosshair line style"
        />
      </SettingRow>

      <SettingRow
        label="Watermark"
        checkbox={(
          <input
            type="checkbox"
            className="sim-chart-settings-check"
            aria-label="Show watermark"
            checked={value.watermarkVisible}
            onChange={event => onChange({ watermarkVisible: event.target.checked })}
          />
        )}
      >
        <ColorControl
          controlKey="watermark"
          activeKey={activeColor}
          color={value.watermarkColor}
          opacity={value.watermarkOpacity}
          onToggle={toggleColor}
          onColorChange={watermarkColor => onChange({ watermarkColor })}
          onOpacityChange={watermarkOpacity => onChange({ watermarkOpacity })}
          label="Watermark color"
        />
      </SettingRow>

      <div className="sim-chart-settings-section sim-canvas-scales-section">Scales</div>

      <SettingRow label="Text">
        <ColorControl
          controlKey="scaleText"
          activeKey={activeColor}
          color={value.scaleTextColor}
          opacity={value.scaleTextOpacity}
          onToggle={toggleColor}
          onColorChange={scaleTextColor => onChange({ scaleTextColor })}
          onOpacityChange={scaleTextOpacity => onChange({ scaleTextOpacity })}
          label="Scale text color"
        />
        <CanvasSelect
          id="textSize"
          value={value.scaleTextSize}
          options={[10, 11, 12, 14, 16, 18, 20, 24, 28].map(size => ({ value: size, label: String(size) }))}
          open={openSelect === 'textSize'}
          onToggle={toggleSelect}
          onSelect={scaleTextSize => {
            onChange({ scaleTextSize })
            setOpenSelect(null)
          }}
          ariaLabel="Scale text size"
        />
      </SettingRow>

      <SettingRow label="Lines">
        <ColorControl
          controlKey="scaleLine"
          activeKey={activeColor}
          color={value.scaleLineColor}
          opacity={value.scaleLineOpacity}
          onToggle={toggleColor}
          onColorChange={scaleLineColor => onChange({ scaleLineColor })}
          onOpacityChange={scaleLineOpacity => onChange({ scaleLineOpacity })}
          label="Scale line color"
        />
      </SettingRow>
    </div>
  )
}
